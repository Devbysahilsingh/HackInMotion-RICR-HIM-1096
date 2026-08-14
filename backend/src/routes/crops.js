/**
 * Crop instance endpoints (docs/api/crops.md).
 *
 * Every route reaches its document through `loadOwned`, so the nested chain
 * crop → farm → user is verified rather than assumed. A crop id belonging to
 * another farmer's farm is a 404 even if the crop's own denormalized userId
 * happened to match.
 */
import { Router } from 'express';
import { z } from 'zod';

import {
  CROP_STATUSES,
  LAND_UNITS,
  PAGE_MAX,
  PAGE_SIZE_DEFAULT,
  PAGE_SIZE_MAX,
} from '../config/constants.js';
import { loadOwned, ownedBy } from '../middleware/loadOwned.js';
import { cropPhotoLimiter, irrigationLogLimiter } from '../middleware/rateLimits.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { uploadImage, uploadRejection } from '../middleware/uploadImage.js';
import { validate } from '../middleware/validate.js';
import { Crop, CropRegistry, Farm } from '../models/index.js';
import {
  assertAreaWithinFarm,
  assertFarmHasCapacity,
  assertSowingDateInRange,
  assertTransitionAllowed,
  deleteCropCascade,
  removeCropPhoto,
  resolveCropCode,
  setCropPhoto,
  withStages,
} from '../services/cropService.js';
import {
  assertLogDateInRange,
  irrigationAdvice,
  listIrrigationLogs,
  recordIrrigation,
} from '../services/irrigationService.js';
import { fertilizerGuidance } from '../services/fertilizerService.js';
import { sanitizeImage } from '../services/imagePipeline.js';
import { storeImage } from '../integrations/cloudinary.js';
import { UPLOAD_REJECTION } from '../config/constants.js';
import { validationError } from '../utils/errors.js';
import { pageMeta, sendData, sendNoContent } from '../utils/respond.js';

export const cropsRouter = Router();

const createSchema = z
  .object({
    cropCode: z.string().trim().toUpperCase().min(1).max(40),
    /** Only meaningful when cropCode is unknown to the registry. */
    freeTextLabel: z.string().trim().min(1).max(60).optional(),
    sowingDate: z.coerce.date(),
    variety: z.string().trim().max(60).optional(),
    areaValue: z.number().positive().optional(),
    areaUnit: z.enum(LAND_UNITS).optional(),
  })
  .strict()
  // An area without a unit is not a measurement — the land ledger would have
  // to guess what "3" means, and a wrong guess miscounts someone's field.
  .superRefine((body, ctx) => {
    if (body.areaValue !== undefined && body.areaUnit === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['areaUnit'], message: 'required' });
    }
  });

const updateSchema = z
  .object({
    status: z.enum(CROP_STATUSES).optional(),
    variety: z.string().trim().max(60).optional(),
    areaValue: z.number().positive().optional(),
    areaUnit: z.enum(LAND_UNITS).optional(),
  })
  .strict();

/** Loads the crop and proves the farm above it is owned too (invariant AU-3). */
const loadCrop = loadOwned({
  model: Crop,
  param: 'id',
  as: 'crop',
  parent: { model: Farm, foreignKey: 'farmId', as: 'farm' },
});

const loadFarm = loadOwned({ model: Farm, param: 'farmId', as: 'farm' });

/**
 * `withStages` now lives in cropService so the farm detail route serves the
 * same decorated shape this one does — see the note on its definition.
 */

// ── Nested under a farm ──────────────────────────────────────────────────────

