/**
 * Land-unit arithmetic — re-exported from `shared/client/units.ts`.
 *
 * Moved out of this app when the mobile client landed. The conversion table
 * has to agree with `backend/src/utils/locationKey.js` or a form promises an
 * area the server rejects; keeping one client copy means there is one place
 * for that agreement to hold rather than two.
 */
export * from '@shared/client/units';
