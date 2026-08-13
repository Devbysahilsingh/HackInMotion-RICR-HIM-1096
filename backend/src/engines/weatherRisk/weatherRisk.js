/**
 * Weather risk engine — PURE (CLAUDE.md rule 5).
 *
 * Imports nothing above config/constants: no models, no services, no clock.
 * `asOf` is a parameter because this project has no fake timers (ADR-022).
 * Nothing here throws — a malformed registry document or an absent forecast is
 * a designed state carrying a reason code, never a 500.
 *
 * Thresholds come from `cropRegistry.sensitivity` (rule 4: no crop-code
 * conditionals — the only crop knowledge used is the object handed in).
 * Where a crop publishes no threshold the engine default below applies, and
 * the trace says which was used, so a farmer's "why?" never silently presents
 * a generic number as a crop-specific one.
 *
 * Source of the triggers, verbatim from docs/weather/weather-architecture.md:
 *   HEAVY_RAIN        "≥50mm/24h forecast, prob ≥60%"
 *   EXTREME_HEAT      "Tmax ≥ crop heatTmaxC (e.g. 38–40)"
 *   FROST_COLD        "Tmin ≤ crop frostTminC (e.g. 2–4)"
 *   HIGH_WIND         "≥40 km/h"
 *   HUMIDITY_DISEASE  "RH ≥85% + 25–32°C ≥2 days"
 *   DRY_SPELL         "7-day past+forecast rain <5mm"
 * (The emitted `type` values use docs/api/weather.md's spellings — that file is
 *  the wire contract clients are written against.)
 */
import { RISK_LEVELS, WEATHER_RISK_TYPES } from '../../config/constants.js';
import { dayKey, daysBetween } from '../../utils/day.js';

/**
 * Engine defaults, applied only where the registry is silent.
 *
 * `heatTmaxC` and `frostTminC` take the *earlier-warning* end of the ranges the
 * architecture doc prints ("e.g. 38–40", "e.g. 2–4"): a warning a farmer does
 * not need costs attention, a warning that arrives late costs a crop. These are
 * engine policy, not sourced agronomic claims for any particular crop, which is
 * exactly why every emitted risk reports `thresholdSource`.
 */
export const DEFAULT_THRESHOLDS = Object.freeze({
  heavyRainMm24h: 50,
  heatTmaxC: 38,
  frostTminC: 4,
  highWindKmh: 40,
  humidityDiseasePct: 85,
});

/** Fixed, documented sub-conditions that carry no per-crop override. */
export const RISK_CONSTANTS = Object.freeze({
  /** "prob ≥60%" — shared with the irrigation engine's rain projection. */
  RAIN_PROB_THRESHOLD: 60,
  /** "RH ≥85% + 25–32°C ≥2 days" */
  DISEASE_TEMP_MIN_C: 25,
  DISEASE_TEMP_MAX_C: 32,
  DISEASE_MIN_CONSECUTIVE_DAYS: 2,
  /** "7-day past+forecast rain <5mm" */
  DRY_SPELL_WINDOW_DAYS: 7,
  DRY_SPELL_TOTAL_MM: 5,
  /** How far ahead a forecast risk is still reported. */
  HORIZON_DAYS: 7,
});

export const RISK_REASONS = Object.freeze({
  NO_WEATHER: 'NO_WEATHER',
  NO_FORECAST_DAYS: 'NO_FORECAST_DAYS',
  CROP_NOT_ACTIVE: 'CROP_NOT_ACTIVE',
  NO_RISK_DETECTED: 'NO_RISK_DETECTED',
});

export const RISK_TRACE_STEPS = Object.freeze({
  INPUT: 'INPUT',
  THRESHOLDS: 'THRESHOLDS',
  WINDOW: 'WINDOW',
  EVALUATION: 'EVALUATION',
  NO_VERDICT: 'NO_VERDICT',
});

/** Where a threshold came from — surfaced so the UI can be honest about it. */
const THRESHOLD_SOURCE = { REGISTRY: 'REGISTRY', ENGINE_DEFAULT: 'ENGINE_DEFAULT' };

