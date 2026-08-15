/**
 * Weather — ingestion resilience and the read route.
 *
 * Real mongod, real HTTP, real tokens; the only thing stubbed is the socket to
 * the provider (`fetchImpl`). That split is deliberate: the claims under test
 * are about what survives in the database when a provider misbehaves, and only
 * a real upsert against a real unique index can answer that honestly.
 *
 * The RES cases come from docs/testing/resilience-testing.md:
 *   RES-01  Open-Meteo down            → OpenWeatherMap fallback, no ET₀
 *   RES-02  both providers down        → last-known-good preserved, status stale
 *   RES-03  malformed payload          → cache untouched
 *
 * Every call passes an explicit `asOf`; there are no fake timers in this
 * project (ADR-022) and the job takes the instant as a parameter for exactly
 * this reason.
 */
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { API_PREFIX, createApp } from '../../src/app.js';
import { env } from '../../src/config/env.js';
import { runWeatherRefresh } from '../../src/jobs/weatherRefresh.js';
import { requestPriorityRefresh } from '../../src/services/farmWeatherService.js';
import { WeatherSnapshot } from '../../src/models/index.js';
import { providerCircuit } from '../../src/utils/circuitBreaker.js';
import { farmInput, registerUser } from '../factories/index.js';
import { startTestServer } from '../helpers/app.js';
import { clearCollections, startTestDatabase, stopTestDatabase } from '../helpers/db.js';

const FARMS = `${API_PREFIX}/farms`;

/** The grid cell the factory farm (Nagpur) rounds to, at 0.1°. */
const LOCATION = { locationKey: '21.1,79.1', lat: 21.1458, lon: 79.0882 };

const OPEN_METEO_HOST = 'api.open-meteo.com';
const OWM_HOST = 'api.openweathermap.org';

/** Fabricated; the fallback leg only needs *a* key to be configured. */
const OWM_TEST_KEY = 'cccccccc11111111cccccccc11111111'; // pragma: allowlist-secret

// ── Provider stubs ──────────────────────────────────────────────────────────

/**
 * One stub for both hosts, dispatching on the URL. `calls` records the host of
 * every attempt so "did it fall back?" is an assertion rather than a guess.
 *
 * @param {{openMeteo: Function, openWeatherMap: Function}} handlers
 */
function providerStub(handlers) {
  const calls = [];
  const impl = async (url) => {
    const { host } = new URL(url);
    calls.push(host);

    const handler = host === OPEN_METEO_HOST ? handlers.openMeteo : handlers.openWeatherMap;
    if (!handler) throw new Error(`test stub reached an unexpected host: ${host}`);
    return handler();
  };
  impl.calls = calls;
  impl.hits = (host) => calls.filter((entry) => entry === host).length;
  return impl;
}

const serves = (body) => () => ({ ok: true, status: 200, json: async () => body });

/** A provider that is simply not answering. */
const down = () => () => {
  throw new TypeError('fetch failed');
};

const isoDay = (asOf, offset) =>
  new Date(asOf.getTime() + offset * 86_400_000).toISOString().slice(0, 10);

/** A columnar Open-Meteo body of 7 past + 7 forecast days around `asOf`. */
function openMeteoBody(asOf, { tMaxC = 33.4 } = {}) {
  const time = Array.from({ length: 14 }, (_, index) => isoDay(asOf, index - 7));
  const column = (value) => time.map(() => value);

  return {
    daily: {
      time,
      temperature_2m_min: column(24.5),
      temperature_2m_max: column(tMaxC),
      relative_humidity_2m_mean: column(72),
      wind_speed_10m_max: column(11.5),
      precipitation_sum: column(2.4),
      precipitation_probability_max: column(35),
      et0_fao_evapotranspiration: column(4.6),
    },
    daily_units: { temperature_2m_max: '°C' },
    timezone: 'Asia/Kolkata',
  };
}

