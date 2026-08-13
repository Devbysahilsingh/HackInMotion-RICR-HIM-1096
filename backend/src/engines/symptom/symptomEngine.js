/**
 * Rule-based symptom engine — PURE (CLAUDE.md rule 5).
 *
 * The terminal tier of the crop-health chain and the standalone no-photo path
 * (`POST /crop-health/symptom-check`). It runs a guided differential over the
 * registry disease KB: no model, no network, no prose, no clock.
 *
 * docs/ai/fallback-strategy.md §"Mechanism", verbatim:
 *   1. "Question set …: affected part; pattern (spots/blotches/powder/curl/
 *       wilt/holes/yellowing); color; distribution (lower/upper/all leaves);
 *       spread speed; weather context auto-attached (humidity/rain from
 *       snapshot — fungal prior)."
 *   2. "Scoring: each KB disease entry carries symptom feature tags; answers →
 *       weighted match score (weights: pattern 3, part 2, color 2,
 *       distribution 1, weather-context 1); normalized."
 *   3. "Output: top candidates with matchScore bands (Possible/Likely — never
 *       'Diagnosed'), inspection guidance + next steps + prevention from KB,
 *       expert-referral threshold (score <0.4 or user-reported rapid spread →
 *       'contact KVK/Kisan Call Centre' primary CTA)."
 *   4. "Honesty framing: source label 'Guided assessment (no AI)'; result stored
 *       with source:'rules'; excluded from community aggregation."
 *
 * Purity: imports nothing above config/constants — no models, no services, no
 * `Date.now()`. `asOf` is a caller-supplied parameter and is used only to stamp
 * the result (this project has no fake timers, ADR-022). Nothing here throws:
 * a crop with no KB, a farmer who knows one thing, a malformed registry
 * document and a set of mutually contradictory answers are all *designed
 * states* carrying a reason code, never a 500. Inputs are never mutated.
 *
 * Crop-neutrality (rule 4): there is no crop code in this file and there must
 * never be one. Every disease, tag, threshold and i18n key comes from the
 * `registryCrop.diseases[]` array handed in.
 *
 * ── The normalisation decision (the one that matters) ──────────────────────
 *
 * §2 says "normalized" without saying over what. This engine normalises over
 * the *intersection* of what the farmer answered and what the disease entry
 * declares:
 *
 *   matchScore = awarded / answerable
 *     awarded    = Σ weight(axis) for answered axes where the entry declares a
 *                  tag on that axis AND one of them is the answered tag
 *     answerable = Σ weight(axis) for answered axes where the entry declares at
 *                  least one tag on that axis
 *
 * Three candidate denominators were considered:
 *
 *   (a) total weight of all five axes — punishes both a farmer who only knows
 *       one thing and a sparsely-tagged KB entry. Every score would be small
 *       and the 0.4 referral threshold would fire on nearly everything, which
 *       destroys the band distinction the doc asks for.
 *   (b) total weight of the answered axes — punishes an entry for the farmer
 *       volunteering *more* information. A leaf-curl virus that legitimately
 *       declares no `color:` tag would score 3/5 instead of 3/3 purely because
 *       the farmer also named a colour, so answering more questions would lower
 *       the score of the right answer. Backwards.
 *   (c) the intersection — chosen. It reads as "of the evidence this entry can
 *       speak to, how much matched", which is exactly what a first-pass
 *       differential asserts. A silent axis is neither evidence for nor against.
 *
 * The known cost of (c): a thinly-tagged entry can reach 1.0 on a single
 * matched axis and outrank a richly-tagged entry that matched four of five.
 * That is why every SCORING trace step carries `awarded`, `answerable` and the
 * per-axis breakdown — the UI can say "matched 1 of the 4 things you told us"
 * — and why the KB is authored against a closed vocabulary so entries are
 * tagged comparably in the first place.
 *
 * Two corollaries follow, both of which the tests pin:
 *   • An axis with no available answer (the farmer skipped it; no weather
 *     snapshot exists) contributes to NEITHER numerator nor denominator. An
 *     absent weather snapshot must never quietly penalise every disease.
 *   • An entry that declares tags on none of the answered axes has
 *     `answerable === 0`. It is not scorable — 0/0 is not a score — so it is
 *     omitted rather than shown at a fabricated 0%.
 *
 * ── Reason precedence (fixed, so the code a caller sees is stable) ─────────
 *   1. registryCrop missing               REGISTRY_CROP_UNAVAILABLE
 *   2. supportLevel UNSUPPORTED           CROP_UNSUPPORTED
 *   3. diseases absent/empty              DISEASE_KB_UNAVAILABLE
 *   4. no symptom axis answered           NO_SYMPTOMS_ANSWERED
 *   5. nothing scorable                   KB_TAGS_UNAVAILABLE
 *   6. everything scored zero             NO_CANDIDATE_MATCH
 *   7. candidates                         CANDIDATES_MATCHED
 * Crop-level states outrank answer-level ones: telling a farmer "we have no
 * knowledge base for this crop" is true regardless of what they answered,
 * whereas "you answered nothing" would be misleading advice to try again.
 */
