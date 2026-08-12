/**
 * Crop registry endpoints (docs/api/crops.md).
 *
 * Public: the registry is reference knowledge, identical for every farmer and
 * containing nothing personal. Making it public is what lets the mobile client
 * prefetch it for offline use before a farmer has logged in.
 *
 * The response is a projection, not the stored document — internal seeding
 * fields stay server-side.
 */
import { Router } from 'express';
import { createHash } from 'node:crypto';
import { z } from 'zod';

import { validate } from '../middleware/validate.js';
import { CropRegistry } from '../models/index.js';
import { notFound } from '../utils/errors.js';
import { sendData } from '../utils/respond.js';

export const registryRouter = Router();

const querySchema = z.object({
  code: z.string().trim().toUpperCase().max(40).optional(),
});

/** Never served: how the document was produced is not the client's business. */
const INTERNAL_FIELDS = '-seedVersion -__v -createdAt -updatedAt';

/**
 * Registry content changes only when the seed runs, so a strong ETag lets the
 * client — and the mobile offline cache — skip the payload entirely.
 * docs/api/crops.md: "1h server ETag + 7d client cache".
 */
function applyCaching(res, payload) {
  const etag = `"${createHash('sha1').update(JSON.stringify(payload)).digest('base64url')}"`;
  res.set('ETag', etag);
  res.set('Cache-Control', 'public, max-age=3600');
  return etag;
}

registryRouter.get('/crops', validate({ query: querySchema }), async (req, res, next) => {
  try {
    const { code } = req.query;

    if (code) {
      const crop = await CropRegistry.findOne({ cropCode: code }).select(INTERNAL_FIELDS).lean();
      if (!crop) return next(notFound('crop.registryNotFound'));

      const etag = applyCaching(res, crop);
      if (req.get('If-None-Match') === etag) return res.status(304).end();

      return sendData(res, { crop });
    }

    // Summaries only: the full documents together are large, and a client that
    // needs one fetches it by code.
    const crops = await CropRegistry.find()
      .select('cropCode names supportLevel seasons mlSupported')
      .sort({ cropCode: 1 })
      .lean();

    const summaries = crops.map((crop) => ({
      cropCode: crop.cropCode,
      names: crop.names,
      supportLevel: crop.supportLevel,
      seasons: crop.seasons ?? [],
      mlSupported: crop.mlSupported ?? false,
    }));

    const etag = applyCaching(res, summaries);
    if (req.get('If-None-Match') === etag) return res.status(304).end();

    sendData(res, { crops: summaries }, { meta: { total: summaries.length } });
  } catch (err) {
    next(err);
  }
});
