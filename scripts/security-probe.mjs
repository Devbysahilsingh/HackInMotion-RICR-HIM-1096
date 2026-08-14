#!/usr/bin/env node
/**
 * Dynamic security probe — a black-box pass over a *running* API.
 *
 * ## Why this exists
 *
 * `docs/security/security-testing.md` asks for an OWASP ZAP baseline scan. That
 * scan has since been run (`0 FAIL / 66 PASS`, docs/security/phase-7-scorecard.md),
 * so this script is no longer a stand-in for it — it is the half ZAP cannot do.
 *
 * The two are complementary, and the split is a property of the target rather
 * than of the tools: this API serves no HTML, so ZAP's spider has nothing to
 * crawl, and every interesting endpoint sits behind a bearer token that ZAP's
 * baseline mode never acquires. ZAP therefore examines the *unauthenticated*
 * surface thoroughly — 66 passive rules over headers, disclosure and caching —
 * and this script authenticates and probes what lies behind the token: IDOR
 * answers, pagination ceilings, mass-assignment refusals, and the shape of
 * every error a hostile input produces.
 *
 * It still does not reproduce ZAP's active injection rules. Those are covered
 * by ST-40 against the code rather than over the wire.
 *
 * ## What it is not allowed to do
 *
 * Read-only and non-destructive. It creates nothing, deletes nothing, and is
 * safe to point at a staging deployment. It must never be pointed at a
 * production instance holding real farmer data.
 *
 * Usage:
 *   node scripts/security-probe.mjs http://127.0.0.1:4000
 *   DEMO_EMAIL=... DEMO_PASSWORD=... node scripts/security-probe.mjs <base>
 *
 * With credentials it additionally probes authenticated surfaces. Without
 * them it runs the unauthenticated subset and says which checks it skipped.
 */

const base = (process.argv[2] ?? 'http://127.0.0.1:4000').replace(/\/$/, '');
const api = `${base}/api/v1`;
const email = process.env.DEMO_EMAIL ?? null;
const password = process.env.DEMO_PASSWORD ?? null;

let pass = 0;
let fail = 0;
let skip = 0;
const failures = [];

