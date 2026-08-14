/**
 * Transparent production estimator — PURE (CLAUDE.md rule 5).
 *
 * This is arithmetic over published government statistics. It is **not** a
 * prediction, not a forecast, and not machine learning, and no surface built on
 * it may say otherwise (docs/yield/yield-estimation.md "MUST-NOT claims").
 *
 *     Estimated production = Y_hist × Area
 *     Range                = (Y_hist ± 1 SD) × Area
 *
 * `Y_hist` is the median of a real district's last five reported years and
 * `SD` is that same district's own year-to-year spread. Both come from the
 * lookup; nothing here invents a number.
 *
 * ── Why the two multipliers are NOT applied ──────────────────────────────────
 *
 * The spec adds `× F_irrigation × F_event`, citing Zaveri & Lobell (Nat. Comms
 * 2019) for irrigation and Dhaliwal (2015) for pest loss. Both citations are
 * real. **Neither supports multiplying a district median**, and applying them
 * anyway would produce a number that looks sourced and is not:
 *
 *   - **F_irrigation.** Y_hist is the median yield of every field in the
 *     district — irrigated and rainfed together. A rainfed field in Punjab
 *     (almost entirely irrigated) sits far below that median; a rainfed field
 *     in a district that is 5% irrigated sits roughly *at* it. The adjustment
 *     therefore depends on the district's irrigated-area share, which this
 *     repository does not have. Zaveri & Lobell's irrigated-vs-rainfed figure
 *     answers a different question than "where does this field sit relative to
 *     its district's blend?".
 *
 *   - **F_event.** Dhaliwal's ~15.7% is the *average annual* loss to insect
 *     pests across Indian agriculture. Y_hist already contains it: those were
 *     real years, with real pests, and the yields recorded reflect them.
 *     Multiplying by it again would subtract the same loss twice. What the
 *     formula wants is the *incremental* loss from one logged outbreak above a
 *     district's normal pest pressure, and that is not what the source measures.
 *
 * So both factors are reported as considered-and-not-applied, each with its
 * reason and its citation, and the farmer is instead told the qualitative fact
 * — "this field is rainfed and the district average includes irrigated fields",
 * "a disease was logged on this crop" — which is true, useful, and requires no
 * invented coefficient. Recorded in ADR-026.
 *
 * The framework stays in place: sourcing a district irrigated-area share is all
 * that stands between here and an applied F_irrigation.
 */
import { ACRES_PER_UNIT } from '../../utils/locationKey.js';

/** 1 tonne = 10 quintal. A definition, not an agronomic claim. */
export const QUINTALS_PER_TONNE = 10;

/**
 * Bumped whenever the farmer-facing wording or the method changes, and stored
 * on every persisted estimate so an old record still says which disclaimer the
 * farmer was actually shown.
 */
export const DISCLAIMER_VERSION = 'yield-v1-2026-08';

/**
 * Derived from the land ledger's own table rather than restated, so the two
 * cannot drift: `ACRES_PER_UNIT.hectare` is 2.47105 acre per hectare.
 */
export const HECTARES_PER_ACRE = 1 / ACRES_PER_UNIT.hectare;

/** Factors the estimator weighed. Reported whether or not they were applied. */
export const FACTORS = Object.freeze({
  IRRIGATION: 'IRRIGATION',
  PEST_DISEASE_EVENT: 'PEST_DISEASE_EVENT',
});

export const ESTIMATE_TRACE_STEPS = Object.freeze({
  BASIS: 'BASIS',
  AREA: 'AREA',
  PRODUCTION: 'PRODUCTION',
  RANGE: 'RANGE',
  FACTORS: 'FACTORS',
  NOT_ESTIMATED: 'NOT_ESTIMATED',
});

/** Why a total production figure could not be produced from an otherwise good basis. */
export const PRODUCTION_UNAVAILABLE = Object.freeze({
  AREA_MISSING: 'AREA_MISSING',
  AREA_UNIT_AMBIGUOUS: 'AREA_UNIT_AMBIGUOUS',
});

const PRODUCTION_UNAVAILABLE_KEYS = Object.freeze({
  [PRODUCTION_UNAVAILABLE.AREA_MISSING]: 'yield.productionAreaMissing',
  [PRODUCTION_UNAVAILABLE.AREA_UNIT_AMBIGUOUS]: 'yield.productionAreaUnitAmbiguous',
});

const round = (value, dp = 2) =>
  value === null || value === undefined || !Number.isFinite(value)
    ? null
    : Number(value.toFixed(dp));

/**
 * Converts a farmer's recorded area to hectares.
 *
 * **Bigha is deliberately refused.** `utils/locationKey.js` states the rule
 * this honours: the bigha constant is the "pucca bigha" of the north-Indian
 * plains, the unit genuinely varies by state, and "no recommendation ever
 * consumes a converted bigha". A land-ceiling check can tolerate that slop; a
 * number telling a farmer how many quintals to expect cannot, because the
 * error lands directly in what they plan and sell against.
 *
 * The yield basis is still served in that case — the district's real figures
 * are useful on their own — and only the multiplied total is withheld.
 *
 * @returns {{hectares: number|null, unavailable: string|null}}
 */