import {
  DEFAULT_EXPERT_THRESHOLD,
  HEALTH_SOURCES,
  MATCH_BANDS,
  MATCH_BAND_LIKELY_MIN,
  MAX_SYMPTOM_CANDIDATES,
  SYMPTOM_WEIGHTS,
} from '../../config/constants.js';
import {
  ALL_SYMPTOM_TAGS,
  ANSWER_AXES,
  EXPERT_REFERRAL_REASONS,
  SCORE_DECIMALS,
  SKIP_CAUSES,
  SPREAD_RAPID,
  SPREAD_VALUES,
  SYMPTOM_AXES,
  SYMPTOM_AXIS,
  SYMPTOM_REASONS,
  SYMPTOM_TRACE_STEPS,
  SYMPTOM_VALUES,
  axisOf,
  tagFor,
  WEATHER_THRESHOLDS,
} from './constants.js';

/** The one supportLevel that means "we do not claim to know this crop". Member of SUPPORT_LEVELS. */
const UNSUPPORTED_LEVEL = 'UNSUPPORTED';

/** Membership test for the closed vocabulary — built once, read per disease tag. */
const KNOWN_TAGS = new Set(ALL_SYMPTOM_TAGS);

const SCORE_ROUNDING_FACTOR = 10 ** SCORE_DECIMALS;
const roundScore = (value) => Math.round(value * SCORE_ROUNDING_FACTOR) / SCORE_ROUNDING_FACTOR;

const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);

/**
 * Code-point ordering, not locale ordering: disease codes are ASCII registry
 * identifiers, and `localeCompare` would make the tie-break depend on the
 * server's ICU data — the one thing a determinism tie-break must not do.
 */
function compareCodes(a, b) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * Trace ordering for scored entries: by disease code, unusable entries last,
 * registry order only as the final tie-break (duplicate codes are a KB fault,
 * not something to reorder silently).
 */
function byTraceOrder(a, b) {
  const left = a.entry.diseaseCode;
  const right = b.entry.diseaseCode;
  if (left === null || right === null) {
    if (left === right) return a.index - b.index;
    return left === null ? 1 : -1;
  }
  return compareCodes(left, right) || a.index - b.index;
}

// ── Input coercion ──────────────────────────────────────────────────────────

/**
 * Reads one enum answer. Whitespace and case are forgiven (a client may send
 * `leaf`); anything outside the closed vocabulary is rejected rather than
 * guessed at, and the rejection is reported in the trace so a client bug is
 * visible instead of silently scoring as "unanswered".
 *
 * @param {unknown} value
 * @param {readonly string[]} allowed
 * @returns {string|null}
 */
function readEnum(value, allowed) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  return allowed.includes(normalized) ? normalized : null;
}

/** Only for the trace: was a value supplied at all, however unusable? */
const wasSupplied = (value) => value !== undefined && value !== null && value !== '';

/** ISO stamp for the trace; an absent/unreadable `asOf` stays null — the trace never lies. */
function toIso(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  return null;
}

// ── Weather context → weather:* tags ────────────────────────────────────────

