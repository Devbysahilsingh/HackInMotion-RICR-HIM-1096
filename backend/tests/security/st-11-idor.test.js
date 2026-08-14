/**
 * ST-11 — Complete IDOR sweep [blocking].
 *
 * ST-10 generates its matrix from `routes/ownership-table.js` and covers every
 * route that addresses a document through a **path segment or query string**.
 * That left a real hole, which this suite exists to close and to keep closed:
 *
 *   Three POST routes take the id they address in the request **body** —
 *   `/crop-recommendation` (farmId), `/crop-health/analyze` (cropId, as a
 *   multipart field) and `/crop-health/symptom-check` (cropId). They carried no
 *   `param` for ST-10 to substitute, so the sweep walked straight past them.
 *   They are also the three endpoints where an attacker-supplied id is not one
 *   input among several — it is the whole request.
 *
 * The table now declares `bodyParam` on those rows and §11.1 drives them the
 * same way ST-10 drives the rest. §11.6 asserts the coverage is total, so a
 * fourth body-id route cannot ship untested.
 *
 * The rest of the file is the manual "change the id, then change the verb"
 * pass: cross-collection substitution (§11.2), ids used as list *filters*
 * rather than as subjects (§11.3), verbs the route never declared (§11.4), and
 * ownership claimed through a write body (§11.5).
 *
 * Throughout: the expected answer is **404**, never 403. A 403 confirms the id
 * exists, which is the oracle an enumeration attack is actually after
 * (invariant AU-2).
 */
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createApp } from '../../src/app.js';
import { Crop, CropHealthLog, CropRegistry, Farm } from '../../src/models/index.js';
import { bodyAddressableRoutes } from '../../src/routes/ownership-table.js';
import { startTestServer } from '../helpers/app.js';
import { clearCollections, startTestDatabase, stopTestDatabase } from '../helpers/db.js';
import { multipartBody, validJpeg } from '../fixtures/images.js';

const FARM_BODY = {
  name: 'North field',
  location: { lat: 21.1458, lon: 79.0882, state: 'Maharashtra', district: 'Nagpur', source: 'gps' },
  sizeValue: 2,
  sizeUnit: 'acre',
  soilType: 'black',
  irrigationMethod: 'borewell',
};

/** Well-formed, and belonging to nobody. */
const NON_EXISTENT_ID = '0123456789abcdef01234567';

/**
 * Enough registry document for a crop to be created and for the health routes
 * to resolve it. The agronomic content is irrelevant here — what matters is
 * that `cropCode` is known, so a crop create is not refused for a reason that
 * has nothing to do with authorization.
 */
const TOMATO = {
  cropCode: 'TOMATO',
  names: { en: 'Tomato', hi: 'टमाटर' },
  supportLevel: 'SPECIALIZED',
  seasons: ['KHARIF'],
  mlSupported: true,
  mlClassCodes: ['TOMATO_EARLY_BLIGHT'],
  diseases: [
    {
      code: 'TOMATO_EARLY_BLIGHT',
      names: { en: 'Early blight', hi: null, hiVerified: false },
      symptoms: ['disease.TOMATO_EARLY_BLIGHT.symptom.1'],
      inspect: ['disease.TOMATO_EARLY_BLIGHT.inspect.1'],
      nextSteps: ['disease.TOMATO_EARLY_BLIGHT.nextStep.1'],
      prevention: ['disease.TOMATO_EARLY_BLIGHT.prevention.1'],
      symptomTags: ['part:LEAF', 'pattern:RINGS', 'color:BROWN', 'distribution:LOWER_LEAVES'],
      expertThreshold: 0.4,
    },
  ],
};

