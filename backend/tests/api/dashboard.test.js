/**
 * Dashboard, recommendation history, acknowledge — and the two jobs that fill
 * and drain the feed (docs/api/recommendations.md,
 * docs/irrigation/recommendation-engine.md).
 *
 * Real mongod, real HTTP, real tokens. `/dashboard` is "the single most
 * important endpoint" and the claims that matter about it — what one account
 * can see of another's, and whether the query budget is bounded — can only be
 * answered honestly by the full stack, so nothing is stubbed.
 *
 * Two clocks, deliberately:
 *   · the READ routes take the clock themselves (`dashboard()` defaults `asOf`),
 *     so their fixtures are seeded relative to one instant captured at import;
 *   · every JOB call passes an explicit, fixed `asOf`. There are no fake timers
 *     in this project (ADR-022).
 *
 * Registry values, weather rows and prices here are fabricated fixtures shaped
 * like the real thing. They are not agronomic claims, and the fixture crop
 * names are placeholders rather than translations.
 */
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { API_PREFIX, createApp } from '../../src/app.js';
import {
  FEED_MAX_ACTIVE_PER_USER,
  FEED_PRIORITY_RANK,
  FEED_PURGE_GRACE_DAYS,
} from '../../src/config/constants.js';
import { runExpiry } from '../../src/jobs/expiry.js';
import { runFeedRefresh } from '../../src/jobs/feedRefresh.js';
import {
  Crop,
  CropHealthLog,
  CropRegistry,
  Farm,
  Recommendation,
  WeatherSnapshot,
} from '../../src/models/index.js';
import { farmInput, registerUser } from '../factories/index.js';
import { startTestServer } from '../helpers/app.js';
import { clearCollections, startTestDatabase, stopTestDatabase } from '../helpers/db.js';

const DASHBOARD = `${API_PREFIX}/dashboard`;
const RECOMMENDATIONS = `${API_PREFIX}/recommendations`;
const FARMS = `${API_PREFIX}/farms`;

const MS_PER_DAY = 86_400_000;
const MS_PER_HOUR = 3_600_000;

/** One instant for the whole run, so the seeded windows never drift mid-suite. */
const NOW = new Date();
const daysAgo = (days) => new Date(NOW.getTime() - days * MS_PER_DAY);
const daysAhead = (days) => new Date(NOW.getTime() + days * MS_PER_DAY);
const hoursAhead = (hours) => new Date(NOW.getTime() + hours * MS_PER_HOUR);

/** Fixed instant for every job run — the jobs take it as a parameter. */
const JOB_ASOF = new Date('2026-08-13T06:30:00.000Z'); // 12:00 IST

/** The 0.1° cell the default farm fixture (Nagpur) lands in. */
const LOCATION_KEY = '21.1,79.1';

/**
 * A Kc curve shaped like FAO-56's but chosen so the arithmetic is checkable by
 * hand: INITIAL 0–29 · DEVELOPMENT 30–69 · MID 70–109 · LATE 110–134.
 */
const KC_STAGES = [
  { stage: 'INITIAL', days: 30, kc: 0.6 },
  { stage: 'DEVELOPMENT', days: 40, kc: null },
  { stage: 'MID', days: 40, kc: 1.15 },
  { stage: 'LATE', days: 25, kc: 0.8 },
];

const registryDoc = (overrides = {}) => ({
  cropCode: 'WHEAT',
  names: { en: 'Wheat', hi: 'Wheat' },
  supportLevel: 'SPECIALIZED',
  kcStages: KC_STAGES,
  rootDepthM: 1,
  depletionFraction: 0.5,
  sensitivity: {
    frostTminC: 4,
    heatTmaxC: 38,
    heavyRainMm24h: 50,
    humidityDiseasePct: 85,
    highWindKmh: 40,
  },
  ...overrides,
});

/** Unique per call — `dedupKey` carries a unique index. */
let dedupSeq = 0;
const nextDedupKey = () => `test-dedup-${(dedupSeq += 1)}`;

const recommendationDoc = (owner, overrides = {}) => ({
  userId: owner.user.id,
  type: 'irrigation',
  priority: 'MEDIUM',
  source: 'RULE_ENGINE',
  titleKey: 'irrigation.titleIRRIGATE_IN_N_DAYS',
  bodyKey: 'irrigation.bodyIRRIGATE_IN_N_DAYS',
  data: { verdict: 'IRRIGATE_IN_N_DAYS', trace: [{ step: 'VERDICT' }] },
  validUntil: daysAhead(1),
  dedupKey: nextDedupKey(),
  ...overrides,
});

/**
 * Inserts recommendations, honouring an explicit `createdAt`.
 *
 * Mongoose's timestamps plugin owns `createdAt` on insert, so a value handed to
 * `insertMany` is overwritten; the ordering assertions need distinct, known
 * stamps, so they are written straight through the driver afterwards.
 */
