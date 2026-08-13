/**
 * FAO-56 simplified water balance — PURE (CLAUDE.md rule 5).
 *
 * Implements docs/irrigation/calculation-rules.md R1–R14 over
 * docs/irrigation/irrigation-model.md's model. Imports only constants and the
 * stage engine (itself pure); no models, no services, no clock beyond `asOf`.
 * Nothing throws — every failure is a designed state carrying a reason code.
 *
 * Rule ladder, in the order this file applies it:
 *
 *   R1   status ≠ active                → no verdict
 *   R14  no usable weather              → UNAVAILABLE
 *   R3   stage from the Kc curve        → past LATE ends the season
 *   R11  paddyFlooding                  → standing-water guidance, bypasses R9/R10
 *   R2   every forecast day has ET₀?    → full | simplified
 *   R4   soil → AWC
 *   R10  TAW = AWC × (Zr × stageFactor), D clamped [0, TAW]
 *   R5/R6/R8  ledger replay (idempotent, 0.8 effective rain, logs reset D)
 *   R7   projection counts rain at prob ≥ 60%
 *   R9   amount = ceil(D/5)×5, bounded [10, 75]
 *   R12  every number used appears in the trace
 *
 * Two agronomic hazards recorded during Phase 1 are handled explicitly rather
 * than absorbed silently, and both are load-bearing:
 *
 *   RICE. FAO-56 Table 22 footnote 4 says rice's p = 0.20 is a fraction "of
 *   saturation", not of TAW like every other crop. `RAW = p × TAW` is therefore
 *   *wrong* for rice. R11 routes paddy crops away from the depletion branch
 *   entirely, so that formula is never reached for them.
 *
 *   CHILLI. FAO-56 has no chilli entry; its whole Kc curve is proxied from
 *   "Sweet peppers (bell)". The engine cannot detect this — the seed drops the
 *   `proxy.isProxy` flag — so the caller is responsible for labelling it. The
 *   engine does not special-case any crop code (rule 4).
 */
import {
  LITERS_PER_ACRE_PER_MM,
  P_ETC_ADJUSTMENT_COEFF,
  P_TABLE_REFERENCE_ETC_MM_DAY,
  PADDY_WATER_DEPTH_CM,
  SOIL_AWC_MM_PER_M,
  STAGE_ROOT_DEPTH_FACTOR,
} from '../../../../shared/constants/agronomy.js';
import { dayKey, daysBetween } from '../../utils/day.js';
import { deriveStage } from '../stage/deriveStage.js';
import {
  AMOUNT_MAX_MM,
  AMOUNT_MIN_MM,
  AMOUNT_STEP_MM,
  COLD_START_REPLAY_DAYS,
  EFFECTIVE_RAIN_COEFF,
  HORIZON_DAYS,
  IRRIGATION_REASONS,
  IRRIGATION_TRACE_STEPS,
  MODES,
  RAIN_PROB_THRESHOLD,
  SIMPLIFIED_RAIN_MM,
  SIMPLIFIED_RAIN_WINDOW_HOURS,
  VERDICTS,
} from './constants.js';

// ── Small pure helpers ───────────────────────────────────────────────────────

const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const round = (value, places = 2) => Number(value.toFixed(places));

/** Day boundaries are IST, not host-local — see utils/day.js. */
const dayIndex = (date, asOf) => daysBetween(date, asOf);

/** `new Date(junk).toISOString()` throws; nothing in this engine may throw. */
function isoOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/** R12 helper: a no-verdict result still carries its trace and reason. */
function noVerdict(verdict, reasonCode, trace, extra = {}) {
  trace.push({ step: IRRIGATION_TRACE_STEPS.NO_VERDICT, reasonCode });
  return {
    verdict,
    hasVerdict: false,
    reasonCode,
    mode: null,
    amountMm: null,
    amountLitersPerAcre: null,
    days: null,
    trace,
    ...extra,
  };
}

// ── R4 / R10 — soil reservoir ────────────────────────────────────────────────

