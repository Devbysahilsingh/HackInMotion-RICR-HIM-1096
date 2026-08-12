/**
 * Growth-stage and Kc derivation (pure).
 *
 * This is step 1 of the irrigation model, lifted out so every consumer that
 * needs "where in its life is this crop today?" — irrigation, fertilizer
 * timing, the feed composer — asks one function and gets one answer.
 *
 * docs/irrigation/irrigation-model.md §"The model" 1, verbatim:
 *   "Stage & Kc: days since sowing vs registry kcStages (INITIAL/DEVELOPMENT/
 *    MID/LATE with FAO-56 durations per crop) → current Kc (linear
 *    interpolation in DEVELOPMENT). Harvested/planned crops → no verdict."
 *
 * docs/irrigation/calculation-rules.md:
 *   R1  "status ≠ active → NO verdict (designed state)."
 *   R3  "Stage boundaries inclusive-start; beyond LATE end → verdict NO +
 *        harvest-approaching note."
 *   R12 "Trace must contain every number used (…kc, stage…) — explainability
 *        is contractual, UI renders trace verbatim."
 *
 * Purity (CLAUDE.md rule 5): imports nothing above config/constants — no
 * models, no services, no clock beyond the caller-supplied `asOf`. Every path
 * returns a result object; nothing here throws, because a malformed registry
 * document or a farmer's typo is a designed state, not a 500 (R14's spirit).
 *
 * Crop-neutrality (CLAUDE.md rule 4): the only crop knowledge used is the
 * `kcStages` array handed in from the registry. There is no crop code here and
 * there must never be one.
 */
import { CROP_STATUSES, GROWTH_STAGES } from '../../config/constants.js';

// ── Named constants (R13: "no magic numbers in engine code") ────────────────

/** Rule 1 of the task contract: days = floor(elapsed / one day). */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** The only status that yields a verdict (R1). */
const ACTIVE_STATUS = 'active';

/**
 * The one stage FAO-56 does not publish a Kc for: it is defined as the linear
 * transition between the initial and mid values, so the registry stores null
 * there (see kcStageSchema in models/CropRegistry.js) and we interpolate.
 * Must be a member of GROWTH_STAGES.
 */
const DEVELOPMENT_STAGE = 'DEVELOPMENT';

/**
 * Interpolated Kc is rounded so the trace shows a number a human can read back
 * against the source table rather than a float artefact. Three places keeps
 * more precision than FAO-56's published two, so rounding here can never be
 * the reason a downstream ETc differs from a worked example.
 */
const KC_DECIMALS = 3;
const KC_ROUNDING_FACTOR = 10 ** KC_DECIMALS;

/**
 * Outcome codes. Stable, UPPER_SNAKE, never user-facing: the API layer maps
 * these to i18n keys (CLAUDE.md rule 8 — no prose is produced here).
 *
 * Exactly one is returned per call, chosen in the precedence order documented
 * on `deriveStage`.
 */
export const STAGE_REASONS = Object.freeze({
  /** A stage was found and its Kc is known. `hasVerdict: true`. */
  STAGE_DERIVED: 'STAGE_DERIVED',
  /**
   * A stage was found but its Kc could not be established from the registry —
   * unsourced kc, or a DEVELOPMENT window with no usable neighbour to
   * interpolate between. `hasVerdict: true`, `kc: null`. Callers that need Kc
   * (ETc) must degrade — e.g. irrigation's simplified mode (R2) — rather than
   * substitute a number, which would be fabrication (CLAUDE.md rule 7).
   */
  STAGE_DERIVED_KC_UNAVAILABLE: 'STAGE_DERIVED_KC_UNAVAILABLE',

  /** R1: status 'planned' — sown in intent only, nothing is growing yet. */
  CROP_NOT_ACTIVE_PLANNED: 'CROP_NOT_ACTIVE_PLANNED',
  /** R1: status 'harvested' — the season is over. */
  CROP_NOT_ACTIVE_HARVESTED: 'CROP_NOT_ACTIVE_HARVESTED',
  /** Status missing or outside CROP_STATUSES: treated as not active. */
  CROP_STATUS_INVALID: 'CROP_STATUS_INVALID',

  /** sowingDate null/undefined/unparseable. */
  SOWING_DATE_INVALID: 'SOWING_DATE_INVALID',
  /** asOf supplied but unparseable. */
  AS_OF_INVALID: 'AS_OF_INVALID',
  /** kcStages not an array, or an entry has no usable stage/days. */
  KC_STAGES_INVALID: 'KC_STAGES_INVALID',
  /** kcStages is an empty array — the LIMITED-support case, not an error. */
  KC_STAGES_UNAVAILABLE: 'KC_STAGES_UNAVAILABLE',

  /** asOf precedes the sowing date: the crop has not started. */
  SOWING_DATE_IN_FUTURE: 'SOWING_DATE_IN_FUTURE',
  /** R3: past the end of the last stage window — harvest is approaching/due. */
  BEYOND_LATE_STAGE_END: 'BEYOND_LATE_STAGE_END',
});

