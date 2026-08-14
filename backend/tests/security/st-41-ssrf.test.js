/**
 * ST-41 — Outbound request safety (SSRF) [blocking].
 *
 * Phase 7 found and fixed a credential-replay hole on the AI path: `fetch`
 * follows up to twenty redirects by default and strips only `Authorization`
 * across origins, so a custom key header was replayed verbatim to whatever host
 * a `Location` named. That fix landed on `services/aiVision.js` and
 * `integrations/mlService.js`.
 *
 * This suite exists because a fix applied to the call sites someone happened to
 * look at is not a control. It asserts three things:
 *
 *   1. The policy is **enforced**, not merely configured — a real HTTP redirect
 *      from a real socket must not be followed (§41.1). Asserting `init.redirect
 *      === 'error'` alone would pass just as happily if undici ignored the
 *      option.
 *   2. A refused redirect **degrades**; it never becomes a farmer-visible fault
 *      or a 500 (§41.2).
 *   3. **Every** outbound path carries the policy, including ones added later
 *      (§41.3). This is a source-level parity check in the same spirit as
 *      ST-10's mounted-routes assertion: the gap it guards is a new integration
 *      shipping without the header, which nothing else in the tree would notice.
 *
 * Why refusing is free here: every provider behind these clients is a fixed
 * JSON endpoint (Open-Meteo, the OWM one-call API, data.gov.in, Gemini,
 * OpenRouter, our own ml-service). None of them legitimately redirects, so the
 * refusal only ever fires on a hijacked answer.
 *
 * No test in this file opens a socket to the internet. §41.1 binds two servers
 * on 127.0.0.1 and points the client at them.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { PROVIDER_FAILURE, ProviderError, fetchJson } from '../../src/utils/httpClient.js';

/**
 * What the stand-in "internal service" would hand over if the redirect were
 * followed.
 *
 * A fabricated string standing in for instance metadata. It is the payload the
 * test asserts is **never** retrieved — §41.1 passes precisely because no
 * request ever reaches the server that returns it.
 */
const INTERNAL_BODY = { secret: 'instance-credentials' }; // pragma: allowlist-secret — fabricated fixture, asserted to be unreachable

