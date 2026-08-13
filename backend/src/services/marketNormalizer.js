/**
 * data.gov.in → marketPrices normalization (docs/market/data-normalization.md).
 *
 * Pure: no I/O, no clock beyond an injected `asOf`, no database. The alias
 * index is passed in rather than queried here, so the whole normalizer is
 * fixture-testable against recorded rows — which is what the test matrix asks
 * for ("normalizer unit (fixture rows incl. malformed)").
 *
 * "Quarantine" in this project means **reject, count and log** — not a separate
 * collection. docs/market/data-normalization.md: "Quarantine philosophy: bad
 * rows never enter history; drop-rate >30% aborts the batch (schema-drift
 * guard) keeping prior data intact." A bad row therefore never reaches Mongo,
 * and its only trace is a counter in the job report.
 *
 * ── Deviation on geography, recorded deliberately ────────────────────────────
 * The doc specifies `state/district → canonical list (shared/constants/geo;
 * fuzzy match ≥0.9 else drop+count)`. **`shared/constants/geo` does not exist.**
 * P1-5 hit the same absence for farm validation and resolved it the same way:
 * "validation.md specifies a canonical list from `shared/constants/geo`, which
 * is deliberately empty until the TODO that populates it — an invented list
 * would be worse than a late one". Inventing a states-and-districts gazetteer
 * to fuzzy-match against would fabricate reference data (rule 7), and dropping
 * every row for want of it would discard the entire feed. So geography is
 * whitespace-normalized and required to be non-empty, but not gated against a
 * canonical list. `dropped.badGeo` counts only structurally unusable values.
 */
import {
  MARKET_MAX_AGE_DAYS,
  MARKET_PRICE_MAX_EXCLUSIVE,
  MARKET_PRICE_MIN_EXCLUSIVE,
} from '../config/constants.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Source field → canonical field (docs/market/data-source.md "Fields used"). */
export const FIELD_MAP = Object.freeze({
  state: 'state',
  district: 'district',
  market: 'market',
  commodity: 'commodityCode',
  arrival_date: 'date',
  min_price: 'minPrice',
  modal_price: 'modalPrice',
  max_price: 'maxPrice',
});

/**
 * `variety` is listed among the fields the doc fetches but has no storage
 * target — it is absent from the documented schema, from the Mongoose model and
 * from the API series shape. Fetched and discarded, named here so the omission
 * is visible rather than looking like an oversight.
 */
export const DISCARDED_FIELDS = Object.freeze(['variety']);

/** Collapses whitespace and case for alias matching. Never stored. */
const foldKey = (value) =>
  String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();

/** Stored display form: trimmed, internal whitespace collapsed, case preserved. */
const displayForm = (value) =>
  String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ');

/**
 * Builds the commodity alias index from registry documents.
 *
 * The registry is the alias map (docs/market/data-source.md:
 * "`cropRegistry.market.aliases`"), so there is no second copy to drift. Both
 * the crop code and every published alias resolve to the same commodity code.
 *
 * @param {{cropCode: string, market?: {commodityCode?: string, aliases?: string[]}}[]} registryDocs
 */
export function buildAliasIndex(registryDocs = []) {
  const index = new Map();

  for (const doc of registryDocs) {
    const code = doc.market?.commodityCode ?? doc.cropCode;
    if (!code) continue;

    for (const alias of [code, doc.cropCode, ...(doc.market?.aliases ?? [])]) {
      const key = foldKey(alias);
      if (key) index.set(key, code);
    }
  }

  return index;
}

/**
 * data.gov.in publishes `arrival_date` as DD/MM/YYYY.
 * Parsed explicitly rather than by `new Date(string)`, which would read
 * "03/08/2026" as March 8th on a US-locale runtime — a silent five-month error.
 */
