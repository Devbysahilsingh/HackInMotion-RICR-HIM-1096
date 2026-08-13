/**
 * Weather ingestion and serving.
 *
 * The pipeline is docs/weather/weather-architecture.md, verbatim:
 *
 *   Open-Meteo (timeout 8s, 1 retry) → validate → upsert weatherSnapshots
 *   on failure → OpenWeatherMap (same treatment; et0 absent)
 *   on both failing → existing snapshot kept, status:'stale', lastSuccessAt untouched
 *
 * The invariant that matters more than any other in this file: **a failed fetch
 * never writes `daily`.** Serving yesterday's real numbers labelled ● Cached is
 * always better than serving nothing, and strictly better than serving a guess.
 * Every write path below is either a validated success or a status-only update.
 *
 * Nothing here is called from a request path (CLAUDE.md rule 3). The read half
 * serves snapshots only.
 */
import { FRESHNESS, WEATHER_STALE_WARNING_MS, WEATHER_TTL_MS } from '../config/constants.js';
import { env } from '../config/env.js';
import { WeatherSnapshot } from '../models/index.js';
import * as openMeteo from '../integrations/openMeteo.js';
import * as openWeatherMap from '../integrations/openWeatherMap.js';
import { providerCircuit } from '../utils/circuitBreaker.js';
import { ProviderError, safeUrl } from '../utils/httpClient.js';
import { logger } from '../utils/logger.js';
import { validateDaily } from './weatherValidation.js';

/** Cap on the debug payload. data-lifecycle.md requires capping; nothing enforced it. */
const MAX_RAW_BYTES = 2048;

function cappedRaw(raw) {
  if (raw == null) return undefined;
  const serialized = JSON.stringify(raw);
  if (serialized.length <= MAX_RAW_BYTES) return raw;
  return { truncated: true, bytes: serialized.length };
}

/**
 * One provider attempt, reduced to a plain outcome.
 * Never throws: the caller's job is to try the next provider, not to unwind.
 *
 * @returns {{ok: true, daily: object[], raw?: object} | {ok: false, reason: string, detail?: string}}
 */
async function attemptProvider({ provider, run, asOf }) {
  if (providerCircuit.isOpen(provider, asOf.getTime())) {
    return { ok: false, reason: 'circuit_open' };
  }

  try {
    const payload = await run();

    if (!payload.daily) {
      // A configuration gap (no key) is not a provider fault and must not
      // trip the breaker — otherwise a missing OWM key would look like an
      // OWM outage for ten minutes at a time.
      if (payload.invalid !== 'no_api_key') providerCircuit.recordFailure(provider, asOf.getTime());
      return { ok: false, reason: payload.invalid ?? 'no_payload' };
    }

    const validation = validateDaily({ source: payload.source, daily: payload.daily });
    if (!validation.ok) {
      // RES-03: a malformed payload is rejected, the cache is untouched, and
      // the rejection is logged with its reason.
      logger.warn(
        { provider, reason: validation.reason, detail: validation.detail },
        'weather payload rejected by validator',
      );
      providerCircuit.recordFailure(provider, asOf.getTime());
      return { ok: false, reason: `invalid:${validation.reason}`, detail: validation.detail };
    }

    providerCircuit.recordSuccess(provider);
    return { ok: true, daily: validation.daily, raw: payload.raw };
  } catch (err) {
    providerCircuit.recordFailure(provider, asOf.getTime());
    if (err instanceof ProviderError) {
      // Only the coarse reason is logged. The upstream body and the request
      // query string (which carries the API key) never reach the log stream.
      logger.warn({ provider, reason: err.reason, status: err.status }, 'weather provider failed');
      return { ok: false, reason: err.reason };
    }
    logger.error({ err, provider }, 'unexpected weather provider error');
    return { ok: false, reason: 'unexpected' };
  }
}

/**
 * Refreshes one grid cell.
 *
 * @param {{locationKey: string, lat: number, lon: number, asOf?: Date, fetchImpl?: typeof fetch}} params
 * @returns {Promise<{locationKey: string, status: 'ok'|'stale', source?: string, reason?: string, days?: number}>}
 */
