/**
 * Farm persistence (docs/api/farms.md, docs/database/data-lifecycle.md).
 *
 * Every function here takes an explicit `userId` or an already-authorized
 * document — none of them reads `req`. Ownership is decided in the middleware
 * layer (loadOwned) and re-expressed here as a query filter, never as a check
 * performed after loading (authorization invariants AU-1, AU-4).
 */
import mongoose from 'mongoose';

import { MAX_FARMS_PER_USER } from '../config/constants.js';
import { Crop, CropHealthLog, Farm, IrrigationLog, Recommendation } from '../models/index.js';
import { AppError, validationError } from '../utils/errors.js';
import { MAX_FARM_SIZE_ACRES, deriveLocationKey, toAcres } from '../utils/locationKey.js';

/**
 * The acre ceiling is enforced here rather than in Zod because a PATCH may
 * supply `sizeValue` without `sizeUnit` (or the reverse), and only the merged
 * result is meaningful. One implementation serves create and update both.
 */
function assertSizeWithinLimit(sizeValue, sizeUnit) {
  if (toAcres(sizeValue, sizeUnit) > MAX_FARM_SIZE_ACRES) {
    throw validationError([{ field: 'sizeValue', rule: 'too_big' }]);
  }
}

/**
 * Own farms with the count of crops planted on each.
 *
 * @param {string} userId
 */
export async function listFarms(userId) {
  const farms = await Farm.find({ userId }).sort({ createdAt: -1 });

  // One grouped count for the whole list rather than a query per farm. The
  // aggregation pipeline does no casting of its own, so the id is converted
  // explicitly — a string here would silently match nothing.
  const counts = await Crop.aggregate([
    { $match: { userId: new mongoose.Types.ObjectId(userId) } },
    { $group: { _id: '$farmId', count: { $sum: 1 } } },
  ]);
  const countByFarm = new Map(counts.map((row) => [String(row._id), row.count]));

  return farms.map((farm) => ({
    ...farm.toJSON(),
    cropCount: countByFarm.get(String(farm._id)) ?? 0,
  }));
}

/**
 * @param {string} userId    always from the access token, never from the body
 * @param {object} input     Zod-parsed body
 */
export async function createFarm(userId, input) {
  assertSizeWithinLimit(input.sizeValue, input.sizeUnit);

  // Counted, not enforced by an index: the cap is a product rule, and Mongo
  // has no way to express "at most N documents matching a filter". Two
  // simultaneous creates could therefore both see 9 and both succeed; the
  // failure mode is one extra farm for one farmer, which does not warrant the
  // transaction ADR-002 rules out.
  const existing = await Farm.countDocuments({ userId });
  if (existing >= MAX_FARMS_PER_USER) {
    // Namespace is `farm`, singular — the canonical set in docs/i18n/architecture.md.
    throw new AppError('CONFLICT', 'farm.limitReached');
  }

  // `userId` is written last so no field of `input` can override it, and the
  // validated body cannot carry one anyway (unknown keys are stripped).
  return Farm.create({
    ...input,
    locationKey: deriveLocationKey(input.location),
    userId,
  });
}

/**
 * @param {import('mongoose').Document} farm an already-authorized farm
 */
export async function farmWithCrops(farm) {
  const crops = await Crop.find({ userId: farm.userId, farmId: farm._id }).sort({
    sowingDate: -1,
  });
  return { farm: farm.toJSON(), crops: crops.map((crop) => crop.toJSON()) };
}

/**
 * Partial update. A location change re-runs the registration hook so the farm
 * moves to its new grid cell in the next refresh cycle; a move to a manual
 * location without coordinates clears the key rather than leaving the previous
 * cell's weather attached to a farm that is no longer in it.
 *
 * @param {import('mongoose').Document} farm an already-authorized farm
 * @param {object} patch Zod-parsed body
 */
export async function updateFarm(farm, patch) {
  assertSizeWithinLimit(patch.sizeValue ?? farm.sizeValue, patch.sizeUnit ?? farm.sizeUnit);

  Object.assign(farm, patch);
  if (patch.location) farm.set('locationKey', deriveLocationKey(patch.location));

  await farm.save();
  return farm;
}

/**
 * Cascade delete (docs/database/data-lifecycle.md: "farmer delete → cascade
 * crops, healthLogs, irrigationLogs, recommendations").
 *
 * Children go first so a mid-way failure can never leave a log pointing at a
 * farm that no longer exists — without transactions (ADR-002) some ordering
 * has to absorb the risk, and orphaned children are the worse outcome because
 * nothing would ever collect them.
 *
 * Every filter carries `userId` even though the farm is already authorized:
 * defence in depth costs one indexed field here.
 *
 * @param {import('mongoose').Document} farm an already-authorized farm
 */
export async function deleteFarmCascade(farm) {
  const userId = farm.userId;
  const farmId = farm._id;

  const cropIds = await Crop.distinct('_id', { userId, farmId });

  // Health logs carry a denormalized farmId; irrigation logs are reachable
  // only through their crop, so both routes are covered where they exist.
  await CropHealthLog.deleteMany({ userId, $or: [{ farmId }, { cropId: { $in: cropIds } }] });
  await IrrigationLog.deleteMany({ userId, cropId: { $in: cropIds } });
  await Recommendation.deleteMany({ userId, $or: [{ farmId }, { cropId: { $in: cropIds } }] });
  await Crop.deleteMany({ userId, farmId });

  await farm.deleteOne();
}
