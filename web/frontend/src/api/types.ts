/**
 * Wire types — re-exported from the canonical copy in `shared/types/api.ts`.
 *
 * The file moved out of this app when the mobile client landed: both surfaces
 * consume the same `/api/v1` contract, so a second transcription of it would
 * be a second thing to keep in sync (docs/mobile/technology-decision.md —
 * "Mobile duplicates NO business logic: same REST contract"). This module
 * stays so that the ~40 existing `@/api/types` imports keep resolving.
 */
export * from '@shared/types/api';
