/**
 * Farms API — CRUD, ownership scoping and the location registration hook
 * (docs/api/farms.md, docs/database/validation.md).
 *
 * The suite drives real HTTP against a real mongod with real tokens: the
 * assertions that matter here are about what one account can reach of
 * another's, and only the full stack — auth, loadOwned, the query filter —
 * can answer that honestly.
 */
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Router } from 'express';

import { API_PREFIX, createApp } from '../../src/app.js';
import { MAX_FARMS_PER_USER } from '../../src/config/constants.js';
import {
  Crop,
  CropHealthLog,
  Farm,
  IrrigationLog,
  Recommendation,
} from '../../src/models/index.js';
import { farmsRouter } from '../../src/routes/farms.js';
import { farmInput, registerUser } from '../factories/index.js';
import { startTestServer } from '../helpers/app.js';
import { clearCollections, startTestDatabase, stopTestDatabase } from '../helpers/db.js';

/**
 * Mounted through the app's composition seam so the suite is independent of
 * when the router is wired into app.js; the mount path is the documented one.
 */
const mountFarms = Router();
mountFarms.use(`${API_PREFIX}/farms`, farmsRouter);

const FARMS = `${API_PREFIX}/farms`;

describe('Farms API', () => {
  let server;
  /** @type {{ user: object, accessToken: string }} */
  let alice;
  let bob;

  before(async () => {
    await startTestDatabase();
    server = await startTestServer(createApp({ extraRouters: [mountFarms] }));
  });

  after(async () => {
    await server.close();
    await stopTestDatabase();
  });

  beforeEach(async () => {
    await clearCollections();
    alice = await registerUser(server);
    bob = await registerUser(server);
  });

  /** POST /farms, returning the created farm document from the envelope. */
  const createFarm = async (token, overrides) => {
    const res = await server.request(FARMS, {
      method: 'POST',
      token,
      body: farmInput(overrides),
    });
    assert.equal(res.status, 201, res.text);
    return res.body.data.farm;
  };

  // ── Create ─────────────────────────────────────────────────────────────────

  it('creates a farm owned by the caller', async () => {
    const res = await server.request(FARMS, {
      method: 'POST',
      token: alice.accessToken,
      body: farmInput({ notes: 'Behind the well' }),
    });

    assert.equal(res.status, 201, res.text);
    assert.equal(res.body.success, true);

    const { farm } = res.body.data;
    assert.equal(farm.name, 'North Field');
    assert.equal(farm.soilType, 'black');
    assert.equal(farm.notes, 'Behind the well');
    assert.ok(farm.id);

    const stored = await Farm.findById(farm.id);
    assert.equal(String(stored.userId), alice.user.id);
  });

  it('ignores a client-supplied userId in the body', async () => {
    const res = await server.request(FARMS, {
      method: 'POST',
      token: alice.accessToken,
      body: { ...farmInput(), userId: bob.user.id },
    });

    assert.equal(res.status, 201, res.text);

    const stored = await Farm.findById(res.body.data.farm.id);
    assert.equal(String(stored.userId), alice.user.id);

    const bobsFarms = await Farm.countDocuments({ userId: bob.user.id });
    assert.equal(bobsFarms, 0);
  });

  it('rejects an unknown soil type with 422', async () => {
    const res = await server.request(FARMS, {
      method: 'POST',
      token: alice.accessToken,
      body: farmInput({ soilType: 'volcanic' }),
    });

    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    assert.ok(res.body.error.details.some((detail) => detail.field === 'soilType'));
  });

  it('rejects coordinates outside India with 422', async () => {
    const res = await server.request(FARMS, {
      method: 'POST',
      token: alice.accessToken,
      body: farmInput({
        location: {
          lat: 48.8566,
          lon: 2.3522,
          state: 'Maharashtra',
          district: 'Nagpur',
          source: 'gps',
        },
      }),
    });

    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    assert.ok(res.body.error.details.some((detail) => detail.field === 'location.lat'));
  });

  it('rejects a gps location with no coordinates with 422', async () => {
    const res = await server.request(FARMS, {
      method: 'POST',
      token: alice.accessToken,
      body: farmInput({
        location: { state: 'Maharashtra', district: 'Nagpur', source: 'gps' },
      }),
    });

    assert.equal(res.status, 422);
    assert.ok(res.body.error.details.some((detail) => detail.field === 'location.lat'));
  });

  it('rejects a zero size with 422', async () => {
    const res = await server.request(FARMS, {
      method: 'POST',
      token: alice.accessToken,
      body: farmInput({ sizeValue: 0 }),
    });

    assert.equal(res.status, 422);
    assert.ok(res.body.error.details.some((detail) => detail.field === 'sizeValue'));
  });

  it('rejects a holding above 250 acre-equivalents with 422', async () => {
    // 120 hectare ≈ 296 acre — over the ceiling only after conversion.
    const res = await server.request(FARMS, {
      method: 'POST',
      token: alice.accessToken,
      body: farmInput({ sizeValue: 120, sizeUnit: 'hectare' }),
    });

    assert.equal(res.status, 422);
    assert.deepEqual(res.body.error.details, [{ field: 'sizeValue', rule: 'too_big' }]);

    // The equivalent area under the ceiling is accepted, so the assertion
    // above is about the conversion and not about hectares being rejected.
    const ok = await createFarm(alice.accessToken, { sizeValue: 100, sizeUnit: 'hectare' });
    assert.equal(ok.sizeUnit, 'hectare');
  });

  it(`refuses more than ${MAX_FARMS_PER_USER} farms per user with 409`, async () => {
    for (let i = 0; i < MAX_FARMS_PER_USER; i += 1) {
      await createFarm(alice.accessToken, { name: `Field ${i}` });
    }

    const res = await server.request(FARMS, {
      method: 'POST',
      token: alice.accessToken,
      body: farmInput({ name: 'One too many' }),
    });

    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'CONFLICT');
    assert.equal(res.body.error.messageKey, 'farm.limitReached');

    // The cap is per user, not global.
    await createFarm(bob.accessToken, { name: 'Bob field' });
  });

  // ── Location registration hook ─────────────────────────────────────────────

  it('derives the 0.1° locationKey on create', async () => {
    const farm = await createFarm(alice.accessToken);

    const stored = await Farm.findById(farm.id);
    assert.equal(stored.locationKey, '21.1,79.1');
  });

  it('stores no locationKey for a manual location without coordinates', async () => {
    const farm = await createFarm(alice.accessToken, {
      location: { state: 'Punjab', district: 'Ludhiana', source: 'manual' },
    });

    const stored = await Farm.findById(farm.id);
    assert.equal(stored.locationKey, undefined);
  });

  // ── List ───────────────────────────────────────────────────────────────────

  it('lists only the caller’s farms, with crop counts', async () => {
    const alicesFarm = await createFarm(alice.accessToken, { name: 'Alice field' });
    await createFarm(bob.accessToken, { name: 'Bob field' });

    await Crop.create([
      {
        userId: alice.user.id,
        farmId: alicesFarm.id,
        cropCode: 'WHEAT',
        sowingDate: new Date('2026-01-05'),
      },
      {
        userId: alice.user.id,
        farmId: alicesFarm.id,
        cropCode: 'TOMATO',
        sowingDate: new Date('2026-02-05'),
      },
    ]);

    const res = await server.request(FARMS, { token: alice.accessToken });

    assert.equal(res.status, 200);
    assert.equal(res.body.data.farms.length, 1);
    assert.equal(res.body.data.farms[0].name, 'Alice field');
    assert.equal(res.body.data.farms[0].cropCount, 2);

    const names = res.body.data.farms.map((farm) => farm.name);
    assert.ok(!names.includes('Bob field'));
  });

  it('reports a zero crop count for an empty farm', async () => {
    await createFarm(alice.accessToken);

    const res = await server.request(FARMS, { token: alice.accessToken });
    assert.equal(res.body.data.farms[0].cropCount, 0);
  });

  // ── Read one ───────────────────────────────────────────────────────────────

  it('returns a farm with its crops', async () => {
    const farm = await createFarm(alice.accessToken);
    await Crop.create({
      userId: alice.user.id,
      farmId: farm.id,
      cropCode: 'WHEAT',
      sowingDate: new Date('2026-01-05'),
    });

    const res = await server.request(`${FARMS}/${farm.id}`, { token: alice.accessToken });

    assert.equal(res.status, 200);
    assert.equal(res.body.data.farm.id, farm.id);
    assert.equal(res.body.data.crops.length, 1);
    assert.equal(res.body.data.crops[0].cropCode, 'WHEAT');
  });

  // ── Update ─────────────────────────────────────────────────────────────────

  it('applies a partial update without touching untouched fields', async () => {
    const farm = await createFarm(alice.accessToken);

    const res = await server.request(`${FARMS}/${farm.id}`, {
      method: 'PATCH',
      token: alice.accessToken,
      body: { name: 'Renamed field' },
    });

    assert.equal(res.status, 200, res.text);
    assert.equal(res.body.data.farm.name, 'Renamed field');
    assert.equal(res.body.data.farm.soilType, 'black');
    assert.equal(res.body.data.farm.locationKey, '21.1,79.1');
  });

  it('re-derives the locationKey when the location changes', async () => {
    const farm = await createFarm(alice.accessToken);

    const res = await server.request(`${FARMS}/${farm.id}`, {
      method: 'PATCH',
      token: alice.accessToken,
      body: {
        location: {
          lat: 26.9124,
          lon: 75.7873,
          state: 'Rajasthan',
          district: 'Jaipur',
          source: 'gps',
        },
      },
    });

    assert.equal(res.status, 200, res.text);
    assert.equal(res.body.data.farm.locationKey, '26.9,75.8');

    const stored = await Farm.findById(farm.id);
    assert.equal(stored.locationKey, '26.9,75.8');
    assert.equal(stored.location.district, 'Jaipur');
  });

  it('clears the locationKey when the farm moves to a manual location', async () => {
    const farm = await createFarm(alice.accessToken);

    const res = await server.request(`${FARMS}/${farm.id}`, {
      method: 'PATCH',
      token: alice.accessToken,
      body: { location: { state: 'Punjab', district: 'Ludhiana', source: 'manual' } },
    });

    assert.equal(res.status, 200, res.text);

    const stored = await Farm.findById(farm.id);
    assert.equal(stored.locationKey, undefined);
  });

  it('rejects an invalid patch with 422', async () => {
    const farm = await createFarm(alice.accessToken);

    const res = await server.request(`${FARMS}/${farm.id}`, {
      method: 'PATCH',
      token: alice.accessToken,
      body: { irrigationMethod: 'telepathy' },
    });

    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  });

  it('applies the size ceiling to the merged document, not the patch alone', async () => {
    const farm = await createFarm(alice.accessToken, { sizeValue: 10, sizeUnit: 'hectare' });

    // 120 with the stored unit (hectare) is over the ceiling even though the
    // patch never mentions a unit.
    const res = await server.request(`${FARMS}/${farm.id}`, {
      method: 'PATCH',
      token: alice.accessToken,
      body: { sizeValue: 120 },
    });

    assert.equal(res.status, 422);
    assert.deepEqual(res.body.error.details, [{ field: 'sizeValue', rule: 'too_big' }]);
  });

  // ── Delete + cascade ───────────────────────────────────────────────────────

  it('deletes a farm and cascades its crops, logs and recommendations', async () => {
    const farm = await createFarm(alice.accessToken);
    const crop = await Crop.create({
      userId: alice.user.id,
      farmId: farm.id,
      cropCode: 'WHEAT',
      sowingDate: new Date('2026-01-05'),
    });

    await IrrigationLog.create({
      userId: alice.user.id,
      cropId: crop._id,
      date: new Date('2026-01-20'),
      amountMm: 25,
      source: 'farmer',
    });
    await CropHealthLog.create({
      userId: alice.user.id,
      cropId: crop._id,
      farmId: farm.id,
      imageUrl: 'https://res.cloudinary.example/a.jpg',
      imagePublicId: 'him/a',
      status: 'analyzed',
    });
    await Recommendation.create({
      userId: alice.user.id,
      farmId: farm.id,
      cropId: crop._id,
      type: 'irrigation',
      priority: 'HIGH',
      source: 'RULE_ENGINE',
      titleKey: 'rec.irrigation.title',
      bodyKey: 'rec.irrigation.body',
      validUntil: new Date('2026-12-31'),
      // Required since P2-7: the feed job's idempotent upsert key.
      dedupKey: `${alice.user.id}|irrigation|${crop._id}|IRRIGATE_TODAY|cascade`,
    });

    // A second user's identical tree must survive the cascade untouched.
    const bobsFarm = await createFarm(bob.accessToken, { name: 'Bob field' });
    await Crop.create({
      userId: bob.user.id,
      farmId: bobsFarm.id,
      cropCode: 'WHEAT',
      sowingDate: new Date('2026-01-05'),
    });

    const res = await server.request(`${FARMS}/${farm.id}`, {
      method: 'DELETE',
      token: alice.accessToken,
    });

    assert.equal(res.status, 204);
    assert.equal(res.text, '');

    assert.equal(await Farm.countDocuments({ _id: farm.id }), 0);
    assert.equal(await Crop.countDocuments({ farmId: farm.id }), 0);
    assert.equal(await IrrigationLog.countDocuments({ cropId: crop._id }), 0);
    assert.equal(await CropHealthLog.countDocuments({ farmId: farm.id }), 0);
    assert.equal(await Recommendation.countDocuments({ farmId: farm.id }), 0);

    assert.equal(await Farm.countDocuments({ userId: bob.user.id }), 1);
    assert.equal(await Crop.countDocuments({ userId: bob.user.id }), 1);
  });

  // ── Ownership ──────────────────────────────────────────────────────────────

  it('answers 404 — never 403 — for another user’s farm', async () => {
    const bobsFarm = await createFarm(bob.accessToken, { name: 'Bob field' });

    const cases = [
      { method: 'GET' },
      { method: 'PATCH', body: { name: 'Stolen' } },
      { method: 'DELETE' },
    ];

    for (const { method, body } of cases) {
      const res = await server.request(`${FARMS}/${bobsFarm.id}`, {
        method,
        token: alice.accessToken,
        body,
      });

      assert.equal(res.status, 404, `${method} leaked another user's farm`);
      assert.equal(res.body.error.code, 'NOT_FOUND');
    }

    // Nothing was mutated or removed by the attempts above.
    const stored = await Farm.findById(bobsFarm.id);
    assert.equal(stored.name, 'Bob field');
  });

  it('answers 404 for a malformed id rather than casting it', async () => {
    for (const method of ['GET', 'PATCH', 'DELETE']) {
      const res = await server.request(`${FARMS}/not-an-object-id`, {
        method,
        token: alice.accessToken,
        body: method === 'PATCH' ? { name: 'x' } : undefined,
      });

      assert.equal(res.status, 404, `${method} on a malformed id`);
      assert.equal(res.body.error.code, 'NOT_FOUND');
      assert.ok(!res.text.includes('Cast'), 'leaked a driver cast error');
    }
  });

  it('answers 404 for a well-formed id that belongs to nobody', async () => {
    const res = await server.request(`${FARMS}/6890000000000000000000aa`, {
      token: alice.accessToken,
    });

    assert.equal(res.status, 404);
  });

  // ── Authentication ─────────────────────────────────────────────────────────

  it('requires a token on every route', async () => {
    const farm = await createFarm(alice.accessToken);

    const calls = [
      [FARMS, 'GET'],
      [FARMS, 'POST'],
      [`${FARMS}/${farm.id}`, 'GET'],
      [`${FARMS}/${farm.id}`, 'PATCH'],
      [`${FARMS}/${farm.id}`, 'DELETE'],
    ];

    for (const [path, method] of calls) {
      const res = await server.request(path, {
        method,
        // fetch forbids a body on GET; the bodied methods still carry a valid
        // one so the 401 is about the missing token and nothing else.
        body: method === 'GET' ? undefined : farmInput(),
      });

      assert.equal(res.status, 401, `${method} ${path} was reachable unauthenticated`);
      assert.equal(res.body.error.code, 'AUTHENTICATION_ERROR');
    }

    // A forged token is refused the same way a missing one is.
    const forged = await server.request(FARMS, { token: 'not.a.jwt' });
    assert.equal(forged.status, 401);
  });
});