/**
 * Severity banding.
 *
 * The architecture doc defines level as `f(magnitude, crop stage sensitivity,
 * imminence)` but does not define `f`. This is that definition, and it is
 * engine policy rather than a sourced claim: a magnitude band, then at most one
 * step up for a sensitive stage and one step for imminence. Each input to the
 * decision is written into the trace so the step is auditable.
 *
 * Magnitude is expressed per risk as "steps past the threshold", where a step
 * is a named, risk-specific unit (degrees for temperature, a multiple of the
 * threshold for the 0-based quantities). Band 0 is LOW.
 */
const LEVEL_INDEX = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };

function bandToLevel(band) {
  const clamped = Math.max(0, Math.min(LEVEL_INDEX.CRITICAL, Math.round(band)));
  return RISK_LEVELS[clamped];
}

/**
 * FAO-56's MID stage is the peak-Kc, peak-biomass phase — the point at which a
 * frost, a heat spike or a lodging rain does the most damage. It is the only
 * stage-sensitivity signal the registry actually supports, so it is the one
 * used, and it is named rather than buried in a magic number.
 */
const SENSITIVE_STAGES = new Set(['MID']);
const STAGE_SENSITIVITY_BUMP = 1;

/** Today or tomorrow raises a band; beyond five days lowers one. */
const IMMINENCE_NEAR_DAYS = 1;
const IMMINENCE_FAR_DAYS = 5;

function imminenceAdjustment(daysAhead) {
  if (daysAhead <= IMMINENCE_NEAR_DAYS) return 1;
  if (daysAhead > IMMINENCE_FAR_DAYS) return -1;
  return 0;
}

function resolveThreshold(sensitivity, field) {
  const value = sensitivity?.[field];
  // A non-positive threshold is not a threshold: `heavyRainMm24h: 0` would make
  // every dry day exceed it and divide by zero into an Infinity band, i.e. a
  // CRITICAL rain warning from no rain. A bad seed value falls back to the
  // engine default rather than producing a confident wrong answer.
  const usable = typeof value === 'number' && Number.isFinite(value) && value > 0;
  return usable
    ? { value, source: THRESHOLD_SOURCE.REGISTRY }
    : { value: DEFAULT_THRESHOLDS[field], source: THRESHOLD_SOURCE.ENGINE_DEFAULT };
}

/**
 * Frost is the one threshold that may legitimately be zero or negative — a
 * crop safe down to −2°C is a real registry value — so it is finiteness-checked
 * only, unlike the magnitude thresholds above.
 */
function resolveFrostThreshold(sensitivity) {
  const value = sensitivity?.frostTminC;
  return typeof value === 'number' && Number.isFinite(value)
    ? { value, source: THRESHOLD_SOURCE.REGISTRY }
    : { value: DEFAULT_THRESHOLDS.frostTminC, source: THRESHOLD_SOURCE.ENGINE_DEFAULT };
}

const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);

/**
 * Builds one risk. Returns null when the trigger does not fire, so the caller
 * can simply filter — there is no "risk with level none".
 */
function makeRisk({ type, level, daysAhead, date, data, thresholdSource }) {
  return {
    type,
    level,
    daysAhead,
    date: date ? dayKey(date) : null,
    thresholdSource,
    // The actual numbers behind the verdict (R12). The API layer maps `type`
    // and `level` to i18n keys; no prose is produced here (rule 8).
    data,
  };
}

// ── Individual rules ─────────────────────────────────────────────────────────

function heavyRain(forecast, sensitivity, stage) {
  const { value: threshold, source } = resolveThreshold(sensitivity, 'heavyRainMm24h');
  let worst = null;

  for (const day of forecast) {
    if (!isNumber(day.rainMm) || day.rainMm < threshold) continue;
    // Probability qualifies the forecast; an absent probability is treated as
    // qualifying, because the rain total itself is the stronger signal and
    // discarding it would under-warn.
    if (isNumber(day.rainProbPct) && day.rainProbPct < RISK_CONSTANTS.RAIN_PROB_THRESHOLD) continue;

    // Each full multiple of the threshold is one band.
    const band = day.rainMm / threshold - 1;
    if (!worst || band > worst.band) worst = { band, day };
  }

  if (!worst) return null;

  const daysAhead = worst.day.daysAhead;
  const level = bandToLevel(
    worst.band +
      imminenceAdjustment(daysAhead) +
      (SENSITIVE_STAGES.has(stage) ? STAGE_SENSITIVITY_BUMP : 0),
  );

  return makeRisk({
    type: WEATHER_RISK_TYPES.HEAVY_RAIN,
    level,
    daysAhead,
    date: worst.day.date,
    thresholdSource: source,
    data: {
      rainMm: worst.day.rainMm,
      rainProbPct: worst.day.rainProbPct ?? null,
      thresholdMm: threshold,
      probThresholdPct: RISK_CONSTANTS.RAIN_PROB_THRESHOLD,
      stage,
    },
  });
}

