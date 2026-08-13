/**
 * ST-10 — Authorization matrix [blocking].
 *
 * docs/security/security-testing.md, verbatim:
 *   "generated per protected endpoint — 401 (no token), 404 (other-user
 *    resource), list scoping, nested-chain checks (crop of other's farm)."
 *
 * The matrix is generated from src/routes/ownership-table.js rather than
 * hand-listed, so a protected route added without a row there fails this suite
 * instead of shipping untested.
 */
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { Recommendation } from '../../src/models/index.js';
import { addressableRoutes, protectedRoutes } from '../../src/routes/ownership-table.js';
import { startTestServer } from '../helpers/app.js';
import { clearCollections, startTestDatabase, stopTestDatabase } from '../helpers/db.js';

/** Valid payloads, so a route rejects on ownership rather than on validation. */
const SAMPLE_BODIES = {
  'POST /api/v1/farms/:farmId/crops': {
    cropCode: 'OTHER',
    freeTextLabel: 'x',
    sowingDate: '2026-07-01',
  },
  'PATCH /api/v1/farms/:id': { name: 'Renamed' },
  'PATCH /api/v1/crops/:id': { variety: 'Renamed' },
};

const FARM_BODY = {
  name: 'North field',
  location: { lat: 21.1458, lon: 79.0882, state: 'Maharashtra', district: 'Nagpur', source: 'gps' },
  sizeValue: 2,
  sizeUnit: 'acre',
  soilType: 'black',
  irrigationMethod: 'borewell',
};

const NON_EXISTENT_ID = '0123456789abcdef01234567';