function resolveAwc(soilType) {
  // `Object.hasOwn`, not a bracket lookup: `soilType: 'toString'` would
  // otherwise resolve to an inherited function — truthy, so the soil would be
  // reported as known while `entry.value` was undefined and TAW became NaN.
  const known = typeof soilType === 'string' && Object.hasOwn(SOIL_AWC_MM_PER_M, soilType);
  const entry = known ? SOIL_AWC_MM_PER_M[soilType] : SOIL_AWC_MM_PER_M.unknown;
  return {
    soilType: known ? soilType : 'unknown',
    awcMmPerM: entry.value,
    published: entry.published,
    basis: entry.basis,
    wideUncertainty: Boolean(entry.wideUncertainty),
  };
}

/**
 * FAO-56 Table 22 footnote 2, transcribed in crops.agronomy.json:
 * published p values assume ETc ≈ 5 mm/day and are corrected for other rates by
 * `p = p_table + 0.04 × (5 − ETc)`. Applied here because the knowledge file
 * states the engine "must apply" it; it is deliberately *not* applied on the
 * paddy branch, where p is not a TAW fraction at all.
 *
 * Clamped to (0, 1) only because a depletion fraction outside that range is
 * arithmetically meaningless — not an agronomic limit, which FAO does publish
 * but which is not transcribed in this repository.
 */
function adjustDepletionFraction(pTable, meanEtcMmDay) {
  if (!isNumber(pTable)) return null;
  if (!isNumber(meanEtcMmDay) || meanEtcMmDay <= 0) {
    return { p: pTable, adjusted: false, meanEtcMmDay: null };
  }

  const raw = pTable + P_ETC_ADJUSTMENT_COEFF * (P_TABLE_REFERENCE_ETC_MM_DAY - meanEtcMmDay);

  // Under extreme evaporative demand the linear correction runs off the end of
  // its own validity: at ETc 18 mm/day it yields a negative p, which would make
  // RAW zero and "D >= RAW" permanently true — i.e. irrigate today, forever,
  // even at zero depletion. Rather than invent a floor (FAO publishes limits
  // this repository has not transcribed), an out-of-range correction is
  // discarded and the published table value stands, with the trace saying so.
  const usable = raw > 0 && raw <= 1;
  const p = usable ? raw : pTable;

  return {
    p: round(p, 3),
    adjusted: usable,
    correctionRejected: !usable,
    correctionRaw: round(raw, 3),
    pTable,
    meanEtcMmDay: round(meanEtcMmDay, 3),
    referenceEtcMmDay: P_TABLE_REFERENCE_ETC_MM_DAY,
    coefficient: P_ETC_ADJUSTMENT_COEFF,
  };
}

// ── R9 — irrigation depth ────────────────────────────────────────────────────

function irrigationAmount(depletionMm) {
  const stepped = Math.ceil(depletionMm / AMOUNT_STEP_MM) * AMOUNT_STEP_MM;
  const bounded = Math.min(AMOUNT_MAX_MM, Math.max(AMOUNT_MIN_MM, stepped));
  return {
    amountMm: bounded,
    // "> 75 → split advice note": the cap is not silent, the shortfall is named.
    splitAdvised: stepped > AMOUNT_MAX_MM,
    uncappedMm: stepped,
    amountLitersPerAcre: Math.round(bounded * LITERS_PER_ACRE_PER_MM),
  };
}

// ── Entry point ──────────────────────────────────────────────────────────────

/**
 * @param {object} input
 * @param {{sowingDate: Date|string, status: string, waterBalance?: {depletionMm?: number, lastComputedAt?: Date, initialized?: boolean}}} input.crop
 * @param {{kcStages?: object[], rootDepthM?: number, depletionFraction?: number, paddyFlooding?: boolean, simplifiedIntervals?: object[]}} input.registry
 * @param {string} input.soilType
 * @param {object[]} input.dailyWeather  validated snapshot rows
 * @param {{date: Date|string, amountMm?: number}[]} [input.logs]
 * @param {Date} input.asOf
 */