function heat(forecast, sensitivity, stage) {
  const { value: threshold, source } = resolveThreshold(sensitivity, 'heatTmaxC');
  const DEGREES_PER_BAND = 2;

  let worst = null;
  for (const day of forecast) {
    if (!isNumber(day.tMaxC) || day.tMaxC < threshold) continue;
    const band = (day.tMaxC - threshold) / DEGREES_PER_BAND;
    if (!worst || band > worst.band) worst = { band, day };
  }
  if (!worst) return null;

  const level = bandToLevel(
    worst.band +
      imminenceAdjustment(worst.day.daysAhead) +
      (SENSITIVE_STAGES.has(stage) ? STAGE_SENSITIVITY_BUMP : 0),
  );

  return makeRisk({
    type: WEATHER_RISK_TYPES.HEAT,
    level,
    daysAhead: worst.day.daysAhead,
    date: worst.day.date,
    thresholdSource: source,
    data: {
      tMaxC: worst.day.tMaxC,
      thresholdC: threshold,
      degreesOver: Number((worst.day.tMaxC - threshold).toFixed(1)),
      degreesPerBand: DEGREES_PER_BAND,
      stage,
    },
  });
}

function frost(forecast, sensitivity, stage) {
  const { value: threshold, source } = resolveFrostThreshold(sensitivity);
  const DEGREES_PER_BAND = 2;
  /**
   * Frost starts a band higher than heat: a heat spike stresses a crop, a frost
   * at a sensitive stage can end it, and the doc's own priority table places
   * frost alongside heat at CRITICAL. Named, not hidden.
   */
  const FROST_BASE_BAND = 1;

  let worst = null;
  for (const day of forecast) {
    if (!isNumber(day.tMinC) || day.tMinC > threshold) continue;
    const band = FROST_BASE_BAND + (threshold - day.tMinC) / DEGREES_PER_BAND;
    if (!worst || band > worst.band) worst = { band, day };
  }
  if (!worst) return null;

  const level = bandToLevel(
    worst.band +
      imminenceAdjustment(worst.day.daysAhead) +
      (SENSITIVE_STAGES.has(stage) ? STAGE_SENSITIVITY_BUMP : 0),
  );

  return makeRisk({
    type: WEATHER_RISK_TYPES.FROST,
    level,
    daysAhead: worst.day.daysAhead,
    date: worst.day.date,
    thresholdSource: source,
    data: {
      tMinC: worst.day.tMinC,
      thresholdC: threshold,
      degreesUnder: Number((threshold - worst.day.tMinC).toFixed(1)),
      degreesPerBand: DEGREES_PER_BAND,
      baseBand: FROST_BASE_BAND,
      stage,
    },
  });
}

function wind(forecast, sensitivity, stage) {
  const { value: threshold, source } = resolveThreshold(sensitivity, 'highWindKmh');

  let worst = null;
  for (const day of forecast) {
    if (!isNumber(day.windKmh) || day.windKmh < threshold) continue;
    const band = day.windKmh / threshold - 1;
    if (!worst || band > worst.band) worst = { band, day };
  }
  if (!worst) return null;

  // Wind bumps on a sensitive stage like every other rule: MID is peak biomass
  // and the most lodging-prone phase, so the omission would have been arbitrary.
  const level = bandToLevel(
    worst.band +
      imminenceAdjustment(worst.day.daysAhead) +
      (SENSITIVE_STAGES.has(stage) ? STAGE_SENSITIVITY_BUMP : 0),
  );

  return makeRisk({
    type: WEATHER_RISK_TYPES.WIND,
    level,
    daysAhead: worst.day.daysAhead,
    date: worst.day.date,
    thresholdSource: source,
    data: { windKmh: worst.day.windKmh, thresholdKmh: threshold, stage },
  });
}

