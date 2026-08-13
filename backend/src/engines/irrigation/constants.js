/**
 * Irrigation engine constants.
 *
 * Rule R13: "All constants centralized + named; no magic numbers in engine
 * code." Every value below is quoted from docs/irrigation/ with its rule id, so
 * a reviewer can check the engine against the contract without reading code.
 */

export const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** R6: "Effective rain factor 0.80 (named constant EFFECTIVE_RAIN_COEFF)". */
export const EFFECTIVE_RAIN_COEFF = 0.8;

/** R7: "Rain counts in projection iff probPct ≥ 60 (RAIN_PROB_THRESHOLD)". */
export const RAIN_PROB_THRESHOLD = 60;

/** R9: "amountMm = ceil(D/5)*5, min 10, max 75 per event". */
export const AMOUNT_STEP_MM = 5;
export const AMOUNT_MIN_MM = 10;
export const AMOUNT_MAX_MM = 75;

/** irrigation-model.md §5: "Verdict horizon (next 5 days)". */
export const HORIZON_DAYS = 5;

/** irrigation-model.md §4: "replay past-7-days weather from snapshot". */
export const COLD_START_REPLAY_DAYS = 7;

/** irrigation-model.md §7: "rain ≥10mm within 48h prob≥60% → wait". */
export const SIMPLIFIED_RAIN_MM = 10;
export const SIMPLIFIED_RAIN_WINDOW_HOURS = 48;

/**
 * Verdicts.
 *
 * `UNAVAILABLE` and `MAINTAIN_WATER_LEVEL` are absent from the union printed in
 * docs/api/irrigation.md, which is internally inconsistent: the very next line
 * of that file returns `verdict:'UNAVAILABLE'`, and R11 requires a distinct
 * standing-water outcome for paddy. Both are added here and the API doc is
 * corrected. `MAINTAIN_WATER_LEVEL` is a new name — no document proposed one.
 */
export const VERDICTS = Object.freeze({
  IRRIGATE_TODAY: 'IRRIGATE_TODAY',
  IRRIGATE_IN_N_DAYS: 'IRRIGATE_IN_N_DAYS',
  WAIT_RAIN_EXPECTED: 'WAIT_RAIN_EXPECTED',
  NO_IRRIGATION_NEEDED: 'NO_IRRIGATION_NEEDED',
  MAINTAIN_WATER_LEVEL: 'MAINTAIN_WATER_LEVEL',
  UNAVAILABLE: 'UNAVAILABLE',
});

export const MODES = Object.freeze({ FULL: 'full', SIMPLIFIED: 'simplified' });

/**
 * Outcome codes. Stable, UPPER_SNAKE, never user-facing — the API layer maps
 * them to i18n keys (rule 8).
 */
export const IRRIGATION_REASONS = Object.freeze({
  OK: 'OK',
  /** R1: the crop is not in the ground. */
  CROP_NOT_ACTIVE: 'CROP_NOT_ACTIVE',
  /** R3: past the end of the published crop calendar. */
  BEYOND_SEASON: 'BEYOND_SEASON',
  /** R14: no usable weather at all. */
  NO_WEATHER: 'NO_WEATHER',
  /** R14 variant: weather exists but carries no forecast days. */
  NO_FORECAST: 'NO_FORECAST',
  /** The registry has no Kc curve, so ETc cannot be computed. */
  KC_UNAVAILABLE: 'KC_UNAVAILABLE',
  /** The registry has no root depth or depletion fraction. */
  SOIL_RESERVOIR_UNKNOWN: 'SOIL_RESERVOIR_UNKNOWN',
  /**
   * Simplified mode with nothing to fall back on. `simplifiedIntervals` is
   * declared on the registry but no knowledge file authors it, so it is always
   * empty — the honest answer is "cannot advise", not an invented interval.
   */
  SIMPLIFIED_INTERVALS_NOT_SOURCED: 'SIMPLIFIED_INTERVALS_NOT_SOURCED',
  /** R11: standing-water crop; depletion scheduling does not apply. */
  PADDY_STANDING_WATER: 'PADDY_STANDING_WATER',
});

export const IRRIGATION_TRACE_STEPS = Object.freeze({
  INPUT: 'INPUT',
  STAGE: 'STAGE',
  MODE: 'MODE',
  SOIL: 'SOIL',
  DEPLETION_FRACTION: 'DEPLETION_FRACTION',
  RESERVOIR: 'RESERVOIR',
  LEDGER: 'LEDGER',
  PROJECTION: 'PROJECTION',
  VERDICT: 'VERDICT',
  NO_VERDICT: 'NO_VERDICT',
});
