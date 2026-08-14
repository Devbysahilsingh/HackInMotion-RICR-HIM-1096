import { AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

/** Unmatched route → canonical 404 envelope (never Express' HTML default). */
export function notFoundHandler(req, res) {
  res.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', messageKey: 'errors.routeNotFound' },
    meta: { requestId: req.id },
  });
}

/**
 * Errors raised by Express' own body parser arrive as plain `Error`s with a
 * status already attached. Left untranslated they would surface as 500
 * INTERNAL_ERROR, which is both wrong and a failing ST-50 assertion, so they
 * are mapped onto the canonical catalogue here.
 *
 * @returns {AppError | null}
 */
function translateBodyParserError(err) {
  switch (err?.type) {
    case 'entity.too.large':
      return new AppError('PAYLOAD_TOO_LARGE', 'errors.payloadTooLarge');
    case 'entity.parse.failed':
      return new AppError('VALIDATION_ERROR', 'errors.malformedJson');
    case 'charset.unsupported':
    case 'encoding.unsupported':
      return new AppError('VALIDATION_ERROR', 'errors.unsupportedEncoding');
    default:
      return null;
  }
}

/**
 * Classifies a refusal as a security event worth its own log line.
 *
 * Every refusal already converged here, but they all left as the same
 * `request rejected` warning carrying only a code — indistinguishable, in a log
 * search, from a farmer mistyping a form. Rate-limit trips were audited and
 * upload rejections were audited on one branch of one route; failed
 * authentication and ownership refusals were recorded nowhere at all, which
 * meant the two probes an attacker actually runs — token guessing and id
 * enumeration — were the two this system could not see.
 *
 * These are log lines, not audit rows, deliberately: an audit write per 404
 * would hand an attacker a database write per request, which is the resource
 * exhaustion this pass exists to remove.
 *
 * @returns {string | null}
 */
function securityEvent(known, req) {
  if (!known) return null;

  switch (known.code) {
    case 'AUTHENTICATION_ERROR':
      return 'auth_failed';
    case 'UPLOAD_ERROR':
      return 'upload_rejected';
    case 'NOT_FOUND':
      // Only for an authenticated caller: `loadOwned` and the query-filter
      // routes answer 404 for "not yours" as well as "not there" (AU-2), so an
      // authenticated 404 is an ownership refusal. An anonymous one is an
      // ordinary bad URL and would drown the signal.
      return req.auth ? 'ownership_denied' : null;
    default:
      return null;
  }
}

/**
 * Terminal error handler. Clients receive the canonical envelope only:
 * no stack traces, driver messages, paths or configuration ever leave here
 * (docs/api/error-codes.md, docs/security/api-security.md).
 */
// eslint-disable-next-line no-unused-vars -- Express identifies error handlers by arity (4 args).
export function errorHandler(err, req, res, next) {
  const known = err instanceof AppError ? err : translateBodyParserError(err);
  const status = known ? known.status : 500;

  const log = logger.child({ requestId: req.id });
  const security = securityEvent(known, req);

  if (status >= 500) {
    // The full error — stack included — goes to the log and nowhere else.
    log.error({ err }, 'request failed');
  } else if (security) {
    // Enough to correlate a probe — who, from where, against what — and
    // nothing more. No token, no body, no id value: the point is to count
    // refusals per principal, not to reproduce the request. `originalUrl` is
    // split because the query string is caller-controlled content, and this
    // line is written on a path an attacker chooses.
    log.warn(
      {
        security,
        code: known.code,
        method: req.method,
        route: req.originalUrl.split('?')[0],
        ip: req.ip,
        userId: req.auth?.userId,
      },
      'security refusal',
    );
  } else {
    log.warn({ code: known.code, messageKey: known.messageKey }, 'request rejected');
  }

  // A response may already be streaming (or have been sent by a rate limiter);
  // writing a second body would corrupt it.
  if (res.headersSent) return;

  res.status(status).json({
    success: false,
    error: {
      code: known ? known.code : 'INTERNAL_ERROR',
      messageKey: known ? known.messageKey : 'errors.internal',
      ...(known && known.details ? { details: known.details } : {}),
    },
    meta: { requestId: req.id },
  });
}
