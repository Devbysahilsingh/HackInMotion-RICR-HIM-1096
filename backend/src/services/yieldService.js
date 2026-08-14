/**
 * Yield estimation (docs/yield/yield-estimation.md · docs/api/intelligence.md).
 *
 * Reads the committed lookup, walks the evidence ladder, runs the transparent
 * estimator, and records what the farmer was shown. **No external call, no
 * model, no LLM** — this is a lookup and two multiplications, which is exactly
 * the claim the product makes for it.
 *
 * DB-first (rule 3) is satisfied trivially: there is no provider to call. The
 * lookup is a build artefact, loaded once per process.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { DISCLAIMER_VERSION, estimateYield } from '../engines/yield/estimateYield.js';
import { RESOLUTION, resolveEvidence } from '../engines/yield/resolveEvidence.js';
import { Crop, CropHealthLog, CropRegistry, Farm, YieldEstimate } from '../models/index.js';
import { seasonForSowingDate } from './recommendation/seasonResolver.js';
import { logger } from '../utils/logger.js';

const LOOKUP_PATH = fileURLToPath(
  new URL('../../../datasets/lookup/yield-lookup.json', import.meta.url),
);

/**
 * How recent a logged health event has to be to count as relevant to the
 * current planting. A season is the natural window and 120 days approximates
 * one; it bounds the query rather than feeding any calculation, so it changes
 * which caveat is shown and never a number.
 */
const HEALTH_EVENT_WINDOW_DAYS = 120;

/** Loaded once. A 2.4MB parse per request would be absurd for a static file. */
let cachedLookup;
let lookupLoadFailed = false;

/**
 * @returns {object|null} null when the artefact is missing or unreadable, which
 *   the engine reports as LOOKUP_UNAVAILABLE rather than crashing a request.
 */
export function loadLookup() {
  if (cachedLookup) return cachedLookup;
  if (lookupLoadFailed) return null;

  try {
    cachedLookup = JSON.parse(readFileSync(LOOKUP_PATH, 'utf8'));
    return cachedLookup;
  } catch (err) {
    lookupLoadFailed = true;
    logger.error(
      { err: err.message, path: LOOKUP_PATH },
      'yield lookup could not be loaded — yield estimates will report INSUFFICIENT_EVIDENCE',
    );
    return null;
  }
}

/** Test seam. Never called by the request path. */
export function __setLookupForTests(lookup) {
  cachedLookup = lookup;
  lookupLoadFailed = false;
}

/**
 * Which season this planting belongs to.
 *
 * The sowing date decides it, except where the registry lists exactly one
 * season for the crop — a wheat crop is Rabi whatever month the date field
 * says, and preferring the registry there rescues a specific district figure
 * that a mistyped date would otherwise downgrade to a state average. Both
 * inputs travel in the trace so the choice is visible rather than implied.
 */
export function resolveCropSeason(crop, registrySeasons) {
  const fromSowing = seasonForSowingDate(crop.sowingDate);

  if (Array.isArray(registrySeasons) && registrySeasons.length === 1) {
    return {
      season: registrySeasons[0],
      basis: 'REGISTRY_SINGLE_SEASON',
      sowingMonthSeason: fromSowing.season,
      registrySeasons,
    };
  }

  return {
    season: fromSowing.season,
    basis: 'SOWING_MONTH',
    sowingMonthSeason: fromSowing.season,
    registrySeasons: registrySeasons ?? [],
  };
}

/**
 * Health events on this crop recent enough to be worth mentioning.
 *
 * Only analysed logs with a real disease code count — an `UNKNOWN` result or a
 * failed analysis is not evidence of a problem, and treating it as one would
 * put a caveat on a farmer's screen that nothing supports.
 */
async function recentHealthEvents(cropId, asOf) {
  const since = new Date(asOf.getTime() - HEALTH_EVENT_WINDOW_DAYS * 86_400_000);

  const logs = await CropHealthLog.find({
    cropId,
    status: 'analyzed',
    createdAt: { $gte: since },
    'analysis.diseaseCode': { $nin: [null, 'UNKNOWN'] },
  })
    .select('analysis.diseaseCode analysis.severityAssessment createdAt')
    .sort({ createdAt: -1 })
    .limit(10)
    .lean();

  return logs.map((log) => ({
    diseaseCode: log.analysis?.diseaseCode ?? null,
    severity: log.analysis?.severityAssessment ?? null,
    loggedAt: log.createdAt,
  }));
}

/**
 * Produces the yield estimate for an already-authorized crop.
 *
 * @param {object} crop an already-authorized Crop document
 * @param {{asOf?: Date, persist?: boolean}} [options]
 */