export async function refreshLocation({ locationKey, lat, lon, asOf = new Date(), fetchImpl }) {
  const attempts = [
    {
      provider: openMeteo.OPEN_METEO_PROVIDER,
      run: () => openMeteo.fetchDaily({ lat, lon, fetchImpl }),
    },
    {
      provider: openWeatherMap.OWM_PROVIDER,
      run: () =>
        openWeatherMap.fetchDaily({ lat, lon, apiKey: env.OPENWEATHER_API_KEY, fetchImpl }),
    },
  ];

  const failures = [];

  for (const attempt of attempts) {
    const outcome = await attemptProvider({ ...attempt, asOf });

    if (outcome.ok) {
      await WeatherSnapshot.updateOne(
        { locationKey, source: attempt.provider },
        {
          $set: {
            locationKey,
            source: attempt.provider,
            fetchedAt: asOf,
            expiresAt: new Date(asOf.getTime() + WEATHER_TTL_MS),
            status: 'ok',
            lastSuccessAt: asOf,
            daily: outcome.daily,
            raw: cappedRaw(outcome.raw),
          },
        },
        { upsert: true },
      );

      return {
        locationKey,
        status: 'ok',
        source: attempt.provider,
        days: outcome.daily.length,
        failures,
      };
    }

    failures.push({ provider: attempt.provider, reason: outcome.reason, detail: outcome.detail });
  }

  // Both providers are out. Move status only — `daily` and `lastSuccessAt` are
  // deliberately absent from this update so last-known-good survives (RES-02).
  const marked = await WeatherSnapshot.updateMany({ locationKey }, { $set: { status: 'stale' } });

  return {
    locationKey,
    status: 'stale',
    reason: failures.at(-1)?.reason ?? 'unknown',
    failures,
    markedStale: marked.modifiedCount,
  };
}

/**
 * The snapshot a reader should see for a cell.
 *
 * Two rows can exist for one location because the unique index is
 * `(locationKey, source)` — a cell that fell back holds both. No document says
 * which to serve, so: newest `fetchedAt` wins, ties break to the primary, which
 * is the row that carries ET₀ and therefore the better irrigation verdict.
 */
export async function latestSnapshot(locationKey) {
  if (!locationKey) return null;

  const snapshots = await WeatherSnapshot.find({ locationKey }).lean();
  if (snapshots.length === 0) return null;

  return snapshots.sort((a, b) => {
    const byTime = new Date(b.fetchedAt) - new Date(a.fetchedAt);
    if (byTime !== 0) return byTime;
    if (a.source === b.source) return 0;
    return a.source === openMeteo.OPEN_METEO_PROVIDER ? -1 : 1;
  })[0];
}

/**
 * Maps a stored snapshot onto the API-wide freshness vocabulary
 * (docs/api/error-codes.md: `live | cached | historical`), plus `pending` for a
 * location that has never been fetched.
 *
 * The stored enum is only `ok | stale`, so the mapping is:
 *   no document                       → pending
 *   status 'ok' and within expiresAt  → live
 *   anything else that has data       → cached (with age, and a warning past 48h)
 */
export function freshnessOf(snapshot, asOf = new Date()) {
  if (!snapshot) return { status: FRESHNESS.PENDING, source: null, fetchedAt: null };

  const fetchedAt = new Date(snapshot.fetchedAt);
  const ageMs = asOf.getTime() - fetchedAt.getTime();
  const live = snapshot.status === 'ok' && asOf < new Date(snapshot.expiresAt);

  return {
    status: live ? FRESHNESS.LIVE : FRESHNESS.CACHED,
    source: snapshot.source,
    fetchedAt,
    ageHours: Math.max(0, Math.round(ageMs / (60 * 60 * 1000))),
    // NFR-7: cached never masquerades as live, and a very old cache says so.
    staleWarning: ageMs > WEATHER_STALE_WARNING_MS,
  };
}

