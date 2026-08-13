/**
 * Rule-based symptom engine constants.
 *
 * Same convention as engines/irrigation/constants.js (R13, "all constants
 * centralized + named; no magic numbers in engine code"): every value below is
 * named, frozen, and quoted back to the document that fixes it, so a reviewer
 * can check the engine against the contract without reading the engine.
 *
 * The tag vocabulary here is CLOSED. The disease knowledge base is authored
 * against exactly this list, and `matchSymptoms` ignores any registry tag
 * outside it — an unrecognised tag is a KB typo, surfaced in the trace as
 * `unknownTags`, never a silent scoring penalty. Adding a symptom the farmer
 * can report therefore means adding it here *and* re-tagging the KB, which is
 * the point: the two must never drift apart silently.
 *
 * Nothing crop-specific lives in this file and nothing ever may (CLAUDE.md
 * rule 4) — all crop knowledge arrives as `registryCrop.diseases[]`.
 */
import { SPREAD_RATES } from '../../config/constants.js';

// ── Tag encoding ────────────────────────────────────────────────────────────

/** Tags are `axis:VALUE`. One separator, declared once, used to build and read. */
export const TAG_SEPARATOR = ':';

/**
 * The single place a tag string is constructed. Both the vocabulary below and
 * the engine's answer→tag derivation go through it, so a farmer's answer and a
 * KB tag can never be spelled differently.
 *
 * @param {string} axis  A SYMPTOM_AXES member.
 * @param {string} value An axis value from SYMPTOM_VALUES.
 * @returns {string}
 */
export const tagFor = (axis, value) => `${axis}${TAG_SEPARATOR}${value}`;

/** The axis half of a tag, or null when the string is not tag-shaped. */
export const axisOf = (tag) => {
  if (typeof tag !== 'string') return null;
  const at = tag.indexOf(TAG_SEPARATOR);
  return at > 0 ? tag.slice(0, at) : null;
};

// ── Axes ────────────────────────────────────────────────────────────────────

/** Axis names. These are the keys of config `SYMPTOM_WEIGHTS`; they must stay in sync. */
export const SYMPTOM_AXIS = Object.freeze({
  PART: 'part',
  PATTERN: 'pattern',
  COLOR: 'color',
  DISTRIBUTION: 'distribution',
  WEATHER: 'weather',
});

/**
 * The axes a farmer answers, in the order docs/ai/fallback-strategy.md §1 asks
 * the questions ("affected part; pattern …; color; distribution …"). The order
 * is load-bearing: it fixes the order of `matchedTags` and of the per-axis
 * trace breakdown, so two identical inputs produce byte-identical output.
 */
export const ANSWER_AXES = Object.freeze([
  SYMPTOM_AXIS.PART,
  SYMPTOM_AXIS.PATTERN,
  SYMPTOM_AXIS.COLOR,
  SYMPTOM_AXIS.DISTRIBUTION,
]);

/**
 * Every scoring axis. Weather is last because it is the one axis the farmer
 * does not answer — it is "auto-attached … from snapshot" (fallback-strategy
 * §1) and is simply absent when no snapshot is available.
 */
export const SYMPTOM_AXES = Object.freeze([...ANSWER_AXES, SYMPTOM_AXIS.WEATHER]);

// ── The closed value vocabulary ─────────────────────────────────────────────

/**
 * Per-axis answer values. `SYMPTOM_TAGS` is derived from this map, so the enum
 * a request validator checks and the tag a KB entry declares have exactly one
 * source of truth.
 *
 * These are structural symptom descriptors, not agronomic claims: nothing here
 * asserts that any particular crop gets any particular disease.
 */
