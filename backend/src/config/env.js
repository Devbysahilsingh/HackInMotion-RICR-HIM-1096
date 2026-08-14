/**
 * Environment contract and boot-time validation.
 *
 * The process refuses to start on an invalid configuration (CLAUDE.md: fail
 * fast — never run half-configured). Variables are required only once the
 * subsystem that consumes them exists; secrets are required in production
 * regardless, so a misconfigured deploy fails at boot rather than at runtime.
 *
 * Full matrix: docs/deployment/environment.md
 */
import { z } from 'zod';

/**
 * A signing secret. Required in **every** environment, not just production.
 *
 * These were production-only until 2026-08-15, with a random per-process value
 * minted when absent (see `requireSecret`). That made development and test run a
 * materially different security configuration from the deploy, silently, and
 * left the required-in-production branch of this schema with no test coverage
 * because no suite ever ran with `NODE_ENV=production`.
 *
 * `scripts/setup-dev-env.mjs` generates both into `backend/.env`, and
 * `tests/env.mjs` supplies fixed non-secret values for the suite, so requiring
 * them costs nothing that was worth keeping.
 */
const signingSecret = (minLength) =>
  z.string().min(minLength, `must be at least ${minLength} characters`);

/**
 * Only real MongoDB connection strings pass. `z.string().url()` alone accepts
 * any parseable URL, so the previous message promised a check it did not make.
 */
const mongoUri = z
  .string()
  .refine(
    (value) => value.startsWith('mongodb://') || value.startsWith('mongodb+srv://'),
    'must start with mongodb:// or mongodb+srv://',
  );

/**
 * The schema for one environment, built from the configuration being validated.
 *
 * `isProduction` used to be a module-level constant read from the ambient
 * `process.env.NODE_ENV` at import time. That worked in a real deploy, where
 * the variable is set before the process starts, but it meant the schema was
 * decided by *when* this module was imported rather than by *what* it was asked
 * to validate — so `loadEnv({ NODE_ENV: 'production', ... })` silently applied
 * the development rules, and the production branch could not be tested at all.
 * A gate that cannot be exercised is a gate nobody can prove works.
 *
 * @param {boolean} isProduction
 */
const buildSchema = (isProduction) =>
  z.object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().max(65535).default(4000),
    // 'silent' exists so test runs are not drowned in request logs.
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),

    /**
     * Comma-separated exact origins. No wildcards (docs/security/api-security.md).
     * Required in production: defaulting to a localhost origin on a deployed host
     * would let a forgotten variable ship as a silently broken allowlist.
     */
    CORS_ORIGINS: isProduction
      ? z.string().min(1, 'must list at least one exact origin in production')
      : z.string().default('http://localhost:5173'),

    // ── Consumed by subsystems added in later TODOs ────────────────────────
    MONGODB_URI: isProduction ? mongoUri : mongoUri.optional(),
    JWT_SECRET: signingSecret(32),
    SERVICE_KEY: signingSecret(32),

    /**
     * Phase 2 providers.
     *
     * Open-Meteo is deliberately absent: ADR-007 selects it precisely because it
     * is keyless, so there is no `OPENMETEO_*` variable to forget.
     *
     * Both keys below stay **optional even in production**, which is a departure
     * from the "required once the subsystem ships" convention and is deliberate:
     *   - `OPENWEATHER_API_KEY` buys only the *fallback* leg. Without it the
     *     primary still works, so making it required would turn a degraded mode
     *     into a boot failure.
     *   - `DATAGOVIN_API_KEY` is open decision OD-5 and has not been issued.
     *     Requiring it would make the whole API unbootable over a subsystem that
     *     is designed to fall back to seeded history.
     * Each integration reports its own absence honestly instead.
     */
    OPENWEATHER_API_KEY: z.string().min(1).optional(),
    DATAGOVIN_API_KEY: z.string().min(1).optional(),
    /**
     * The data.gov.in resource id for "Variety-wise Daily Market Prices".
     * Configurable rather than hardcoded because the catalogue re-issues ids,
     * and no repository document records one (docs/market/data-source.md names
     * the dataset but publishes no id).
     */
    DATAGOVIN_RESOURCE_ID: z.string().min(1).optional(),

    /**
     * Phase 3 providers and storage.
     *
     * All four stay **optional even in production**, for the same reason the
     * Phase 2 keys do: the crop-health chain is designed so that every tier can
     * be absent and the request still answers. Requiring a key would convert a
     * designed degraded mode into a boot failure, and the terminal rule engine is
     * local — it needs no key at all.
     *
     * The one thing that is NOT optional is honesty: each integration reports its
     * own absence as a tier-down with a reason, and `/healthz` shows which tiers
     * are configured, so "no Gemini key" never looks like "Gemini said UNKNOWN".
     */
    GEMINI_API_KEY: z.string().min(1).optional(),
    OPENROUTER_API_KEY: z.string().min(1).optional(),
    /**
     * `cloudinary://<key>:<secret>@<cloud>`. Shape-checked rather than merely
     * non-empty so a truncated paste fails at boot instead of at the first upload
     * — the SDK would otherwise accept it and fail per-request with a provider
     * error the farmer sees.
     */
    CLOUDINARY_URL: z
      .string()
      .refine(
        (value) => /^cloudinary:\/\/[^:]+:[^@]+@[^/@\s]+$/.test(value),
        'must look like cloudinary://<key>:<secret>@<cloud-name>',
      )
      .optional(),
    ML_SERVICE_URL: z.string().url().optional(),

    /**
     * Kill switches (docs/security/ai-security.md).
     *
     * Unlike the FORCE_FAIL_* injection flags these ARE honoured in production —
     * that is the point: they exist so an operator can shed a misbehaving or
     * quota-exhausted tier without a redeploy. They are still routing-only; no
     * flag can weaken auth, ownership, validation or rate limiting (rule 2).
     */
    DISABLE_ML: z.enum(['true', 'false']).default('false'),
    DISABLE_GEMINI: z.enum(['true', 'false']).default('false'),
    DISABLE_OPENROUTER: z.enum(['true', 'false']).default('false'),
  });

