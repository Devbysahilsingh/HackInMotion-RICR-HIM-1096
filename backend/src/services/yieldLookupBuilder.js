/**
 * Normalized APY rows → the tiered yield lookup the estimator reads.
 *
 * Pure: fixture in, object out. The runtime never runs this — the lookup is
 * built once, offline, by `backend/scripts/build-yield-lookup.mjs` and shipped
 * as `datasets/lookup/yield-lookup.json`. Keeping the aggregation here rather
 * than in the script is what lets the backend suite test it.
 *
 * ── Why median, and over what window ─────────────────────────────────────────
 * `docs/yield/yield-estimation.md` specifies "median of last 5 available
 * years", and the audit justifies that choice rather than merely inheriting it:
 *
 *   - **Median, not mean.** Defect D5 put rows into the source whose area is
 *     recorded at the wrong magnitude, producing yields two orders of magnitude
 *     too high. A mean over five years is destroyed by one such row; a median
 *     is not. The same holds for a single catastrophic weather year, which is
 *     real data that should move the estimate a little and not dominate it.
 *   - **Last 5 *available* years, not the last 5 calendar years.** Districts
 *     stop and start reporting. Anchoring to the calendar would silently empty
 *     the window for a district that skipped 2021; anchoring to what exists
 *     keeps the sample and makes the vintage explicit instead — every entry
 *     carries `latestYear`, and staleness is labelled downstream rather than
 *     hidden here.
 *   - **SD over the same window.** The spec allows 5–10 years for the spread.
 *     Using one window for both means the trace shown to a farmer describes a
 *     single set of years — "these five, this middle, this spread" — rather
 *     than a median from one period and a spread from another.
 *
 * `MIN_OBSERVATIONS` is a **product policy, not an agronomic constant**, and is
 * labelled as such wherever it surfaces. Two years is not a distribution; three
 * is the smallest sample for which a median is not simply one of the endpoints.
 */

export const LOOKBACK_YEARS = 5;
export const MIN_OBSERVATIONS = 3;

/** The fallback ladder, in order. Consumed by the engine and the UI alike. */
export const TIERS = Object.freeze({
  DISTRICT_SEASON: 'DISTRICT_SEASON',
  DISTRICT_ANNUAL: 'DISTRICT_ANNUAL',
  STATE_SEASON: 'STATE_SEASON',
  STATE: 'STATE',
});

/** Which published rows a `DISTRICT_ANNUAL` entry was built from. */
export const ANNUAL_BASIS = Object.freeze({
  WHOLE_YEAR: 'WHOLE_YEAR',
  TOTAL: 'TOTAL',
});

/**
 * Lookup-key normalization for place names.
 *
 * Uppercased, whitespace collapsed, non-alphanumerics stripped — so "Ananth­
 * apuramu", "ANANTHAPURAMU" and "Ananthapuramu " are one key. **Exact match
 * only.** No fuzzy matching, no edit distance, no phonetic keys: the source
 * carries post-rename district names (Ananthapuramu, Dharashiv, Ahilyanagar)
 * and a farmer may well have typed the older one. A near-match would silently
 * attribute another district's harvest history to their field, which is worse
 * than falling through to the state tier and saying so.
 */
export const geoKey = (value) =>
  String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '');

