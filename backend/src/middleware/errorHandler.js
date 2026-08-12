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
 * Terminal error handler. Clients receive the canonical envelope only:
 * no stack traces, driver messages, paths or configuration ever leave here
 * (docs/api/error-codes.md, docs/security/api-security.md).
 */
// eslint-disable-next-line no-unused-vars -- Express identifies error handlers by arity (4 args).
export function errorHandler(err, req, res, next) {
  const known = err instanceof AppError ? err : translateBodyParserError(err);
  const status = known ? known.status : 500;

  const log = logger.child({ requestId: req.id });
  if (status >= 500) {
    // The full error — stack included — goes to the log and nowhere else.
    log.error({ err }, 'request failed');
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