const check = (name, ok, detail = '') => {
  if (ok) {
    pass += 1;
    console.log(`  PASS  ${name}`);
  } else {
    fail += 1;
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

const skipped = (name, why) => {
  skip += 1;
  console.log(`  SKIP  ${name} — ${why}`);
};

async function req(path, options = {}) {
  const response = await fetch(path.startsWith('http') ? path : `${api}${path}`, {
    redirect: 'manual',
    ...options,
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON is itself a finding for this API; the caller asserts */
  }
  return { status: response.status, headers: response.headers, text, json };
}

/**
 * Strings that must never appear in a response body. Each is a concrete
 * disclosure, not a heuristic: a stack frame, a Windows or POSIX path, a
 * driver error, a connection string, or an internal identifier.
 */
const DISCLOSURE = [
  { name: 'stack frame', re: /\n\s*at\s+[\w.$]+\s*\(/ },
  { name: 'node internals path', re: /node:internal|node_modules[\\/]/ },
  { name: 'windows filesystem path', re: /[A-Za-z]:\\\\?Users\\\\?/i },
  { name: 'posix source path', re: /\/(?:home|usr|var|opt)\/[\w./-]+\.js/ },
  { name: 'mongo connection string', re: /mongodb(?:\+srv)?:\/\// },
  { name: 'mongoose/mongo error text', re: /MongoServerError|MongooseError|E11000|CastError/ },
  { name: 'env var name', re: /\b(?:JWT_SECRET|SERVICE_KEY|MONGODB_URI|CLOUDINARY_URL)\b/ },
];

const assertNoDisclosure = (label, body) => {
  for (const { name, re } of DISCLOSURE) {
    check(`${label}: no ${name}`, !re.test(body), re.test(body) ? 'present in body' : '');
  }
};

console.log(`\nDynamic security probe — ${base}\n`);

// ── Unauthenticated surface ─────────────────────────────────────────────────
console.log('unauthenticated access control');

for (const path of [
  '/dashboard',
  '/farms',
  '/recommendations',
  '/crop-health/logs',
  '/market/my-crops',
  '/community/alerts',
  '/users/me',
]) {
  const res = await req(path);
  check(`GET ${path} without a token → 401`, res.status === 401, `got ${res.status}`);
}

const patchAnon = await req('/users/me', {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ communityConsent: true }),
});
check('PATCH /users/me without a token → 401', patchAnon.status === 401, `got ${patchAnon.status}`);

// ── Error handling / information disclosure ─────────────────────────────────
console.log('\nerror disclosure');

const notFound = await req('/definitely-not-a-route');
check('unknown route → 404 envelope', notFound.status === 404, `got ${notFound.status}`);
check(
  'unknown route body is the documented envelope',
  notFound.json?.success === false && typeof notFound.json?.error?.code === 'string',
);
assertNoDisclosure('unknown route', notFound.text);

const badJson = await req('/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: '{"email": "a@b.c", ',
});
check(
  'malformed JSON → 4xx, not 500',
  badJson.status >= 400 && badJson.status < 500,
  `got ${badJson.status}`,
);
assertNoDisclosure('malformed JSON', badJson.text);

const oversize = await req('/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'a@b.c', password: 'x'.repeat(300_000) }),
});
check('oversized body → 413', oversize.status === 413, `got ${oversize.status}`);
assertNoDisclosure('oversized body', oversize.text);

const wrongMethod = await req('/auth/login', { method: 'DELETE' });
check(
  'wrong method → 4xx, not 500',
  wrongMethod.status >= 400 && wrongMethod.status < 500,
  `got ${wrongMethod.status}`,
);
assertNoDisclosure('wrong method', wrongMethod.text);

// ── Response headers (the passive half of a baseline scan) ──────────────────
console.log('\nresponse headers');

const headerProbe = await req('/registry/crops');
const h = (name) => headerProbe.headers.get(name);

check(
  'X-Content-Type-Options: nosniff',
  h('x-content-type-options') === 'nosniff',
  String(h('x-content-type-options')),
);
check(
  'X-Frame-Options or CSP frame-ancestors present',
  Boolean(h('x-frame-options') || h('content-security-policy')),
  'neither set',
);
check('no X-Powered-By', h('x-powered-by') === null, String(h('x-powered-by')));
check('Referrer-Policy set', h('referrer-policy') !== null, 'absent');
check(
  'JSON content type',
  (h('content-type') ?? '').includes('application/json'),
  String(h('content-type')),
);

/**
 * Cache directives — the one thing the ZAP baseline actually flagged.
 *
 * Express attaches a weak ETag to every JSON response, and a 200 carrying a
 * validator but no freshness directive is heuristically cacheable
 * (RFC 9111 §4.2.2). The registry is public reference data and opts in
 * deliberately; everything else must opt out, because the bodies are one
 * farmer's farms, coordinates and health history.
 */
check(
  'reference data is explicitly cacheable',
  (h('cache-control') ?? '').includes('max-age=3600'),
  String(h('cache-control')),
);

const privateProbe = await req('/dashboard');
check(
  'a per-farmer route forbids caching',
  privateProbe.headers.get('cache-control') === 'no-store',
  String(privateProbe.headers.get('cache-control')),
);

// ── CORS ────────────────────────────────────────────────────────────────────
console.log('\nCORS');

const foreign = await req('/registry/crops', { headers: { Origin: 'https://evil.example' } });
const acao = foreign.headers.get('access-control-allow-origin');
check('foreign origin is not reflected', acao !== 'https://evil.example', String(acao));
check('no wildcard ACAO on the API', acao !== '*', String(acao));

const foreignAuth = await req('/auth/login', {
  method: 'OPTIONS',
  headers: {
    Origin: 'https://evil.example',
    'Access-Control-Request-Method': 'POST',
  },
});
const acaoAuth = foreignAuth.headers.get('access-control-allow-origin');
const acac = foreignAuth.headers.get('access-control-allow-credentials');
check(
  'auth path does not grant credentials to a foreign origin',
  !(acaoAuth === 'https://evil.example' && acac === 'true'),
  `origin=${acaoAuth} credentials=${acac}`,
);

// ── Authentication behaviour ────────────────────────────────────────────────
console.log('\nauthentication');

const forged = await req('/dashboard', {
  headers: { Authorization: 'Bearer eyJhbGciOiJub25lIn0.eyJzdWIiOiJhIn0.' },
});
check('alg=none token rejected → 401', forged.status === 401, `got ${forged.status}`);

const garbage = await req('/dashboard', { headers: { Authorization: 'Bearer not.a.token' } });
check('malformed token rejected → 401', garbage.status === 401, `got ${garbage.status}`);

const noScheme = await req('/dashboard', { headers: { Authorization: 'token abc' } });
check('wrong auth scheme rejected → 401', noScheme.status === 401, `got ${noScheme.status}`);

const unknownUser = await req('/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'nobody-here@example.invalid', password: 'whatever-123' }),
});
check('unknown account → 401', unknownUser.status === 401, `got ${unknownUser.status}`);
/**
 * The failure must name an i18n key, not a sentence — a dotted identifier with
 * no whitespace. Prose here would both leak wording decisions to an attacker
 * and break rule 8.
 */
const loginKey = unknownUser.json?.error?.messageKey ?? '';
check(
  'login failure carries an i18n key, never prose',
  /^[a-z][\w]*\.[\w.]+$/.test(loginKey) && !/\s/.test(loginKey),
  loginKey || '(absent)',
);

/**
 * A password chosen to be wrong.
 *
 * Not a credential: it is the *incorrect* half of the enumeration probe below,
 * and the check only passes when the API refuses it. Naming it says so.
 */
const WRONG_PASSWORD = 'definitely-not-the-password'; // pragma: allowlist-secret — fabricated value, asserted to be refused

/**
 * Enumeration: an unknown account and a known account with the wrong password
 * must be indistinguishable in status AND in body.
 */
if (email) {
  const wrongPassword = await req('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: WRONG_PASSWORD }),
  });
  check(
    'unknown account and wrong password are indistinguishable',
    wrongPassword.status === unknownUser.status &&
      wrongPassword.json?.error?.messageKey === unknownUser.json?.error?.messageKey,
    `${unknownUser.status}/${unknownUser.json?.error?.messageKey} vs ${wrongPassword.status}/${wrongPassword.json?.error?.messageKey}`,
  );
}