describe('ST-11 · Complete IDOR sweep', () => {
  let server;
  let alice;
  let mallory;

  before(async () => {
    await startTestDatabase();
    server = await startTestServer(createApp());
  });

  after(async () => {
    await server.close();
    await stopTestDatabase();
  });

  async function seedFarmer(email) {
    const registered = await server.request('/api/v1/auth/register', {
      method: 'POST',
      body: { name: 'Test Farmer', email, password: 'a-long-enough-password', language: 'en' }, // pragma: allowlist-secret — fabricated value, exists only to prove it is never leaked
    });
    assert.equal(registered.status, 201, `could not register ${email}: ${registered.text}`);
    const token = registered.body.data.accessToken;
    const userId = registered.body.data.user.id;

    const farm = await server.request('/api/v1/farms', { method: 'POST', token, body: FARM_BODY });
    assert.equal(farm.status, 201, `could not create a farm for ${email}: ${farm.text}`);
    const farmId = farm.body.data.farm.id;

    const crop = await server.request(`/api/v1/farms/${farmId}/crops`, {
      method: 'POST',
      token,
      body: { cropCode: 'TOMATO', sowingDate: '2026-07-01', areaValue: 1, areaUnit: 'acre' },
    });
    assert.equal(crop.status, 201, `could not create a crop for ${email}: ${crop.text}`);
    const cropId = crop.body.data.crop.id;

    // Health logs are written by the analyze path, which needs a provider. This
    // one is inserted directly so the sweep has an owned log id to substitute.
    const log = await CropHealthLog.create({
      userId,
      cropId,
      farmId,
      imageUrl: 'https://res.cloudinary.test/him1096/leaf.jpg',
      imagePublicId: `him1096/${email}/leaf`,
      status: 'analyzed',
      analysis: { source: 'rules', diseaseCode: 'TOMATO_EARLY_BLIGHT', confidence: 0.9 },
    });

    return { token, userId, farmId, cropId, healthLogId: String(log._id) };
  }

  beforeEach(async () => {
    await clearCollections();
    await CropRegistry.create(TOMATO);

    alice = await seedFarmer('alice@example.com');
    mallory = await seedFarmer('mallory@example.com');
  });

  /**
   * Builds a request for a body-id route, with `id` substituted in.
   *
   * `analyze` is multipart, so its body is assembled from parts rather than
   * serialised as JSON — the id rides in exactly the field the route reads.
   */
  async function callBodyRoute(row, token, id) {
    if (row.multipart) {
      const { body, contentType } = multipartBody([
        {
          name: 'image',
          filename: 'leaf.jpg',
          contentType: 'image/jpeg',
          value: await validJpeg(),
        },
        { name: row.bodyParam, value: id },
      ]);
      return server.request(row.path, {
        method: row.method,
        raw: body,
        token,
        headers: { 'Content-Type': contentType },
      });
    }

    return server.request(row.path, {
      method: row.method,
      token,
      body: { ...(row.bodySample ?? {}), [row.bodyParam]: id },
    });
  }

  const idFor = (actor, resource) =>
    ({ farm: actor.farmId, crop: actor.cropId, cropHealthLog: actor.healthLogId })[resource];

  // ── §11.1 · An id in the body is as addressable as one in the path ────────

  describe('ST-11.1 · body-carried resource ids', () => {
    for (const row of bodyAddressableRoutes()) {
      const label = `${row.method} ${row.path} (${row.bodyParam})`;

      it(`${label} · answers 404 for another farmer's ${row.resource}`, async () => {
        const res = await callBodyRoute(row, alice.token, idFor(mallory, row.resource));

        assert.equal(
          res.status,
          404,
          `expected 404 for another farmer's id, got ${res.status}: ${res.text}`,
        );
        assert.equal(res.body.error.code, 'NOT_FOUND');
      });

      it(`${label} · answers 404 identically for an id that exists nowhere`, async () => {
        // The two answers must be indistinguishable. Any difference — status,
        // code, body length, timing class — tells an enumerator that the id
        // they guessed is real, which is the whole prize.
        const stolen = await callBodyRoute(row, alice.token, idFor(mallory, row.resource));
        const absent = await callBodyRoute(row, alice.token, NON_EXISTENT_ID);

        assert.equal(absent.status, stolen.status);
        assert.equal(absent.body.error.code, stolen.body.error.code);
        assert.equal(absent.body.error.messageKey, stolen.body.error.messageKey);
        assert.deepEqual(absent.body.error.details, stolen.body.error.details);
      });

      it(`${label} · rejects a malformed id without a cast error`, async () => {
        const res = await callBodyRoute(row, alice.token, 'not-an-object-id');

        assert.ok(
          [400, 404, 422].includes(res.status),
          `expected a clean refusal, got ${res.status}: ${res.text}`,
        );
        assert.ok(!/CastError|ObjectId|BSON/i.test(res.text), `driver detail leaked: ${res.text}`);
      });

      it(`${label} · rejects an anonymous caller before resolving the id`, async () => {
        const res = await callBodyRoute(row, undefined, idFor(mallory, row.resource));

        assert.equal(res.status, 401);
        assert.equal(res.body.error.code, 'AUTHENTICATION_ERROR');
      });

      it(`${label} · writes nothing on a refused request`, async () => {
        const before = await CropHealthLog.countDocuments({ userId: mallory.userId });
        await callBodyRoute(row, alice.token, idFor(mallory, row.resource));
        const after = await CropHealthLog.countDocuments({ userId: mallory.userId });

        assert.equal(after, before, 'a refused cross-farmer request still wrote a document');
      });
    }
  });

  // ── §11.2 · An id of the wrong kind is not a key to the right kind ────────

  describe('ST-11.2 · cross-collection substitution', () => {
    /**
     * Every id here belongs to Alice, so ownership alone cannot refuse them —
     * only the type discipline can. A lookup written as `findOne({_id})` with
     * ownership applied afterwards, or a route that resolves an id against the
     * wrong model, would answer 200 for at least one of these.
     */
    const swaps = [
      { path: (a) => `/api/v1/crops/${a.farmId}`, what: 'a farm id where a crop id belongs' },
      { path: (a) => `/api/v1/farms/${a.cropId}`, what: 'a crop id where a farm id belongs' },
      {
        path: (a) => `/api/v1/crop-health/logs/${a.cropId}`,
        what: 'a crop id where a health-log id belongs',
      },
      {
        path: (a) => `/api/v1/farms/${a.healthLogId}/weather`,
        what: 'a health-log id where a farm id belongs',
      },
      {
        path: (a) => `/api/v1/crops/${a.farmId}/irrigation`,
        what: 'a farm id on a crop-scoped read',
      },
      {
        path: (a) => `/api/v1/market/nearby?farmId=${a.cropId}`,
        what: 'a crop id on a farm-scoped market read',
      },
    ];

    for (const swap of swaps) {
      it(`refuses ${swap.what}, even when the caller owns it`, async () => {
        const res = await server.request(swap.path(alice), { token: alice.token });

        assert.equal(res.status, 404, `expected 404, got ${res.status}: ${res.text}`);
        assert.equal(res.body.error.code, 'NOT_FOUND');
      });
    }
  });

  // ── §11.3 · An id used as a filter is still an id ─────────────────────────

  describe('ST-11.3 · ids supplied as list filters', () => {
    it("filtering health logs by another farmer's cropId returns nothing, not theirs", async () => {
      const res = await server.request(`/api/v1/crop-health/logs?cropId=${mallory.cropId}`, {
        token: alice.token,
      });

      // 200-with-nothing rather than 404 is the right answer for a *list*: the
      // filter is legal, it simply selects none of the caller's documents. What
      // matters is that the userId scope is in the query rather than applied to
      // the result (AU-4), so no row can be returned by a filter alone.
      assert.equal(res.status, 200, res.text);
      assert.deepEqual(res.body.data.logs, []);
      assert.equal(res.body.meta.total, 0);
    });

    it("filtering by one's own cropId still returns one's own logs", async () => {
      // The negative above would pass just as well if the filter were broken
      // and returned nothing for everybody.
      const res = await server.request(`/api/v1/crop-health/logs?cropId=${alice.cropId}`, {
        token: alice.token,
      });

      assert.equal(res.status, 200, res.text);
      assert.equal(res.body.data.logs.length, 1);
      assert.equal(res.body.data.logs[0].id, alice.healthLogId);
    });

    it("listing crops under another farmer's farm is a 404, not an empty list", async () => {
      // A list *under* a resource is different from a filter: the parent is
      // addressed, so it must be refused rather than answered emptily.
      const res = await server.request(`/api/v1/farms/${mallory.farmId}/crops`, {
        token: alice.token,
      });

      assert.equal(res.status, 404, res.text);
    });
  });

  // ── §11.4 · Verbs the route never declared ────────────────────────────────

  describe('ST-11.4 · verb tampering', () => {
    /**
     * Same id, a verb the route does not implement. Express answers 404 for an
     * unmatched method+path pair, which is correct and is what these assert —
     * the failure this guards is a handler mounted for a verb nobody documented
     * (a stray `router.all`, a copy-pasted `.put`), which would be invisible in
     * the route list and fully functional over the wire.
     */
    const tampered = [
      { method: 'PUT', path: (a) => `/api/v1/farms/${a.farmId}` },
      { method: 'PUT', path: (a) => `/api/v1/crops/${a.cropId}` },
      { method: 'DELETE', path: (a) => `/api/v1/crops/${a.cropId}/irrigation` },
      { method: 'DELETE', path: (a) => `/api/v1/crops/${a.cropId}/fertilizer-guidance` },
      { method: 'PATCH', path: (a) => `/api/v1/crop-health/logs/${a.healthLogId}` },
      { method: 'DELETE', path: (a) => `/api/v1/crop-health/logs/${a.healthLogId}` },
      { method: 'DELETE', path: (a) => `/api/v1/farms/${a.farmId}/weather` },
      { method: 'POST', path: (a) => `/api/v1/farms/${a.farmId}` },
      { method: 'DELETE', path: () => '/api/v1/users/me' },
      { method: 'DELETE', path: () => '/api/v1/dashboard' },
    ];

    for (const probe of tampered) {
      it(`${probe.method} ${probe.path({ farmId: ':id', cropId: ':id', healthLogId: ':id' })} is not served`, async () => {
        const res = await server.request(probe.path(alice), {
          method: probe.method,
          token: alice.token,
          body: {},
        });

        assert.ok(
          res.status === 404 || res.status === 405,
          `an undeclared verb was served: ${res.status} ${res.text}`,
        );
      });
    }

    it("a tampered verb against another farmer's id changes nothing", async () => {
      const before = await Farm.findById(mallory.farmId).lean();

      await server.request(`/api/v1/farms/${mallory.farmId}`, {
        method: 'PUT',
        token: alice.token,
        body: { name: 'Seized' },
      });

      const after = await Farm.findById(mallory.farmId).lean();
      assert.equal(after.name, before.name);
    });
  });

  // ── §11.5 · Ownership cannot be claimed through a body ────────────────────

  describe('ST-11.5 · ownership claims in write bodies', () => {
    const claims = [
      { userId: mallory?.userId },
      { ownerId: 'anything' },
      { _id: NON_EXISTENT_ID },
      { id: NON_EXISTENT_ID },
    ];

    it('a create body naming another userId does not produce their document', async () => {
      const res = await server.request('/api/v1/farms', {
        method: 'POST',
        token: alice.token,
        body: { ...FARM_BODY, name: 'Claimed', userId: mallory.userId },
      });

      // `.strict()` refuses the unknown key outright, which is the stronger of
      // the two acceptable answers. If it is ever relaxed to strip instead, the
      // document must still belong to the caller — asserted below.
      if (res.status === 201) {
        const created = await Farm.findById(res.body.data.farm.id).lean();
        assert.equal(String(created.userId), alice.userId);
      } else {
        assert.equal(res.status, 422, res.text);
        assert.equal(res.body.error.code, 'VALIDATION_ERROR');
      }

      const stolen = await Farm.countDocuments({ userId: mallory.userId, name: 'Claimed' });
      assert.equal(stolen, 0);
    });

    for (const claim of claims) {
      const field = Object.keys(claim)[0];

      it(`a crop PATCH carrying '${field}' cannot re-point the document`, async () => {
        const res = await server.request(`/api/v1/crops/${alice.cropId}`, {
          method: 'PATCH',
          token: alice.token,
          body: { variety: 'Renamed', [field]: mallory.userId ?? NON_EXISTENT_ID },
        });

        const crop = await Crop.findById(alice.cropId).lean();
        assert.equal(String(crop.userId), alice.userId, `'${field}' moved the crop`);
        assert.equal(String(crop.farmId), alice.farmId);
        assert.ok(res.status === 422 || res.status === 200, res.text);
      });
    }

    it('a crop cannot be re-pointed at another farm through farmId', async () => {
      // `updateSchema` is `.strict()` and lists no farmId, so this is a 422.
      // The assertion that matters is the state afterwards: a crop that moved
      // into another farmer's farm would appear on their dashboard and count
      // against their land ledger.
      const res = await server.request(`/api/v1/crops/${alice.cropId}`, {
        method: 'PATCH',
        token: alice.token,
        body: { farmId: mallory.farmId },
      });

      assert.equal(res.status, 422, res.text);

      const crop = await Crop.findById(alice.cropId).lean();
      assert.equal(String(crop.farmId), alice.farmId);
      assert.equal(await Crop.countDocuments({ farmId: mallory.farmId }), 1);
    });
  });

  // ── §11.6 · The sweep is complete ─────────────────────────────────────────

  describe('ST-11.6 · coverage', () => {
    it('exercises every body-addressable route in the ownership table', () => {
      // The guard against this suite quietly going out of date: a fourth route
      // taking an id in its body gets a table row, and this fails until the
      // row carries what §11.1 needs to drive it.
      const rows = bodyAddressableRoutes();

      assert.ok(rows.length >= 3, `expected at least 3 body-id routes, found ${rows.length}`);

      for (const row of rows) {
        assert.ok(row.resource, `${row.method} ${row.path}: bodyParam without a resource`);
        assert.ok(
          ['farm', 'crop', 'cropHealthLog'].includes(row.resource),
          `${row.method} ${row.path}: this suite seeds no '${row.resource}' fixture to substitute`,
        );
      }
    });
  });
});
