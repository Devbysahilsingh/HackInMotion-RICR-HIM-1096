/**
 * Rate-limit buckets.
 *
 * Limits and windows are fixed by docs/security/api-security.md and
 * docs/security/authentication.md; they are values a test asserts, not knobs
 * a deployment can loosen. Every bucket answers with the canonical envelope
 * plus `Retry-After` (docs/api/error-codes.md) and standard rate-limit
 * headers (ST-50).
 */
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

import {
  AUDIT_EVENTS,
  HEALTH_ANALYZE_BURST_LIMIT,
  HEALTH_ANALYZE_BURST_WINDOW_MS,
  HEALTH_ANALYZE_DAILY_LIMIT,
  SYMPTOM_CHECK_DAILY_LIMIT,
} from '../config/constants.js';
import { isTest } from '../config/env.js';
import { auditService } from '../services/auditService.js';
import { storedUserAgent } from '../utils/clientContext.js';
import { logger } from '../utils/logger.js';

/** Shared 429 responder — one envelope shape for every bucket. */
function limitHandler(req, res) {
  const retryAfterSeconds = Math.max(1, Math.ceil((req.rateLimit?.resetTime - Date.now()) / 1000));

  res.set('Retry-After', String(Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : 60));

  /**
   * The route as the caller addressed it.
   *
   * `req.path` is relative to the router the limiter is mounted on, so every
   * trip recorded a stripped path: the login bucket wrote `/login`, and
   * `/logs` would have been ambiguous between two routers. The mount prefix is
   * what makes the row identifiable. The query string is dropped — it is
   * caller-controlled content, and this row is written on a path an attacker
   * chooses.
   */
  const route = req.originalUrl.split('?')[0];

  // Audited: a spike here is the brute-force signal the threat model relies on.
  // Recorded directly rather than through a helper hung off the request — that
  // indirection was never wired up, so every rate-limit trip went unaudited
  // and only the attempts *below* the threshold were recorded, which is
  // exactly backwards. Best-effort: an audit failure must never mask the 429.
  auditService
    .record({
      event: AUDIT_EVENTS.RATE_LIMITED,
      userId: req.auth?.userId,
      ip: req.ip,
      meta: { route, userAgent: storedUserAgent(req) },
    })
    .catch((err) => logger.warn({ err }, 'rate-limit audit failed'));

  // Also on the log stream, in the same shape the error handler uses for the
  // other refusal classes — an operator watching logs should not have to query
  // the database to notice a bucket emptying.
  logger.warn(
    {
      security: 'rate_limited',
      code: 'RATE_LIMITED',
      method: req.method,
      route,
      ip: req.ip,
      userId: req.auth?.userId,
      requestId: req.id,
    },
    'security refusal',
  );

  res.status(429).json({
    success: false,
    error: { code: 'RATE_LIMITED', messageKey: 'errors.rateLimited' },
    meta: { requestId: req.id },
  });
}

const baseOptions = {
  standardHeaders: 'draft-7', // RateLimit / RateLimit-Policy — asserted by ST-50
  legacyHeaders: false,
  handler: limitHandler,
  // Suites that assert limiter behaviour opt in explicitly; the rest of the
  // API suite would otherwise trip the global bucket and fail for the wrong
  // reason. This only ever loosens limits in NODE_ENV=test — never in a
  // deployed environment, where the flag does not exist.
  skip: () => isTest && process.env.RATE_LIMITS_ENABLED !== 'true',
};

/** Global ceiling: 300 requests / 15 min / IP. */
export const globalLimiter = rateLimit({
  ...baseOptions,
  windowMs: 15 * 60 * 1000,
  limit: 300,
});

/**
 * Login: 5 / 15 min, keyed on IP *and* email so neither a single address
 * hammering many accounts nor a botnet hammering one account gets through.
 * `ipKeyGenerator` normalises IPv6 into a /64 block — hand-rolling this is the
 * classic way to leave an IPv6 bypass open.
 */
export const loginLimiter = rateLimit({
  ...baseOptions,
  windowMs: 15 * 60 * 1000,
  limit: 5,
  keyGenerator: (req) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    return `${ipKeyGenerator(req.ip)}|${email}`;
  },
});

/** Registration: 10 / hour / IP. */
export const registerLimiter = rateLimit({
  ...baseOptions,
  windowMs: 60 * 60 * 1000,
  limit: 10,
});

/** Refresh: 60 / hour / IP. Generous — legitimate clients rotate often. */
export const refreshLimiter = rateLimit({
  ...baseOptions,
  windowMs: 60 * 60 * 1000,
  limit: 60,
});

