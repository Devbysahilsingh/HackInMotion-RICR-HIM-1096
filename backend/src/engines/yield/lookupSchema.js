/**
 * The yield lookup's shared vocabulary — tier names, key construction and the
 * aggregation policy the artefact was built under.
 *
 * It lives in the engine layer, not beside the builder in `services/`, because
 * of the dependency direction CLAUDE.md rule 5 fixes: engines import nothing
 * above `utils/` and `constants/`. The resolver is an engine and needs these
 * names; the builder is a service and may import downwards. So this is the
 * bottom of the stack and both sides read it, which is also what stops the two
 * from drifting into disagreeing about what `DISTRICT_ANNUAL` means.
 */

/** The evidence ladder, in the order it is walked. */
export const TIERS = Object.freeze({
  DISTRICT_SEASON: 'DISTRICT_SEASON',
  DISTRICT_ANNUAL: 'DISTRICT_ANNUAL',
  STATE_SEASON: 'STATE_SEASON',
  STATE: 'STATE',
});

/** Walk order. Explicit rather than `Object.values`, because the order is the rule. */
export const TIER_ORDER = Object.freeze([
  TIERS.DISTRICT_SEASON,
  TIERS.DISTRICT_ANNUAL,
  TIERS.STATE_SEASON,
  TIERS.STATE,
]);

/** Which published rows a `DISTRICT_ANNUAL` entry was built from. */
export const ANNUAL_BASIS = Object.freeze({
  WHOLE_YEAR: 'WHOLE_YEAR',
  TOTAL: 'TOTAL',
});

/** How many available years the median spans, and the evidence floor. */
export const LOOKBACK_YEARS = 5;
export const MIN_OBSERVATIONS = 3;

/**
 * Lookup-key normalization for place names.
 *
 * Uppercased, whitespace collapsed, non-alphanumerics stripped — so
 * "Ananthapuramu", "ANANTHAPURAMU" and "Ananthapuramu " are one key.
 *
 * **Exact match only.** No fuzzy matching, no edit distance, no phonetic keys:
 * the source carries post-rename district names (Ananthapuramu, Dharashiv,
 * Ahilyanagar) and a farmer may well have typed the older one. A near-match
 * would silently attribute another district's harvest history to their field,
 * which is worse than falling through to the state tier and saying so.
 */
export const geoKey = (value) =>
  String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '');

/** Key builders — one definition, so the builder and the resolver cannot diverge. */
export const tierKey = Object.freeze({
  [TIERS.DISTRICT_SEASON]: ({ stateCode, districtCode, cropCode, season }) =>
    `${stateCode}|${districtCode}|${cropCode}|${season}`,
  [TIERS.DISTRICT_ANNUAL]: ({ stateCode, districtCode, cropCode }) =>
    `${stateCode}|${districtCode}|${cropCode}`,
  [TIERS.STATE_SEASON]: ({ stateCode, cropCode, season }) => `${stateCode}|${cropCode}|${season}`,
  [TIERS.STATE]: ({ stateCode, cropCode }) => `${stateCode}|${cropCode}`,
});

/** What each tier needs before it can even be attempted. */
export const TIER_REQUIRES = Object.freeze({
  [TIERS.DISTRICT_SEASON]: ['districtCode', 'season'],
  [TIERS.DISTRICT_ANNUAL]: ['districtCode'],
  [TIERS.STATE_SEASON]: ['stateCode', 'season'],
  [TIERS.STATE]: ['stateCode'],
});
