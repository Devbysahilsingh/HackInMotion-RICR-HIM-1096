/**
 * A farm gets coordinates from the place the farmer knows.
 *
 * ## Why this matters
 *
 * A farmer knows their district. They do not know their latitude. Before this,
 * a farm entered by district alone stored **no** `locationKey`, because
 * `deriveLocationKey` needs numbers — and every location-driven feature keys off
 * that one field. Such a farm was invisible to the weather job's work list, had
 * no weather for ever, and returned a permanently `UNAVAILABLE` irrigation
 * verdict. The app worked only for farmers who accepted the GPS prompt.
 *
 * The resolution runs on the request path, so an *implicit* lookup is
 * suppressed under test and an injected `geocode` is not — the same split
 * weatherService.warmLocation uses. These tests inject, so they exercise the
 * real logic.
 */
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';

import { createFarm } from '../../src/services/farmService.js';
import { clearCollections, startTestDatabase, stopTestDatabase } from '../helpers/db.js';

const BASE = {
  name: 'मेरा खेत',
  sizeValue: 2,
  sizeUnit: 'acre',
  soilType: 'black',
  irrigationMethod: 'drip',
};

/** A stub standing in for the gazetteer. Records what it was asked. */
const stubGeocoder = (place, calls = []) => {
  const fn = async (query) => {
    calls.push(query);
    return place ? { ok: true, place } : { ok: false, reason: 'not_found' };
  };
  fn.calls = calls;
  return fn;
};

const BHOPAL = {
  name: 'Bhopal',
  lat: 23.2547,
  lon: 77.4029,
  state: 'Madhya Pradesh',
  district: 'Bhopal District',
  locality: null,
  source: 'open-meteo-geocoding',
};

describe('farm location resolution', () => {
  let userId;

  before(async () => {
    await startTestDatabase();
  });

  after(async () => {
    await stopTestDatabase();
  });

  beforeEach(async () => {
    await clearCollections();
    userId = new mongoose.Types.ObjectId();
  });

  it('resolves coordinates from a district the farmer typed', async () => {
    const calls = [];
    const farm = await createFarm(
      String(userId),
      {
        ...BASE,
        location: { state: 'Madhya Pradesh', district: 'Bhopal', source: 'manual' },
      },
      { geocode: stubGeocoder(BHOPAL, calls) },
    );

    assert.equal(farm.location.lat, 23.2547);
    assert.equal(farm.location.lon, 77.4029);
    assert.ok(farm.locationKey, 'a locationKey is what makes the farm visible to weather');
    assert.equal(farm.locationKey, '23.3,77.4');
    assert.deepEqual(calls[0], {
      village: undefined,
      district: 'Bhopal',
      state: 'Madhya Pradesh',
    });
  });

  it('passes the village through so a precise place beats a district centre', async () => {
    const calls = [];
    await createFarm(
      String(userId),
      {
        ...BASE,
        location: {
          state: 'Maharashtra',
          district: 'Nashik',
          village: 'Yeola',
          source: 'manual',
        },
      },
      { geocode: stubGeocoder(BHOPAL, calls) },
    );

    assert.equal(calls[0].village, 'Yeola');
  });

  it('marks looked-up coordinates as geocoded, not as a GPS fix', async () => {
    const farm = await createFarm(
      String(userId),
      { ...BASE, location: { state: 'Madhya Pradesh', district: 'Bhopal', source: 'manual' } },
      { geocode: stubGeocoder(BHOPAL) },
    );

    // A gazetteer centroid is kilometres from the field. Recording it as `gps`
    // would claim a precision the app does not have.
    assert.equal(farm.location.source, 'geocoded');
  });

  it('never overwrites device coordinates', async () => {
    const calls = [];
    const farm = await createFarm(
      String(userId),
      {
        ...BASE,
        location: {
          lat: 19.9975,
          lon: 73.7898,
          state: 'Maharashtra',
          district: 'Nashik',
          source: 'gps',
        },
      },
      { geocode: stubGeocoder(BHOPAL, calls) },
    );

    assert.equal(farm.location.lat, 19.9975, 'the GPS fix survives');
    assert.equal(farm.location.source, 'gps');
    assert.equal(calls.length, 0, 'and the gazetteer is never even consulted');
  });

  it("never renames the farmer's own district", async () => {
    // The gazetteer calls it "Bhopal District". The farmer wrote "Bhopal".
    // Their words are what appears on their screen.
    const farm = await createFarm(
      String(userId),
      { ...BASE, location: { state: 'Madhya Pradesh', district: 'Bhopal', source: 'manual' } },
      { geocode: stubGeocoder(BHOPAL) },
    );

    assert.equal(farm.location.district, 'Bhopal');
    assert.equal(farm.location.state, 'Madhya Pradesh');
  });

  it('still creates the farm when the place cannot be found', async () => {
    const farm = await createFarm(
      String(userId),
      {
        ...BASE,
        location: { state: 'Madhya Pradesh', district: 'Nowhere-Xyzzy', source: 'manual' },
      },
      { geocode: stubGeocoder(null) },
    );

    assert.ok(farm._id, 'a farmer is never blocked by a gazetteer miss');
    assert.equal(farm.location.lat, undefined);
    assert.equal(farm.locationKey, undefined, 'and the missing key is honest, not faked');
    assert.equal(farm.location.district, 'Nowhere-Xyzzy');
  });

  it('still creates the farm when the gazetteer throws', async () => {
    const farm = await createFarm(
      String(userId),
      { ...BASE, location: { state: 'West Bengal', district: 'Bardhaman', source: 'manual' } },
      {
        geocode: async () => {
          throw new Error('network down');
        },
      },
    );

    assert.ok(farm._id);
    assert.equal(farm.location.district, 'Bardhaman');
  });

  it('suppresses the implicit lookup under test so suites stay offline', async () => {
    // No `geocode` injected: the guard must stop a live gazetteer call.
    const farm = await createFarm(String(userId), {
      ...BASE,
      location: { state: 'Madhya Pradesh', district: 'Bhopal', source: 'manual' },
    });

    assert.equal(farm.location.lat, undefined);
    assert.equal(farm.locationKey, undefined);
  });
});
