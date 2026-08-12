/**
 * Crops API suite (docs/api/crops.md).
 *
 * Ownership behaviour is covered exhaustively by ST-10; this suite covers the
 * product rules — lifecycle transitions, the active-crop cap, the sowing-date
 * window, and the honest handling of a crop the registry has never heard of.
 */
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { MAX_ACTIVE_CROPS_PER_FARM } from '../../src/config/constants.js';
import { CropHealthLog, CropRegistry, IrrigationLog } from '../../src/models/index.js';
import { startTestServer } from '../helpers/app.js';
import { clearCollections, startTestDatabase, stopTestDatabase } from '../helpers/db.js';

const DAY = 24 * 60 * 60 * 1000;
const isoDaysFromNow = (days) => new Date(Date.now() + days * DAY).toISOString().slice(0, 10);

const FARM_BODY = {
  name: 'North field',
  location: { lat: 21.1458, lon: 79.0882, state: 'Maharashtra', district: 'Nagpur', source: 'gps' },
  sizeValue: 2,
  sizeUnit: 'acre',
  soilType: 'black',
  irrigationMethod: 'borewell',
};

/** A minimal registry document, so tests never depend on the real seed. */
const TOMATO = {
  cropCode: 'TOMATO',
  names: { en: 'Tomato', hi: 'टमाटर' },
  supportLevel: 'SPECIALIZED',
  seasons: ['KHARIF', 'RABI'],
  mlSupported: true,
  kcStages: [
    { stage: 'INITIAL', days: 30, kc: 0.6 },
    { stage: 'DEVELOPMENT', days: 40, kc: null },
    { stage: 'MID', days: 40, kc: 1.15 },
    { stage: 'LATE', days: 25, kc: 0.8 },
  ],
};

