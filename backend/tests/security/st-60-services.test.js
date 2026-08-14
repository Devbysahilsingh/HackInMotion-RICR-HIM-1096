/**
 * ST-60 — Services [blocking].
 *
 * docs/security/security-testing.md, verbatim:
 *   "ml-service /predict without key → 401; with wrong key → 401 + audit;
 *    Gemini key absent from all client bundles (grep dist/APK); kill-switch
 *    flags degrade without auth impact."
 *
 * Scope split, stated because half of this row is not observable from here.
 * That /predict *itself* answers 401 to a missing or forged key — in constant
 * time, in every environment, before the body is parsed — is a property of the
 * FastAPI app and is asserted in ml-service/tests/test_predict_api.py and
 * ml-service/tests/test_security.py. This file covers the backend-observable
 * half: that the client presents the key and never leaks it, that a 401
 * degrades the chain instead of becoming a diagnosis, that the kill switches
 * shed a tier without touching authentication, and that no provider credential
 * reaches a client bundle.
 *
 * On "+ audit": ml-service writes no audit record (docs/testing/test-matrix.md),
 * and the backend does not audit a tier rejection either — the outcome travels
 * as a coarse reason code into the health log. The assertions below pin that
 * reason code. Nothing here claims an audit row exists that does not.
 */
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { AI_PROVIDERS, UNKNOWN_DISEASE_CODE } from '../../src/config/constants.js';
import { env, requireSecret } from '../../src/config/env.js';
import { ML_FAILURE, isServable, predict } from '../../src/integrations/mlService.js';
import { startTestServer } from '../helpers/app.js';
import { clearCollections, startTestDatabase, stopTestDatabase } from '../helpers/db.js';

