/**
 * Agronomic constants shared across surfaces (shared/README.md: "constants/ …
 * agronomy (soil AWC tables)"). Backend imports by relative path.
 *
 * Irrigation rule R4: "AWC lookup exactly per irrigation-model.md table
 * (constants in `shared/constants/agronomy` with sourceRefs)."
 *
 * ── PROVENANCE WARNING — read before trusting these numbers ──────────────────
 *
 * Every FAO-56 value in `backend/src/knowledge/crops.agronomy.json` was
 * transcribed cell-by-cell from a fetched primary table and carries a `P`
 * (primary) citation. **These AWC values do not meet that bar.** Their only
 * source is a prose line in `docs/irrigation/irrigation-model.md`:
 *
 *   "AWC table (FAO Ch.: soil water properties; mm/m): sandy 60–100 · loamy
 *    140–180 · clay 170–220 · black(vertisol) ~200 · alluvial ~150 · red ~120 ·
 *    laterite ~100 · unknown → 120 + wider uncertainty note."
 *
 * That citation names no chapter number, no table, and no URL, and the same
 * line's claim that "Sourced refs in registry seed" is false — the seed
 * contains no soil data at all. Four of the eight keys (black, alluvial, red,
 * laterite) are ICAR soil orders, which FAO-56 does not tabulate: FAO-56's
 * Table 19 is organised by USDA *texture* class (sand, loam, clay …), so these
 * four cannot have come from it directly whatever the prose implies.
 *
 * The values are therefore transcribed **exactly as the doc prints them**,
 * marked `confidence: 'S'`, and listed as an open verification task. They are
 * good enough to compute with and labelled so nobody mistakes them for the
 * FAO-sourced tier. Nothing here was invented, averaged from another source, or
 * silently upgraded.
 *
 * Midpoints: three entries publish a range. Taking the midpoint is the
 * documented assumption, not a choice made here — irrigation-model.md's own
 * "Avoiding dangerous false precision" section lists "AWC midpoints" among the
 * assumptions it commits to.
 */

/** The one citation every value below shares. */
export const AWC_SOURCE_REF = Object.freeze({
  org: 'HIM-1096 (project doc)',
  title: 'docs/irrigation/irrigation-model.md §3 "Soil reservoir" — AWC table',
  url: null,
  accessed: '2026-08-13',
  confidence: 'S',
  note:
    'The doc attributes the table to "FAO Ch.: soil water properties" with no chapter, table or URL, ' +
    'and four keys (black, alluvial, red, laterite) are ICAR soil orders that FAO-56 Table 19 does not ' +
    'tabulate. Requires primary verification before demo. Recorded as an open task rather than upgraded.',
});

/**
 * Available water capacity, mm of water per metre of root depth.
 * Keys are exactly `SOIL_TYPES` from backend/src/config/constants.js.
 *
 * `published` reproduces the doc's own text; `value` is what the engine uses.
 */
export const SOIL_AWC_MM_PER_M = Object.freeze({
  sandy: { value: 80, published: '60–100', basis: 'midpoint of published range' },
  loamy: { value: 160, published: '140–180', basis: 'midpoint of published range' },
  clay: { value: 195, published: '170–220', basis: 'midpoint of published range' },
  black: { value: 200, published: '~200', basis: 'published point value' },
  alluvial: { value: 150, published: '~150', basis: 'published point value' },
  red: { value: 120, published: '~120', basis: 'published point value' },
  laterite: { value: 100, published: '~100', basis: 'published point value' },
  /**
   * Not a measurement — a stand-in for "the farmer did not tell us". It carries
   * `wideUncertainty` so the engine can lower its claim strength rather than
   * present a modelled number with the same confidence as a known soil
   * (irrigation-model.md: "ranges when soil=unknown").
   */
  unknown: {
    value: 120,
    published: '120',
    basis: 'documented placeholder for unspecified soil',
    wideUncertainty: true,
  },
});

/**
 * Root-depth fraction by growth stage (irrigation rule R10, verbatim):
 *   "TAW uses stage-adjusted root depth: rootDepthM × stageDepthFactor
 *    {INITIAL:0.4, DEV:0.7, MID:1.0, LATE:1.0}"
 *
 * R10 abbreviates the second stage `DEV`; the canonical spelling everywhere
 * else in this codebase is `DEVELOPMENT` (config/constants.js records the slip).
 * The key here is the canonical one — a literal transcription of R10 would
 * key-miss and silently apply `undefined`.
 */
export const STAGE_ROOT_DEPTH_FACTOR = Object.freeze({
  INITIAL: 0.4,
  DEVELOPMENT: 0.7,
  MID: 1.0,
  LATE: 1.0,
});

/** 1 acre = 4046.86 m²; 1 mm over 1 m² = 1 L (irrigation-model.md §6). */
export const LITERS_PER_ACRE_PER_MM = 4046.86;

/**
 * FAO-56 Table 22 footnote 2, transcribed in crops.agronomy.json
 * (`conventions.depletionFractionEt`): published p values assume ETc ≈ 5 mm/day
 * and are adjusted for other rates by `p = p_table + 0.04 × (5 − ETc)`.
 */
export const P_TABLE_REFERENCE_ETC_MM_DAY = 5;
export const P_ETC_ADJUSTMENT_COEFF = 0.04;

/** Standing-water target for paddy (irrigation-model.md §5: "maintain 2–5cm"). */
export const PADDY_WATER_DEPTH_CM = Object.freeze({ min: 2, max: 5 });
