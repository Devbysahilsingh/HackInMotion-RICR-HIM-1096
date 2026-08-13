/**
 * Community outbreak alerts (docs/api/intelligence.md, FR-CM1).
 *
 *   GET /community/alerts?district=&state=   Auth
 *
 * **There is no write API, by design** (docs/community/community-alerts.md:
 * "No write API — aggregation only"). The only writer is the 6-hourly job, so
 * no request can create, amend or delete an advisory — which is what makes the
 * ≥3-distinct-farmer threshold impossible to game from the outside.
 *
 * Authenticated but unscoped (AU-6): the documents are district-level counts
 * that belong to no farmer and contain no field capable of identifying one.
 * Authentication is still required because the alert set a caller sees is
 * derived from their own farms when no district is given, and because an
 * unauthenticated endpoint would let anyone enumerate outbreak data across
 * India for free.
 */
import { Router } from 'express';
import { z } from 'zod';

import { requireAuth } from '../middleware/requireAuth.js';
import { validate } from '../middleware/validate.js';
import { listCommunityAlerts } from '../services/communityService.js';
import { sendData } from '../utils/respond.js';

export const communityRouter = Router();

communityRouter.use(requireAuth);

const alertsQuerySchema = z
  .object({
    // Bounded and trimmed: both land in a database filter, and the sanitizer
    // has already removed operator-shaped keys.
    district: z.string().trim().min(1).max(80).optional(),
    state: z.string().trim().min(1).max(80).optional(),
  })
  .strict();

communityRouter.get('/alerts', validate({ query: alertsQuerySchema }), async (req, res, next) => {
  try {
    const { district, state } = req.query;

    const alerts = await listCommunityAlerts(req.auth.userId, { district, state });

    sendData(res, { alerts });
  } catch (err) {
    next(err);
  }
});