/** Binds a handler on an ephemeral loopback port. */
async function listen(handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

describe('ST-41 · Outbound request safety (SSRF)', () => {
  // ── §41.1 · A redirect is refused at the socket, not just in config ────────

  describe('ST-41.1 · redirects are not followed', () => {
    /** Stands in for the address an attacker would like us to reach. */
    let internal;
    /** Stands in for the provider, answering with a `Location` we did not choose. */
    let provider;
    /** Every request the "internal" service saw. Must stay empty. */
    let internalHits;

    before(async () => {
      internalHits = [];

      internal = await listen((req, res) => {
        internalHits.push({ url: req.url, headers: req.headers });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(INTERNAL_BODY));
      });

      provider = await listen((req, res) => {
        // A 302 is the friendliest of the redirect statuses and the one a
        // hijacked host would use; 301/307/308 travel the same code path.
        res.writeHead(302, { Location: `${internal.origin}/latest/meta-data/` });
        res.end();
      });
    });

    after(async () => {
      await provider.close();
      await internal.close();
    });

    it('does not issue the redirected request', async () => {
      await assert.rejects(
        () =>
          fetchJson(`${provider.origin}/v1/forecast?lat=21.1&lon=79.1`, {
            provider: 'open-meteo',
            timeoutMs: 2_000,
            retries: 0,
          }),
        (err) => err instanceof ProviderError,
      );

      assert.deepEqual(
        internalHits,
        [],
        'the redirect was followed — an outbound poll reached an address the configuration never named',
      );
    });

    it('reports a transport failure rather than a successful parse', async () => {
      // The distinction matters downstream: `weatherService` keeps last-known-good
      // on a provider failure (rule 3) and would overwrite it on a success.
      const err = await fetchJson(`${provider.origin}/v1/forecast`, {
        provider: 'open-meteo',
        timeoutMs: 2_000,
        retries: 0,
      }).then(
        () => null,
        (e) => e,
      );

      assert.ok(err instanceof ProviderError, `expected a ProviderError, got ${err}`);
      assert.equal(err.reason, PROVIDER_FAILURE.NETWORK);
      // A refused redirect is a transport-class fault, so the one retry the
      // policy allows is legitimate — but it must never become a 200.
      assert.equal(err.retryable, true);
    });

    it('leaks no part of the redirect target into the error surface', async () => {
      // The `Location` is attacker-chosen text. Interpolating it into an error
      // message is how an internal hostname reaches a log line.
      const err = await fetchJson(`${provider.origin}/v1/forecast?appid=super-secret-key`, {
        provider: 'open-meteo',
        timeoutMs: 2_000,
        retries: 0,
      }).then(
        () => null,
        (e) => e,
      );

      assert.ok(!err.message.includes(internal.origin), err.message);
      assert.ok(!err.message.includes('meta-data'), err.message);
      assert.ok(!err.message.includes('super-secret-key'), err.message);
    });
  });

  // ── §41.2 · The refusal degrades ──────────────────────────────────────────

  describe('ST-41.2 · a refused redirect degrades', () => {
    it('surfaces as a provider failure the caller already knows how to handle', async () => {
      // `redirect: 'error'` makes undici reject with a TypeError, which is the
      // same shape as DNS failure or a dropped connection. The point of this
      // assertion is that `fetchJson` classifies it as one of the coarse
      // PROVIDER_FAILURE kinds and not as an unhandled throw — an unclassified
      // rejection out of a job would surface as an unhandled rejection.
      const rejecting = () => {
        const err = new TypeError('unexpected redirect');
        return Promise.reject(err);
      };

      const err = await fetchJson('https://api.example.test/v1/x', {
        provider: 'data-gov-in',
        retries: 0,
        fetchImpl: rejecting,
      }).then(
        () => null,
        (e) => e,
      );

      assert.ok(err instanceof ProviderError);
      assert.equal(err.provider, 'data-gov-in');
      assert.equal(err.reason, PROVIDER_FAILURE.NETWORK);
    });
  });

  // ── §41.3 · No outbound path may ship without the policy ──────────────────

  describe('ST-41.3 · every outbound client refuses redirects', () => {
    /**
     * Files that actually put a request on the wire.
     *
     * Recovered by reading the source rather than listed by hand, for the same
     * reason ST-10 recovers mounted routes from the live app: a hand-written
     * list is a list of the places someone remembered, and the failure mode
     * this guards is precisely a new one being forgotten.
     *
     * `fetchImpl` is the injection seam every client in this codebase uses, so
     * "invokes `fetchImpl(`" is a complete and precise definition of "makes an
     * outbound request" here — `fetchJson` is the shared helper and is itself
     * one of the matches.
     */
    const outboundFiles = () => {
      const roots = ['../../src/integrations/', '../../src/services/', '../../src/utils/'];
      const found = [];

      for (const root of roots) {
        const dir = fileURLToPath(new URL(root, import.meta.url));
        for (const name of readdirSync(dir)) {
          if (!name.endsWith('.js')) continue;
          const source = readFileSync(`${dir}${name}`, 'utf8');
          // The call, not the mention: `fetchImpl` appears in JSDoc and in
          // parameter lists all over the tree.
          if (/\bawait fetchImpl\(/.test(source)) found.push({ name: `${root}${name}`, source });
        }
      }

      return found;
    };

    it('finds the outbound clients it is meant to be checking', () => {
      // A parity test that matches nothing passes vacuously. This is the guard
      // against the detector silently breaking — e.g. if the seam is renamed.
      const files = outboundFiles();
      assert.ok(
        files.length >= 3,
        `expected at least the three known outbound clients, found ${files.length}: ${files
          .map((f) => f.name)
          .join(', ')}`,
      );
    });

    it("declares redirect: 'error' in every one of them", () => {
      const offenders = outboundFiles()
        .filter((file) => !/redirect:\s*'error'/.test(file.source))
        .map((file) => file.name);

      assert.deepEqual(
        offenders,
        [],
        `outbound client(s) without a redirect policy: ${offenders.join(', ')}. ` +
          "A `Location` chosen by the answering host would be followed, so the next request originates from this server against an address the configuration never named. Add `redirect: 'error'`.",
      );
    });
  });

  // ── §41.4 · No user input reaches a request URL's host or path ────────────

  describe('ST-41.4 · request URLs are built from constants', () => {
    it('places farmer-supplied text in an encoded query value only', async () => {
      // `geocodePlace` is the one outbound call whose input a farmer controls
      // (the farm's village/district/state). A separator that survived
      // unencoded could add or override query parameters; a `/` or `..` that
      // survived could move the request off the documented path.
      const { geocodePlace } = await import('../../src/integrations/openMeteoGeocoding.js');

      const seen = [];
      const fetchImpl = (url) => {
        seen.push(String(url));
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ results: [] }) });
      };

      await geocodePlace({
        village: '../../admin&count=999#',
        district: 'x?y=z',
        state: 'Maharashtra',
        fetchImpl,
      });

      assert.ok(seen.length > 0, 'the geocoder made no request to inspect');

      for (const raw of seen) {
        const url = new URL(raw);
        assert.equal(url.host, 'geocoding-api.open-meteo.com');
        assert.equal(url.pathname, '/v1/search');
        // `count` is ours, and exactly one of it: an injected `&count=999`
        // would have arrived as a second parameter.
        assert.deepEqual(url.searchParams.getAll('count'), ['10']);
        assert.equal(url.hash, '');
      }
    });
  });
});
