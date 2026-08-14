/**
 * The yield evidence ladder — PURE (CLAUDE.md rule 5).
 *
 * `docs/yield/yield-estimation.md`, verbatim:
 *   "Y_hist = median of last 5 available years, district×season×crop yield
 *    (t/ha) — fallback tiers: district all-season → state×season → state
 *    (confidence label downgrades)"
 *
 * Walks that ladder against the committed lookup and stops at the first tier
 * with evidence:
 *
 *   district × season → district annual → state × season → state
 *                                                        → INSUFFICIENT_EVIDENCE
 *
 * ── What this engine will not do ─────────────────────────────────────────────
 *
 * It never invents a district value. Every rung is a lookup of a key that
 * either exists or does not, and when the last one misses the answer is
 * `INSUFFICIENT_EVIDENCE` with the reason named — not a national average, not
 * a neighbouring district, not a default.
 *
 * Place names are matched **exactly** after normalization (`geoKey`). A farmer
 * who typed "Anantapur" where the government writes "Ananthapuramu" misses the
 * district rungs and lands on the state tier, and the response says which rung
 * answered. That is deliberate: a fuzzy match would quietly hand them a
 * different district's harvest history, and the farmer would have no way to
 * know. Recorded as known limitation D10 in the quality report.
 *
 * Every attempt is recorded — hit, miss or skipped, with the reason — so the
 * "why this estimate?" trace can show the whole walk rather than only its
 * destination (rule R12).
 */
import { TIERS, TIER_ORDER, TIER_REQUIRES, geoKey, tierKey } from './lookupSchema.js';

export const RESOLUTION = Object.freeze({
  RESOLVED: 'RESOLVED',
  INSUFFICIENT_EVIDENCE: 'INSUFFICIENT_EVIDENCE',
});

/** Why the ladder produced nothing. Each maps to its own farmer-facing message. */
export const EVIDENCE_REASONS = Object.freeze({
  /** The crop has no lookup at all — cotton and tomato, by decision. */
  CROP_NOT_SUPPORTED: 'CROP_NOT_SUPPORTED',
  /** The farm's state did not resolve, so even the widest tier has no key. */
  STATE_UNRESOLVED: 'STATE_UNRESOLVED',
  /** The state resolved but no tier held enough observations. */
  NO_EVIDENCE: 'NO_EVIDENCE',
  /** The lookup itself is absent or unreadable — an operational fault. */
  LOOKUP_UNAVAILABLE: 'LOOKUP_UNAVAILABLE',
});

/** Per-attempt outcomes, so a skipped rung is distinguishable from a missed one. */
export const ATTEMPT = Object.freeze({
  HIT: 'HIT',
  MISS: 'MISS',
  SKIPPED: 'SKIPPED',
});

export const YIELD_TRACE_STEPS = Object.freeze({
  INPUT: 'INPUT',
  GEO_MATCH: 'GEO_MATCH',
  LADDER: 'LADDER',
  EVIDENCE: 'EVIDENCE',
  NO_EVIDENCE: 'NO_EVIDENCE',
});

/** i18n keys, one per outcome. The API never returns display prose. */
const REASON_KEYS = Object.freeze({
  [EVIDENCE_REASONS.CROP_NOT_SUPPORTED]: 'yield.evidenceCropNotSupported',
  [EVIDENCE_REASONS.STATE_UNRESOLVED]: 'yield.evidenceStateUnresolved',
  [EVIDENCE_REASONS.NO_EVIDENCE]: 'yield.evidenceNone',
  [EVIDENCE_REASONS.LOOKUP_UNAVAILABLE]: 'yield.evidenceLookupUnavailable',
});

/** Tier → the key describing what that tier's number actually represents. */
export const TIER_BASIS_KEYS = Object.freeze({
  [TIERS.DISTRICT_SEASON]: 'yield.basisDistrictSeason',
  [TIERS.DISTRICT_ANNUAL]: 'yield.basisDistrictAnnual',
  [TIERS.STATE_SEASON]: 'yield.basisStateSeason',
  [TIERS.STATE]: 'yield.basisState',
});

/**
 * How specific the answering tier is. Surfaced so the UI can visibly degrade
 * from an exact district match to a state average.
 *
 * This is a **specificity label, not a confidence score.** It says how closely
 * the evidence matches the farmer's field, and nothing about how likely the
 * estimate is to be right — fabricating the latter is exactly what rule 9
 * forbids.
 */
export const TIER_SPECIFICITY = Object.freeze({
  [TIERS.DISTRICT_SEASON]: 'EXACT',
  [TIERS.DISTRICT_ANNUAL]: 'DISTRICT',
  [TIERS.STATE_SEASON]: 'STATE',
  [TIERS.STATE]: 'BROAD',
});

const insufficient = (reason, extra = {}) => ({
  resolution: RESOLUTION.INSUFFICIENT_EVIDENCE,
  reason,
  reasonKey: REASON_KEYS[reason],
  tier: null,
  entry: null,
  specificity: null,
  basisKey: null,
  attempts: [],
  matched: { state: null, district: null, stateCode: null, districtCode: null },
  ...extra,
});

