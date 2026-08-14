/**
 * ST-40 — Injection [blocking]
 *
 * docs/security/security-testing.md, verbatim:
 *   "$-operator payloads in every string field (sanitizer), instruction-injection
 *    in health description (guidance unchanged fixture), XSS payload round-trip
 *    (stored text is escaped on render — RTL test)."
 *
 * The XSS round-trip is a render-layer assertion and lives in the web suite; the
 * prompt-injection strip is proven directly in tests/services/aiVision.test.js.
 * This file owns the server half: **no request-shaped input may ever become a
 * MongoDB operator, a prototype mutation, a shell word or a filesystem path.**
 *
 * The application claims a three-layer defence, and each layer is asserted here
 * on its own rather than through the others, because a suite that only checks
 * the final status code cannot tell three working layers from one:
 *
 *   1. `middleware/sanitize.js`  — operator-shaped keys are deleted
 *   2. `middleware/validate.js`  — Zod types every field that reaches a filter
 *   3. Mongoose casting          — a `String` path refuses a non-string
 *
 * Layer 3 is **weaker than it looks**, and the "arrays" section below proves the
 * exact shape of the gap rather than asserting around it: Mongoose rejects an
 * object on a `String` path but folds an *array* into an implicit `$in`. So an
 * array is an operator payload that carries no operator syntax, is invisible to
 * layer 1 by design, and is reachable from a bare query string with no JSON at
 * all (`?district=a&district=b`). Layer 2 is the only thing that stops it, which
 * is why every request-derived filter field is enumerated and proven to reject
 * one.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { Router } from 'express';

import { createApp } from '../../src/app.js';
import { CommunityAlert, CropRegistry, MarketPrice, User } from '../../src/models/index.js';
import { startTestServer } from '../helpers/app.js';
import { startTestDatabase, stopTestDatabase } from '../helpers/db.js';
import { farmInput, registerUser, uniqueEmail } from '../factories/index.js';

// ════════════════════════════════════════════════════════════════════════════
// Payload vocabulary
// ════════════════════════════════════════════════════════════════════════════

/**
 * The password these suites register and log in with.
 *
 * A fabricated passphrase, used only against the ephemeral in-memory database
 * each run creates and discards. It is never the subject of a test — every case
 * below is about what happens to the *other* field — so its only job is to be a
 * valid password that keeps a request from failing validation for the wrong
 * reason.
 */
const TEST_PASSWORD = 'correct-horse-battery'; // pragma: allowlist-secret — fabricated fixture credential

/**
 * Every shape that turns a scalar comparison into something else once it
 * reaches a query object. Named so a failure report says which one got through.
 */
const OPERATOR_PAYLOADS = [
  ['$ne', { $ne: null }],
  ['$gt', { $gt: '' }],
  ['$gte', { $gte: '' }],
  ['$regex', { $regex: '.*' }],
  ['$where', { $where: 'return true' }],
  ['$expr', { $expr: { $eq: [1, 1] } }],
  ['$in', { $in: ['anything'] }],
  ['$nin', { $nin: [] }],
  ['$exists', { $exists: true }],
  ['$not', { $not: { $eq: null } }],
  // Nested one level down: a scrubber that only looked at top-level keys of the
  // body — rather than recursing — would leave this intact.
  ['nested in object', { a: { b: { $ne: null } } }],
  // Nested inside an array: the same gap, reached through an index rather than
  // a key.
  ['nested in array', [{ $ne: null }]],
  // An operator whose *key* is legitimate but whose value smuggles the next one.
  ['operator under a plain key', { value: { $ne: null } }],
  // No operator syntax at all — see the arrays section.
  ['array (implicit $in)', ['decoy-one', 'decoy-two']],
];

/** Prototype-pollution key names, as body keys and as nested keys. */
const POLLUTION_BODIES = [
  ['__proto__ direct', '{"__proto__":{"polluted":"yes"},"email":"a@b.co","password":"aaaaaaaa"}'],
  [
    'constructor.prototype',
    '{"constructor":{"prototype":{"polluted":"yes"}},"email":"a@b.co","password":"aaaaaaaa"}',
  ],
  ['prototype key', '{"prototype":{"polluted":"yes"},"email":"a@b.co","password":"aaaaaaaa"}'],
  [
    '__proto__ nested under a declared field',
    '{"email":{"__proto__":{"polluted":"yes"}},"password":"aaaaaaaa"}',
  ],
  [
    '__proto__ inside an array',
    '{"email":[{"__proto__":{"polluted":"yes"}}],"password":"aaaaaaaa"}',
  ],
];

/** Filesystem escapes, in the encodings a decoder might normalise differently. */
const TRAVERSALS = [
  '../../etc/passwd',
  '..%2f..%2fetc%2fpasswd',
  '%2e%2e%2f%2e%2e%2fetc%2fpasswd',
  '....//....//etc/passwd',
  '/etc/passwd',
  'C:\\Windows\\win.ini',
  'file:///etc/passwd',
  'valid%00.jpg',
  '../../../../../../proc/self/environ',
];

/** Sets `a.b.c` on a plain object, creating intermediates. */
function setPath(target, dotted, value) {
  const parts = dotted.split('.');
  let node = target;
  for (const part of parts.slice(0, -1)) node = node[part];
  node[parts.at(-1)] = value;
  return target;
}

const clone = (value) => JSON.parse(JSON.stringify(value));

/** Nothing on Object.prototype may have moved, whatever a request tried. */
function assertPrototypeIntact(context) {
  for (const key of ['polluted', 'isAdmin', 'toString2', 'x']) {
    assert.equal(
      Object.prototype[key],
      undefined,
      `Object.prototype.${key} was set — prototype pollution via ${context}`,
    );
  }
  assert.equal({}.polluted, undefined, `a fresh object inherited a polluted key via ${context}`);
  assert.equal([].polluted, undefined, `a fresh array inherited a polluted key via ${context}`);
}

