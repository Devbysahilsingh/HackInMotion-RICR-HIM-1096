/**
 * Typed application errors mapping to the canonical API error envelope.
 * Codes and HTTP statuses: docs/api/error-codes.md
 */

/** @typedef {'VALIDATION_ERROR'|'AUTHENTICATION_ERROR'|'AUTHORIZATION_ERROR'|'NOT_FOUND'|'CONFLICT'|'RATE_LIMITED'|'EXTERNAL_SERVICE_ERROR'|'AI_ERROR'|'ML_ERROR'|'UPLOAD_ERROR'|'DATABASE_ERROR'|'INTERNAL_ERROR'} ErrorCode */

/** @type {Record<ErrorCode, number>} */
export const ERROR_STATUS = {
  VALIDATION_ERROR: 422,
  AUTHENTICATION_ERROR: 401,
  AUTHORIZATION_ERROR: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  EXTERNAL_SERVICE_ERROR: 503,
  AI_ERROR: 502,
  ML_ERROR: 502,
  UPLOAD_ERROR: 400,
  DATABASE_ERROR: 500,
  INTERNAL_ERROR: 500,
};

export class AppError extends Error {
  /**
   * @param {ErrorCode} code
   * @param {string} messageKey i18n key rendered by the client — never display text
   * @param {{ details?: unknown[], cause?: unknown }} [options]
   */
  constructor(code, messageKey, options = {}) {
    super(`${code}: ${messageKey}`, { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.messageKey = messageKey;
    this.status = ERROR_STATUS[code] ?? 500;
    this.details = options.details;
  }
}

export const notFound = (messageKey = 'errors.notFound') => new AppError('NOT_FOUND', messageKey);