/** Five IST days of 3-hourly OpenWeatherMap steps, at 03:00Z and 09:00Z. */
function owmBody(asOf, { tempMax = 32.8 } = {}) {
  const base = Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate(), 3, 0, 0);
  const list = [];

  for (let day = 0; day < 5; day += 1) {
    for (const hourOffset of [0, 6]) {
      list.push({
        dt: Math.floor((base + day * 86_400_000 + hourOffset * 3_600_000) / 1000),
        main: { temp_min: 25.2, temp_max: tempMax, humidity: 68 },
        wind: { speed: 3 },
        pop: 0.3,
        rain: { '3h': 0.6 },
      });
    }
  }

  return { list };
}

// ── Suite ───────────────────────────────────────────────────────────────────

describe('Weather ingestion and read route', () => {
  let server;
  let alice;
  let bob;

  before(async () => {
    await startTestDatabase();
    server = await startTestServer(createApp());

    /**
     * The fallback leg reads `env.OPENWEATHER_API_KEY`, and `env` is parsed
     * once at import time — setting `process.env` from a test body would run
     * after that parse and change nothing. So the already-validated config
     * object is what gets a value here, and it is restored afterwards.
     */
    env.OPENWEATHER_API_KEY = OWM_TEST_KEY;
  });

  after(async () => {
    env.OPENWEATHER_API_KEY = undefined;
    await server.close();
    await stopTestDatabase();
  });

  beforeEach(async () => {
    await clearCollections();
    // The breaker is process-wide by design; without this a suite that trips
    // it would leak "circuit_open" into every later case.
    providerCircuit.reset();
    alice = await registerUser(server);
    bob = await registerUser(server);
  });

  const createFarm = async (token, overrides) => {
    const res = await server.request(FARMS, { method: 'POST', token, body: farmInput(overrides) });
    assert.equal(res.status, 201, res.text);
    return res.body.data.farm;
  };

  const refresh = (fetchImpl, asOf, locations = [LOCATION]) =>
    runWeatherRefresh({ locations, fetchImpl, asOf });

  const snapshotFor = (source) =>
    WeatherSnapshot.findOne({ locationKey: LOCATION.locationKey, source }).lean();

  // ── RES-01 ───────────────────────────────────────────────────────────────

  describe('RES-01 · Open-Meteo down → OpenWeatherMap fallback', () => {
    const asOf = new Date('2026-08-13T06:00:00.000Z');

    it('stores a fallback snapshot with no ET₀ and counts the run as degraded', async () => {
      const fetchImpl = providerStub({
        openMeteo: down(),
        openWeatherMap: serves(owmBody(asOf)),
      });

      const report = await refresh(fetchImpl, asOf);

      assert.equal(report.locations, 1);
      assert.equal(report.refreshed, 1);
      assert.equal(report.fallback, 1, 'a fallback success was not counted as degraded');
      assert.equal(report.stale, 0);
      assert.deepEqual(report.bySource, { openweathermap: 1 });
      assert.equal(report.ok, true);

      // The fallback was actually reached, after the primary was actually tried.
      assert.ok(fetchImpl.hits(OPEN_METEO_HOST) >= 1);
      assert.equal(fetchImpl.hits(OWM_HOST), 1);

      const stored = await snapshotFor('openweathermap');
      assert.ok(stored, 'no fallback snapshot was written');
      assert.equal(stored.status, 'ok');
      assert.equal(stored.locationKey, LOCATION.locationKey);
      assert.equal(stored.lastSuccessAt.getTime(), asOf.getTime());
      assert.equal(stored.daily.length, 5);

      // Rule 7: the free tier publishes no ET₀, so no ET₀ is stored. A derived
      // one would be a fabricated agronomic number.
      for (const day of stored.daily) {
        assert.equal(day.et0Mm ?? null, null, `${day.date.toISOString()} carried an invented ET₀`);
        assert.equal(typeof day.tMinC, 'number');
        assert.equal(typeof day.tMaxC, 'number');
      }

      // The primary never produced a valid payload, so it has no row at all.
      assert.equal(await WeatherSnapshot.countDocuments({ source: 'open-meteo' }), 0);
    });

    it('does not fall back when the primary succeeds', async () => {
      const fetchImpl = providerStub({
        openMeteo: serves(openMeteoBody(asOf)),
        openWeatherMap: serves(owmBody(asOf)),
      });

      const report = await refresh(fetchImpl, asOf);

      assert.equal(report.fallback, 0);
      assert.deepEqual(report.bySource, { 'open-meteo': 1 });
      assert.equal(fetchImpl.hits(OWM_HOST), 0, 'the fallback burned quota it did not need');

      const stored = await snapshotFor('open-meteo');
      assert.equal(stored.daily.length, 14);
      assert.equal(stored.daily[0].et0Mm, 4.6);
    });

    it('goes stale rather than falling back when no OWM key is configured', async () => {
      const saved = env.OPENWEATHER_API_KEY;
      env.OPENWEATHER_API_KEY = undefined;

      try {
        const fetchImpl = providerStub({ openMeteo: down(), openWeatherMap: serves({}) });
        const report = await refresh(fetchImpl, asOf);

        assert.equal(report.stale, 1);
        assert.equal(report.failures[0].reason, 'no_api_key');
        assert.equal(fetchImpl.hits(OWM_HOST), 0, 'a keyless call still hit the provider');
      } finally {
        env.OPENWEATHER_API_KEY = saved;
      }
    });
  });

  // ── RES-02 ───────────────────────────────────────────────────────────────

  describe('RES-02 · both providers down → last-known-good preserved', () => {
    const seededAt = new Date('2026-08-13T06:00:00.000Z');
    const outageAt = new Date('2026-08-13T09:00:00.000Z');

    it('moves status to stale and changes nothing else', async () => {
      const good = providerStub({
        openMeteo: serves(openMeteoBody(seededAt)),
        openWeatherMap: serves(owmBody(seededAt)),
      });
      assert.equal((await refresh(good, seededAt)).refreshed, 1);

      const before = await snapshotFor('open-meteo');
      assert.equal(before.status, 'ok');
      assert.equal(before.daily.length, 14);

      const report = await refresh(
        providerStub({ openMeteo: down(), openWeatherMap: down() }),
        outageAt,
      );

      assert.equal(report.refreshed, 0);
      assert.equal(report.stale, 1);
      assert.equal(report.ok, false);
      assert.deepEqual(report.failures, [{ locationKey: LOCATION.locationKey, reason: 'network' }]);

      const after = await snapshotFor('open-meteo');

      assert.equal(after.status, 'stale');
      // Byte-identical: a failed fetch must never write `daily`.
      assert.deepEqual(after.daily, before.daily);
      assert.equal(after.lastSuccessAt.getTime(), before.lastSuccessAt.getTime());
      assert.equal(after.fetchedAt.getTime(), before.fetchedAt.getTime());
      assert.equal(after.expiresAt.getTime(), before.expiresAt.getTime());
    });

    it('still serves the cached series to the farmer, labelled as cached', async () => {
      const farm = await createFarm(alice.accessToken);

      const good = providerStub({
        openMeteo: serves(openMeteoBody(seededAt)),
        openWeatherMap: serves(owmBody(seededAt)),
      });
      await refresh(good, seededAt, [{ ...LOCATION, locationKey: farm.locationKey }]);
      await refresh(providerStub({ openMeteo: down(), openWeatherMap: down() }), outageAt, [
        { ...LOCATION, locationKey: farm.locationKey },
      ]);

      const res = await server.request(`${FARMS}/${farm.id}/weather`, {
        token: alice.accessToken,
      });

      assert.equal(res.status, 200, res.text);
      assert.equal(res.body.data.daily.length, 14);
      // NFR-7: a cache never masquerades as live.
      assert.equal(res.body.data.freshness.status, 'cached');
      assert.equal(res.body.data.freshness.source, 'open-meteo');
      assert.equal(typeof res.body.data.freshness.ageHours, 'number');
    });
  });

  // ── RES-03 ───────────────────────────────────────────────────────────────

  describe('RES-03 · a malformed payload leaves the cache untouched', () => {
    const seededAt = new Date('2026-08-13T06:00:00.000Z');
    const badAt = new Date('2026-08-13T09:00:00.000Z');

    it('rejects an out-of-range series whole and keeps the previous snapshot', async () => {
      const good = providerStub({
        openMeteo: serves(openMeteoBody(seededAt)),
        openWeatherMap: serves(owmBody(seededAt)),
      });
      await refresh(good, seededAt);

      const before = await snapshotFor('open-meteo');

      // Structurally valid, physically impossible: 999°C.
      const report = await refresh(
        providerStub({
          openMeteo: serves(openMeteoBody(badAt, { tMaxC: 999 })),
          openWeatherMap: serves(owmBody(badAt, { tempMax: 999 })),
        }),
        badAt,
      );

      assert.equal(report.refreshed, 0);
      assert.equal(report.stale, 1);
      assert.equal(report.failures[0].reason, 'invalid:out_of_range');

      const after = await snapshotFor('open-meteo');

      assert.notEqual(after.status, 'ok', 'a rejected payload was accepted as fresh');
      assert.equal(after.status, 'stale');
      assert.deepEqual(after.daily, before.daily);
      assert.equal(after.daily[0].tMaxC, 33.4, 'the 999°C row reached the cache');
      assert.equal(after.lastSuccessAt.getTime(), before.lastSuccessAt.getTime());
    });

    it('rejects a schema-broken payload without writing anything at all', async () => {
      const broken = openMeteoBody(badAt);
      delete broken.daily.et0_fao_evapotranspiration;

      const report = await refresh(
        providerStub({ openMeteo: serves(broken), openWeatherMap: serves({ cod: '401' }) }),
        badAt,
      );

      assert.equal(report.stale, 1);
      assert.equal(report.failures[0].reason, 'schema');
      assert.equal(await WeatherSnapshot.countDocuments({}), 0, 'a broken payload created a row');
    });
  });

  // ── Idempotency ──────────────────────────────────────────────────────────

  describe('the job is idempotent', () => {
    const first = new Date('2026-08-13T06:00:00.000Z');
    const second = new Date('2026-08-13T09:00:00.000Z');

    it('upserts one document per (locationKey, source), however often it runs', async () => {
      const stub = () =>
        providerStub({
          openMeteo: serves(openMeteoBody(first)),
          openWeatherMap: serves(owmBody(first)),
        });

      await refresh(stub(), first);
      await refresh(stub(), second);

      assert.equal(
        await WeatherSnapshot.countDocuments({
          locationKey: LOCATION.locationKey,
          source: 'open-meteo',
        }),
        1,
      );
      assert.equal(await WeatherSnapshot.countDocuments({}), 1);

      // The re-run refreshed the timestamps rather than accumulating rows.
      const stored = await snapshotFor('open-meteo');
      assert.equal(stored.fetchedAt.getTime(), second.getTime());
      assert.equal(stored.daily.length, 14);
    });

    it('keeps one row per source when a cell has fallen back and then recovered', async () => {
      await refresh(
        providerStub({ openMeteo: down(), openWeatherMap: serves(owmBody(first)) }),
        first,
      );
      await refresh(
        providerStub({
          openMeteo: serves(openMeteoBody(second)),
          openWeatherMap: serves(owmBody(second)),
        }),
        second,
      );

      assert.equal(await WeatherSnapshot.countDocuments({}), 2);
      // The newer primary row is the one a reader gets.
      const openMeteoRow = await snapshotFor('open-meteo');
      assert.equal(openMeteoRow.fetchedAt.getTime(), second.getTime());
    });

    it('derives its work list from farm locations when none is supplied', async () => {
      await createFarm(alice.accessToken, { name: 'A' });
      // Same 0.1° cell as the first farm — one fetch must cover both.
      await createFarm(alice.accessToken, {
        name: 'B',
        location: {
          lat: 21.1401,
          lon: 79.0501,
          state: 'Maharashtra',
          district: 'Nagpur',
          source: 'gps',
        },
      });
      // No coordinates at all: absent from the work list rather than invented.
      await createFarm(bob.accessToken, {
        name: 'C',
        location: { state: 'Punjab', district: 'Ludhiana', source: 'manual' },
      });

      const fetchImpl = providerStub({
        openMeteo: serves(openMeteoBody(first)),
        openWeatherMap: serves(owmBody(first)),
      });
      const report = await runWeatherRefresh({ fetchImpl, asOf: first });

      assert.equal(report.locations, 1);
      assert.equal(report.refreshed, 1);
      assert.equal(fetchImpl.hits(OPEN_METEO_HOST), 1);
    });
  });

  // ── GET /farms/:id/weather ───────────────────────────────────────────────

  describe('GET /farms/:id/weather', () => {
    it('requires a token', async () => {
      const farm = await createFarm(alice.accessToken);

      const res = await server.request(`${FARMS}/${farm.id}/weather`);

      assert.equal(res.status, 401);
      assert.equal(res.body.error.code, 'AUTHENTICATION_ERROR');
    });

    it('answers 404 — never 403 — for another user’s farm', async () => {
      const bobsFarm = await createFarm(bob.accessToken, { name: 'Bob field' });

      const res = await server.request(`${FARMS}/${bobsFarm.id}/weather`, {
        token: alice.accessToken,
      });

      assert.equal(res.status, 404);
      assert.equal(res.body.error.code, 'NOT_FOUND');
    });

    it('answers 404 for a malformed id rather than casting it', async () => {
      const res = await server.request(`${FARMS}/not-an-object-id/weather`, {
        token: alice.accessToken,
      });

      assert.equal(res.status, 404);
      assert.ok(!res.text.includes('Cast'));
    });

    it('answers 200 with freshness "pending" when the cell has never been fetched', async () => {
      const farm = await createFarm(alice.accessToken);

      const res = await server.request(`${FARMS}/${farm.id}/weather`, {
        token: alice.accessToken,
      });

      assert.equal(res.status, 200, res.text);
      assert.equal(res.body.success, true);
      assert.deepEqual(res.body.data.daily, []);
      assert.deepEqual(res.body.data.risks, []);

      const { freshness } = res.body.data;
      assert.equal(freshness.status, 'pending');
      assert.equal(freshness.source, null);
      assert.equal(freshness.fetchedAt, null);
      assert.equal(freshness.reason, 'awaiting_first_fetch');
      assert.equal(typeof freshness.retryAfterSeconds, 'number');
    });

    it('distinguishes "cannot be fetched" from "not fetched yet"', async () => {
      const farm = await createFarm(alice.accessToken, {
        location: { state: 'Punjab', district: 'Ludhiana', source: 'manual' },
      });

      const res = await server.request(`${FARMS}/${farm.id}/weather`, {
        token: alice.accessToken,
      });

      assert.equal(res.status, 200, res.text);
      assert.equal(res.body.data.freshness.status, 'pending');
      assert.equal(res.body.data.freshness.reason, 'no_coordinates');
    });

    it('answers 200 with daily rows and freshness "live" after a successful refresh', async () => {
      const farm = await createFarm(alice.accessToken);
      // A real "now", because live-ness is a comparison against expiresAt and
      // the route reads the clock itself.
      const asOf = new Date();

      await refresh(
        providerStub({
          openMeteo: serves(openMeteoBody(asOf)),
          openWeatherMap: serves(owmBody(asOf)),
        }),
        asOf,
        [{ ...LOCATION, locationKey: farm.locationKey }],
      );

      const res = await server.request(`${FARMS}/${farm.id}/weather`, {
        token: alice.accessToken,
      });

      assert.equal(res.status, 200, res.text);
      assert.equal(res.body.data.daily.length, 14);

      const [day] = res.body.data.daily;
      assert.equal(typeof day.date, 'string');
      assert.equal(day.tMinC, 24.5);
      assert.equal(day.tMaxC, 33.4);
      assert.equal(day.et0Mm, 4.6);
      assert.equal(day.rainProbPct, 35);

      const { freshness } = res.body.data;
      assert.equal(freshness.status, 'live');
      assert.equal(freshness.source, 'open-meteo');
      assert.equal(freshness.staleWarning, false);
      assert.ok(freshness.fetchedAt);

      // A farm with no active crops gets weather and no invented risk.
      assert.deepEqual(res.body.data.risks, []);
      // The debug payload is never served.
      assert.ok(!res.text.includes('daily_units'));
    });

    it('serves every farm in the same grid cell from the one snapshot', async () => {
      const farm = await createFarm(alice.accessToken);
      const neighbour = await createFarm(bob.accessToken, {
        name: 'Neighbour',
        location: {
          lat: 21.1401,
          lon: 79.0501,
          state: 'Maharashtra',
          district: 'Nagpur',
          source: 'gps',
        },
      });
      assert.equal(neighbour.locationKey, farm.locationKey);

      const asOf = new Date();
      const fetchImpl = providerStub({
        openMeteo: serves(openMeteoBody(asOf)),
        openWeatherMap: serves(owmBody(asOf)),
      });
      await refresh(fetchImpl, asOf, [{ ...LOCATION, locationKey: farm.locationKey }]);

      for (const [id, token] of [
        [farm.id, alice.accessToken],
        [neighbour.id, bob.accessToken],
      ]) {
        const res = await server.request(`${FARMS}/${id}/weather`, { token });
        assert.equal(res.status, 200, res.text);
        assert.equal(res.body.data.daily.length, 14);
        assert.equal(res.body.data.freshness.status, 'live');
      }

      assert.equal(fetchImpl.hits(OPEN_METEO_HOST), 1, 'one cell cost more than one fetch');
    });
  });

  // ── priority refresh ───────────────────────────────────────────────────────

  /**
   * `farmWeatherService` answers a farm whose cell has never been fetched with
   * `status:'pending'` and flags the cell, promising the farmer that "the next
   * scheduler tick fetches it ahead of the routine sweep". Until 2026-08-15
   * `drainPriorityRefresh` was called by nothing, so the set filled and never
   * drained and that promise was never kept.
   */
  describe('priority refresh', () => {
    const asOf = new Date('2026-08-13T06:00:00.000Z');
    const OTHER = { locationKey: '19.1,72.9', lat: 19.076, lon: 72.877 };

    it('fetches a reader-flagged cell before the routine sweep, and drains it', async () => {
      const fetched = [];
      const fetchImpl = providerStub({
        openMeteo: serves(openMeteoBody(asOf)),
        openWeatherMap: serves(owmBody(asOf)),
      });
      // Record order by wrapping the stub — the report alone cannot show it.
      const ordered = async (url) => {
        fetched.push(new URL(url).searchParams.get('latitude'));
        return fetchImpl(url);
      };

      requestPriorityRefresh(OTHER.locationKey);
      const report = await runWeatherRefresh({
        locations: [LOCATION, OTHER],
        fetchImpl: ordered,
        asOf,
      });

      assert.equal(report.locations, 2, 'the work list changed size');
      assert.equal(report.prioritized, 1);
      assert.equal(fetched[0], String(OTHER.lat), 'the flagged cell was not fetched first');

      // Drained: a second run has nothing prioritised and keeps its own order.
      const second = await runWeatherRefresh({
        locations: [LOCATION, OTHER],
        fetchImpl,
        asOf,
      });
      assert.equal(second.prioritized, 0, 'the priority set was not drained');
    });

    it('drops a flagged cell that is no longer any farm’s location', async () => {
      requestPriorityRefresh('1.1,1.1');
      const fetchImpl = providerStub({
        openMeteo: serves(openMeteoBody(asOf)),
        openWeatherMap: serves(owmBody(asOf)),
      });

      const report = await runWeatherRefresh({ locations: [LOCATION], fetchImpl, asOf });

      // The work list is defined by activeLocations, never extended by who asked.
      assert.equal(report.locations, 1);
      assert.equal(report.prioritized, 0);
      assert.equal(fetchImpl.hits(OPEN_METEO_HOST), 1);
    });
  });
});
