/**
 * Post-deploy smoke test — read-only, safe to run against production.
 *
 * Checks the things a deploy can silently get wrong: the service is up, the
 * database is actually connected (not merely "the process started"), security
 * headers survived the proxy, the error envelope is intact, and no internals
 * leak. It creates nothing and mutates nothing.
 *
 *   node scripts/smoke.mjs https://him-1096-backend-staging.onrender.com
 */
const baseUrl = (process.argv[2] ?? '').replace(/\/$/, '');

if (!baseUrl) {
  console.error('Usage: node scripts/smoke.mjs <base-url>');
  process.exit(2);
}

const results = [];
const check = (name, passed, detail = '') => {
  results.push({ name, passed, detail });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

async function get(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, { redirect: 'manual', ...options });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { response, text, json };
}

// Free-tier instances sleep; the first request can take ~50s to wake one.
console.log(`Smoke testing ${baseUrl} (cold start may take up to 60s)\n`);

try {
  const health = await get('/healthz');
  check('healthz responds 200', health.response.status === 200, `status ${health.response.status}`);
  check('healthz reports ok', health.json?.status === 'ok', JSON.stringify(health.json ?? {}));
  check(
    'database is connected',
    health.json?.db === 'connected',
    `db=${health.json?.db ?? 'absent'}`,
  );
  check('version is reported', Boolean(health.json?.version), health.json?.version ?? '');

  // Nothing internal may appear in a public probe.
  check(
    'healthz leaks no internals',
    !/mongodb\+srv|onrender-internal|password|secret/i.test(health.text),
  );

  const headers = health.response.headers;
  check('nosniff header present', headers.get('x-content-type-options') === 'nosniff');
  check('CSP header present', Boolean(headers.get('content-security-policy')));
  check('x-powered-by suppressed', headers.get('x-powered-by') === null);
  check('correlation id issued', Boolean(headers.get('x-request-id')));

  const unknown = await get('/api/v1/definitely-not-a-route');
  check('unknown route returns 404', unknown.response.status === 404);
  check(
    'unknown route uses the canonical envelope',
    unknown.json?.success === false && unknown.json?.error?.code === 'NOT_FOUND',
    unknown.text.slice(0, 120),
  );
  check('unknown route is not HTML', !unknown.text.includes('<html'));

  const unauthorized = await get('/api/v1/auth/me');
  check('protected route rejects anonymous callers', unauthorized.response.status === 401);
  check(
    'auth failure is generic',
    unauthorized.json?.error?.code === 'AUTHENTICATION_ERROR',
    unauthorized.json?.error?.messageKey ?? '',
  );

  const registry = await get('/api/v1/registry/crops');
  check('registry is served', registry.response.status === 200);
  check(
    'registry is seeded',
    Array.isArray(registry.json?.data?.crops) && registry.json.data.crops.length > 0,
    `${registry.json?.data?.crops?.length ?? 0} crops`,
  );
  check('registry sets a cache validator', Boolean(registry.response.headers.get('etag')));

  const foreignOrigin = await get('/healthz', { headers: { Origin: 'https://evil.example' } });
  check(
    'foreign origin is not granted CORS access',
    foreignOrigin.response.headers.get('access-control-allow-origin') === null,
  );
} catch (err) {
  check('reachable', false, err.message);
}

const failed = results.filter((result) => !result.passed);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
process.exit(failed.length === 0 ? 0 : 1);
