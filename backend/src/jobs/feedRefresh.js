/**
 * Feed refresh — every 30 minutes (docs/api/recommendations.md:
 * "feed-refresh job (30min): per user with active crops → run engines → upsert
 * recommendations").
 *
 * Reads cached snapshots and prices; contacts no provider (rule 3). Idempotent:
 * every write is an upsert on the unique `dedupKey`, so running it twice in a
 * row changes nothing but `updatedAt`.
 *
 * The work is batched per user rather than per crop. A naive implementation
 * would query the registry, the snapshot and the price series once per crop;
 * this loads each of those once per user and joins in memory, which is what
 * keeps a 12-crop farmer as cheap as a 1-crop one.
 */
import { computeIrrigation } from '../engines/irrigation/computeIrrigation.js';
import { assessWeatherRisks } from '../engines/weatherRisk/weatherRisk.js';
import {
  composeFeed,
  irrigationCandidate,
  marketCandidate,
  weatherRiskCandidate,
} from '../engines/feedComposer/feedComposer.js';
import { Crop, CropRegistry, Farm, IrrigationLog, Recommendation } from '../models/index.js';
import { enforceFeedCap, persistFeedItems } from '../services/feedService.js';
import { persistWaterBalance } from '../services/irrigationService.js';
import { latestSnapshot } from '../services/weatherService.js';
import { logger } from '../utils/logger.js';

export const FEED_JOB_NAME = 'feedRefresh';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Users who have at least one active crop — nobody else has anything to say. */
export async function usersWithActiveCrops() {
  return Crop.distinct('userId', { status: 'active' });
}

/**
 * Builds every candidate item for one user.
 * Exported so a suite can assert the composition without the persistence.
 */
export async function composeForUser(userId, { asOf = new Date() } = {}) {
  const crops = await Crop.find({ userId, status: 'active' })
    .select('cropCode farmId sowingDate status waterBalance')
    .lean();

  if (crops.length === 0) return { candidates: [], crops: [], waterBalances: [] };

  const [farms, registryDocs, logs] = await Promise.all([
    Farm.find({ _id: { $in: crops.map((crop) => crop.farmId) }, userId })
      .select('soilType locationKey location')
      .lean(),
    CropRegistry.find({
      cropCode: { $in: [...new Set(crops.map((crop) => crop.cropCode))] },
    }).lean(),
    IrrigationLog.find({
      userId,
      cropId: { $in: crops.map((crop) => crop._id) },
      date: { $gte: new Date(asOf.getTime() - 30 * MS_PER_DAY) },
    })
      .select('cropId date amountMm')
      .lean(),
  ]);

  const farmById = new Map(farms.map((farm) => [String(farm._id), farm]));
  const registryByCode = new Map(registryDocs.map((doc) => [doc.cropCode, doc]));

  const logsByCrop = new Map();
  for (const log of logs) {
    const key = String(log.cropId);
    if (!logsByCrop.has(key)) logsByCrop.set(key, []);
    logsByCrop.get(key).push({ date: log.date, amountMm: log.amountMm });
  }

  // One snapshot read per distinct grid cell, not per crop.
  const snapshotByKey = new Map();
  for (const key of new Set(farms.map((farm) => farm.locationKey).filter(Boolean))) {
    snapshotByKey.set(key, await latestSnapshot(key));
  }

  const candidates = [];
  /**
   * The engine advances the soil-water ledger on every run, and this job is the
   * only place allowed to write it back (a GET must not mutate — see
   * `persistWaterBalance`). Collected here and written by the caller so this
   * function stays side-effect-free, which is what lets a suite assert the
   * composition without a database.
   */
  const waterBalances = [];

  for (const crop of crops) {
    const farm = farmById.get(String(crop.farmId));
    if (!farm) continue;

    const registry = registryByCode.get(crop.cropCode) ?? {};
    const snapshot = snapshotByKey.get(farm.locationKey);
    const daily = snapshot?.daily ?? [];

    const irrigation = computeIrrigation({
      crop: { sowingDate: crop.sowingDate, status: crop.status, waterBalance: crop.waterBalance },
      registry,
      soilType: farm.soilType,
      dailyWeather: daily,
      logs: logsByCrop.get(String(crop._id)) ?? [],
      asOf,
    });

    waterBalances.push({ cropId: crop._id, result: irrigation });

    const irrigationItem = irrigationCandidate({
      userId,
      farmId: crop.farmId,
      cropId: crop._id,
      cropCode: crop.cropCode,
      result: irrigation,
      asOf,
    });
    if (irrigationItem) candidates.push(irrigationItem);

    const assessment = assessWeatherRisks({
      daily,
      sensitivity: registry.sensitivity,
      stage: irrigation.stage,
      cropStatus: crop.status,
      asOf,
    });

    for (const risk of assessment.risks) {
      const item = weatherRiskCandidate({
        userId,
        farmId: crop.farmId,
        cropId: crop._id,
        cropCode: crop.cropCode,
        risk,
        asOf,
      });
      if (item) candidates.push(item);
    }
  }

  return { candidates, crops, waterBalances };
}

