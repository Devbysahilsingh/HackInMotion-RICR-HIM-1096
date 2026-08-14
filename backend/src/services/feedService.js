/**
 * Feed persistence and the dashboard aggregation.
 *
 * The composer is pure and lives in engines/; everything that touches Mongo is
 * here. `/dashboard` is "the single most important endpoint" and is contracted
 * to do "one aggregation, zero external calls" under a p95 of 800ms, so the
 * read path below is written to a fixed query budget rather than to whatever
 * the object graph suggests: a farmer with ten farms and 120 crops costs the
 * same number of round trips as one with a single crop.
 */
import { FEED_MAX_ACTIVE_PER_USER, FEED_PRIORITY_RANK, FRESHNESS } from '../config/constants.js';
import { tierConfig } from '../config/env.js';
import { deriveStage } from '../engines/stage/deriveStage.js';
import { isActive } from '../engines/feedComposer/feedComposer.js';
import {
  Crop,
  CropHealthLog,
  CropRegistry,
  Farm,
  Recommendation,
  WeatherSnapshot,
} from '../models/index.js';

/**
 * Upserts composed items.
 *
 * Keyed on `dedupKey`, whose unique index makes a re-run a no-op — the
 * idempotency the job is contracted to have is enforced by the database, not by
 * the job remembering what it did.
 *
 * `acknowledgedAt` is deliberately never cleared: a farmer who dismissed
 * "irrigate today" at 9am must not have it reappear at 9:30 when the job runs
 * again. The item's content is refreshed; its dismissal stands for the day,
 * and tomorrow's key is a different key.
 */
export async function persistFeedItems(items) {
  let inserted = 0;
  let updated = 0;

  for (const item of items) {
    // `discriminator` is a composition-time input to the dedup key, not a
    // stored field — the schema is strict, so persisting it would be rejected.
    const fields = { ...item };
    delete fields.discriminator;
    const { dedupKey } = fields;

    const result = await Recommendation.updateOne({ dedupKey }, { $set: fields }, { upsert: true });

    if (result.upsertedCount > 0) inserted += 1;
    else updated += 1;
  }

  return { inserted, updated };
}

/**
 * Enforces the per-user cap after persistence.
 *
 * The composer caps what one run produces; this caps what has *accumulated*
 * across runs, which is the number the farmer actually sees. INFO goes first
 * ("INFO evicted first — overload prevention"), then the oldest.
 *
 * Eviction shortens `validUntil` rather than deleting: the item stays in the
 * history `GET /recommendations` serves, it simply leaves the active feed.
 */
export async function enforceFeedCap(userId, asOf = new Date()) {
  const active = await Recommendation.find({
    userId,
    acknowledgedAt: { $exists: false },
    validUntil: { $gt: asOf },
  })
    .select('priority createdAt')
    .lean();

  if (active.length <= FEED_MAX_ACTIVE_PER_USER) return { evicted: 0 };

  const ordered = active.sort(
    (a, b) =>
      FEED_PRIORITY_RANK[a.priority] - FEED_PRIORITY_RANK[b.priority] ||
      new Date(b.createdAt) - new Date(a.createdAt),
  );

  const surplus = ordered.slice(FEED_MAX_ACTIVE_PER_USER);
  await Recommendation.updateMany(
    { _id: { $in: surplus.map((item) => item._id) } },
    { $set: { validUntil: asOf } },
  );

  return { evicted: surplus.length };
}

/** Hard ceiling on the candidate set pulled into memory for ordering. */
const ACTIVE_FEED_SCAN_LIMIT = 500;

/**
 * The feed a client sees: active, unacknowledged, most urgent first, max 20.
 *
 * Ordered in memory rather than by the `feed` index, because that index sorts
 * `priority: 1` — the strings ascending — which puts INFO above MEDIUM. The
 * candidate set is bounded by the cap, so the in-memory sort is over at most a
 * few dozen documents.
 */
