/**
 * Query-key registry — re-exported from `shared/client/queryKeys.ts`.
 *
 * Moved out of this app when the mobile client landed: both surfaces cache the
 * same resources, and two key registries would drift into two invalidation
 * bugs. This module stays so existing `@/api/queryKeys` imports keep resolving.
 */
export * from '@shared/client/queryKeys';
