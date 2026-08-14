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
 * Scrubs one already-parsed object in place, reporting an over-deep input
 * rather than throwing.
 *
 * Exists for bodies that do not exist yet when the app-level middleware below
 * runs. `mongoSanitize` is mounted before route matching, so it only ever sees
 * what `express.json` has parsed; a multipart body is assembled later, by
 * multer, and would otherwise never be scrubbed at all. See
 * middleware/uploadImage.js.
 *
 * @param {unknown} value
 * @returns {{ok: true, removed: boolean} | {ok: false}} `ok:false` means the
 *   input was deeper than MAX_DEPTH and must be rejected, not partially cleaned
 */
export function scrubParsed(value) {
  try {
    return { ok: true, removed: scrub(value) };
  } catch (err) {
    if (err instanceof TooDeepError) return { ok: false };
    throw err;
  }
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
        /**
         * A query string fails CLOSED, unlike a body.
         *
         * Stripping is the right answer for a body: the key is gone before it
         * can reach a filter, and Zod `.strict()` then rejects anything unknown
         * that is left. A query string is different in one decisive way —
         * several filters are *optional*. Deleting `state.$ne` from
         * `?commodity=TOMATO&state.$ne=Punjab` leaves a request that is
         * perfectly valid and means something else entirely: "no state filter",
         * i.e. every state. The probe is silently answered with MORE data than
         * the caller was entitled to ask for, and `.strict()` never sees the
         * offending key because it was removed first.
         *
         * ST-40 (`GET /market/prices never widens its filter through 'state'`)
         * caught exactly that. Rejecting is also what the module already
         * believes: a legitimate client never sends an operator key, so this
         * request is a probe, and a probe deserves a 422 rather than a helpful
         * answer.
         *
         * The offending key is deliberately NOT echoed back — reporting it
         * would reflect attacker-controlled text into the response.
         */
        return next(validationError([{ field: '(query)', rule: 'operator_key' }]));
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
