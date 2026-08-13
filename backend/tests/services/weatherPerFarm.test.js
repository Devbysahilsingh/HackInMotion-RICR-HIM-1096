/**
 * Weather is bound to a farm's location, and a new farm is not left blank.
 *
 * ## Two regressions this file guards
 *
 * 1. **Cross-farm leakage.** Weather is stored per grid cell, not per farm, so
 *    the lookup that maps a farm to its snapshot is the only thing keeping two
 *    farms apart. If it ever fell back to "any snapshot", every farm in the
 *    country would show the weather of whichever one was written last — and it
 *    would look plausible, because it would still be real weather. These tests
 *    give the two farms deliberately different readings so a leak is loud.
 *
 * 2. **The blank first run.** `activeLocations` builds the refresh job's work
 *    list from farms that already exist, and the job ticks every three hours.
 *    A farmer who had just added their field therefore saw "Not fetched yet"
 *    on the weather screen, and an UNAVAILABLE irrigation verdict with it, for
 *    up to three hours. `warmLocation` closes that window.
 */
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';

import { WEATHER_TTL_MS } from '../../src/config/constants.js';
import { Farm, WeatherSnapshot } from '../../src/models/index.js';
import { farmWeather } from '../../src/services/farmWeatherService.js';
import { activeLocations, warmLocation } from '../../src/services/weatherService.js';
import { deriveLocationKey } from '../../src/utils/locationKey.js';
import { clearCollections, startTestDatabase, stopTestDatabase } from '../helpers/db.js';

/** Two real, valid Indian locations in different 0.1° grid cells. */
const NASHIK = {
  lat: 19.9975,
  lon: 73.7898,
  state: 'Maharashtra',
  district: 'Nashik',
  source: 'manual',
};
const NAGPUR = {
  lat: 21.1458,
  lon: 79.0882,
  state: 'Maharashtra',
  district: 'Nagpur',
  source: 'manual',
};

const makeFarm = (userId, name, location) =>
  Farm.create({
    userId,
    name,
    location,
    locationKey: deriveLocationKey(location),
    sizeValue: 2,
    sizeUnit: 'acre',
    soilType: 'black',
    irrigationMethod: 'drip',
  });

/** A snapshot whose values are distinctive enough that a leak is obvious. */
const seedSnapshot = (locationKey, tMaxC, humidityPct) =>
  WeatherSnapshot.create({
    locationKey,
    source: 'open-meteo',
    status: 'ok',
    fetchedAt: new Date(),
    // Required by the model and read by the freshness rule: a snapshot past
    // `expiresAt` is served as cached rather than live.
    expiresAt: new Date(Date.now() + WEATHER_TTL_MS),
    daily: [
      {
        date: new Date(),
        tMinC: tMaxC - 6,
        tMaxC,
        humidityPct,
        windKmh: 10,
        rainMm: 0,
        rainProbPct: 0,
        et0Mm: 5,
      },
    ],
  });

