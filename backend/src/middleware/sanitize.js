/**
 * Strips MongoDB operator syntax out of untrusted input (ST-40).
 *
 * Why this is hand-written rather than `express-mongo-sanitize` from the
 * locked dependency list: that package mutates `req.query` in place, and in
 * Express 5 `req.query` is a getter-only accessor — the middleware throws on
 * every request. docs/database/validation.md already anticipated the problem
 * ("sanitize-v5/mongo-sanitize"). Thirty lines we control beat a dependency
 * that does not run, and it keeps the audited dependency count down.
 *
 * Two shapes are dangerous once a value reaches a query object:
 *   `{$gt: ''}`  — an operator smuggled in where a scalar was expected
 *   `{'a.b': 1}` — a dotted key reaching into a subdocument
 * Both are removed. Schema-level validation (Zod, then Mongoose `strict`)
 * remains the primary defence; this is the belt to that pair of braces.
 */

import { validationError } from '../utils/errors.js';

const DANGEROUS_KEY = /^\$|\./;

/** Deeper than any legitimate request body; see `scrub`. */
const MAX_DEPTH = 12;

class TooDeepError extends Error {}

/** @returns {boolean} whether anything was removed */
function scrub(value, depth = 0) {
  // Bounded recursion: a deeply nested body must not become a stack overflow.
  // Abandoning the subtree instead would leave an operator nested past the cap
  // untouched while the caller believed the body had been sanitized, so an
  // over-deep body is rejected outright rather than partially cleaned.
  if (depth > MAX_DEPTH) throw new TooDeepError();
  if (value === null || typeof value !== 'object') return false;

  let removed = false;

  if (Array.isArray(value)) {
    for (const entry of value) {
      if (scrub(entry, depth + 1)) removed = true;
    }
    return removed;
  }

  for (const key of Object.keys(value)) {
    if (DANGEROUS_KEY.test(key)) {
      delete value[key];
      removed = true;
      continue;
    }
    if (scrub(value[key], depth + 1)) removed = true;
  }

  return removed;
}

/**
 * Sanitizes body and query. `req.query` is replaced rather than mutated
 * because Express 5 exposes it through a getter.
 *
 * `req.params` is deliberately NOT handled here: this middleware is mounted at
 * the application level, so it runs before route matching, when `req.params`
 * is always empty. Path parameters are guarded instead by `loadOwned`, which
 * rejects anything that is not a valid ObjectId before it reaches a query.
 */
export function mongoSanitize(req, res, next) {
  let removed = false;

  try {
    if (req.body) removed = scrub(req.body) || removed;

    if (req.query && Object.keys(req.query).length > 0) {
      const cleaned = structuredClone(req.query);
      if (scrub(cleaned)) {
        removed = true;
        Object.defineProperty(req, 'query', {
          value: cleaned,
          writable: true,
          configurable: true,
          enumerable: true,
        });
      }
    }
  } catch (err) {
    if (err instanceof TooDeepError) {
      return next(validationError([{ field: '(root)', rule: 'too_deep' }]));
    }
    return next(err);
  }

  // Legitimate clients never send operator keys, so this is a probe.
  // The keys themselves are not recorded — only that it happened.
  if (removed) req.sanitized = true;

  next();
}
