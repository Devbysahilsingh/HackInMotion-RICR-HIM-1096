/**
 * Yield summary across the farmer's own crops (docs/yield/yield-estimation.md).
 *
 * The per-crop detail lives on `GET /crops/:id/yield-estimate` in `crops.js`,
 * where the ownership chain crop → farm → user is verified by `loadOwned`.
 * This one is **scoped** rather than nested: it takes no id, and every query it
 * runs is filtered by `req.user.id`, so there is no identifier for a caller to
 * tamper with (authorization invariant AU-4).
 *
 * Both surfaces run the same engine path. A dashboard tile that could disagree
 * with the page it links to would be worse than no tile.
 */
import { Router } from 'express';

import { requireAuth } from '../middleware/requireAuth.js';
import { yieldSummary } from '../services/yieldService.js';
import { sendData } from '../utils/respond.js';

export const yieldRouter = Router();

yieldRouter.get('/summary', requireAuth, async (req, res, next) => {
  try {
    sendData(res, await yieldSummary(req.auth.userId));
  } catch (err) {
    next(err);
  }
});
