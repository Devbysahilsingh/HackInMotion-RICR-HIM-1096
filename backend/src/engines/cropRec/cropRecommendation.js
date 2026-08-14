/**
 * Crop recommendation engine — PURE (CLAUDE.md rule 5).
 *
 * docs/crop-recommendation/engine.md, verbatim:
 *   1. "Hard gates (excluded with stated reason): season ∉ crop's sowing
 *      windows for the state (DES crop calendar); soil suitability score 0;
 *      water need floor unreachable (high-need crop + rainfed + low district
 *      rainfall normal)."
 *   2. "Weighted score over survivors:
 *      0.30·S_season + 0.25·S_soil + 0.30·S_water + 0.15·S_temp."
 *      "S_water = f(available water proxy ÷ FAO need range), penalized by
 *       drought sensitivity. Irrigation→mm proxy is our own heuristic and is
 *       **labeled as such in UI**."
 *      "S_temp = overlap of district seasonal normals with crop optimum range."
 *      "Land size: tie-breaker note only (no agronomic scoring basis)."
 *   Output: "(ranked, top 5): crop, score, reasons[]". "No yield/profit claims."
 *
 * ── Missing evidence is a first-class outcome ────────────────────────────────
 *
 * Only the four top-level weights are documented numerically. The sub-score
 * functions are not, and — more importantly — two of the four inputs do not
 * exist in this repository at all:
 *
 *   · district climate normals: the table is empty (shared/constants/
 *     climate-normals.js explains why), so S_temp can never be computed today
 *     and S_water can only be computed for irrigated farms.
 *   · soilSuitability: published for exactly one of nine crops (cotton).
 *
 * Rather than substitute a neutral 0.5 — which would silently present a guess
 * as a score — a factor with no evidence is **excluded** and the remaining
 * weights are renormalised over what was actually known. Every exclusion is
 * named in `limitations`, so a farmer is told which considerations the ranking
 * could not make. A crop scored on two factors and one scored on four are
 * therefore not silently presented as equally well-founded: `evidenceRatio`
 * reports how much of the weight was backed by data.
 */
import { SEASONS } from '../../config/constants.js';
import {
  CLIMATE_NORMALS_AVAILABLE,
  lookupNormal,
} from '../../../../shared/constants/climate-normals.js';

/** docs/crop-recommendation/engine.md §2 and FINAL-PLAN-SPEC §51. */
export const WEIGHTS = Object.freeze({
  season: 0.3,
  soil: 0.25,
  water: 0.3,
  temp: 0.15,
});

export const TOP_N = 5;

/** Registry `soilSuitability` is published 0–3; scores here are 0–1. */
const SOIL_SCALE_MAX = 3;

/**
 * Irrigation method → whether the farm can meet a crop's water need from
 * something other than rain.
 *
 * This is **our own heuristic**, which the spec requires to be labelled as such
 * ("Irrigation→mm proxy is our own heuristic and is labeled as such in UI").
 * It is deliberately coarse — a boolean about assured supply, not an invented
 * millimetre figure, because no source in this repository publishes delivery
 * volumes per method and inventing them would be fabricated data.
 */
const ASSURED_IRRIGATION = new Set(['canal', 'borewell', 'drip', 'sprinkler']);

/**
 * Drought-sensitivity penalty applied to S_water for a rainfed farm.
 *
 * Engine policy, not a sourced coefficient: the registry publishes the
 * sensitivity as an ordinal band (LOW … HIGH) with no numeric weight anywhere,
 * so the penalty is a monotone ramp across the published bands. Named and
 * traced rather than buried.
 */
const DROUGHT_PENALTY = Object.freeze({
  LOW: 0,
  LOW_MED: 0.1,
  MEDIUM: 0.2,
  MED_HIGH: 0.3,
  HIGH: 0.45,
});

export const GATE_REASONS = Object.freeze({
  SEASON_MISMATCH: 'SEASON_MISMATCH',
  SOIL_UNSUITABLE: 'SOIL_UNSUITABLE',
  WATER_UNREACHABLE: 'WATER_UNREACHABLE',
  UNSUPPORTED: 'UNSUPPORTED',
  /**
   * No mandi within reach of this farm has a usable price for the crop.
   *
   * A gate rather than a sub-score, and deliberately so. The four weights above
   * are the documented ranking and are asserted verbatim by the suite; adding a
   * fifth would silently change every score this engine has ever produced and
   * make the published figures wrong. What market evidence can honestly decide
   * is *eligibility* — a crop the farmer cannot price is one they cannot act on
   * — and, between crops the agronomy ranks equally, the tie.
   *
   * It only fires when the caller supplies market evidence AND asks for it
   * (`requireMarket`). The season-planning wizard, which has no farm market
   * context, is unaffected.
   */
  MARKET_UNAVAILABLE: 'MARKET_UNAVAILABLE',
});

