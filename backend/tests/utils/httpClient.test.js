/**
 * Outbound HTTP boundary — timeout, retry policy and key redaction.
 *
 * Every case is driven through the `fetchImpl` seam, so this suite opens no
 * socket, consumes no provider quota and does not depend on a network being
 * reachable (docs/testing/api-testing.md: integrations are stubbed, jobs are
 * invoked directly). The timeout case uses a real 25ms deadline rather than a
 * fake timer — ADR-022 leaves this project without any, deliberately.
 *
 * The redaction assertions are the ST-70 contract restated at the source: an
 * `appid=` in a query string must not survive into an error, a message or a
 * log line, so the tests below look for the literal secret and require it to
 * be absent rather than trusting that `safeUrl` was called.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { failureInjected, injectedDelayMs } from '../../src/config/failureFlags.js';
import { fetchJson, PROVIDER_FAILURE, ProviderError, safeUrl } from '../../src/utils/httpClient.js';

// ── Stubs ───────────────────────────────────────────────────────────────────

/**
 * Wraps a handler so "did it retry?" is an assertion over recorded calls
 * rather than an inference from timing.
 */
function countingFetch(handler) {
  const calls = [];
  const impl = (url, init) => {
    calls.push({ url, init });
    return handler(url, init, calls.length);
  };
  impl.calls = calls;
  return impl;
}

const jsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

/** A response the client must not retry or must retry, depending on status. */
const statusResponse = (status) => ({ ok: false, status, json: async () => ({ detail: 'nope' }) });

/** Never settles until the caller's AbortController fires. */
const hangs =
  () =>
  (url, { signal }) =>
    new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        reject(err);
      });
    });

const URL_UNDER_TEST = 'https://api.example.test/v1/forecast?lat=21.1&lon=79.1';

/** Asserts the rejection is a ProviderError carrying exactly `reason`. */
const rejectsWith =
  (reason, extra = {}) =>
  (err) => {
    assert.ok(err instanceof ProviderError, `expected a ProviderError, got ${err?.name}`);
    assert.equal(err.reason, reason);
    for (const [field, value] of Object.entries(extra)) assert.equal(err[field], value);
    return true;
  };

// ── Timeout ─────────────────────────────────────────────────────────────────

describe('fetchJson · every request is bounded by a timeout', () => {
  it('aborts a hung provider and reports the coarse reason "timeout"', async () => {
    const impl = countingFetch(hangs());

    await assert.rejects(
      () =>
        fetchJson(URL_UNDER_TEST, {
          provider: 'open-meteo',
          timeoutMs: 25,
          retries: 0,
          fetchImpl: impl,
        }),
      rejectsWith(PROVIDER_FAILURE.TIMEOUT, { provider: 'open-meteo' }),
    );

    assert.equal(impl.calls.length, 1);
  });

  it('passes an AbortSignal to every attempt, so no call path is unbounded', async () => {
    const impl = countingFetch(() => jsonResponse({ ok: true }));
    await fetchJson(URL_UNDER_TEST, { provider: 'open-meteo', retries: 0, fetchImpl: impl });

    assert.ok(impl.calls[0].init.signal instanceof AbortSignal);
    assert.equal(impl.calls[0].init.method, 'GET');
    assert.equal(impl.calls[0].init.headers.Accept, 'application/json');
  });

  it('retries a timeout when retries remain, then gives up with "timeout"', async () => {
    const impl = countingFetch(hangs());

    await assert.rejects(
      () =>
        fetchJson(URL_UNDER_TEST, {
          provider: 'open-meteo',
          timeoutMs: 15,
          retries: 1,
          retryDelayMs: 1,
          fetchImpl: impl,
        }),
      rejectsWith(PROVIDER_FAILURE.TIMEOUT),
    );

    assert.equal(impl.calls.length, 2);
  });
});

// ── Retry policy ────────────────────────────────────────────────────────────

