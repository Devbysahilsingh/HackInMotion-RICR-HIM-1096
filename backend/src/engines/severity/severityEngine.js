/**
 * Severity assessment (FR-H3).
 *
 * CLAUDE.md rule 9 and docs/ai/ai-safety.md rule 2 both say the same thing:
 * **severity is engine-assessed, never model-fabricated.** A vision model can
 * report how much of a leaf looks affected; it cannot be allowed to hand a
 * farmer the word "severe", because that word drives whether they spend money
 * today. So the model's `severityVisual` enters here as *one input among
 * several* and the engine's output is what is stored and shown
 * (docs/ai/response-schema.md states exactly this).
 *
 * ## The banding function is declared policy, not sourced agronomy
 *
 * No repository document publishes a severity formula, and no source was found
 * that publishes one that generalises across diseases — infection thresholds
 * are per-pathogen and per-crop, and inventing a set would be exactly the
 * fabricated agronomy CLAUDE.md rule 7 forbids. What follows is therefore an
 * explicitly *declared* ordinal policy, labelled as such in the output
 * (`policy: 'ENGINE_POLICY'`) and recorded in ADR-024, following the precedent
 * ADR-023 set for weather-risk banding: state the arithmetic, put every input
 * in the trace, and never present the result as a measurement.
 *
 * ## Why the merge is a maximum rather than an average
 *
 * docs/ml/evaluation-plan.md ranks the dangerous failure as
 * "(1) disease→HEALTHY false negatives" and calls the opposite direction an
 * "acceptable asymmetry (cost: unnecessary worry/inspection, stated)". An
 * average lets a low visual estimate cancel a high measured area and quietly
 * under-call; a maximum cannot. The engine errs toward telling a farmer to look
 * more closely, which is the cheap mistake.
 *
 * Pure: imports nothing above config/constants, holds no clock, throws nothing.
 * Every failure is a designed state carrying a reasonCode.
 */
import { SEVERITY_LEVELS, SPREAD_RATES, UNKNOWN_DISEASE_CODE } from '../../config/constants.js';

/** Ordinal ladder. Index is the score; the vocabulary is the stored one. */
const LADDER = Object.freeze(['MILD', 'MODERATE', 'SEVERE']);
const NOT_ASSESSED = 'NOT_ASSESSED';

export const SEVERITY_REASONS = Object.freeze({
  OK: 'OK',
  NO_INPUTS: 'NO_INPUTS',
  NOT_A_DISEASE: 'NOT_A_DISEASE',
  UNKNOWN_DIAGNOSIS: 'UNKNOWN_DIAGNOSIS',
});

export const SEVERITY_TRACE_STEPS = Object.freeze({
  INPUT: 'INPUT',
  VISUAL: 'VISUAL',
  AREA: 'AREA',
  MERGE: 'MERGE',
  SPREAD: 'SPREAD',
  VERDICT: 'VERDICT',
  NO_VERDICT: 'NO_VERDICT',
});

/**
 * Affected-area bands.
 *
 * Declared policy. The boundaries are round numbers chosen to be legible to a
 * farmer answering "roughly how much of the plant looks affected?" — a
 * question that cannot carry more precision than this — not values read from a
 * disease-assessment key.
 */
const AREA_BANDS = Object.freeze([
  { maxPct: 10, score: 0 },
  { maxPct: 33, score: 1 },
  { maxPct: 100, score: 2 },
]);

const bandForArea = (pct) => AREA_BANDS.find((band) => pct <= band.maxPct)?.score ?? 2;

/** `severityVisual` → ladder score. `NOT_ASSESSABLE` contributes nothing. */
const bandForVisual = (visual) => {
  const index = LADDER.indexOf(visual);
  return index >= 0 ? index : null;
};

function noVerdict(reasonCode, trace) {
  return {
    severity: NOT_ASSESSED,
    score: null,
    hasVerdict: false,
    escalate: false,
    policy: 'ENGINE_POLICY',
    reasonCode,
    trace: [...trace, { step: SEVERITY_TRACE_STEPS.NO_VERDICT, reasonCode }],
  };
}