export const EVIDENCE = Object.freeze({
  SOURCED: 'SOURCED',
  MISSING: 'MISSING',
});

export const CROP_REC_TRACE_STEPS = Object.freeze({
  INPUT: 'INPUT',
  GATES: 'GATES',
  SCORING: 'SCORING',
  RANKING: 'RANKING',
});

const clamp01 = (value) => Math.min(1, Math.max(0, value));
const round = (value, places = 3) => Number(value.toFixed(places));

/**
 * A factor result. `evidence: MISSING` means the factor was not scored at all —
 * it is dropped from the weighted mean rather than counted as zero, because
 * "we do not know" and "this crop scores zero here" are different claims.
 */
const factor = (score, evidence, detail = {}) => ({ score, evidence, ...detail });
const missing = (reasonKey, detail = {}) =>
  factor(null, EVIDENCE.MISSING, { reasonKey, ...detail });

// ── Gates ────────────────────────────────────────────────────────────────────

function applyGates({ crop, season, farm, normal, market, requireMarket }) {
  if (crop.supportLevel === 'UNSUPPORTED') {
    return { gated: true, reason: GATE_REASONS.UNSUPPORTED, reasonKey: 'cropRec.gateUnsupported' };
  }

  // Market, ahead of the agronomic gates: a crop with no nearby price is out
  // whatever the soil says, and reporting "soil unsuitable" for a crop that was
  // never rankable would be the wrong explanation.
  if (requireMarket && market?.available !== true) {
    return {
      gated: true,
      reason: GATE_REASONS.MARKET_UNAVAILABLE,
      reasonKey: 'cropRec.gateMarket',
      data: {
        marketReason: market?.reason ?? null,
        commodityCode: market?.commodityCode ?? null,
        ageDays: market?.ageDays ?? null,
      },
    };
  }

  // Season. A crop with an EMPTY `seasons` array is NOT gated out: the registry
  // records tomato's seasons as unsourced rather than as "none", and gating on
  // absent data would silently delete a crop from every recommendation. The
  // uncertainty is reported as a caution instead.
  const seasons = Array.isArray(crop.seasons) ? crop.seasons : [];
  if (seasons.length > 0 && !seasons.includes(season)) {
    return {
      gated: true,
      reason: GATE_REASONS.SEASON_MISMATCH,
      reasonKey: 'cropRec.gateSeason',
      data: { season, cropSeasons: seasons },
    };
  }

  // Soil. Only an explicitly published 0 gates. An ABSENT key means "not
  // sourced" (the registry comment says so outright), and treating absence as 0
  // would gate cotton out of every soil but the three it publishes.
  const suitability = readSoilSuitability(crop, farm.soilType);
  if (suitability === 0) {
    return {
      gated: true,
      reason: GATE_REASONS.SOIL_UNSUITABLE,
      reasonKey: 'cropRec.gateSoil',
      data: { soilType: farm.soilType, score: 0 },
    };
  }

  // Water: "high-need crop + rainfed + low district rainfall normal". All three
  // conditions are required, and the third needs a normal — which does not
  // exist yet, so this gate cannot fire today. It is written out in full so it
  // starts working the moment the table is populated, and its inability to fire
  // is reported rather than passing silently.
  const rainfed = !ASSURED_IRRIGATION.has(farm.irrigationMethod);
  const needFloor = Array.isArray(crop.waterNeedMm) ? crop.waterNeedMm[0] : null;

  if (rainfed && typeof needFloor === 'number' && normal?.rainfallMm != null) {
    if (normal.rainfallMm < needFloor) {
      return {
        gated: true,
        reason: GATE_REASONS.WATER_UNREACHABLE,
        reasonKey: 'cropRec.gateWater',
        data: { needFloorMm: needFloor, normalRainfallMm: normal.rainfallMm },
      };
    }
  }

  return { gated: false };
}

/** `soilSuitability` is a Mongoose Map when hydrated and a plain object when lean. */
function readSoilSuitability(crop, soilType) {
  const map = crop.soilSuitability;
  if (!map || !soilType) return null;
  if (typeof map.get === 'function') {
    const value = map.get(soilType);
    return typeof value === 'number' ? value : null;
  }
  return typeof map[soilType] === 'number' ? map[soilType] : null;
}

