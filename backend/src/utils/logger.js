/**
 * Structured logging with secret redaction.
 * Nothing sensitive may reach the log stream (docs/security/secrets-management.md).
 *
 * The list below is deliberately broader than the obvious `password` case:
 * ST-70's log-redaction spot checks exercise credential-bearing request
 * bodies, and a token that reaches disk is a token that has leaked.
 */
import pino from 'pino';
import { env, isProd } from '../config/env.js';

const redactPaths = [
  // Headers that carry credentials in either direction.
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-service-key"]',
  'res.headers["set-cookie"]',

  /**
   * pino-http logs the *whole* header bag on every request, so any
   * credential-bearing header not named here is written verbatim to the log
   * stream. `x-api-key` is the one that mattered: it is what a mobile client or
   * an integrator reaches for by default, and it was being logged in full.
   * `proxy-authorization` and `x-goog-api-key` are listed for the same reason —
   * naming only the headers we happen to send ourselves is what left the gap.
   */
  'req.headers["x-api-key"]',
  'req.headers["x-goog-api-key"]',
  'req.headers["x-auth-token"]',
  'req.headers["proxy-authorization"]',

  /**
   * The same header names again, unanchored.
   *
   * The paths above only match the object pino-http builds. A header bag
   * logged from anywhere else — an outbound request's config hanging off a
   * provider error, a header object passed straight to `logger.warn` — sits at
   * a different path and was redacted by none of them.
   */
  'authorization',
  '*.authorization',
  '*.*.authorization',
  'cookie',
  '*.cookie',
  '*.*.cookie',

  // Credentials anywhere in a logged object, at the top level or one nesting
  // deep (pino wildcards match a single segment, so both forms are listed).
  'password',
  '*.password',
  '*.*.password',
  'currentPassword',
  '*.currentPassword',
  'newPassword',
  '*.newPassword',
  'passwordHash',
  '*.passwordHash',

  // Tokens: raw, hashed, and every name the auth flow uses for them.
  'token',
  '*.token',
  '*.*.token',
  'accessToken',
  '*.accessToken',
  'refreshToken',
  '*.refreshToken',
  'tokenHash',
  '*.tokenHash',
  'rt',
  '*.rt',

  // Configuration that must never be echoed into a log line.
  'MONGODB_URI',
  '*.MONGODB_URI',
  'JWT_SECRET',
  '*.JWT_SECRET',
  'SERVICE_KEY',
  '*.SERVICE_KEY',
  'CLOUDINARY_URL',
  '*.CLOUDINARY_URL',

  /**
   * Provider credentials.
   *
   * Every one of these was absent, so the four keys the platform actually
   * holds — and any object carrying them, `env` included — logged in full.
   * They are secrets by exactly the same argument as JWT_SECRET (rule 11), and
   * leaving them out was an omission rather than a decision: the list was
   * written before the Phase 2/3 providers existed and never revisited when
   * they landed.
   */
  'GEMINI_API_KEY',
  '*.GEMINI_API_KEY',
  'OPENROUTER_API_KEY',
  '*.OPENROUTER_API_KEY',
  'OPENWEATHER_API_KEY',
  '*.OPENWEATHER_API_KEY',
  'DATAGOVIN_API_KEY',
  '*.DATAGOVIN_API_KEY',

  /** The generic spellings the same material arrives under. */
  'apiKey',
  '*.apiKey',
  'api_key',
  '*.api_key',
  'secret',
  '*.secret',
];

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: { paths: redactPaths, censor: '[redacted]' },
  // Human-readable in development; JSON in production for the host log stream.
  transport: isProd ? undefined : { target: 'pino-pretty', options: { colorize: true } },
});

export { redactPaths };