/**
 * Per-*user* daily buckets.
 *
 * Every bucket above is keyed on IP, which is the right key for anonymous
 * abuse. The quotas docs/api specifies for authenticated write and compute
 * endpoints ("RL 10/day", "20/day") are per-account quotas: keying them on IP
 * would let one account exhaust a shared village connection, and would let one
 * user reset their own quota by changing networks.
 *
 * These are only mounted behind `requireAuth`, so `req.auth.userId` is always
 * present; the IP fallback exists so a misordered mount degrades to the old
 * behaviour rather than to a single global bucket for every caller.
 */
const perUserDaily = (limit) =>
  rateLimit({
    ...baseOptions,
    windowMs: 24 * 60 * 60 * 1000,
    limit,
    keyGenerator: (req) => req.auth?.userId ?? ipKeyGenerator(req.ip),
  });

/** docs/api/irrigation.md: "POST /crops/:id/irrigation-log | Auth · RL 10/day". */
export const irrigationLogLimiter = perUserDaily(10);

/** docs/api/intelligence.md: "POST /crop-recommendation | Auth · 20/day". */
export const cropRecommendationLimiter = perUserDaily(20);

/**
 * Crop-health analysis: "RL 10/day/user + 3/min burst" (docs/api/crop-health.md).
 *
 * Two buckets rather than one, because they defend different things. The daily
 * cap is a quota guard — 10 analyses sit far below the Gemini free tier's 1,500
 * requests/day, so no plausible user can exhaust the shared allowance. The
 * burst cap is an abuse guard: a script uploading as fast as it can would spend
 * a day's quota in seconds and, more to the point, would tie up the image
 * pipeline. Both are mounted, in order, on the analyze route.
 */
export const healthAnalyzeDailyLimiter = perUserDaily(HEALTH_ANALYZE_DAILY_LIMIT);

export const healthAnalyzeBurstLimiter = rateLimit({
  ...baseOptions,
  windowMs: HEALTH_ANALYZE_BURST_WINDOW_MS,
  limit: HEALTH_ANALYZE_BURST_LIMIT,
  keyGenerator: (req) => req.auth?.userId ?? ipKeyGenerator(req.ip),
});

/** docs/api/crop-health.md: "POST /crop-health/symptom-check | Auth · RL 30/day". */
export const symptomCheckLimiter = perUserDaily(SYMPTOM_CHECK_DAILY_LIMIT);

/**
 * Farm writes: 60 / hour / user.
 *
 * ## Why this bucket exists at all
 *
 * `docs/api/farms.md` declares no limit, and the reasoning recorded on the
 * router — that `MAX_FARMS_PER_USER` already bounds what repeated creates can
 * achieve — holds for the *database* and not for the side effect. Both writes
 * call `warmFarmLocation`, which spends an Open-Meteo call for any grid cell
 * that has no fresh snapshot. Cells are 0.1° (`LOCATION_KEY_PRECISION`), and
 * `INDIA_BOUNDS` spans roughly 31° by 29° — on the order of ninety thousand
 * distinct cells one farm can be walked through, one PATCH at a time. The
 * ten-farm ceiling never applies, because nothing is being created.
 *
 * So the only thing bounding provider spend was the global 300/15min/IP
 * bucket: about 28,800 writes a day from a single address, each able to cost a
 * provider call. Rule 10 requires free-tier quotas to be guarded by per-user
 * caps, and this was the one write path with no cap of its own.
 *
 * ## Why 60/hour does not harm a real farmer
 *
 * A holding is near-static. The heaviest honest session is onboarding: ten
 * farms — the hard maximum — plus corrections to each, well under forty
 * writes, and finished in one sitting rather than sustained for an hour. Sixty
 * leaves half as much headroom again above that, while cutting the per-account
 * amplification from ~28,800/day to 1,440. Hourly rather than daily so a
 * farmer who genuinely reorganises their farms twice in a week is never told
 * to come back tomorrow.
 *
 * Deletes are not counted: a delete warms nothing, and the create that a
 * delete-and-recreate loop depends on is already counted here.
 */
export const farmWriteLimiter = rateLimit({
  ...baseOptions,
  windowMs: 60 * 60 * 1000,
  limit: 60,
  keyGenerator: (req) => req.auth?.userId ?? ipKeyGenerator(req.ip),
});

/**
 * docs/api/users.md: "PATCH /users/me | Auth · RL 30/h".
 *
 * Hourly rather than daily, so it does not share `perUserDaily`. Settings are
 * not a hot path — a farmer changes a language or a consent toggle a handful of
 * times ever — and 30 an hour is far above any real use while still bounding
 * what a stolen token can do to the audit trail by flipping consent in a loop.
 */
export const profileUpdateLimiter = rateLimit({
  ...baseOptions,
  windowMs: 60 * 60 * 1000,
  limit: 30,
  keyGenerator: (req) => req.auth?.userId ?? ipKeyGenerator(req.ip),
});