/**
 * Resolves the farm's place against the lookup's own gazetteer.
 *
 * Returns codes where they matched and nulls where they did not. A district
 * that does not resolve is not an error — it is simply a rung that cannot be
 * attempted, and the ladder continues to the state tiers.
 */
export function matchGeography(lookup, { state, district }) {
  const stateCode = lookup?.geo?.states?.[geoKey(state)] ?? null;
  const districtCode =
    stateCode === null
      ? null
      : (lookup?.geo?.districts?.[`${stateCode}|${geoKey(district)}`] ?? null);

  const names =
    districtCode === null ? null : (lookup?.geo?.names?.[`${stateCode}|${districtCode}`] ?? null);

  return {
    stateCode,
    districtCode,
    /** The government's own spelling, so the UI can show what was matched. */
    state: names?.state ?? null,
    district: names?.district ?? null,
    stateMatched: stateCode !== null,
    districtMatched: districtCode !== null,
  };
}

/**
 * @param {object} params
 * @param {object} params.lookup       the parsed yield lookup
 * @param {string} params.cropCode
 * @param {string} params.state        as the farmer recorded it
 * @param {string} params.district     as the farmer recorded it
 * @param {'KHARIF'|'RABI'|'ZAID'|null} params.season
 */
export function resolveEvidence({ lookup, cropCode, state, district, season = null }) {
  if (!lookup?.tiers || !lookup?.geo) {
    return insufficient(EVIDENCE_REASONS.LOOKUP_UNAVAILABLE, {
      trace: [{ step: YIELD_TRACE_STEPS.NO_EVIDENCE, reason: EVIDENCE_REASONS.LOOKUP_UNAVAILABLE }],
    });
  }

  const trace = [
    {
      step: YIELD_TRACE_STEPS.INPUT,
      cropCode,
      state: state ?? null,
      district: district ?? null,
      season,
    },
  ];

  // Cotton and tomato land here. The lookup's crop list is the authority —
  // this engine names no crop (CLAUDE.md rule 4).
  if (!cropCode || !lookup.crops?.includes(cropCode)) {
    return insufficient(EVIDENCE_REASONS.CROP_NOT_SUPPORTED, {
      trace: [
        ...trace,
        {
          step: YIELD_TRACE_STEPS.NO_EVIDENCE,
          reason: EVIDENCE_REASONS.CROP_NOT_SUPPORTED,
          supportedCrops: lookup.crops ?? [],
        },
      ],
    });
  }

  const matched = matchGeography(lookup, { state, district });
  trace.push({
    step: YIELD_TRACE_STEPS.GEO_MATCH,
    stateMatched: matched.stateMatched,
    districtMatched: matched.districtMatched,
    matchedState: matched.state,
    matchedDistrict: matched.district,
    /** Named so the UI can explain a state-tier answer to a farmer who did
     *  give a district. */
    districtUnmatchedInput: matched.districtMatched ? null : (district ?? null),
  });

  if (!matched.stateMatched) {
    return insufficient(EVIDENCE_REASONS.STATE_UNRESOLVED, {
      matched,
      trace: [
        ...trace,
        { step: YIELD_TRACE_STEPS.NO_EVIDENCE, reason: EVIDENCE_REASONS.STATE_UNRESOLVED },
      ],
    });
  }

  const available = {
    stateCode: matched.stateCode,
    districtCode: matched.districtCode,
    cropCode,
    season,
  };

  const attempts = [];
  for (const tier of TIER_ORDER) {
    const missing = TIER_REQUIRES[tier].filter((field) => !available[field]);
    if (missing.length) {
      attempts.push({ tier, outcome: ATTEMPT.SKIPPED, missing, key: null });
      continue;
    }

    const key = tierKey[tier](available);
    const entry = lookup.tiers[tier]?.[key];

    if (!entry) {
      attempts.push({ tier, outcome: ATTEMPT.MISS, key });
      continue;
    }

    attempts.push({ tier, outcome: ATTEMPT.HIT, key });
    trace.push({ step: YIELD_TRACE_STEPS.LADDER, attempts });
    trace.push({
      step: YIELD_TRACE_STEPS.EVIDENCE,
      tier,
      medianYieldTHa: entry.medianYieldTHa,
      sdYieldTHa: entry.sdYieldTHa,
      observations: entry.n,
      years: entry.years,
      latestYear: entry.latestYear,
    });

    return {
      resolution: RESOLUTION.RESOLVED,
      reason: null,
      reasonKey: null,
      tier,
      entry,
      specificity: TIER_SPECIFICITY[tier],
      basisKey: TIER_BASIS_KEYS[tier],
      matched,
      attempts,
      trace,
    };
  }

  trace.push({ step: YIELD_TRACE_STEPS.LADDER, attempts });
  return insufficient(EVIDENCE_REASONS.NO_EVIDENCE, {
    matched,
    attempts,
    trace: [
      ...trace,
      { step: YIELD_TRACE_STEPS.NO_EVIDENCE, reason: EVIDENCE_REASONS.NO_EVIDENCE },
    ],
  });
}