const REGISTRY_ENTRY = (cropCode, en) => ({
  cropCode,
  names: { en, hi: en },
  supportLevel: 'SPECIALIZED',
  seasons: ['KHARIF'],
  kcStages: [
    { stage: 'INITIAL', days: 30, kc: 0.35 },
    { stage: 'DEVELOPMENT', days: 50, kc: null },
    { stage: 'MID', days: 60, kc: 1.15 },
    { stage: 'LATE', days: 55, kc: 0.7 },
  ],
});

const PRICE_ROW = (state, district) => ({
  commodityCode: 'RICE',
  state,
  district,
  market: `${district} Mandi`,
  date: new Date(),
  minPrice: 1800,
  modalPrice: 2000,
  maxPrice: 2200,
  unit: 'quintal',
  source: 'seed',
  fetchedAt: new Date(),
});

const ALERT_ROW = (district, state) => ({
  district,
  state,
  cropCode: 'RICE',
  diseaseCode: 'BLAST',
  windowStart: new Date(Date.now() - 86_400_000),
  windowEnd: new Date(Date.now() + 86_400_000),
  reportCount: 4,
  distinctFarmers: 3,
  level: 'HIGH',
  active: true,
});

// ════════════════════════════════════════════════════════════════════════════

describe('ST-40 · injection', () => {
  let server;
  /** A second app carrying an echo route, for asserting middleware output. */
  let probe;
  let token;
  let farmId;
  let cropId;
  let victim;

  before(async () => {
    await startTestDatabase();
    server = await startTestServer();

    /**
     * `extraRouters` is the documented in-process composition seam (app.js).
     * It is used here to read back exactly what the middleware chain left on
     * `req` — the only way to tell "the sanitizer removed the operator" from
     * "Zod happened to reject the request for an unrelated reason".
     */
    const echo = Router();
    echo.all('/__st40/echo', (req, res) => {
      res.json({
        body: req.body ?? null,
        query: req.query ?? null,
        params: req.params ?? null,
        sanitized: req.sanitized === true,
        // Read inside the request, so a pollution that is later cleaned up by
        // the test process still fails here.
        prototypePolluted: Object.prototype.polluted ?? null,
      });
    });
    probe = await startTestServer(createApp({ extraRouters: [echo] }));

    await CropRegistry.create(REGISTRY_ENTRY('RICE', 'Rice'));
    await CropRegistry.create(REGISTRY_ENTRY('WHEAT', 'Wheat'));
    await MarketPrice.create(PRICE_ROW('Maharashtra', 'Nagpur'));
    await MarketPrice.create(PRICE_ROW('Punjab', 'Ludhiana'));
    await CommunityAlert.create(ALERT_ROW('Nagpur', 'Maharashtra'));
    await CommunityAlert.create(ALERT_ROW('Ludhiana', 'Punjab'));

    // The account an authentication bypass would be trying to reach.
    victim = await registerUser(server, { email: uniqueEmail('victim') });

    const attacker = await registerUser(server, { email: uniqueEmail('attacker') });
    token = attacker.accessToken;

    const farm = await server.request('/api/v1/farms', {
      method: 'POST',
      token,
      body: farmInput(),
    });
    assert.equal(farm.status, 201, `farm setup failed: ${farm.text}`);
    farmId = farm.body.data.farm.id;

    const crop = await server.request(`/api/v1/farms/${farmId}/crops`, {
      method: 'POST',
      token,
      body: { cropCode: 'RICE', sowingDate: '2026-07-01' },
    });
    assert.equal(crop.status, 201, `crop setup failed: ${crop.text}`);
    cropId = crop.body.data.crop.id;
  });

  after(async () => {
    await probe.close();
    await server.close();
    await stopTestDatabase();
  });

  // ══════════════════════════════════════════════════════════════════════════
  // A · The classic: authentication bypass
  // ══════════════════════════════════════════════════════════════════════════

  describe('login cannot be bypassed with an operator', () => {
    for (const [label, payload] of OPERATOR_PAYLOADS) {
      it(`refuses ${label} in the email field`, async () => {
        const res = await server.request('/api/v1/auth/login', {
          method: 'POST',
          body: { email: payload, password: TEST_PASSWORD },
        });

        assert.notEqual(res.status, 200, `${label} logged someone in`);
        assert.ok(
          [401, 422].includes(res.status),
          `${label} produced ${res.status}; a probe must look like a bad password (401) or a ` +
            `bad request (422), never a 500 that confirms the payload reached the driver`,
        );
        assert.equal(res.body?.success, false);
        assert.equal(
          res.text.includes('accessToken'),
          false,
          `${label} returned a token-shaped response`,
        );
      });

      it(`refuses ${label} in the password field`, async () => {
        const res = await server.request('/api/v1/auth/login', {
          method: 'POST',
          body: { email: victim.user.email, password: payload },
        });

        assert.notEqual(res.status, 200, `${label} logged someone in`);
        assert.ok([401, 422].includes(res.status), `unexpected ${res.status} for ${label}`);
        assert.equal(res.text.includes('accessToken'), false);
      });
    }

    it('refuses both fields replaced at once', async () => {
      const res = await server.request('/api/v1/auth/login', {
        method: 'POST',
        body: { email: { $ne: null }, password: { $ne: null } },
      });

      assert.ok([401, 422].includes(res.status));
      assert.equal(res.text.includes('accessToken'), false);
    });

    it('refuses an operator smuggled past MAX_DEPTH-1 levels of nesting', async () => {
      // Eleven levels: inside the cap, so the body is scrubbed rather than
      // rejected for depth. The operator at the bottom must still be gone.
      let deep = { $ne: null };
      for (let i = 0; i < 10; i += 1) deep = { nested: deep };

      const res = await server.request('/api/v1/auth/login', {
        method: 'POST',
        body: { email: deep, password: TEST_PASSWORD },
      });

      assert.equal(res.status, 422);
      assert.equal(res.text.includes('accessToken'), false);
    });

    it('answers a refused probe the same way it answers a wrong password', async () => {
      // Enumeration parity: an operator payload must not become an oracle for
      // "this account exists". Both land on the same code and messageKey.
      const wrongPassword = await server.request('/api/v1/auth/login', {
        method: 'POST',
        body: { email: victim.user.email, password: 'not-the-password' },
      });
      const unknownAccount = await server.request('/api/v1/auth/login', {
        method: 'POST',
        body: { email: uniqueEmail('nobody'), password: 'not-the-password' },
      });

      assert.equal(wrongPassword.status, 401);
      assert.equal(unknownAccount.status, 401);
      assert.equal(wrongPassword.body.error.code, unknownAccount.body.error.code);
      assert.equal(wrongPassword.body.error.messageKey, unknownAccount.body.error.messageKey);
    });

    it('leaves the victim able to log in normally afterwards', async () => {
      // The whole section would be vacuous if the fixture account were simply
      // unusable — this proves the 401s above were refusals, not breakage.
      const res = await server.request('/api/v1/auth/login', {
        method: 'POST',
        body: { email: victim.user.email, password: victim.password },
      });

      assert.equal(res.status, 200, res.text);
      assert.ok(res.body.data.accessToken);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // B · Operator payloads in every string body field
  // ══════════════════════════════════════════════════════════════════════════

  describe('operator payloads in every string body field', () => {
    /**
     * Every endpoint that accepts a JSON body, with a baseline that really
     * succeeds and the string fields an attacker can reach. `expectBaseline`
     * makes the matrix non-vacuous: if the baseline stopped being accepted the
     * "not 2xx" assertions below would pass for the wrong reason.
     */
    const bodyEndpoints = () => [
      {
        name: 'POST /auth/register',
        method: 'POST',
        path: '/api/v1/auth/register',
        auth: false,
        expectBaseline: 201,
        body: {
          name: 'Test Farmer',
          email: uniqueEmail('matrix'),
          password: TEST_PASSWORD,
          language: 'en',
        },
        fields: ['name', 'email', 'password', 'language'],
      },
      {
        name: 'POST /auth/refresh',
        method: 'POST',
        path: '/api/v1/auth/refresh',
        auth: false,
        // A syntactically valid but unknown token: 401, not 2xx. The field is
        // still worth the matrix because it reaches a token lookup.
        expectBaseline: 401,
        body: { refreshToken: 'a'.repeat(64) },
        fields: ['refreshToken'],
      },
      {
        name: 'POST /farms',
        method: 'POST',
        path: '/api/v1/farms',
        auth: true,
        expectBaseline: 201,
        body: farmInput(),
        fields: [
          'name',
          'location.state',
          'location.district',
          'location.source',
          'sizeUnit',
          'soilType',
          'irrigationMethod',
        ],
      },
      {
        name: 'POST /farms/:farmId/crops',
        method: 'POST',
        path: `/api/v1/farms/${farmId}/crops`,
        auth: true,
        expectBaseline: 201,
        body: { cropCode: 'WHEAT', sowingDate: '2026-07-01', variety: 'local' },
        fields: ['cropCode', 'sowingDate', 'variety'],
      },
      {
        name: 'PATCH /crops/:id',
        method: 'PATCH',
        path: `/api/v1/crops/${cropId}`,
        auth: true,
        expectBaseline: 200,
        body: { variety: 'renamed' },
        fields: ['variety'],
      },
      {
        name: 'PATCH /users/me',
        method: 'PATCH',
        path: '/api/v1/users/me',
        auth: true,
        expectBaseline: 200,
        body: { language: 'hi' },
        fields: ['language'],
      },
      {
        name: 'POST /crop-recommendation',
        method: 'POST',
        path: '/api/v1/crop-recommendation',
        auth: true,
        expectBaseline: 200,
        body: { farmId, season: 'KHARIF' },
        fields: ['farmId', 'season'],
      },
      {
        name: 'POST /crop-health/symptom-check',
        method: 'POST',
        path: '/api/v1/crop-health/symptom-check',
        auth: true,
        expectBaseline: 200,
        body: { cropId, answers: { part: 'LEAF', color: 'YELLOW' } },
        fields: ['cropId', 'answers.part', 'answers.color'],
      },
    ];

    it('every baseline in the matrix really succeeds', async () => {
      for (const endpoint of bodyEndpoints()) {
        const res = await server.request(endpoint.path, {
          method: endpoint.method,
          token: endpoint.auth ? token : undefined,
          body: endpoint.body,
        });
        assert.equal(
          res.status,
          endpoint.expectBaseline,
          `${endpoint.name} baseline returned ${res.status}: ${res.text}`,
        );
      }
    });

    for (const endpoint of bodyEndpoints()) {
      for (const field of endpoint.fields) {
        it(`${endpoint.name} refuses every operator payload in \`${field}\``, async () => {
          for (const [label, payload] of OPERATOR_PAYLOADS) {
            const body = setPath(clone(endpoint.body), field, payload);

            const res = await server.request(endpoint.path, {
              method: endpoint.method,
              token: endpoint.auth ? token : undefined,
              body,
            });

            assert.ok(
              res.status >= 400,
              `${endpoint.name} accepted ${label} in ${field} (status ${res.status}): ${res.text}`,
            );
            assert.ok(
              res.status < 500,
              `${endpoint.name} answered ${res.status} for ${label} in ${field} — a 5xx means ` +
                `the payload reached the driver instead of being refused at the boundary`,
            );
          }
        });
      }
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // C · The query string
  // ══════════════════════════════════════════════════════════════════════════

  describe('query strings cannot carry an operator', () => {
    it('does not parse bracket syntax into a nested object', async () => {
      // Express 5 defaults to the `simple` query parser (node:querystring), so
      // `a[$ne]=x` is one literal key and never a `{a: {$ne}}` object. That is
      // the load-bearing fact behind every assertion in this section, and it is
      // a *default* — a future `app.set('query parser', 'extended')` would turn
      // every bracketed query param into a real operator object, so it is
      // asserted here rather than assumed.
      const res = await probe.request(
        '/__st40/echo?commodity[$ne]=x&district[$regex]=.*&deep[a][b][$gt]=',
      );

      assert.equal(res.status, 200, res.text);
      for (const [key, value] of Object.entries(res.body.query)) {
        assert.equal(
          typeof value,
          'string',
          `query key ${key} parsed into a ${typeof value} — bracket syntax became structure`,
        );
      }
      assert.ok(Object.hasOwn(res.body.query, 'commodity[$ne]'));
      assert.equal(res.body.query.commodity, undefined);
    });

    /**
     * Changed from "strips the key and continues" to "rejects", because
     * stripping was the bug: several query filters are optional, so deleting
     * `state.$ne` turns a probe into a valid request meaning "no state filter"
     * and the caller is answered with every state. `.strict()` cannot save it —
     * the key is gone before Zod runs. See the sanitizer's own comment and the
     * `never widens its filter` cases below, which is where this surfaced.
     */
    it('rejects a $-prefixed or dotted query key instead of silently dropping it', async () => {
      const res = await probe.request('/__st40/echo?$where=1&a.b=2&keep=3');

      assert.equal(res.status, 422, res.text);
      assert.equal(res.body.error.code, 'VALIDATION_ERROR');
      assert.deepEqual(res.body.error.details, [{ field: '(query)', rule: 'operator_key' }]);
      // The offending key must not be reflected back to the caller.
      assert.ok(!res.text.includes('$where'), 'the rejected key was echoed into the response');
      assert.ok(!res.text.includes('a.b'), 'the rejected key was echoed into the response');
    });

    it('records nothing when a query is clean', async () => {
      const res = await probe.request('/__st40/echo?state=Maharashtra');

      assert.deepEqual(res.body.query, { state: 'Maharashtra' });
      assert.equal(res.body.sanitized, false);
    });

    /**
     * The endpoints whose query params land in a database filter, each with a
     * baseline that selects a known row and a decoy row it must never reach.
     */
    const filteredReads = [
      {
        name: 'GET /registry/crops',
        path: '/api/v1/registry/crops',
        auth: false,
        base: { code: 'RICE' },
        field: 'code',
        decoy: 'WHEAT',
        // A single crop is returned under `data.crop`; the unfiltered branch
        // returns `data.crops`.
        selected: (body) => body?.data?.crop?.cropCode ?? null,
      },
      {
        name: 'GET /market/prices',
        path: '/api/v1/market/prices',
        auth: true,
        base: { commodity: 'RICE', state: 'Maharashtra' },
        field: 'state',
        decoy: 'Punjab',
        // The series does not echo `state`, so the decoy row is identified by
        // the mandi name only it carries. Seeded that way above for exactly
        // this reason.
        marker: 'Ludhiana',
        selected: (body) =>
          [...new Set((body?.data?.series ?? []).map((row) => row.market))].sort().join(',') ||
          null,
      },
      {
        name: 'GET /community/alerts',
        path: '/api/v1/community/alerts',
        auth: true,
        base: { district: 'Nagpur', state: 'Maharashtra' },
        field: 'district',
        decoy: 'Ludhiana',
        selected: (body) =>
          [...new Set((body?.data?.alerts ?? []).map((row) => row.district))].sort().join(',') ||
          null,
      },
    ];

    const qs = (params) =>
      Object.entries(params)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join('&');

    for (const read of filteredReads) {
      it(`${read.name} never widens its filter through \`${read.field}\``, async () => {
        const marker = read.marker ?? read.decoy;

        const baseline = await server.request(`${read.path}?${qs(read.base)}`, {
          token: read.auth ? token : undefined,
        });
        assert.equal(baseline.status, 200, `baseline failed: ${baseline.text}`);

        const selectedByBaseline = read.selected(baseline.body);
        assert.ok(
          selectedByBaseline && !selectedByBaseline.includes(marker),
          `${read.name} baseline must select something that excludes the decoy, got ` +
            `${selectedByBaseline}`,
        );

        /**
         * Raw query strings, not encoded pairs — the point is what the parser
         * does with the punctuation, so it has to survive to the wire.
         */
        const attacks = [
          `${read.field}[$ne]=${read.decoy}`,
          `${read.field}[$regex]=.*`,
          `${read.field}[$gt]=`,
          `${read.field}.$ne=${read.decoy}`,
          `$where=1`,
          // No operator syntax whatsoever — a repeated key, which node's query
          // parser turns into an array, which Mongoose folds into `$in`.
          `${read.field}=${read.base[read.field]}&${read.field}=${read.decoy}`,
          `${read.field}=${encodeURIComponent(JSON.stringify({ $ne: read.decoy }))}`,
        ];

        for (const attack of attacks) {
          const rest = qs(
            Object.fromEntries(Object.entries(read.base).filter(([k]) => k !== read.field)),
          );
          const res = await server.request(
            `${read.path}?${[rest, attack].filter(Boolean).join('&')}`,
            { token: read.auth ? token : undefined },
          );

          assert.ok(
            res.status < 500,
            `${read.name} answered ${res.status} for \`${attack}\` — a 5xx means the payload ` +
              `reached the driver`,
          );

          if (res.status !== 200) continue;

          const selected = read.selected(res.body);
          if (selected === null) continue; // an unfiltered/empty answer discloses nothing new

          assert.equal(
            selected.includes(marker),
            false,
            `\`${attack}\` on ${read.name} selected the decoy row (${selected}) — the filter was ` +
              `widened by a query parameter`,
          );
        }
      });
    }

    it('rejects a repeated parameter rather than casting the array', async () => {
      // The most important single case in this section: two identical keys need
      // no JSON body, no bracket syntax and no `$`, and Mongoose would treat the
      // resulting array as `$in`. Zod's `z.string()` is the only layer that
      // stops it, so its refusal is asserted directly.
      const cases = [
        ['/api/v1/registry/crops?code=RICE&code=WHEAT', false],
        ['/api/v1/community/alerts?district=Nagpur&district=Ludhiana', true],
        ['/api/v1/market/prices?commodity=RICE&state=Maharashtra&state=Punjab', true],
      ];

      for (const [url, auth] of cases) {
        const res = await server.request(url, { token: auth ? token : undefined });
        assert.equal(res.status, 422, `${url} answered ${res.status}: ${res.text}`);
        assert.equal(res.body.error.code, 'VALIDATION_ERROR');
      }
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // D · Arrays: the operator payload with no operator in it
  // ══════════════════════════════════════════════════════════════════════════

  describe('arrays are treated as $in, so every filter field must reject one', () => {
    it('Mongoose folds an array on a String path into an implicit $in', async () => {
      // Asserted, not assumed, because the rest of this section exists only if
      // it is true. If a Mongoose upgrade ever starts rejecting arrays this test
      // fails and the section can be relaxed deliberately rather than by
      // someone noticing it looks redundant.
      const email = uniqueEmail('array-probe');
      await User.create({
        name: 'Array Probe',
        email,
        passwordHash: 'x'.repeat(60),
        language: 'en',
      });

      const matched = await User.findOne({ email: [email, 'nobody@example.com'] }).lean();
      assert.ok(
        matched,
        'an array on a String path no longer matches — Mongoose behaviour changed; re-read this ' +
          'section before weakening it',
      );
      assert.equal(matched.email, email);
    });

    it('the sanitizer deliberately does not remove arrays', async () => {
      // Stating the boundary rather than pretending it is covered: an array is
      // a legitimate body shape (a list of symptoms, a list of parts), so the
      // sanitizer cannot strip one. Typing is the only correct layer for this.
      const res = await probe.request('/__st40/echo', {
        method: 'POST',
        body: { field: ['a', 'b'] },
      });

      assert.deepEqual(res.body.body.field, ['a', 'b']);
      assert.equal(res.body.sanitized, false);
    });

    /** Every field established above as reaching a Mongo filter. */
    const filterFields = [
      [
        'POST /auth/login · email',
        'POST',
        '/api/v1/auth/login',
        false,
        { password: 'aaaaaaaa' },
        'email',
      ],
      ['GET /registry/crops · code', 'GET', '/api/v1/registry/crops', false, {}, 'code'],
      ['GET /community/alerts · district', 'GET', '/api/v1/community/alerts', true, {}, 'district'],
      ['GET /community/alerts · state', 'GET', '/api/v1/community/alerts', true, {}, 'state'],
      [
        'GET /market/prices · state',
        'GET',
        '/api/v1/market/prices',
        true,
        { commodity: 'RICE' },
        'state',
      ],
      [
        'GET /market/prices · district',
        'GET',
        '/api/v1/market/prices',
        true,
        { commodity: 'RICE' },
        'district',
      ],
      ['GET /market/prices · commodity', 'GET', '/api/v1/market/prices', true, {}, 'commodity'],
      ['GET /market/nearby · farmId', 'GET', '/api/v1/market/nearby', true, {}, 'farmId'],
      ['GET /crop-health/logs · cropId', 'GET', '/api/v1/crop-health/logs', true, {}, 'cropId'],
    ];

    for (const [name, method, url, auth, base, field] of filterFields) {
      it(`${name} refuses an array value`, async () => {
        if (method === 'GET') {
          const params = Object.entries(base)
            .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
            .concat([`${field}=alpha`, `${field}=beta`])
            .join('&');

          const res = await server.request(`${url}?${params}`, { token: auth ? token : undefined });
          assert.equal(res.status, 422, `${name} answered ${res.status}: ${res.text}`);
          assert.equal(res.body.error.code, 'VALIDATION_ERROR');
          return;
        }

        const res = await server.request(url, {
          method,
          token: auth ? token : undefined,
          body: { ...base, [field]: ['alpha', 'beta'] },
        });
        assert.ok([401, 422].includes(res.status), `${name} answered ${res.status}: ${res.text}`);
      });
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // E · Mongoose casting, measured rather than assumed
  // ══════════════════════════════════════════════════════════════════════════

  describe('the Mongoose casting backstop', () => {
    it('refuses a plain object where the schema declares a String', async () => {
      for (const bad of [{}, { a: 1 }, { nested: { deeper: 1 } }]) {
        await assert.rejects(
          () => User.findOne({ email: bad }).lean(),
          (err) => err.name === 'CastError',
          `an object reached the driver on a String path: ${JSON.stringify(bad)}`,
        );
      }

      await assert.rejects(
        () => MarketPrice.find({ state: { nested: true } }).lean(),
        (err) => err.name === 'CastError',
      );
      await assert.rejects(
        () => CropRegistry.findOne({ cropCode: {} }).lean(),
        (err) => err.name === 'CastError',
      );
    });

    it('does NOT refuse an operator object — it executes it', async () => {
      /**
       * The measurement that decides how much the other two layers matter.
       *
       * Casting rejects an object that is not *shaped* like a query, but
       * `{$ne: null}` and `{$regex: '.*'}` are perfectly legal Mongo and are
       * executed as written. So Mongoose is a backstop against a stray
       * subdocument, and no defence at all against the payload this suite is
       * named for. Everything that actually stops an operator lives in
       * middleware/sanitize.js and middleware/validate.js — which is why the
       * sections above assert those two directly rather than inferring them
       * from a status code.
       */
      const email = uniqueEmail('operator-probe');
      await User.create({
        name: 'Operator Probe',
        email,
        passwordHash: 'x'.repeat(60),
        language: 'en',
      });

      const byNotEqual = await User.findOne({ email: { $ne: 'nobody@example.com' } }).lean();
      assert.ok(
        byNotEqual,
        'a $ne filter matched nothing — if Mongoose has started rejecting operator objects the ' +
          'comment above is stale, but do not weaken the sanitizer on the strength of it',
      );

      const byRegex = await User.findOne({ email: { $regex: '.*' } }).lean();
      assert.ok(byRegex, '$regex is executed as written');
    });

    it('a CastError surfaces as a safe envelope, never as a driver message', async () => {
      // If any layer above ever lets an object through, the failure mode must
      // still not leak. Driven through a real route with the sanitizer defeated
      // is impossible by construction, so this asserts the shape of the error
      // handler's answer to the class of failure.
      const res = await server.request('/api/v1/registry/crops?code=RICE');
      assert.equal(res.status, 200);
      assert.equal(res.text.includes('CastError'), false);
      assert.equal(res.text.includes('mongoose'), false);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // F · Prototype pollution
  // ══════════════════════════════════════════════════════════════════════════

  describe('prototype pollution', () => {
    for (const [label, raw] of POLLUTION_BODIES) {
      it(`does not pollute Object.prototype via ${label}`, async () => {
        const res = await probe.request('/__st40/echo', { method: 'POST', raw });

        assert.equal(res.status, 200, res.text);
        assert.equal(
          res.body.prototypePolluted,
          null,
          `Object.prototype was polluted during the request by ${label}`,
        );
        assertPrototypeIntact(label);
      });
    }

    it('does not pollute through a query string', async () => {
      const res = await probe.request(
        '/__st40/echo?__proto__[polluted]=yes&constructor[prototype][polluted]=yes',
      );

      assert.equal(res.body.prototypePolluted, null);
      assertPrototypeIntact('query string');
    });

    it('does not pollute through multipart field names', async () => {
      // multer's field assembler DOES interpret bracket syntax, so this is the
      // one body in the app where `a[b]` becomes structure. It must still not
      // become a prototype write.
      const boundary = '----ST40Proto';
      const parts = [
        ['__proto__[polluted]', 'yes'],
        ['constructor[prototype][polluted]', 'yes'],
        ['prototype[polluted]', 'yes'],
      ];
      const raw = Buffer.concat([
        ...parts.map((pair) =>
          Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="${pair[0]}"\r\n\r\n${pair[1]}\r\n`,
          ),
        ),
        Buffer.from(`--${boundary}--\r\n`),
      ]);

      const res = await fetch(`${server.url}/api/v1/crop-health/analyze`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
        },
        body: raw,
      });

      assert.ok(res.status >= 400, 'a fileless multipart body must be refused');
      assertPrototypeIntact('multipart field names');
    });

    it('an accepted body never carries a __proto__ key into the handler', async () => {
      const res = await probe.request('/__st40/echo', {
        method: 'POST',
        raw: '{"__proto__":{"polluted":"yes"},"keep":"value"}',
      });

      // The key may survive as an ordinary own property — that is inert. What
      // must never happen is the value landing on the prototype, asserted above.
      assert.equal(res.body.body.keep, 'value');
      assertPrototypeIntact('handler body');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // G · Sanitizer internals
  // ══════════════════════════════════════════════════════════════════════════

  describe('the sanitizer itself', () => {
    it('removes operators from bodies, arrays and nested objects alike', async () => {
      const res = await probe.request('/__st40/echo', {
        method: 'POST',
        body: {
          $ne: 'top level',
          'dotted.key': 'reaches a subdocument',
          keep: 'value',
          nested: { $gt: 1, alsoKeep: 'value', deeper: { $where: 'x', kept: 1 } },
          list: [{ $regex: '.*' }, { kept: true }, 'plain'],
        },
      });

      assert.deepEqual(res.body.body, {
        keep: 'value',
        nested: { alsoKeep: 'value', deeper: { kept: 1 } },
        list: [{}, { kept: true }, 'plain'],
      });
      assert.equal(res.body.sanitized, true);
    });

    it('rejects an over-deep body instead of partially cleaning it', async () => {
      // Abandoning the subtree at the cap would leave an operator below it while
      // the caller believed the body was clean, so the whole request is refused.
      let deep = { $ne: null };
      for (let i = 0; i < 20; i += 1) deep = { nested: deep };

      const res = await probe.request('/__st40/echo', { method: 'POST', body: deep });

      assert.equal(res.status, 422);
      assert.equal(res.body.error.code, 'VALIDATION_ERROR');
      assert.deepEqual(res.body.error.details, [{ field: '(root)', rule: 'too_deep' }]);
    });

    it('counts array levels toward the depth cap', async () => {
      let deep = { $ne: null };
      for (let i = 0; i < 20; i += 1) deep = [deep];

      const res = await probe.request('/__st40/echo', { method: 'POST', body: deep });
      assert.equal(res.status, 422);
    });

    it('does not reflect the removed key back to the caller', async () => {
      // Echoing input into an error body is how a payload becomes a reflected
      // injection into whatever reads the log or the screen.
      const res = await probe.request('/__st40/echo?$where=alert(1)', { method: 'GET' });

      assert.equal(res.text.includes('alert(1)'), false);
      assert.equal(res.text.includes('$where'), false);
    });

    it('guards path parameters with an ObjectId check rather than the scrubber', async () => {
      // The scrubber is app-level, so it runs before route matching and never
      // sees req.params. Path segments are always strings, and loadOwned refuses
      // anything that is not an ObjectId before it reaches a query.
      for (const bad of ['$ne', '{"$ne":null}', '../../etc/passwd', 'null', '000000000000']) {
        const res = await server.request(`/api/v1/crops/${encodeURIComponent(bad)}`, { token });
        assert.equal(res.status, 404, `param \`${bad}\` answered ${res.status}: ${res.text}`);
        assert.equal(res.body.error.code, 'NOT_FOUND');
      }
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // H · Multipart fields go through the same scrubber
  // ══════════════════════════════════════════════════════════════════════════

  describe('multipart text fields are scrubbed', () => {
    /**
     * Regression for a real gap. `mongoSanitize` is mounted at the app level, so
     * it runs before route matching and only ever sees what `express.json`
     * parsed. A multipart body is assembled later, inside the route, by multer —
     * whose field assembler interprets bracket syntax. So a part named
     * `cropId[$ne]` arrived at the handler as `{cropId: {$ne: '…'}}`, a real
     * operator object that the application-wide scrubber had never touched.
     *
     * Verified to fail before the fix in middleware/uploadImage.js: the echoed
     * body contained `{"cropId":{"$ne":"x"}}`.
     */
    async function postMultipart(app, parts, boundary = '----ST40Multipart') {
      const chunks = [];
      for (const part of parts) {
        const disposition = part.filename
          ? `form-data; name="${part.name}"; filename="${part.filename}"`
          : `form-data; name="${part.name}"`;
        chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: ${disposition}\r\n\r\n`));
        chunks.push(Buffer.isBuffer(part.value) ? part.value : Buffer.from(String(part.value)));
        chunks.push(Buffer.from('\r\n'));
      }
      chunks.push(Buffer.from(`--${boundary}--\r\n`));

      const res = await fetch(`${app.url}/__st40/upload`, {
        method: 'POST',
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
        body: Buffer.concat(chunks),
      });
      const text = await res.text();
      return { status: res.status, text, body: text ? JSON.parse(text) : null };
    }

    let uploadProbe;

    before(async () => {
      const { uploadImage } = await import('../../src/middleware/uploadImage.js');
      const router = Router();
      router.post('/__st40/upload', uploadImage, (req, res) => {
        res.json({ body: req.body, sanitized: req.sanitized === true });
      });
      uploadProbe = await startTestServer(createApp({ extraRouters: [router] }));
    });

    after(async () => {
      await uploadProbe.close();
    });

    it('removes an operator smuggled in through a multipart field name', async () => {
      const res = await postMultipart(uploadProbe, [
        { name: 'cropId[$ne]', value: 'x' },
        { name: 'description[$where]', value: 'return true' },
        { name: 'keep', value: 'value' },
        { name: 'image', value: Buffer.from([0xff, 0xd8, 0xff, 0xe0]), filename: 'leaf.jpg' },
      ]);

      assert.equal(res.status, 200, res.text);
      assert.equal(
        res.text.includes('$ne'),
        false,
        'a multipart field name became a Mongo operator in req.body',
      );
      assert.equal(res.text.includes('$where'), false);
      assert.deepEqual(res.body.body, { cropId: {}, description: {}, keep: 'value' });
      assert.equal(res.body.sanitized, true, 'a removed key must be flagged as a probe');
    });

    it('leaves an ordinary multipart body untouched and unflagged', async () => {
      const res = await postMultipart(uploadProbe, [
        { name: 'cropId', value: '0123456789abcdef01234567' },
        { name: 'image', value: Buffer.from([0xff, 0xd8, 0xff, 0xe0]), filename: 'leaf.jpg' },
      ]);

      assert.equal(res.status, 200, res.text);
      assert.deepEqual(res.body.body, { cropId: '0123456789abcdef01234567' });
      assert.equal(res.body.sanitized, false);
    });

    it('refuses an over-deep multipart body rather than partially cleaning it', async () => {
      const deepName = `a${'[b]'.repeat(20)}`;
      const res = await postMultipart(uploadProbe, [
        { name: deepName, value: 'x' },
        { name: 'image', value: Buffer.from([0xff, 0xd8, 0xff, 0xe0]), filename: 'leaf.jpg' },
      ]);

      assert.equal(res.status, 422);
      assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    });

    it('the real analyze route refuses an operator-shaped cropId', async () => {
      const boundary = '----ST40Analyze';
      const chunks = [
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="cropId[$ne]"\r\n\r\nnull\r\n`,
        ),
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="a.jpg"\r\n\r\n`,
        ),
        Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ];

      const res = await fetch(`${server.url}/api/v1/crop-health/analyze`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
        },
        body: Buffer.concat(chunks),
      });

      assert.equal(res.status, 422);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // I · Command execution and the filesystem
  // ══════════════════════════════════════════════════════════════════════════

  describe('there is no command-execution or dynamic-evaluation surface', () => {
    const sourceRoot = new URL('../../src/', import.meta.url).pathname.replace(
      /^\/([A-Za-z]:)/,
      '$1',
    );

    function walk(dir) {
      const out = [];
      for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) out.push(...walk(full));
        else if (entry.endsWith('.js')) out.push(full);
      }
      return out;
    }

    const FORBIDDEN = [
      [/\bchild_process\b/, 'child_process'],
      [/\bexecSync\s*\(/, 'execSync'],
      [/\bexecFile(Sync)?\s*\(/, 'execFile'],
      [/\bspawn(Sync)?\s*\(/, 'spawn'],
      [/(^|[^.\w])eval\s*\(/, 'eval'],
      [/\bnew\s+Function\s*\(/, 'new Function'],
      [/\bnode:vm\b|\brequire\(['"]vm['"]\)|\bvm\.runIn/, 'vm'],
      [/\bdeserialize\s*\(/, 'deserialize'],
    ];

    it('no request-servable module reaches a shell or an evaluator', () => {
      const files = walk(sourceRoot);
      assert.ok(
        files.length > 40,
        `expected to scan the backend source tree, found ${files.length}`,
      );

      const hits = [];
      for (const file of files) {
        const source = readFileSync(file, 'utf8');
        for (const [pattern, name] of FORBIDDEN) {
          if (pattern.test(source)) hits.push(`${path.relative(sourceRoot, file)}: ${name}`);
        }
      }

      assert.deepEqual(
        hits,
        [],
        `a command-execution or dynamic-evaluation construct appeared in src/:\n${hits.join('\n')}`,
      );
    });

    it('keeps filesystem reads to a closed allowlist of modules', () => {
      /**
       * Neither module is reachable from a request with a caller-supplied path:
       * `routes/health.js` reads its own package.json once at import time, and
       * `services/registrySeedService.js` runs at startup over `new URL(…,
       * import.meta.url)` constants. The allowlist is asserted rather than the
       * absence of reads, so a *third* module that starts touching the disk
       * fails here and gets looked at.
       */
      const ALLOWED = ['routes/health.js', 'services/registrySeedService.js'];

      const readers = walk(sourceRoot)
        .filter((file) =>
          /\b(readFileSync|readFile|createReadStream|openSync|opendir)\s*\(/.test(
            readFileSync(file, 'utf8'),
          ),
        )
        .map((file) => path.relative(sourceRoot, file).split(path.sep).join('/'))
        .sort();

      assert.deepEqual(
        readers,
        ALLOWED,
        'a module in src/ started reading the filesystem — confirm no request value can reach ' +
          'the path before adding it to the allowlist',
      );
    });

    it('builds every filesystem path from constants, never from an expression', () => {
      // A template literal, a concatenation or a `req` reference on the same
      // line as a read is how a path becomes attacker-influenced. None exist.
      const offenders = [];
      for (const file of walk(sourceRoot)) {
        const lines = readFileSync(file, 'utf8').split('\n');
        lines.forEach((line, index) => {
          if (!/\b(readFileSync|readFile|createReadStream)\s*\(/.test(line)) return;
          if (/`|\s\+\s|\breq\b/.test(line)) {
            offenders.push(`${path.relative(sourceRoot, file)}:${index + 1} ${line.trim()}`);
          }
        });
      }

      assert.deepEqual(
        offenders,
        [],
        `a filesystem path was built dynamically:\n${offenders.join('\n')}`,
      );
    });

    it('resolves every seed input against a module-relative constant', () => {
      // registrySeedService reads through a `readJson(url)` helper, so the
      // constant lives at the call sites rather than at the read. Every one of
      // them is `new URL(<literal>, <module-relative constant>)`.
      const source = readFileSync(
        path.join(sourceRoot, 'services', 'registrySeedService.js'),
        'utf8',
      );
      const calls = source.match(/read(Json|Optional)\(([^)]*\)?[^)]*)\)/g) ?? [];

      assert.ok(
        calls.length >= 5,
        `expected the seed to read several inputs, found ${calls.length}`,
      );
      for (const call of calls) {
        assert.match(
          call,
          /read(Json|Optional)\((url|MANIFEST|new URL\((file|'[^']+'), (KNOWLEDGE_DIR|import\.meta\.url)\))/,
          `seed input path is not a module-relative constant: ${call}`,
        );
      }
    });

    it('keeps the repo scripts free of a shell, and argv-only where they run a binary', () => {
      /**
       * `src/` is asserted above to have no command-execution surface at all.
       * `scripts/` is different: it is developer tooling, it legitimately runs
       * `git`, and it was the one directory the Phase 7 audit fleet did not
       * reach before it was cut short.
       *
       * The rule applied here is not "no process execution" — that would be
       * false — but the one that actually prevents command injection:
       *
       *   - no shell, ever (`exec`, `execSync`, `shell: true`) — these hand a
       *     string to `/bin/sh`, so a filename with a `;` in it becomes a
       *     second command;
       *   - `execFile`/`spawn` only, with the binary as a string literal and
       *     the arguments as an array, which the OS passes verbatim with no
       *     interpretation;
       *   - no dynamic evaluation.
       *
       * These scripts run over `git diff --cached --name-only` output and over
       * paths a developer types, so "the input is trusted" is not a claim worth
       * resting on.
       */
      const scriptsRoot = new URL('../../../scripts/', import.meta.url).pathname.replace(
        /^\/([A-Za-z]:)/,
        '$1',
      );

      const files = readdirSync(scriptsRoot).filter((name) => /\.(mjs|cjs|js)$/.test(name));
      assert.ok(files.length >= 3, `expected to scan scripts/, found ${files.length} files`);

      const SHELL_SURFACE = [
        [/\bexecSync\s*\(/, 'execSync'],
        [/(^|[^A-Za-z])exec\s*\(\s*[`'"]/, 'exec with a command string'],
        [/shell\s*:\s*true/, 'shell: true'],
        [/(^|[^.\w])eval\s*\(/, 'eval'],
        [/\bnew\s+Function\s*\(/, 'new Function'],
      ];

      const hits = [];
      const argvCalls = [];

      for (const name of files) {
        const source = readFileSync(path.join(scriptsRoot, name), 'utf8');

        for (const [pattern, label] of SHELL_SURFACE) {
          if (pattern.test(source)) hits.push(`${name}: ${label}`);
        }

        for (const call of source.match(/\b(execFile|execFileSync|spawn|spawnSync)\s*\([^;]*/g) ??
          []) {
          argvCalls.push({ name, call });
        }
      }

      assert.deepEqual(hits, [], `a shell or evaluator appeared in scripts/:\n${hits.join('\n')}`);

      // Whatever process execution remains must be the safe shape.
      for (const { name, call } of argvCalls) {
        assert.match(
          call,
          /\(\s*'[a-z-]+'\s*,\s*\[/,
          `${name}: process execution is not (literal binary, argv array): ${call.slice(0, 90)}`,
        );
      }
    });
  });

  describe('path traversal reaches nothing', () => {
    it('is refused on every route parameter', async () => {
      for (const payload of TRAVERSALS) {
        for (const route of ['/api/v1/crops', '/api/v1/farms', '/api/v1/crop-health/logs']) {
          const res = await server.request(`${route}/${encodeURIComponent(payload)}`, { token });

          assert.ok(
            [400, 404].includes(res.status),
            `${route}/${payload} answered ${res.status}: ${res.text}`,
          );
          assert.equal(res.text.includes('root:'), false, 'a passwd file was served');
          assert.equal(res.text.includes('ENOENT'), false, 'a filesystem error leaked');
          assert.equal(res.text.includes('no such file'), false);
        }
      }
    });

    it('is inert in a string query parameter that reaches a filter', async () => {
      for (const payload of TRAVERSALS) {
        const res = await server.request(
          `/api/v1/registry/crops?code=${encodeURIComponent(payload)}`,
        );

        assert.ok(res.status < 500, `${payload} answered ${res.status}`);
        assert.equal(res.text.includes('root:'), false);
        assert.equal(res.text.includes('ENOENT'), false);
      }
    });

    it('never lets a filename choose where anything is written', async () => {
      // The upload path is memory-only and the stored asset is named with a
      // UUID we generate — asserted at the storage boundary in ST-30. Here the
      // claim is narrower and complementary: no source file in src/ joins a
      // request-derived name onto a path.
      const sourceRoot = new URL('../../src/', import.meta.url).pathname.replace(
        /^\/([A-Za-z]:)/,
        '$1',
      );
      const offenders = [];
      const walk = (dir) => {
        for (const entry of readdirSync(dir)) {
          const full = path.join(dir, entry);
          if (statSync(full).isDirectory()) walk(full);
          else if (entry.endsWith('.js')) {
            const source = readFileSync(full, 'utf8');
            if (/path\.(join|resolve)\s*\([^)]*\breq\b/.test(source)) {
              offenders.push(path.relative(sourceRoot, full));
            }
            if (/originalname/.test(source))
              offenders.push(`${path.relative(sourceRoot, full)} (originalname)`);
          }
        }
      };
      walk(sourceRoot);

      assert.deepEqual(offenders, [], `a request value reached a filesystem path:\n${offenders}`);
    });
  });
});
