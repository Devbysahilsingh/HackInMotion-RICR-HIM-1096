/**
 * Crop recommendation API (docs/api/intelligence.md:
 * "POST /crop-recommendation | Auth · 20/day | Req {farmId, season, preference?}
 *  → ranked crops + reasons + cautions + sources. Errors: 404, 422.").
 *
 * `farmId` arrives in the body rather than the path, so the usual `loadOwned`
 * middleware cannot be used and ownership is re-implemented in the handler.
 * That is precisely why this suite drives real HTTP against a real mongod: the
 * assertions that matter are what one account can reach of another's, and
 * whether a malformed id escapes as a CastError.
 *
 * The registry is seeded from the real knowledge files through the seed
 * service, so the response shape is the one the demo will actually serve.
 */
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { CropRegistry, SeedMeta } from '../../src/models/index.js';
import { applyRegistrySeed } from '../../src/services/registrySeedRunner.js';
import { composeRegistry, registryVersion } from '../../src/services/registrySeedService.js';
import { farmInput, registerUser } from '../factories/index.js';
import { startTestServer } from '../helpers/app.js';
import { clearCollections, startTestDatabase, stopTestDatabase } from '../helpers/db.js';

const ENDPOINT = '/api/v1/crop-recommendation';

/** Nagpur, black soil, borewell — the farm the factory already produces. */
const NAGPUR = farmInput();