/**
 * The two non-active CROP_STATUSES, each with its own code so the caller can
 * say "not sown yet" and "season over" differently (R1 lumps them together;
 * the farmer-facing message must not).
 */
const INACTIVE_STATUS_REASONS = Object.freeze({
  planned: STAGE_REASONS.CROP_NOT_ACTIVE_PLANNED,
  harvested: STAGE_REASONS.CROP_NOT_ACTIVE_HARVESTED,
});

/**
 * Trace step identifiers. Exported so consumers (and the UI, which renders the
 * trace verbatim per R12) switch on constants rather than string literals.
 */
export const STAGE_TRACE_STEPS = Object.freeze({
  INPUT: 'INPUT',
  DAYS_SINCE_SOWING: 'DAYS_SINCE_SOWING',
  STAGE_WINDOWS: 'STAGE_WINDOWS',
  STAGE_MATCH: 'STAGE_MATCH',
  KC_DIRECT: 'KC_DIRECT',
  KC_INTERPOLATED: 'KC_INTERPOLATED',
  KC_UNAVAILABLE: 'KC_UNAVAILABLE',
  NO_VERDICT: 'NO_VERDICT',
});

// ── Input coercion ──────────────────────────────────────────────────────────

/**
 * Accepts a Date, an epoch number or an ISO string (Mongoose hands back Dates;
 * a JSON round-trip hands back strings) and returns epoch ms, or null when the
 * value cannot be read as an instant.
 *
 * @param {Date|string|number|null|undefined} value
 * @returns {number|null}
 */
