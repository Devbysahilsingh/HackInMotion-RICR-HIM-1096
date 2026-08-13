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
import { env } from '../config/env.js';
import { destroyImage } from '../integrations/cloudinary.js';
import { geocodePlace } from '../integrations/openMeteoGeocoding.js';
import { Crop, CropHealthLog, Farm, IrrigationLog, Recommendation } from '../models/index.js';
import { allocatedCropAcres, destroyImages, withStages } from './cropService.js';
import { AppError, validationError } from '../utils/errors.js';
import { MAX_FARM_SIZE_ACRES, deriveLocationKey, toAcres } from '../utils/locationKey.js';
import { logger } from '../utils/logger.js';

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
export async function createFarm(userId, input, { geocode } = {}) {
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

  const location = await resolveFarmLocation(input.location, geocode);

  // `userId` is written last so no field of `input` can override it, and the
  // validated body cannot carry one anyway (unknown keys are stripped).
  return Farm.create({
    ...input,
    location,
    locationKey: deriveLocationKey(location),
    userId,
  });
}

/**
 * Produces the one canonical farm location every other feature reads.
 *
 * A farmer knows their district. They do not know their latitude, and the form
 * no longer asks for one. When coordinates are absent this resolves them from
 * the place the farmer *did* give, so the farm ends up with a `locationKey` and
 * is therefore visible to the weather job, the irrigation engine and the market
 * region — all of which key off that one field.
 *
 * Without this, a farm entered by district alone had **no** `locationKey`
 * (`deriveLocationKey` returns undefined without numbers), which meant no
 * weather for ever and a permanently `UNAVAILABLE` irrigation verdict. That was
 * the single biggest gap between "the app works" and "the app works for a
 * farmer who declined the GPS prompt".
 *
 * Three properties matter:
 *
 *   - **Device coordinates always win.** A GPS fix is more precise than a
 *     district centroid, so a supplied lat/lon is never overwritten.
 *   - **The farmer's own words are never overwritten.** The state and district
 *     they typed are kept verbatim; only genuinely missing fields are filled
 *     from the gazetteer. The app must not rename someone's district.
 *   - **Failure is not an error.** If the gazetteer cannot place them, the farm
 *     is still created with exactly what they typed. It simply has no
 *     coordinates yet, which every downstream screen already reports honestly.
 */
async function resolveFarmLocation(location, geocode) {
  const hasCoordinates = typeof location?.lat === 'number' && typeof location?.lon === 'number';
  if (hasCoordinates) return location;

  /**
   * Under test an *implicit* lookup is suppressed, for the same reason
   * weatherService.warmLocation suppresses its own: this sits on the request
   * path, so without the guard every suite that creates a farm would make a
   * live gazetteer call. An injected `geocode` is never suppressed, which is
   * how the suites exercise the resolution deliberately.
   */
  const resolve = geocode ?? (env.NODE_ENV === 'test' ? null : geocodePlace);
  if (!resolve) return location;

  const result = await resolve({
    village: location?.village,
    district: location?.district,
    state: location?.state,
  }).catch(() => ({ ok: false, reason: 'error' }));

  if (!result?.ok) {
    logger.info(
      { reason: result?.reason, district: Boolean(location?.district) },
      'farm created without coordinates — geocoding did not place it',
    );
    return location;
  }

  const { place } = result;
  return {
    ...location,
    lat: place.lat,
    lon: place.lon,
    // Only fill what the farmer left blank.
    state: location?.state || place.state || undefined,
    district: location?.district || place.district || undefined,
    // Records that these coordinates were looked up rather than measured, so a
    // reader can tell a district centroid from a real GPS fix.
    source: 'geocoded',
  };
}

/**
 * @param {import('mongoose').Document} farm an already-authorized farm
 */
export async function farmWithCrops(farm) {
  const crops = await Crop.find({ userId: farm.userId, farmId: farm._id }).sort({
    sowingDate: -1,
  });
  // Decorated, not raw. The farm detail screen reads `crop.registry.names` and
  // `crop.stage.stage`; returning bare rows here threw a TypeError and blanked
  // the page behind an error boundary for any farm that had a crop.
  return { farm: farm.toJSON(), crops: await withStages(crops) };
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
  const sizeValue = patch.sizeValue ?? farm.sizeValue;
  const sizeUnit = patch.sizeUnit ?? farm.sizeUnit;
  assertSizeWithinLimit(sizeValue, sizeUnit);

  // The farm cannot shrink underneath its crops. The crop routes stop a
  // planting from exceeding the farm; without this mirror check the same
  // inconsistency arrives from the other direction — edit the farm from 50
  // acres to 10 and the 30 acres of cotton on it become silently impossible.
  if (patch.sizeValue !== undefined || patch.sizeUnit !== undefined) {
    const allocated = await allocatedCropAcres(farm._id);
    if (toAcres(sizeValue, sizeUnit) + 1e-9 < allocated) {
      throw validationError(
        [
          {
            field: 'sizeValue',
            rule: 'below_crop_area',
            allocatedAcres: Math.round(allocated * 100) / 100,
          },
        ],
        'farm.sizeBelowCropArea',
      );
    }
  }

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
 * @param {{destroy?: Function}} [options] `destroy` is an injection seam so the
 *   suites can prove the remote cleanup happens without an account or network.
 */
export async function deleteFarmCascade(farm, { destroy = destroyImage } = {}) {
  const userId = farm.userId;
  const farmId = farm._id;

  const cropIds = await Crop.distinct('_id', { userId, farmId });

  const healthLogFilter = { userId, $or: [{ farmId }, { cropId: { $in: cropIds } }] };

  /**
   * Remote assets die before the rows that point at them, exactly as
   * `deleteCropCascade` does it.
   *
   * This used to delete the rows directly, which orphaned every photograph on
   * the farm: once `imagePublicId` is gone there is nothing left in the
   * database to find the asset by, so it stays in the Cloudinary account
   * forever. That is a free-tier quota leak (rule 10) and, worse, a privacy
   * failure — rule 12 makes images private per account, and a farmer who
   * deletes a field is entitled to have the photographs actually go away
   * rather than remain fetchable at their delivery URL.
   *
   * `imagePublicId` is `select: false`, so it has to be asked for explicitly.
   */
  const healthLogs = await CropHealthLog.find(healthLogFilter).select('+imagePublicId').lean();
  await destroyImages(
    healthLogs.map((log) => log.imagePublicId),
    destroy,
  );

  // Health logs carry a denormalized farmId; irrigation logs are reachable
  // only through their crop, so both routes are covered where they exist.
  await CropHealthLog.deleteMany(healthLogFilter);
  await IrrigationLog.deleteMany({ userId, cropId: { $in: cropIds } });
  await Recommendation.deleteMany({ userId, $or: [{ farmId }, { cropId: { $in: cropIds } }] });
  await Crop.deleteMany({ userId, farmId });

  await farm.deleteOne();
}
