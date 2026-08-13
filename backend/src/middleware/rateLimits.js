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
      meta: { route: req.path, userAgent: storedUserAgent(req) },
    })
    .catch((err) => logger.warn({ err }, 'rate-limit audit failed'));

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