export const SYMPTOM_VALUES = Object.freeze({
  [SYMPTOM_AXIS.PART]: Object.freeze(['LEAF', 'STEM', 'FRUIT', 'FLOWER', 'ROOT', 'WHOLE_PLANT']),
  [SYMPTOM_AXIS.PATTERN]: Object.freeze([
    'SPOTS',
    'BLOTCHES',
    'POWDER',
    'CURL',
    'WILT',
    'HOLES',
    'YELLOWING',
    'STREAKS',
    'LESIONS',
    'MOSAIC',
    'ROT',
    'STUNTING',
    'WEBBING',
    'RINGS',
  ]),
  [SYMPTOM_AXIS.COLOR]: Object.freeze([
    'YELLOW',
    'BROWN',
    'BLACK',
    'WHITE',
    'GREY',
    'RED',
    'ORANGE',
    'PURPLE',
    'TAN',
  ]),
  [SYMPTOM_AXIS.DISTRIBUTION]: Object.freeze([
    'LOWER_LEAVES',
    'UPPER_LEAVES',
    'ALL_LEAVES',
    'SCATTERED',
    'MARGINS',
    'VEINS',
  ]),
  [SYMPTOM_AXIS.WEATHER]: Object.freeze(['HIGH_HUMIDITY', 'RAIN', 'HOT_DRY', 'COOL_MOIST']),
});

/** The closed tag list, per axis. */
export const SYMPTOM_TAGS = Object.freeze(
  Object.fromEntries(
    SYMPTOM_AXES.map((axis) => [
      axis,
      Object.freeze(SYMPTOM_VALUES[axis].map((value) => tagFor(axis, value))),
    ]),
  ),
);

/** The closed tag list, flattened — the membership test the engine applies. */
export const ALL_SYMPTOM_TAGS = Object.freeze(SYMPTOM_AXES.flatMap((axis) => SYMPTOM_TAGS[axis]));

/**
 * Spread speed. Re-exported rather than redefined: `SPREAD_RATES` is already
 * the wire enum for the severity follow-up (docs/api/crop-health.md), and the
 * symptom checker asks the same question, so one enum serves both.
 *
 * Spread carries no scoring weight — fallback-strategy §2 lists weights for
 * pattern/part/color/distribution/weather only. It is a referral trigger (§3,
 * "user-reported rapid spread"), not evidence for or against any disease.
 */
export const SPREAD_VALUES = SPREAD_RATES;

/** The one spread answer that forces a human referral (fallback-strategy §3). */
export const SPREAD_RAPID = 'RAPID';

// ── Weather-context derivation ──────────────────────────────────────────────

/**
 * Thresholds that turn a weather snapshot into `weather:*` tags — the "fungal
 * prior" of fallback-strategy §1.
 *
 * ENGINE POLICY, not sourced agronomy. No repository document defines these
 * cut-offs, so they are named here, reported in the trace with the numbers that
 * produced them, and deliberately conservative:
 *
 *   HIGH_HUMIDITY_PCT  85  — the same RH figure the weather-risk engine uses
 *                            for its HUMIDITY_DISEASE trigger ("RH ≥85%",
 *                            docs/weather/weather-architecture.md). Held
 *                            identical so a farmer is never told the weather is
 *                            disease-favourable on one screen and not on
 *                            another.
 *   RAIN_MM           2.5  — the conventional daily cut-off for counting a day
 *                            as a rain day in Indian daily rainfall reporting.
 *   HOT_TMAX_C         32  — the top of that same disease temperature band
 *                            ("25–32°C"): above it the humid-fungal prior stops
 *                            applying and mite/heat-stress patterns start.
 *   DRY_HUMIDITY_PCT   50  — "dry" is asserted only with an actual humidity
 *                            reading; a hot day of unknown humidity is not dry.
 *   COOL_TMAX_C        25  — the bottom of the same band.
 *   MOIST_HUMIDITY_PCT 70  — moist-but-not-saturated, below HIGH_HUMIDITY_PCT
 *                            so a cool humid day can raise both tags, which is
 *                            simply two true statements about one day.
 */
export const WEATHER_THRESHOLDS = Object.freeze({
  HIGH_HUMIDITY_PCT: 85,
  RAIN_MM: 2.5,
  HOT_TMAX_C: 32,
  DRY_HUMIDITY_PCT: 50,
  COOL_TMAX_C: 25,
  MOIST_HUMIDITY_PCT: 70,
});

