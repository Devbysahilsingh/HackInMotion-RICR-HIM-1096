/**
 * OpenWeatherMap — the fallback weather provider (ADR-007).
 *
 * > "OpenWeatherMap free-tier fallback (no ET₀ → labeled simplified mode)"
 *
 * Two structural differences from the primary drive everything here, and both
 * are honest limitations rather than bugs to paper over:
 *
 *   1. **No ET₀.** The free tier does not publish reference evapotranspiration,
 *      so `et0Mm` is `null` on every row and the irrigation engine drops to
 *      `mode:'simplified'` (rule R2). A derived ET₀ would be a fabricated
 *      agronomic number (CLAUDE.md rule 7) — never compute one here.
 *   2. **No past days, and 3-hourly granularity.** The free `/forecast`
 *      endpoint returns ~5 days of 3-hourly steps and no history at all. So a
 *      fallback snapshot is *forecast-only and shorter than 14 days*, which is
 *      why `validateDaily` takes a per-source minimum instead of asserting the
 *      "arrays of 14 days" rule from validation.md against both providers —
 *      applying that rule literally would make every fallback fetch fail
 *      validation, i.e. break the exact scenario RES-01 exists to prove.
 *
 * Aggregation to daily rows is by **IST calendar date**, matching the primary's
 * `timezone=Asia/Kolkata`, so the two providers cannot disagree about which day
 * a night-time rain belongs to.
 */
import { z } from 'zod';

import { APP_TIMEZONE, WEATHER_TIMEOUT_MS } from '../config/constants.js';
import { fetchJson } from '../utils/httpClient.js';

export const OWM_PROVIDER = 'openweathermap';
const BASE_URL = 'https://api.openweathermap.org/data/2.5/forecast';

/** IST offset in seconds. India observes no DST, so this is a constant. */
const IST_OFFSET_SECONDS = 5.5 * 60 * 60;
/** `units=metric` gives wind in m/s; the stored contract is km/h. */
const MS_TO_KMH = 3.6;

const responseSchema = z.object({
  list: z
    .array(
      z.object({
        dt: z.number(),
        main: z.object({
          temp_min: z.number(),
          temp_max: z.number(),
          humidity: z.number().optional(),
        }),
        wind: z.object({ speed: z.number() }).optional(),
        pop: z.number().optional(),
        rain: z.record(z.number()).optional(),
      }),
    )
    .min(1),
});

export function buildUrl({ lat, lon, apiKey }) {
  const params = new URLSearchParams({
    lat: String(lat),
    lon: String(lon),
    units: 'metric',
    appid: apiKey,
  });
  return `${BASE_URL}?${params}`;
}

/** UTC epoch seconds → the IST calendar date it falls on, as `YYYY-MM-DD`. */
export function istDateKey(epochSeconds) {
  return new Date((epochSeconds + IST_OFFSET_SECONDS) * 1000).toISOString().slice(0, 10);
}

/**
 * Folds 3-hourly steps into daily rows.
 *
 * Aggregation per field is chosen to match what the primary publishes, so the
 * two sources mean the same thing: min of minima, max of maxima, mean humidity,
 * max wind, summed rain, max probability. Anything else would make a fallback
 * day quietly incomparable to a primary day.
 */
export function aggregateToDaily(list) {
  /** @type {Map<string, {temps: number[], humidity: number[], wind: number[], rain: number, pop: number[], tMin: number, tMax: number}>} */
  const byDate = new Map();

  for (const step of list) {
    const date = istDateKey(step.dt);
    if (!byDate.has(date)) {
      byDate.set(date, {
        tMin: Infinity,
        tMax: -Infinity,
        humidity: [],
        wind: [],
        rain: 0,
        pop: [],
      });
    }
    const bucket = byDate.get(date);

    bucket.tMin = Math.min(bucket.tMin, step.main.temp_min);
    bucket.tMax = Math.max(bucket.tMax, step.main.temp_max);
    if (typeof step.main.humidity === 'number') bucket.humidity.push(step.main.humidity);
    if (typeof step.wind?.speed === 'number') bucket.wind.push(step.wind.speed * MS_TO_KMH);
    if (typeof step.pop === 'number') bucket.pop.push(step.pop * 100);
    // The key is literally "3h"; other windows appear on other endpoints.
    bucket.rain += step.rain?.['3h'] ?? 0;
  }

  const mean = (values) =>
    values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, bucket]) => ({
      date,
      tMinC: bucket.tMin,
      tMaxC: bucket.tMax,
      humidityPct: mean(bucket.humidity),
      windKmh: bucket.wind.length ? Math.max(...bucket.wind) : null,
      rainMm: Number(bucket.rain.toFixed(2)),
      rainProbPct: bucket.pop.length ? Math.max(...bucket.pop) : null,
      // Not derivable from this provider. Null is the honest value.
      et0Mm: null,
    }));
}

/**
 * @returns {Promise<{source: string, daily: object[]|null, invalid?: string}>}
 * @throws {ProviderError} network/timeout/status — the caller decides what a
 *   failure means for the cache.
 */
export async function fetchDaily({ lat, lon, apiKey, fetchImpl } = {}) {
  if (!apiKey) {
    // Reported, not thrown as a provider fault: a missing key is our own
    // configuration state and must not be counted as an OWM outage.
    return { source: OWM_PROVIDER, daily: null, invalid: 'no_api_key' };
  }

  const body = await fetchJson(buildUrl({ lat, lon, apiKey }), {
    provider: OWM_PROVIDER,
    timeoutMs: WEATHER_TIMEOUT_MS,
    fetchImpl,
  });

  const parsed = responseSchema.safeParse(body);
  if (!parsed.success) return { source: OWM_PROVIDER, daily: null, invalid: 'schema' };

  return {
    source: OWM_PROVIDER,
    daily: aggregateToDaily(parsed.data.list),
    // Deliberately excludes the request URL, which carries `appid`.
    raw: { provider: OWM_PROVIDER, timezone: APP_TIMEZONE, steps: parsed.data.list.length },
  };
}
