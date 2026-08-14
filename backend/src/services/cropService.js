/**
 * Crop instance rules.
 *
 * Agronomic knowledge deliberately does not live here — it lives in
 * cropRegistry (ADR-004). This service enforces only what is true of a
 * *planting*: who owns it, when it went in, and how its lifecycle may move.
 */
import {
  MAX_ACTIVE_CROPS_PER_FARM,
  SOWING_DATE_MAX_FUTURE_DAYS,
  SOWING_DATE_MAX_PAST_DAYS,
} from '../config/constants.js';
import {
  Crop,
  CropHealthLog,
  CropRegistry,
  IrrigationLog,
  Recommendation,
} from '../models/index.js';
import { AppError, validationError } from '../utils/errors.js';
import { destroyImage } from '../integrations/cloudinary.js';
import { deriveStage } from '../engines/stage/deriveStage.js';
import { toAcres } from '../utils/locationKey.js';
import { logger } from '../utils/logger.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Decorates crop documents with their registry facts and derived growth stage.
 *
 * **This lives here, in the service, because two routes need it and only one
 * used to have it.** `GET /farms/:id` returned bare crop rows while
 * `GET /crops/:id` and the crop-creation response returned decorated ones, so
 * the farm detail screen — which reads `crop.registry.names` and
 * `crop.stage.stage` — threw a TypeError on every farm that had a crop. The
 * wire contract for a crop is one shape (`CropWithStage`), so it is produced in
 * one place.
 *
 * A crop whose code is absent from the registry is decorated as UNSUPPORTED
 * with a null name rather than left undefined: the client renders a fallback
 * label for that case, and an absent key would crash it exactly as before.
 *
 * Registry lookups are batched — a list of twelve crops costs one query.
 *
 * @param {Array<import('mongoose').Document|object>} crops hydrated docs or lean rows
 * @param {Date} [asOf]
 */
export async function withStages(crops, asOf = new Date()) {
  const codes = [...new Set(crops.map((crop) => crop.cropCode))];
  const registry = await CropRegistry.find({ cropCode: { $in: codes } })
    .select('cropCode kcStages supportLevel names')
    .lean();
  const byCode = new Map(registry.map((entry) => [entry.cropCode, entry]));

  return crops.map((crop) => {
    const entry = byCode.get(crop.cropCode);
    return {
      // Tolerates both hydrated documents and `.lean()` rows.
      ...(typeof crop.toJSON === 'function' ? crop.toJSON() : crop),
      registry: entry
        ? { supportLevel: entry.supportLevel, names: entry.names }
        : { supportLevel: 'UNSUPPORTED', names: null },
      stage: deriveStage({
        sowingDate: crop.sowingDate,
        status: crop.status,
        kcStages: entry?.kcStages ?? [],
        asOf,
      }),
    };
  });
}

/**
 * Legal status moves. A crop may go forward through its life and no other way:
 * resurrecting a harvested crop would silently invalidate every ledger entry
 * and verdict computed against it.
 */
const ALLOWED_TRANSITIONS = {
  planned: ['planned', 'active'],
  active: ['active', 'harvested'],
  harvested: ['harvested'],
};

export function assertSowingDateInRange(sowingDate) {
  const now = Date.now();
  const earliest = now - SOWING_DATE_MAX_PAST_DAYS * DAY_MS;
  const latest = now + SOWING_DATE_MAX_FUTURE_DAYS * DAY_MS;
  const value = sowingDate.getTime();

  if (value < earliest || value > latest) {
    throw validationError([{ field: 'sowingDate', rule: 'out_of_range' }]);
  }
}

export function assertTransitionAllowed(from, to) {
  if (!ALLOWED_TRANSITIONS[from]?.includes(to)) {
    throw validationError([{ field: 'status', rule: 'illegal_transition' }]);
  }
}

/**
 * Resolves a crop code against the registry.
 *
 * An unknown code is never rejected outright and never fabricated into
 * knowledge: the farmer's crop is recorded as 'OTHER' with their own label, so
 * the platform features still work while the app says plainly that it has no
 * disease intelligence for it (docs/product/user-flows.md: "Never block, never
 * fabricate").
 */