/**
 * The derivation rules, evaluated in vocabulary order so the derived tag list
 * is deterministic. Each returns `null` when the snapshot does not carry the
 * readings the rule needs — "unknown" is never treated as "false and therefore
 * some other tag": a missing humidity reading cannot make a hot day dry.
 *
 * More than one may fire (rain and high humidity routinely co-occur; a cool
 * humid day is both COOL_MOIST and HIGH_HUMIDITY). Each is an independently
 * true statement about the day, and a disease matches the weather axis if it
 * declares any of them.
 */
const WEATHER_RULES = Object.freeze([
  {
    value: 'HIGH_HUMIDITY',
    evaluate: ({ humidityPct }) =>
      isNumber(humidityPct)
        ? {
            fired: humidityPct >= WEATHER_THRESHOLDS.HIGH_HUMIDITY_PCT,
            inputs: { humidityPct },
            thresholds: { humidityPctMin: WEATHER_THRESHOLDS.HIGH_HUMIDITY_PCT },
          }
        : null,
  },
  {
    value: 'RAIN',
    evaluate: ({ rainMm }) =>
      isNumber(rainMm)
        ? {
            fired: rainMm >= WEATHER_THRESHOLDS.RAIN_MM,
            inputs: { rainMm },
            thresholds: { rainMmMin: WEATHER_THRESHOLDS.RAIN_MM },
          }
        : null,
  },
  {
    value: 'HOT_DRY',
    // Needs both readings: "hot" alone is not "hot and dry", and inferring
    // dryness from a missing humidity value would invent the fungal prior's
    // opposite out of nothing.
    evaluate: ({ tMaxC, humidityPct }) =>
      isNumber(tMaxC) && isNumber(humidityPct)
        ? {
            fired:
              tMaxC >= WEATHER_THRESHOLDS.HOT_TMAX_C &&
              humidityPct < WEATHER_THRESHOLDS.DRY_HUMIDITY_PCT,
            inputs: { tMaxC, humidityPct },
            thresholds: {
              tMaxCMin: WEATHER_THRESHOLDS.HOT_TMAX_C,
              humidityPctMax: WEATHER_THRESHOLDS.DRY_HUMIDITY_PCT,
            },
          }
        : null,
  },
  {
    value: 'COOL_MOIST',
    // Moisture may come from either reading — a cool day that rained is moist
    // whether or not a humidity figure was recorded.
    evaluate: ({ tMaxC, humidityPct, rainMm }) => {
      if (!isNumber(tMaxC)) return null;
      const humid = isNumber(humidityPct) && humidityPct >= WEATHER_THRESHOLDS.MOIST_HUMIDITY_PCT;
      const wet = isNumber(rainMm) && rainMm >= WEATHER_THRESHOLDS.RAIN_MM;
      if (!isNumber(humidityPct) && !isNumber(rainMm)) return null;
      return {
        fired: tMaxC <= WEATHER_THRESHOLDS.COOL_TMAX_C && (humid || wet),
        inputs: {
          tMaxC,
          humidityPct: isNumber(humidityPct) ? humidityPct : null,
          rainMm: isNumber(rainMm) ? rainMm : null,
        },
        thresholds: {
          tMaxCMax: WEATHER_THRESHOLDS.COOL_TMAX_C,
          humidityPctMin: WEATHER_THRESHOLDS.MOIST_HUMIDITY_PCT,
          rainMmMin: WEATHER_THRESHOLDS.RAIN_MM,
        },
      };
    },
  },
]);

/**
 * Turns a weather snapshot into `weather:*` tags plus the audit of how.
 *
 * @param {{humidityPct?: number, rainMm?: number, tMaxC?: number}|null|undefined} weatherContext
 * @returns {{tags: string[], evaluations: object[], available: boolean}}
 */
