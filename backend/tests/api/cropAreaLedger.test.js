/**
 * The land ledger, enforced at the HTTP surface.
 *
 * The sibling suite `services/cropAreaValidation.test.js` proves the rule's
 * arithmetic; this one proves the routes actually invoke it, because the whole
 * point of a server-side rule is that a hand-crafted request cannot go around
 * the form. Every bypass attempted here is one a curl user could try.
 */
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { CropRegistry } from '../../src/models/index.js';
import { startTestServer } from '../helpers/app.js';
import { clearCollections, startTestDatabase, stopTestDatabase } from '../helpers/db.js';

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n) => new Date(Date.now() - n * DAY).toISOString().slice(0, 10);

const FARM_BODY = {
  name: 'Kolar field',
  location: {
    lat: 23.1648,
    lon: 77.4189,
    state: 'Madhya Pradesh',
    district: 'Bhopal',
    source: 'manual',
  },
  sizeValue: 50,
  sizeUnit: 'acre',
  soilType: 'black',
  irrigationMethod: 'canal',
};

const registryEntry = (cropCode, en, hi) => ({
  cropCode,
  names: { en, hi },
  supportLevel: 'SPECIALIZED',
  seasons: ['KHARIF'],
  kcStages: [
    { stage: 'INITIAL', days: 30, kc: 0.35 },
    { stage: 'DEVELOPMENT', days: 50, kc: null },
    { stage: 'MID', days: 60, kc: 1.15 },
    { stage: 'LATE', days: 55, kc: 0.7 },
  ],
});

describe('crop area ledger over HTTP', () => {
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
    await CropRegistry.create(registryEntry('COTTON', 'Cotton', 'कपास'));
    await CropRegistry.create(registryEntry('ONION', 'Onion', 'प्याज'));

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

  const addCrop = async (body) =>
    server.request(`/api/v1/farms/${farmId}/crops`, {
      method: 'POST',
      token,
      body: { sowingDate: daysAgo(30), ...body },
    });

  it('refuses a crop larger than the farm, naming the available ground', async () => {
    const res = await addCrop({ cropCode: 'ONION', areaValue: 60, areaUnit: 'acre' });

    assert.equal(res.status, 422, res.text);
    assert.equal(res.body.error.messageKey, 'crop.areaExceedsFarm');
    assert.deepEqual(res.body.error.details, [
      { field: 'areaValue', rule: 'exceeds_farm_area', availableAcres: 50 },
    ]);
  });

  it('refuses the planting that tips the running total past the farm', async () => {
    const cotton = await addCrop({ cropCode: 'COTTON', areaValue: 30, areaUnit: 'acre' });
    assert.equal(cotton.status, 201, cotton.text);

    const fits = await addCrop({ cropCode: 'ONION', areaValue: 20, areaUnit: 'acre' });
    assert.equal(fits.status, 201, fits.text);

    // The farm is now exactly full: 30 + 20 on 50 acres.
    const overflow = await addCrop({ cropCode: 'ONION', areaValue: 0.5, areaUnit: 'acre' });
    assert.equal(overflow.status, 422, overflow.text);
    assert.equal(overflow.body.error.details[0].rule, 'exceeds_farm_area');
  });

  it('refuses a PATCH that grows a crop past the remaining ground', async () => {
    const cotton = await addCrop({ cropCode: 'COTTON', areaValue: 30, areaUnit: 'acre' });
    const onion = await addCrop({ cropCode: 'ONION', areaValue: 20, areaUnit: 'acre' });
    assert.equal(onion.status, 201, onion.text);

    const res = await server.request(`/api/v1/crops/${cotton.body.data.crop.id}`, {
      method: 'PATCH',
      token,
      body: { areaValue: 31 },
    });

    assert.equal(res.status, 422, res.text);
    assert.equal(res.body.error.messageKey, 'crop.areaExceedsFarm');
    assert.deepEqual(res.body.error.details, [
      { field: 'areaValue', rule: 'exceeds_farm_area', availableAcres: 30 },
    ]);
  });

  it('refuses a unit switch that inflates the area past the farm', async () => {
    const cotton = await addCrop({ cropCode: 'COTTON', areaValue: 30, areaUnit: 'acre' });

    // 30 acre → 30 hectare is 74.1 acres on a 50-acre farm.
    const res = await server.request(`/api/v1/crops/${cotton.body.data.crop.id}`, {
      method: 'PATCH',
      token,
      body: { areaUnit: 'hectare' },
    });

    assert.equal(res.status, 422, res.text);
    assert.equal(res.body.error.details[0].rule, 'exceeds_farm_area');
  });

  it('rejects an area sent without a unit — the ledger never guesses', async () => {
    const res = await addCrop({ cropCode: 'ONION', areaValue: 10 });

    assert.equal(res.status, 422, res.text);
    assert.ok(
      res.body.error.details.some((d) => d.field === 'areaUnit'),
      res.text,
    );
  });

  it('refuses to shrink the farm below its planted area', async () => {
    await addCrop({ cropCode: 'COTTON', areaValue: 30, areaUnit: 'acre' });

    const res = await server.request(`/api/v1/farms/${farmId}`, {
      method: 'PATCH',
      token,
      body: { sizeValue: 20 },
    });

    assert.equal(res.status, 422, res.text);
    assert.equal(res.body.error.messageKey, 'farm.sizeBelowCropArea');
    assert.deepEqual(res.body.error.details, [
      { field: 'sizeValue', rule: 'below_crop_area', allocatedAcres: 30 },
    ]);
  });

  it('frees the ground when a crop is harvested', async () => {
    const cotton = await addCrop({ cropCode: 'COTTON', areaValue: 50, areaUnit: 'acre' });
    assert.equal(cotton.status, 201, cotton.text);

    const blocked = await addCrop({ cropCode: 'ONION', areaValue: 10, areaUnit: 'acre' });
    assert.equal(blocked.status, 422, blocked.text);

    const harvested = await server.request(`/api/v1/crops/${cotton.body.data.crop.id}`, {
      method: 'PATCH',
      token,
      body: { status: 'harvested' },
    });
    assert.equal(harvested.status, 200, harvested.text);

    const nowFits = await addCrop({ cropCode: 'ONION', areaValue: 10, areaUnit: 'acre' });
    assert.equal(nowFits.status, 201, nowFits.text);
  });
});