/**
 * @param {NodeJS.ProcessEnv} source
 * @returns {z.infer<ReturnType<typeof buildSchema>>}
 */
export function loadEnv(source = process.env) {
  // Read from the source under validation, before parsing — the schema's shape
  // depends on it, and `NODE_ENV` defaults to development when absent.
  const result = buildSchema(source.NODE_ENV === 'production').safeParse(source);

  if (!result.success) {
    // Report names and rules only — never echo values (docs/security/secrets-management.md).
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }

  return result.data;
}

export const env = loadEnv();

export const corsOrigins = env.CORS_ORIGINS.split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';

/**
 * Which analysis tiers are configured at all.
 *
 * Read by `/healthz` and by the conductor, so "not configured" and "tried and
 * failed" stay distinguishable in both the logs and the operator's view. A
 * disabled tier reports as unconfigured for routing purposes but is reported
 * separately here so an operator can tell a missing key from a pulled switch.
 */
export const tierConfig = () => ({
  ml: { configured: Boolean(env.ML_SERVICE_URL), disabled: env.DISABLE_ML === 'true' },
  gemini: { configured: Boolean(env.GEMINI_API_KEY), disabled: env.DISABLE_GEMINI === 'true' },
  openrouter: {
    configured: Boolean(env.OPENROUTER_API_KEY),
    disabled: env.DISABLE_OPENROUTER === 'true',
  },
  storage: { configured: Boolean(env.CLOUDINARY_URL), disabled: false },
});

/**
 * The names `requireSecret` will answer for.
 *
 * An allowlist rather than a free lookup on `env[name]`, so a typo
 * (`requireSecret('JWT_SECRETT')`) is a loud failure at the call site instead of
 * a value that reads as absent.
 */
const SECRET_NAMES = new Set(['JWT_SECRET', 'SERVICE_KEY']);

/**
 * A secret, or a refusal. There is no third outcome.
 *
 * This function used to mint a random per-process value when a secret was
 * absent outside production. The reasoning was defensible — no fixed
 * development key can leak, and tokens merely stop verifying after a restart —
 * but it produced a system whose security posture differed by environment, and
 * it did so silently. Two things followed from that:
 *
 *   - A developer pointing `ML_SERVICE_URL` at a real ml-service authenticated
 *     with a random `SERVICE_KEY`, got 401 on every inference call, and saw the
 *     chain tier down to Gemini as though the *model* had failed. The cause was
 *     a config fault reported as a provider fault.
 *   - The production branch of the schema was the only branch that required
 *     these at all, and no test ever executed it.
 *
 * `scripts/setup-dev-env.mjs` writes a real `crypto.randomBytes(32)` secret into
 * `backend/.env` on first run, so the ergonomic problem the mint solved no
 * longer exists. The schema above now requires both in every environment, which
 * makes this function's failure branch genuinely unreachable rather than
 * unreachable-in-production.
 */
export function requireSecret(name) {
  if (!SECRET_NAMES.has(name)) {
    throw new Error(`Unknown secret requested: ${name}`);
  }

  const value = env[name];
  if (!value) {
    // Unreachable via loadEnv, which refuses to boot without both. Kept because
    // `env` is a plain object that tests mutate.
    throw new Error(`Missing ${name} — run: node scripts/setup-dev-env.mjs`);
  }
  return value;
}