function deriveWeatherTags(weatherContext) {
  const context =
    weatherContext && typeof weatherContext === 'object' && !Array.isArray(weatherContext)
      ? weatherContext
      : null;

  if (context === null) return { tags: [], evaluations: [], available: false };

  const tags = [];
  const evaluations = [];

  for (const rule of WEATHER_RULES) {
    const outcome = rule.evaluate(context);
    const tag = tagFor(SYMPTOM_AXIS.WEATHER, rule.value);
    if (outcome === null) {
      evaluations.push({ tag, fired: false, cause: 'READINGS_UNAVAILABLE' });
      continue;
    }
    evaluations.push({ tag, ...outcome });
    if (outcome.fired) tags.push(tag);
  }

  // "Available" means a tag was derived, not that an object was supplied. A
  // snapshot of 60% humidity on a 28°C day fires nothing, and an axis with no
  // tag is an axis with no evidence — it must not enter any denominator.
  return { tags, evaluations, available: tags.length > 0 };
}

// ── Scoring ─────────────────────────────────────────────────────────────────

/**
 * Reads a registry disease entry's tags, keeping only the closed vocabulary.
 *
 * An unrecognised tag is a KB authoring typo. It is dropped and reported rather
 * than counted: counting it would make the axis "declared" and therefore push
 * the entry's denominator up for a tag that can never be matched, i.e. a silent
 * scoring penalty for a spelling mistake.
 *
 * @param {unknown} symptomTags
 * @returns {{declared: Set<string>, declaredAxes: Set<string>, unknownTags: string[]}}
 */
function readTags(symptomTags) {
  const declared = new Set();
  const declaredAxes = new Set();
  const unknownTags = [];

  if (Array.isArray(symptomTags)) {
    for (const raw of symptomTags) {
      if (typeof raw !== 'string') continue;
      const tag = raw.trim();
      if (tag === '') continue;
      if (!KNOWN_TAGS.has(tag)) {
        unknownTags.push(tag);
        continue;
      }
      declared.add(tag);
      declaredAxes.add(axisOf(tag));
    }
  }

  return { declared, declaredAxes, unknownTags };
}

/**
 * Scores one disease entry against the answered axes.
 *
 * @param {object} disease            One `registryCrop.diseases[]` entry.
 * @param {Map<string, string[]>} axisTargets  answered axis → the tag(s) it derived.
 * @returns {object} A SCORING trace step; `included` marks the ones that become candidates.
 */
function scoreDisease(disease, axisTargets) {
  const code = typeof disease?.code === 'string' ? disease.code.trim().toUpperCase() : '';
  if (code === '') {
    return {
      step: SYMPTOM_TRACE_STEPS.SCORING,
      diseaseCode: null,
      included: false,
      scorable: false,
      cause: SKIP_CAUSES.INVALID_DISEASE_ENTRY,
    };
  }

  const { declared, declaredAxes, unknownTags } = readTags(disease.symptomTags);

  let awarded = 0;
  let answerable = 0;
  const matchedTags = [];
  const axes = [];

  // SYMPTOM_AXES order, not registry order — so matchedTags and the breakdown
  // read the same way for every disease and every call.
  for (const axis of SYMPTOM_AXES) {
    const targets = axisTargets.get(axis);
    if (targets === undefined) continue; // Unanswered/unavailable: not evidence.

    const weight = SYMPTOM_WEIGHTS[axis];
    if (!declaredAxes.has(axis)) {
      // The entry is silent on this axis. Neither numerator nor denominator —
      // see the normalisation decision in the module docblock.
      axes.push({ axis, weight, declared: false, matched: [], awarded: 0, counted: false });
      continue;
    }

    answerable += weight;
    // Weather can derive several tags; matching any one earns the axis's weight
    // exactly once, and all matches are recorded for provenance.
    const matched = targets.filter((tag) => declared.has(tag));
    if (matched.length > 0) {
      awarded += weight;
      matchedTags.push(...matched);
    }
    axes.push({
      axis,
      weight,
      declared: true,
      matched,
      awarded: matched.length > 0 ? weight : 0,
      counted: true,
    });
  }

  const base = {
    step: SYMPTOM_TRACE_STEPS.SCORING,
    diseaseCode: code,
    awarded,
    answerable,
    axes,
    matchedTags,
    unknownTags,
  };

  if (answerable === 0) {
    return {
      ...base,
      matchScore: null,
      included: false,
      scorable: false,
      cause: SKIP_CAUSES.NO_TAGS_ON_ANSWERED_AXES,
    };
  }

  const matchScore = roundScore(awarded / answerable);
  if (awarded === 0) {
    return { ...base, matchScore, included: false, scorable: true, cause: SKIP_CAUSES.ZERO_MATCH };
  }

  return { ...base, matchScore, included: true, scorable: true };
}