describe('fetchJson · retry policy distinguishes our fault from theirs', () => {
  it('does NOT retry a 4xx — the request itself is wrong, and quota is finite', async () => {
    const impl = countingFetch(() => statusResponse(404));

    await assert.rejects(
      () =>
        fetchJson(URL_UNDER_TEST, {
          provider: 'openweathermap',
          // Retries are explicitly available: the single call below is the
          // policy refusing to use them, not the absence of a budget.
          retries: 2,
          retryDelayMs: 1,
          fetchImpl: impl,
        }),
      rejectsWith(PROVIDER_FAILURE.HTTP_STATUS, { status: 404 }),
    );

    assert.equal(impl.calls.length, 1, 'a 4xx was retried');
  });

  it('does not retry 400, 401 or 403 either', async () => {
    for (const status of [400, 401, 403]) {
      const impl = countingFetch(() => statusResponse(status));

      await assert.rejects(
        () =>
          fetchJson(URL_UNDER_TEST, {
            provider: 'openweathermap',
            retries: 2,
            retryDelayMs: 1,
            fetchImpl: impl,
          }),
        rejectsWith(PROVIDER_FAILURE.HTTP_STATUS, { status }),
      );

      assert.equal(impl.calls.length, 1, `${status} was retried`);
    }
  });

  it('DOES retry a 5xx and then throws the status failure', async () => {
    const impl = countingFetch(() => statusResponse(503));

    await assert.rejects(
      () =>
        fetchJson(URL_UNDER_TEST, {
          provider: 'open-meteo',
          retries: 1,
          retryDelayMs: 1,
          fetchImpl: impl,
        }),
      rejectsWith(PROVIDER_FAILURE.HTTP_STATUS, { status: 503 }),
    );

    assert.equal(impl.calls.length, 2, 'a 5xx was not retried');
  });

  it('retries a 429 — a rate limit is a "come back later", not a bad request', async () => {
    const impl = countingFetch(() => statusResponse(429));

    await assert.rejects(
      () =>
        fetchJson(URL_UNDER_TEST, {
          provider: 'open-meteo',
          retries: 2,
          retryDelayMs: 1,
          fetchImpl: impl,
        }),
      rejectsWith(PROVIDER_FAILURE.HTTP_STATUS, { status: 429 }),
    );

    assert.equal(impl.calls.length, 3);
  });

  it('returns the body as soon as an attempt succeeds', async () => {
    const impl = countingFetch((url, init, attempt) =>
      attempt === 1 ? statusResponse(502) : jsonResponse({ daily: { time: ['2026-08-13'] } }),
    );

    const body = await fetchJson(URL_UNDER_TEST, {
      provider: 'open-meteo',
      retries: 2,
      retryDelayMs: 1,
      fetchImpl: impl,
    });

    assert.deepEqual(body, { daily: { time: ['2026-08-13'] } });
    assert.equal(impl.calls.length, 2, 'kept retrying after a success');
  });

  it('classifies a transport failure as "network" and retries it', async () => {
    const impl = countingFetch(() => {
      throw new TypeError('fetch failed');
    });

    await assert.rejects(
      () =>
        fetchJson(URL_UNDER_TEST, {
          provider: 'open-meteo',
          retries: 2,
          retryDelayMs: 1,
          fetchImpl: impl,
        }),
      rejectsWith(PROVIDER_FAILURE.NETWORK),
    );

    assert.equal(impl.calls.length, 3);
  });
});

// ── Malformed bodies ────────────────────────────────────────────────────────

describe('fetchJson · a 200 that is not JSON', () => {
  it('reports "malformed_body" rather than leaking the parse error', async () => {
    const impl = countingFetch(() => ({
      ok: true,
      status: 200,
      // What a captive portal or an upstream outage page actually produces.
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON at position 0');
      },
    }));

    await assert.rejects(
      () =>
        fetchJson(URL_UNDER_TEST, {
          provider: 'open-meteo',
          retries: 2,
          retryDelayMs: 1,
          fetchImpl: impl,
        }),
      rejectsWith(PROVIDER_FAILURE.MALFORMED_BODY),
    );

    // Repeating the request cannot change an HTML outage page into JSON.
    assert.equal(impl.calls.length, 1, 'a malformed body was retried');
  });

  it('keeps the parse error as `cause` but out of the message', async () => {
    const impl = countingFetch(() => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('<!DOCTYPE html> is not valid JSON');
      },
    }));

    const err = await fetchJson(URL_UNDER_TEST, {
      provider: 'open-meteo',
      retries: 0,
      fetchImpl: impl,
    }).catch((caught) => caught);

    assert.equal(err.reason, PROVIDER_FAILURE.MALFORMED_BODY);
    assert.equal(err.message, 'open-meteo: malformed_body');
    assert.ok(err.cause instanceof SyntaxError);
    assert.ok(!err.message.includes('DOCTYPE'), 'upstream prose reached the message');
  });
});

// ── Redaction ───────────────────────────────────────────────────────────────

