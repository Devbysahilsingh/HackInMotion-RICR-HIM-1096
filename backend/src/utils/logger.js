/**
 * Structured logging with secret redaction.
 * Nothing sensitive may reach the log stream (docs/security/secrets-management.md).
 */
import pino from 'pino';
import { env, isProd } from '../config/env.js';

const redactPaths = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-service-key"]',
  'res.headers["set-cookie"]',
  'password',
  '*.password',
  'token',
  '*.token',
];

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: { paths: redactPaths, censor: '[redacted]' },
  // Human-readable in development; JSON in production for the host log stream.
  transport: isProd ? undefined : { target: 'pino-pretty', options: { colorize: true } },
});

export { redactPaths };
