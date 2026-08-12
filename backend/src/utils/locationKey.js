/**
 * Farm geo and land-size derivations.
 *
 * Two unrelated-looking concerns share this module because both are pure,
 * unit-level conversions of what a farmer typed into what the rest of the
 * system stores: a weather grid key, and an acre-equivalent area.
 */
import { INDIA_BOUNDS, LOCATION_KEY_PRECISION } from '../config/constants.js';

/**
 * The location registration hook, in full.
 *
 * **It does not call a weather provider.** CLAUDE.md rule 3 (DB-first reads)
 * forbids the request path from touching Open-Meteo/OWM, so registering a
 * location means exactly one thing: deriving the 0.1° grid key and storing it
 * on the farm. The Phase-2 refresh cron takes the distinct set of these keys
 * as its work list (docs/weather/weather-architecture.md) — nearby farms
 * collapse onto one provider call, which is the whole point of the rounding.
 *
 * Manual locations without coordinates get no key: the district-centroid table
 * lands with `shared/constants/geo` in Phase 2, and inventing centroid
 * coordinates here would be fabricated data (CLAUDE.md rule 7). Until then the
 * farm simply is not part of the refresh work list.
 *
 * `toFixed` rather than a bare round so the key is canonical — 21.0 and 21
 * must not become two grid cells for the same place.
 *
 * @param {{ lat?: number, lon?: number }} [location]
 * @returns {string | undefined} `"lat,lon"` rounded to 0.1°, or undefined
 */
export function deriveLocationKey(location) {
  const { lat, lon } = location ?? {};
  if (typeof lat !== 'number' || typeof lon !== 'number') return undefined;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return undefined;

  // `+ 0` normalises a negative zero, which would otherwise stringify as "-0.0".
  const round = (value) => (value + 0).toFixed(LOCATION_KEY_PRECISION);
  return `${round(lat)},${round(lon)}`;
}

/** India bounding box test — junk coordinates never reach the provider quota. */
export function withinIndiaBounds({ lat, lon }) {
  return (
    lat >= INDIA_BOUNDS.minLat &&
    lat <= INDIA_BOUNDS.maxLat &&
    lon >= INDIA_BOUNDS.minLon &&
    lon <= INDIA_BOUNDS.maxLon
  );
}

/**
 * Land-unit conversions. Standard values, not agronomic estimates:
 * 1 hectare = 2.47105 acre (exact to 6 s.f. from the SI definition), and the
 * 1 bigha = 0.625 acre convention used here is the "pucca bigha" of the
 * north-Indian plains. Bigha genuinely varies by state, so it is stored as the
 * farmer's own unit on the document and converted only for this ceiling check
 * — no recommendation ever consumes a converted bigha.
 */
export const ACRES_PER_UNIT = {
  acre: 1,
  hectare: 2.47105,
  bigha: 0.625,
};

/** Upper bound on a single field (docs/database/validation.md: "≤ 250 acres-equivalent"). */
export const MAX_FARM_SIZE_ACRES = 250;

/**
 * @param {number} value
 * @param {'acre'|'hectare'|'bigha'} unit
 * @returns {number} acre-equivalent area
 */
export function toAcres(value, unit) {
  const factor = ACRES_PER_UNIT[unit];
  if (factor === undefined) throw new Error(`unknown land unit: ${unit}`);
  return value * factor;
}