export function computeIrrigation(input = {}) {
  // `= {}` destructuring defaults only fire for `undefined`, so a null crop —
  // a failed populate, a deleted document — would reach `crop.sowingDate` and
  // throw. R14 says this engine never throws, so nullish inputs are coalesced
  // rather than defaulted.
  const crop = input.crop ?? {};
  const registry = input.registry ?? {};
  const { soilType, dailyWeather } = input;
  const logs = Array.isArray(input.logs) ? input.logs : [];
  const asOf =
    input.asOf instanceof Date && !Number.isNaN(input.asOf.getTime()) ? input.asOf : new Date();

  const trace = [
    {
      step: IRRIGATION_TRACE_STEPS.INPUT,
      // `new Date(junk).toISOString()` throws RangeError, which would make one
      // malformed crop document 500 the request — the exact failure R14 exists
      // to prevent. `isoOrNull` degrades instead.
      sowingDate: isoOrNull(crop.sowingDate),
      status: crop.status ?? null,
      soilType: soilType ?? null,
      weatherDays: Array.isArray(dailyWeather) ? dailyWeather.length : 0,
      logCount: Array.isArray(logs) ? logs.length : 0,
      asOf: isoOrNull(asOf),
      waterBalance: {
        depletionMm: crop.waterBalance?.depletionMm ?? 0,
        initialized: Boolean(crop.waterBalance?.initialized),
      },
    },
  ];

  // ── R1 ─────────────────────────────────────────────────────────────────────
  if (crop.status !== 'active') {
    return noVerdict(null, IRRIGATION_REASONS.CROP_NOT_ACTIVE, trace);
  }

  // ── R14 ────────────────────────────────────────────────────────────────────
  if (!Array.isArray(dailyWeather) || dailyWeather.length === 0) {
    return noVerdict(VERDICTS.UNAVAILABLE, IRRIGATION_REASONS.NO_WEATHER, trace);
  }

  const days = dailyWeather
    .map((day) => ({ ...day, offset: dayIndex(day.date, asOf) }))
    .filter((day) => day.offset !== null)
    .sort((a, b) => a.offset - b.offset);

  const observed = days.filter((day) => day.offset < 0);
  // Today plus the next HORIZON_DAYS days. Today is included because its ETc
  // has not been spent yet; the *reported* `days` therefore never exceeds
  // HORIZON_DAYS, which is what "crossing in n ≤ 5 days" means.
  const horizon = days.filter((day) => day.offset >= 0 && day.offset <= HORIZON_DAYS);
  // R2 evaluates the whole forecast half, not just the horizon, as written.
  const forecast = days.filter((day) => day.offset >= 0);

  if (horizon.length === 0) {
    return noVerdict(VERDICTS.UNAVAILABLE, IRRIGATION_REASONS.NO_FORECAST, trace);
  }

  // ── R3 — stage and Kc ──────────────────────────────────────────────────────
  const stage = deriveStage({
    sowingDate: crop.sowingDate,
    status: crop.status,
    kcStages: registry.kcStages ?? [],
    asOf,
  });
  trace.push({
    step: IRRIGATION_TRACE_STEPS.STAGE,
    stage: stage.stage,
    kc: stage.kc,
    daysSinceSowing: stage.daysSinceSowing,
    dayInStage: stage.dayInStage,
    harvestApproaching: stage.harvestApproaching,
    reasonCode: stage.reasonCode,
    stageTrace: stage.trace,
  });

  if (!stage.hasVerdict) {
    const reason = stage.harvestApproaching
      ? IRRIGATION_REASONS.BEYOND_SEASON
      : IRRIGATION_REASONS.KC_UNAVAILABLE;
    return noVerdict(null, reason, trace, { harvestApproaching: stage.harvestApproaching });
  }

  // ── R11 — paddy bypasses the depletion branch entirely ────────────────────
  if (registry.paddyFlooding === true) {
    trace.push({
      step: IRRIGATION_TRACE_STEPS.VERDICT,
      verdict: VERDICTS.MAINTAIN_WATER_LEVEL,
      targetDepthCm: PADDY_WATER_DEPTH_CM,
      note:
        'Depletion scheduling does not apply: FAO-56 Table 22 footnote 4 defines this crop’s ' +
        'p as a fraction of saturation, not of total available water, so RAW = p × TAW is invalid here.',
    });
    return {
      verdict: VERDICTS.MAINTAIN_WATER_LEVEL,
      hasVerdict: true,
      reasonCode: IRRIGATION_REASONS.PADDY_STANDING_WATER,
      mode: MODES.FULL,
      amountMm: null,
      amountLitersPerAcre: null,
      days: null,
      targetDepthCm: PADDY_WATER_DEPTH_CM,
      stage: stage.stage,
      kc: stage.kc,
      trace,
    };
  }

  // ── R2 — mode selection ────────────────────────────────────────────────────
  const missingEt0 = forecast.filter((day) => !isNumber(day.et0Mm));
  const mode = missingEt0.length === 0 && forecast.length > 0 ? MODES.FULL : MODES.SIMPLIFIED;
  trace.push({
    step: IRRIGATION_TRACE_STEPS.MODE,
    mode,
    forecastDays: forecast.length,
    daysMissingEt0: missingEt0.map((day) => day.date),
  });

  if (mode === MODES.SIMPLIFIED) {
    return simplifiedVerdict({ horizon, registry, stage, trace });
  }

  if (stage.kc == null) {
    return noVerdict(VERDICTS.UNAVAILABLE, IRRIGATION_REASONS.KC_UNAVAILABLE, trace);
  }

  // ── R4 / R10 — the soil reservoir ──────────────────────────────────────────
  const soil = resolveAwc(soilType);
  const stageFactor = STAGE_ROOT_DEPTH_FACTOR[stage.stage];

  if (!isNumber(registry.rootDepthM) || !isNumber(registry.depletionFraction) || !stageFactor) {
    trace.push({
      step: IRRIGATION_TRACE_STEPS.SOIL,
      ...soil,
      rootDepthM: registry.rootDepthM ?? null,
      depletionFraction: registry.depletionFraction ?? null,
      stageFactor: stageFactor ?? null,
    });
    return noVerdict(VERDICTS.UNAVAILABLE, IRRIGATION_REASONS.SOIL_RESERVOIR_UNKNOWN, trace);
  }

  const effectiveRootDepthM = round(registry.rootDepthM * stageFactor, 3);
  const tawMm = round(soil.awcMmPerM * effectiveRootDepthM, 2);

  trace.push({
    step: IRRIGATION_TRACE_STEPS.SOIL,
    ...soil,
    rootDepthM: registry.rootDepthM,
    stageFactor,
    effectiveRootDepthM,
    tawMm,
  });

  // p is corrected for the actual evaporative demand before RAW is derived.
  const meanEtc =
    horizon.reduce((sum, day) => sum + day.et0Mm * stage.kc, 0) / (horizon.length || 1);
  const pAdjustment = adjustDepletionFraction(registry.depletionFraction, meanEtc);
  const rawMm = round(pAdjustment.p * tawMm, 2);

  trace.push({ step: IRRIGATION_TRACE_STEPS.DEPLETION_FRACTION, ...pAdjustment });
  trace.push({ step: IRRIGATION_TRACE_STEPS.RESERVOIR, tawMm, rawMm, p: pAdjustment.p });

  // ── R5 / R6 / R8 — ledger replay over observed days ────────────────────────
  const ledger = replayLedger({
    crop,
    observed,
    logs,
    kc: stage.kc,
    tawMm,
    asOf,
  });
  trace.push({ step: IRRIGATION_TRACE_STEPS.LEDGER, ...ledger });

  // ── R7 — forward projection ────────────────────────────────────────────────
  return project({
    depletionMm: ledger.depletionMm,
    horizon,
    kc: stage.kc,
    tawMm,
    rawMm,
    stage,
    soil,
    mode,
    trace,
  });
}