describe('ST-10 · Authorization matrix', () => {
  let server;
  /** @type {{ token: string, farmId: string, cropId: string }} */
  let alice;
  let mallory;

  before(async () => {
    await startTestDatabase();
    server = await startTestServer();
  });

  after(async () => {
    await server.close();
    await stopTestDatabase();
  });

  /** Registers a farmer and gives them one farm holding one crop. */
  async function seedFarmer(email) {
    const registered = await server.request('/api/v1/auth/register', {
      method: 'POST',
      body: { name: 'Test Farmer', email, password: 'a-long-enough-password', language: 'en' }, // pragma: allowlist-secret — fabricated value, exists only to prove it is never leaked
    });
    assert.equal(registered.status, 201, `could not register ${email}`);
    const token = registered.body.data.accessToken;

    const farm = await server.request('/api/v1/farms', {
      method: 'POST',
      token,
      body: FARM_BODY,
    });
    assert.equal(farm.status, 201, `could not create a farm for ${email}: ${farm.text}`);
    const farmId = farm.body.data.farm.id;

    const crop = await server.request(`/api/v1/farms/${farmId}/crops`, {
      method: 'POST',
      token,
      body: { cropCode: 'OTHER', freeTextLabel: 'Millet', sowingDate: '2026-07-01' },
    });
    assert.equal(crop.status, 201, `could not create a crop for ${email}: ${crop.text}`);
    const cropId = crop.body.data.crop.id;

    // Feed items are written by a job, never by a client, so this one is
    // inserted directly. It exists so the matrix can prove that another
    // farmer's recommendation id is a 404 on the acknowledge route.
    const me = await server.request('/api/v1/auth/me', { token });
    const userId = me.body.data.user.id;

    const recommendation = await Recommendation.create({
      userId,
      farmId,
      cropId,
      type: 'irrigation',
      priority: 'HIGH',
      source: 'RULE_ENGINE',
      titleKey: 'irrigation.titleIRRIGATE_TODAY',
      bodyKey: 'irrigation.bodyIRRIGATE_TODAY',
      data: { verdict: 'IRRIGATE_TODAY' },
      validUntil: new Date(Date.now() + 24 * 60 * 60 * 1000),
      dedupKey: `${userId}|irrigation|${cropId}|IRRIGATE_TODAY|st10`,
    });

    return { token, farmId, cropId, recommendationId: String(recommendation._id) };
  }

  beforeEach(async () => {
    await clearCollections();
    alice = await seedFarmer('alice@example.com');
    mallory = await seedFarmer('mallory@example.com');
  });

  /** Maps a route table row's `resource` to the seeded id it addresses. */
  const idFor = (actor, resource) =>
    ({
      farm: actor.farmId,
      crop: actor.cropId,
      recommendation: actor.recommendationId,
    })[resource] ?? actor.cropId;

  const buildPath = (row, id) => row.path.replace(`:${row.param}`, id);

  const call = (row, path, options = {}) =>
    server.request(path, {
      method: row.method,
      body: SAMPLE_BODIES[`${row.method} ${row.path}`],
      ...options,
    });

  // ── (a) No token → 401, for every protected route ─────────────────────────

  for (const row of protectedRoutes()) {
    it(`${row.method} ${row.path} · rejects an anonymous caller with 401`, async () => {
      const path = row.param ? buildPath(row, idFor(alice, row.resource)) : row.path;
      const res = await call(row, path);

      assert.equal(res.status, 401, `expected 401, got ${res.status}: ${res.text}`);
      assert.equal(res.body.error.code, 'AUTHENTICATION_ERROR');
    });
  }

  // ── (b) Another farmer's resource → 404, never 403, never 200 ─────────────

  for (const row of addressableRoutes()) {
    it(`${row.method} ${row.path} · answers 404 for another farmer's ${row.resource}`, async () => {
      const path = buildPath(row, idFor(mallory, row.resource));
      const res = await call(row, path, { token: alice.token });

      assert.equal(
        res.status,
        404,
        `expected 404 (existence non-disclosure), got ${res.status}: ${res.text}`,
      );
      assert.equal(res.body.error.code, 'NOT_FOUND');
    });

    it(`${row.method} ${row.path} · answers 404 identically for a non-existent id`, async () => {
      const owned = await call(row, buildPath(row, NON_EXISTENT_ID), { token: alice.token });
      const foreign = await call(row, buildPath(row, idFor(mallory, row.resource)), {
        token: alice.token,
      });

      // Indistinguishable: "does not exist" and "not yours" must look the same.
      assert.equal(owned.status, foreign.status);
      assert.deepEqual(owned.body.error, foreign.body.error);
    });

    it(`${row.method} ${row.path} · answers 404 for a malformed id without a cast error`, async () => {
      const res = await call(row, buildPath(row, 'not-an-object-id'), { token: alice.token });

      assert.equal(res.status, 404);
      assert.ok(!res.text.includes('Cast'), 'a Mongoose cast error leaked to the client');
      assert.ok(!res.text.includes('ObjectId'));
    });

    it(`${row.method} ${row.path} · rejects a tampered token with 401`, async () => {
      const [header, payload] = alice.token.split('.');
      const tampered = `${header}.${payload}.deadbeefdeadbeefdeadbeefdeadbeef`;
      const res = await call(row, buildPath(row, idFor(alice, row.resource)), { token: tampered });

      assert.equal(res.status, 401);
    });
  }

  // ── (c) Nested chain: a crop reached through someone else's farm ──────────

  it('nested chain · a crop is unreachable when its farm belongs to another farmer', async () => {
    // Mallory's crop, addressed directly by Alice: the leaf lookup must fail
    // because the chain crop → farm → user does not resolve to Alice.
    const res = await server.request(`/api/v1/crops/${mallory.cropId}`, { token: alice.token });
    assert.equal(res.status, 404);
  });

  it("nested chain · listing crops under another farmer's farm is a 404", async () => {
    const res = await server.request(`/api/v1/farms/${mallory.farmId}/crops`, {
      token: alice.token,
    });
    assert.equal(res.status, 404);
  });

  it("nested chain · a crop cannot be created under another farmer's farm", async () => {
    const res = await server.request(`/api/v1/farms/${mallory.farmId}/crops`, {
      method: 'POST',
      token: alice.token,
      body: { cropCode: 'OTHER', freeTextLabel: 'Sneaky', sowingDate: '2026-07-01' },
    });
    assert.equal(res.status, 404);
  });

  // ── (d) List scoping ──────────────────────────────────────────────────────

  it("list scoping · one farmer never sees another's farms", async () => {
    const res = await server.request('/api/v1/farms', { token: alice.token });

    assert.equal(res.status, 200);
    const ids = res.body.data.farms.map((farm) => farm.id);
    assert.ok(ids.includes(alice.farmId));
    assert.ok(!ids.includes(mallory.farmId), "another farmer's farm appeared in the list");
    assert.equal(ids.length, 1);
  });

  it("list scoping · one farmer never sees another's crops", async () => {
    const res = await server.request(`/api/v1/farms/${alice.farmId}/crops`, {
      token: alice.token,
    });

    assert.equal(res.status, 200);
    const ids = res.body.data.crops.map((crop) => crop.id);
    assert.deepEqual(ids, [alice.cropId]);
  });

  // ── (e) Ownership cannot be asserted by the client ────────────────────────

  it('a client-supplied userId cannot claim ownership on create', async () => {
    const res = await server.request('/api/v1/farms', {
      method: 'POST',
      token: alice.token,
      body: { ...FARM_BODY, userId: mallory.farmId },
    });

    // Either the field is stripped and the farm belongs to Alice, or the
    // request is rejected outright. What must never happen is a farm created
    // under someone else's ownership.
    if (res.status === 201) {
      const listed = await server.request('/api/v1/farms', { token: alice.token });
      assert.equal(listed.body.data.farms.length, 2, 'the farm was not created for the caller');
    } else {
      assert.equal(res.status, 422);
    }
  });

  it('every protected route in the table is actually mounted', async () => {
    // Guards against a row describing a route that does not exist: such a row
    // would make the rest of this suite vacuously pass.
    for (const row of protectedRoutes()) {
      const path = row.param ? buildPath(row, idFor(alice, row.resource)) : row.path;
      const res = await call(row, path, { token: alice.token });
      assert.notEqual(
        res.body?.error?.messageKey,
        'errors.routeNotFound',
        `${row.method} ${row.path} is in the ownership table but not mounted`,
      );
    }
  });
});
