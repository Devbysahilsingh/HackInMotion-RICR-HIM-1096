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

import { createApp } from '../../src/app.js';
import { Recommendation } from '../../src/models/index.js';
import {
  ROUTE_OWNERSHIP,
  addressableRoutes,
  protectedRoutes,
} from '../../src/routes/ownership-table.js';
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

/**
 * Routes that legitimately live outside the ownership table.
 *
 * `/healthz` is the platform liveness probe: infrastructure rather than
 * product, mounted above the API prefix, auth-free by design and serving no
 * per-farmer document. Listing it here — rather than pattern-matching it away
 * — means a *second* unowned root route cannot join it silently.
 */
const UNOWNED_INFRASTRUCTURE = new Set(['GET /healthz']);

/**
 * Every route Express is actually serving, recovered from the live app.
 *
 * The ownership table is only a security control if it is COMPLETE. The suite
 * already proves table → mounted (a row describing a route that does not exist
 * would make the matrix vacuously pass); this recovers the other direction,
 * mounted → table, which is the one that hides real holes: a protected
 * endpoint with no row is not tested by anything above, and nothing else in
 * the codebase would notice.
 *
 * Express 5 does not expose a router's mount path, so it is recovered by
 * probing each router's own matcher. A matcher for a router mounted at
 * `/api/v1/market` consumes exactly that much of any input, so the mount is
 * the single candidate `c` for which `matcher(c).path === c`. Candidates come
 * from the table itself, which makes the resolution fail *closed*: a router
 * mounted somewhere the table has never heard of resolves to nothing and is
 * reported rather than skipped.
 */
function mountedRoutes() {
  const app = createApp();
  const router = app.router ?? app._router;
  assert.ok(router?.stack, 'could not introspect the Express router stack');

  const candidates = new Set(['/']);
  for (const row of ROUTE_OWNERSHIP) {
    const parts = row.path.split('/').filter(Boolean);
    for (let i = 1; i <= parts.length; i += 1) {
      candidates.add(`/${parts.slice(0, i).join('/')}`);
    }
  }

  const resolveMount = (layer) => {
    const hits = [];
    for (const candidate of candidates) {
      for (const matcher of layer.matchers ?? []) {
        const matched = matcher(candidate);
        if (matched && matched.path === candidate) hits.push(candidate);
      }
    }
    // Longest wins: a router mounted at `/api/v1` also fully matches `/`.
    return hits.sort((a, b) => b.length - a.length)[0];
  };

  const found = [];
  const unresolved = [];

  for (const layer of router.stack) {
    if (layer.name !== 'router' || !layer.handle?.stack) continue;

    const mount = resolveMount(layer);
    const leaves = layer.handle.stack.filter((leaf) => leaf.route);

    if (mount === undefined) {
      unresolved.push(leaves.map((leaf) => leaf.route.path).join(', '));
      continue;
    }

    for (const leaf of leaves) {
      const base = mount === '/' ? '' : mount;
      const full = `${base}${leaf.route.path}`.replace(/\/$/, '') || '/';
      for (const [method, enabled] of Object.entries(leaf.route.methods)) {
        if (enabled) found.push(`${method.toUpperCase()} ${full}`);
      }
    }
  }

  return { found, unresolved };
}

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

  /**
   * Substitutes the addressed id wherever that route carries it. A query-borne
   * id (`/market/nearby?farmId=…`) is not a lesser kind of addressing than a
   * path segment, so the matrix builds both the same way.
   */
  const buildPath = (row, id) =>
    row.queryParam
      ? `${row.path}?${row.queryParam}=${encodeURIComponent(id)}`
      : row.path.replace(`:${row.param}`, id);

  const call = (row, path, options = {}) =>
    server.request(path, {
      method: row.method,
      body: SAMPLE_BODIES[`${row.method} ${row.path}`],
      ...options,
    });

  // ── (a) No token → 401, for every protected route ─────────────────────────

  for (const row of protectedRoutes()) {
    it(`${row.method} ${row.path} · rejects an anonymous caller with 401`, async () => {
      const path =
        row.param || row.queryParam ? buildPath(row, idFor(alice, row.resource)) : row.path;
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

  // ── (f) The table is COMPLETE, not merely correct ─────────────────────────

  it('every mounted route appears in the ownership table', () => {
    const { found, unresolved } = mountedRoutes();

    assert.deepEqual(
      unresolved,
      [],
      `a router is mounted at a prefix the ownership table does not know about, ` +
        `so its routes cannot be checked at all: ${unresolved.join(' | ')}`,
    );

    const declared = new Set(ROUTE_OWNERSHIP.map((row) => `${row.method} ${row.path}`));
    const missing = found.filter(
      (route) => !declared.has(route) && !UNOWNED_INFRASTRUCTURE.has(route),
    );

    assert.deepEqual(
      missing,
      [],
      `mounted but absent from src/routes/ownership-table.js — the ST-10 matrix ` +
        `cannot see these endpoints, so their auth and ownership behaviour is ` +
        `asserted by nothing: ${missing.join(', ')}`,
    );
  });

  it('the table describes no route that is not mounted', () => {
    // The mirror image, at the table level rather than over HTTP: a stale row
    // for a deleted endpoint would pad the matrix with tests that prove
    // nothing about the running app.
    const { found } = mountedRoutes();
    const mounted = new Set(found);

    const phantom = ROUTE_OWNERSHIP.map((row) => `${row.method} ${row.path}`).filter(
      (route) => !mounted.has(route),
    );

    assert.deepEqual(phantom, [], `declared in the ownership table but not mounted: ${phantom}`);
  });

  it('every protected route in the table is actually mounted', async () => {
    // Guards against a row describing a route that does not exist: such a row
    // would make the rest of this suite vacuously pass.
    for (const row of protectedRoutes()) {
      const path =
        row.param || row.queryParam ? buildPath(row, idFor(alice, row.resource)) : row.path;
      const res = await call(row, path, { token: alice.token });
      assert.notEqual(
        res.body?.error?.messageKey,
        'errors.routeNotFound',
        `${row.method} ${row.path} is in the ownership table but not mounted`,
      );
    }
  });
});
