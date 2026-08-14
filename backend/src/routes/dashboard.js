/**
 * Dashboard and feed endpoints (docs/api/recommendations.md).
 *
 * `/dashboard` is "the single most important endpoint" and is contracted to be
 * "one aggregation, zero external calls" with a p95 under 800ms. It reads only
 * what the jobs have already cached.
 *
 * Every route is scoped to the caller: the feed and history filter by `userId`
 * in the query (AU-4, never post-filtered), and the acknowledge route loads its
 * document through `loadOwned`, so another farmer's recommendation id is a 404.
 */
import { Router } from 'express';
import { z } from 'zod';

import { PAGE_MAX, PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX } from '../config/constants.js';
import { loadOwned } from '../middleware/loadOwned.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { validate } from '../middleware/validate.js';
import { Recommendation } from '../models/index.js';
import { dashboard } from '../services/feedService.js';
import { sendData, sendNoContent, pageMeta } from '../utils/respond.js';

export const dashboardRouter = Router();
export const recommendationsRouter = Router();

dashboardRouter.use(requireAuth);
recommendationsRouter.use(requireAuth);

dashboardRouter.get('/', async (req, res, next) => {
  try {
    sendData(res, await dashboard(req.auth.userId));
  } catch (err) {
    next(err);
  }
});

const historyQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().max(PAGE_MAX).default(1),
    limit: z.coerce.number().int().positive().max(PAGE_SIZE_MAX).default(PAGE_SIZE_DEFAULT),
  })
  .strict();

/** "Full history incl. acknowledged/expired." Newest first. */
recommendationsRouter.get('/', validate({ query: historyQuerySchema }), async (req, res, next) => {
  try {
    const { page, limit } = req.query;
    const filter = { userId: req.auth.userId };

    const [items, total] = await Promise.all([
      Recommendation.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Recommendation.countDocuments(filter),
    ]);

    sendData(
      res,
      {
        recommendations: items.map((item) => ({
          id: String(item._id),
          type: item.type,
          priority: item.priority,
          source: item.source,
          titleKey: item.titleKey,
          bodyKey: item.bodyKey,
          data: item.data,
          farmId: item.farmId ? String(item.farmId) : null,
          cropId: item.cropId ? String(item.cropId) : null,
          validUntil: item.validUntil,
          acknowledgedAt: item.acknowledgedAt ?? null,
          createdAt: item.createdAt,
        })),
      },
      { meta: pageMeta({ page, limit, total }) },
    );
  } catch (err) {
    next(err);
  }
});

/**
 * Acknowledge. Idempotent — a second ack is another 204, matching the logout
 * precedent. Acking an already-expired item is legal: the farmer is clearing
 * their history view, and refusing would be a confusing 409 for a no-op.
 */
recommendationsRouter.post(
  '/:id/ack',
  loadOwned({ model: Recommendation, as: 'recommendation' }),
  async (req, res, next) => {
    try {
      if (!req.recommendation.acknowledgedAt) {
        await Recommendation.updateOne(
          { _id: req.recommendation._id, userId: req.auth.userId },
          { $set: { acknowledgedAt: new Date() } },
        );
      }
      sendNoContent(res);
    } catch (err) {
      next(err);
    }
  },
);