export async function resolveCropCode(cropCode, freeTextLabel) {
  const entry = await CropRegistry.findOne({ cropCode }).lean();
  if (entry) return { cropCode: entry.cropCode, freeTextLabel: undefined };

  if (!freeTextLabel) {
    throw validationError([{ field: 'cropCode', rule: 'unknown_requires_label' }]);
  }
  return { cropCode: 'OTHER', freeTextLabel };
}

/**
 * Enforces the per-farm crop ceiling.
 *
 * Counts `planned` as well as `active`: a planned crop becomes active by a
 * single PATCH, so counting only active ones let a farm hold any number of
 * crops that were merely sown with a future date and then promoted. The check
 * therefore runs on creation *and* on any transition into `active`.
 *
 * `harvested` is excluded on purpose — a finished crop occupies no ground.
 *
 * @param {string} farmId
 * @param {string} [excludeCropId] the crop being transitioned, so it is not
 *   counted against its own capacity check
 */
export async function assertFarmHasCapacity(farmId, excludeCropId) {
  const filter = { farmId, status: { $in: ['planned', 'active'] } };
  if (excludeCropId) filter._id = { $ne: excludeCropId };

  const occupying = await Crop.countDocuments(filter);
  if (occupying >= MAX_ACTIVE_CROPS_PER_FARM) {
    throw new AppError('CONFLICT', 'crop.limitReached');
  }
}

/**
 * Acre-equivalent land already committed to crops on a farm.
 *
 * Counts `planned` alongside `active` for the same reason the capacity check
 * does: a planned crop is one PATCH away from occupying ground. `harvested` is
 * excluded — finished crops free their area. A crop that recorded a value but
 * no unit (the model allows it) is read as acres, the identity conversion,
 * rather than being silently skipped — skipping it would let unlabeled rows
 * hide land from the ceiling.
 *
 * @param {string|import('mongoose').Types.ObjectId} farmId
 * @param {string|import('mongoose').Types.ObjectId} [excludeCropId]
 * @returns {Promise<number>} acres
 */
export async function allocatedCropAcres(farmId, excludeCropId) {
  const filter = { farmId, status: { $in: ['planned', 'active'] } };
  if (excludeCropId) filter._id = { $ne: excludeCropId };

  const rows = await Crop.find(filter).select('areaValue areaUnit').lean();
  return rows.reduce(
    (sum, row) => sum + (row.areaValue ? toAcres(row.areaValue, row.areaUnit ?? 'acre') : 0),
    0,
  );
}

/**
 * The land ledger: crops cannot claim more ground than the farm has.
 *
 * A 50-acre farm with 30 acres of cotton has 20 acres left, and a 25-acre
 * onion planting must be refused — on the server, because the same rule
 * enforced only in a form is one curl away from not existing. Everything is
 * compared in acre-equivalents so a hectare farm carrying bigha crops is
 * still one ledger.
 *
 * The failing detail carries `availableAcres` so the client can tell the
 * farmer how much ground is actually left rather than only that the number
 * was too big. A crop with no recorded area occupies no ledger space — area
 * is optional — so absence never blocks.
 *
 * @param {import('mongoose').Document|object} farm the already-authorized farm
 * @param {{areaValue?: number, areaUnit?: string, excludeCropId?: unknown}} input
 */
export async function assertAreaWithinFarm(farm, { areaValue, areaUnit, excludeCropId } = {}) {
  if (areaValue == null) return;

  const requested = toAcres(areaValue, areaUnit ?? 'acre');
  const allocated = await allocatedCropAcres(farm._id, excludeCropId);
  const farmAcres = toAcres(farm.sizeValue, farm.sizeUnit);

  // Tolerance absorbs float artefacts of the unit conversions, nothing more.
  if (allocated + requested > farmAcres + 1e-9) {
    const availableAcres = Math.max(0, Math.round((farmAcres - allocated) * 100) / 100);
    throw validationError(
      [{ field: 'areaValue', rule: 'exceeds_farm_area', availableAcres }],
      'crop.areaExceedsFarm',
    );
  }
}

