/**
 * Market — the read routes and the nightly ingest.
 *
 * Real mongod, real HTTP, real tokens; the only thing stubbed is the socket to
 * data.gov.in (`fetchImpl`), because the claims under test are about what
 * survives in the database when the portal misbehaves, and only a real upsert
 * against a real unique index can answer that honestly.
 *
 * The resilience case comes from docs/testing/resilience-testing.md:
 *   RES-07  data.gov.in down (nightly) → history serves; job logs failure; no
 *           data loss
 *
 * Every job call passes an explicit `asOf`; there are no fake timers in this
 * project (ADR-022). The read route reads the clock itself — the documented
 * window is "the last N days" — so the price rows it serves are seeded relative
 * to a single instant captured once, at import.
 *
 * Prices, mandi names and registry entries here are fabricated fixtures shaped
 * like the real feed. They are not sourced market data, and the fixture crop
 * names are placeholders rather than translations.
 */
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { API_PREFIX, createApp } from '../../src/app.js';
import { env } from '../../src/config/env.js';
import { runMarketRefresh } from '../../src/jobs/marketRefresh.js';
import { Crop, CropRegistry, MarketPrice } from '../../src/models/index.js';
import { providerCircuit } from '../../src/utils/circuitBreaker.js';
import { farmInput, registerUser } from '../factories/index.js';
import { startTestServer } from '../helpers/app.js';
import { clearCollections, startTestDatabase, stopTestDatabase } from '../helpers/db.js';

const FARMS = `${API_PREFIX}/farms`;
const PRICES = `${API_PREFIX}/market/prices`;
const MY_CROPS = `${API_PREFIX}/market/my-crops`;

const MS_PER_DAY = 86_400_000;

/** One instant for the whole run, so the seeded window never drifts mid-suite. */
const NOW = new Date();
const daysAgo = (days) => new Date(NOW.getTime() - days * MS_PER_DAY);

/** Fixed instant for every job run — the job takes it as a parameter. */
const JOB_ASOF = new Date('2026-08-13T00:00:00.000Z');

/** Fabricated credentials: the job only needs *some* configuration present. */
const DATAGOVIN_TEST_KEY = 'bbbbbbbb22222222bbbbbbbb22222222'; // pragma: allowlist-secret
const DATAGOVIN_TEST_RESOURCE = '00000000-0000-0000-0000-000000000000';

/**
 * Registry fixtures. RICE publishes a commodity code that differs from its crop
 * code — the portal calls the commodity "Paddy" — which is what makes the
 * crop→commodity resolution worth asserting.
 */
const REGISTRY_DOCS = [
  {
    cropCode: 'RICE',
    names: { en: 'Rice', hi: 'Rice' },
    supportLevel: 'SPECIALIZED',
    market: { commodityCode: 'PADDY', aliases: ['Paddy(Dhan)(Common)'] },
  },
  {
    cropCode: 'TOMATO',
    names: { en: 'Tomato', hi: 'Tomato' },
    supportLevel: 'SPECIALIZED',
    market: { commodityCode: 'TOMATO', aliases: ['Tomato'] },
  },
  {
    cropCode: 'ONION',
    names: { en: 'Onion', hi: 'Onion' },
    supportLevel: 'GENERAL',
    market: { commodityCode: 'ONION', aliases: ['Onion'] },
  },
];

/** A stored mandi price row. */
const priceRow = (overrides = {}) => ({
  commodityCode: 'PADDY',
  state: 'Maharashtra',
  district: 'Nagpur',
  market: 'Kalamna',
  date: daysAgo(1),
  minPrice: 1800,
  modalPrice: 2000,
  maxPrice: 2200,
  unit: 'quintal',
  source: 'seed',
  flagged: false,
  fetchedAt: NOW,
  ...overrides,
});

/**
 * Fourteen consecutive days for one mandi, flat for a week and then a fifth
 * higher — enough observations for the engine to reach a verdict.
 */
const risingSeries = (overrides = {}) =>
  Array.from({ length: 14 }, (_, index) =>
    priceRow({
      date: daysAgo(14 - index),
      modalPrice: index < 7 ? 2000 : 2400,
      minPrice: index < 7 ? 1800 : 2200,
      maxPrice: index < 7 ? 2200 : 2600,
      ...overrides,
    }),
  );

