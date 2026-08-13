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
import { randomBytes } from 'node:crypto';
import { z } from 'zod';

const isProduction = process.env.NODE_ENV === 'production';

/** Required in production; optional in development until the feature lands. */
const productionSecret = (minLength) => {
  const base = z.string().min(minLength, `must be at least ${minLength} characters`);
  return isProduction ? base : base.optional();
};

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

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().max(65535).default(4000),
  // 'silent' exists so test runs are not drowned in request logs.
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

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
  JWT_SECRET: productionSecret(32),
  SERVICE_KEY: productionSecret(32),

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
 * @returns {z.infer<typeof envSchema>}
 */
export function loadEnv(source = process.env) {
  const result = envSchema.safeParse(source);

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
 * Secrets are optional in development so local scaffolding is not blocked on
 * credentials that do not exist yet. When one is absent we mint a random value
 * for this process only: no fixed development key exists to be copied, leaked
 * or accidentally trusted, and tokens simply stop verifying after a restart.
 * Production never reaches this path — the schema above already refused to boot.
 */
const ephemeralSecrets = new Map();

export function requireSecret(name) {
  const value = env[name];
  if (value) return value;
  if (isProd) throw new Error(`Missing ${name}`); // unreachable: schema enforces it
  if (!ephemeralSecrets.has(name)) {
    ephemeralSecrets.set(name, randomBytes(32).toString('hex'));
  }
  return ephemeralSecrets.get(name);
}
