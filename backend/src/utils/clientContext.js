/**
 * Client-supplied request context that gets persisted.
 *
 * Everything here is attacker-controlled, so it is bounded before it can reach
 * the database. Both call sites — refresh-token rows and audit rows — go
 * through this, so there is one place the limit is enforced rather than a
 * truncation each caller has to remember.
 */
import { MAX_STORED_USER_AGENT } from '../config/constants.js';

/** @returns {string | undefined} */
export function storedUserAgent(req) {
  const raw = req.get('User-Agent');
  if (!raw) return undefined;
  return raw.slice(0, MAX_STORED_USER_AGENT);
}

/** Request context recorded against auth events. */
export function clientContext(req) {
  return { ip: req.ip, userAgent: storedUserAgent(req) };
}