// ── Output vocabulary ───────────────────────────────────────────────────────

/**
 * Match scores are rounded before banding so the number the trace prints, the
 * number the API returns and the number compared against `expertThreshold` are
 * the same number, and so 2/3 is a stable `0.667` rather than a float artefact.
 * Three places matches the stage engine's Kc rounding.
 */
export const SCORE_DECIMALS = 3;

/**
 * Outcome codes. Stable, UPPER_SNAKE, never user-facing — the API layer maps
 * them to i18n keys (CLAUDE.md rule 8; no prose is produced in an engine).
 * Exactly one is returned per call.
 */
export const SYMPTOM_REASONS = Object.freeze({
  /** Candidates were produced. `hasVerdict: true`. */
  CANDIDATES_MATCHED: 'CANDIDATES_MATCHED',

  /** `registryCrop` absent or not an object — nothing to differentiate against. */
  REGISTRY_CROP_UNAVAILABLE: 'REGISTRY_CROP_UNAVAILABLE',
  /** supportLevel UNSUPPORTED: the platform does not claim to know this crop. */
  CROP_UNSUPPORTED: 'CROP_UNSUPPORTED',
  /** The crop is supported but its disease KB is absent or empty (LIMITED case). */
  DISEASE_KB_UNAVAILABLE: 'DISEASE_KB_UNAVAILABLE',

  /** The farmer answered no symptom axis; there is nothing to score. */
  NO_SYMPTOMS_ANSWERED: 'NO_SYMPTOMS_ANSWERED',
  /**
   * Diseases exist but not one of them declares a tag on any axis the farmer
   * answered, so no entry is even scorable. A KB-coverage gap, reported as
   * itself rather than disguised as "no disease matches".
   */
  KB_TAGS_UNAVAILABLE: 'KB_TAGS_UNAVAILABLE',
  /**
   * Entries were scorable and every one scored zero: the answers contradict the
   * whole KB. The honest answer is a referral, not a list of 0% "possibles".
   */
  NO_CANDIDATE_MATCH: 'NO_CANDIDATE_MATCH',
});

/**
 * Why a human expert was proposed. Plural — a rapid-spreading, well-matched
 * disease refers for a different reason than a weak match, and the CTA copy
 * differs.
 */
export const EXPERT_REFERRAL_REASONS = Object.freeze({
  /** "score <0.4" — measured against the top candidate's own threshold. */
  SCORE_BELOW_THRESHOLD: 'SCORE_BELOW_THRESHOLD',
  /** "or user-reported rapid spread". */
  RAPID_SPREAD_REPORTED: 'RAPID_SPREAD_REPORTED',
  /** Any no-verdict state: nothing was concluded, so a human is the next step. */
  NO_VERDICT: 'NO_VERDICT',
});

/**
 * Trace step identifiers. Exported so consumers (and the UI, which renders the
 * trace) switch on constants rather than string literals.
 */
export const SYMPTOM_TRACE_STEPS = Object.freeze({
  INPUT: 'INPUT',
  WEATHER_CONTEXT: 'WEATHER_CONTEXT',
  SCORING: 'SCORING',
  VERDICT: 'VERDICT',
  NO_VERDICT: 'NO_VERDICT',
});

/** Why a KB entry was not scored — trace-only detail on a SCORING step. */
export const SKIP_CAUSES = Object.freeze({
  /** The entry has no usable `code`; it cannot be cited, so it cannot be shown. */
  INVALID_DISEASE_ENTRY: 'INVALID_DISEASE_ENTRY',
  /** The entry declares no tag on any answered axis: silent, so neither for nor against. */
  NO_TAGS_ON_ANSWERED_AXES: 'NO_TAGS_ON_ANSWERED_AXES',
  /** Scorable, but matched nothing the farmer reported. */
  ZERO_MATCH: 'ZERO_MATCH',
});