export async function yieldEstimate(crop, { asOf = new Date(), persist = true } = {}) {
  const [farm, registry] = await Promise.all([
    Farm.findById(crop.farmId).select('location irrigationMethod').lean(),
    CropRegistry.findOne({ cropCode: crop.cropCode }).select('cropCode names seasons yield').lean(),
  ]);

  const lookup = loadLookup();
  const season = resolveCropSeason(crop, registry?.seasons);

  const evidence = resolveEvidence({
    lookup,
    cropCode: crop.cropCode,
    state: farm?.location?.state ?? null,
    district: farm?.location?.district ?? null,
    season: season.season,
  });

  const healthEvents =
    evidence.resolution === RESOLUTION.RESOLVED ? await recentHealthEvents(crop._id, asOf) : [];

  const estimate = estimateYield({
    evidence,
    areaValue: crop.areaValue ?? null,
    areaUnit: crop.areaUnit ?? null,
    irrigationMethod: farm?.irrigationMethod ?? null,
    healthEvents,
    asOfYear: asOf.getUTCFullYear(),
  });

  const payload = {
    cropId: String(crop._id),
    cropCode: crop.cropCode,
    names: registry?.names ?? null,
    season: {
      value: season.season,
      basis: season.basis,
      /** Named so a client can say "we assumed Rabi" rather than just show it. */
      basisKey:
        season.basis === 'REGISTRY_SINGLE_SEASON'
          ? 'yield.seasonFromRegistry'
          : 'yield.seasonFromSowingMonth',
    },
    location: {
      state: farm?.location?.state ?? null,
      district: farm?.location?.district ?? null,
      matchedState: evidence.matched?.state ?? null,
      matchedDistrict: evidence.matched?.district ?? null,
      districtMatched: Boolean(evidence.matched?.districtCode),
    },
    area: { value: crop.areaValue ?? null, unit: crop.areaUnit ?? null },
    ...estimate,
    evidence: {
      resolution: evidence.resolution,
      tier: evidence.tier,
      specificity: evidence.specificity,
      basisKey: evidence.basisKey,
      reasonKey: evidence.reasonKey,
      attempts: evidence.attempts,
    },
    source: lookup?.source ?? null,
    /**
     * The lookup is a static build artefact from a government release, so it is
     * historical by construction — never live, never cached-from-a-provider.
     * `latestYear` is the honest age signal, not the file's build date.
     */
    freshness: {
      status: 'historical',
      source: lookup?.source?.via ?? null,
      latestYear: estimate.basis?.latestYear ?? null,
      dataVintageYears:
        estimate.basis?.latestYear == null
          ? null
          : asOf.getUTCFullYear() - estimate.basis.latestYear,
      coverage: lookup?.source?.coverage ?? null,
    },
    trace: [...(evidence.trace ?? []), ...(estimate.trace ?? [])],
  };

  if (persist && estimate.estimated) {
    await persistEstimate(crop, payload).catch((err) => {
      // A history write must never cost the farmer their answer.
      logger.warn({ err: err.message, cropId: String(crop._id) }, 'yield estimate not persisted');
    });
  }

  return payload;
}

/**
 * Records what was shown, for the audit trail the `yieldEstimates` schema was
 * reserved for in P1-2. `disclaimerVersion` is the point of it: an old record
 * still says which wording the farmer actually read.
 */
async function persistEstimate(crop, payload) {
  await YieldEstimate.create({
    userId: crop.userId,
    cropId: crop._id,
    districtAvgYield: payload.basis.medianYieldTHa,
    areaValue: crop.areaValue ?? 0,
    adjustments: payload.factors
      .filter((factor) => factor.applied)
      .map((factor) => ({
        factor: factor.factor,
        multiplier: factor.multiplier,
        reasonKey: factor.reasonKey,
        sourceRef: factor.sourceRef,
      })),
    estimateRange: {
      low:
        payload.production?.lowQuintals ??
        payload.basis.lowYieldTHa ??
        payload.basis.medianYieldTHa,
      high:
        payload.production?.highQuintals ??
        payload.basis.highYieldTHa ??
        payload.basis.medianYieldTHa,
      unit: payload.production ? 'quintal' : 'tonne_per_hectare',
    },
    inputsSnapshot: {
      tier: payload.evidence.tier,
      season: payload.season.value,
      years: payload.basis.years,
      observations: payload.basis.observations,
      areaUnit: crop.areaUnit ?? null,
      lookupSha256: payload.source?.sha256 ?? null,
    },
    disclaimerVersion: DISCLAIMER_VERSION,
  });
}

/**
 * Compact per-crop summary for the dashboard, computed for every active crop
 * the farmer owns. Deliberately reuses the same engine path as the detail
 * endpoint — a summary that could disagree with the page it links to would be
 * worse than no summary.
 *
 * @param {string} userId
 */
export async function yieldSummary(userId, { asOf = new Date(), limit = 20 } = {}) {
  const crops = await Crop.find({ userId, status: { $in: ['active', 'planned'] } })
    .sort({ sowingDate: -1 })
    .limit(limit);

  const items = await Promise.all(
    crops.map(async (crop) => {
      const estimate = await yieldEstimate(crop, { asOf, persist: false });
      return {
        cropId: estimate.cropId,
        cropCode: estimate.cropCode,
        names: estimate.names,
        estimated: estimate.estimated,
        tier: estimate.evidence.tier,
        specificity: estimate.evidence.specificity,
        reasonKey: estimate.reasonKey ?? estimate.evidence.reasonKey ?? null,
        medianYieldTHa: estimate.basis?.medianYieldTHa ?? null,
        production: estimate.production,
        latestYear: estimate.basis?.latestYear ?? null,
      };
    }),
  );

  const estimable = items.filter((item) => item.estimated && item.production);

  return {
    items,
    totals: estimable.length
      ? {
          crops: estimable.length,
          lowQuintals: Number(
            estimable.reduce((sum, item) => sum + item.production.lowQuintals, 0).toFixed(1),
          ),
          midQuintals: Number(
            estimable.reduce((sum, item) => sum + item.production.midQuintals, 0).toFixed(1),
          ),
          highQuintals: Number(
            estimable.reduce((sum, item) => sum + item.production.highQuintals, 0).toFixed(1),
          ),
          unit: 'quintal',
        }
      : null,
    /** How many crops could not be estimated, so the UI states it rather than hiding them. */
    unavailableCount: items.length - estimable.length,
    disclaimerKey: 'yield.disclaimer',
  };
}