export function parseArrivalDate(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

  /**
   * Both branches round-trip the parsed date back to its parts. `Date.UTC`
   * happily rolls an impossible date forward — 31/02 becomes 3 March, month 13
   * becomes next January — so without this check a malformed date is stored on
   * the wrong day instead of being dropped and counted.
   */
  const build = (year, month, day) => {
    const date = new Date(Date.UTC(year, month - 1, day));
    const survived =
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day;
    return survived ? date : null;
  };

  const text = String(value ?? '').trim();

  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (match) return build(Number(match[3]), Number(match[2]), Number(match[1]));

  // ISO is accepted too: the CEDA seed files publish dates that way.
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (iso) return build(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  return null;
}

const toPrice = (value) => {
  const number = Number(
    String(value ?? '')
      .trim()
      .replace(/,/g, ''),
  );
  // Prices are stored as integer rupees per quintal ("prices → int ₹/quintal").
  return Number.isFinite(number) ? Math.round(number) : null;
};

const inPriceRange = (price) =>
  price !== null && price > MARKET_PRICE_MIN_EXCLUSIVE && price < MARKET_PRICE_MAX_EXCLUSIVE;

/** Every reason a row can be rejected. Mirrors the job report's buckets. */
export const DROP_REASONS = Object.freeze({
  UNMAPPED: 'unmapped',
  BAD_DATE: 'badDate',
  BAD_PRICE: 'badPrice',
  BAD_GEO: 'badGeo',
});

/**
 * Normalizes one source row.
 *
 * @returns {{ok: true, row: object, flagged: boolean} | {ok: false, reason: string, detail?: string}}
 */
export function normalizeRow(source, { aliasIndex, asOf, fetchedAt }) {
  const commodityCode = aliasIndex.get(foldKey(source.commodity));
  if (!commodityCode) {
    return { ok: false, reason: DROP_REASONS.UNMAPPED, detail: displayForm(source.commodity) };
  }

  const state = displayForm(source.state);
  const district = displayForm(source.district);
  const market = displayForm(source.market);
  if (!state || !district || !market) {
    return { ok: false, reason: DROP_REASONS.BAD_GEO };
  }

  const date = parseArrivalDate(source.arrival_date);
  if (!date)
    return { ok: false, reason: DROP_REASONS.BAD_DATE, detail: String(source.arrival_date) };

  // "date > today or < 90d ago → drop (counter)".
  const ageDays = (asOf.getTime() - date.getTime()) / MS_PER_DAY;
  if (ageDays < 0 || ageDays > MARKET_MAX_AGE_DAYS) {
    return { ok: false, reason: DROP_REASONS.BAD_DATE, detail: `ageDays=${Math.round(ageDays)}` };
  }

  const minPrice = toPrice(source.min_price);
  const maxPrice = toPrice(source.max_price);
  let modalPrice = toPrice(source.modal_price);

  // "0 < price < 100,000" — strict at both ends, which is tighter than the
  // Mongoose bounds (min 0.01 / max 100000 inclusive). The gate is enforced
  // here so the model never sees the edge case.
  if (![minPrice, maxPrice, modalPrice].every(inPriceRange)) {
    return { ok: false, reason: DROP_REASONS.BAD_PRICE };
  }

  // Not a documented gate, but an inverted pair makes `modal ∈ [min,max]`
  // meaningless and would store a nonsense band. Counted as a bad price.
  if (minPrice > maxPrice) {
    return { ok: false, reason: DROP_REASONS.BAD_PRICE, detail: 'min>max' };
  }

  // "modal ∉ [min,max] → clamp to nearest bound + flagged:true".
  let flagged = false;
  if (modalPrice < minPrice) {
    modalPrice = minPrice;
    flagged = true;
  } else if (modalPrice > maxPrice) {
    modalPrice = maxPrice;
    flagged = true;
  }

  return {
    ok: true,
    flagged,
    row: {
      commodityCode,
      state,
      district,
      market,
      date,
      minPrice,
      modalPrice,
      maxPrice,
      unit: 'quintal',
      source: 'datagovin',
      fetchedAt,
      // Honesty label (rule 9): a clamped modal price is an adjusted value and
      // must be distinguishable from a published one.
      flagged,
    },
  };
}

/**
 * Normalizes a batch and produces the drop-rate report.
 *
 * @returns {{rows: object[], report: object, aborted: boolean}}
 */
export function normalizeBatch(sourceRows, { aliasIndex, asOf, fetchedAt = asOf }) {
  const rows = [];
  const report = {
    fetched: Array.isArray(sourceRows) ? sourceRows.length : 0,
    accepted: 0,
    flagged: 0,
    dropped: { unmapped: 0, badDate: 0, badPrice: 0, badGeo: 0 },
    samples: { unmapped: [] },
  };

  for (const source of Array.isArray(sourceRows) ? sourceRows : []) {
    const result = normalizeRow(source, { aliasIndex, asOf, fetchedAt });

    if (!result.ok) {
      report.dropped[result.reason] += 1;
      // A handful of unmapped commodity strings is the actionable half of the
      // schema-drift alarm: the count says something broke, the samples say what.
      if (result.reason === DROP_REASONS.UNMAPPED && report.samples.unmapped.length < 10) {
        if (result.detail && !report.samples.unmapped.includes(result.detail)) {
          report.samples.unmapped.push(result.detail);
        }
      }
      continue;
    }

    rows.push(result.row);
    report.accepted += 1;
    if (result.flagged) report.flagged += 1;
  }

  const droppedTotal = Object.values(report.dropped).reduce((sum, count) => sum + count, 0);
  report.droppedTotal = droppedTotal;
  report.dropRate = report.fetched === 0 ? 0 : Number((droppedTotal / report.fetched).toFixed(4));

  return { rows, report };
}
