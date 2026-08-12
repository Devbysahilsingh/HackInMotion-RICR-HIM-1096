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

import { CROP_STATUSES, LAND_UNITS } from '../config/constants.js';
import { loadOwned, ownedBy } from '../middleware/loadOwned.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { validate } from '../middleware/validate.js';
import { Crop, CropRegistry, Farm } from '../models/index.js';
import {
  assertFarmHasCapacity,
  assertSowingDateInRange,
  assertTransitionAllowed,
  deleteCropCascade,
  resolveCropCode,
} from '../services/cropService.js';
import { deriveStage } from '../engines/stage/deriveStage.js';
import { sendData, sendNoContent } from '../utils/respond.js';

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
  .strict();

const updateSchema = z
  .object({
    status: z.enum(CROP_STATUSES).optional(),
    variety: z.string().trim().max(60).optional(),
    areaValue: z.number().positive().optional(),
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
 * Attaches the derived growth stage. Registry lookups are batched so a list of
 * twelve crops costs one query, not twelve.
 */
async function withStages(crops, asOf = new Date()) {
  const codes = [...new Set(crops.map((crop) => crop.cropCode))];
  const registry = await CropRegistry.find({ cropCode: { $in: codes } })
    .select('cropCode kcStages supportLevel names')
    .lean();
  const byCode = new Map(registry.map((entry) => [entry.cropCode, entry]));

  return crops.map((crop) => {
    const entry = byCode.get(crop.cropCode);
    return {
      ...crop.toJSON(),
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