/**
 * Market items depend on a *flip* against yesterday's signal, so the previous
 * trend is read back from the last market item this user received rather than
 * recomputed — the feed itself is the record of what they were last told.
 */
async function marketCandidatesFor(userId, cropCodes, asOf) {
  if (cropCodes.length === 0) return [];

  const { myCropSignals } = await import('../services/marketService.js');
  const signals = await myCropSignals(userId, {});

  const previous = await Recommendation.find({ userId, type: 'market' })
    .sort({ createdAt: -1 })
    .limit(50)
    .select('data')
    .lean();

  const previousByCrop = new Map();
  for (const item of previous) {
    const code = item.data?.cropCode;
    if (code && !previousByCrop.has(code)) previousByCrop.set(code, item.data.trend);
  }

  return signals
    .map((entry) =>
      marketCandidate({
        userId,
        cropCode: entry.cropCode,
        signal: entry.signal,
        previousTrend: previousByCrop.get(entry.cropCode),
        district: entry.district,
        asOf,
      }),
    )
    .filter(Boolean);
}

/**
 * @param {{asOf?: Date, userIds?: string[]}} [options]
 * @returns {Promise<object>} the run report
 */
export async function runFeedRefresh({ asOf = new Date(), userIds } = {}) {
  const startedAt = Date.now();
  const users = userIds ?? (await usersWithActiveCrops());

  const report = {
    job: FEED_JOB_NAME,
    startedAt: asOf.toISOString(),
    users: users.length,
    candidates: 0,
    inserted: 0,
    updated: 0,
    deduped: 0,
    capped: 0,
    evicted: 0,
    waterBalancesPersisted: 0,
    failures: [],
    ok: true,
  };

  for (const userId of users) {
    try {
      const { candidates, crops, waterBalances } = await composeForUser(userId, { asOf });

      // Advance the stored ledger before composing the feed. The engine ran
      // above; without this the depletion it computed is discarded and every
      // subsequent run restarts from the same stored value, so the soil-water
      // model never actually accumulates. Writes are per-crop and idempotent
      // for a given `asOf`.
      const persistedBalances = await Promise.all(
        waterBalances.map(({ cropId, result }) =>
          persistWaterBalance(Crop, cropId, userId, result, asOf),
        ),
      );
      report.waterBalancesPersisted += persistedBalances.filter(Boolean).length;

      const market = await marketCandidatesFor(
        userId,
        [...new Set(crops.map((crop) => crop.cropCode))],
        asOf,
      );

      const all = [...candidates, ...market];
      report.candidates += all.length;

      const { items, dropped } = composeFeed({ candidates: all, asOf });
      report.deduped += dropped.duplicates;
      report.capped += dropped.capped;

      const persisted = await persistFeedItems(items);
      report.inserted += persisted.inserted;
      report.updated += persisted.updated;

      const { evicted } = await enforceFeedCap(userId, asOf);
      report.evicted += evicted;
    } catch (err) {
      // One user's bad data must not deprive every other user of a feed.
      report.ok = false;
      report.failures.push({ userId: String(userId), error: err.message });
      logger.error({ err, userId: String(userId) }, 'feed refresh failed for user');
    }
  }

  report.durationMs = Date.now() - startedAt;
  const log = report.ok ? logger.info.bind(logger) : logger.warn.bind(logger);
  log({ report }, 'feed refresh complete');

  return report;
}