/**
 * R5: "recompute from max(lastAnchor) where anchor = last log date or
 * initialization point — same inputs, same output."
 *
 * The replay is a pure fold over the observed days, so re-running it with the
 * same inputs is bit-identical by construction; there is no accumulated state
 * to drift. Cold start replays the past 7 days from `D = 0` ("assumed field
 * capacity"), flagged `initialized: false` until a farmer log anchors it.
 */
function replayLedger({ crop, observed, logs, kc, tawMm, asOf }) {
  const window = observed.filter((day) => day.offset >= -COLD_START_REPLAY_DAYS);

  const logsByDay = new Map();
  for (const log of Array.isArray(logs) ? logs : []) {
    const offset = dayIndex(log.date, asOf);
    if (offset === null || offset > 0) continue;
    if (!logsByDay.has(offset)) logsByDay.set(offset, []);
    logsByDay.get(offset).push(log);
  }

  const anyLogOffset = logsByDay.size ? Math.max(...logsByDay.keys()) : null;

  /**
   * Only a log with **no** `amountMm` anchors the ledger.
   *
   * R8: "Log without amountMm → treat as refill to field capacity (D=0)". A log
   * that *does* carry an amount is a measured application and is subtracted
   * during the walk like any other water. Treating every log as an anchor meant
   * a farmer recording a 5 mm top-up wiped out an 80 mm standing deficit and
   * was then told no irrigation was needed — the most dangerous direction for
   * this error to point.
   */
  const refillOffsets = [...logsByDay.entries()]
    .filter(([, dayLogs]) => dayLogs.some((log) => !isNumber(log.amountMm)))
    .map(([offset]) => offset);
  const lastRefillOffset = refillOffsets.length ? Math.max(...refillOffsets) : null;

  // The anchor is the later of the last full refill and the start of the replay
  // window: days before a refill cannot influence today's depletion.
  const anchorOffset =
    lastRefillOffset !== null
      ? Math.max(lastRefillOffset, window[0]?.offset ?? lastRefillOffset)
      : (window[0]?.offset ?? 0);

  const initialized = Boolean(crop.waterBalance?.initialized) || anyLogOffset !== null;
  let depletion = lastRefillOffset !== null ? 0 : (crop.waterBalance?.depletionMm ?? 0);

  const entries = [];

  for (const day of window) {
    if (day.offset < anchorOffset) continue;

    const dayLogs = logsByDay.get(day.offset) ?? [];
    const etcMm = round(day.et0Mm * kc, 3);
    const rainMm = isNumber(day.rainMm) ? day.rainMm : 0;
    // R6: observed rain is discounted for runoff/evaporation. Probability is
    // NOT applied here — R7 scopes that to the forward projection, and an
    // observed day's rain already happened.
    const effectiveRainMm = round(rainMm * EFFECTIVE_RAIN_COEFF, 3);

    // R8: a log with no amount means "refilled to field capacity".
    const fullRefill = dayLogs.some((log) => !isNumber(log.amountMm));
    const loggedMm = dayLogs.reduce(
      (sum, log) => sum + (isNumber(log.amountMm) ? log.amountMm : 0),
      0,
    );

    const before = depletion;
    if (fullRefill) {
      depletion = 0;
    } else {
      depletion = depletion + etcMm - effectiveRainMm - loggedMm;
    }
    // R10: D clamps [0, TAW].
    depletion = round(Math.min(tawMm, Math.max(0, depletion)), 3);

    entries.push({
      date: dayKey(day.date),
      etcMm,
      rainMm,
      effectiveRainMm,
      irrigationMm: fullRefill ? null : loggedMm || 0,
      assumed: fullRefill,
      depletionBeforeMm: before,
      depletionMm: depletion,
    });
  }

  return {
    depletionMm: depletion,
    initialized,
    anchorOffset,
    replayDays: entries.length,
    // R12: which log anchored the replay, and whether there was one at all.
    anchoredByRefill: lastRefillOffset !== null,
    coldStart: anyLogOffset === null && !crop.waterBalance?.initialized,
    entries,
  };
}

