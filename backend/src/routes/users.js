/**
 * User account endpoints (docs/api/users.md).
 *
 *   PATCH /users/me   Auth · RL 30/h
 *
 * `me` is a literal, not an id: the document written is always the one the
 * access token resolved to, so there is no request shape that addresses another
 * account. That is why there is no `loadOwned` here and no `:id` anywhere —
 * `GET /auth/me` is scoped the same way, and users.md states outright that
 * there is no `GET /users/:id` and no admin user API.
 *
 * The body is deliberately narrow: preferences only. `name` and `email` are not
 * accepted (no client asks for them yet, and each would need its own
 * verification story), and the password and account-deletion flows are separate
 * P2 endpoints in users.md rather than fields here.
 */
import { Router } from 'express';
import { z } from 'zod';

import { AUDIT_EVENTS, LAND_UNITS, LANGUAGES } from '../config/constants.js';
import { profileUpdateLimiter } from '../middleware/rateLimits.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { validate } from '../middleware/validate.js';
import { auditService } from '../services/auditService.js';
import { setCommunityConsent } from '../services/communityService.js';
import { storedUserAgent } from '../utils/clientContext.js';
import { notFound } from '../utils/errors.js';
import { sendData } from '../utils/respond.js';

export const usersRouter = Router();

/** There is no anonymous view of an account. */
usersRouter.use(requireAuth);

// ── Validation ───────────────────────────────────────────────────────────────

/**
 * `.strict()` rather than the default strip, because everything a client might
 * plausibly try to smuggle in here is a field it must not be able to set —
 * `id`, `email`, `passwordHash`. Stripping them silently would answer 200 and
 * let a caller believe the change took; rejecting says what actually happened.
 *
 * `units` is validated as a whole object, like a farm's `location`: it has one
 * member today, and patching it as a unit keeps the request shape honest when a
 * second one is added.
 */
const updateMeSchema = z
  .object({
    language: z.enum(LANGUAGES).optional(),
    units: z
      .object({ land: z.enum(LAND_UNITS) })
      .strict()
      .optional(),
    voiceEnabled: z.boolean().optional(),
    communityConsent: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'at least one field is required');

const audit = (req, event, meta = {}) =>
  auditService.record({
    event,
    userId: req.auth.userId,
    ip: req.ip,
    meta: { userAgent: storedUserAgent(req), ...meta },
  });

// ── Routes ───────────────────────────────────────────────────────────────────

usersRouter.patch(
  '/me',
  profileUpdateLimiter,
  validate({ body: updateMeSchema }),
  async (req, res, next) => {
    try {
      const user = req.user;
      const { language, units, voiceEnabled, communityConsent } = req.body;
      const previousConsent = user.communityConsent;

      // Field by field, never `Object.assign(user, req.body)`: consent is not
      // written here at all (see below), and an assign would route it around
      // the one function that owns it the moment the schema grows.
      if (language !== undefined) user.language = language;
      if (units !== undefined) user.units.land = units.land;
      if (voiceEnabled !== undefined) user.voiceEnabled = voiceEnabled;

      // No-op when nothing above was supplied — Mongoose issues no update for a
      // document with no modified paths.
      await user.save();

      if (communityConsent !== undefined) {
        // Through communityService, which is where the consent flag lives and
        // where its semantics are documented (withdrawal stops future counting
        // immediately; past aggregates are anonymous counts and stay). A second
        // writer here would be a second place to review whenever that changes.
        const updated = await setCommunityConsent(req.auth.userId, communityConsent);
        // The token proved the account existed when the request arrived; it can
        // still be deleted mid-request. 404, like every other missing document.
        if (!updated) return next(notFound());

        // Assigned after `save()` purely so the response projection reflects the
        // write. It is deliberately not saved again — that would be a second
        // update of a value the service has already persisted.
        user.communityConsent = updated.communityConsent;

        // Only a real transition is recorded. Re-sending the value a farmer
        // already holds changes nothing, and an audit row for it would dilute
        // the record of when consent actually moved.
        if (updated.communityConsent !== previousConsent) {
          await audit(req, AUDIT_EVENTS.CONSENT_CHANGED, {
            communityConsent: updated.communityConsent,
          });
        }
      }

      // The same projection `/auth/me` returns — one serializer, so a field
      // added to the schema cannot start being served from here by accident.
      sendData(res, { user: user.toPublicJSON() });
    } catch (err) {
      next(err);
    }
  },
);