export function toHectares(areaValue, areaUnit) {
  if (areaValue === null || areaValue === undefined || !(areaValue > 0)) {
    return { hectares: null, unavailable: PRODUCTION_UNAVAILABLE.AREA_MISSING };
  }
  if (areaUnit === 'bigha') {
    return { hectares: null, unavailable: PRODUCTION_UNAVAILABLE.AREA_UNIT_AMBIGUOUS };
  }
  // Absent unit reads as acres, matching `allocatedCropAcres`'s identity rule.
  const acres = areaValue * (ACRES_PER_UNIT[areaUnit] ?? ACRES_PER_UNIT.acre);
  return { hectares: acres * HECTARES_PER_ACRE, unavailable: null };
}

/**
 * The factors weighed, and why each was not applied.
 *
 * Every entry carries `applied: false` in this version. That is the honest
 * state, not a placeholder: see the header. `sourceRef` records the citation
 * the spec offered so a reader can check the reasoning rather than take it on
 * trust.
 */
function considerFactors({ irrigationMethod, healthEvents }) {
  const factors = [
    {
      factor: FACTORS.IRRIGATION,
      applied: false,
      multiplier: null,
      inputValue: irrigationMethod ?? null,
      reasonKey: 'yield.factorIrrigationNotApplied',
      sourceRef: {
        org: 'Nature Communications',
        title:
          'Zaveri & Lobell (2019), The role of irrigation in changing wheat yields and heat sensitivity in India',
        url: 'https://www.nature.com/articles/s41467-019-12183-9',
        note: 'Cited by docs/yield/yield-estimation.md for F_irrigation. Measures irrigated versus rainfed yields; it does not measure where one field sits relative to its own district blended median, which is what adjusting Y_hist would require. Applying it needs a district irrigated-area share this repository does not hold.',
      },
    },
    {
      factor: FACTORS.PEST_DISEASE_EVENT,
      applied: false,
      multiplier: null,
      inputValue: healthEvents?.length ?? 0,
      reasonKey: 'yield.factorEventNotApplied',
      sourceRef: {
        org: 'Indian Journal of Entomology',
        title:
          'Dhaliwal, Jindal & Bharathi (2015), Crop losses due to insect pests: global and Indian scenario',
        url: null,
        note: 'Cited by docs/yield/yield-estimation.md for F_event. Reports average annual loss (~15.7% in India at present), which the observed yields behind Y_hist already contain. The formula needs the incremental loss from one logged outbreak above a district normal; that is a different quantity and is not published here.',
      },
    },
  ];

  return factors;
}

/**
 * Qualitative caveats — true statements that need no coefficient.
 *
 * This is what replaces the multipliers. "Your field is rainfed and this
 * average includes irrigated fields" tells a farmer which way the number is
 * likely to be wrong without pretending to know by how much.
 */
function buildLimitations({ entry, irrigationMethod, healthEvents, asOfYear }) {
  const limitations = [];

  if (irrigationMethod === 'rainfed') {
    limitations.push({ key: 'yield.limitRainfed', data: {} });
  } else if (!irrigationMethod || irrigationMethod === 'unknown') {
    limitations.push({ key: 'yield.limitIrrigationUnknown', data: {} });
  }

  if (healthEvents?.length) {
    limitations.push({
      key: 'yield.limitHealthEvent',
      data: { count: healthEvents.length, latest: healthEvents[0]?.diseaseCode ?? null },
    });
  }

  const vintage = asOfYear - entry.latestYear;
  if (vintage >= 3) {
    limitations.push({
      key: 'yield.limitVintage',
      data: { latestYear: entry.latestYear, years: vintage },
    });
  }

  if (entry.n < 5) {
    limitations.push({ key: 'yield.limitFewObservations', data: { n: entry.n } });
  }

  if (entry.sdYieldTHa === null) {
    limitations.push({ key: 'yield.limitNoSpread', data: {} });
  }

  return limitations;
}

/**
 * @param {object} params
 * @param {object} params.evidence      a RESOLVED result from resolveEvidence
 * @param {number|null} params.areaValue
 * @param {string|null} params.areaUnit
 * @param {string|null} params.irrigationMethod
 * @param {object[]} params.healthEvents
 * @param {number} params.asOfYear      for the vintage caveat
 */
