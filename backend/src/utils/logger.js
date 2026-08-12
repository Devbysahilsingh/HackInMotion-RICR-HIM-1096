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
];

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: { paths: redactPaths, censor: '[redacted]' },
  // Human-readable in development; JSON in production for the host log stream.
  transport: isProd ? undefined : { target: 'pino-pretty', options: { colorize: true } },
});

export { redactPaths };
