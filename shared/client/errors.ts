import type { ApiErrorBody, ApiErrorCode } from '../types/api';

/**
 * One error shape for the whole client.
 *
 * Every failure — an API envelope, a network drop, an aborted request — is
 * normalised into this before it reaches a component, so error rendering is a
 * single `t(error.messageKey)` and never a `typeof` ladder. `messageKey`
 * always resolves: the transport failures below map onto keys that exist in
 * the `errors` namespace under `shared/i18n`.
 */
export class ApiError extends Error {
  readonly code: ApiErrorCode | 'NETWORK_ERROR' | 'TIMEOUT' | 'CANCELLED';
  readonly messageKey: string;
  readonly status: number | null;
  readonly details: unknown[];
  /**
   * Seconds to wait, from the `Retry-After` header a 429 carries.
   *
   * Kept because the alternative is telling a rate-limited farmer to "try
   * again later" without saying when — and the server already knows. Null
   * whenever the header was absent or unparseable; a made-up number would be
   * worse than none.
   */
  readonly retryAfterSeconds: number | null;

  constructor(init: {
    code: ApiError['code'];
    messageKey: string;
    status?: number | null;
    details?: unknown[];
    retryAfterSeconds?: number | null;
  }) {
    super(`${init.code}: ${init.messageKey}`);
    this.name = 'ApiError';
    this.code = init.code;
    this.messageKey = init.messageKey;
    this.status = init.status ?? null;
    this.details = init.details ?? [];
    this.retryAfterSeconds = init.retryAfterSeconds ?? null;
  }

  /** Retrying a 4xx with the same input produces the same 4xx. */
  get isRetryable(): boolean {
    if (this.code === 'NETWORK_ERROR' || this.code === 'TIMEOUT') return true;
    if (this.status === null) return false;
    return this.status >= 500 || this.status === 429;
  }

  get isAuthFailure(): boolean {
    return this.status === 401;
  }
}

export const isApiError = (value: unknown): value is ApiError => value instanceof ApiError;

/** Type guard for the documented failure envelope. */
export function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<ApiErrorBody>;
  return (
    candidate.success === false &&
    typeof candidate.error === 'object' &&
    candidate.error !== null &&
    typeof candidate.error.messageKey === 'string'
  );
}

/**
 * Field-level validation detail, as `middleware/validate.js` emits it.
 * Used to attach a server-side rejection to the form control that caused it
 * rather than dropping it into a banner the farmer has to map back by hand.
 */
export interface ValidationDetail {
  field?: string;
  path?: string;
  rule?: string;
  message?: string;
}

export function validationDetails(error: unknown): ValidationDetail[] {
  if (!isApiError(error) || error.code !== 'VALIDATION_ERROR') return [];
  return error.details.filter(
    (detail): detail is ValidationDetail => typeof detail === 'object' && detail !== null,
  );
}
