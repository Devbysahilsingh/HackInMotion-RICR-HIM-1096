/**
 * The read side of weather: snapshot + per-crop risks, for one farm.
 *
 * **No provider is called here.** docs/api/weather.md and docs/api/farms.md both
 * describe an "immediate on-demand fetch" on the request path; CLAUDE.md rule 3
 * forbids it, and P1-5 already resolved the conflict in the rule's favour
 * (`utils/locationKey.js`: "It does not call a weather provider"). A rule in
 * CLAUDE.md overrides doc prose, so this file keeps the resolution consistent.
 *
 * What "on-demand" means instead: a farm whose cell has never been fetched gets
 * `status:'pending'` plus a retry hint, and the location is flagged as priority
 * so the next scheduler tick fetches it ahead of the routine sweep. The farmer
 * waits for the tick, not for a provider, and the request path stays DB-only.
 */
import { FRESHNESS } from '../config/constants.js';
import { Crop, CropRegistry } from '../models/index.js';
import { assessWeatherRisks } from '../engines/weatherRisk/weatherRisk.js';
import { deriveStage } from '../engines/stage/deriveStage.js';
import { freshnessOf, latestSnapshot } from './weatherService.js';

/**
 * Grid cells a reader asked for that have no snapshot yet. The weather job
 * drains this set first. In-memory and unbounded-by-design-but-small: it can
 * only ever hold as many entries as there are distinct farm locations.
 */
const priorityLocations = new Set();

export const requestPriorityRefresh = (locationKey) => {
  if (locationKey) priorityLocations.add(locationKey);
};
export const drainPriorityRefresh = () => {
  const keys = [...priorityLocations];
  priorityLocations.clear();
  return keys;
};

/** Seconds a client should wait before re-asking for a pending location. */
export const PENDING_RETRY_AFTER_SECONDS = 180;

/**
 * @param {object} farm an already-authorized Farm document (loadOwned)
 * @param {{asOf?: Date}} [options]
 */
export async function farmWeather(farm, { asOf = new Date() } = {}) {
  const snapshot = await latestSnapshot(farm.locationKey);
  const freshness = freshnessOf(snapshot, asOf);

  if (!snapshot) {
    // A farm with no coordinates cannot be fetched at all — the district
    // centroid table does not exist, and inventing one would fabricate a
    // location. Say so rather than promising a refresh that cannot happen.
    if (farm.locationKey) requestPriorityRefresh(farm.locationKey);

    return {
      daily: [],
      risks: [],
      freshness: {
        status: FRESHNESS.PENDING,
        source: null,
        fetchedAt: null,
        retryAfterSeconds: PENDING_RETRY_AFTER_SECONDS,
        // Distinguishes "not fetched yet" from "cannot be fetched".
        reason: farm.locationKey ? 'awaiting_first_fetch' : 'no_coordinates',
      },
    };
  }

  const crops = await Crop.find({ farmId: farm._id, status: 'active' })
    .select('cropCode sowingDate status')
    .lean();

  const codes = [...new Set(crops.map((crop) => crop.cropCode))];
  const registryDocs = await CropRegistry.find({ cropCode: { $in: codes } })
    .select('cropCode sensitivity kcStages')
    .lean();
  const registryByCode = new Map(registryDocs.map((doc) => [doc.cropCode, doc]));

  const risks = [];
  for (const crop of crops) {
    const registry = registryByCode.get(crop.cropCode);
    const stage = deriveStage({
      sowingDate: crop.sowingDate,
      status: crop.status,
      kcStages: registry?.kcStages ?? [],
      asOf,
    });

    const assessment = assessWeatherRisks({
      daily: snapshot.daily,
      sensitivity: registry?.sensitivity,
      stage: stage.stage,
      cropStatus: crop.status,
      asOf,
    });

    for (const risk of assessment.risks) {
      risks.push({ ...risk, cropId: String(crop._id), cropCode: crop.cropCode });
    }
  }

  // A farm with no active crops still gets weather; it simply gets no
  // crop-scoped risk, which is the honest answer rather than a generic one.
  return {
    daily: snapshot.daily.map((day) => ({
      date: day.date,
      tMinC: day.tMinC,
      tMaxC: day.tMaxC,
      humidityPct: day.humidityPct ?? null,
      windKmh: day.windKmh ?? null,
      rainMm: day.rainMm ?? null,
      rainProbPct: day.rainProbPct ?? null,
      et0Mm: day.et0Mm ?? null,
    })),
    risks,
    freshness,
  };
}
