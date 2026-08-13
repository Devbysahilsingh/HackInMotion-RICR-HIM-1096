/**
 * Error normalisation — re-exported from `shared/client/errors.ts`.
 *
 * It moved out of this app alongside the wire types when the mobile client
 * landed. `ApiError.isRetryable` is a *policy* (which failures are worth a
 * second attempt), and a policy that exists twice is a policy that drifts.
 * This module stays so existing `@/api/errors` imports keep resolving.
 */
export * from '@shared/client/errors';