cropsRouter.post(
  '/farms/:farmId/crops',
  requireAuth,
  validate({ body: createSchema }),
  loadFarm,
  async (req, res, next) => {
    try {
      const { sowingDate, cropCode, freeTextLabel, ...rest } = req.body;

      assertSowingDateInRange(sowingDate);
      await assertFarmHasCapacity(req.farm._id);
      await assertAreaWithinFarm(req.farm, { areaValue: rest.areaValue, areaUnit: rest.areaUnit });
      const resolved = await resolveCropCode(cropCode, freeTextLabel);

      const crop = await Crop.create({
        ...rest,
        ...resolved,
        sowingDate,
        // Ownership is derived from the authenticated session and the owned
        // parent — never from anything the client sent.
        userId: req.auth.userId,
        farmId: req.farm._id,
        status: sowingDate.getTime() > Date.now() ? 'planned' : 'active',
      });

      const [payload] = await withStages([crop]);
      sendData(res, { crop: payload }, { status: 201 });
    } catch (err) {
      next(err);
    }
  },
);

cropsRouter.get('/farms/:farmId/crops', requireAuth, loadFarm, async (req, res, next) => {
  try {
    // Scoped query, not a post-filter (invariant AU-4).
    const crops = await Crop.find({ ...ownedBy(req), farmId: req.farm._id }).sort({
      sowingDate: -1,
    });
    sendData(res, { crops: await withStages(crops) });
  } catch (err) {
    next(err);
  }
});

// ── Addressed directly ───────────────────────────────────────────────────────

cropsRouter.get('/crops/:id', requireAuth, loadCrop, async (req, res, next) => {
  try {
    const [payload] = await withStages([req.crop]);
    const registry = await CropRegistry.findOne({ cropCode: req.crop.cropCode }).lean();

    sendData(res, {
      crop: payload,
      // The full registry document, so the client can render knowledge
      // without a second round trip. Null for 'OTHER' — and null is the
      // honest answer, not an empty template that looks like knowledge.
      registry: registry ?? null,
    });
  } catch (err) {
    next(err);
  }
});

cropsRouter.patch(
  '/crops/:id',
  requireAuth,
  validate({ body: updateSchema }),
  loadCrop,
  async (req, res, next) => {
    try {
      if (req.body.status) {
        assertTransitionAllowed(req.crop.status, req.body.status);
        // Promoting a planned crop consumes a slot, so the ceiling has to be
        // re-checked here — otherwise a farm fills up with planned crops and
        // promotes them past the limit one PATCH at a time.
        if (req.body.status === 'active' && req.crop.status !== 'active') {
          await assertFarmHasCapacity(req.crop.farmId, req.crop._id);
        }
      }

      // The land ledger runs against the *merged* area, same reasoning as the
      // farm-size ceiling: a PATCH may change value without unit or vice
      // versa, and only the result is meaningful. A crop ending up harvested
      // occupies no ground, so its area is not re-checked.
      if (req.body.areaValue !== undefined || req.body.areaUnit !== undefined) {
        const merged = {
          areaValue: req.body.areaValue ?? req.crop.areaValue,
          areaUnit: req.body.areaUnit ?? req.crop.areaUnit,
        };
        if (merged.areaValue != null && merged.areaUnit == null) {
          throw validationError([{ field: 'areaUnit', rule: 'required' }]);
        }
        const endStatus = req.body.status ?? req.crop.status;
        if (endStatus !== 'harvested') {
          await assertAreaWithinFarm(req.farm, { ...merged, excludeCropId: req.crop._id });
        }
      }

      Object.assign(req.crop, req.body);
      await req.crop.save();

      const [payload] = await withStages([req.crop]);
      sendData(res, { crop: payload });
    } catch (err) {
      next(err);
    }
  },
);

cropsRouter.delete('/crops/:id', requireAuth, loadCrop, async (req, res, next) => {
  try {
    await deleteCropCascade(req.crop._id, req.auth.userId);
    sendNoContent(res);
  } catch (err) {
    next(err);
  }
});

/**
 * Crop profile photo (optional) — the farmer's own picture of this planting,
 * distinct from a crop-health diagnostic scan (`POST /crop-health/analyze`).
 * Same pipeline as the farm photo route: multer memory storage → magic-byte
 * sniff + bomb guards + decode/re-encode (imagePipeline.js) → Cloudinary,
 * signed, server-chosen public id. `loadCrop` proves the farm above the crop
 * is owned too (AU-3) before a byte of the upload is buffered.
 */
