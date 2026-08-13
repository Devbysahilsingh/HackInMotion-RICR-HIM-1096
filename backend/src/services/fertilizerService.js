/**
 * Fertilizer guidance (docs/api/intelligence.md:
 * "GET /crops/:id/fertilizer-guidance | Auth | → current-stage card + full
 *  schedule + deficiency symptoms + sources + disclaimer. Pure registry read.").
 *
 * This is the highest-harm surface in the product, so the rules are strict and
 * they are the KB's own (docs/fertilizer/fertilizer-intelligence.md):
 *
 *   "No invented/averaged/silently-converted numbers; no 'prescription' /
 *    'expert advice' language; no guarantee claims; no ICAR/TNAU endorsement
 *    implication; no pesticide-dosage creep."
 *
 * Consequences implemented here:
 *   - every dose is served exactly as published, **in its published unit**.
 *     TNAU's cotton and PAU's wheat figures are per *acre*; the rest are per
 *     hectare. Normalising them would change the quantity a farmer applies.
 *   - a dose whose unit the source did not print (both onion rows) is served
 *     with `unit: null` and an explicit `unitUnknown` flag, because an
 *     unlabelled number is worse than no number.
 *   - `verificationPending` travels to the client rather than being hidden.
 *   - the disclaimer is attached unconditionally to every response.
 *   - nothing is computed. There is no arithmetic in this file at all beyond
 *     matching a published timing string to a day number.
 */
import { deriveStage } from '../engines/stage/deriveStage.js';
import { CropRegistry } from '../models/index.js';

/** Mandatory on every fertilizer response (knowledge-base.md: "mandatory": true). */
export const DISCLAIMER_KEY = 'fertilizer.disclaimerGeneral';

/**
 * Turns a published timing string into a day window after sowing.
 *
 * The strings are the source's own words — "25 DAS", "40–45 DAS", "30 d",
 * "30 DAP", "at sowing", "before 1st irrigation". Parsing them is reading what
 * was published, not inventing a schedule; anything that does not parse gets
 * `null` and simply is not highlighted.
 *
 * This exists because the fertilizer schedule and the growth-stage engine speak
 * different vocabularies — `BASAL`/`TOPDRESS_1` versus FAO-56's
 * `INITIAL`/`MID` — and **no mapping between them exists anywhere in the
 * repository**. Rather than invent one, the current-stage card is selected by
 * elapsed days, which both vocabularies can be compared against.
 */
export function parseTiming(timing) {
  if (typeof timing !== 'string') return null;
  const text = timing.trim().toLowerCase();
  if (!text) return null;

  if (text === 'at sowing') return { fromDay: 0, toDay: 0, basis: 'at sowing' };

  // "40–45 DAS" (en dash or hyphen) → a window.
  const range = /^(\d+)\s*[–-]\s*(\d+)\s*(das|dap|d)\b/.exec(text);
  if (range) {
    return { fromDay: Number(range[1]), toDay: Number(range[2]), basis: timing };
  }

  // "25 DAS", "30 d", "30 DAP" → a point, treated as a one-day window.
  const point = /^(\d+)\s*(das|dap|d)\b/.exec(text);
  if (point) {
    const day = Number(point[1]);
    return { fromDay: day, toDay: day, basis: timing };
  }

  // "before 1st irrigation" and friends: real, published, but not a day number.
  return null;
}

/**
 * Marks the schedule entry the crop is currently at.
 *
 * A window is "current" when today falls inside it; entries with unparseable
 * timings are never current and say why. `BASAL` is current only on the sowing
 * day itself — it is an at-planting application, and highlighting it a month
 * later would imply an action that has passed.
 */
function annotateSchedule(schedule, daysSinceSowing) {
  return schedule.map((entry) => {
    const window = parseTiming(entry.timing);
    const isCurrent =
      window !== null &&
      typeof daysSinceSowing === 'number' &&
      daysSinceSowing >= window.fromDay &&
      daysSinceSowing <= window.toDay;

    return {
      stage: entry.stage,
      timing: entry.timing ?? null,
      fractionKey: entry.fractionKey,
      note: entry.note ?? null,
      window,
      isCurrent,
      // Distinguishes "not now" from "we cannot tell when".
      timingUnknown: window === null,
    };
  });
}