describe('Crops API', () => {
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
    await CropRegistry.create(TOMATO);

    const registered = await server.request('/api/v1/auth/register', {
      method: 'POST',
      body: {
        name: 'Priya Deshmukh',
        email: 'priya@example.com',
        password: 'a-long-enough-password', // pragma: allowlist-secret — fabricated value, exists only to prove it is never leaked
        language: 'en',
      },
    });
    token = registered.body.data.accessToken;

    const farm = await server.request('/api/v1/farms', {
      method: 'POST',
      token,
      body: FARM_BODY,
    });
    farmId = farm.body.data.farm.id;
  });

  const createCrop = (body) =>
    server.request(`/api/v1/farms/${farmId}/crops`, { method: 'POST', token, body });

  describe('creation', () => {
    it('creates a crop against a known registry code', async () => {
      const res = await createCrop({ cropCode: 'TOMATO', sowingDate: isoDaysFromNow(-40) });

      assert.equal(res.status, 201);
      assert.equal(res.body.data.crop.cropCode, 'TOMATO');
      assert.equal(res.body.data.crop.status, 'active');
      assert.equal(res.body.data.crop.registry.supportLevel, 'SPECIALIZED');
    });

    it('derives the growth stage from the registry Kc timeline', async () => {
      const res = await createCrop({ cropCode: 'TOMATO', sowingDate: isoDaysFromNow(-40) });

      // Day 40 falls inside DEVELOPMENT (days 30..69).
      assert.equal(res.body.data.crop.stage.stage, 'DEVELOPMENT');
      assert.equal(res.body.data.crop.stage.hasVerdict, true);
      assert.ok(res.body.data.crop.stage.trace.length > 0, 'stage carried no trace');
    });

    it('marks a future sowing date as planned', async () => {
      const res = await createCrop({ cropCode: 'TOMATO', sowingDate: isoDaysFromNow(30) });

      assert.equal(res.status, 201);
      assert.equal(res.body.data.crop.status, 'planned');
      assert.equal(res.body.data.crop.stage.hasVerdict, false);
    });

    it('rejects a sowing date outside the accepted window', async () => {
      const tooOld = await createCrop({ cropCode: 'TOMATO', sowingDate: isoDaysFromNow(-500) });
      assert.equal(tooOld.status, 422);
      assert.equal(tooOld.body.error.code, 'VALIDATION_ERROR');

      const tooFar = await createCrop({ cropCode: 'TOMATO', sowingDate: isoDaysFromNow(300) });
      assert.equal(tooFar.status, 422);
    });

    it("records an unknown crop as OTHER with the farmer's own label", async () => {
      const res = await createCrop({
        cropCode: 'DRAGONFRUIT',
        freeTextLabel: 'Dragon fruit',
        sowingDate: isoDaysFromNow(-10),
      });

      assert.equal(res.status, 201);
      // Never blocked, never fabricated: the platform records it honestly and
      // reports that it has no knowledge for it.
      assert.equal(res.body.data.crop.cropCode, 'OTHER');
      assert.equal(res.body.data.crop.freeTextLabel, 'Dragon fruit');
      assert.equal(res.body.data.crop.registry.supportLevel, 'UNSUPPORTED');
    });

    it('will not invent a crop from an unknown code with no label', async () => {
      const res = await createCrop({ cropCode: 'DRAGONFRUIT', sowingDate: isoDaysFromNow(-10) });

      assert.equal(res.status, 422);
      assert.deepEqual(res.body.error.details, [
        { field: 'cropCode', rule: 'unknown_requires_label' },
      ]);
    });

    it(`caps active crops at ${MAX_ACTIVE_CROPS_PER_FARM} per farm`, async () => {
      for (let i = 0; i < MAX_ACTIVE_CROPS_PER_FARM; i += 1) {
        const res = await createCrop({ cropCode: 'TOMATO', sowingDate: isoDaysFromNow(-10) });
        assert.equal(res.status, 201, `crop ${i + 1} was rejected early`);
      }

      const overflow = await createCrop({ cropCode: 'TOMATO', sowingDate: isoDaysFromNow(-10) });
      assert.equal(overflow.status, 409);
      assert.equal(overflow.body.error.code, 'CONFLICT');
    });

    it('counts planned crops against the cap, and re-checks on promotion', async () => {
      // Sowing with a future date creates a `planned` crop. If the ceiling
      // ignored those, a farm could be filled with planned crops and then
      // promote them past the limit one PATCH at a time.
      const created = [];
      for (let i = 0; i < MAX_ACTIVE_CROPS_PER_FARM; i += 1) {
        const res = await createCrop({ cropCode: 'TOMATO', sowingDate: isoDaysFromNow(30) });
        assert.equal(res.status, 201);
        created.push(res.body.data.crop.id);
      }

      // The farm is full of planned crops — a further create must be refused.
      const overflow = await createCrop({ cropCode: 'TOMATO', sowingDate: isoDaysFromNow(-1) });
      assert.equal(overflow.status, 409, 'planned crops were not counted against the cap');

      // Promoting the existing ones is fine: they already hold their slots.
      const promoted = await server.request(`/api/v1/crops/${created[0]}`, {
        method: 'PATCH',
        token,
        body: { status: 'active' },
      });
      assert.equal(promoted.status, 200);
    });

    it('rejects unknown fields rather than silently storing them', async () => {
      const res = await createCrop({
        cropCode: 'TOMATO',
        sowingDate: isoDaysFromNow(-10),
        userId: '0123456789abcdef01234567',
      });

      assert.equal(res.status, 422);
    });
  });

  describe('lifecycle', () => {
    let cropId;

    beforeEach(async () => {
      const res = await createCrop({ cropCode: 'TOMATO', sowingDate: isoDaysFromNow(-40) });
      cropId = res.body.data.crop.id;
    });

    it('allows active → harvested', async () => {
      const res = await server.request(`/api/v1/crops/${cropId}`, {
        method: 'PATCH',
        token,
        body: { status: 'harvested' },
      });

      assert.equal(res.status, 200);
      assert.equal(res.body.data.crop.status, 'harvested');
      // A harvested crop yields no irrigation verdict (rule R1).
      assert.equal(res.body.data.crop.stage.hasVerdict, false);
    });

    it('refuses to move a crop backwards through its lifecycle', async () => {
      await server.request(`/api/v1/crops/${cropId}`, {
        method: 'PATCH',
        token,
        body: { status: 'harvested' },
      });

      const res = await server.request(`/api/v1/crops/${cropId}`, {
        method: 'PATCH',
        token,
        body: { status: 'active' },
      });

      assert.equal(res.status, 422);
      assert.deepEqual(res.body.error.details, [{ field: 'status', rule: 'illegal_transition' }]);
    });

    it('returns the full registry document for a known crop', async () => {
      const res = await server.request(`/api/v1/crops/${cropId}`, { token });

      assert.equal(res.status, 200);
      assert.equal(res.body.data.registry.cropCode, 'TOMATO');
      assert.equal(res.body.data.registry.kcStages.length, 4);
    });

    it('returns null registry knowledge for an OTHER crop rather than a stub', async () => {
      const other = await createCrop({
        cropCode: 'NOPE',
        freeTextLabel: 'Something',
        sowingDate: isoDaysFromNow(-5),
      });
      const res = await server.request(`/api/v1/crops/${other.body.data.crop.id}`, { token });

      assert.equal(res.body.data.registry, null);
    });

    it('cascades logs when a crop is deleted', async () => {
      await IrrigationLog.create({
        userId: (await server.request('/api/v1/auth/me', { token })).body.data.user.id,
        cropId,
        date: new Date(),
        amountMm: 20,
        source: 'farmer',
      });

      const res = await server.request(`/api/v1/crops/${cropId}`, { method: 'DELETE', token });
      assert.equal(res.status, 204);

      assert.equal(await IrrigationLog.countDocuments({ cropId }), 0);
      assert.equal(await CropHealthLog.countDocuments({ cropId }), 0);

      const gone = await server.request(`/api/v1/crops/${cropId}`, { token });
      assert.equal(gone.status, 404);
    });
  });

  describe('listing', () => {
    it("lists a farm's crops with derived stages", async () => {
      await createCrop({ cropCode: 'TOMATO', sowingDate: isoDaysFromNow(-10) });
      await createCrop({ cropCode: 'TOMATO', sowingDate: isoDaysFromNow(-80) });

      const res = await server.request(`/api/v1/farms/${farmId}/crops`, { token });

      assert.equal(res.status, 200);
      assert.equal(res.body.data.crops.length, 2);
      assert.deepEqual(res.body.data.crops.map((crop) => crop.stage.stage).sort(), [
        'INITIAL',
        'MID',
      ]);
    });

    it('serves a crop with no sourced Kc data without failing', async () => {
      // LIMITED crops legitimately have an empty kcStages array until their
      // agronomy is sourced. That must degrade to "no verdict", not a 500.
      await CropRegistry.create({
        cropCode: 'BAJRA',
        names: { en: 'Pearl millet', hi: 'बाजरा' },
        supportLevel: 'LIMITED',
        mlSupported: false,
        kcStages: [],
      });
      await createCrop({ cropCode: 'BAJRA', sowingDate: isoDaysFromNow(-20) });

      const res = await server.request(`/api/v1/farms/${farmId}/crops`, { token });

      assert.equal(res.status, 200);
      const crop = res.body.data.crops.find((entry) => entry.cropCode === 'BAJRA');
      assert.equal(crop.stage.hasVerdict, false);
      assert.ok(crop.stage.reasonCode, 'no reason code explained the absent verdict');
    });
  });
});