/**
 * Stores a new crop profile photo, destroying whatever photo it replaces.
 * Mirrors `farmService.setFarmPhoto` exactly.
 *
 * Old-asset cleanup is fire-and-forget: the farmer is replacing a photo, not
 * waiting on Cloudinary to finish deleting the one they just moved past.
 *
 * @param {import('mongoose').Document} crop an already-authorized crop
 * @param {{url: string, publicId: string}} stored the result of `storeImage`
 * @param {{destroy?: Function}} [options]
 */
export async function setCropPhoto(crop, { url, publicId }, { destroy = destroyImage } = {}) {
  const previous = await Crop.findById(crop._id).select('+photoPublicId').lean();
  if (previous?.photoPublicId) {
    void destroy(previous.photoPublicId).then((result) => {
      if (!result.ok) logger.warn({ reason: result.reason }, 'previous crop photo cleanup failed');
    });
  }

  crop.set('photoUrl', url);
  crop.set('photoPublicId', publicId);
  await crop.save();
  return crop;
}

/**
 * Removes a crop's profile photo. Idempotent — a crop with no photo simply
 * saves unchanged fields.
 *
 * @param {import('mongoose').Document} crop an already-authorized crop
 * @param {{destroy?: Function}} [options]
 */
export async function removeCropPhoto(crop, { destroy = destroyImage } = {}) {
  const previous = await Crop.findById(crop._id).select('+photoPublicId').lean();
  if (previous?.photoPublicId) {
    const result = await destroy(previous.photoPublicId);
    if (!result.ok) logger.warn({ reason: result.reason }, 'crop photo cleanup failed');
  }

  crop.set('photoUrl', undefined);
  crop.set('photoPublicId', undefined);
  await crop.save();
  return crop;
}

/**
 * Deletes a crop and everything that hangs off it.
 *
 * ADR-002 rules out transactions, so this is ordered rather than atomic:
 * children first, parent last. A crash midway leaves orphaned children
 * unreachable but harmless, whereas deleting the parent first would leave
 * children permanently unattributable.
 */
export async function deleteCropCascade(cropId, userId, { destroy = destroyImage } = {}) {
  // `userId` is carried on every filter as defence in depth, matching the farm
  // cascade. The crop was already ownership-checked by loadOwned, but a child
  // collection could one day accept a client-named cropId — at which point a
  // cropId-only filter becomes a cross-user delete.
  await IrrigationLog.deleteMany({ cropId, userId });

  // Health logs own remote assets, so the images are destroyed before the rows
  // that point at them — otherwise the publicIds are gone and every photograph
  // is orphaned in the Cloudinary account forever, with nothing left in the
  // database to find them by. `imagePublicId` is `select: false`, so it has to
  // be asked for explicitly.
  const healthLogs = await CropHealthLog.find({ cropId, userId }).select('+imagePublicId').lean();
  // The crop's own profile photo gets the same treatment — same reasoning,
  // one asset instead of a collection of them (mirrors
  // farmService.deleteFarmCascade).
  const cropDoc = await Crop.findOne({ _id: cropId, userId }).select('+photoPublicId').lean();
  await destroyImages(
    [...healthLogs.map((log) => log.imagePublicId), cropDoc?.photoPublicId],
    destroy,
  );

  await CropHealthLog.deleteMany({ cropId, userId });
  await Recommendation.deleteMany({ cropId, userId });
  await Crop.deleteOne({ _id: cropId, userId });
}

/**
 * Best-effort remote cleanup.
 *
 * Deliberately never throws and never blocks the delete: a farmer removing a
 * crop must succeed even when the image host is down. An asset we could not
 * remove is a storage-quota problem to be reconciled later; a half-deleted crop
 * is a correctness problem the farmer sees immediately.
 */
export async function destroyImages(publicIds, destroy) {
  const results = await Promise.allSettled(
    publicIds.filter(Boolean).map((publicId) => destroy(publicId)),
  );

  const failed = results.filter(
    (result) => result.status === 'rejected' || result.value?.ok === false,
  ).length;

  if (failed) {
    logger.warn({ failed, total: publicIds.length }, 'some crop images could not be removed');
  }
}
