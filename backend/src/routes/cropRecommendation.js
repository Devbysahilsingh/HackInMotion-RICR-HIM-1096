/**
 * Crop recommendation (docs/api/intelligence.md:
 * "POST /crop-recommendation | Auth · 20/day | Req {farmId, season, preference?}
 *  → ranked crops + reasons + cautions + sources. Errors: 404, 422.").
 *
 * "Pure function over registry + KB — no external calls at request time."
 * The engine is pure; this route reads the registry and the caller's farm and
 * hands both to it.
 *
 * `farmId` arrives in the *body*, not the path, so `loadOwned` — which reads a
 * route param — cannot be used directly. Ownership is therefore applied the
 * same way it would be: the farm is fetched with `userId` in the filter, so the
 * database never returns another farmer's holding, and a farm the caller does
 * not own is a 404 rather than a 403 (invariant AU-2).
 */
import { Router } from 'express';
import { z } from 'zod';

import { SEASONS } from '../config/constants.js';
import { cropRecommendationLimiter } from '../middleware/rateLimits.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { validate } from '../middleware/validate.js';
import { CropRegistry, Farm } from '../models/index.js';
import { recommendCrops } from '../engines/cropRec/cropRecommendation.js';
import { notFound } from '../utils/errors.js';
import { sendData } from '../utils/respond.js';

export const cropRecommendationRouter = Router();

cropRecommendationRouter.use(requireAuth);

const requestSchema = z
  .object({
    farmId: z.string().trim().min(1),
    season: z.enum(SEASONS),
    preference: z.enum(['food', 'cash', 'any']).optional(),
  })
  .strict();

cropRecommendationRouter.post(
  '/',
  cropRecommendationLimiter,
  validate({ body: requestSchema }),
  async (req, res, next) => {
    try {
      const { farmId, season, preference } = req.body;

      // Ownership in the query filter, exactly as `loadOwned` would do it.
      // A malformed id is rejected before it reaches Mongo, so a CastError
      // cannot surface as a 500 or confirm that an id was merely malformed.
      const farm = /^[a-f\d]{24}$/i.test(farmId)
        ? await Farm.findOne({ _id: farmId, userId: req.auth.userId }).lean()
        : null;
      if (!farm) return next(notFound());

      const registryCrops = await CropRegistry.find({
        supportLevel: { $ne: 'UNSUPPORTED' },
      }).lean();

      const result = recommendCrops({ registryCrops, farm, season, preference });

      sendData(res, {
        ...result,
        // The wizard's inputs, echoed so a saved result explains itself.
        request: { farmId, season, preference: preference ?? null },
      });
    } catch (err) {
      next(err);
    }
  },
);