/** i18n KEY arrays copied out of the registry document — never prose (rule 8). */
function readKeys(value) {
  return Array.isArray(value) ? value.filter((key) => typeof key === 'string' && key !== '') : [];
}

/**
 * A disease's own referral floor, or the documented default. Out-of-range or
 * non-numeric values fall back rather than producing a threshold that can never
 * (or always) be met.
 */
function readExpertThreshold(value) {
  return isNumber(value) && value >= 0 && value <= 1 ? value : DEFAULT_EXPERT_THRESHOLD;
}

/** Builds the farmer-facing candidate from the KB entry + its score. */
function toCandidate(disease, scored) {
  return {
    diseaseCode: scored.diseaseCode,
    matchScore: scored.matchScore,
    // "Possible/Likely — never 'Diagnosed'". There is no third band and there
    // must never be one; this engine has not diagnosed anything.
    band: scored.matchScore >= MATCH_BAND_LIKELY_MIN ? MATCH_BANDS.LIKELY : MATCH_BANDS.POSSIBLE,
    matchedTags: [...scored.matchedTags],
    // Straight from the registry document so the API can render KB text and
    // cite it; shallow copies so a caller cannot mutate the registry doc.
    symptomKeys: readKeys(disease.symptoms),
    inspectKeys: readKeys(disease.inspect),
    nextStepKeys: readKeys(disease.nextSteps),
    preventionKeys: readKeys(disease.prevention),
    sourceRefs: Array.isArray(disease.sourceRefs) ? [...disease.sourceRefs] : [],
    expertThreshold: readExpertThreshold(disease.expertThreshold),
  };
}

// ── Result shaping ──────────────────────────────────────────────────────────

/**
 * The shape every path returns.
 *
 * @typedef {object} SymptomCandidate
 * @property {string} diseaseCode        Registry disease code — never display text.
 * @property {number} matchScore         0–1, rounded to SCORE_DECIMALS.
 * @property {string} band               A MATCH_BANDS member: LIKELY or POSSIBLE only.
 * @property {string[]} matchedTags      Closed-vocabulary tags that matched, in axis order.
 * @property {string[]} symptomKeys      i18n keys from the KB entry.
 * @property {string[]} inspectKeys      "inspection guidance" keys (§3).
 * @property {string[]} nextStepKeys     "next steps" keys (§3).
 * @property {string[]} preventionKeys   "prevention" keys (§3).
 * @property {object[]} sourceRefs       Citations, carried through verbatim.
 * @property {number} expertThreshold    This entry's referral floor.
 *
 * @typedef {object} SymptomResult
 * @property {boolean} hasVerdict        True iff at least one candidate was produced.
 * @property {string} reasonCode         A SYMPTOM_REASONS value; never display text.
 * @property {SymptomCandidate[]} candidates  Best first, capped at MAX_SYMPTOM_CANDIDATES.
 * @property {number|null} topScore      candidates[0].matchScore, or null.
 * @property {boolean} expertReferral    §3's "contact KVK/Kisan Call Centre" gate.
 * @property {string[]} expertReferralReasons  EXPERT_REFERRAL_REASONS members.
 * @property {string[]} answeredAxes     Axes that actually carried evidence.
 * @property {string[]} weatherTags      Derived weather:* tags ([] when unavailable).
 * @property {string|null} spread        Normalised spread answer, or null.
 * @property {string} source             HEALTH_SOURCES.RULES — "stored with source:'rules'".
 * @property {boolean} aiAssisted        Always false: "Guided assessment (no AI)".
 * @property {boolean} excludedFromCommunityAggregation  Always true (§4, noise control).
 * @property {string|null} asOf          Caller-supplied stamp; not used in scoring.
 * @property {object[]} trace            Structured derivation steps.
 */

