/**
 * `GET /farms/:id` must serve fully decorated crops.
 *
 * ## The regression this file exists for
 *
 * The farm detail screen renders `crop.registry.names` and `crop.stage.stage`
 * for every crop on the field. `GET /crops/:id` and the crop-creation response
 * both returned those keys, but `GET /farms/:id` returned bare crop rows —
 * `farmService.farmWithCrops` mapped straight through `crop.toJSON()` while the
 * decorator lived privately inside `routes/crops.js`. The result was a
 * TypeError on first render, caught by the error boundary, so **the farm detail
 * page was blank for any farm that had a crop** — which is every farm a real
 * farmer creates.
 *
 * Nothing in the suite caught it because the crop routes were tested through
 * their own endpoints, where the decoration was present. This file asserts the
 * shape at the endpoint the screen actually calls, and asserts it stays equal
 * to the shape the crop endpoints return, so the two cannot drift apart again.
 */
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { CropRegistry } from '../../src/models/index.js';
import { startTestServer } from '../helpers/app.js';
import { clearCollections, startTestDatabase, stopTestDatabase } from '../helpers/db.js';

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n) => new Date(Date.now() - n * DAY).toISOString().slice(0, 10);

const FARM_BODY = {
  name: 'North field',
  location: {
    lat: 19.9975,
    lon: 73.7898,
    state: 'Maharashtra',
    district: 'Nashik',
    source: 'manual',
  },
  sizeValue: 2.5,
  sizeUnit: 'acre',
  soilType: 'black',
  irrigationMethod: 'drip',
};

/** Minimal registry documents, so the suite never depends on the real seed. */
const COTTON = {
  cropCode: 'COTTON',
  names: { en: 'Cotton', hi: 'कपास' },
  supportLevel: 'SPECIALIZED',
  seasons: ['KHARIF'],
  kcStages: [
    { stage: 'INITIAL', days: 30, kc: 0.35 },
    { stage: 'DEVELOPMENT', days: 50, kc: null },
    { stage: 'MID', days: 60, kc: 1.15 },
    { stage: 'LATE', days: 55, kc: 0.7 },
  ],
};
const MAIZE = {
  cropCode: 'MAIZE',
  names: { en: 'Maize', hi: 'मक्का' },
  supportLevel: 'SPECIALIZED',
  seasons: ['KHARIF', 'RABI'],
  kcStages: [
    { stage: 'INITIAL', days: 20, kc: 0.3 },
    { stage: 'DEVELOPMENT', days: 35, kc: null },
    { stage: 'MID', days: 40, kc: 1.2 },
    { stage: 'LATE', days: 30, kc: 0.6 },
  ],
};

describe('GET /farms/:id — crop decoration', () => {
  let server;
  let token;
  let farmId;

  before(async () => {
    await startTestDatabase();
    server = await startTestServer();
  });

  after(async () => {
    await server.close();
    await stopTestDatabase();
  });

  beforeEach(async () => {
    await clearCollections();
    await CropRegistry.create(COTTON);
    await CropRegistry.create(MAIZE);

    const registered = await server.request('/api/v1/auth/register', {
      method: 'POST',
      body: {
        name: 'Ramesh Patil',
        email: 'ramesh@example.com',
        password: 'a-long-enough-password', // pragma: allowlist-secret — fabricated, proves only that it never leaks
        language: 'en',
      },
    });
    assert.equal(registered.status, 201, registered.text);
    token = registered.body.data.accessToken;

    const farm = await server.request('/api/v1/farms', { method: 'POST', token, body: FARM_BODY });
    assert.equal(farm.status, 201, farm.text);
    farmId = farm.body.data.farm.id;
  });

  const addCrop = async (cropCode, days) => {
    const res = await server.request(`/api/v1/farms/${farmId}/crops`, {
      method: 'POST',
      token,
      body: { cropCode, sowingDate: daysAgo(days), areaValue: 1, areaUnit: 'acre' },
    });
    assert.equal(res.status, 201, res.text);
    return res.body.data.crop;
  };

  it('returns registry and stage on every crop — the keys the screen dereferences', async () => {
    await addCrop('COTTON', 60);
    await addCrop('MAIZE', 54);

    const res = await server.request(`/api/v1/farms/${farmId}`, { token });
    assert.equal(res.status, 200, res.text);

    const { crops } = res.body.data;
    assert.equal(crops.length, 2);

    for (const crop of crops) {
      // `crop.registry.names` — FarmDetailPage reads this for the heading.
      assert.ok(crop.registry, `${crop.cropCode}: registry missing`);
      assert.ok(crop.registry.names, `${crop.cropCode}: registry.names missing`);
      assert.ok(crop.registry.supportLevel, `${crop.cropCode}: supportLevel missing`);

      // `crop.stage.stage` — FarmDetailPage reads this for the stage badge.
      assert.ok(crop.stage, `${crop.cropCode}: stage missing`);
      assert.ok('stage' in crop.stage, `${crop.cropCode}: stage.stage missing`);

      assert.ok(crop.id, 'crop.id is the React key and the detail link');
    }
  });

  it('serves the same crop shape as GET /crops/:id', async () => {
    const created = await addCrop('COTTON', 60);

    const viaFarm = await server.request(`/api/v1/farms/${farmId}`, { token });
    const viaCrop = await server.request(`/api/v1/crops/${created.id}`, { token });

    const fromFarm = viaFarm.body.data.crops[0];
    const fromCrop = viaCrop.body.data.crop;

    // The wire contract for a crop is one shape. If these diverge, one of the
    // two screens is about to break.
    assert.deepEqual(
      Object.keys(fromFarm).sort(),
      Object.keys(fromCrop).sort(),
      'farm detail and crop detail disagree on the crop shape',
    );
    assert.deepEqual(fromFarm.registry, fromCrop.registry);
    assert.equal(fromFarm.stage.stage, fromCrop.stage.stage);
  });

  it('decorates a free-text crop rather than omitting the keys', async () => {
    // An unknown code is stored as `OTHER` with the farmer's label kept
    // (registry-driven, rule 4 — codes are never invented). It still renders on
    // the farm page, and an undefined `registry` would crash it exactly as the
    // original bug did.
    const res = await server.request(`/api/v1/farms/${farmId}/crops`, {
      method: 'POST',
      token,
      body: { cropCode: 'DRAGONFRUIT', freeTextLabel: 'Dragon fruit', sowingDate: daysAgo(10) },
    });
    assert.equal(res.status, 201, res.text);
    assert.equal(res.body.data.crop.cropCode, 'OTHER');
    assert.equal(res.body.data.crop.freeTextLabel, 'Dragon fruit');

    const farm = await server.request(`/api/v1/farms/${farmId}`, { token });
    const crop = farm.body.data.crops.find((c) => c.cropCode === 'OTHER');

    assert.ok(crop, 'the free-text crop is still listed');
    assert.equal(crop.freeTextLabel, 'Dragon fruit', 'the label the screen falls back to');
    assert.ok(crop.registry, 'registry key present even with no registry entry');
    assert.equal(crop.registry.supportLevel, 'UNSUPPORTED');
    assert.equal(crop.registry.names, null);
    assert.ok(crop.stage, 'stage key present even with no Kc data');
  });

  it('returns an empty crops array for a farm with no crops', async () => {
    const res = await server.request(`/api/v1/farms/${farmId}`, { token });

    assert.equal(res.status, 200, res.text);
    assert.deepEqual(res.body.data.crops, []);
    assert.ok(res.body.data.farm.id);
  });
});
