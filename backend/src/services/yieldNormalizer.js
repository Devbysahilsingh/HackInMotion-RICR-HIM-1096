/**
 * APY (Area · Production · Yield) → yield lookup normalization.
 *
 * Pure: no I/O, no clock, no database. The crop index is passed in rather than
 * queried here, so the whole normalizer is fixture-testable against recorded
 * rows — the same contract `marketNormalizer.js` works to, and for the same
 * reason.
 *
 * Source: Government of India district returns (DES / Ministry of Agriculture
 * & Farmers Welfare) via the India Data Portal export recorded in
 * `datasets/yield/metadata/source-manifest.json`. Provenance:
 * `docs/yield/dataset-research.md`. Measured defects: `docs/yield/dataset-audit.md`.
 *
 * ── Rejection philosophy ─────────────────────────────────────────────────────
 * Identical to the market pipeline: a bad row never enters the lookup, and its
 * only trace is a counter — plus, here, a sample of the actual rejected rows,
 * because "118 outliers" is an assertion and "here are the twenty worst, with
 * their districts and years" is evidence a reviewer can check.
 *
 * Nothing is repaired. The audit established that Maharashtra's 1997-98 rows
 * record area at the wrong magnitude (D5), and rescaling them would mean
 * asserting a correction to a government return on the strength of a pattern.
 * They are dropped, counted and listed instead.
 */

/**
 * The source's season labels, mapped exactly. No fuzzy matching: every label in
 * the file is enumerated here, and an unrecognised one is a drop, not a guess.
 *
 * `Autumn` and `Winter` are the eastern rice seasons (aus / boro in West
 * Bengal, Assam and Odisha). They have no member in the `KHARIF|RABI|ZAID`
 * enum and are **deliberately left unresolved** — mapping them by resemblance
 * would misassign the rice of the states that grow the most of it.
 */
export const SEASON_MAP = Object.freeze({
  Kharif: 'KHARIF',
  Rabi: 'RABI',
  Summer: 'ZAID',
});

/**
 * Two source labels that are not seasons at all.
 *
 * `Total` is an aggregate: the audit verified it equals the exact sum of that
 * district-crop-year's season rows in 15,493 cases with zero disagreements, so
 * treating it as a season would double-count. `Whole Year` is the annual
 * reporting form, and for horticulture it carries *more* districts than the
 * seasonal rows do (potato 537 vs 369, onion 504 vs 393, chilli 527 vs 321).
 *
 * Both become their own lookup tiers rather than being discarded.
 */
export const AGGREGATE_SEASON_MAP = Object.freeze({
  Total: 'ALL_SEASON',
  'Whole Year': 'ANNUAL',
});

/** Season labels present in the source with no representation in our enum. */
export const UNRESOLVED_SEASONS = Object.freeze(['Autumn', 'Winter']);

/**
 * The units the export declares. A row that declares anything else is dropped
 * rather than converted: the audit found the labels are wrong for cotton
 * (170 kg bales printed as "Tonnes", defect D4), so a unit string here is
 * treated as an assertion to be checked, not as an instruction to convert by.
 */
export const EXPECTED_UNITS = Object.freeze({
  area: 'Hectare',
  production: 'Tonnes',
  yield: 'Tonnes/Hectare',
});

/** Every reason a row can be rejected. Mirrors the quality report's buckets. */
export const DROP_REASONS = Object.freeze({
  UNMAPPED_CROP: 'unmappedCrop',
  UNRESOLVED_SEASON: 'unresolvedSeason',
  UNKNOWN_SEASON: 'unknownSeason',
  BAD_UNIT: 'badUnit',
  BAD_YEAR: 'badYear',
  BAD_GEO: 'badGeo',
  BAD_AREA: 'badArea',
  BAD_PRODUCTION: 'badProduction',
  BAD_YIELD: 'badYield',
  INCONSISTENT_YIELD: 'inconsistentYield',
  IMPLAUSIBLE_YIELD: 'implausibleYield',
});