/**
 * @typedef {object} SeverityResult
 * @property {string} severity     a SEVERITY_LEVELS member; 'NOT_ASSESSED' when no verdict
 * @property {number|null} score   ordinal position on the ladder, null when no verdict
 * @property {boolean} hasVerdict
 * @property {boolean} escalate    true when the farmer should be urged to act now
 * @property {'ENGINE_POLICY'} policy provenance label — never a measurement
 * @property {string} reasonCode   a SEVERITY_REASONS value; never display text
 * @property {Array<object>} trace derivation steps (R12)
 *
 * @param {object} input
 * @param {string|null} [input.diseaseCode]      the diagnosis this severity is about
 * @param {boolean} [input.isHealthy]            true when the diagnosis is a healthy class
 * @param {string|null} [input.severityVisual]   the AI tier's visual estimate, if any
 * @param {number|null} [input.affectedAreaPct]  follow-up answer, 0..100
 * @param {string|null} [input.spreadRate]       follow-up answer, a SPREAD_RATES member
 * @returns {SeverityResult}
 */
export function assessSeverity({
  diseaseCode = null,
  isHealthy = false,
  severityVisual = null,
  affectedAreaPct = null,
  spreadRate = null,
} = {}) {
  const trace = [
    {
      step: SEVERITY_TRACE_STEPS.INPUT,
      diseaseCode,
      isHealthy,
      severityVisual,
      affectedAreaPct,
      spreadRate,
    },
  ];

  // A healthy plant has no severity. Emitting "MILD" for a healthy result would
  // read as "mildly diseased" and is the one output here that could do harm by
  // existing at all.
  if (isHealthy) return noVerdict(SEVERITY_REASONS.NOT_A_DISEASE, trace);

  // Severity of *what*? Without a named condition there is nothing to grade,
  // and grading an unknown would dress uncertainty up as a measurement.
  if (!diseaseCode || diseaseCode === UNKNOWN_DISEASE_CODE) {
    return noVerdict(SEVERITY_REASONS.UNKNOWN_DIAGNOSIS, trace);
  }

  const scores = [];

  const visualScore = bandForVisual(severityVisual);
  if (visualScore !== null) {
    scores.push(visualScore);
    trace.push({
      step: SEVERITY_TRACE_STEPS.VISUAL,
      severityVisual,
      score: visualScore,
      // Named so a reader of the trace cannot mistake the model's estimate for
      // the engine's verdict.
      contributor: 'ai_visual_estimate',
    });
  }

  const areaKnown = typeof affectedAreaPct === 'number' && Number.isFinite(affectedAreaPct);
  if (areaKnown) {
    const clamped = Math.min(100, Math.max(0, affectedAreaPct));
    const areaScore = bandForArea(clamped);
    scores.push(areaScore);
    trace.push({
      step: SEVERITY_TRACE_STEPS.AREA,
      affectedAreaPct: clamped,
      score: areaScore,
      contributor: 'farmer_reported_area',
    });
  }

  // Nothing to grade with. This is a designed outcome, not a failure: the
  // follow-up endpoint exists precisely to fill it in later.
  if (scores.length === 0) return noVerdict(SEVERITY_REASONS.NO_INPUTS, trace);

  const merged = Math.max(...scores);
  trace.push({ step: SEVERITY_TRACE_STEPS.MERGE, inputs: scores, merged, rule: 'max' });

  // Rapid spread is about trajectory rather than current extent: a small patch
  // spreading fast is the case where waiting is expensive, so it lifts the band
  // by one and is what turns the result into an escalation.
  const rapid = spreadRate === 'RAPID';
  const score = Math.min(LADDER.length - 1, merged + (rapid ? 1 : 0));
  if (spreadRate) {
    trace.push({
      step: SEVERITY_TRACE_STEPS.SPREAD,
      spreadRate,
      applied: rapid ? 1 : 0,
      score,
    });
  }

  const severity = LADDER[score];
  const escalate = rapid || severity === 'SEVERE';

  trace.push({ step: SEVERITY_TRACE_STEPS.VERDICT, severity, score, escalate });

  return {
    severity,
    score,
    hasVerdict: true,
    escalate,
    policy: 'ENGINE_POLICY',
    reasonCode: SEVERITY_REASONS.OK,
    trace,
  };
}

/** Exported so the route's validator and the model stay on one vocabulary. */
export { LADDER as SEVERITY_LADDER, NOT_ASSESSED, SEVERITY_LEVELS, SPREAD_RATES };
