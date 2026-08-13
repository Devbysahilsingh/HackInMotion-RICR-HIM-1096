/**
 * Open-Meteo — the primary weather provider (ADR-007).
 *
 * > "Open-Meteo (keyless, free, 10k/day) primary — uniquely provides daily FAO
 * >  ET₀ enabling the real irrigation engine"
 *
 * **No repository document specifies the request.** weather-architecture.md
 * names the variables ("Tmin/Tmax (°C), RH (%), wind (km/h), precipitation sum
 * (mm) + probability (%), ET₀ FAO evapotranspiration (mm)") but no URL, no
 * parameter names and no unit flags. The query below was therefore built from
 * those variables and **verified against the live keyless API** on 2026-08-13:
 * 14 daily rows, every requested field present and non-null, and `daily_units`
 * returning exactly `°C / % / km/h / mm / % / mm`. That verified sample is the
 * test fixture, per docs/testing/strategy.md ("recorded real payload samples").
 *
 * Units are pinned explicitly rather than left to the provider default so a
 * silent upstream default change cannot turn 15 km/h into 15 mph.
 */
import { z } from 'zod';

import {
  APP_TIMEZONE,
  WEATHER_FORECAST_DAYS,
  WEATHER_PAST_DAYS,
  WEATHER_TIMEOUT_MS,
} from '../config/constants.js';
import { fetchJson } from '../utils/httpClient.js';

export const OPEN_METEO_PROVIDER = 'open-meteo';
const BASE_URL = 'https://api.open-meteo.com/v1/forecast';

/** Provider variable → our canonical field. */
const DAILY_VARIABLES = {
  temperature_2m_min: 'tMinC',
  temperature_2m_max: 'tMaxC',
  relative_humidity_2m_mean: 'humidityPct',
  wind_speed_10m_max: 'windKmh',
  precipitation_sum: 'rainMm',
  precipitation_probability_max: 'rainProbPct',
  et0_fao_evapotranspiration: 'et0Mm',
};

/**
 * Shape only — physical ranges are asserted later, by the shared validator, so
 * that both providers are held to one set of numbers rather than two copies.
 * `nullable()` throughout: Open-Meteo returns `null` for a variable it cannot
 * model at a location, and a null must survive to the validator as a null
 * rather than being coerced to a number that was never measured.
 */
const numericSeries = z.array(z.number().nullable());

const responseSchema = z.object({
  daily: z
    .object({ time: z.array(z.string()) })
    .catchall(numericSeries)
    .refine((daily) => Object.keys(DAILY_VARIABLES).every((key) => Array.isArray(daily[key])), {
      message: 'daily is missing a requested variable',
    }),
});

export function buildUrl({ lat, lon }) {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    daily: Object.keys(DAILY_VARIABLES).join(','),
    // A fixed zone, not `auto`: every day boundary in this system is IST, and
    // letting the provider infer one would make the boundary depend on the
    // farm's coordinates.
    timezone: APP_TIMEZONE,
    past_days: String(WEATHER_PAST_DAYS),
    forecast_days: String(WEATHER_FORECAST_DAYS),
    temperature_unit: 'celsius',
    wind_speed_unit: 'kmh',
    precipitation_unit: 'mm',
  });
  return `${BASE_URL}?${params}`;
}

/**
 * Open-Meteo answers columnar — parallel arrays keyed by variable — so this
 * transposes to one object per day. Row count is driven by `time`; a variable
 * array shorter than `time` yields `undefined`, which the validator rejects.
 *
 * @returns {Promise<{source: string, daily: object[], raw: object}>}
 */
export async function fetchDaily({ lat, lon, fetchImpl } = {}) {
  const url = buildUrl({ lat, lon });

  const body = await fetchJson(url, {
    provider: OPEN_METEO_PROVIDER,
    timeoutMs: WEATHER_TIMEOUT_MS,
    fetchImpl,
  });

  const parsed = responseSchema.safeParse(body);
  if (!parsed.success) {
    // Malformed provider payloads are a validator concern (RES-03), not an
    // exception to leak: the caller turns this into "cache untouched".
    return { source: OPEN_METEO_PROVIDER, daily: null, invalid: 'schema' };
  }

  const { daily } = parsed.data;
  const rows = daily.time.map((date, index) => {
    const row = { date };
    for (const [variable, field] of Object.entries(DAILY_VARIABLES)) {
      row[field] = daily[variable][index] ?? null;
    }
    return row;
  });

  return {
    source: OPEN_METEO_PROVIDER,
    daily: rows,
    // Kept small on purpose: the units block is the part worth having when
    // debugging a bad number, and the series themselves are already stored.
    raw: { daily_units: body.daily_units, timezone: body.timezone },
  };
}