function humidityDisease(forecast, sensitivity, stage) {
  const { value: threshold, source } = resolveThreshold(sensitivity, 'humidityDiseasePct');

  // A run, not a count: the trigger is "≥2 days" of co-occurring conditions,
  // and two isolated days a week apart are not a disease window.
  let run = [];
  let best = [];

  for (const day of forecast) {
    const humid = isNumber(day.humidityPct) && day.humidityPct >= threshold;
    const inBand =
      isNumber(day.tMaxC) &&
      isNumber(day.tMinC) &&
      day.tMaxC >= RISK_CONSTANTS.DISEASE_TEMP_MIN_C &&
      day.tMinC <= RISK_CONSTANTS.DISEASE_TEMP_MAX_C;

    if (humid && inBand) {
      run.push(day);
      if (run.length > best.length) best = [...run];
    } else {
      run = [];
    }
  }

  if (best.length < RISK_CONSTANTS.DISEASE_MIN_CONSECUTIVE_DAYS) return null;

  const band = best.length - RISK_CONSTANTS.DISEASE_MIN_CONSECUTIVE_DAYS;
  const first = best[0];
  const level = bandToLevel(
    band +
      imminenceAdjustment(first.daysAhead) +
      (SENSITIVE_STAGES.has(stage) ? STAGE_SENSITIVITY_BUMP : 0),
  );

  return makeRisk({
    type: WEATHER_RISK_TYPES.HUMIDITY_DISEASE,
    level,
    daysAhead: first.daysAhead,
    date: first.date,
    thresholdSource: source,
    data: {
      consecutiveDays: best.length,
      humidityThresholdPct: threshold,
      tempBandC: [RISK_CONSTANTS.DISEASE_TEMP_MIN_C, RISK_CONSTANTS.DISEASE_TEMP_MAX_C],
      days: best.map((day) => ({
        date: dayKey(day.date),
        humidityPct: day.humidityPct,
        tMinC: day.tMinC,
        tMaxC: day.tMaxC,
      })),
      stage,
    },
  });
}

/**
 * The only backward-looking rule: it needs the observed past as well as the
 * forecast, so it takes the whole series rather than the forecast half.
 */
function drySpell(allDays, stage) {
  // "7-day past+forecast rain <5mm" — exactly seven days, straddling today:
  // three observed, today, three forecast. Filtering ±7 instead would sum
  // *fifteen* days against a threshold calibrated for seven, so a fortnight
  // with 4.9 mm would score identically to a genuinely dry week and the band
  // (which is not normalised by window length) would over-warn.
  const half = Math.floor(RISK_CONSTANTS.DRY_SPELL_WINDOW_DAYS / 2);
  const window = allDays.filter((day) => day.daysAhead >= -half && day.daysAhead <= half);

  // Without the full window the total is not comparable to the threshold, and
  // a short window would invent a drought out of missing data.
  if (window.length !== RISK_CONSTANTS.DRY_SPELL_WINDOW_DAYS) return null;
  if (window.some((day) => !isNumber(day.rainMm))) return null;

  const totalMm = Number(window.reduce((sum, day) => sum + day.rainMm, 0).toFixed(2));
  if (totalMm >= RISK_CONSTANTS.DRY_SPELL_TOTAL_MM) return null;

  // Drier means worse: a bone-dry window bands higher than a marginal one.
  const band = 1 - totalMm / RISK_CONSTANTS.DRY_SPELL_TOTAL_MM;
  const level = bandToLevel(band + (SENSITIVE_STAGES.has(stage) ? STAGE_SENSITIVITY_BUMP : 0));

  return makeRisk({
    type: WEATHER_RISK_TYPES.DRY_SPELL,
    level,
    daysAhead: 0,
    date: window.find((day) => day.daysAhead === 0)?.date ?? window[0].date,
    thresholdSource: THRESHOLD_SOURCE.ENGINE_DEFAULT,
    data: {
      totalMm,
      thresholdMm: RISK_CONSTANTS.DRY_SPELL_TOTAL_MM,
      windowDays: window.length,
      stage,
    },
  });
}

// ── Entry point ──────────────────────────────────────────────────────────────

/**
 * A fresh object every time. `Object.freeze({risks: []})` would freeze the
 * wrapper but not the array, so every no-verdict result would share one array
 * instance — a single caller pushing into it would poison every future result.
 */
const emptyResult = () => ({ risks: [], hasRisks: false });

