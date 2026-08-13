/**
 * Expiry / purge sweep.
 *
 * `recommendations.validUntil` carries a plain index, deliberately NOT a TTL:
 * "expiry is a job so that items linger a further 7 days after validUntil
 * rather than vanishing the instant they lapse" — a farmer who opens the app
 * on Tuesday can still see what Monday told them, in the history endpoint,
 * while the active feed has already moved on.
 *
 * Two mechanisms therefore exist and both are needed:
 *   - the feed read filters `validUntil > now`, so lapsing is immediate;
 *   - this job deletes only what lapsed more than the grace period ago.
 *
 * Also purges orphan weather snapshots (data-lifecycle.md: "orphan locationKeys
 * purged weekly"), which is otherwise unassigned — no job in the documented
 * list owns it, so it is folded in here and the doc updated to say so.
 */
import { FEED_PURGE_GRACE_DAYS } from '../config/constants.js';
import { Farm, Recommendation, WeatherSnapshot } from '../models/index.js';
import { logger } from '../utils/logger.js';

export const EXPIRY_JOB_NAME = 'expiry';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** @param {{asOf?: Date}} [options] */
export async function runExpiry({ asOf = new Date() } = {}) {
  const startedAt = Date.now();
  const cutoff = new Date(asOf.getTime() - FEED_PURGE_GRACE_DAYS * MS_PER_DAY);

  const purgedRecommendations = await Recommendation.deleteMany({ validUntil: { $lt: cutoff } });

  // A grid cell nobody farms any more is dead weight on a 512MB cluster. The
  // live key set is read first, so a snapshot is only removed once no farm
  // refers to it — never on the strength of a stale in-memory list.
  const liveKeys = await Farm.distinct('locationKey', {
    locationKey: { $exists: true, $ne: null },
  });
  const purgedSnapshots = await WeatherSnapshot.deleteMany({ locationKey: { $nin: liveKeys } });

  const report = {
    job: EXPIRY_JOB_NAME,
    startedAt: asOf.toISOString(),
    graceDays: FEED_PURGE_GRACE_DAYS,
    purgedRecommendations: purgedRecommendations.deletedCount ?? 0,
    purgedSnapshots: purgedSnapshots.deletedCount ?? 0,
    liveLocationKeys: liveKeys.length,
    durationMs: Date.now() - startedAt,
    ok: true,
  };

  logger.info({ report }, 'expiry sweep complete');
  return report;
}