describe('safeUrl · the query string is where the keys live', () => {
  // Fabricated value; it exists only so the assertion below can prove it is
  // never echoed. pragma: allowlist-secret
  const KEY = 'aaaaaaaabbbbbbbbccccccccdddddddd';
  const withKey = `https://api.openweathermap.org/data/2.5/forecast?lat=21.1&lon=79.1&appid=${KEY}`;

  it('keeps host and path and drops everything after them', () => {
    assert.equal(safeUrl(withKey), 'api.openweathermap.org/data/2.5/forecast');
  });

  it('never emits the key, in any form', () => {
    const output = safeUrl(withKey);

    assert.ok(!output.includes(KEY), 'the api key survived redaction');
    assert.ok(!output.includes('appid'), 'the parameter name survived redaction');
    assert.ok(!output.includes('?'), 'a query string survived redaction');
  });

  it('drops a fragment and userinfo as well as the query', () => {
    assert.equal(safeUrl('https://api.example.test/a/b?k=1#frag'), 'api.example.test/a/b');
    assert.ok(!safeUrl(`https://user:${KEY}@api.example.test/a`).includes(KEY));
  });

  it('keeps a non-default port, which is host information rather than a secret', () => {
    assert.equal(safeUrl('http://127.0.0.1:4000/healthz?x=1'), '127.0.0.1:4000/healthz');
  });

  it('answers a fixed placeholder for anything unparseable, never the input', () => {
    for (const value of ['not a url', '', null, undefined, 42, `????${KEY}`]) {
      const output = safeUrl(value);
      assert.equal(output, '(unparseable url)');
      assert.ok(!output.includes(KEY));
    }
  });

  it('a ProviderError carries no url at all', () => {
    const err = new ProviderError('openweathermap', PROVIDER_FAILURE.HTTP_STATUS, { status: 401 });

    assert.equal(err.message, 'openweathermap: http_status (401)');
    assert.ok(!JSON.stringify({ ...err, message: err.message }).includes(KEY));
  });
});

// ── Failure injection (docs/testing/resilience-testing.md) ───────────────────

describe('failure-injection flags are routing-only and non-production', () => {
  it('fails a provider before any socket is opened', async () => {
    const impl = countingFetch(() => jsonResponse({}));
    process.env.FORCE_FAIL_OPENMETEO = 'true';

    try {
      await assert.rejects(
        () => fetchJson(URL_UNDER_TEST, { provider: 'open-meteo', fetchImpl: impl }),
        rejectsWith(PROVIDER_FAILURE.INJECTED),
      );
    } finally {
      delete process.env.FORCE_FAIL_OPENMETEO;
    }

    assert.equal(impl.calls.length, 0, 'an injected failure still called the provider');
  });

  it('is keyed on the provider id, so one flag cannot fail another provider', async () => {
    const impl = countingFetch(() => jsonResponse({ list: [] }));
    process.env.FORCE_FAIL_OPENMETEO = 'true';

    try {
      const body = await fetchJson(URL_UNDER_TEST, {
        provider: 'openweathermap',
        retries: 0,
        fetchImpl: impl,
      });
      assert.deepEqual(body, { list: [] });
    } finally {
      delete process.env.FORCE_FAIL_OPENMETEO;
    }
  });

  it('honours FORCE_FAIL_WEATHER as "both weather providers"', () => {
    const source = { FORCE_FAIL_WEATHER: 'true' };

    assert.equal(failureInjected('open-meteo', source), true);
    assert.equal(failureInjected('openweathermap', source), true);
    assert.equal(failureInjected('datagovin', source), false);
  });

  it('reads only the exact string "true", and only for a known provider', () => {
    assert.equal(failureInjected('open-meteo', { FORCE_FAIL_OPENMETEO: '1' }), false);
    assert.equal(failureInjected('open-meteo', { FORCE_FAIL_OPENMETEO: 'TRUE' }), false);
    assert.equal(failureInjected('gemini', { FORCE_FAIL_GEMINI: 'true' }), false);
    assert.equal(failureInjected('open-meteo', {}), false);
  });

  it('reads a slow flag as a positive number of milliseconds, or zero', () => {
    assert.equal(injectedDelayMs('open-meteo', { FORCE_SLOW_OPENMETEO: '250' }), 250);
    assert.equal(injectedDelayMs('open-meteo', { FORCE_SLOW_OPENMETEO: '0' }), 0);
    assert.equal(injectedDelayMs('open-meteo', { FORCE_SLOW_OPENMETEO: '-5' }), 0);
    assert.equal(injectedDelayMs('open-meteo', { FORCE_SLOW_OPENMETEO: 'soon' }), 0);
    assert.equal(injectedDelayMs('unknown-provider', { FORCE_SLOW_OPENMETEO: '250' }), 0);
  });
});
