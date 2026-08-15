/**
 * Weather refresh job — "cron q3h" (docs/weather/weather-architecture.md).
 *
 * The work list is the distinct set of farm `locationKey`s, which is the entire
 * point of rounding coordinates to 0.1°: every farm inside one grid cell shares
 * a single provider call, so the free tier's 10k/day covers far more farms than
 * it has calls.
 *
 * Idempotency: the write is an upsert keyed on the `(locationKey, source)`
 * unique index, so a re-run refreshes timestamps and rewrites the same series
 * rather than accumulating rows. Running this job twice in a row is a no-op
 * beyond `fetchedAt`.
 *
 * The job never throws. A location that fails is counted and the next one is
 * attempted — one dead grid cell must not deprive every other farm of weather.
 */
import { Farm } from '../models/index.js';
import { drainPriorityRefresh } from '../services/farmWeatherService.js';
import { activeLocations, refreshLocation } from '../services/weatherService.js';
import { providerCircuit } from '../utils/circuitBreaker.js';
import { logger } from '../utils/logger.js';

export const WEATHER_JOB_NAME = 'weatherRefresh';

/**
 * @param {{asOf?: Date, fetchImpl?: typeof fetch, locations?: object[]}} [options]
 *   `locations` and `fetchImpl` are injection seams for the suite, which drives
 *   the job directly rather than through a timer (docs/testing/api-testing.md:
 *   "jobs = invoked directly with mocked integrations").
 * @returns {Promise<object>} the run report — logged, and surfaced on /healthz
 */
export async function runWeatherRefresh({ asOf = new Date(), fetchImpl, locations } = {}) {
  const startedAt = Date.now();
  const discovered = locations ?? (await activeLocations(Farm));

  /**
   * Cells a reader hit while they had no snapshot. `farmWeatherService` flags
   * them and promises the farmer "the next scheduler tick fetches it ahead of
   * the routine sweep"; draining here is what makes that true. The set is
   * drained unconditionally — including on an injected `locations` run — so it
   * cannot grow without bound if a flagged farm is later deleted.
   *
   * This reorders the work list; it never extends it. A flagged cell that is no
   * longer any farm's location is dropped rather than fetched, because the
   * work list is defined by `activeLocations`, not by who once asked.
   */
  const prioritized = new Set(drainPriorityRefresh());
  const workList = prioritized.size
    ? [
        ...discovered.filter((entry) => prioritized.has(entry.locationKey)),
        ...discovered.filter((entry) => !prioritized.has(entry.locationKey)),
      ]
    : discovered;

  const report = {
    job: WEATHER_JOB_NAME,
    startedAt: asOf.toISOString(),
    locations: workList.length,
    prioritized: workList.filter((entry) => prioritized.has(entry.locationKey)).length,
    refreshed: 0,
    fallback: 0,
    stale: 0,
    bySource: {},
    failures: [],
  };

  for (const location of workList) {
    const result = await refreshLocation({ ...location, asOf, fetchImpl });

    if (result.status === 'ok') {
      report.refreshed += 1;
      report.bySource[result.source] = (report.bySource[result.source] ?? 0) + 1;
      // A success on the fallback provider is still a degraded run and is
      // counted separately — RES-01 asserts on exactly this number.
      if (result.source === 'openweathermap') report.fallback += 1;
    } else {
      report.stale += 1;
      report.failures.push({ locationKey: result.locationKey, reason: result.reason });
    }
  }

  report.durationMs = Date.now() - startedAt;
  report.circuit = providerCircuit.state(asOf.getTime());
  report.ok = report.stale === 0;

  // Rule 7: a failed run is logged as failed, not quietly dropped.
  const log = report.stale > 0 ? logger.warn.bind(logger) : logger.info.bind(logger);
  log({ report }, 'weather refresh complete');

  return report;
}