const REPO_ROOT = new URL('../../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x01, 0x02, 0x03]);
const ML_URL = 'http://ml.internal.test';

/** A well-formed prediction, so tests can vary exactly one field at a time. */
const validBody = (overrides = {}) => ({
  diseaseCode: 'TOMATO_EARLY_BLIGHT',
  uncertain: false,
  confidence: 0.91,
  top3: [{ code: 'TOMATO_EARLY_BLIGHT', prob: 0.91 }],
  modelVersion: 'model-v1.0',
  latencyMs: 42,
  ...overrides,
});

/** Records every call so the request itself can be asserted, not just the reply. */
function stubFetch(reply) {
  const calls = [];
  const impl = async (input, init) => {
    calls.push({ url: String(input), init });
    return typeof reply === 'function' ? reply() : reply;
  };
  impl.calls = calls;
  return impl;
}

const jsonReply = (status, body) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('ST-60 · Services', () => {
  // `env` is parsed once at import, so ML_SERVICE_URL cannot be steered through
  // process.env after the fact. `predict()` exposes a seam for `fetch` but not
  // for the URL, so the configured value is set directly and restored — the same
  // save/restore idiom ST-70 uses for AuditLog.create. No request leaves the
  // process: every call below goes through `fetchImpl`.
  const originalUrl = env.ML_SERVICE_URL;

  beforeEach(() => {
    delete process.env.DISABLE_ML;
    delete process.env.DISABLE_GEMINI;
    delete process.env.DISABLE_OPENROUTER;
    env.ML_SERVICE_URL = ML_URL;
  });

  after(() => {
    env.ML_SERVICE_URL = originalUrl;
  });

  // ── ST-60.1 · The service key on the wire ────────────────────────────

  describe('ST-60.1 · service key presentation', () => {
    it('presents the key from the environment in X-Service-Key, and nowhere else', async () => {
      const fetchImpl = stubFetch(jsonReply(200, validBody()));

      await predict({ jpeg: JPEG, cropCode: 'TOMATO', fetchImpl });

      assert.equal(fetchImpl.calls.length, 1);
      const { url, init } = fetchImpl.calls[0];

      assert.equal(init.headers['X-Service-Key'], requireSecret('SERVICE_KEY'));

      // A credential in a URL reaches proxy logs, browser history and Referer
      // headers. It belongs in a header and only in a header.
      assert.ok(
        !url.includes(requireSecret('SERVICE_KEY')),
        `the service key reached the request URL: ${url}`,
      );
      assert.equal(new URL(url).search, '');
      assert.equal(new URL(url).pathname, '/predict');
    });

    it('sends no request at all when the tier is not configured', async () => {
      env.ML_SERVICE_URL = undefined;
      const fetchImpl = stubFetch(jsonReply(200, validBody()));

      const result = await predict({ jpeg: JPEG, cropCode: 'TOMATO', fetchImpl });

      assert.equal(result.ok, false);
      assert.equal(result.reason, ML_FAILURE.NOT_CONFIGURED);
      // The key must not be offered to a host the configuration never named.
      assert.equal(fetchImpl.calls.length, 0);
    });

    it('refuses to follow a redirect, which would replay the key to another host', async () => {
      // `fetch` strips Authorization across a cross-origin redirect but replays
      // custom headers like X-Service-Key. A 302 to a metadata address would
      // otherwise hand this service's shared secret to whatever it named.
      const fetchImpl = stubFetch(jsonReply(200, validBody()));

      await predict({ jpeg: JPEG, cropCode: 'TOMATO', fetchImpl });

      assert.equal(fetchImpl.calls[0].init.redirect, 'error');
    });
  });

  // ── ST-60.2 · A rejected call degrades; it never diagnoses ───────────

  describe('ST-60.2 · unauthenticated and rejected calls', () => {
    it('maps a 401 from ml-service to a degradation, not a prediction', async () => {
      const fetchImpl = stubFetch(
        jsonReply(401, {
          error: { code: 'SERVICE_KEY_INVALID', message: 'invalid or missing service key' },
        }),
      );

      const result = await predict({ jpeg: JPEG, cropCode: 'TOMATO', fetchImpl });

      assert.equal(result.ok, false);
      assert.equal(result.reason, ML_FAILURE.HTTP_STATUS);
      assert.equal(result.status, 401);
      assert.equal(isServable(result), false);
      assert.equal(result.diseaseCode, undefined);
    });

    it('ignores the body of a 401 even when it is shaped like a valid prediction', async () => {
      // The abuse case: something answering on ml-service's behalf without the
      // key returns a confident diagnosis alongside its 401. Status decides.
      const fetchImpl = stubFetch(jsonReply(401, validBody()));

      const result = await predict({ jpeg: JPEG, cropCode: 'TOMATO', fetchImpl });

      assert.equal(result.ok, false);
      assert.equal(isServable(result), false);
    });

    it('treats every non-2xx the same way, without leaking the body', async () => {
      for (const status of [400, 403, 404, 413, 500, 503, 504]) {
        const fetchImpl = stubFetch(jsonReply(status, validBody()));
        const result = await predict({ jpeg: JPEG, cropCode: 'TOMATO', fetchImpl });

        assert.equal(result.ok, false, `status ${status} produced a servable result`);
        assert.equal(result.reason, ML_FAILURE.HTTP_STATUS);
        assert.equal(result.status, status);
      }
    });

    it('enforces its own timeout when the service never answers', async () => {
      const fetchImpl = async (_input, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        });

      const result = await predict({ jpeg: JPEG, cropCode: 'TOMATO', timeoutMs: 25, fetchImpl });

      assert.equal(result.ok, false);
      assert.equal(result.reason, ML_FAILURE.TIMEOUT);
    });
  });

  // ── ST-60.3 · A confused service cannot inject a diagnosis ───────────

  describe('ST-60.3 · response contract is closed', () => {
    it('rejects a 200 carrying a field the contract does not define', async () => {
      const fetchImpl = stubFetch(jsonReply(200, validBody({ injected: 'surprise' })));

      const result = await predict({ jpeg: JPEG, cropCode: 'TOMATO', fetchImpl });

      assert.equal(result.ok, false);
      assert.equal(result.reason, ML_FAILURE.MALFORMED_BODY);
    });

    it('rejects a 200 that is missing a required field', async () => {
      for (const field of ['diseaseCode', 'uncertain', 'modelVersion']) {
        const body = validBody();
        delete body[field];
        const fetchImpl = stubFetch(jsonReply(200, body));

        const result = await predict({ jpeg: JPEG, cropCode: 'TOMATO', fetchImpl });

        assert.equal(result.ok, false, `missing ${field} was accepted`);
        assert.equal(result.reason, ML_FAILURE.MALFORMED_BODY);
      }
    });

    it('rejects an out-of-range confidence rather than clamping it', async () => {
      for (const confidence of [1.5, -0.2]) {
        const fetchImpl = stubFetch(jsonReply(200, validBody({ confidence })));
        const result = await predict({ jpeg: JPEG, cropCode: 'TOMATO', fetchImpl });

        assert.equal(result.ok, false, `confidence ${confidence} was accepted`);
        assert.equal(result.reason, ML_FAILURE.MALFORMED_BODY);
      }
    });

    it('rejects a body that is not JSON at all', async () => {
      const fetchImpl = stubFetch(
        new Response('<html>gateway error</html>', {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        }),
      );

      const result = await predict({ jpeg: JPEG, cropCode: 'TOMATO', fetchImpl });

      assert.equal(result.ok, false);
      assert.equal(result.reason, ML_FAILURE.MALFORMED_BODY);
    });

    it('drops the disease code when the service declared itself uncertain', async () => {
      // "Never force a prediction" is contractual: a code the model declined to
      // stand behind must not survive this boundary as a diagnosis.
      const fetchImpl = stubFetch(
        jsonReply(200, validBody({ uncertain: true, diseaseCode: 'TOMATO_LATE_BLIGHT' })),
      );

      const result = await predict({ jpeg: JPEG, cropCode: 'TOMATO', fetchImpl });

      assert.equal(result.ok, true);
      assert.equal(result.uncertain, true);
      assert.equal(result.diseaseCode, null);
      assert.equal(isServable(result), false);
    });

    it('drops the disease code on a crop mismatch', async () => {
      const fetchImpl = stubFetch(
        jsonReply(200, validBody({ cropMismatch: true, diseaseCode: 'RICE_BLAST' })),
      );

      const result = await predict({ jpeg: JPEG, cropCode: 'TOMATO', fetchImpl });

      assert.equal(result.cropMismatch, true);
      assert.equal(result.diseaseCode, null);
      assert.equal(isServable(result), false);
    });

    it('never serves the UNKNOWN sentinel as a diagnosis', async () => {
      const fetchImpl = stubFetch(jsonReply(200, validBody({ diseaseCode: UNKNOWN_DISEASE_CODE })));

      const result = await predict({ jpeg: JPEG, cropCode: 'TOMATO', fetchImpl });

      assert.equal(isServable(result), false);
    });

    it('canonicalises the disease code to the form the registry stores', async () => {
      // Regression: the code was passed through verbatim while `top3` was
      // uppercased. Registry codes are uppercase and matched with `===`, and
      // CropHealthLog uppercases on save — so a lowercase code missed the
      // lookup (a diagnosis with no symptoms, no next steps, no sources) and
      // was then persisted in exactly the form that would have matched.
      const fetchImpl = stubFetch(
        jsonReply(
          200,
          validBody({
            diseaseCode: '  tomato_early_blight  ',
            top3: [{ code: 'tomato_early_blight', prob: 0.91 }],
          }),
        ),
      );

      const result = await predict({ jpeg: JPEG, cropCode: 'TOMATO', fetchImpl });

      assert.equal(result.diseaseCode, 'TOMATO_EARLY_BLIGHT');
      assert.equal(result.top3[0].diseaseCode, 'TOMATO_EARLY_BLIGHT');
    });
  });

  // ── ST-60.4 · Kill switches degrade without auth impact ──────────────

  describe('ST-60.4 · kill switches', () => {
    it('DISABLE_ML sheds the tier without contacting the service', async () => {
      process.env.DISABLE_ML = 'true';
      const fetchImpl = stubFetch(jsonReply(200, validBody()));

      const result = await predict({ jpeg: JPEG, cropCode: 'TOMATO', fetchImpl });

      assert.equal(result.ok, false);
      assert.equal(result.reason, ML_FAILURE.DISABLED);
      // A disabled tier must not present the credential to anyone.
      assert.equal(fetchImpl.calls.length, 0);
    });

    it('distinguishes a disabled tier from an unconfigured one and from a fault', async () => {
      // The three states are reported separately on purpose: a disabled tier is
      // an operator decision, not a model that answered badly.
      process.env.DISABLE_ML = 'true';
      const disabled = await predict({
        jpeg: JPEG,
        cropCode: 'TOMATO',
        fetchImpl: stubFetch(jsonReply(200, validBody())),
      });

      delete process.env.DISABLE_ML;
      env.ML_SERVICE_URL = undefined;
      const unconfigured = await predict({
        jpeg: JPEG,
        cropCode: 'TOMATO',
        fetchImpl: stubFetch(jsonReply(200, validBody())),
      });

      env.ML_SERVICE_URL = ML_URL;
      const faulted = await predict({
        jpeg: JPEG,
        cropCode: 'TOMATO',
        fetchImpl: stubFetch(jsonReply(500, {})),
      });

      assert.equal(disabled.reason, ML_FAILURE.DISABLED);
      assert.equal(unconfigured.reason, ML_FAILURE.NOT_CONFIGURED);
      assert.equal(faulted.reason, ML_FAILURE.HTTP_STATUS);
      assert.notEqual(disabled.reason, unconfigured.reason);
    });

    it('the ml kill switch is scoped to its own provider', async () => {
      process.env.DISABLE_ML = 'true';
      const { tierDisabled } = await import('../../src/config/failureFlags.js');

      assert.equal(tierDisabled(AI_PROVIDERS.ML), true);
      assert.equal(tierDisabled(AI_PROVIDERS.GEMINI), false);
      assert.equal(tierDisabled(AI_PROVIDERS.OPENROUTER), false);
    });
  });

  describe('ST-60.4 · kill switches do not touch authentication', () => {
    let server;

    before(async () => {
      await startTestDatabase();
      server = await startTestServer();
    });

    after(async () => {
      await server.close();
      await stopTestDatabase();
    });

    beforeEach(async () => {
      await clearCollections();
      delete process.env.RATE_LIMITS_ENABLED;
    });

    it('every tier disabled still leaves protected routes closed and open routes working', async () => {
      process.env.DISABLE_ML = 'true';
      process.env.DISABLE_GEMINI = 'true';
      process.env.DISABLE_OPENROUTER = 'true';

      try {
        // Closed without a token.
        const anonymous = await server.request('/api/v1/farms');
        assert.equal(
          anonymous.status,
          401,
          `farms was reachable unauthenticated: ${anonymous.text}`,
        );

        // Still closed to a forged token — a kill switch is not a bypass.
        const forged = await server.request('/api/v1/farms', { token: 'not.a.real.token' });
        assert.equal(forged.status, 401);

        // And authentication itself still works end to end.
        const registered = await server.request('/api/v1/auth/register', {
          method: 'POST',
          body: {
            name: 'Test Farmer',
            email: `st60-${Date.now()}@example.com`,
            password: 'a-long-enough-password', // pragma: allowlist-secret — fabricated value for a test account
            language: 'en',
          },
        });
        assert.equal(registered.status, 201, `register failed: ${registered.text}`);

        const authorized = await server.request('/api/v1/farms', {
          token: registered.body.data.accessToken,
        });
        assert.equal(authorized.status, 200, `farms rejected a valid token: ${authorized.text}`);
      } finally {
        delete process.env.DISABLE_ML;
        delete process.env.DISABLE_GEMINI;
        delete process.env.DISABLE_OPENROUTER;
      }
    });
  });

  // ── ST-60.5 · No provider credential in a client bundle ──────────────

  describe('ST-60.5 · provider keys absent from client bundles', () => {
    /** Every secret-bearing configuration name the server side knows. */
    const SECRET_NAMES = [
      'SERVICE_KEY',
      'JWT_SECRET',
      'MONGODB_URI',
      'GEMINI_API_KEY',
      'OPENROUTER_API_KEY',
      'OPENWEATHER_API_KEY',
      'DATAGOVIN_API_KEY',
      'CLOUDINARY_URL',
    ];

    function filesUnder(dir, extensions) {
      const found = [];
      let entries;
      try {
        entries = readdirSync(dir);
      } catch {
        return found;
      }
      for (const entry of entries) {
        if (entry === 'node_modules' || entry.startsWith('.')) continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          found.push(...filesUnder(full, extensions));
        } else if (extensions.some((ext) => entry.endsWith(ext))) {
          found.push(full);
        }
      }
      return found;
    }

    it('no client source reads a server-side secret through import.meta.env or process.env', () => {
      // Vite inlines only VITE_-prefixed variables and Expo only EXPO_PUBLIC_-
      // prefixed ones, so a provider key can only reach a bundle by being named
      // with one of those prefixes or read explicitly. Both are checked.
      const sources = [
        ...filesUnder(join(REPO_ROOT, 'web', 'frontend', 'src'), ['.ts', '.tsx', '.js', '.jsx']),
        ...filesUnder(join(REPO_ROOT, 'mobile', 'src'), ['.ts', '.tsx', '.js', '.jsx']),
      ];

      assert.ok(sources.length > 0, 'found no client sources to scan — the scan path is wrong');

      const offenders = [];
      for (const file of sources) {
        const text = readFileSync(file, 'utf8');
        for (const name of SECRET_NAMES) {
          if (text.includes(name)) offenders.push(`${file} references ${name}`);
        }
        if (/VITE_[A-Z_]*(KEY|SECRET|TOKEN|PASSWORD)/.test(text)) {
          offenders.push(`${file} declares a VITE_-prefixed credential`);
        }
        if (/EXPO_PUBLIC_[A-Z_]*(KEY|SECRET|TOKEN|PASSWORD)/.test(text)) {
          offenders.push(`${file} declares an EXPO_PUBLIC_-prefixed credential`);
        }
      }

      assert.deepEqual(
        offenders,
        [],
        `client source references a server-side secret:\n${offenders.join('\n')}`,
      );
    });

    it('no built bundle contains a provider key name or the live service key', () => {
      const bundles = [
        ...filesUnder(join(REPO_ROOT, 'web', 'frontend', 'dist'), ['.js', '.html', '.css', '.map']),
        ...filesUnder(join(REPO_ROOT, 'mobile', 'dist'), ['.js', '.html', '.json', '.map']),
      ];

      // A missing build is not a pass. It is reported, so the gap is visible
      // rather than dressed up as a green assertion.
      if (bundles.length === 0) {
        assert.fail(
          'no built client bundle found under web/frontend/dist or mobile/dist — ' +
            'run the client builds before treating ST-60.5 as covered',
        );
      }

      const liveKey = requireSecret('SERVICE_KEY');
      const offenders = [];

      for (const file of bundles) {
        const text = readFileSync(file, 'utf8');
        for (const name of SECRET_NAMES) {
          if (text.includes(name)) offenders.push(`${file} contains ${name}`);
        }
        if (text.includes(liveKey)) offenders.push(`${file} contains the live service key`);
      }

      assert.deepEqual(
        offenders,
        [],
        `a client bundle carries a credential:\n${offenders.join('\n')}`,
      );
    });
  });
});