const median = (values) => {
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Sample standard deviation. Null below two points — one value has no spread. */
const stdDev = (values) => {
  if (values.length < 2) return null;
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
};

const round = (value, dp = 3) =>
  value === null || value === undefined ? null : Number(value.toFixed(dp));

/**
 * One tier entry from a set of observations.
 *
 * Observations are collapsed to one per year before aggregating: the state
 * tiers pool many districts, and without this a state-year with 30 reporting
 * districts would outweigh a state-year with 3 inside the same median.
 *
 * @param {{year: number, yieldTHa: number, districtCode?: string}[]} observations
 * @returns {object|null} null when the evidence floor is not met
 */
export function buildEntry(observations, { perYear = false } = {}) {
  if (!observations.length) return null;

  let points = observations;
  if (perYear) {
    const byYear = new Map();
    for (const o of observations) {
      if (!byYear.has(o.year)) byYear.set(o.year, []);
      byYear.get(o.year).push(o.yieldTHa);
    }
    points = [...byYear.entries()].map(([year, values]) => ({
      year,
      yieldTHa: median(values),
      districts: values.length,
    }));
  }

  // Last N *available* years, newest first.
  const window = [...points].sort((a, b) => b.year - a.year).slice(0, LOOKBACK_YEARS);
  if (window.length < MIN_OBSERVATIONS) return null;

  const values = window.map((p) => p.yieldTHa);
  const years = window.map((p) => p.year).sort((a, b) => a - b);

  const entry = {
    medianYieldTHa: round(median(values)),
    sdYieldTHa: round(stdDev(values)),
    minYieldTHa: round(Math.min(...values)),
    maxYieldTHa: round(Math.max(...values)),
    n: window.length,
    years,
    latestYear: years[years.length - 1],
  };

  if (perYear) {
    entry.districtsPerYear = window.sort((a, b) => a.year - b.year).map((p) => p.districts ?? 1);
  }

  return entry;
}

/**
 * Builds the complete lookup from normalized rows.
 *
 * @param {object[]} rows output of `normalizeBatch().rows`
 * @param {{source: object, generatedAt: string}} meta
 */
export function buildLookup(rows, { source, generatedAt }) {
  const districtSeason = new Map();
  const wholeYear = new Map();
  const total = new Map();
  const stateSeason = new Map();
  const state = new Map();

  /** stateCode|districtCode → display names, and the name→code indexes. */
  const names = new Map();
  const stateIndex = new Map();
  const districtIndex = new Map();

  const push = (map, key, observation) => {
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(observation);
  };

  for (const row of rows) {
    const geo = `${row.stateCode}|${row.districtCode}`;
    if (!names.has(geo)) names.set(geo, { state: row.state, district: row.district });
    stateIndex.set(geoKey(row.state), row.stateCode);
    districtIndex.set(`${row.stateCode}|${geoKey(row.district)}`, row.districtCode);

    const observation = {
      year: row.year,
      yieldTHa: row.yieldTHa,
      districtCode: row.districtCode,
    };

    if (row.season) {
      push(districtSeason, `${geo}|${row.cropCode}|${row.season}`, observation);
      push(stateSeason, `${row.stateCode}|${row.cropCode}|${row.season}`, observation);
      push(state, `${row.stateCode}|${row.cropCode}`, observation);
    } else if (row.aggregate === 'ANNUAL') {
      push(wholeYear, `${geo}|${row.cropCode}`, observation);
      push(state, `${row.stateCode}|${row.cropCode}`, observation);
    } else if (row.aggregate === 'ALL_SEASON') {
      push(total, `${geo}|${row.cropCode}`, observation);
      // Deliberately NOT pushed to the state tiers: `Total` is the sum of the
      // season rows that are already there (audit D1), so counting it again
      // would weight those districts twice.
    }
  }

  const materialize = (map, options) => {
    const out = {};
    for (const [key, observations] of map) {
      const entry = buildEntry(observations, options);
      if (entry) out[key] = entry;
    }
    return out;
  };

  /**
   * `DISTRICT_ANNUAL` has two possible sources and they are never pooled.
   * `Whole Year` is a district reporting its annual figure directly; `Total`
   * is the sum of its season rows. They describe the same quantity by
   * different routes, and averaging across the two would mix reporting
   * conventions and double-weight any year present in both. Whichever has more
   * observations wins; `Whole Year` breaks the tie, being a direct report
   * rather than a derived sum.
   */
  const annual = {};
  const annualKeys = new Set([...wholeYear.keys(), ...total.keys()]);
  for (const key of annualKeys) {
    const w = buildEntry(wholeYear.get(key) ?? []);
    const t = buildEntry(total.get(key) ?? []);
    if (!w && !t) continue;
    const useWholeYear = w && (!t || w.n >= t.n);
    annual[key] = {
      ...(useWholeYear ? w : t),
      basis: useWholeYear ? ANNUAL_BASIS.WHOLE_YEAR : ANNUAL_BASIS.TOTAL,
    };
  }

  const tiers = {
    [TIERS.DISTRICT_SEASON]: materialize(districtSeason),
    [TIERS.DISTRICT_ANNUAL]: annual,
    [TIERS.STATE_SEASON]: materialize(stateSeason, { perYear: true }),
    [TIERS.STATE]: materialize(state, { perYear: true }),
  };

  const cropCodes = [...new Set(rows.map((r) => r.cropCode))].sort();

  return {
    schemaVersion: 1,
    generatedAt,
    source,
    policy: {
      lookbackYears: LOOKBACK_YEARS,
      minObservations: MIN_OBSERVATIONS,
      aggregation: 'median',
      spread: 'sample standard deviation over the same window',
      stateTierAggregation:
        'district-year yields collapsed to one median per year, then a median over years — this estimates a typical district in the state, which is the quantity a fallback needs, not the state aggregate DES publishes',
      note: 'minObservations is a product policy, not an agronomic constant.',
    },
    crops: cropCodes,
    unit: 'tonnes_per_hectare',
    geo: {
      states: Object.fromEntries(stateIndex),
      districts: Object.fromEntries(districtIndex),
      names: Object.fromEntries(names),
    },
    tiers,
  };
}

/** Per-crop, per-tier counts for the quality report. */
export function summarizeLookup(lookup) {
  const summary = {};
  for (const [tier, entries] of Object.entries(lookup.tiers)) {
    for (const key of Object.keys(entries)) {
      // Crop code is the second-to-last segment for season tiers, last otherwise.
      const parts = key.split('|');
      const cropCode = lookup.crops.includes(parts[parts.length - 1])
        ? parts[parts.length - 1]
        : parts[parts.length - 2];
      summary[cropCode] ??= {};
      summary[cropCode][tier] = (summary[cropCode][tier] ?? 0) + 1;
    }
  }
  return summary;
}
