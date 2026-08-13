/**
 * Market endpoints (docs/api/market.md).
 *
 * Both routes are authenticated but only one is ownership-scoped: mandi prices
 * are public data with no `userId`, while `/market/my-crops` reads the caller's
 * crops and is filtered by `userId` in the query.
 *
 * No prediction endpoints exist and none may be added (NFR-7 / market-insights:
 * "Never: predictions, guarantees, 'will rise'"). The signal is a description
 * of what prices have already done.
 *
 * `/market/compare` is specified as P1 and is deliberately NOT built here — it
 * sits outside this approved TODO's scope.
 */
import { Router } from 'express';
import { z } from 'zod';

import { MARKET_QUERY_MAX_DAYS } from '../config/constants.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { validate } from '../middleware/validate.js';
import { myCropSignals, priceSeries, resolveCommodity } from '../services/marketService.js';
import { notFound } from '../utils/errors.js';
import { sendData } from '../utils/respond.js';

export const marketRouter = Router();

marketRouter.use(requireAuth);

const pricesQuerySchema = z
  .object({
    commodity: z.string().trim().min(1).max(40),
    state: z.string().trim().min(1).max(60).optional(),
    district: z.string().trim().min(1).max(60).optional(),
    /** validation.md: "date ranges ≤90d" — the same bound as the ingest gate. */
    days: z.coerce.number().int().positive().max(MARKET_QUERY_MAX_DAYS).default(30),
  })
  .strict();

marketRouter.get('/prices', validate({ query: pricesQuerySchema }), async (req, res, next) => {
  try {
    const { commodity, state, district, days } = req.query;

    // An unmapped commodity is a 404 rather than an empty series: "we have no
    // such commodity" and "we have no prices for it today" are different
    // answers, and conflating them hides a broken alias map.
    const commodityCode = await resolveCommodity(commodity);
    if (!commodityCode) return next(notFound('market.commodityNotFound'));

    sendData(res, await priceSeries({ commodityCode, state, district, days }));
  } catch (err) {
    next(err);
  }
});

const myCropsQuerySchema = z
  .object({
    days: z.coerce.number().int().positive().max(MARKET_QUERY_MAX_DAYS).default(30),
  })
  .strict();

marketRouter.get('/my-crops', validate({ query: myCropsQuerySchema }), async (req, res, next) => {
  try {
    const crops = await myCropSignals(req.auth.userId, { days: req.query.days });
    sendData(res, { crops }, { meta: { total: crops.length } });
  } catch (err) {
    next(err);
  }
});