/** Base result — every field explicit, so a consumer never reads `undefined`. */
const emptyResult = () => ({
  hasVerdict: false,
  candidates: [],
  topScore: null,
  expertReferral: true,
  expertReferralReasons: [EXPERT_REFERRAL_REASONS.NO_VERDICT],
  answeredAxes: [],
  weatherTags: [],
  spread: null,
  source: HEALTH_SOURCES.RULES,
  aiAssisted: false,
  excludedFromCommunityAggregation: true,
  asOf: null,
});

/**
 * Terminates without candidates. Every no-verdict state refers to a human:
 * the engine concluded nothing, and "we could not tell you" plus a KVK number
 * is the honest output (§3).
 */
function noVerdict(reasonCode, trace, known = {}) {
  return {
    ...emptyResult(),
    ...known,
    hasVerdict: false,
    reasonCode,
    trace: [...trace, { step: SYMPTOM_TRACE_STEPS.NO_VERDICT, reasonCode }],
  };
}

// ── Entry point ─────────────────────────────────────────────────────────────

/**
 * Runs the guided differential.
 *
 * Deterministic: for a given (registryCrop, answers, weatherContext, asOf) the
 * output is byte-identical, including candidate order — ties break on
 * `diseaseCode` ascending, so the registry document's array order can never
 * change what a farmer sees.
 *
 * @param {object} input
 * @param {object} input.registryCrop          A cropRegistry document (supportLevel, diseases[]).
 * @param {object} [input.answers]             {part?, pattern?, color?, distribution?, spread?} — all optional.
 * @param {object} [input.weatherContext]      {humidityPct?, rainMm?, tMaxC?} or null.
 * @param {Date|string|number} [input.asOf]    Stamp only; the engine has no clock.
 * @returns {SymptomResult}
 */