describe('weather is per farm location', () => {
  let userId;
  let nashikFarm;
  let nagpurFarm;

  before(async () => {
    await startTestDatabase();
  });

  after(async () => {
    await stopTestDatabase();
  });

  beforeEach(async () => {
    await clearCollections();
    userId = new mongoose.Types.ObjectId();
    nashikFarm = await makeFarm(userId, 'North Field', NASHIK);
    nagpurFarm = await makeFarm(userId, 'South Field', NAGPUR);
  });

  it('derives a different cache key for each location', () => {
    assert.notEqual(nashikFarm.locationKey, nagpurFarm.locationKey);
    assert.equal(nashikFarm.locationKey, '20.0,73.8');
    assert.equal(nagpurFarm.locationKey, '21.1,79.1');
  });

  it('serves each farm its own reading and never the other one', async () => {
    await seedSnapshot(nashikFarm.locationKey, 28.1, 85);
    await seedSnapshot(nagpurFarm.locationKey, 32.4, 71);

    const nashik = await farmWeather(nashikFarm);
    const nagpur = await farmWeather(nagpurFarm);

    assert.equal(nashik.daily[0].tMaxC, 28.1, 'Nashik farm shows Nashik weather');
    assert.equal(nashik.daily[0].humidityPct, 85);
    assert.equal(nagpur.daily[0].tMaxC, 32.4, 'Nagpur farm shows Nagpur weather');
    assert.equal(nagpur.daily[0].humidityPct, 71);

    assert.notEqual(
      nashik.daily[0].tMaxC,
      nagpur.daily[0].tMaxC,
      'the two farms must not share a reading',
    );
  });

  it('leaves a farm pending rather than borrowing another cell reading', async () => {
    // Only Nagpur has data. Nashik must report honestly, NOT show Nagpur's.
    await seedSnapshot(nagpurFarm.locationKey, 32.4, 71);

    const nashik = await farmWeather(nashikFarm);

    assert.equal(nashik.freshness.status, 'pending');
    assert.ok(
      !nashik.daily?.length || nashik.daily[0].tMaxC !== 32.4,
      'a farm with no snapshot must never render another cell reading',
    );
  });

  it('lists both grid cells in the refresh work list, deduplicated', async () => {
    // A third farm in the same cell as Nashik must not add a second entry:
    // grid-cell sharing is the whole point of rounding the coordinates.
    await makeFarm(userId, 'Nashik neighbour', { ...NASHIK, lat: 19.9981, lon: 73.7902 });

    const locations = await activeLocations(Farm);
    const keys = locations.map((l) => l.locationKey).sort();

    assert.deepEqual(keys, ['20.0,73.8', '21.1,79.1']);
    for (const entry of locations) {
      assert.ok(entry.lat != null && entry.lon != null, 'every work item carries coordinates');
    }
  });

  describe('warmLocation — the blank first run', () => {
    it('fetches for a cell that has no snapshot yet', async () => {
      const calls = [];
      const fetchImpl = async (url) => {
        calls.push(String(url));
        throw new Error('provider unavailable in test');
      };

      const result = await warmLocation({
        locationKey: nashikFarm.locationKey,
        lat: NASHIK.lat,
        lon: NASHIK.lon,
        fetchImpl,
      });

      assert.equal(result.warmed, false, 'the provider failed, so nothing was stored');
      assert.ok(calls.length > 0, 'but it did try — an empty cell is warmed');
      assert.ok(
        calls.some((u) => u.includes(String(NASHIK.lat).slice(0, 6))),
        `the request used the farm's own latitude: ${calls[0]}`,
      );
    });

    it('does not spend a provider call when the cell is already fresh', async () => {
      await seedSnapshot(nashikFarm.locationKey, 28.1, 85);

      let called = 0;
      const result = await warmLocation({
        locationKey: nashikFarm.locationKey,
        lat: NASHIK.lat,
        lon: NASHIK.lon,
        fetchImpl: async () => {
          called += 1;
          throw new Error('should not be reached');
        },
      });

      assert.equal(result.warmed, false);
      assert.equal(result.reason, 'already_fresh');
      assert.equal(called, 0, 'a fresh cell costs one indexed lookup and no provider call');
    });

    it('is a no-op without coordinates, and never throws', async () => {
      const result = await warmLocation({ locationKey: null, lat: null, lon: null });
      assert.equal(result.warmed, false);
      assert.equal(result.reason, 'no_coordinates');
    });

    it('suppresses the implicit warm under test, but not the explicit one', async () => {
      // The guard exists so API suites that create farms do not make live
      // provider calls and race their own fixtures. It must suppress ONLY the
      // implicit path: an explicit `fetchImpl` still exercises the real logic,
      // which is what every other test in this block relies on.
      const implicit = await warmLocation({
        locationKey: nashikFarm.locationKey,
        lat: NASHIK.lat,
        lon: NASHIK.lon,
      });
      assert.equal(implicit.reason, 'suppressed_in_test');

      let called = 0;
      await warmLocation({
        locationKey: nashikFarm.locationKey,
        lat: NASHIK.lat,
        lon: NASHIK.lon,
        fetchImpl: async () => {
          called += 1;
          throw new Error('provider unavailable in test');
        },
      });
      // Two, not one: a failed primary falls through to the OWM fallback, so
      // both providers are attempted before the warm gives up.
      assert.equal(called, 2, 'an explicit fetchImpl is never suppressed, and both providers try');
    });

    it('swallows provider failure so farm creation can never be affected by it', async () => {
      const result = await warmLocation({
        locationKey: nashikFarm.locationKey,
        lat: NASHIK.lat,
        lon: NASHIK.lon,
        fetchImpl: async () => {
          throw new Error('network down');
        },
      });

      assert.equal(result.warmed, false, 'reported, not thrown');
    });
  });
});
