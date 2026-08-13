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
import { logger } from '../utils/logger.js';

const DAY_MS = 24 * 60 * 60 * 1000;

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
  await destroyImages(
    healthLogs.map((log) => log.imagePublicId),
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
async function destroyImages(publicIds, destroy) {
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