export async function activeFeed(userId, asOf = new Date()) {
  const items = await Recommendation.find({
    userId,
    acknowledgedAt: { $exists: false },
    validUntil: { $gt: asOf },
  })
    .sort({ createdAt: -1 })
    // Deliberately far above the cap. Taking the 40 newest and *then* sorting
    // by priority would hide a CRITICAL item older than those 40 — the cap
    // normally keeps the active set at 20, but event-driven emitters (Phase 3)
    // write outside the job that enforces it. The ceiling exists only so a
    // pathological account cannot pull an unbounded set into memory.
    .limit(ACTIVE_FEED_SCAN_LIMIT)
    .lean();

  return items
    .sort(
      (a, b) =>
        FEED_PRIORITY_RANK[a.priority] - FEED_PRIORITY_RANK[b.priority] ||
        new Date(b.createdAt) - new Date(a.createdAt) ||
        String(a._id).localeCompare(String(b._id)),
    )
    .slice(0, FEED_MAX_ACTIVE_PER_USER)
    .map(toFeedItem);
}

const toFeedItem = (item) => ({
  id: String(item._id),
  type: item.type,
  priority: item.priority,
  source: item.source,
  titleKey: item.titleKey,
  bodyKey: item.bodyKey,
  data: item.data,
  confidence: item.confidence ?? null,
  farmId: item.farmId ? String(item.farmId) : null,
  cropId: item.cropId ? String(item.cropId) : null,
  validUntil: item.validUntil,
  acknowledgedAt: item.acknowledgedAt ?? null,
  createdAt: item.createdAt,
});

/**
 * `/dashboard` (docs/api/recommendations.md).
 *
 * Query budget, fixed regardless of how much the farmer owns:
 *   1 feed · 1 farms · 1 crops · 1 registry · 1 snapshots · 1 latest-market
 *   · 1 latest-health-log-per-crop
 * Every join below is done in memory over those seven result sets — no query
 * runs inside a loop.
 */
export async function dashboard(userId, { asOf = new Date() } = {}) {
  const [feed, farms, crops] = await Promise.all([
    activeFeed(userId, asOf),
    Farm.find({ userId }).select('name location soilType locationKey sizeValue sizeUnit').lean(),
    Crop.find({ userId, status: 'active' })
      .select('cropCode farmId sowingDate status photoUrl areaValue areaUnit')
      .lean(),
  ]);

  // The designed onboarding payload, not empty arrays: "Empty state (no farms)
  // → designed onboarding payload".
  if (farms.length === 0) {
    return {
      onboarding: { stepKey: 'farm.onboardingCreateFarm', ctaKey: 'farm.onboardingCreateFarmCta' },
      feed: [],
      cropCards: [],
      farmSummary: { farmCount: 0, activeCropCount: 0, districts: [] },
      systemStatus: await systemStatus(asOf, []),
    };
  }

  const farmById = new Map(farms.map((farm) => [String(farm._id), farm]));
  const locationKeys = [...new Set(farms.map((farm) => farm.locationKey).filter(Boolean))];

  const [registryDocs, snapshots, healthLogs] = await Promise.all([
    CropRegistry.find({ cropCode: { $in: [...new Set(crops.map((crop) => crop.cropCode))] } })
      .select('cropCode names kcStages supportLevel')
      .lean(),
    WeatherSnapshot.find({ locationKey: { $in: locationKeys } })
      .select('locationKey source status fetchedAt expiresAt')
      .lean(),
    // Newest first per crop (the compound index `userId_cropId_createdAt`
    // covers this filter+sort), so the first row seen for a cropId below is
    // already that crop's latest analysis.
    CropHealthLog.find({
      userId,
      cropId: { $in: crops.map((crop) => crop._id) },
      status: 'analyzed',
    })
      .select('cropId analysis.severityAssessment')
      .sort({ cropId: 1, createdAt: -1 })
      .lean(),
  ]);

  const registryByCode = new Map(registryDocs.map((doc) => [doc.cropCode, doc]));
  const latestHealthByCrop = new Map();
  for (const log of healthLogs) {
    const key = String(log.cropId);
    if (!latestHealthByCrop.has(key)) latestHealthByCrop.set(key, log);
  }

  // The feed already carries each crop's irrigation verdict, so the cards read
  // it from there instead of re-running the engine per crop.
  const irrigationByCrop = new Map();
  const marketByCrop = new Map();
  for (const item of feed) {
    if (item.type === 'irrigation' && item.cropId) irrigationByCrop.set(item.cropId, item);
    if (item.type === 'market' && item.data?.cropCode) {
      marketByCrop.set(item.data.cropCode, item);
    }
  }

  const cropCards = crops.map((crop) => {
    const registry = registryByCode.get(crop.cropCode);
    const stage = deriveStage({
      sowingDate: crop.sowingDate,
      status: crop.status,
      kcStages: registry?.kcStages ?? [],
      asOf,
    });
    const farm = farmById.get(String(crop.farmId));
    const snapshot = snapshots.find((entry) => entry.locationKey === farm?.locationKey);
    const irrigation = irrigationByCrop.get(String(crop._id));
    const market = marketByCrop.get(crop.cropCode);

    // The engine-assessed severity from the crop's most recent analyzed scan,
    // if it flagged one — 'NOT_ASSESSED' is not a flag (nothing wrong was
    // found, or nothing was found yet), and a crop nobody has ever scanned
    // reports null rather than a fabricated 'healthy' (rule 7/9).
    const latestHealth = latestHealthByCrop.get(String(crop._id));
    const severity = latestHealth?.analysis?.severityAssessment ?? null;

    return {
      cropId: String(crop._id),
      farmId: String(crop.farmId),
      cropCode: crop.cropCode,
      names: registry?.names ?? null,
      stage: stage.stage,
      stageReason: stage.reasonCode,
      irrigationVerdict: irrigation ? irrigation.data.verdict : null,
      healthFlag: severity && severity !== 'NOT_ASSESSED' ? severity : null,
      marketSignal: market ? market.data.trend : null,
      freshness: snapshotFreshness(snapshot, asOf),
      // The farmer's own photo of this planting, if they added one — never a
      // stock photo standing in for it (rule 7).
      photoUrl: crop.photoUrl ?? null,
      areaValue: crop.areaValue ?? null,
      areaUnit: crop.areaUnit ?? null,
    };
  });

  return {
    feed,
    cropCards: cropCards.sort((a, b) => a.cropCode.localeCompare(b.cropCode)),
    farmSummary: {
      farmCount: farms.length,
      activeCropCount: crops.length,
      districts: [...new Set(farms.map((farm) => farm.location?.district).filter(Boolean))].sort(),
    },
    systemStatus: await systemStatus(asOf, snapshots),
  };
}