/** A published dose, passed through untouched, with its unit state made explicit. */
function presentDose(dose) {
  if (!dose || typeof dose !== 'object') return null;
  const unitUnknown = dose.unit === null || dose.unit === undefined;

  return {
    ...dose,
    // Gap F7: both onion rows publish no unit at all. An unlabelled dose must
    // never render as though it had one.
    unitUnknown,
    // A boolean alone gives the client nothing to say. The key carries the
    // explanation, so a unit-less dose can state why rather than just look
    // incomplete.
    unitNoteKey: unitUnknown ? 'fertilizer.unitNotPublished' : null,
  };
}

/**
 * @param {object} crop an already-authorized Crop document
 * @param {{asOf?: Date}} [options]
 */
export async function fertilizerGuidance(crop, { asOf = new Date() } = {}) {
  const registry = await CropRegistry.findOne({ cropCode: crop.cropCode })
    .select('cropCode names fertilizer kcStages')
    .lean();

  const stage = deriveStage({
    sowingDate: crop.sowingDate,
    status: crop.status,
    kcStages: registry?.kcStages ?? [],
    asOf,
  });

  const base = {
    cropCode: crop.cropCode,
    names: registry?.names ?? null,
    stage: stage.stage,
    daysSinceSowing: stage.daysSinceSowing ?? null,
    // Attached before any early return: the disclaimer is unconditional.
    disclaimerKey: DISCLAIMER_KEY,
  };

  const fertilizer = registry?.fertilizer;
  if (!fertilizer?.recommendations?.length) {
    // "Uncovered crop/region: say so; never extrapolate numbers."
    return {
      ...base,
      covered: false,
      reasonKey: 'fertilizer.notCovered',
      recommendations: [],
      deficiencySymptoms: [],
      sources: [],
    };
  }

  const recommendations = fertilizer.recommendations.map((recommendation) => ({
    varietyClass: recommendation.varietyClass ?? null,
    // "blanket_no_soil_test" vs "stcr_soil_test" — the two-tier structure every
    // SAU publishes. The client labels which tier it is showing.
    basis: recommendation.basis,
    totalNpk: presentDose(recommendation.totalNpk),
    organics: presentDose(recommendation.organics),
    micronutrients: presentDose(recommendation.micronutrients),
    schedule: annotateSchedule(recommendation.schedule ?? [], stage.daysSinceSowing),
    source: recommendation.source,
  }));

  return {
    ...base,
    covered: true,
    // The KB's own framing: this is a compilation of published general
    // recommendations, not a prescription for this field.
    guidanceTypeKey: 'fertilizer.typeGeneralNoSoilTest',
    context: fertilizer.context ?? null,
    /**
     * Surfaced, not hidden. Three crops (wheat, soybean, potato) carry numbers
     * that still need primary-PDF verification, and a farmer reading a dose is
     * entitled to know which tier of confidence it sits in.
     */
    verificationPending: Boolean(fertilizer.verificationPending),
    verificationNoteKey: fertilizer.verificationPending ? 'fertilizer.verificationPending' : null,
    recommendations,
    deficiencySymptoms: fertilizer.deficiencySymptoms ?? [],
    // Every number's provenance, deduplicated by URL.
    sources: dedupeSources(fertilizer.recommendations.map((entry) => entry.source)),
    limitationsKey: 'fertilizer.limitations',
    soilTestCtaKey: 'fertilizer.soilTestCta',
  };
}

function dedupeSources(sources) {
  const seen = new Map();
  for (const source of sources) {
    if (!source) continue;
    const key = source.url ?? `${source.org}|${source.title}`;
    if (!seen.has(key)) seen.set(key, source);
  }
  return [...seen.values()];
}