cropsRouter.post(
  '/crops/:id/photo',
  requireAuth,
  cropPhotoLimiter,
  loadCrop,
  uploadImage,
  async (req, res, next) => {
    try {
      const sanitized = await sanitizeImage(req.file.buffer);
      if (!sanitized.ok) return next(uploadRejection(sanitized.reason));

      const stored = await storeImage(sanitized.jpeg);
      if (!stored.ok) return next(uploadRejection(UPLOAD_REJECTION.STORAGE_UNAVAILABLE));

      const crop = await setCropPhoto(req.crop, { url: stored.url, publicId: stored.publicId });
      const [payload] = await withStages([crop]);
      sendData(res, { crop: payload });
    } catch (err) {
      next(err);
    }
  },
);

cropsRouter.delete('/crops/:id/photo', requireAuth, loadCrop, async (req, res, next) => {
  try {
    // 204, matching `DELETE /farms/:id/photo`'s own convention.
    await removeCropPhoto(req.crop);
    sendNoContent(res);
  } catch (err) {
    next(err);
  }
});

// ── Irrigation (docs/api/irrigation.md) ──────────────────────────────────────

/**
 * The engine runs on every read rather than being cached, which is affordable
 * because it is pure and its inputs are already in memory. A missing snapshot
 * is a designed 200 (`verdict:'UNAVAILABLE'`), never a 5xx: "never 5xx for
 * missing cache".
 */
cropsRouter.get('/crops/:id/irrigation', requireAuth, loadCrop, async (req, res, next) => {
  try {
    sendData(res, await irrigationAdvice(req.crop, req.farm));
  } catch (err) {
    next(err);
  }
});

const irrigationLogSchema = z
  .object({
    date: z.coerce.date(),
    /** validation.md: "amountMm ∈ (0,200]" — absent means "refilled fully". */
    amountMm: z.number().gt(0).max(200).optional(),
  })
  .strict();

cropsRouter.post(
  '/crops/:id/irrigation-log',
  requireAuth,
  loadCrop,
  irrigationLogLimiter,
  validate({ body: irrigationLogSchema }),
  async (req, res, next) => {
    try {
      assertLogDateInRange(req.body.date, req.crop);

      // userId comes from the token and cropId from the already-authorized
      // document — neither is readable from the body, so no request shape can
      // write a log into another account's ledger.
      const log = await recordIrrigation({
        crop: req.crop,
        userId: req.auth.userId,
        date: req.body.date,
        amountMm: req.body.amountMm,
      });

      sendData(
        res,
        {
          log: {
            id: String(log._id),
            date: log.date,
            amountMm: log.amountMm ?? null,
            source: log.source,
          },
        },
        { status: 201 },
      );
    } catch (err) {
      next(err);
    }
  },
);

const ledgerQuerySchema = z.object({
  page: z.coerce.number().int().positive().max(PAGE_MAX).default(1),
  limit: z.coerce.number().int().positive().max(PAGE_SIZE_MAX).default(PAGE_SIZE_DEFAULT),
});

cropsRouter.get(
  '/crops/:id/irrigation-log',
  requireAuth,
  loadCrop,
  validate({ query: ledgerQuerySchema }),
  async (req, res, next) => {
    try {
      const { page, limit } = req.query;
      const { logs, total } = await listIrrigationLogs(req.crop, { page, limit });
      sendData(res, { logs }, { meta: pageMeta({ page, limit, total }) });
    } catch (err) {
      next(err);
    }
  },
);

// ── Fertilizer (docs/api/intelligence.md) ────────────────────────────────────

/**
 * Pure registry read — no computation, no LLM, no external call. Every dose is
 * served in its published unit with its source attached, and the mandatory
 * disclaimer is on every response including the uncovered-crop one.
 */
cropsRouter.get('/crops/:id/fertilizer-guidance', requireAuth, loadCrop, async (req, res, next) => {
  try {
    sendData(res, await fertilizerGuidance(req.crop));
  } catch (err) {
    next(err);
  }
});