/**
 * Warms one grid cell so a newly-registered farm is not blank.
 *
 * ## Why this exists
 *
 * The refresh job's work list is built from farms that **already exist**, and
 * it ticks every `WEATHER_REFRESH_INTERVAL_MS` (3 hours). A farmer who had just
 * added their field therefore saw "Not fetched yet" on the weather screen — and
 * an `UNAVAILABLE` irrigation verdict, because rule R14 needs a snapshot — for
 * up to three hours, on the very screen that is supposed to introduce the
 * product. Nothing was broken; the first run was simply empty.
 *
 * ## Why this does not violate rule 3
 *
 * Rule 3 forbids a *request path* depending on a provider: no farmer's request
 * may be slow or fail because Open-Meteo is slow or down. This function is
 * therefore called **fire-and-forget, after the response has already been
 * sent** — the farm is created and returned regardless of what the provider
 * does. Reads still come from `weatherSnapshots` alone; this only fills that
 * table sooner than the next tick would.
 *
 * It is a no-op when the cell already holds a snapshot inside its TTL, so the
 * common case — a farm in a cell some other farm already occupies — costs one
 * indexed lookup and no provider call at all.
 *
 * Never throws: a failed warm leaves the screen exactly as it would have been
 * without it, and the job will try again on its own schedule.
 *
 * @param {{locationKey: string, lat: number, lon: number, asOf?: Date, fetchImpl?: typeof fetch}} input
 * @returns {Promise<{warmed: boolean, reason?: string}>}
 */
export async function warmLocation({ locationKey, lat, lon, asOf = new Date(), fetchImpl }) {
  if (!locationKey || lat == null || lon == null) {
    return { warmed: false, reason: 'no_coordinates' };
  }

  /**
   * Under test, an *implicit* warm is suppressed.
   *
   * This is a request-path side effect, so without this guard every suite that
   * creates a farm over HTTP would make a live Open-Meteo call and race the
   * fixtures it seeds itself — which is exactly what happened: the dashboard
   * suite died on a duplicate-key error when the warm wrote the snapshot the
   * test was about to insert.
   *
   * The guard sits here once rather than at each call site, for the reason
   * config/failureFlags.js gives for doing the same thing: a missed check at
   * one call site would be invisible. It suppresses only the *implicit* path —
   * passing an explicit `fetchImpl` is how the suites exercise this function
   * deliberately, so the logic below is still fully covered.
   */
  if (env.NODE_ENV === 'test' && !fetchImpl) {
    return { warmed: false, reason: 'suppressed_in_test' };
  }

  try {
    const fresh = await WeatherSnapshot.findOne({
      locationKey,
      fetchedAt: { $gte: new Date(asOf.getTime() - WEATHER_TTL_MS) },
    })
      .select('_id')
      .lean();

    if (fresh) return { warmed: false, reason: 'already_fresh' };

    const result = await refreshLocation({ locationKey, lat, lon, asOf, fetchImpl });
    return { warmed: result.status === 'ok', reason: result.reason };
  } catch (err) {
    logger.warn({ err, locationKey }, 'weather warm failed — the scheduled job will retry');
    return { warmed: false, reason: 'error' };
  }
}

/**
 * The refresh job's work list: every distinct grid cell a farm sits in.
 *
 * Farms whose location was entered manually without coordinates have no
 * `locationKey` and are therefore absent — the district-centroid table that
 * would give them one does not exist, and inventing centroids would be
 * fabricated data. The gap is reported rather than silently tolerated.
 */
export async function activeLocations(Farm) {
  const rows = await Farm.find({ locationKey: { $exists: true, $ne: null } })
    .select('locationKey location.lat location.lon')
    .lean();

  const byKey = new Map();
  for (const row of rows) {
    if (!byKey.has(row.locationKey)) {
      byKey.set(row.locationKey, {
        locationKey: row.locationKey,
        lat: row.location?.lat,
        lon: row.location?.lon,
      });
    }
  }
  return [...byKey.values()].filter((entry) => entry.lat != null && entry.lon != null);
}

export { safeUrl };
