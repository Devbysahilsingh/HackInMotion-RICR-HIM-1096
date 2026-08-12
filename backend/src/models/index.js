/**
 * Model registry.
 *
 * Importing this module registers every schema with Mongoose, which is what
 * makes `syncIndexes()` able to build the whole index set — the build script,
 * the index-assertion test and the deploy gate all rely on that. Import this
 * barrel, not individual files, anywhere the full set must be present.
 *
 * 14 collections (docs/database/schema.md). Two carry schemas but take no
 * writes in the MVP: communityAlerts (P2) and yieldEstimates (P3, reserved).
 */
export { User } from './User.js';
export { RefreshToken } from './RefreshToken.js';
export { Farm } from './Farm.js';
export { Crop } from './Crop.js';
export { CropRegistry } from './CropRegistry.js';
export { CropHealthLog } from './CropHealthLog.js';
export { IrrigationLog } from './IrrigationLog.js';
export { WeatherSnapshot } from './WeatherSnapshot.js';
export { MarketPrice } from './MarketPrice.js';
export { Recommendation } from './Recommendation.js';
export { CommunityAlert } from './CommunityAlert.js';
export { YieldEstimate } from './YieldEstimate.js';
export { AuditLog } from './AuditLog.js';
export { SeedMeta } from './SeedMeta.js';

/** Collection names as documented — the index test asserts against this list. */
export const COLLECTIONS = [
  'users',
  'refreshTokens',
  'farms',
  'crops',
  'cropRegistry',
  'cropHealthLogs',
  'irrigationLogs',
  'weatherSnapshots',
  'marketPrices',
  'recommendations',
  'communityAlerts',
  'yieldEstimates',
  'auditLogs',
  'seedMeta',
];