// ── Sub-scores ───────────────────────────────────────────────────────────────

function scoreSeason(crop, season) {
  const seasons = Array.isArray(crop.seasons) ? crop.seasons : [];
  if (seasons.length === 0) return missing('cropRec.missingSeasons');

  // Post-gate this is binary by construction: a crop that survives the season
  // gate grows in the requested season. A crop that grows in only one season
  // scores marginally higher than a multi-season crop for that season, because
  // the published calendar is more specific about it.
  const specificity = 1 - (seasons.length - 1) / Math.max(1, SEASONS.length);
  return factor(round(clamp01(0.85 + 0.15 * specificity)), EVIDENCE.SOURCED, {
    season,
    cropSeasons: seasons,
  });
}

function scoreSoil(crop, soilType) {
  const suitability = readSoilSuitability(crop, soilType);
  if (suitability === null) {
    return missing('cropRec.missingSoilSuitability', { soilType });
  }
  return factor(round(suitability / SOIL_SCALE_MAX), EVIDENCE.SOURCED, {
    published: suitability,
    scaleMax: SOIL_SCALE_MAX,
    soilType,
  });
}

function scoreWater(crop, farm, normal) {
  const need = Array.isArray(crop.waterNeedMm) ? crop.waterNeedMm : null;
  if (!need || need.length !== 2) return missing('cropRec.missingWaterNeed');

  const [needMin, needMax] = need;
  const assured = ASSURED_IRRIGATION.has(farm.irrigationMethod);
  const penalty = DROUGHT_PENALTY[crop.droughtSensitivity] ?? 0;

  if (assured) {
    // Supply is not the constraint; a thirstier crop is simply more expensive
    // to run, which is not something this engine claims to price. Drought
    // sensitivity still matters a little, because an assured supply can fail.
    return factor(round(clamp01(1 - penalty / 2)), EVIDENCE.SOURCED, {
      basis: 'assured irrigation',
      heuristic: true,
      irrigationMethod: farm.irrigationMethod,
      needMm: need,
      droughtSensitivity: crop.droughtSensitivity ?? null,
      penalty: round(penalty / 2),
    });
  }

  // Rainfed. Without a district rainfall normal there is nothing to divide the
  // need by, so the factor is genuinely unknown rather than pessimistic.
  if (normal?.rainfallMm == null) {
    return missing('cropRec.missingRainfallNormal', {
      irrigationMethod: farm.irrigationMethod,
      needMm: need,
    });
  }

  const ratio = normal.rainfallMm / needMax;
  return factor(round(clamp01(ratio) * (1 - penalty)), EVIDENCE.SOURCED, {
    basis: 'rainfall normal ÷ FAO need',
    heuristic: true,
    normalRainfallMm: normal.rainfallMm,
    needMm: need,
    ratio: round(ratio),
    droughtSensitivity: crop.droughtSensitivity ?? null,
    penalty,
    needMinMm: needMin,
  });
}

function scoreTemp(crop, normal) {
  const opt = crop.tempOpt;
  if (!opt || typeof opt.min !== 'number' || typeof opt.max !== 'number') {
    return missing('cropRec.missingTempOpt');
  }
  if (normal?.tMinC == null || normal?.tMaxC == null) {
    return missing('cropRec.missingTempNormal', { tempOpt: opt });
  }

  // Overlap as a fraction of the crop's own optimum band: how much of what the
  // crop wants the season actually provides.
  const overlap = Math.min(opt.max, normal.tMaxC) - Math.max(opt.min, normal.tMinC);
  const width = opt.max - opt.min;
  const score = width <= 0 ? 0 : clamp01(overlap / width);

  return factor(round(score), EVIDENCE.SOURCED, {
    tempOpt: opt,
    normalC: { min: normal.tMinC, max: normal.tMaxC },
    overlapC: round(overlap, 2),
  });
}

/**
 * Weighted mean over the factors that had evidence, with the weights
 * renormalised across them.
 */
function combine(factors) {
  let weighted = 0;
  let available = 0;

  for (const [name, weight] of Object.entries(WEIGHTS)) {
    const entry = factors[name];
    if (entry.evidence !== EVIDENCE.SOURCED || typeof entry.score !== 'number') continue;
    weighted += weight * entry.score;
    available += weight;
  }

  return {
    score: available === 0 ? null : round(weighted / available),
    // How much of the documented weight was actually backed by data. A ranking
    // built on 0.55 of the weight is not the same claim as one built on all of
    // it, and the client is given the number rather than a false equivalence.
    evidenceRatio: round(available),
    weightUsed: available,
  };
}