/**
 * @param {object} input
 * @param {object[]} input.daily      validated snapshot rows ({date, tMinC, …})
 * @param {object} [input.sensitivity] cropRegistry.sensitivity, may be absent
 * @param {string} [input.stage]      current FAO stage, from deriveStage
 * @param {string} [input.cropStatus] only 'active' crops carry crop-scoped risk
 * @param {Date} input.asOf
 * @returns {{risks: object[], hasRisks: boolean, reasonCode?: string, trace: object[]}}
 */
export function assessWeatherRisks({ daily, sensitivity, stage, cropStatus, asOf } = {}) {
  const trace = [
    {
      step: RISK_TRACE_STEPS.INPUT,
      dayCount: Array.isArray(daily) ? daily.length : 0,
      stage: stage ?? null,
      cropStatus: cropStatus ?? null,
      asOf: asOf instanceof Date ? asOf.toISOString() : null,
      hasRegistrySensitivity: Boolean(sensitivity && Object.keys(sensitivity).length),
    },
  ];

  if (!Array.isArray(daily) || daily.length === 0 || !(asOf instanceof Date)) {
    trace.push({ step: RISK_TRACE_STEPS.NO_VERDICT, reasonCode: RISK_REASONS.NO_WEATHER });
    return { ...emptyResult(), reasonCode: RISK_REASONS.NO_WEATHER, trace };
  }

  // A planned or harvested crop has nothing in the ground to be at risk.
  // Farm-level (crop-less) assessment passes no status and is not gated.
  if (cropStatus !== undefined && cropStatus !== 'active') {
    trace.push({ step: RISK_TRACE_STEPS.NO_VERDICT, reasonCode: RISK_REASONS.CROP_NOT_ACTIVE });
    return { ...emptyResult(), reasonCode: RISK_REASONS.CROP_NOT_ACTIVE, trace };
  }

  const indexed = daily
    .map((day) => ({ ...day, daysAhead: daysBetween(day.date, asOf) }))
    .sort((a, b) => a.daysAhead - b.daysAhead);

  const forecast = indexed.filter(
    (day) => day.daysAhead >= 0 && day.daysAhead <= RISK_CONSTANTS.HORIZON_DAYS,
  );

  const thresholds = Object.fromEntries(
    Object.keys(DEFAULT_THRESHOLDS).map((field) => [field, resolveThreshold(sensitivity, field)]),
  );
  trace.push({ step: RISK_TRACE_STEPS.THRESHOLDS, thresholds });
  trace.push({
    step: RISK_TRACE_STEPS.WINDOW,
    forecastDays: forecast.length,
    pastDays: indexed.length - forecast.length,
    horizonDays: RISK_CONSTANTS.HORIZON_DAYS,
  });

  if (forecast.length === 0) {
    trace.push({ step: RISK_TRACE_STEPS.NO_VERDICT, reasonCode: RISK_REASONS.NO_FORECAST_DAYS });
    return { ...emptyResult(), reasonCode: RISK_REASONS.NO_FORECAST_DAYS, trace };
  }

  const risks = [
    heavyRain(forecast, sensitivity, stage),
    heat(forecast, sensitivity, stage),
    frost(forecast, sensitivity, stage),
    wind(forecast, sensitivity, stage),
    humidityDisease(forecast, sensitivity, stage),
    drySpell(indexed, stage),
  ].filter(Boolean);

  // Deterministic order: worst first, then soonest, then the fixed type order.
  const typeOrder = Object.values(WEATHER_RISK_TYPES);
  risks.sort(
    (a, b) =>
      LEVEL_INDEX[b.level] - LEVEL_INDEX[a.level] ||
      a.daysAhead - b.daysAhead ||
      typeOrder.indexOf(a.type) - typeOrder.indexOf(b.type),
  );

  trace.push({
    step: RISK_TRACE_STEPS.EVALUATION,
    evaluated: typeOrder.length,
    triggered: risks.map((risk) => ({ type: risk.type, level: risk.level })),
  });

  if (risks.length === 0) {
    trace.push({ step: RISK_TRACE_STEPS.NO_VERDICT, reasonCode: RISK_REASONS.NO_RISK_DETECTED });
    return { risks: [], hasRisks: false, reasonCode: RISK_REASONS.NO_RISK_DETECTED, trace };
  }

  return { risks, hasRisks: true, trace };
}