describe('Crop recommendation API', () => {
  let server;
  let alice;
  let bob;
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

    const { documents } = composeRegistry();
    await applyRegistrySeed({
      CropRegistry,
      SeedMeta,
      documents,
      version: registryVersion(documents),
    });

    alice = await registerUser(server);
    bob = await registerUser(server);

    const farm = await server.request('/api/v1/farms', {
      method: 'POST',
      token: alice.accessToken,
      body: NAGPUR,
    });
    assert.equal(farm.status, 201, farm.text);
    farmId = farm.body.data.farm.id;
  });

  const recommend = (body, token = alice.accessToken) =>
    server.request(ENDPOINT, { method: 'POST', token, body });

  // ── Authentication ─────────────────────────────────────────────────────────

  it('requires a token', async () => {
    const res = await server.request(ENDPOINT, {
      method: 'POST',
      body: { farmId, season: 'KHARIF' },
    });

    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'AUTHENTICATION_ERROR');
  });

  it('refuses a forged token the same way it refuses a missing one', async () => {
    const res = await recommend({ farmId, season: 'KHARIF' }, 'not.a.jwt');
    assert.equal(res.status, 401);
  });

  // ── Validation (422) ───────────────────────────────────────────────────────

  it('rejects a missing season with 422', async () => {
    const res = await recommend({ farmId });

    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    assert.ok(res.body.error.details.some((detail) => detail.field === 'season'));
  });

  it('rejects a season outside the enum with 422', async () => {
    for (const season of ['SUMMER', 'kharif', '', 42, null]) {
      const res = await recommend({ farmId, season });

      assert.equal(res.status, 422, `season ${String(season)} was accepted`);
      assert.ok(res.body.error.details.some((detail) => detail.field === 'season'));
    }
  });

  it('rejects a missing farmId with 422 rather than ranking against nothing', async () => {
    const res = await recommend({ season: 'KHARIF' });

    assert.equal(res.status, 422);
    assert.ok(res.body.error.details.some((detail) => detail.field === 'farmId'));
  });

  it('rejects an unknown extra body key with 422 — the schema is strict', async () => {
    // A silently-ignored field is how a client ends up believing it set an
    // option that never reached the engine.
    const res = await recommend({ farmId, season: 'KHARIF', weights: { soil: 1 } });

    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    assert.deepEqual(res.body.error.details, [{ field: '(root)', rule: 'unrecognized_keys' }]);
  });

  it('rejects an unknown preference with 422', async () => {
    const res = await recommend({ farmId, season: 'KHARIF', preference: 'organic' });

    assert.equal(res.status, 422);
    assert.ok(res.body.error.details.some((detail) => detail.field === 'preference'));
  });

  // ── Ownership (404) ────────────────────────────────────────────────────────

  it('answers 404 — never 403 — for another user’s farm', async () => {
    const bobsFarm = await server.request('/api/v1/farms', {
      method: 'POST',
      token: bob.accessToken,
      body: farmInput({ name: 'Bob field' }),
    });

    const res = await recommend({ farmId: bobsFarm.body.data.farm.id, season: 'KHARIF' });

    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
  });

  it('answers 404 for a malformed farmId without leaking a cast error', async () => {
    for (const malformed of [
      'not-an-object-id',
      '123',
      '../../etc/passwd',
      'zzzzzzzzzzzzzzzzzzzzzzzz',
    ]) {
      const res = await recommend({ farmId: malformed, season: 'KHARIF' });

      assert.equal(res.status, 404, `farmId ${malformed} did not 404`);
      assert.equal(res.body.error.code, 'NOT_FOUND');
      assert.ok(!res.text.includes('Cast'), 'leaked a driver cast error');
      assert.ok(!res.text.includes('ObjectId'), 'leaked the id type to the caller');
    }
  });

  it('answers 404 for a well-formed farmId that belongs to nobody', async () => {
    const res = await recommend({ farmId: '6890000000000000000000aa', season: 'KHARIF' });
    assert.equal(res.status, 404);
  });

  // ── Success ────────────────────────────────────────────────────────────────

  it('ranks the caller’s own farm and echoes the request back', async () => {
    const res = await recommend({ farmId, season: 'KHARIF', preference: 'cash' });

    assert.equal(res.status, 200, res.text);
    assert.equal(res.body.success, true);

    const { recommendations, excluded, limitations, trace, request } = res.body.data;
    assert.ok(Array.isArray(recommendations));
    assert.ok(Array.isArray(excluded));
    assert.ok(Array.isArray(limitations));
    assert.ok(Array.isArray(trace));
    assert.deepEqual(request, { farmId, season: 'KHARIF', preference: 'cash' });
  });

  it('serves at most five ranked crops, in descending score order', async () => {
    const res = await recommend({ farmId, season: 'KHARIF' });
    const { recommendations } = res.body.data;

    assert.ok(recommendations.length > 0, 'the seeded registry produced no recommendations');
    assert.ok(recommendations.length <= 5);

    for (let i = 1; i < recommendations.length; i += 1) {
      assert.ok(recommendations[i - 1].score >= recommendations[i].score);
    }
  });

  it('gives every recommendation reasons, cautions, sources and an evidence ratio', async () => {
    const res = await recommend({ farmId, season: 'KHARIF' });

    for (const recommendation of res.body.data.recommendations) {
      assert.ok(recommendation.cropCode);
      assert.ok(recommendation.names.en && recommendation.names.hi);
      assert.equal(typeof recommendation.score, 'number');
      assert.equal(typeof recommendation.evidenceRatio, 'number');
      assert.ok(recommendation.evidenceRatio > 0 && recommendation.evidenceRatio <= 1);
      assert.ok(Array.isArray(recommendation.cautions));
      assert.ok(recommendation.reasons.length > 0);

      for (const reason of recommendation.reasons) {
        // The API returns keys, never prose (rule 8).
        assert.match(reason.key, /^cropRec\./);
        assert.ok(reason.field, `reason ${reason.key} cited no registry field`);
      }
      for (const source of recommendation.sources) {
        assert.ok(source.org && source.title);
      }
    }
  });

  it('names the missing climate normals in `limitations` — the honest-degradation contract', async () => {
    const res = await recommend({ farmId, season: 'KHARIF' });

    const limitation = res.body.data.limitations.find(
      (entry) => entry.key === 'cropRec.limitationNoClimateNormals',
    );
    assert.ok(limitation, 'the response did not say that district normals are unavailable');
    assert.deepEqual(limitation.blockedFactors, ['temp', 'water (rainfed farms only)']);

    // The trace agrees with the limitation rather than contradicting it.
    const input = res.body.data.trace.find((entry) => entry.step === 'INPUT');
    assert.equal(input.climateNormalsTableAvailable, false);
    assert.equal(input.climateNormalFound, false);
  });

  it('states a reason for every excluded crop', async () => {
    const res = await recommend({ farmId, season: 'RABI' });

    assert.ok(res.body.data.excluded.length > 0, 'nothing was gated in Rabi');
    for (const excluded of res.body.data.excluded) {
      assert.ok(excluded.cropCode);
      assert.ok(excluded.reason, `${excluded.cropCode} disappeared without a reason`);
      assert.match(excluded.reasonKey, /^cropRec\./);
    }
  });

  it('never offers or reports the UNSUPPORTED placeholder — it is filtered in the query', async () => {
    assert.ok(await CropRegistry.exists({ cropCode: 'OTHER' }), 'the placeholder was not seeded');

    const res = await recommend({ farmId, season: 'KHARIF' });
    const codes = [
      ...res.body.data.recommendations.map((entry) => entry.cropCode),
      ...res.body.data.excluded.map((entry) => entry.cropCode),
    ];
    assert.ok(!codes.includes('OTHER'));
  });

  it('publishes the full trace so a saved result can explain itself', async () => {
    const res = await recommend({ farmId, season: 'KHARIF' });

    assert.deepEqual(
      res.body.data.trace.map((entry) => entry.step),
      ['INPUT', 'GATES', 'SCORING', 'RANKING'],
    );

    const scoring = res.body.data.trace.find((entry) => entry.step === 'SCORING');
    assert.deepEqual(scoring.weights, { season: 0.3, soil: 0.25, water: 0.3, temp: 0.15 });
  });

  it('produces a different ranking for a different season, from the same farm', async () => {
    const kharif = await recommend({ farmId, season: 'KHARIF' });
    const rabi = await recommend({ farmId, season: 'RABI' });

    assert.notDeepEqual(
      kharif.body.data.recommendations.map((entry) => entry.cropCode),
      rabi.body.data.recommendations.map((entry) => entry.cropCode),
    );
  });

  it('is repeatable: two identical requests return the same ranking', async () => {
    const first = await recommend({ farmId, season: 'KHARIF' });
    const second = await recommend({ farmId, season: 'KHARIF' });

    assert.deepEqual(first.body.data, second.body.data);
  });

  it('notes a preference without letting it move the ranking', async () => {
    const neutral = await recommend({ farmId, season: 'KHARIF' });
    const cash = await recommend({ farmId, season: 'KHARIF', preference: 'cash' });

    assert.deepEqual(
      neutral.body.data.recommendations.map((entry) => entry.cropCode),
      cash.body.data.recommendations.map((entry) => entry.cropCode),
    );
    assert.ok(
      cash.body.data.recommendations.every((entry) =>
        entry.cautions.some((caution) => caution.key === 'cropRec.preferenceNotScored'),
      ),
      'the unscored preference was not disclosed',
    );
  });

  it('makes no yield or profit claim anywhere in the response (NFR-7)', async () => {
    const res = await recommend({ farmId, season: 'KHARIF' });

    const offending = [];
    const walk = (value, path) => {
      if (value === null || typeof value !== 'object') return;
      if (Array.isArray(value)) {
        value.forEach((entry, index) => walk(entry, `${path}[${index}]`));
        return;
      }
      for (const [key, entry] of Object.entries(value)) {
        if (/yield|profit|income|earn|price/i.test(key)) offending.push(`${path}.${key}`);
        walk(entry, `${path}.${key}`);
      }
    };
    walk(res.body.data.recommendations, 'recommendations');

    assert.deepEqual(offending, []);
  });
});
