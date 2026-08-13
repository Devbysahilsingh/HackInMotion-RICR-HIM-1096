/**
 * Open-Meteo Geocoding — place name ⇄ coordinates.
 *
 * ## Why this exists
 *
 * A farmer knows their village. They do not know their latitude. Until now the
 * farm form could only store coordinates the *device* supplied, so a farmer who
 * declined the GPS prompt — or whose phone could not get a fix indoors — ended
 * up with a farm carrying no `locationKey` at all. That farm was then invisible
 * to the weather job (`activeLocations` filters on the key) and its irrigation
 * verdict was permanently `UNAVAILABLE`. The gap was documented in
 * shared/constants/climate-normals.js and weatherService.activeLocations:
 * "the district-centroid table that would give them one does not exist, and
 * inventing centroids would be fabricated data".
 *
 * This closes that gap **without inventing anything**: the coordinates come
 * from a real gazetteer, per lookup, and are stored with the source recorded.
 *
 * ## Why this provider
 *
 * It is the same vendor already approved for weather (ADR-007), keyless and
 * free on the same 10k/day allowance, so it introduces no new credential, no
 * cost (rule 10) and no new supplier to the dependency list. Verified live on
 * 2026-08-13: `Bhopal` resolves to admin1 "Madhya Pradesh", admin2 "Bhopal
 * District", 23.25469/77.40289, country_code IN.
 *
 * Results are filtered to India. A farmer typing "Nashik" must never be handed
 * a same-named town on another continent, and the app is India-only by charter.
 */
import { z } from 'zod';

import { WEATHER_TIMEOUT_MS } from '../config/constants.js';
import { fetchJson } from '../utils/httpClient.js';

export const GEOCODING_PROVIDER = 'open-meteo-geocoding';

const SEARCH_URL = 'https://geocoding-api.open-meteo.com/v1/search';

/** India only — matches INDIA_BOUNDS, which the farm schema already enforces. */
const COUNTRY_CODE = 'IN';

/**
 * Shape only. Every field beyond coordinates is optional because the gazetteer
 * genuinely omits `admin2` for some places, and a missing district must degrade
 * to "we do not know" rather than fail the whole lookup.
 */
const resultSchema = z.object({
  name: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  country_code: z.string().optional(),
  admin1: z.string().optional(), // state
  admin2: z.string().optional(), // district
  admin3: z.string().optional(), // sub-district / taluka
});

const searchSchema = z.object({ results: z.array(resultSchema).optional() });

/** Provider row → our canonical place shape. Never invents a missing field. */
const toPlace = (row) => ({
  name: row.name,
  lat: row.latitude,
  lon: row.longitude,
  state: row.admin1 ?? null,
  district: row.admin2 ?? null,
  locality: row.admin3 ?? null,
  source: GEOCODING_PROVIDER,
});

/**
 * Place name → coordinates.
 *
 * The query is built most-specific-first — "village, district, state" — because
 * the gazetteer ranks on the whole string; searching for a bare village name
 * across India returns the largest match, not the nearest one.
 *
 * @param {{village?: string|null, district?: string|null, state?: string|null, fetchImpl?: typeof fetch}} input
 * @returns {Promise<{ok: true, place: object, candidates: object[]} | {ok: false, reason: string}>}
 */
export async function geocodePlace({ village, district, state, fetchImpl } = {}) {
  const clean = (v) => (v ?? '').trim();
  const [v, d, s] = [clean(village), clean(district), clean(state)];
  if (!v && !d && !s) return { ok: false, reason: 'no_place_given' };

  /**
   * Progressively less specific queries, most specific first.
   *
   * The gazetteer matches on the whole string, so an over-specified query finds
   * nothing: "Yeola, Nashik, Maharashtra" returns no result while "Yeola,
   * Maharashtra" resolves correctly to 20.0424/74.4894. Verified live on
   * 2026-08-13. Dropping the middle term is therefore a real recovery, not a
   * guess — and the search stops at the first level that answers, so a precise
   * village is never silently replaced by its district centre when the village
   * itself is known to the gazetteer.
   */
  const attempts = [[v, d, s], [v, s], [v], [d, s], [d], [s]]
    .map((parts) => parts.filter(Boolean).join(', '))
    .filter(Boolean);

  const tried = [...new Set(attempts)];
  let sawProviderFailure = false;

  for (const query of tried) {
    const url = `${SEARCH_URL}?name=${encodeURIComponent(query)}&count=10&language=en&format=json&countryCode=${COUNTRY_CODE}`;

    let payload;
    try {
      payload = await fetchJson(url, {
        provider: GEOCODING_PROVIDER,
        timeoutMs: WEATHER_TIMEOUT_MS,
        fetchImpl,
      });
    } catch {
      sawProviderFailure = true;
      continue;
    }

    const parsed = searchSchema.safeParse(payload);
    if (!parsed.success) continue;

    const indian = (parsed.data.results ?? []).filter(
      (row) => !row.country_code || row.country_code === COUNTRY_CODE,
    );
    if (indian.length === 0) continue;

    /**
     * Prefer a candidate whose state matches what the farmer typed. The
     * gazetteer returns three different "Bhopal"s in three states; taking the
     * first would silently move a Madhya Pradesh farm to Uttar Pradesh.
     */
    const wantedState = s.toLowerCase();
    const ranked = wantedState
      ? [
          ...indian.filter((r) => (r.admin1 ?? '').toLowerCase() === wantedState),
          ...indian.filter((r) => (r.admin1 ?? '').toLowerCase() !== wantedState),
        ]
      : indian;

    return {
      ok: true,
      place: toPlace(ranked[0]),
      candidates: ranked.slice(0, 5).map(toPlace),
      matchedQuery: query,
    };
  }

  return { ok: false, reason: sawProviderFailure ? 'provider_unavailable' : 'not_found' };
}

/**
 * ## There is deliberately no reverse geocoder here
 *
 * Coordinates → place name would be the natural way to label a GPS-located farm
 * with its district, and the first draft of this module implemented it against
 * `/v1/reverse`. **That endpoint does not exist**: Open-Meteo's free geocoding
 * API is search-only and answers `404 {"reason":"Not Found"}` (verified
 * 2026-08-13). Shipping a function that always fails would have looked like a
 * working feature in the code and produced an empty district on every GPS farm.
 *
 * The consequence is deliberate and visible in the farm form: a GPS fix gives
 * precise coordinates, and the farmer still confirms state and district, which
 * they know. Nothing is inferred that cannot be sourced.
 *
 * Adding real reverse geocoding means adding a second gazetteer vendor, which
 * is a dependency decision (rule 10 and the dependency list), not something to
 * slip in here.
 */