const displayForm = (value) =>
  String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ');

/**
 * Builds the source-crop-name → registry-code index from registry documents.
 *
 * `cropRegistry.yield.apyCropName` is the mapping (CLAUDE.md rule 4: crop
 * knowledge lives in the registry, never in an `if (cropCode === …)`). A crop
 * with no `apyCropName` is simply absent from the index, so **excluding cotton
 * and tomato is a data decision, not a branch in this file** — remove the
 * field and the rows stop mapping; add it and they start.
 *
 * @param {{cropCode: string, yield?: {apyCropName?: string}}[]} registryDocs
 * @returns {Map<string, string>} apyCropName → cropCode
 */
export function buildCropIndex(registryDocs = []) {
  const index = new Map();
  for (const doc of registryDocs) {
    const name = doc?.yield?.apyCropName;
    if (!name || !doc.cropCode) continue;
    index.set(displayForm(name), doc.cropCode);
  }
  return index;
}

/**
 * "1997-1998" → 1997.
 *
 * The source keys on the Indian agricultural year, which straddles two
 * calendar years; the first is the one the Kharif sowing falls in and is what
 * every DES publication means by "the 1997-98 crop year". Parsed explicitly
 * rather than by `parseInt`, so "1997" or "97-98" is a drop rather than a
 * silently wrong year.
 *
 * @returns {{startYear: number, label: string}|null}
 */
export function parseAgYear(value) {
  const text = String(value ?? '').trim();
  const match = /^(\d{4})-(\d{4})$/.exec(text);
  if (!match) return null;

  const start = Number(match[1]);
  const end = Number(match[2]);
  if (end !== start + 1) return null;
  if (start < 1900 || start > 2100) return null;

  return { startYear: start, label: text };
}