async function seedRecommendations(docs) {
  const created = await Recommendation.insertMany(docs);

  for (const [index, doc] of created.entries()) {
    const createdAt = docs[index].createdAt;
    if (createdAt) {
      await Recommendation.collection.updateOne({ _id: doc._id }, { $set: { createdAt } });
    }
  }

  return created;
}

/** A validated 14-day snapshot: 7 observed + today + 6 forecast, around `asOf`. */
const dailySeries = (asOf, overrides = {}) =>
  Array.from({ length: 14 }, (_, index) => ({
    date: new Date(asOf.getTime() + (index - 7) * MS_PER_DAY),
    tMinC: 24,
    tMaxC: 33,
    humidityPct: 60,
    windKmh: 10,
    rainMm: 0,
    rainProbPct: 0,
    et0Mm: 5,
    ...overrides,
  }));

const snapshotDoc = (overrides = {}) => ({
  locationKey: LOCATION_KEY,
  source: 'open-meteo',
  fetchedAt: NOW,
  expiresAt: hoursAhead(6),
  status: 'ok',
  daily: [],
  ...overrides,
});

const percentile = (samples, p) => {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)];
};

describe('Dashboard, recommendations and the feed jobs', () => {
  let server;
  let alice;
  let bob;

  before(async () => {
    await startTestDatabase();
    server = await startTestServer(createApp());
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

  const createFarm = async (token, overrides) => {
    const res = await server.request(FARMS, { method: 'POST', token, body: farmInput(overrides) });
    assert.equal(res.status, 201, res.text);
    return res.body.data.farm;
  };

  const plantCrop = (owner, farm, overrides = {}) =>
    Crop.create({
      userId: owner.user.id,
      farmId: farm.id,
      cropCode: 'WHEAT',
      sowingDate: daysAgo(45),
      status: 'active',
      ...overrides,
    });

  const getDashboard = async (token) => {
    const res = await server.request(DASHBOARD, { token });
    assert.equal(res.status, 200, res.text);
    return res.body.data;
  };

  // ── GET /dashboard ─────────────────────────────────────────────────────────

  describe('GET /dashboard', () => {
    it('requires a token', async () => {
      const res = await server.request(DASHBOARD);

      assert.equal(res.status, 401);
      assert.equal(res.body.error.code, 'AUTHENTICATION_ERROR');

      const forged = await server.request(DASHBOARD, { token: 'not.a.jwt' });
      assert.equal(forged.status, 401);
    });

    it('answers a farmer with no farms with the onboarding payload, not bare empty arrays', async () => {
      const data = await getDashboard(alice.accessToken);

      // The distinguishing claim: an onboarding step is present. Empty arrays
      // alone would leave the client with nothing to render.
      assert.ok(data.onboarding, 'no onboarding payload for an empty account');
      assert.equal(data.onboarding.stepKey, 'farm.onboardingCreateFarm');
      assert.ok(data.onboarding.ctaKey, 'the onboarding step carries no call to action');
      // Keys only — the API never returns display prose (rule 8).
      assert.match(data.onboarding.stepKey, /^[a-z]/);

      assert.deepEqual(data.feed, []);
      assert.deepEqual(data.cropCards, []);
      assert.deepEqual(data.farmSummary, { farmCount: 0, activeCropCount: 0, districts: [] });
      // No ML_SERVICE_URL is set under test, so there is nothing deployed to
      // talk to — 'pending', not 'down'. See the ml-status test below.
      assert.equal(data.systemStatus.ml, 'pending');
    });

    it('drops the onboarding payload as soon as one farm exists', async () => {
      await createFarm(alice.accessToken);

      const data = await getDashboard(alice.accessToken);

      assert.equal(data.onboarding, undefined);
      assert.equal(data.farmSummary.farmCount, 1);
    });

    it('serves the feed most urgent first, excluding acknowledged and expired items', async () => {
      const farm = await createFarm(alice.accessToken);
      const crop = await plantCrop(alice, farm);

      const [info, critical, acknowledged, expired, medium, high] = await seedRecommendations([
        recommendationDoc(alice, { priority: 'INFO', cropId: crop._id }),
        recommendationDoc(alice, {
          priority: 'CRITICAL',
          type: 'weather-risk',
          source: 'WEATHER',
          cropId: crop._id,
        }),
        recommendationDoc(alice, { priority: 'CRITICAL', acknowledgedAt: daysAgo(0) }),
        recommendationDoc(alice, { priority: 'CRITICAL', validUntil: daysAgo(1) }),
        recommendationDoc(alice, { priority: 'MEDIUM', cropId: crop._id }),
        recommendationDoc(alice, { priority: 'HIGH', cropId: crop._id }),
      ]);

      const data = await getDashboard(alice.accessToken);
      const ids = data.feed.map((item) => item.id);

      assert.deepEqual(
        data.feed.map((item) => item.priority),
        ['CRITICAL', 'HIGH', 'MEDIUM', 'INFO'],
      );
      assert.deepEqual(
        ids,
        [critical, high, medium, info].map((doc) => String(doc._id)),
      );

      // Stated as a property rather than a literal list, so the order cannot
      // regress to the index's own (which puts INFO above MEDIUM).
      const ranks = data.feed.map((item) => FEED_PRIORITY_RANK[item.priority]);
      assert.deepEqual(
        [...ranks].sort((a, b) => a - b),
        ranks,
      );

      assert.ok(!ids.includes(String(acknowledged._id)), 'an acknowledged item stayed in the feed');
      assert.ok(!ids.includes(String(expired._id)), 'an expired item stayed in the feed');

      // The item shape the client is contracted to receive.
      const [top] = data.feed;
      assert.equal(top.type, 'weather-risk');
      assert.equal(top.source, 'WEATHER');
      assert.ok(top.titleKey && top.bodyKey);
      assert.ok(top.data);
      assert.equal(top.cropId, String(crop._id));
      assert.equal(top.farmId, null);
      assert.equal(top.acknowledgedAt, null);
      assert.ok(top.validUntil);
    });

    it(`caps the feed at ${FEED_MAX_ACTIVE_PER_USER} active items`, async () => {
      const farm = await createFarm(alice.accessToken);
      await plantCrop(alice, farm);

      await seedRecommendations(
        Array.from({ length: 25 }, (_, index) =>
          recommendationDoc(alice, {
            priority: index < 5 ? 'HIGH' : 'INFO',
            createdAt: daysAgo(index / 24),
          }),
        ),
      );

      const data = await getDashboard(alice.accessToken);

      assert.equal(data.feed.length, FEED_MAX_ACTIVE_PER_USER);
      // The cap is applied after ordering, so nothing urgent is cut.
      assert.equal(data.feed.filter((item) => item.priority === 'HIGH').length, 5);
      assert.equal(await Recommendation.countDocuments({ userId: alice.user.id }), 25);
    });

    it('builds a crop card per active crop, with stage, verdict and freshness', async () => {
      await CropRegistry.create(registryDoc());
      await WeatherSnapshot.create(snapshotDoc());

      const farm = await createFarm(alice.accessToken);
      const crop = await plantCrop(alice, farm);
      await plantCrop(alice, farm, { cropCode: 'TOMATO', status: 'harvested' });

      await seedRecommendations([
        recommendationDoc(alice, {
          priority: 'HIGH',
          cropId: crop._id,
          farmId: farm.id,
          data: { verdict: 'IRRIGATE_TODAY', trace: [{ step: 'VERDICT' }] },
        }),
      ]);

      const data = await getDashboard(alice.accessToken);

      assert.equal(data.cropCards.length, 1, 'a harvested crop reached the dashboard');

      const [card] = data.cropCards;
      assert.equal(card.cropId, String(crop._id));
      assert.equal(card.farmId, farm.id);
      assert.equal(card.cropCode, 'WHEAT');
      // Sown 45 days ago against the fixture curve: 30–69 is DEVELOPMENT.
      assert.equal(card.stage, 'DEVELOPMENT');
      assert.equal(card.stageReason, 'STAGE_DERIVED');
      assert.deepEqual(card.names, { en: 'Wheat', hi: 'Wheat' });
      assert.equal(card.irrigationVerdict, 'IRRIGATE_TODAY');
      // No scan has ever been analyzed for this crop; null is honest,
      // 'healthy' would be fabricated (rule 7).
      assert.equal(card.healthFlag, null);
      assert.equal(card.marketSignal, null);
      assert.equal(card.freshness.status, 'live');
      assert.equal(card.freshness.source, 'open-meteo');
      assert.ok(card.freshness.fetchedAt);
      // Never sown with an area in this fixture.
      assert.equal(card.areaValue, null);
      assert.equal(card.areaUnit, null);
    });

    it('carries the crop’s own area, and the severity of its most recent analyzed scan', async () => {
      await CropRegistry.create(registryDoc());

      const farm = await createFarm(alice.accessToken);
      const crop = await plantCrop(alice, farm, { areaValue: 2.5, areaUnit: 'acre' });

      const scan = (overrides = {}) => ({
        userId: alice.user.id,
        cropId: crop._id,
        farmId: farm.id,
        imageUrl: 'https://res.cloudinary.com/demo/image/upload/v1/fixture.jpg',
        imagePublicId: `fixture-${Math.random()}`,
        status: 'analyzed',
        analysis: { source: 'rules', severityAssessment: 'MILD' },
        ...overrides,
      });

      // An older SEVERE scan, then a newer MILD one — the card must report
      // the newer one, not the more severe one and not the first one found.
      await CropHealthLog.create(scan({ analysis: { source: 'rules', severityAssessment: 'SEVERE' } }));
      await new Promise((resolve) => setTimeout(resolve, 5));
      await CropHealthLog.create(scan());

      const data = await getDashboard(alice.accessToken);
      const [card] = data.cropCards;

      assert.equal(card.areaValue, 2.5);
      assert.equal(card.areaUnit, 'acre');
      assert.equal(card.healthFlag, 'MILD');
    });

    it('does not flag a crop whose only scan reached no assessable severity', async () => {
      await CropRegistry.create(registryDoc());

      const farm = await createFarm(alice.accessToken);
      const crop = await plantCrop(alice, farm);

      await CropHealthLog.create({
        userId: alice.user.id,
        cropId: crop._id,
        farmId: farm.id,
        imageUrl: 'https://res.cloudinary.com/demo/image/upload/v1/fixture.jpg',
        imagePublicId: 'fixture-not-assessed',
        status: 'analyzed',
        analysis: { source: 'rules', severityAssessment: 'NOT_ASSESSED' },
      });

      const data = await getDashboard(alice.accessToken);

      assert.equal(data.cropCards[0].healthFlag, null);
    });

    it('labels a crop whose cell has never been fetched as pending, not live', async () => {
      await CropRegistry.create(registryDoc());
      const farm = await createFarm(alice.accessToken);
      await plantCrop(alice, farm);

      const data = await getDashboard(alice.accessToken);

      assert.equal(data.cropCards[0].freshness.status, 'pending');
      assert.equal(data.cropCards[0].freshness.fetchedAt, null);
      assert.equal(data.systemStatus.weather, 'pending');
    });

    it('counts farms, active crops and districts, and reports ml down honestly', async () => {
      await CropRegistry.create(registryDoc());
      await WeatherSnapshot.create(snapshotDoc());

      const nagpur = await createFarm(alice.accessToken);
      const wardha = await createFarm(alice.accessToken, {
        name: 'South Field',
        location: {
          lat: 20.7453,
          lon: 78.6022,
          state: 'Maharashtra',
          district: 'Wardha',
          source: 'gps',
        },
      });

      await plantCrop(alice, nagpur);
      await plantCrop(alice, nagpur, { cropCode: 'TOMATO' });
      await plantCrop(alice, wardha);
      await plantCrop(alice, wardha, { cropCode: 'ONION', status: 'planned' });

      const data = await getDashboard(alice.accessToken);

      assert.deepEqual(data.farmSummary, {
        farmCount: 2,
        activeCropCount: 3,
        districts: ['Nagpur', 'Wardha'],
      });

      // systemStatus reports only subsystems that exist. This suite runs with
      // no `ML_SERVICE_URL`, which is 'pending' — nothing has been deployed to
      // reach. It used to be hard-coded 'down', which stopped being true when
      // Phase 3 shipped the service.
      assert.equal(data.systemStatus.ml, 'pending');
      assert.equal(data.systemStatus.weather, 'live');
      assert.equal(data.systemStatus.market, 'pending');

      assert.deepEqual(
        data.cropCards.map((card) => card.cropCode),
        ['TOMATO', 'WHEAT', 'WHEAT'],
      );
    });

    // ── Cross-account leakage ───────────────────────────────────────────────

    it('never shows one account any part of another’s dashboard', async () => {
      await CropRegistry.create(registryDoc());

      const aliceFarm = await createFarm(alice.accessToken, { name: 'Alice field' });
      const aliceCrop = await plantCrop(alice, aliceFarm);
      const aliceFeed = await seedRecommendations([
        recommendationDoc(alice, { priority: 'HIGH', cropId: aliceCrop._id }),
      ]);

      const bobFarm = await createFarm(bob.accessToken, { name: 'Bob field' });
      const bobCrop = await plantCrop(bob, bobFarm, { cropCode: 'TOMATO' });
      const bobFeed = await seedRecommendations([
        recommendationDoc(bob, { priority: 'CRITICAL', cropId: bobCrop._id }),
        recommendationDoc(bob, { priority: 'INFO', cropId: bobCrop._id }),
      ]);

      const aliceData = await getDashboard(alice.accessToken);
      const bobData = await getDashboard(bob.accessToken);

      // By id, not by count: a count check passes even when the wrong document
      // is served.
      const aliceFeedIds = new Set(aliceData.feed.map((item) => item.id));
      const bobFeedIds = new Set(bobData.feed.map((item) => item.id));

      for (const doc of bobFeed) {
        assert.ok(!aliceFeedIds.has(String(doc._id)), 'Bob’s feed item reached Alice');
      }
      for (const doc of aliceFeed) {
        assert.ok(!bobFeedIds.has(String(doc._id)), 'Alice’s feed item reached Bob');
        assert.ok(aliceFeedIds.has(String(doc._id)), 'Alice lost her own feed item');
      }

      const aliceCardIds = aliceData.cropCards.map((card) => card.cropId);
      const bobCardIds = bobData.cropCards.map((card) => card.cropId);

      assert.deepEqual(aliceCardIds, [String(aliceCrop._id)]);
      assert.deepEqual(bobCardIds, [String(bobCrop._id)]);
      assert.ok(!aliceCardIds.includes(String(bobCrop._id)));
      assert.ok(!bobCardIds.includes(String(aliceCrop._id)));

      // Nothing of Bob's appears anywhere in Alice's payload, farm ids included.
      const serialized = JSON.stringify(aliceData);
      assert.ok(!serialized.includes(bobFarm.id));
      assert.ok(!serialized.includes(String(bobCrop._id)));
      assert.ok(!serialized.includes(bob.user.id));

      assert.equal(aliceData.farmSummary.farmCount, 1);
      assert.equal(aliceData.farmSummary.activeCropCount, 1);
    });
  });

  // ── GET /recommendations ───────────────────────────────────────────────────

  describe('GET /recommendations', () => {
    it('requires a token', async () => {
      const res = await server.request(RECOMMENDATIONS);

      assert.equal(res.status, 401);
      assert.equal(res.body.error.code, 'AUTHENTICATION_ERROR');
    });

    it('pages newest first, with correct meta', async () => {
      const docs = Array.from({ length: 5 }, (_, index) =>
        recommendationDoc(alice, {
          priority: 'INFO',
          titleKey: `irrigation.title${index}`,
          // Index 0 is the oldest, so "newest first" is index 4 → 0.
          createdAt: daysAgo(5 - index),
        }),
      );
      await seedRecommendations(docs);

      const first = await server.request(`${RECOMMENDATIONS}?page=1&limit=2`, {
        token: alice.accessToken,
      });

      assert.equal(first.status, 200, first.text);
      assert.deepEqual(first.body.meta, { page: 1, limit: 2, total: 5 });
      assert.deepEqual(
        first.body.data.recommendations.map((item) => item.titleKey),
        ['irrigation.title4', 'irrigation.title3'],
      );

      const last = await server.request(`${RECOMMENDATIONS}?page=3&limit=2`, {
        token: alice.accessToken,
      });

      assert.deepEqual(last.body.meta, { page: 3, limit: 2, total: 5 });
      assert.deepEqual(
        last.body.data.recommendations.map((item) => item.titleKey),
        ['irrigation.title0'],
      );

      const beyond = await server.request(`${RECOMMENDATIONS}?page=9&limit=2`, {
        token: alice.accessToken,
      });
      assert.equal(beyond.status, 200);
      assert.deepEqual(beyond.body.data.recommendations, []);
      assert.equal(beyond.body.meta.total, 5);
    });

    it('is history, not a feed: acknowledged and expired items are included', async () => {
      const farm = await createFarm(alice.accessToken);
      await plantCrop(alice, farm);

      const [active, acknowledged, expired] = await seedRecommendations([
        recommendationDoc(alice, { createdAt: daysAgo(1) }),
        recommendationDoc(alice, { acknowledgedAt: daysAgo(0), createdAt: daysAgo(2) }),
        recommendationDoc(alice, { validUntil: daysAgo(3), createdAt: daysAgo(3) }),
      ]);

      const res = await server.request(RECOMMENDATIONS, { token: alice.accessToken });
      const ids = res.body.data.recommendations.map((item) => item.id);

      assert.equal(res.body.meta.total, 3);
      assert.deepEqual(
        ids,
        [active, acknowledged, expired].map((doc) => String(doc._id)),
      );

      // …and exactly those two are what the dashboard feed leaves out.
      const dashboardIds = (await getDashboard(alice.accessToken)).feed.map((item) => item.id);
      assert.deepEqual(dashboardIds, [String(active._id)]);

      const acked = res.body.data.recommendations.find(
        (item) => item.id === String(acknowledged._id),
      );
      assert.ok(acked.acknowledgedAt, 'the acknowledged stamp was not published');
    });

    it('is scoped to the caller', async () => {
      const mine = await seedRecommendations([recommendationDoc(alice)]);
      const theirs = await seedRecommendations([
        recommendationDoc(bob),
        recommendationDoc(bob, { priority: 'HIGH' }),
      ]);

      const res = await server.request(RECOMMENDATIONS, { token: alice.accessToken });

      assert.equal(res.body.meta.total, 1);
      assert.deepEqual(
        res.body.data.recommendations.map((item) => item.id),
        [String(mine[0]._id)],
      );
      for (const doc of theirs) {
        assert.ok(!res.text.includes(String(doc._id)), 'another account’s item leaked');
      }
    });

    it('rejects an unknown or non-positive query parameter with 422', async () => {
      for (const query of ['page=0', 'limit=0', 'limit=51', 'page=abc', 'x=1']) {
        const res = await server.request(`${RECOMMENDATIONS}?${query}`, {
          token: alice.accessToken,
        });
        assert.equal(res.status, 422, `accepted ?${query}`);
        assert.equal(res.body.error.code, 'VALIDATION_ERROR');
      }
    });
  });

  // ── POST /recommendations/:id/ack ──────────────────────────────────────────

  describe('POST /recommendations/:id/ack', () => {
    const ack = (token, id) =>
      server.request(`${RECOMMENDATIONS}/${id}/ack`, { method: 'POST', token });

    it('answers 204, stamps the item and removes it from the feed', async () => {
      const farm = await createFarm(alice.accessToken);
      await plantCrop(alice, farm);

      const [target, other] = await seedRecommendations([
        recommendationDoc(alice, { priority: 'HIGH' }),
        recommendationDoc(alice, { priority: 'INFO' }),
      ]);

      const before = await getDashboard(alice.accessToken);
      assert.equal(before.feed.length, 2);

      const res = await ack(alice.accessToken, target._id);

      assert.equal(res.status, 204);
      assert.equal(res.text, '');

      const stored = await Recommendation.findById(target._id);
      assert.ok(stored.acknowledgedAt instanceof Date);

      const after = await getDashboard(alice.accessToken);
      assert.deepEqual(
        after.feed.map((item) => item.id),
        [String(other._id)],
      );
    });

    it('is idempotent: a second ack is another 204 and does not re-stamp', async () => {
      const [target] = await seedRecommendations([recommendationDoc(alice)]);

      assert.equal((await ack(alice.accessToken, target._id)).status, 204);
      const firstStamp = (await Recommendation.findById(target._id)).acknowledgedAt;

      assert.equal((await ack(alice.accessToken, target._id)).status, 204);
      const secondStamp = (await Recommendation.findById(target._id)).acknowledgedAt;

      assert.equal(secondStamp.getTime(), firstStamp.getTime(), 'the second ack moved the stamp');
    });

    it('acknowledges an already-expired item rather than refusing with a confusing 409', async () => {
      const [expired] = await seedRecommendations([
        recommendationDoc(alice, { validUntil: daysAgo(2) }),
      ]);

      assert.equal((await ack(alice.accessToken, expired._id)).status, 204);
      assert.ok((await Recommendation.findById(expired._id)).acknowledgedAt);
    });

    it('answers 404 — never 403 — for another account’s recommendation', async () => {
      const [theirs] = await seedRecommendations([recommendationDoc(bob)]);

      const res = await ack(alice.accessToken, theirs._id);

      assert.equal(res.status, 404);
      assert.equal(res.body.error.code, 'NOT_FOUND');
      // Nothing was mutated by the attempt.
      assert.equal((await Recommendation.findById(theirs._id)).acknowledgedAt, undefined);
    });

    it('answers 404 for a malformed id rather than casting it', async () => {
      const res = await ack(alice.accessToken, 'not-an-object-id');

      assert.equal(res.status, 404);
      assert.equal(res.body.error.code, 'NOT_FOUND');
      assert.ok(!res.text.includes('Cast'), 'leaked a driver cast error');
    });

    it('answers 404 for a well-formed id that belongs to nobody', async () => {
      const res = await ack(alice.accessToken, '6890000000000000000000aa');
      assert.equal(res.status, 404);
    });

    it('requires a token', async () => {
      const [target] = await seedRecommendations([recommendationDoc(alice)]);

      const res = await server.request(`${RECOMMENDATIONS}/${target._id}/ack`, { method: 'POST' });

      assert.equal(res.status, 401);
      assert.equal(res.body.error.code, 'AUTHENTICATION_ERROR');
      assert.equal((await Recommendation.findById(target._id)).acknowledgedAt, undefined);
    });
  });

  // ── feed-refresh job ───────────────────────────────────────────────────────

  describe('runFeedRefresh', () => {
    /**
     * Seeds everything one user needs for the engines to reach a verdict at
     * JOB_ASOF: a black-soil farm, a crop 80 days into the fixture curve (MID,
     * Kc 1.15) carrying a 100 mm standing deficit, and a full ET₀ snapshot.
     *
     * TAW = 200 mm/m × 1.0 m = 200 mm; p corrects to 0.47 at ETc 5.75 mm/day,
     * so RAW = 94 mm. Seven dry observed days take the ledger to 140.25 mm,
     * which is past RAW — IRRIGATE_TODAY. The same dry window is also a
     * seven-day total of 0 mm, which is the DRY_SPELL trigger.
     */
    const seedJobScenario = async () => {
      await CropRegistry.create(registryDoc());
      await WeatherSnapshot.create(snapshotDoc({ daily: dailySeries(JOB_ASOF) }));

      const farm = await createFarm(alice.accessToken);
      const crop = await Crop.create({
        userId: alice.user.id,
        farmId: farm.id,
        cropCode: 'WHEAT',
        sowingDate: new Date(JOB_ASOF.getTime() - 80 * MS_PER_DAY),
        status: 'active',
        waterBalance: { depletionMm: 100, initialized: true },
      });

      return { farm, crop };
    };

    it('writes a feed for a user with an active crop, reading only cached data', async () => {
      const { crop } = await seedJobScenario();

      const report = await runFeedRefresh({ asOf: JOB_ASOF, userIds: [alice.user.id] });

      assert.equal(report.ok, true, JSON.stringify(report.failures));
      assert.equal(report.users, 1);
      assert.ok(report.inserted > 0, 'the job wrote nothing');
      assert.equal(report.evicted, 0);

      const stored = await Recommendation.find({ userId: alice.user.id }).lean();
      assert.equal(stored.length, report.inserted);

      const irrigation = stored.find((item) => item.type === 'irrigation');
      assert.ok(irrigation, 'no irrigation item was materialised');
      assert.equal(irrigation.priority, 'HIGH');
      assert.equal(irrigation.source, 'RULE_ENGINE');
      assert.equal(irrigation.data.verdict, 'IRRIGATE_TODAY');
      assert.equal(String(irrigation.cropId), String(crop._id));
      // R12: no recommendation without trace data.
      assert.ok(Array.isArray(irrigation.data.trace) && irrigation.data.trace.length > 0);
      assert.equal(
        irrigation.dedupKey,
        `${alice.user.id}|irrigation|${crop._id}|IRRIGATE_TODAY|2026-08-13`,
      );

      const risk = stored.find((item) => item.type === 'weather-risk');
      assert.ok(risk, 'the dry window raised no risk');
      assert.equal(risk.data.riskType, 'DRY_SPELL');
      assert.ok(risk.data.trace, 'the risk carries no trace numbers');
    });

    it('is idempotent: a second run at the same asOf upserts and inserts nothing', async () => {
      await seedJobScenario();

      const first = await runFeedRefresh({ asOf: JOB_ASOF, userIds: [alice.user.id] });
      const countAfterFirst = await Recommendation.countDocuments({});
      assert.ok(countAfterFirst > 0);
      assert.equal(first.inserted, countAfterFirst);

      const second = await runFeedRefresh({ asOf: JOB_ASOF, userIds: [alice.user.id] });

      assert.equal(second.ok, true, JSON.stringify(second.failures));
      assert.equal(second.inserted, 0, 'the re-run duplicated items instead of upserting');
      assert.ok(second.updated > 0, 'the re-run touched nothing at all');
      assert.equal(
        await Recommendation.countDocuments({}),
        countAfterFirst,
        'the document count moved on a re-run',
      );

      // The keys — not merely the count — are the same set.
      const keys = await Recommendation.distinct('dedupKey');
      assert.equal(keys.length, countAfterFirst);
    });

    it('writes nothing for a user with no active crops', async () => {
      await CropRegistry.create(registryDoc());
      const farm = await createFarm(alice.accessToken);
      await plantCrop(alice, farm, { status: 'harvested' });

      const report = await runFeedRefresh({ asOf: JOB_ASOF, userIds: [alice.user.id] });

      assert.equal(report.ok, true);
      assert.equal(report.candidates, 0);
      assert.equal(await Recommendation.countDocuments({}), 0);
    });

    it('scopes each user’s feed to their own crops', async () => {
      await seedJobScenario();

      await runFeedRefresh({
        asOf: JOB_ASOF,
        userIds: [alice.user.id, bob.user.id],
      });

      assert.ok((await Recommendation.countDocuments({ userId: alice.user.id })) > 0);
      assert.equal(await Recommendation.countDocuments({ userId: bob.user.id }), 0);
    });
  });

  // ── expiry job ─────────────────────────────────────────────────────────────

  describe('runExpiry', () => {
    it(`purges only what lapsed more than ${FEED_PURGE_GRACE_DAYS} days ago`, async () => {
      const at = (days) => new Date(JOB_ASOF.getTime() + days * MS_PER_DAY);

      const [ancient, justPastGrace, recentlyLapsed, atCutoff, active] = await seedRecommendations([
        recommendationDoc(alice, { validUntil: at(-30) }),
        recommendationDoc(alice, { validUntil: at(-FEED_PURGE_GRACE_DAYS - 1) }),
        recommendationDoc(alice, { validUntil: at(-2) }),
        // Exactly at the cutoff: the filter is `< cutoff`, so it survives.
        recommendationDoc(alice, { validUntil: at(-FEED_PURGE_GRACE_DAYS) }),
        recommendationDoc(alice, { validUntil: at(1) }),
      ]);

      const report = await runExpiry({ asOf: JOB_ASOF });

      assert.equal(report.ok, true);
      assert.equal(report.graceDays, FEED_PURGE_GRACE_DAYS);
      assert.equal(report.purgedRecommendations, 2);

      assert.equal(await Recommendation.countDocuments({ _id: ancient._id }), 0);
      assert.equal(await Recommendation.countDocuments({ _id: justPastGrace._id }), 0);

      // The grace period is the point: a farmer opening the app on Tuesday can
      // still see what Monday told them, in the history endpoint.
      for (const survivor of [recentlyLapsed, atCutoff, active]) {
        assert.equal(
          await Recommendation.countDocuments({ _id: survivor._id }),
          1,
          'an item inside the grace window was purged',
        );
      }
    });

    it('leaves a feed with nothing to purge untouched', async () => {
      await seedRecommendations([recommendationDoc(alice, { validUntil: daysAhead(1) })]);

      const report = await runExpiry({ asOf: JOB_ASOF });

      assert.equal(report.purgedRecommendations, 0);
      assert.equal(await Recommendation.countDocuments({}), 1);
    });
  });

  // ── p95 sample ─────────────────────────────────────────────────────────────

  /**
   * docs/testing/api-testing.md: "dashboard = seeded scenario asserting priority
   * order + dedupe + p95 sanity (<300ms local against memory server)". The
   * deployed contract is p95 < 800ms; this is the local gate.
   *
   * The second claim is the one that protects the contract as data grows: the
   * endpoint's query budget is FIXED (1 feed · 1 farms · 1 crops · 1 registry ·
   * 1 snapshots · 1 latest-market), so thirty crops must not cost thirty times
   * one crop. Both scenarios are warmed before measurement so the comparison is
   * between steady states rather than between a cold and a hot process.
   */
  describe('p95 · GET /dashboard under a realistic load', () => {
    const WARMUP = 3;
    const SAMPLES = 30;

    const measure = async (token) => {
      for (let i = 0; i < WARMUP; i += 1) await getDashboard(token);

      const samples = [];
      for (let i = 0; i < SAMPLES; i += 1) {
        const startedAt = process.hrtime.bigint();
        const res = await server.request(DASHBOARD, { token });
        samples.push(Number(process.hrtime.bigint() - startedAt) / 1e6);
        assert.equal(res.status, 200, res.text);
      }
      return samples;
    };

    it('stays under 300ms and does not scale with the number of crops', async () => {
      await CropRegistry.create([registryDoc(), registryDoc({ cropCode: 'TOMATO' })]);
      await WeatherSnapshot.create(snapshotDoc());

      // ── Baseline: one farm, one crop, the same feed volume ────────────────
      const firstFarm = await createFarm(alice.accessToken, { name: 'Field 0' });
      await plantCrop(alice, firstFarm);

      await seedRecommendations(
        Array.from({ length: 40 }, (_, index) =>
          recommendationDoc(alice, {
            priority: ['CRITICAL', 'HIGH', 'MEDIUM', 'INFO'][index % 4],
            type: index % 3 === 0 ? 'weather-risk' : 'irrigation',
            source: index % 3 === 0 ? 'WEATHER' : 'RULE_ENGINE',
            farmId: firstFarm.id,
            createdAt: daysAgo(index / 48),
          }),
        ),
      );

      const smallSamples = await measure(alice.accessToken);

      // ── Scale up to five farms and thirty active crops ────────────────────
      const farms = [firstFarm];
      for (let i = 1; i < 5; i += 1) {
        farms.push(await createFarm(alice.accessToken, { name: `Field ${i}` }));
      }

      await Crop.insertMany(
        Array.from({ length: 29 }, (_, index) => ({
          userId: alice.user.id,
          farmId: farms[index % farms.length].id,
          cropCode: index % 2 === 0 ? 'WHEAT' : 'TOMATO',
          sowingDate: daysAgo(20 + (index % 60)),
          status: 'active',
        })),
      );

      const scale = {
        farms: await Farm.countDocuments({ userId: alice.user.id }),
        crops: await Crop.countDocuments({ userId: alice.user.id, status: 'active' }),
        recommendations: await Recommendation.countDocuments({ userId: alice.user.id }),
      };
      assert.deepEqual(scale, { farms: 5, crops: 30, recommendations: 40 });

      const largeSamples = await measure(alice.accessToken);

      const p50 = percentile(largeSamples, 50);
      const p95 = percentile(largeSamples, 95);
      const max = Math.max(...largeSamples);
      const smallP95 = percentile(smallSamples, 95);

      // Recorded so the number can be copied into the implementation log.
      // eslint-disable-next-line no-console -- required deliverable: the measured p95 is reported, not asserted away
      console.log(
        `[p95] GET /dashboard n=${SAMPLES} (after ${WARMUP} warm-ups) ` +
          `p50=${p50.toFixed(1)}ms p95=${p95.toFixed(1)}ms max=${max.toFixed(1)}ms ` +
          `| scale: ${scale.farms} farms, ${scale.crops} active crops, ` +
          `${scale.recommendations} recommendations, 1 user ` +
          `| 1-crop baseline p95=${smallP95.toFixed(1)}ms`,
      );

      // The payload really was the large one, not an empty page served fast.
      const data = await getDashboard(alice.accessToken);
      assert.equal(data.cropCards.length, 30);
      assert.equal(data.feed.length, FEED_MAX_ACTIVE_PER_USER);

      assert.ok(p95 < 300, `p95 ${p95.toFixed(1)}ms exceeded the 300ms local gate`);

      // No N+1: thirty crops cost the same round trips as one, so the only
      // growth is in-memory work. The 2ms floor keeps a sub-millisecond
      // baseline from turning scheduler noise into a failure; a per-crop query
      // would cost tens of milliseconds and blow through it regardless.
      const budget = 3 * Math.max(smallP95, 2);
      assert.ok(
        p95 <= budget,
        `p95 grew from ${smallP95.toFixed(1)}ms (1 crop) to ${p95.toFixed(1)}ms (30 crops) — ` +
          'the endpoint appears to query per crop',
      );
    });
  });
});