// NoSQL operator injection against the login body — the classic auth bypass.
const operatorLogin = await req('/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: { $ne: null }, password: { $ne: null } }),
});
check(
  'NoSQL operator object in login body does not authenticate',
  operatorLogin.status !== 200,
  `got ${operatorLogin.status}`,
);

// Same idea through the query string, where Express builds objects from
// bracket syntax and a "string" parameter can arrive as an operator.
const operatorQuery = await req('/registry/crops?code[$ne]=x');
check(
  'operator in a query parameter does not 500',
  operatorQuery.status < 500,
  `got ${operatorQuery.status}`,
);
assertNoDisclosure('operator query', operatorQuery.text);

// ── Authenticated surface ───────────────────────────────────────────────────
if (!email || !password) {
  console.log('\nauthenticated probes');
  skipped('IDOR / pagination / rate-limit probes', 'DEMO_EMAIL and DEMO_PASSWORD not set');
} else {
  console.log('\nauthenticated probes');

  const login = await req('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  if (login.status !== 200) {
    check('demo login succeeds', false, `got ${login.status}`);
  } else {
    const token = login.json.data.accessToken;
    const auth = { Authorization: `Bearer ${token}` };

    // Ownership: a well-formed id belonging to nobody must 404, never 403 —
    // a 403 confirms the row exists and is an existence oracle.
    const ghost = '000000000000000000000000';
    for (const path of [`/farms/${ghost}`, `/crops/${ghost}`, `/crop-health/logs/${ghost}`]) {
      const res = await req(path, { headers: auth });
      check(`GET ${path} (foreign id) → 404 not 403`, res.status === 404, `got ${res.status}`);
    }

    // A malformed id must not reach the driver and produce a CastError.
    const malformed = await req('/farms/not-an-object-id', { headers: auth });
    check(
      'malformed id → 4xx, no driver error',
      malformed.status >= 400 && malformed.status < 500,
      `got ${malformed.status}`,
    );
    assertNoDisclosure('malformed id', malformed.text);

    // Pagination bounds — an unbounded limit is a cheap denial of service.
    for (const limit of ['1000000', '-1', '0', 'NaN', 'Infinity', '1e9']) {
      const res = await req(`/crop-health/logs?limit=${limit}`, { headers: auth });
      const rows = res.json?.data?.logs?.length ?? 0;
      check(
        `limit=${limit} is rejected or clamped (got ${res.status}, ${rows} rows)`,
        res.status === 422 || rows <= 50,
        `${res.status} / ${rows} rows`,
      );
    }

    // Mass assignment on the settings endpoint.
    const massAssign = await req('/users/me', {
      method: 'PATCH',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'admin', isAdmin: true, passwordHash: 'x' }),
    });
    check(
      'PATCH /users/me rejects unlisted fields → 422',
      massAssign.status === 422,
      `got ${massAssign.status}`,
    );

    const me = await req('/auth/me', { headers: auth });
    check('user projection excludes passwordHash', !/passwordHash|\$2[aby]\$/.test(me.text));
    check('user projection excludes tokens', !/refreshToken/.test(me.text));
  }
}

// ── Result ──────────────────────────────────────────────────────────────────
console.log(`\n${pass} passed, ${fail} failed, ${skip} skipped`);
if (fail > 0) {
  console.log('\nFailures:');
  for (const failure of failures) console.log(`  - ${failure}`);
}
process.exit(fail === 0 ? 0 : 1);