/**
 * Simplified mode (irrigation-model.md §7): rain-window heuristic, then a
 * stage-based interval table from the registry.
 *
 * The interval table does not exist. `simplifiedIntervals` is declared on the
 * registry schema but no knowledge file authors it, so it is `[]` for every
 * crop. Rather than invent an interval, the engine says it cannot advise —
 * with a distinct reason code so the UI can explain why.
 */
function simplifiedVerdict({ horizon, registry, stage, trace }) {
  const windowDays = Math.ceil(SIMPLIFIED_RAIN_WINDOW_HOURS / 24);
  const qualifying = horizon.find(
    (day) =>
      day.offset <= windowDays &&
      isNumber(day.rainMm) &&
      day.rainMm >= SIMPLIFIED_RAIN_MM &&
      isNumber(day.rainProbPct) &&
      day.rainProbPct >= RAIN_PROB_THRESHOLD,
  );

  if (qualifying) {
    trace.push({
      step: IRRIGATION_TRACE_STEPS.VERDICT,
      verdict: VERDICTS.WAIT_RAIN_EXPECTED,
      rain: {
        date: dayKey(qualifying.date),
        mm: qualifying.rainMm,
        probPct: qualifying.rainProbPct,
      },
      thresholds: {
        mm: SIMPLIFIED_RAIN_MM,
        probPct: RAIN_PROB_THRESHOLD,
        windowHours: SIMPLIFIED_RAIN_WINDOW_HOURS,
      },
    });
    return {
      verdict: VERDICTS.WAIT_RAIN_EXPECTED,
      hasVerdict: true,
      reasonCode: IRRIGATION_REASONS.OK,
      mode: MODES.SIMPLIFIED,
      amountMm: null,
      amountLitersPerAcre: null,
      days: qualifying.offset,
      stage: stage.stage,
      kc: stage.kc,
      trace,
    };
  }

  const intervals = Array.isArray(registry.simplifiedIntervals) ? registry.simplifiedIntervals : [];
  const forStage = intervals.find((entry) => entry.stage === stage.stage);

  if (!forStage || !isNumber(forStage.intervalDays)) {
    return noVerdict(
      VERDICTS.UNAVAILABLE,
      IRRIGATION_REASONS.SIMPLIFIED_INTERVALS_NOT_SOURCED,
      trace,
      { mode: MODES.SIMPLIFIED, stage: stage.stage },
    );
  }

  trace.push({
    step: IRRIGATION_TRACE_STEPS.VERDICT,
    verdict: VERDICTS.IRRIGATE_IN_N_DAYS,
    intervalDays: forStage.intervalDays,
    basis: 'registry simplifiedIntervals',
  });
  return {
    verdict: VERDICTS.IRRIGATE_IN_N_DAYS,
    hasVerdict: true,
    reasonCode: IRRIGATION_REASONS.OK,
    mode: MODES.SIMPLIFIED,
    amountMm: null,
    amountLitersPerAcre: null,
    days: forStage.intervalDays,
    stage: stage.stage,
    kc: stage.kc,
    trace,
  };
}