function toEpochMs(value) {
  if (value == null) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime();
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

/** ISO rendering for the trace; `null` stays `null` so the trace never lies. */
const toIso = (epochMs) => (epochMs == null ? null : new Date(epochMs).toISOString());

/**
 * A Kc is usable only if the registry actually sourced one. Anything else —
 * null (the documented "not published" marker), undefined, NaN, a negative
 * number — is "not known", never a number we invent.
 *
 * @returns {number|null}
 */
function readKc(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

const roundKc = (value) => Math.round(value * KC_ROUNDING_FACTOR) / KC_ROUNDING_FACTOR;

// ── Result shaping ──────────────────────────────────────────────────────────

/**
 * The shape every path returns.
 *
 * @typedef {object} StageResult
 * @property {string|null} stage           Current GROWTH_STAGES member, null when no verdict.
 * @property {number|null} stageIndex      Position of `stage` within kcStages, null when no verdict.
 * @property {number|null} kc              Crop coefficient for today; null when unsourced (see STAGE_DERIVED_KC_UNAVAILABLE).
 * @property {number|null} daysSinceSowing Whole days elapsed; negative when sowing is in the future; null when undatable.
 * @property {number|null} dayInStage      0-based offset into the current stage window.
 * @property {number|null} stageStartDay   First day (inclusive) of the current window, counted from sowing.
 * @property {number|null} stageEndDay     Last day (inclusive) of the current window.
 * @property {number|null} totalStageDays  Sum of all stage durations — the modelled season length.
 * @property {boolean} harvestApproaching  R3's past-end signal.
 * @property {boolean} hasVerdict          True iff a stage was derived.
 * @property {string} reasonCode           A STAGE_REASONS value; never display text.
 * @property {Array<object>} trace         Structured derivation steps (R12).
 */

/** Base result — every field explicit, so a consumer never reads `undefined`. */
const EMPTY_RESULT = {
  stage: null,
  stageIndex: null,
  kc: null,
  daysSinceSowing: null,
  dayInStage: null,
  stageStartDay: null,
  stageEndDay: null,
  totalStageDays: null,
  harvestApproaching: false,
  hasVerdict: false,
};

/**
 * Terminates a derivation without a stage. The reason is appended to the trace
 * as well as returned, so a persisted trace explains itself with no context.
 *
 * @param {string} reasonCode
 * @param {Array<object>} trace
 * @param {Partial<StageResult>} [known] Fields established before the stop.
 * @returns {StageResult}
 */
function noVerdict(reasonCode, trace, known = {}) {
  return {
    ...EMPTY_RESULT,
    ...known,
    hasVerdict: false,
    reasonCode,
    trace: [...trace, { step: STAGE_TRACE_STEPS.NO_VERDICT, reasonCode }],
  };
}

// ── Stage windows ───────────────────────────────────────────────────────────

/**
 * Turns the registry's [{stage, days, kc}] into absolute, inclusive day
 * windows counted from sowing (day 0 = the sowing day itself).
 *
 * R3, "Stage boundaries inclusive-start": a stage of `days` starting at `s`
 * owns days s … s+days-1, and day s+days is the first day of the next stage.
 *
 * @param {Array<object>} kcStages
 * @returns {{windows: Array<object>, totalDays: number}|null} null if malformed.
 */
function buildWindows(kcStages) {
  const windows = [];
  let cursor = 0;

  for (let index = 0; index < kcStages.length; index += 1) {
    const entry = kcStages[index];
    if (entry == null || typeof entry !== 'object') return null;
    if (!GROWTH_STAGES.includes(entry.stage)) return null;
    // Schema floor is 1 day; a zero/negative/NaN duration would make the walk
    // ambiguous (two stages owning the same day), so it is malformed input.
    if (typeof entry.days !== 'number' || !Number.isFinite(entry.days) || entry.days <= 0) {
      return null;
    }

    windows.push({
      index,
      stage: entry.stage,
      days: entry.days,
      kc: readKc(entry.kc),
      startDay: cursor,
      endDay: cursor + entry.days - 1,
    });
    cursor += entry.days;
  }

  return { windows, totalDays: cursor };
}

/**
 * Kc for the matched window.
 *
 * Outside DEVELOPMENT the registry's value is used as published. Inside it,
 * FAO-56 defines Kc as rising linearly from the preceding stage's value to the
 * following stage's across the development span:
 *
 *   Kc(i) = Kc_prev + (dayInStage / developmentDays) × (Kc_next − Kc_prev)
 *
 * The denominator is the full stage length (not length−1), which is FAO-56's
 * own formulation: the last day of DEVELOPMENT sits just below Kc_next, and
 * Kc_next itself is reached on the first day of the following stage. That also
 * keeps a one-day development window well defined.
 *
 * Interpolation uses the *immediately* adjacent windows only. If either is
 * missing (DEVELOPMENT first or last in the array) or has no sourced Kc, the
 * answer is "unknown" — inventing an endpoint would fabricate agronomy.
 *
 * @returns {{kc: number|null, traceEntry: object}}
 */
function resolveKc(window_, windows, dayInStage) {
  if (window_.stage !== DEVELOPMENT_STAGE) {
    if (window_.kc == null) {
      return {
        kc: null,
        traceEntry: {
          step: STAGE_TRACE_STEPS.KC_UNAVAILABLE,
          stage: window_.stage,
          cause: 'KC_NOT_SOURCED',
        },
      };
    }
    return {
      kc: window_.kc,
      traceEntry: { step: STAGE_TRACE_STEPS.KC_DIRECT, stage: window_.stage, kc: window_.kc },
    };
  }

  const previous = windows[window_.index - 1];
  const next = windows[window_.index + 1];
  const fromKc = previous?.kc ?? null;
  const toKc = next?.kc ?? null;

  if (fromKc == null || toKc == null) {
    return {
      kc: null,
      traceEntry: {
        step: STAGE_TRACE_STEPS.KC_UNAVAILABLE,
        stage: window_.stage,
        cause: 'INTERPOLATION_ENDPOINT_MISSING',
        fromStage: previous?.stage ?? null,
        fromKc,
        toStage: next?.stage ?? null,
        toKc,
      },
    };
  }

  const fraction = dayInStage / window_.days;
  const kc = roundKc(fromKc + fraction * (toKc - fromKc));

  return {
    kc,
    // R12: every number that produced the result is in the trace.
    traceEntry: {
      step: STAGE_TRACE_STEPS.KC_INTERPOLATED,
      stage: window_.stage,
      fromStage: previous.stage,
      fromKc,
      toStage: next.stage,
      toKc,
      dayInStage,
      stageDays: window_.days,
      fraction,
      kc,
    },
  };
}

// ── Entry point ─────────────────────────────────────────────────────────────

/**
 * Derives the crop's current growth stage and crop coefficient.
 *
 * Deterministic for a given (sowingDate, status, kcStages, asOf); the only
 * non-determinism available is omitting `asOf`, which callers in tests must
 * not do. Inputs are never mutated.
 *
 * Reason precedence — fixed, so the code a caller sees is stable:
 *   1. status not active                (R1: the crop's own state wins)
 *   2. unreadable sowingDate / asOf
 *   3. structurally invalid kcStages
 *   4. sowing date in the future        (crop state before registry gaps)
 *   5. kcStages empty                   (LIMITED crop, no sourced curve)
 *   6. beyond the last stage window     (R3)
 *   7. a stage — with or without Kc
 *
 * @param {object} input
 * @param {Date|string|number} input.sowingDate  When the crop went in.
 * @param {string} input.status                  A CROP_STATUSES member.
 * @param {Array<object>} input.kcStages         Registry curve: [{stage, days, kc}].
 * @param {Date|string|number} [input.asOf]      Evaluation instant; defaults to now.
 * @returns {StageResult}
 */
export function deriveStage({ sowingDate, status, kcStages, asOf = new Date() } = {}) {
  const trace = [
    {
      step: STAGE_TRACE_STEPS.INPUT,
      sowingDate: toIso(toEpochMs(sowingDate)),
      asOf: toIso(toEpochMs(asOf)),
      status: typeof status === 'string' ? status : null,
      stageCount: Array.isArray(kcStages) ? kcStages.length : null,
    },
  ];

  // (1) R1 — "status ≠ active → NO verdict (designed state)".
  if (status !== ACTIVE_STATUS) {
    // A value outside CROP_STATUSES is bad data, not a season; the distinct
    // code keeps the two apart for whoever reads the log.
    const known = CROP_STATUSES.includes(status) ? INACTIVE_STATUS_REASONS[status] : null;
    return noVerdict(known ?? STAGE_REASONS.CROP_STATUS_INVALID, trace);
  }

  // (2) Datable?
  const sowingMs = toEpochMs(sowingDate);
  if (sowingMs == null) return noVerdict(STAGE_REASONS.SOWING_DATE_INVALID, trace);
  const asOfMs = toEpochMs(asOf);
  if (asOfMs == null) return noVerdict(STAGE_REASONS.AS_OF_INVALID, trace);

  // (3) Registry curve structurally sound?
  if (!Array.isArray(kcStages)) return noVerdict(STAGE_REASONS.KC_STAGES_INVALID, trace);
  const built = buildWindows(kcStages);
  if (built == null) return noVerdict(STAGE_REASONS.KC_STAGES_INVALID, trace);
  const { windows, totalDays } = built;

  // Rule 1: floor of elapsed time in days. Day 0 is the sowing day itself.
  const elapsedMs = asOfMs - sowingMs;
  const daysSinceSowing = Math.floor(elapsedMs / MS_PER_DAY);
  trace.push({ step: STAGE_TRACE_STEPS.DAYS_SINCE_SOWING, elapsedMs, daysSinceSowing });

  // (4) Future sowing — a designed state (crops may be entered before sowing).
  if (daysSinceSowing < 0) {
    return noVerdict(STAGE_REASONS.SOWING_DATE_IN_FUTURE, trace, { daysSinceSowing });
  }

  // (5) LIMITED crops carry no sourced Kc curve yet. Not an error; the caller
  //     simply has no stage to work with.
  if (windows.length === 0) {
    return noVerdict(STAGE_REASONS.KC_STAGES_UNAVAILABLE, trace, {
      daysSinceSowing,
      totalStageDays: 0,
    });
  }

  trace.push({
    step: STAGE_TRACE_STEPS.STAGE_WINDOWS,
    totalDays,
    windows: windows.map(({ stage, days, kc, startDay, endDay }) => ({
      stage,
      days,
      kc,
      startDay,
      endDay,
    })),
  });

  // (6) R3 — "beyond LATE end → verdict NO + harvest-approaching note".
  if (daysSinceSowing >= totalDays) {
    return noVerdict(STAGE_REASONS.BEYOND_LATE_STAGE_END, trace, {
      daysSinceSowing,
      totalStageDays: totalDays,
      harvestApproaching: true,
    });
  }

  // (7) R3 — inclusive-start walk: the first window whose end has not passed.
  const matched = windows.find((w) => daysSinceSowing >= w.startDay && daysSinceSowing <= w.endDay);
  const dayInStage = daysSinceSowing - matched.startDay;
  trace.push({
    step: STAGE_TRACE_STEPS.STAGE_MATCH,
    stage: matched.stage,
    stageIndex: matched.index,
    startDay: matched.startDay,
    endDay: matched.endDay,
    dayInStage,
  });

  const { kc, traceEntry } = resolveKc(matched, windows, dayInStage);
  trace.push(traceEntry);

  return {
    stage: matched.stage,
    stageIndex: matched.index,
    kc,
    daysSinceSowing,
    dayInStage,
    stageStartDay: matched.startDay,
    stageEndDay: matched.endDay,
    totalStageDays: totalDays,
    harvestApproaching: false,
    hasVerdict: true,
    reasonCode:
      kc == null ? STAGE_REASONS.STAGE_DERIVED_KC_UNAVAILABLE : STAGE_REASONS.STAGE_DERIVED,
    trace,
  };
}

export default deriveStage;