// ── Entry point ──────────────────────────────────────────────────────────────

/**
 * @param {object} input
 * @param {object[]} input.registryCrops  cropRegistry documents (lean)
 * @param {{soilType: string, irrigationMethod: string, location: {state: string, district: string}, sizeValue?: number, sizeUnit?: string}} input.farm
 * @param {'KHARIF'|'RABI'|'ZAID'} input.season
 * @param {'food'|'cash'|'any'} [input.preference]
 * @returns {{recommendations: object[], excluded: object[], limitations: object[], trace: object[]}}
 */
export function recommendCrops({
  registryCrops = [],
  farm = {},
  season,
  preference,
  market = null,
  requireMarket = false,
} = {}) {
  const normal = lookupNormal({
    state: farm.location?.state,
    district: farm.location?.district,
    season,
  });

  const trace = [
    {
      step: CROP_REC_TRACE_STEPS.INPUT,
      season: season ?? null,
      preference: preference ?? null,
      soilType: farm.soilType ?? null,
      irrigationMethod: farm.irrigationMethod ?? null,
      state: farm.location?.state ?? null,
      district: farm.location?.district ?? null,
      candidateCount: registryCrops.length,
      climateNormalFound: Boolean(normal),
      climateNormalsTableAvailable: CLIMATE_NORMALS_AVAILABLE,
    },
  ];

  const excluded = [];
  const scored = [];

  for (const crop of registryCrops) {
    const cropMarket = market?.get?.(crop.cropCode) ?? null;
    const gate = applyGates({ crop, season, farm, normal, market: cropMarket, requireMarket });
    if (gate.gated) {
      // "excluded with stated reason" — never a silent disappearance.
      excluded.push({
        cropCode: crop.cropCode,
        names: crop.names ?? null,
        reason: gate.reason,
        reasonKey: gate.reasonKey,
        data: gate.data ?? {},
      });
      continue;
    }

    const factors = {
      season: scoreSeason(crop, season),
      soil: scoreSoil(crop, farm.soilType),
      water: scoreWater(crop, farm, normal),
      temp: scoreTemp(crop, normal),
    };

    const combined = combine(factors);
    if (combined.score === null) {
      excluded.push({
        cropCode: crop.cropCode,
        names: crop.names ?? null,
        reason: 'NO_EVIDENCE',
        reasonKey: 'cropRec.gateNoEvidence',
        data: {},
      });
      continue;
    }

    scored.push({
      cropCode: crop.cropCode,
      names: crop.names ?? null,
      supportLevel: crop.supportLevel,
      score: combined.score,
      evidenceRatio: combined.evidenceRatio,
      reasons: buildReasons(crop, factors),
      cautions: buildCautions(crop, factors, preference),
      sources: collectSources(crop, factors),
      factors,
      /*
       * Carried through rather than scored. The card shows the price, the
       * ranking uses it only to break an agronomic tie, and a caller that
       * supplied no market evidence gets `null` — never an invented figure.
       */
      market: cropMarket,
    });
  }

  trace.push({
    step: CROP_REC_TRACE_STEPS.GATES,
    excluded: excluded.map((entry) => ({ cropCode: entry.cropCode, reason: entry.reason })),
    survivors: scored.length,
  });
  trace.push({
    step: CROP_REC_TRACE_STEPS.SCORING,
    weights: WEIGHTS,
    perCrop: scored.map((entry) => ({
      cropCode: entry.cropCode,
      score: entry.score,
      evidenceRatio: entry.evidenceRatio,
    })),
  });

  // Ranked, then a total order: better evidence wins a tie, then the code, so
  // two identical requests always render identically.
  /*
   * Ranked, then a total order: better evidence wins a tie, then the fresher
   * market report, then the code so two identical requests always render
   * identically. Market breaks ties only — it never moves a crop past one the
   * agronomy scored higher.
   */
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      b.evidenceRatio - a.evidenceRatio ||
      marketAge(a) - marketAge(b) ||
      a.cropCode.localeCompare(b.cropCode),
  );

  const recommendations = scored.slice(0, TOP_N);
  trace.push({
    step: CROP_REC_TRACE_STEPS.RANKING,
    topN: TOP_N,
    ranked: recommendations.map((entry) => entry.cropCode),
  });

  return {
    recommendations,
    excluded,
    limitations: collectLimitations(scored, normal),
    trace,
  };
}