/**
 * irrigation-model.md §5, in the order the doc lists the branches:
 *   D crosses RAW today                    → IRRIGATE_TODAY
 *   crossing in n ≤ 5 days, no rain first  → IRRIGATE_IN_N_DAYS
 *   qualifying rain ≥ deficit before that  → WAIT_RAIN_EXPECTED
 *   no crossing in horizon                 → NO_IRRIGATION_NEEDED
 *
 * The "irrigate today while heavy rain is forecast" contradiction is NOT
 * resolved here: docs/irrigation/recommendation-engine.md assigns that to the
 * feed composer ("contradicting pair … → HYBRID item 'rain expected — hold
 * irrigation'"), and the engine's job is the arithmetic. The projection is in
 * the trace so the composer has the numbers it needs.
 */
function project({ depletionMm, horizon, kc, tawMm, rawMm, stage, soil, mode, trace }) {
  const base = {
    hasVerdict: true,
    reasonCode: IRRIGATION_REASONS.OK,
    mode,
    stage: stage.stage,
    kc,
    tawMm,
    rawMm,
    depletionMm,
    soilUncertaintyWide: soil.wideUncertainty,
    trace,
  };

  if (depletionMm >= rawMm) {
    const amount = irrigationAmount(depletionMm);
    trace.push({
      step: IRRIGATION_TRACE_STEPS.VERDICT,
      verdict: VERDICTS.IRRIGATE_TODAY,
      depletionMm,
      rawMm,
      ...amount,
    });
    return { ...base, verdict: VERDICTS.IRRIGATE_TODAY, days: 0, ...amount };
  }

  let depletion = depletionMm;
  const projection = [];

  for (const day of horizon) {
    const etcMm = round(day.et0Mm * kc, 3);
    // R7: forecast rain counts only above the probability threshold.
    const qualifies =
      isNumber(day.rainMm) && isNumber(day.rainProbPct) && day.rainProbPct >= RAIN_PROB_THRESHOLD;
    const effectiveRainMm = qualifies ? round(day.rainMm * EFFECTIVE_RAIN_COEFF, 3) : 0;

    // "Qualifying rain ≥ deficit before crossing" — checked against the deficit
    // standing at the start of the day, which is what the rain would refill.
    if (qualifies && effectiveRainMm >= depletion && depletion > 0) {
      trace.push({
        step: IRRIGATION_TRACE_STEPS.PROJECTION,
        projection,
        outcome: 'rain_covers_deficit',
      });
      trace.push({
        step: IRRIGATION_TRACE_STEPS.VERDICT,
        verdict: VERDICTS.WAIT_RAIN_EXPECTED,
        rain: {
          date: dayKey(day.date),
          mm: day.rainMm,
          probPct: day.rainProbPct,
          effectiveMm: effectiveRainMm,
        },
        deficitMm: depletion,
      });
      return {
        ...base,
        verdict: VERDICTS.WAIT_RAIN_EXPECTED,
        days: day.offset,
        amountMm: null,
        amountLitersPerAcre: null,
        rain: { date: day.date, mm: day.rainMm, probPct: day.rainProbPct },
      };
    }

    depletion = round(Math.min(tawMm, Math.max(0, depletion + etcMm - effectiveRainMm)), 3);
    projection.push({
      date: dayKey(day.date),
      daysAhead: day.offset,
      et0Mm: day.et0Mm,
      etcMm,
      rainMm: isNumber(day.rainMm) ? day.rainMm : null,
      rainProbPct: isNumber(day.rainProbPct) ? day.rainProbPct : null,
      rainCounted: qualifies,
      effectiveRainMm,
      depletionMm: depletion,
    });

    if (depletion >= rawMm) {
      const amount = irrigationAmount(depletion);
      trace.push({ step: IRRIGATION_TRACE_STEPS.PROJECTION, projection, outcome: 'crosses_raw' });
      trace.push({
        step: IRRIGATION_TRACE_STEPS.VERDICT,
        verdict: VERDICTS.IRRIGATE_IN_N_DAYS,
        days: day.offset,
        ...amount,
      });
      return { ...base, verdict: VERDICTS.IRRIGATE_IN_N_DAYS, days: day.offset, ...amount };
    }
  }

  trace.push({ step: IRRIGATION_TRACE_STEPS.PROJECTION, projection, outcome: 'no_crossing' });
  trace.push({
    step: IRRIGATION_TRACE_STEPS.VERDICT,
    verdict: VERDICTS.NO_IRRIGATION_NEEDED,
    nextCheckDays: HORIZON_DAYS,
  });
  return {
    ...base,
    verdict: VERDICTS.NO_IRRIGATION_NEEDED,
    days: null,
    amountMm: null,
    amountLitersPerAcre: null,
    nextCheckDays: HORIZON_DAYS,
  };
}

export { VERDICTS, MODES, IRRIGATION_REASONS, IRRIGATION_TRACE_STEPS };
