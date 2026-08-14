/**
 * The environment contract.
 *
 * This file exists because an external security review found that
 * `JWT_SECRET`/`SERVICE_KEY` were "optional in non-production and replaced with
 * process-ephemeral values" — and there was no test to argue with, in either
 * direction. `loadEnv` had never been called by any suite, so the entire
 * required-in-production branch of the schema was unexecuted code, and the
 * ephemeral mint was unobserved behaviour.
 *
 * Both are now gone: the secrets are required everywhere and nothing is minted.
 * These tests pin that down, including the failure messages, because "refuses to
 * boot on a bad config" is a claim `docs/deployment/environment.md` makes in
 * writing and a deploy depends on.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { loadEnv, requireSecret } from '../../src/config/env.js';

const SECRET = 'x'.repeat(32);

/** A configuration that satisfies every requirement, to vary one field at a time. */
const complete = (overrides = {}) => ({
  NODE_ENV: 'production',
  // Fabricated, and pointed at the reserved `.example` TLD.
  MONGODB_URI: 'mongodb+srv://user:pw@cluster.example/db', // pragma: allowlist-secret
  JWT_SECRET: SECRET,
  SERVICE_KEY: SECRET,
  CORS_ORIGINS: 'https://khetri.example',
  ...overrides,
});

describe('loadEnv · signing secrets', () => {
  it('requires JWT_SECRET and SERVICE_KEY in development, not only in production', () => {
    // The heart of the audit finding. `NODE_ENV=development` used to make both
    // optional and mint a random value per process instead.
    assert.throws(
      () => loadEnv({ NODE_ENV: 'development' }),
      (error) => {
        assert.match(error.message, /Invalid environment configuration/);
        assert.match(error.message, /JWT_SECRET/);
        assert.match(error.message, /SERVICE_KEY/);
        return true;
      },
    );
  });

  it('requires them in test too, so no environment runs a weaker configuration', () => {
    assert.throws(() => loadEnv({ NODE_ENV: 'test' }), /SERVICE_KEY/);
  });

  it('rejects a secret one character below the 32-character floor', () => {
    assert.throws(
      () => loadEnv(complete({ JWT_SECRET: 'x'.repeat(31) })),
      /JWT_SECRET: must be at least 32 characters/,
    );
  });

  it('accepts exactly 32 characters', () => {
    assert.equal(loadEnv(complete()).JWT_SECRET, SECRET);
  });

  it('never echoes a secret value in the error, only the name and the rule', () => {
    const leaky = 'super-secret-value-that-must-not-be-logged';
    try {
      loadEnv(complete({ JWT_SECRET: leaky, SERVICE_KEY: 'short' }));
      assert.fail('expected the configuration to be rejected');
    } catch (error) {
      assert.doesNotMatch(error.message, /super-secret-value/);
      assert.match(error.message, /SERVICE_KEY/);
    }
  });
});

describe('loadEnv · production-only requirements', () => {
  it('requires MONGODB_URI and CORS_ORIGINS in production', () => {
    assert.throws(
      () => loadEnv({ NODE_ENV: 'production', JWT_SECRET: SECRET, SERVICE_KEY: SECRET }),
      (error) => {
        assert.match(error.message, /MONGODB_URI/);
        assert.match(error.message, /CORS_ORIGINS/);
        return true;
      },
    );
  });

  it('leaves both optional outside production, so local work needs no database', () => {
    const parsed = loadEnv({ NODE_ENV: 'development', JWT_SECRET: SECRET, SERVICE_KEY: SECRET });
    assert.equal(parsed.MONGODB_URI, undefined);
    // A localhost default is safe here and refused in production, where it
    // would ship as a silently broken allowlist.
    assert.equal(parsed.CORS_ORIGINS, 'http://localhost:5173');
  });

  it('rejects a MONGODB_URI that parses as a URL but is not Mongo', () => {
    assert.throws(
      () => loadEnv(complete({ MONGODB_URI: 'https://cluster.example/db' })),
      /must start with mongodb:\/\/ or mongodb\+srv:\/\//,
    );
  });
});

describe('loadEnv · providers stay optional', () => {
  it('boots a production configuration with no vision provider at all', () => {
    // Deliberate, and load-bearing: the crop-health chain is designed so every
    // tier can be absent and the request still answers from the local rule
    // engine. Requiring a key would turn a designed degraded mode into a boot
    // failure. What is not optional is that the degradation is reported.
    const parsed = loadEnv(complete());
    assert.equal(parsed.GEMINI_API_KEY, undefined);
    assert.equal(parsed.OPENROUTER_API_KEY, undefined);
    assert.equal(parsed.ML_SERVICE_URL, undefined);
    assert.equal(parsed.CLOUDINARY_URL, undefined);
  });

  it('rejects a truncated CLOUDINARY_URL rather than failing at the first upload', () => {
    assert.throws(
      () => loadEnv(complete({ CLOUDINARY_URL: 'cloudinary://key-only' })),
      /must look like cloudinary/,
    );
  });

  it('accepts a well-formed CLOUDINARY_URL', () => {
    // Shape-only fixture; the digits and letters are placeholders, not a key.
    const url = 'cloudinary://123456789:abcdefghijklmnop@demo-cloud'; // pragma: allowlist-secret
    assert.equal(loadEnv(complete({ CLOUDINARY_URL: url })).CLOUDINARY_URL, url);
  });

  it('rejects an ML_SERVICE_URL that is not a URL', () => {
    assert.throws(() => loadEnv(complete({ ML_SERVICE_URL: 'not-a-url' })), /ML_SERVICE_URL/);
  });
});

describe('requireSecret', () => {
  it('returns the configured value', () => {
    assert.equal(requireSecret('JWT_SECRET'), process.env.JWT_SECRET);
    assert.equal(requireSecret('SERVICE_KEY'), process.env.SERVICE_KEY);
  });

  it('refuses a name outside the allowlist instead of reporting it as absent', () => {
    // Previously `env[name]` was read for any string, so a typo minted a
    // plausible-looking secret in development and threw only in production.
    assert.throws(() => requireSecret('JWT_SECRETT'), /Unknown secret requested/);
    assert.throws(() => requireSecret('MONGODB_URI'), /Unknown secret requested/);
  });

  it('mints nothing — the module exposes no generated fallback', () => {
    // The regression this whole file exists for: two calls must agree because
    // they read one configured value, not because a cache made them agree.
    assert.equal(requireSecret('JWT_SECRET'), requireSecret('JWT_SECRET'));
    assert.equal(requireSecret('JWT_SECRET'), process.env.JWT_SECRET);
  });
});
