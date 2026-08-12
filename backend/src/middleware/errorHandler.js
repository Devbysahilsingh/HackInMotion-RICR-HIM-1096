import { AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

/** Unmatched route → canonical 404 envelope (never Express' HTML default). */
export function notFoundHandler(req, res) {
  res.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', messageKey: 'errors.routeNotFound' },
  });
}

/**
 * Terminal error handler. Clients receive the canonical envelope only:
 * no stack traces, driver messages, paths or configuration ever leave here
 * (docs/api/error-codes.md, docs/security/api-security.md).
 */
// eslint-disable-next-line no-unused-vars -- Express identifies error handlers by arity (4 args).
export function errorHandler(err, req, res, next) {
  const isKnown = err instanceof AppError;
  const status = isKnown ? err.status : 500;

  const log = logger.child({ requestId: req.id });
  if (status >= 500) {
    log.error({ err }, 'request failed');
  } else {
    log.warn({ code: err.code, messageKey: err.messageKey }, 'request rejected');
  }

  res.status(status).json({
    success: false,
    error: {
      code: isKnown ? err.code : 'INTERNAL_ERROR',
      messageKey: isKnown ? err.messageKey : 'errors.internal',
      ...(isKnown && err.details ? { details: err.details } : {}),
    },
  });
}