/** Days since the crop's newest nearby report; crops with none sort last. */
const marketAge = (entry) =>
  typeof entry.market?.ageDays === 'number' ? entry.market.ageDays : Number.MAX_SAFE_INTEGER;

/**
 * One reason per sourced factor, each naming the registry field it used so the
 * documented property — "every output reason must reference a registry field
 * with a sourceRef" — is checkable.
 */
function buildReasons(crop, factors) {
  const reasons = [];
  /**
   * `field` names the registry field the reason rests on. The documented
   * property test — "every output reason must reference a registry field with a
   * sourceRef" — is only checkable because this is emitted.
   */
  const add = (key, field, data) => reasons.push({ key, field, data });

  if (factors.season.evidence === EVIDENCE.SOURCED) {
    add('cropRec.seasonMatch', 'seasons', { seasons: factors.season.cropSeasons });
  }
  if (factors.soil.evidence === EVIDENCE.SOURCED) {
    add('cropRec.soilSuitable', 'soilSuitability', {
      soilType: factors.soil.soilType,
      published: factors.soil.published,
      scaleMax: factors.soil.scaleMax,
    });
  }
  if (factors.water.evidence === EVIDENCE.SOURCED) {
    add('cropRec.waterOk', 'waterNeedMm', {
      needMm: factors.water.needMm,
      basis: factors.water.basis,
      // Rule 9: an estimate derived from our own heuristic is labelled.
      heuristic: true,
    });
  }
  if (factors.temp.evidence === EVIDENCE.SOURCED) {
    add('cropRec.tempOk', 'tempOpt', { tempOpt: factors.temp.tempOpt });
  }

  return reasons;
}

function buildCautions(crop, factors, preference) {
  const cautions = [];

  for (const [name, entry] of Object.entries(factors)) {
    if (entry.evidence === EVIDENCE.MISSING) {
      cautions.push({ key: entry.reasonKey, factor: name, data: {} });
    }
  }

  if (crop.dataGaps?.length) {
    cautions.push({ key: 'cropRec.registryDataGaps', data: { gaps: crop.dataGaps } });
  }

  // "Land size: tie-breaker note only (no agronomic scoring basis — stated
  // honestly)" and preference has no documented weight at all, so neither
  // changes the score. Recorded so the omission is visible.
  if (preference && preference !== 'any') {
    cautions.push({ key: 'cropRec.preferenceNotScored', data: { preference } });
  }

  return cautions;
}

/**
 * The `sourceRefs` behind the fields the reasons used. Structured objects, not
 * the prose strings the spec's example shows — the API never returns display
 * text (rule 8), and a structured ref is what the "reason → sourceRef" property
 * test can actually check.
 */
const FACTOR_REGISTRY_FIELD = Object.freeze({
  season: 'seasons',
  soil: 'soilSuitability',
  water: 'waterNeedMm',
  temp: 'tempOpt',
});

function collectSources(crop, factors) {
  const usedFields = new Set(
    Object.entries(factors)
      .filter(([, entry]) => entry.evidence === EVIDENCE.SOURCED)
      .map(([name]) => FACTOR_REGISTRY_FIELD[name]),
  );
  // Drought sensitivity modifies S_water, so its citation belongs with it.
  if (factors.water.evidence === EVIDENCE.SOURCED) usedFields.add('droughtSensitivity');

  // `normalizeSourceRefs` tags each ref with the field it justifies; an
  // untagged ref applies to the document as a whole and is always relevant.
  return (crop.sourceRefs ?? []).filter((ref) => !ref.field || usedFields.has(ref.field));
}

/** What the ranking could not take into account, said plainly. */
function collectLimitations(scored, normal) {
  const limitations = [];

  if (!CLIMATE_NORMALS_AVAILABLE) {
    limitations.push({
      key: 'cropRec.limitationNoClimateNormals',
      // Named so the report is actionable rather than a vague apology.
      blockedFactors: ['temp', 'water (rainfed farms only)'],
    });
  } else if (!normal) {
    limitations.push({ key: 'cropRec.limitationNoNormalForDistrict', blockedFactors: ['temp'] });
  }

  const missingSoil = scored.filter((entry) => entry.factors.soil.evidence === EVIDENCE.MISSING);
  if (missingSoil.length > 0) {
    limitations.push({
      key: 'cropRec.limitationSoilNotSourced',
      cropCodes: missingSoil.map((entry) => entry.cropCode).sort(),
    });
  }

  return limitations;
}
