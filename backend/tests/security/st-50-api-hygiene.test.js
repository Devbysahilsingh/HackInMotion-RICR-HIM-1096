/**
 * ST-50 — API hygiene [blocking].
 *
 * docs/security/security-testing.md, verbatim:
 *   "stack-trace absence on forced 500; unknown route envelope; CORS reject
 *    foreign origin; rate-limit headers; oversized JSON body 413."
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Router } from 'express';

import { createApp } from '../../src/app.js';
import { startTestServer } from '../helpers/app.js';

/** A route that throws, so the terminal error handler is genuinely exercised. */
const boomRouter = Router();
boomRouter.get('/__test/boom', () => {
  const err = new Error('database connection string mongodb+srv://user:hunter2@cluster.example'); // pragma: allowlist-secret — fabricated value, exists only to prove it is never leaked
  err.internalPath = 'C:/secret/path/service.js';
  throw err;
});

describe('ST-50 · API hygiene', () => {
  let server;

  before(async () => {
    server = await startTestServer(createApp({ extraRouters: [boomRouter] }));
  });

  after(async () => {
    await server.close();
  });

  it('ST-50.1 · a forced 500 leaks no stack, message or internal detail', async () => {
    const res = await server.request('/__test/boom');

    assert.equal(res.status, 500);
    assert.deepEqual(res.body.error, {
      code: 'INTERNAL_ERROR',
      messageKey: 'errors.internal',
    });
    assert.equal(res.body.success, false);

    // Nothing from the thrown error may appear anywhere in the response.
    const raw = res.text;
    for (const forbidden of [
      'mongodb+srv',
      'hunter2',
      'C:/secret',
      '.js:',
      'at Object',
      'Error:',
    ]) {
      assert.ok(!raw.includes(forbidden), `response leaked ${forbidden}: ${raw}`);
    }
    assert.ok(!('stack' in (res.body.error ?? {})));
  });

  it('ST-50.2 · unknown route returns the canonical envelope, not Express HTML', async () => {
    const res = await server.request('/api/v1/no-such-route');

    assert.equal(res.status, 404);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.code, 'NOT_FOUND');
    assert.equal(res.body.error.messageKey, 'errors.routeNotFound');
    assert.ok(!res.text.includes('<html'), 'served Express HTML instead of the envelope');
  });

  it('ST-50.3 · a foreign origin is not granted CORS access', async () => {
    const foreign = await server.request('/healthz', {
      headers: { Origin: 'https://evil.example' },
    });
    assert.equal(
      foreign.headers.get('access-control-allow-origin'),
      null,
      'foreign origin was granted access',
    );

    // Control: the configured origin still is, or the assertion above proves nothing.
    const allowed = await server.request('/healthz', {
      headers: { Origin: 'http://localhost:5173' },
    });
    assert.equal(allowed.headers.get('access-control-allow-origin'), 'http://localhost:5173');
  });

  it('ST-50.4 · credentials are granted only on the auth path', async () => {
    const general = await server.request('/healthz', {
      headers: { Origin: 'http://localhost:5173' },
    });
    assert.equal(general.headers.get('access-control-allow-credentials'), null);

    const authPath = await server.request('/api/v1/auth/login', {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:5173',
        'Access-Control-Request-Method': 'POST',
      },
    });
    assert.equal(authPath.headers.get('access-control-allow-credentials'), 'true');
  });

  it('ST-50.5 · rate-limit headers are present', async () => {
    process.env.RATE_LIMITS_ENABLED = 'true';
    try {
      const res = await server.request('/healthz');
      assert.ok(res.headers.get('ratelimit') || res.headers.get('ratelimit-limit'));
      assert.ok(res.headers.get('ratelimit-policy'));
    } finally {
      delete process.env.RATE_LIMITS_ENABLED;
    }
  });

  it('ST-50.6 · an oversized JSON body is rejected with 413, not 500', async () => {
    const oversized = JSON.stringify({ blob: 'x'.repeat(200 * 1024) });
    const res = await server.request('/api/v1/no-such-route', { method: 'POST', raw: oversized });

    assert.equal(res.status, 413);
    assert.equal(res.body.error.code, 'PAYLOAD_TOO_LARGE');
    assert.equal(res.body.error.messageKey, 'errors.payloadTooLarge');
  });

  it('ST-50.7 · malformed JSON is a 422, not an unhandled 500', async () => {
    const res = await server.request('/api/v1/no-such-route', {
      method: 'POST',
      raw: '{"broken": ',
    });

    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  });

  it('ST-50.10 · a malformed refresh cookie is rejected, not a 500', async () => {
    // /auth/refresh needs no token, so an unhandled throw here would let an
    // anonymous caller write a stack trace to the log on every request.
    for (const cookie of ['rt=%', 'rt=%E0%A4', 'rt=%zz']) {
      const res = await server.request('/api/v1/auth/refresh', {
        method: 'POST',
        headers: { Cookie: cookie },
        body: {},
      });

      assert.equal(res.status, 401, `cookie ${cookie} produced ${res.status}`);
      assert.equal(res.body.error.code, 'AUTHENTICATION_ERROR');
    }
  });

  it('ST-50.11 · an absurdly nested body is rejected rather than partly sanitized', async () => {
    let payload = { $ne: null };
    for (let depth = 0; depth < 40; depth += 1) payload = { nested: payload };

    const res = await server.request('/api/v1/auth/login', { method: 'POST', body: payload });

    assert.ok([422, 401].includes(res.status), `unexpected ${res.status}: ${res.text}`);
    assert.ok(!res.text.includes('stack'));
  });

  it('ST-50.8 · every response carries a correlation id', async () => {
    const res = await server.request('/healthz');
    assert.match(res.headers.get('x-request-id') ?? '', /^[\w-]{8,64}$/);

    const errorRes = await server.request('/api/v1/no-such-route');
    assert.equal(errorRes.body.meta.requestId, errorRes.headers.get('x-request-id'));
  });

  it('ST-50.9 · hardened headers are applied', async () => {
    const res = await server.request('/healthz');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.ok(res.headers.get('content-security-policy'));
    assert.equal(res.headers.get('x-powered-by'), null);
  });

  // ── ST-50.12 · Nothing personal may be written down by a cache ────────────

  describe('ST-50.12 · cache directives', () => {
    /**
     * Found by the ZAP baseline, which flagged "Storable and Cacheable Content".
     * Express attaches a weak ETag to every JSON response, and a 200 with a
     * validator but no freshness directive is heuristically cacheable
     * (RFC 9111 §4.2.2) — so a farmer's dashboard could be written to a browser
     * disk cache and re-rendered by the next person to use the handset, with no
     * token involved.
     */
    it('marks API responses no-store, whatever the status', async () => {
      // Includes error and unauthenticated responses: a 401 body is small, but
      // a cached 401 on a route that should now succeed is its own bug.
      for (const path of ['/api/v1/no-such-route', '/api/v1/farms', '/api/v1/dashboard']) {
        const res = await server.request(path);
        assert.equal(
          res.headers.get('cache-control'),
          'no-store',
          `${path} did not forbid caching (${res.status})`,
        );
      }
    });

    // The blanket rule must not cost the offline story: the crop registry is
    // prefetched by both clients and is explicitly "1h server ETag + 7d client
    // cache" (docs/api/crops.md), so it overrides the default. That the
    // override still wins is asserted in tests/api/registry.test.js, which has
    // a database — this suite deliberately runs without one, and a registry
    // read here would 500 before reaching the header.

    it('leaves the liveness probe alone', async () => {
      // /healthz is infrastructure and sits outside the API prefix, so the
      // middleware must not reach it — asserted so the mount point stays where
      // it is meant to be.
      const res = await server.request('/healthz');
      assert.equal(res.headers.get('cache-control'), null);
    });
  });
});
