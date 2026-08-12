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

const isProduction = process.env.NODE_ENV === 'production';

/** Required in production; optional in development until the feature lands. */
const productionSecret = (minLength) => {
  const base = z.string().min(minLength, `must be at least ${minLength} characters`);
  return isProduction ? base : base.optional();
};

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().max(65535).default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  /** Comma-separated exact origins. No wildcards (docs/security/api-security.md). */
  CORS_ORIGINS: z.string().default('http://localhost:5173'),

  // ── Consumed by subsystems added in later TODOs ────────────────────────
  MONGODB_URI: isProduction
    ? z.string().url('must be a valid MongoDB connection string')
    : z.string().url().optional(),
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