export function estimateYield({
  evidence,
  areaValue = null,
  areaUnit = null,
  irrigationMethod = null,
  healthEvents = [],
  asOfYear = new Date().getUTCFullYear(),
}) {
  const entry = evidence?.entry;
  if (!entry) {
    /**
     * Every field a client reads is present and explicitly empty. An absent key
     * and a null mean the same thing to a careful caller and different things
     * to a careless one, and this response is the branch a careless caller is
     * most likely to reach.
     */
    return {
      estimated: false,
      reasonKey: evidence?.reasonKey ?? 'yield.evidenceNone',
      tier: null,
      specificity: null,
      basisKey: null,
      basis: null,
      production: null,
      productionUnavailableReason: null,
      productionUnavailableReasonKey: null,
      factors: [],
      limitations: [],
      isRange: false,
      rangeMeaningKey: null,
      disclaimerKey: 'yield.disclaimer',
      disclaimerVersion: DISCLAIMER_VERSION,
      trace: [{ step: ESTIMATE_TRACE_STEPS.NOT_ESTIMATED, reason: evidence?.reason ?? null }],
    };
  }

  const trace = [];

  const median = entry.medianYieldTHa;
  const sd = entry.sdYieldTHa;

  trace.push({
    step: ESTIMATE_TRACE_STEPS.BASIS,
    tier: evidence.tier,
    medianYieldTHa: median,
    sdYieldTHa: sd,
    observations: entry.n,
    years: entry.years,
  });

  // The per-area basis, in both the scientific unit and the one Indian farmers
  // actually use. Neither is a conversion of a *rounded* other — both derive
  // from the same median.
  const basis = {
    medianYieldTHa: median,
    // t/ha → quintal/acre: ×10 quintal per tonne, ×0.4047 hectare per acre.
    medianYieldQuintalPerAcre: round(median * QUINTALS_PER_TONNE * HECTARES_PER_ACRE, 2),
    lowYieldTHa: sd === null ? null : round(Math.max(0, median - sd), 3),
    highYieldTHa: sd === null ? null : round(median + sd, 3),
    sdYieldTHa: sd,
    observations: entry.n,
    years: entry.years,
    latestYear: entry.latestYear,
    annualBasis: entry.basis ?? null,
  };

  const { hectares, unavailable } = toHectares(areaValue, areaUnit);
  trace.push({
    step: ESTIMATE_TRACE_STEPS.AREA,
    areaValue,
    areaUnit,
    areaHectares: hectares === null ? null : round(hectares, 4),
    unavailable,
  });

  const factors = considerFactors({ irrigationMethod, healthEvents });
  trace.push({
    step: ESTIMATE_TRACE_STEPS.FACTORS,
    applied: factors.filter((f) => f.applied).map((f) => f.factor),
    notApplied: factors.filter((f) => !f.applied).map((f) => f.factor),
  });

  const limitations = buildLimitations({ entry, irrigationMethod, healthEvents, asOfYear });

  const result = {
    estimated: true,
    tier: evidence.tier,
    specificity: evidence.specificity,
    basisKey: evidence.basisKey,
    basis,
    factors,
    limitations,
    /**
     * Never a single number. The spec is explicit and so is rule 9: a point
     * estimate reads as a promise, and this is a planning aid.
     */
    isRange: true,
    rangeMeaningKey: 'yield.rangeTypicalYearToYear',
    disclaimerKey: 'yield.disclaimer',
    disclaimerVersion: DISCLAIMER_VERSION,
    production: null,
    productionUnavailableReason: unavailable,
    productionUnavailableReasonKey: unavailable ? PRODUCTION_UNAVAILABLE_KEYS[unavailable] : null,
    trace,
  };

  if (hectares === null) return result;

  // No multipliers are applied, so the arithmetic is deliberately this plain:
  // a farmer can check it with the numbers on their own screen.
  const midT = median * hectares;
  const lowT = sd === null ? null : Math.max(0, median - sd) * hectares;
  const highT = sd === null ? null : (median + sd) * hectares;

  trace.push({
    step: ESTIMATE_TRACE_STEPS.PRODUCTION,
    formula: 'medianYieldTHa × areaHectares',
    medianYieldTHa: median,
    areaHectares: round(hectares, 4),
    midTonnes: round(midT, 3),
  });
  trace.push({
    step: ESTIMATE_TRACE_STEPS.RANGE,
    formula: '(medianYieldTHa ± sdYieldTHa) × areaHectares',
    sdYieldTHa: sd,
    lowTonnes: lowT === null ? null : round(lowT, 3),
    highTonnes: highT === null ? null : round(highT, 3),
  });

  result.production = {
    areaHectares: round(hectares, 4),
    midTonnes: round(midT, 3),
    lowTonnes: lowT === null ? null : round(lowT, 3),
    highTonnes: highT === null ? null : round(highT, 3),
    midQuintals: round(midT * QUINTALS_PER_TONNE, 1),
    lowQuintals: lowT === null ? null : round(lowT * QUINTALS_PER_TONNE, 1),
    highQuintals: highT === null ? null : round(highT * QUINTALS_PER_TONNE, 1),
    /** Present so the client never has to guess which unit it is rendering. */
    unit: 'quintal',
  };

  return result;
}