function snapshotFreshness(snapshot, asOf) {
  if (!snapshot) return { status: FRESHNESS.PENDING, fetchedAt: null, source: null };
  const live = snapshot.status === 'ok' && asOf < new Date(snapshot.expiresAt);
  return {
    status: live ? FRESHNESS.LIVE : FRESHNESS.CACHED,
    fetchedAt: snapshot.fetchedAt,
    source: snapshot.source,
  };
}

/**
 * `systemStatus` reports only subsystems that exist.
 *
 * `ml` was hard-coded to `'down'` while Phase 3 was unbuilt, which was honest
 * then and is a lie now that the service ships and answers. It is derived from
 * configuration instead:
 *
 * - **disabled** — an operator pulled `DISABLE_ML`; the tier really is off.
 * - **not configured** — no `ML_SERVICE_URL`; nothing has been deployed to
 *   talk to, which is `pending` rather than `down`.
 * - **configured and enabled** — reported `live`.
 *
 * What this deliberately is *not* is a liveness probe. A dashboard request may
 * not call an external service (rule 3), so this describes how the tier is
 * wired, not whether it answered a second ago. A tier that is up but failing
 * shows up where it actually matters — in the analysis response's own `source`
 * and `escalationPath`, which record what really happened to a farmer's photo.
 */
async function systemStatus(asOf, snapshots) {
  const anyLive = snapshots.some(
    (snapshot) => snapshot.status === 'ok' && asOf < new Date(snapshot.expiresAt),
  );
  const anySnapshot = snapshots.length > 0;

  const { MarketPrice } = await import('../models/index.js');
  const latestPrice = await MarketPrice.findOne().sort({ date: -1 }).select('source').lean();

  const { ml } = tierConfig();

  return {
    weather: anyLive ? FRESHNESS.LIVE : anySnapshot ? FRESHNESS.CACHED : FRESHNESS.PENDING,
    market: !latestPrice
      ? FRESHNESS.PENDING
      : latestPrice.source === 'seed'
        ? FRESHNESS.HISTORICAL
        : FRESHNESS.CACHED,
    ml: ml.disabled ? 'down' : ml.configured ? FRESHNESS.LIVE : FRESHNESS.PENDING,
  };
}

export { isActive };
