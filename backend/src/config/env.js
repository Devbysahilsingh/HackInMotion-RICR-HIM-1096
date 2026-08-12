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