const toNumber = (value) => {
  const text = String(value ?? '').trim();
  if (text === '') return null;
  const n = Number(text.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};

/**
 * Normalizes one source row.
 *
 * @param {object} source a parsed CSV row
 * @param {{cropIndex: Map<string,string>}} options
 * @returns {{ok: true, row: object} | {ok: false, reason: string, detail?: string}}
 */
export function normalizeRow(source, { cropIndex }) {
  const cropName = displayForm(source.crop_name);
  const cropCode = cropIndex.get(cropName);
  if (!cropCode) return { ok: false, reason: DROP_REASONS.UNMAPPED_CROP, detail: cropName };

  const rawSeason = displayForm(source.season);
  const season = SEASON_MAP[rawSeason] ?? null;
  const aggregate = AGGREGATE_SEASON_MAP[rawSeason] ?? null;
  if (!season && !aggregate) {
    const reason = UNRESOLVED_SEASONS.includes(rawSeason)
      ? DROP_REASONS.UNRESOLVED_SEASON
      : DROP_REASONS.UNKNOWN_SEASON;
    return { ok: false, reason, detail: rawSeason };
  }

  if (
    displayForm(source.area_unit) !== EXPECTED_UNITS.area ||
    displayForm(source.production_unit) !== EXPECTED_UNITS.production ||
    displayForm(source.yield_unit) !== EXPECTED_UNITS.yield
  ) {
    return {
      ok: false,
      reason: DROP_REASONS.BAD_UNIT,
      detail: `${displayForm(source.area_unit)}|${displayForm(source.production_unit)}|${displayForm(source.yield_unit)}`,
    };
  }

  const year = parseAgYear(source.year);
  if (!year) return { ok: false, reason: DROP_REASONS.BAD_YEAR, detail: String(source.year) };

  const state = displayForm(source.state_name);
  const district = displayForm(source.district_name);
  const stateCode = displayForm(source.state_code);
  const districtCode = displayForm(source.district_code);
  if (!state || !district || !stateCode || !districtCode) {
    return { ok: false, reason: DROP_REASONS.BAD_GEO };
  }

  const area = toNumber(source.area);
  if (area === null || !(area > 0)) return { ok: false, reason: DROP_REASONS.BAD_AREA };

  // A blank or zero production is "reported nil", not a yield of zero (D6).
  // Letting it through would drag a district's median toward zero.
  const production = toNumber(source.production);
  if (production === null || !(production > 0)) {
    return { ok: false, reason: DROP_REASONS.BAD_PRODUCTION };
  }

  const published = toNumber(source.yield);
  if (published === null || !(published > 0)) return { ok: false, reason: DROP_REASONS.BAD_YIELD };

  // The published yield is arithmetic over area and production, so it must
  // reproduce. The audit found this held in 455,359 of 455,359 rows; the check
  // stays because a future refresh is the thing it exists to catch.
  const derived = production / area;
  if (Math.abs(derived - published) > Math.max(0.005, derived * 0.02)) {
    return {
      ok: false,
      reason: DROP_REASONS.INCONSISTENT_YIELD,
      detail: `published=${published} derived=${derived.toFixed(4)}`,
    };
  }

  return {
    ok: true,
    row: {
      cropCode,
      state,
      stateCode,
      district,
      districtCode,
      season,
      aggregate,
      year: year.startYear,
      yearLabel: year.label,
      areaHa: area,
      productionT: production,
      yieldTHa: published,
    },
  };
}

/**
 * Iglewicz–Hoaglin modified z-score.
 *
 * Published convention, not a number chosen here: Iglewicz, B. & Hoaglin, D.
 * (1993), *How to Detect and Handle Outliers*, ASQC Basic References in Quality
 * Control vol. 16, which defines M_i = 0.6745 · (x_i − median) / MAD and
 * recommends |M_i| > 3.5 as the flag. 0.6745 is the constant that makes MAD a
 * consistent estimator of σ for normal data.
 *
 * Applied to **log10(yield)**, because yields are right-skewed and a symmetric
 * rule on raw values would flag high-yielding districts as errors.
 *
 * @param {number[]} values strictly positive
 * @returns {{median: number, mad: number, score: (value: number) => number}|null}
 */
export function modifiedZScore(values) {
  const logs = values.filter((v) => v > 0).map((v) => Math.log10(v));
  if (logs.length < 3) return null;

  const med = (arr) => {
    const s = [...arr].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };

  const median = med(logs);
  const mad = med(logs.map((v) => Math.abs(v - median)));
  if (!(mad > 0)) return null;

  return {
    median,
    mad,
    score: (value) => (value > 0 ? (0.6745 * (Math.log10(value) - median)) / mad : 0),
  };
}

/** The published Iglewicz–Hoaglin flag threshold. */
export const OUTLIER_THRESHOLD = 3.5;

/**
 * Flags implausibly HIGH yields, per crop.
 *
 * **Upper tail only, and that is a safety decision rather than a statistical
 * one.** Low yields are agronomically real — drought, pest collapse, a failed
 * season — and they are exactly the years a farmer needs represented in a
 * median. Trimming them would bias every estimate upward, which is the
 * dangerous direction to be wrong in: a farmer over-committing on the strength
 * of an optimistic number loses money the estimate promised them. High
 * outliers have no such defence; the audit traced all 118 of them to rows whose
 * area is recorded at the wrong magnitude (D5).
 *
 * @param {object[]} rows normalized rows
 * @returns {{kept: object[], flagged: object[]}}
 */
export function flagImplausibleYields(rows) {
  const byCrop = new Map();
  for (const row of rows) {
    if (!byCrop.has(row.cropCode)) byCrop.set(row.cropCode, []);
    byCrop.get(row.cropCode).push(row);
  }

  const kept = [];
  const flagged = [];

  for (const cropRows of byCrop.values()) {
    const gate = modifiedZScore(cropRows.map((r) => r.yieldTHa));
    if (!gate) {
      kept.push(...cropRows);
      continue;
    }
    for (const row of cropRows) {
      const score = gate.score(row.yieldTHa);
      if (score > OUTLIER_THRESHOLD)
        flagged.push({ ...row, outlierScore: Number(score.toFixed(2)) });
      else kept.push(row);
    }
  }

  return { kept, flagged };
}

/**
 * Normalizes a batch and produces the drop report.
 *
 * @param {object[]} sourceRows
 * @param {{cropIndex: Map<string,string>, sampleLimit?: number}} options
 */
export function normalizeBatch(sourceRows, { cropIndex, sampleLimit = 25 }) {
  const accepted = [];
  const dropped = Object.fromEntries(Object.values(DROP_REASONS).map((r) => [r, 0]));
  const samples = {};
  const unmappedCropNames = new Map();

  for (const source of Array.isArray(sourceRows) ? sourceRows : []) {
    const result = normalizeRow(source, { cropIndex });

    if (!result.ok) {
      dropped[result.reason] += 1;
      if (result.reason === DROP_REASONS.UNMAPPED_CROP && result.detail) {
        unmappedCropNames.set(result.detail, (unmappedCropNames.get(result.detail) ?? 0) + 1);
      } else if (result.detail) {
        samples[result.reason] ??= [];
        if (samples[result.reason].length < sampleLimit) {
          if (!samples[result.reason].includes(result.detail)) {
            samples[result.reason].push(result.detail);
          }
        }
      }
      continue;
    }
    accepted.push(result.row);
  }

  const { kept, flagged } = flagImplausibleYields(accepted);
  dropped[DROP_REASONS.IMPLAUSIBLE_YIELD] = flagged.length;

  const fetched = Array.isArray(sourceRows) ? sourceRows.length : 0;
  const droppedTotal = Object.values(dropped).reduce((sum, n) => sum + n, 0);

  return {
    rows: kept,
    flagged,
    report: {
      fetched,
      accepted: kept.length,
      dropped,
      droppedTotal,
      dropRate: fetched === 0 ? 0 : Number((droppedTotal / fetched).toFixed(4)),
      samples,
      /** Every source crop name we do not map, with its row count. Diagnostic,
       *  not an error: 106 of the 115 crops in the file are out of scope. */
      unmappedCropNames: [...unmappedCropNames.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([name, count]) => ({ name, count })),
      /**
       * Where the gate actually cut, per crop. A threshold is only auditable if
       * you can see the lowest yield it rejected next to the highest it kept —
       * that pair is what shows whether it removed data-entry errors or
       * high-performing districts.
       */
      outlierGateByCrop: Object.fromEntries(
        [...new Set(accepted.map((r) => r.cropCode))].sort().map((cropCode) => {
          const rejected = flagged.filter((r) => r.cropCode === cropCode);
          const survived = kept.filter((r) => r.cropCode === cropCode);
          return [
            cropCode,
            {
              rejected: rejected.length,
              kept: survived.length,
              lowestRejectedYieldTHa: rejected.length
                ? Number(Math.min(...rejected.map((r) => r.yieldTHa)).toFixed(3))
                : null,
              highestKeptYieldTHa: survived.length
                ? Number(Math.max(...survived.map((r) => r.yieldTHa)).toFixed(3))
                : null,
            },
          ];
        }),
      ),
      /** The worst offenders, named — evidence rather than a bare count. */
      implausibleSamples: flagged
        .sort((a, b) => b.yieldTHa - a.yieldTHa)
        .slice(0, sampleLimit)
        .map((r) => ({
          cropCode: r.cropCode,
          state: r.state,
          district: r.district,
          season: r.season ?? r.aggregate,
          year: r.yearLabel,
          areaHa: r.areaHa,
          productionT: r.productionT,
          yieldTHa: r.yieldTHa,
          outlierScore: r.outlierScore,
        })),
    },
  };
}