export function matchSymptoms({ registryCrop, answers, weatherContext, asOf } = {}) {
  const answerInput = answers && typeof answers === 'object' ? answers : {};

  // (0) Read the answers before anything else, so even a no-verdict trace shows
  //     what the farmer said and what was rejected.
  const readAnswers = {};
  const rejectedAnswers = [];
  for (const axis of ANSWER_AXES) {
    const value = readEnum(answerInput[axis], SYMPTOM_VALUES[axis]);
    readAnswers[axis] = value;
    if (value === null && wasSupplied(answerInput[axis])) rejectedAnswers.push(axis);
  }
  const spread = readEnum(answerInput.spread, SPREAD_VALUES);
  if (spread === null && wasSupplied(answerInput.spread)) rejectedAnswers.push('spread');

  const weather = deriveWeatherTags(weatherContext);
  const stampedAsOf = toIso(asOf);

  const diseases = Array.isArray(registryCrop?.diseases) ? registryCrop.diseases : [];
  const supportLevel =
    typeof registryCrop?.supportLevel === 'string' ? registryCrop.supportLevel : null;

  const trace = [
    {
      step: SYMPTOM_TRACE_STEPS.INPUT,
      answers: { ...readAnswers, spread },
      rejectedAnswers,
      weatherTags: [...weather.tags],
      supportLevel,
      diseaseCount: diseases.length,
      asOf: stampedAsOf,
    },
    {
      step: SYMPTOM_TRACE_STEPS.WEATHER_CONTEXT,
      available: weather.available,
      derived: [...weather.tags],
      evaluations: weather.evaluations,
    },
  ];

  // Carried into every no-verdict state so the caller still sees what was read.
  const context = {
    weatherTags: [...weather.tags],
    spread,
    asOf: stampedAsOf,
  };

  // (1)–(3) Crop-level states: true regardless of what the farmer answered.
  if (!registryCrop || typeof registryCrop !== 'object') {
    return noVerdict(SYMPTOM_REASONS.REGISTRY_CROP_UNAVAILABLE, trace, context);
  }
  if (supportLevel === UNSUPPORTED_LEVEL) {
    return noVerdict(SYMPTOM_REASONS.CROP_UNSUPPORTED, trace, context);
  }
  if (diseases.length === 0) {
    return noVerdict(SYMPTOM_REASONS.DISEASE_KB_UNAVAILABLE, trace, context);
  }

  // (4) Nothing to differentiate on. Weather alone is not a symptom: a farmer
  //     who answered nothing gets the questions back, not a list of diseases
  //     ranked by today's humidity.
  const axisTargets = new Map();
  for (const axis of ANSWER_AXES) {
    if (readAnswers[axis] !== null) axisTargets.set(axis, [tagFor(axis, readAnswers[axis])]);
  }
  if (axisTargets.size === 0) {
    return noVerdict(SYMPTOM_REASONS.NO_SYMPTOMS_ANSWERED, trace, context);
  }
  if (weather.available) axisTargets.set(SYMPTOM_AXIS.WEATHER, weather.tags);

  const answeredAxes = SYMPTOM_AXES.filter((axis) => axisTargets.has(axis));

  // (5)/(6) Score every entry — including the ones that will not make the cut,
  //     so the trace accounts for the whole KB, not just the winners.
  const scored = diseases.map((disease, index) => ({
    index,
    disease,
    entry: scoreDisease(disease, axisTargets),
  }));

  // The trace is emitted in diseaseCode order rather than registry order, for
  // the same reason the candidates are: the order Mongo stores an embedded
  // array in must not be observable in the output. With this, the entire result
  // — candidates and audit alike — is byte-identical for a shuffled KB.
  trace.push(...[...scored].sort(byTraceOrder).map(({ entry }) => entry));

  const withContext = { ...context, answeredAxes };

  if (scored.every(({ entry }) => !entry.scorable)) {
    return noVerdict(SYMPTOM_REASONS.KB_TAGS_UNAVAILABLE, trace, withContext);
  }

  const included = scored.filter(({ entry }) => entry.included);

  if (included.length === 0) {
    return noVerdict(SYMPTOM_REASONS.NO_CANDIDATE_MATCH, trace, withContext);
  }

  // Deterministic stable ordering. The `diseaseCode` tie-break exists so that
  // identical inputs produce identical output regardless of the order the
  // registry document happens to store its diseases in — Array.prototype.sort
  // is stable, but "stable" only preserves *input* order, and input order here
  // is a Mongo document detail no farmer should be able to feel.
  included.sort(
    (a, b) =>
      b.entry.matchScore - a.entry.matchScore ||
      compareCodes(a.entry.diseaseCode, b.entry.diseaseCode),
  );

  const candidates = included
    .slice(0, MAX_SYMPTOM_CANDIDATES)
    .map(({ disease, entry }) => toCandidate(disease, entry));

  const top = candidates[0];
  const topScore = top.matchScore;

  // §3: "score <0.4 or user-reported rapid spread". The threshold applied is
  // the top candidate's own — it is the entry whose confidence is being
  // claimed, and the schema lets a disease that is dangerous to miss set a
  // higher bar for itself.
  const expertReferralReasons = [];
  if (topScore < top.expertThreshold) {
    expertReferralReasons.push(EXPERT_REFERRAL_REASONS.SCORE_BELOW_THRESHOLD);
  }
  if (spread === SPREAD_RAPID) {
    expertReferralReasons.push(EXPERT_REFERRAL_REASONS.RAPID_SPREAD_REPORTED);
  }

  trace.push({
    step: SYMPTOM_TRACE_STEPS.VERDICT,
    scoredCount: scored.length,
    candidateCount: candidates.length,
    cappedAt: MAX_SYMPTOM_CANDIDATES,
    topDiseaseCode: top.diseaseCode,
    topScore,
    band: top.band,
    expertThreshold: top.expertThreshold,
    likelyBandMin: MATCH_BAND_LIKELY_MIN,
    expertReferral: expertReferralReasons.length > 0,
    expertReferralReasons,
  });

  return {
    ...emptyResult(),
    ...withContext,
    hasVerdict: true,
    reasonCode: SYMPTOM_REASONS.CANDIDATES_MATCHED,
    candidates,
    topScore,
    expertReferral: expertReferralReasons.length > 0,
    expertReferralReasons,
    trace,
  };
}

export default matchSymptoms;