/** A row shaped the way data.gov.in publishes them. */
const sourceRow = (overrides = {}) => ({
  state: 'Maharashtra',
  district: 'Nagpur',
  market: 'Kalamna',
  commodity: 'Paddy(Dhan)(Common)',
  variety: 'Common',
  arrival_date: '10/08/2026',
  min_price: '1800',
  modal_price: '2000',
  max_price: '2200',
  ...overrides,
});

/** A stub that fails every request, recording each attempt. */
function providerDown() {
  const calls = [];
  const impl = async (url) => {
    calls.push(url);
    throw new TypeError('fetch failed');
  };
  impl.calls = calls;
  return impl;
}

/** Comparable snapshot of the whole collection, ordered deterministically. */
const priceSnapshot = async () => {
  const rows = await MarketPrice.find({}).sort({ commodityCode: 1, market: 1, date: 1 }).lean();
  return rows.map((row) => JSON.stringify(row));
};

describe('Market API and nightly ingest', () => {
  let server;
  let alice;
  let bob;

  before(async () => {
    await startTestDatabase();
    server = await startTestServer(createApp());
  });

  after(async () => {
    await server.close();
    await stopTestDatabase();
  });

  beforeEach(async () => {
    await clearCollections();
    // The breaker is process-wide by design; without this a suite that trips it
    // would leak "circuit_open" into every later case.
    providerCircuit.reset();
    await CropRegistry.insertMany(REGISTRY_DOCS);
    alice = await registerUser(server);
    bob = await registerUser(server);
  });

  const createFarm = async (token, overrides) => {
    const res = await server.request(FARMS, { method: 'POST', token, body: farmInput(overrides) });
    assert.equal(res.status, 201, res.text);
    return res.body.data.farm;
  };

  const plantCrop = (owner, farm, overrides = {}) =>
    Crop.create({
      userId: owner.user.id,
      farmId: farm.id,
      cropCode: 'RICE',
      sowingDate: daysAgo(40),
      status: 'active',
      ...overrides,
    });

  // ── GET /market/prices ─────────────────────────────────────────────────────

  describe('GET /market/prices', () => {
    it('requires a token', async () => {
      const res = await server.request(`${PRICES}?commodity=RICE`);

      assert.equal(res.status, 401);
      assert.equal(res.body.error.code, 'AUTHENTICATION_ERROR');
    });

    it('rejects a request with no commodity', async () => {
      const res = await server.request(PRICES, { token: alice.accessToken });

      assert.equal(res.status, 422);
      assert.equal(res.body.error.code, 'VALIDATION_ERROR');
      assert.ok(res.body.error.details.some((detail) => detail.field === 'commodity'));
    });

    it('answers 404 for a commodity the registry does not map', async () => {
      const res = await server.request(`${PRICES}?commodity=BANANA`, { token: alice.accessToken });

      assert.equal(res.status, 404);
      assert.equal(res.body.error.code, 'NOT_FOUND');
      assert.equal(res.body.error.messageKey, 'market.commodityNotFound');
    });

    it('answers 200 with a series, a signal and freshness for a mapped commodity', async () => {
      await MarketPrice.insertMany(risingSeries());

      // Queried by crop code; the rows are stored under the commodity code.
      const res = await server.request(`${PRICES}?commodity=rice`, { token: alice.accessToken });

      assert.equal(res.status, 200, res.text);
      assert.equal(res.body.success, true);

      const { series, signal, freshness } = res.body.data;

      assert.equal(series.length, 14);
      assert.equal(series[0].market, 'Kalamna');
      assert.equal(series[0].modalPrice, 2000);
      assert.equal(series.at(-1).modalPrice, 2400);
      assert.equal(series[0].adjusted, false);
      // The stored flag is published as `adjusted`; the raw field never leaks.
      assert.ok(!res.text.includes('flagged'));

      assert.equal(signal.trend, 'RISING');
      assert.equal(signal.changePct7d, 20);
      assert.equal(signal.changePct30d, null);
      assert.equal(signal.guidanceKey, 'market.guidanceRising');
      assert.equal(signal.reasonCode, 'OK');
      // R12: the numbers behind the verdict travel with it.
      assert.ok(Array.isArray(signal.trace));
      assert.deepEqual(
        signal.trace.map((entry) => entry.step),
        ['INPUT', 'SERIES', 'WINDOWS', 'VERDICT'],
      );

      assert.ok(freshness.latestDate);
      assert.equal(typeof freshness.ageDays, 'number');
    });

    it('gives no trend, and says why, when there are too few observations', async () => {
      await MarketPrice.insertMany(risingSeries().slice(0, 5));

      const res = await server.request(`${PRICES}?commodity=RICE`, { token: alice.accessToken });

      assert.equal(res.status, 200, res.text);
      assert.equal(res.body.data.signal.trend, null);
      assert.equal(res.body.data.signal.reasonCode, 'INSUFFICIENT_OBSERVATIONS');
      assert.equal(res.body.data.signal.guidanceKey, 'market.guidanceUnavailable');
    });

    it('answers 200 with an empty series when the commodity has no prices yet', async () => {
      const res = await server.request(`${PRICES}?commodity=TOMATO`, { token: alice.accessToken });

      assert.equal(res.status, 200, res.text);
      assert.deepEqual(res.body.data.series, []);
      assert.equal(res.body.data.signal.reasonCode, 'NO_OBSERVATIONS');
      assert.equal(res.body.data.freshness.status, 'historical');
      assert.equal(res.body.data.freshness.latestDate, null);
    });

    it('caps the window at 90 days', async () => {
      const tooLong = await server.request(`${PRICES}?commodity=RICE&days=91`, {
        token: alice.accessToken,
      });

      assert.equal(tooLong.status, 422);
      assert.equal(tooLong.body.error.code, 'VALIDATION_ERROR');
      assert.ok(tooLong.body.error.details.some((detail) => detail.field === 'days'));

      const atCap = await server.request(`${PRICES}?commodity=RICE&days=90`, {
        token: alice.accessToken,
      });
      assert.equal(atCap.status, 200, atCap.text);
    });

    it('rejects a non-positive or unknown query parameter', async () => {
      for (const query of [
        'commodity=RICE&days=0',
        'commodity=RICE&days=abc',
        'commodity=RICE&x=1',
      ]) {
        const res = await server.request(`${PRICES}?${query}`, { token: alice.accessToken });
        assert.equal(res.status, 422, `accepted ?${query}`);
      }
    });

    it('narrows to a district when one is given', async () => {
      await MarketPrice.insertMany(risingSeries());
      await MarketPrice.insertMany([
        priceRow({ district: 'Wardha', market: 'Wardha Mandi', date: daysAgo(2) }),
      ]);

      const all = await server.request(`${PRICES}?commodity=RICE`, { token: alice.accessToken });
      const nagpur = await server.request(`${PRICES}?commodity=RICE&district=Nagpur`, {
        token: alice.accessToken,
      });

      assert.equal(all.body.data.series.length, 15);
      assert.equal(nagpur.body.data.series.length, 14);
    });

    // ── Freshness labelling (rule 9) ────────────────────────────────────────

    it('labels an all-seed series historical', async () => {
      await MarketPrice.insertMany(risingSeries());

      const res = await server.request(`${PRICES}?commodity=RICE`, { token: alice.accessToken });

      assert.equal(res.body.data.freshness.status, 'historical');
      assert.equal(res.body.data.freshness.source, 'seed');
    });

    it('labels a series cached as soon as one row came from the portal', async () => {
      await MarketPrice.insertMany(risingSeries());
      await MarketPrice.create(
        priceRow({ market: 'Katol', date: daysAgo(0), source: 'datagovin' }),
      );

      const res = await server.request(`${PRICES}?commodity=RICE`, { token: alice.accessToken });

      assert.equal(res.body.data.freshness.status, 'cached');
      assert.equal(res.body.data.freshness.source, 'datagovin');
    });

    it('surfaces a clamped modal price as adjusted rather than passing it off as published', async () => {
      await MarketPrice.insertMany(risingSeries());
      await MarketPrice.create(
        priceRow({ market: 'Katol', date: daysAgo(0), modalPrice: 1800, flagged: true }),
      );

      const res = await server.request(`${PRICES}?commodity=RICE`, { token: alice.accessToken });
      const { series } = res.body.data;
      const adjusted = series.filter((point) => point.adjusted);

      assert.equal(adjusted.length, 1);
      assert.equal(adjusted[0].market, 'Katol');
      assert.equal(series.filter((point) => point.adjusted === false).length, 14);
    });
  });

  // ── GET /market/my-crops ───────────────────────────────────────────────────

  describe('GET /market/my-crops', () => {
    it('requires a token', async () => {
      const res = await server.request(MY_CROPS);

      assert.equal(res.status, 401);
      assert.equal(res.body.error.code, 'AUTHENTICATION_ERROR');
    });

    it('returns an empty list when the caller grows nothing', async () => {
      const res = await server.request(MY_CROPS, { token: alice.accessToken });

      assert.equal(res.status, 200, res.text);
      assert.deepEqual(res.body.data.crops, []);
      assert.equal(res.body.meta.total, 0);
    });

    it('returns a signal per active crop, with the commodity the registry maps', async () => {
      await MarketPrice.insertMany(risingSeries());
      const farm = await createFarm(alice.accessToken);
      await plantCrop(alice, farm);

      const res = await server.request(MY_CROPS, { token: alice.accessToken });

      assert.equal(res.status, 200, res.text);
      assert.equal(res.body.data.crops.length, 1);

      const [entry] = res.body.data.crops;
      assert.equal(entry.cropCode, 'RICE');
      assert.equal(entry.commodityCode, 'PADDY');
      assert.equal(entry.state, 'Maharashtra');
      assert.equal(entry.district, 'Nagpur');
      assert.equal(entry.signal.trend, 'RISING');
      assert.equal(entry.signal.guidanceKey, 'market.guidanceRising');
      assert.equal(entry.freshness.status, 'historical');
      // The dashboard card needs no series, so none is sent.
      assert.equal(entry.series, undefined);
    });

    it('never shows another account’s crops', async () => {
      const aliceFarm = await createFarm(alice.accessToken);
      await plantCrop(alice, aliceFarm, { cropCode: 'RICE' });

      const bobFarm = await createFarm(bob.accessToken, { name: 'Bob field' });
      await plantCrop(bob, bobFarm, { cropCode: 'ONION' });

      const res = await server.request(MY_CROPS, { token: alice.accessToken });
      const codes = res.body.data.crops.map((entry) => entry.cropCode);

      assert.deepEqual(codes, ['RICE']);
      assert.ok(!codes.includes('ONION'), 'another account’s crop leaked into the response');
      assert.ok(!res.text.includes('ONION'));

      // And the reverse direction, so the filter is not simply dropping rows.
      const bobRes = await server.request(MY_CROPS, { token: bob.accessToken });
      assert.deepEqual(
        bobRes.body.data.crops.map((entry) => entry.cropCode),
        ['ONION'],
      );
    });

    it('excludes planned and harvested crops', async () => {
      const farm = await createFarm(alice.accessToken);
      await plantCrop(alice, farm, { cropCode: 'RICE', status: 'active' });
      await plantCrop(alice, farm, { cropCode: 'TOMATO', status: 'planned' });
      await plantCrop(alice, farm, { cropCode: 'ONION', status: 'harvested' });

      const res = await server.request(MY_CROPS, { token: alice.accessToken });

      assert.deepEqual(
        res.body.data.crops.map((entry) => entry.cropCode),
        ['RICE'],
      );
    });

    it('orders the cards deterministically', async () => {
      const farm = await createFarm(alice.accessToken);
      await plantCrop(alice, farm, { cropCode: 'TOMATO' });
      await plantCrop(alice, farm, { cropCode: 'RICE' });
      await plantCrop(alice, farm, { cropCode: 'ONION' });

      const first = await server.request(MY_CROPS, { token: alice.accessToken });
      const second = await server.request(MY_CROPS, { token: alice.accessToken });

      const codes = (res) => res.body.data.crops.map((entry) => entry.cropCode);
      assert.deepEqual(codes(first), ['ONION', 'RICE', 'TOMATO']);
      assert.deepEqual(codes(second), codes(first));
      assert.equal(first.body.meta.total, 3);
    });

    it('collapses several plantings of one crop in one district into a single card', async () => {
      const farm = await createFarm(alice.accessToken);
      const one = await plantCrop(alice, farm);
      const two = await plantCrop(alice, farm, { sowingDate: daysAgo(20) });

      const res = await server.request(MY_CROPS, { token: alice.accessToken });

      assert.equal(res.body.data.crops.length, 1);
      assert.deepEqual(
        res.body.data.crops[0].cropIds.sort(),
        [String(one._id), String(two._id)].sort(),
      );
    });
  });

  // ── RES-07 · data.gov.in down ─────────────────────────────────────────────

  describe('RES-07 · the portal is down at nightly refresh', () => {
    /**
     * The job reads `env.DATAGOVIN_*`, and `env` is parsed once at import time —
     * setting `process.env` from a test body would run after that parse and
     * change nothing. So the already-validated config object is what gets a
     * value here, and it is restored afterwards.
     */
    before(() => {
      env.DATAGOVIN_API_KEY = DATAGOVIN_TEST_KEY;
      env.DATAGOVIN_RESOURCE_ID = DATAGOVIN_TEST_RESOURCE;
    });

    after(() => {
      env.DATAGOVIN_API_KEY = undefined;
      env.DATAGOVIN_RESOURCE_ID = undefined;
    });

    it('logs the failure, writes nothing, deletes nothing and keeps serving history', async () => {
      // The work list takes its states from the farms that exist.
      await createFarm(alice.accessToken);
      await MarketPrice.insertMany(risingSeries());
      const before = await priceSnapshot();
      assert.equal(before.length, 14);

      const fetchImpl = providerDown();
      const report = await runMarketRefresh({ asOf: JOB_ASOF, fetchImpl });

      // The failure is recorded rather than swallowed.
      //
      // One entry per (state, commodity) attempt: the job fetches per
      // commodity so the drop-rate guard measures schema drift rather than
      // scope, which means a total outage reports every attempt it made
      // instead of one line per state. What RES-07 actually requires is that
      // the failure is recorded, attributed and not swallowed — asserted on
      // shape rather than on an exact list, so adding a crop to the registry
      // does not break this test.
      assert.equal(report.ok, false);
      assert.ok(report.failures.length > 0, 'the outage was not recorded');
      for (const failure of report.failures) {
        assert.equal(failure.reason, 'network');
        assert.equal(failure.state, 'Maharashtra');
        assert.equal(typeof failure.commodity, 'string');
      }
      assert.equal(report.aborted, false);
      assert.equal(report.inserted, 0);
      assert.equal(report.duplicates, 0);
      assert.equal(report.purged, 0);
      assert.equal(report.fetched, 0);
      assert.ok(fetchImpl.calls.length >= 1, 'the provider was never actually attempted');

      // No data loss: the collection is byte-identical.
      const after = await priceSnapshot();
      assert.equal(await MarketPrice.countDocuments({}), 14);
      assert.deepEqual(after, before);

      // History serves.
      const res = await server.request(`${PRICES}?commodity=RICE`, { token: alice.accessToken });
      assert.equal(res.status, 200, res.text);
      assert.equal(res.body.data.series.length, 14);
      assert.equal(res.body.data.freshness.status, 'historical');
      assert.equal(res.body.data.signal.trend, 'RISING');
    });
  });

  // ── Configuration, idempotency and the drop-rate guard ────────────────────

  describe('runMarketRefresh', () => {
    it('skips honestly when the portal is not configured, naming both variables', async () => {
      await createFarm(alice.accessToken);
      // Old enough that a purge would remove it — proof the purge did not run.
      await MarketPrice.insertMany([
        priceRow({ date: new Date(JOB_ASOF.getTime() - 250 * MS_PER_DAY), market: 'Ancient' }),
        ...risingSeries(),
      ]);
      const before = await priceSnapshot();

      const fetchImpl = providerDown();
      const report = await runMarketRefresh({ asOf: JOB_ASOF, fetchImpl });

      assert.equal(report.skipped, 'not_configured');
      assert.equal(report.ok, false);
      assert.deepEqual(report.missingConfig, ['DATAGOVIN_API_KEY', 'DATAGOVIN_RESOURCE_ID']);
      assert.equal(fetchImpl.calls.length, 0, 'a keyless run still reached the provider');

      assert.equal(report.inserted, 0);
      assert.equal(report.purged, 0);
      assert.deepEqual(await priceSnapshot(), before);
      assert.equal(await MarketPrice.countDocuments({ market: 'Ancient' }), 1);
    });

    it('is idempotent: a second run upserts rather than duplicating', async () => {
      const records = [
        sourceRow({ arrival_date: '10/08/2026' }),
        sourceRow({ arrival_date: '11/08/2026' }),
        sourceRow({ market: 'Katol', arrival_date: '11/08/2026' }),
      ];

      const first = await runMarketRefresh({ asOf: JOB_ASOF, records });

      assert.equal(first.ok, true);
      assert.equal(first.aborted, false);
      assert.equal(first.fetched, 3);
      assert.equal(first.inserted, 3);
      assert.equal(first.duplicates, 0);
      assert.equal(await MarketPrice.countDocuments({}), 3);

      const second = await runMarketRefresh({ asOf: JOB_ASOF, records });

      assert.equal(second.inserted, 0);
      assert.ok(second.duplicates > 0);
      assert.equal(second.duplicates, 3);
      assert.equal(
        await MarketPrice.countDocuments({}),
        3,
        'the re-run duplicated rows instead of upserting',
      );

      const stored = await MarketPrice.findOne({ market: 'Katol' }).lean();
      assert.equal(stored.commodityCode, 'PADDY');
      assert.equal(stored.source, 'datagovin');
      assert.equal(stored.unit, 'quintal');
      assert.equal(stored.modalPrice, 2000);
    });

    it('records a clamped modal price as flagged when it persists one', async () => {
      const report = await runMarketRefresh({
        asOf: JOB_ASOF,
        records: [sourceRow({ modal_price: '1500' })],
      });

      assert.equal(report.flagged, 1);
      const stored = await MarketPrice.findOne({}).lean();
      assert.equal(stored.flagged, true);
      assert.equal(stored.modalPrice, 1800);
    });

    it('aborts the batch and writes nothing when the drop rate exceeds 30%', async () => {
      const records = [
        ...Array.from({ length: 6 }, (_, index) =>
          sourceRow({ market: `Mandi ${index}`, arrival_date: '10/08/2026' }),
        ),
        ...Array.from({ length: 4 }, (_, index) =>
          sourceRow({ commodity: `Unmapped Crop ${index}` }),
        ),
      ];

      const report = await runMarketRefresh({ asOf: JOB_ASOF, records });

      assert.equal(report.aborted, true);
      assert.equal(report.ok, false);
      assert.equal(report.fetched, 10);
      assert.equal(report.dropped.unmapped, 4);
      assert.equal(report.dropRate, 0.4);
      assert.equal(report.unmappedSamples.length, 4);
      assert.equal(report.inserted, 0);
      assert.equal(report.purged, 0);
      assert.equal(
        await MarketPrice.countDocuments({}),
        0,
        'an aborted batch still wrote rows to history',
      );
    });

    it('accepts a batch that drops rows below the abort threshold', async () => {
      const records = [
        ...Array.from({ length: 9 }, (_, index) =>
          sourceRow({ market: `Mandi ${index}`, arrival_date: '10/08/2026' }),
        ),
        sourceRow({ commodity: 'Unmapped Crop' }),
      ];

      const report = await runMarketRefresh({ asOf: JOB_ASOF, records });

      assert.equal(report.aborted, false);
      assert.equal(report.dropRate, 0.1);
      assert.equal(report.inserted, 9);
      assert.equal(await MarketPrice.countDocuments({}), 9);
    });
  });
});
