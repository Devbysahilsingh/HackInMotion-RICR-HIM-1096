/**
 * Security event recording.
 *
 * Auditing is best-effort by construction: a failure to write the audit row
 * must never turn a successful login into a 500, nor mask the 429 a rate
 * limiter is trying to send. Failures are logged and swallowed.
 */
import { AuditLog } from '../models/index.js';
import { logger } from '../utils/logger.js';

/**
 * Fields that must never reach the audit collection, whatever a caller passes.
 *
 * Stored lower-cased because the lookup lower-cases the incoming key: writing
 * `refreshToken` here would silently never match, which is exactly the bug the
 * ST-70 audit assertion caught.
 */
const FORBIDDEN_META_KEYS = new Set(
  [
    'password',
    'currentPassword',
    'newPassword',
    'passwordHash',
    'token',
    'accessToken',
    'refreshToken',
    'tokenHash',
    'rt',
    'authorization',
    'cookie',
    'set-cookie',
    'secret',
    'jwt',
    'refresh_token',
    'access_token',
    'apikey',
    'api_key',
    'x-service-key',
    'sessionid',
  ].map((key) => key.toLowerCase()),
);

/**
 * Defence in depth: the logger redacts these on the way to the log stream, and
 * this strips them on the way to the database. A caller passing `req.body`
 * wholesale should not be able to persist a password.
 */
function scrubMeta(meta, depth = 0) {
  if (!meta || typeof meta !== 'object' || depth > 6) return {};

  // Arrays are objects too: without this branch `Object.entries([a, b])`
  // silently rewrites them as `{0: a, 1: b}`.
  if (Array.isArray(meta)) {
    return meta.map((entry) =>
      entry && typeof entry === 'object' ? scrubMeta(entry, depth + 1) : entry,
    );
  }

  const safe = {};
  for (const [key, value] of Object.entries(meta)) {
    if (FORBIDDEN_META_KEYS.has(key.toLowerCase())) continue;
    safe[key] = value && typeof value === 'object' ? scrubMeta(value, depth + 1) : value;
  }
  return safe;
}

/**
 * @param {{ event: string, userId?: string, ip?: string, meta?: Record<string, unknown> }} entry
 */
export async function record({ event, userId, ip, meta }) {
  try {
    await AuditLog.create({
      event,
      userId: userId ? String(userId) : undefined,
      ip,
      meta: scrubMeta(meta),
    });
  } catch (err) {
    logger.warn({ err, event }, 'audit write failed');
  }
}

export const auditService = { record };
