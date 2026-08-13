/**
 * Validate-then-cache for weather payloads.
 *
 * > docs/database/validation.md: "Weather payloads: schema-checked (arrays of
 * >  14 days, numeric ranges: temp −30..55°C, rain 0..500mm, et0 0..15mm);
 * >  out-of-range → reject fetch, keep old cache, log."
 *
 * The contract this file exists to hold is RES-03: a malformed payload must be
 * *rejected whole*. Partial acceptance is worse than rejection, because a
 * snapshot half-written from a broken feed still looks authoritative to the
 * irrigation engine. So the result is binary — every row valid, or nothing is
 * written and the previous snapshot stands.
 *
 * The day-count rule is **per source**, not the flat 14 that validation.md
 * states. Open-Meteo returns 7 past + 7 forecast in one call; OpenWeatherMap's
 * free tier returns forecast only, ~5 days, and no history at all. Enforcing 14
 * against both would reject every fallback payload — breaking RES-01, the test
 * that exists to prove fallback works. The deviation is deliberate and recorded.
 */
import {
  WEATHER_EXPECTED_DAYS,
  WEATHER_FORECAST_DAYS,
  WEATHER_PAST_DAYS,
} from '../config/constants.js';
import { dayKey, startOfDay } from '../utils/day.js';

/**
 * Physical ranges. Temperature/rain/ET₀ are quoted from validation.md; the
 * humidity and probability bounds are definitional percentages; the wind cap is
 * a sanity bound (no surface wind has been recorded near it) rather than an
 * agronomic claim, and exists because the Mongoose schema declares `min: 0`
 * with no maximum.
 */
export const RANGES = {
  tMinC: [-30, 55],
  tMaxC: [-30, 55],
  humidityPct: [0, 100],
  windKmh: [0, 300],
  rainMm: [0, 500],
  rainProbPct: [0, 100],
  et0Mm: [0, 15],
};

/** Fields that must carry a number on every row, whatever the source. */
const REQUIRED_FIELDS = ['date', 'tMinC', 'tMaxC'];

/** Minimum rows accepted, by source. See the per-source note above. */
export const MIN_DAYS_BY_SOURCE = {
  'open-meteo': WEATHER_EXPECTED_DAYS,
  openweathermap: 3,
};

const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);

/**
 * @param {{source: string, daily: unknown}} payload
 * @returns {{ok: true, daily: object[]} | {ok: false, reason: string, detail?: string}}
 *   `reason` is a coarse machine code — it is logged and counted, never shown.
 */
export function validateDaily({ source, daily }) {
  if (!Array.isArray(daily)) return { ok: false, reason: 'not_an_array' };

  const minDays = MIN_DAYS_BY_SOURCE[source];
  if (minDays === undefined) return { ok: false, reason: 'unknown_source', detail: source };
  if (daily.length < minDays) {
    return { ok: false, reason: 'too_few_days', detail: `${daily.length} < ${minDays}` };
  }

  const seenDates = new Set();

  for (const row of daily) {
    if (!row || typeof row !== 'object') return { ok: false, reason: 'row_not_an_object' };

    for (const field of REQUIRED_FIELDS) {
      if (row[field] === null || row[field] === undefined) {
        return { ok: false, reason: 'missing_required_field', detail: field };
      }
    }

    const date = new Date(row.date);
    if (Number.isNaN(date.getTime())) return { ok: false, reason: 'unparseable_date' };

    // A repeated date would silently overwrite a day in any consumer that keys
    // by date, including the irrigation ledger. Compared as IST days, since
    // that is the boundary every consumer uses.
    const key = dayKey(date);
    if (seenDates.has(key)) return { ok: false, reason: 'duplicate_date', detail: key };
    seenDates.add(key);

    for (const [field, [min, max]] of Object.entries(RANGES)) {
      const value = row[field];
      // Absent is legal for optional fields (ET₀ on the fallback path); wrong
      // is not. Only a present value is range-checked.
      if (value === null || value === undefined) continue;
      if (!isFiniteNumber(value)) return { ok: false, reason: 'non_numeric', detail: field };
      if (value < min || value > max) {
        return { ok: false, reason: 'out_of_range', detail: `${field}=${value}` };
      }
    }

    if (row.tMinC > row.tMaxC) {
      return { ok: false, reason: 'tmin_above_tmax', detail: `${row.tMinC}>${row.tMaxC}` };
    }
  }

  const normalized = daily
    .map((row) => ({
      date: new Date(row.date),
      tMinC: row.tMinC,
      tMaxC: row.tMaxC,
      humidityPct: row.humidityPct ?? undefined,
      windKmh: row.windKmh ?? undefined,
      rainMm: row.rainMm ?? undefined,
      rainProbPct: row.rainProbPct ?? undefined,
      et0Mm: row.et0Mm ?? undefined,
    }))
    .sort((a, b) => a.date - b.date);

  return { ok: true, daily: normalized };
}

/**
 * Splits a validated series at `asOf` so callers can reason about "observed"
 * versus "forecast" without re-deriving the boundary. Today counts as forecast:
 * the irrigation projection starts from the current day.
 *
 * The boundary is 00:00 **IST**, not host-local midnight — see utils/day.js.
 */
export function splitByDay(daily, asOf) {
  const startOfToday = startOfDay(asOf);
  return {
    past: daily.filter((row) => row.date < startOfToday),
    forecast: daily.filter((row) => row.date >= startOfToday),
  };
}

export { WEATHER_PAST_DAYS, WEATHER_FORECAST_DAYS };
