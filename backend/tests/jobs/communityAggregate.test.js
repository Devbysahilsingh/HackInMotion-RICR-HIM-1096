/**
 * Community aggregation job (docs/community/community-alerts.md "Testing":
 * threshold edges, dupe collapse, consent filtering, window sliding, fan-out
 * targeting).
 *
 * Real mongod, no mocks: the job's idempotency claim is a claim about what a
 * second write does to a real collection, and the consent filter is a claim
 * about a real query. Neither can be proved against a stub.
 *
 * One fixed `asOf` for the whole file, passed explicitly into every run — there
 * are no fake timers in this project (ADR-022) and nothing in the job reads the
 * clock for logic.
 *
 * Every crop, disease and place below is a fixture, not an agronomic claim.
 */
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import {
  COMMUNITY_MIN_FARMERS_HIGH,
  COMMUNITY_MIN_FARMERS_INFO,
  COMMUNITY_WINDOW_DAYS,
  UNKNOWN_DISEASE_CODE,
} from '../../src/config/constants.js';
import {
  ALERT_LEVELS,
  COMMUNITY_FEED_SOURCE,
  COMMUNITY_FEED_TYPE,
  COMMUNITY_JOB_NAME,
  communityWindow,
  eligibleReports,
  groupReports,
  levelFor,
  runCommunityAggregate,
} from '../../src/jobs/communityAggregate.js';
import {
  CommunityAlert,
  Crop,
  CropHealthLog,
  CropRegistry,
  Farm,
  Recommendation,
  User,
} from '../../src/models/index.js';
import { uniqueEmail } from '../factories/index.js';
import { clearCollections, startTestDatabase, stopTestDatabase } from '../helpers/db.js';

const MS_PER_DAY = 86_400_000;

/** Fixed instant for every run: 12:00 IST, well inside its own IST day. */
const ASOF = new Date('2026-08-13T06:30:00.000Z');
const daysAgo = (days) => new Date(ASOF.getTime() - days * MS_PER_DAY);

const DISTRICT = 'Nashik';
const OTHER_DISTRICT = 'Pune';
const STATE = 'Maharashtra';
const CROP = 'TOMATO';
const OTHER_CROP = 'WHEAT';
const DISEASE = 'EARLY_BLIGHT';

let seq = 0;

/** A consenting farmer with one farm and one active planting, by default. */
async function seedFarmer({
  consent = true,
  district = DISTRICT,
  state = STATE,
  cropCode = CROP,
  status = 'active',
} = {}) {
  seq += 1;
  const user = await User.create({
    name: `Farmer ${seq}`,
    email: uniqueEmail(`farmer-${seq}`),
    passwordHash: `not-a-real-hash-${seq}`, // pragma: allowlist-secret — fabricated fixture value
    communityConsent: consent,
  });

  const farm = await Farm.create({
    userId: user._id,
    name: `Plot ${seq}`,
    location: { lat: 20.0059, lon: 73.7897, state, district, source: 'manual' },
    sizeValue: 1.5,
    sizeUnit: 'acre',
    soilType: 'black',
    irrigationMethod: 'borewell',
  });

  const crop = await Crop.create({
    userId: user._id,
    farmId: farm._id,
    cropCode,
    sowingDate: daysAgo(40),
    status,
  });

  return { user, farm, crop };
}

/**
 * One shared health report.
 *
 * `createdAt` is back-dated through the raw driver collection, not through the
 * model: Mongoose's timestamps plugin marks `createdAt` immutable, so a
 * `Model.updateOne` `$set` on it is silently stripped and the write is not even
 * acknowledged — the window tests would then all run against today's date and
 * pass for the wrong reason.
 */
async function seedReport(
  farmer,
  {
    diseaseCode = DISEASE,
    source = 'ml',
    confidence = 0.95,
    ageDays = 1,
    shared = true,
    description,
  } = {},
) {
  const log = await CropHealthLog.create({
    userId: farmer.user._id,
    cropId: farmer.crop._id,
    farmId: farmer.farm._id,
    imageUrl: `https://images.invalid/${randomUUID()}.jpg`,
    imagePublicId: `him1096-test/${randomUUID()}`,
    description,
    analysis: { source, diseaseCode, confidence, modelVersion: 'fixture-v1' },
    sharedToCommunity: shared,
    status: 'analyzed',
  });

  const stamped = await CropHealthLog.collection.updateOne(
    { _id: log._id },
    { $set: { createdAt: daysAgo(ageDays) } },
  );
  assert.equal(stamped.modifiedCount, 1, 'the report could not be back-dated');

  return log;
}

/** `count` distinct farmers, one report each. */
async function seedReporters(count, options = {}) {
  const farmers = [];
  for (let index = 0; index < count; index += 1) {
    const farmer = await seedFarmer(options.farmer);
    await seedReport(farmer, options.report);
    farmers.push(farmer);
  }
  return farmers;
}

const alerts = () => CommunityAlert.find({}).lean();
const communityItems = () => Recommendation.find({ type: COMMUNITY_FEED_TYPE }).lean();

describe('community aggregation job', () => {
  before(async () => {
    await startTestDatabase();
  });

  after(async () => {
    await stopTestDatabase();
  });

  beforeEach(async () => {
    await clearCollections();
  });

  describe('window and thresholds (pure)', () => {
    it('spans whole IST days ending with the day containing asOf', () => {
      const { windowStart, windowEnd } = communityWindow(ASOF);

      assert.equal(windowStart.toISOString(), '2026-08-06T18:30:00.000Z'); // 00:00 IST 7 Aug
      assert.equal(windowEnd.toISOString(), '2026-08-13T18:29:59.999Z'); // 23:59 IST 13 Aug
      assert.equal(
        Math.round((windowEnd.getTime() - windowStart.getTime()) / MS_PER_DAY),
        COMMUNITY_WINDOW_DAYS,
      );
    });

    it('is stable across every run inside one IST day — the basis of idempotency', () => {
      const morning = communityWindow(new Date('2026-08-13T00:30:00.000Z')); // 06:00 IST
      const night = communityWindow(new Date('2026-08-13T18:00:00.000Z')); // 23:30 IST

      assert.equal(morning.windowStart.getTime(), night.windowStart.getTime());
      assert.equal(morning.windowEnd.getTime(), night.windowEnd.getTime());
    });

    it('applies the documented threshold table', () => {
      assert.equal(levelFor(0), null);
      assert.equal(levelFor(COMMUNITY_MIN_FARMERS_INFO - 1), null);
      assert.equal(levelFor(COMMUNITY_MIN_FARMERS_INFO), ALERT_LEVELS.INFO);
      assert.equal(levelFor(COMMUNITY_MIN_FARMERS_HIGH - 1), ALERT_LEVELS.INFO);
      assert.equal(levelFor(COMMUNITY_MIN_FARMERS_HIGH), ALERT_LEVELS.HIGH);
    });

    it('counts each farmer once however many times they report', () => {
      const report = { district: DISTRICT, state: STATE, cropCode: CROP, diseaseCode: DISEASE };
      const grouped = groupReports([
        { ...report, farmerId: 'a' },
        { ...report, farmerId: 'a' },
        { ...report, farmerId: 'a' },
        { ...report, farmerId: 'b' },
      ]);

      assert.equal(grouped.length, 1);
      assert.equal(grouped[0].distinctFarmers, 2);
    });

    it('separates identically named districts in different states', () => {
      const base = { cropCode: CROP, diseaseCode: DISEASE, district: 'Bilaspur', farmerId: 'a' };
      const grouped = groupReports([
        { ...base, state: 'Chhattisgarh' },
        { ...base, state: 'Himachal Pradesh' },
      ]);

      assert.equal(grouped.length, 2);
    });
  });

  describe('threshold edges', () => {
    it(`writes nothing at ${COMMUNITY_MIN_FARMERS_INFO - 1} distinct farmers`, async () => {
      await seedReporters(COMMUNITY_MIN_FARMERS_INFO - 1);

      const report = await runCommunityAggregate({ asOf: ASOF });

      assert.equal(await CommunityAlert.countDocuments({}), 0);
      assert.equal(await Recommendation.countDocuments({}), 0);
      assert.equal(report.groups, 1);
      assert.equal(report.belowThreshold, 1);
      assert.equal(report.ok, true);
    });

    it(`raises INFO at exactly ${COMMUNITY_MIN_FARMERS_INFO}`, async () => {
      await seedReporters(COMMUNITY_MIN_FARMERS_INFO);

      const report = await runCommunityAggregate({ asOf: ASOF });
      const [alert] = await alerts();

      assert.equal(alert.level, ALERT_LEVELS.INFO);
      assert.equal(alert.distinctFarmers, COMMUNITY_MIN_FARMERS_INFO);
      assert.equal(alert.reportCount, COMMUNITY_MIN_FARMERS_INFO);
      assert.equal(alert.district, DISTRICT);
      assert.equal(alert.state, STATE);
      assert.equal(alert.cropCode, CROP);
      assert.equal(alert.diseaseCode, DISEASE);
      assert.equal(alert.active, true);
      assert.equal(report.alertsInserted, 1);
    });

    it(`stays INFO at ${COMMUNITY_MIN_FARMERS_HIGH - 1}`, async () => {
      await seedReporters(COMMUNITY_MIN_FARMERS_HIGH - 1);

      await runCommunityAggregate({ asOf: ASOF });
      const [alert] = await alerts();

      assert.equal(alert.level, ALERT_LEVELS.INFO);
      assert.equal(alert.distinctFarmers, COMMUNITY_MIN_FARMERS_HIGH - 1);
    });

    it(`escalates to HIGH at exactly ${COMMUNITY_MIN_FARMERS_HIGH}`, async () => {
      await seedReporters(COMMUNITY_MIN_FARMERS_HIGH);

      await runCommunityAggregate({ asOf: ASOF });
      const [alert] = await alerts();

      assert.equal(alert.level, ALERT_LEVELS.HIGH);
      assert.equal(alert.reportCount, COMMUNITY_MIN_FARMERS_HIGH);
    });
  });

  describe('duplicate control', () => {
    it('never alerts on one farmer, however many reports they file', async () => {
      const farmer = await seedFarmer();
      for (let index = 0; index < 10; index += 1) {
        await seedReport(farmer, { ageDays: index % 5 });
      }

      const report = await runCommunityAggregate({ asOf: ASOF });

      assert.equal(await CommunityAlert.countDocuments({}), 0);
      assert.equal(await Recommendation.countDocuments({}), 0);
      assert.equal(report.reports, 10);
      assert.equal(report.belowThreshold, 1);
    });

    it('counts one report per farmer, not one per observation', async () => {
      const farmers = await seedReporters(COMMUNITY_MIN_FARMERS_INFO);
      // The same farmer photographs the same disease five more times.
      for (let index = 0; index < 5; index += 1) {
        await seedReport(farmers[0], { ageDays: 2 });
      }

      await runCommunityAggregate({ asOf: ASOF });
      const [alert] = await alerts();

      assert.equal(alert.distinctFarmers, COMMUNITY_MIN_FARMERS_INFO);
      assert.equal(alert.reportCount, COMMUNITY_MIN_FARMERS_INFO);
    });
  });

  describe('eligibility filters', () => {
    it('excludes a farmer who never consented', async () => {
      await seedReporters(COMMUNITY_MIN_FARMERS_INFO - 1);
      const optedOut = await seedFarmer({ consent: false });
      await seedReport(optedOut);

      const report = await runCommunityAggregate({ asOf: ASOF });

      assert.equal(await CommunityAlert.countDocuments({}), 0);
      assert.equal(report.reports, COMMUNITY_MIN_FARMERS_INFO - 1);
    });

    it('excludes a farmer who withdrew consent after the report was written', async () => {
      const farmers = await seedReporters(COMMUNITY_MIN_FARMERS_INFO);

      // The log keeps `sharedToCommunity: true` — it is append-only. Consent is
      // read at run time, so withdrawal has to stop the count on its own.
      await User.updateOne({ _id: farmers[0].user._id }, { $set: { communityConsent: false } });
      const stillShared = await CropHealthLog.findOne({ userId: farmers[0].user._id }).lean();
      assert.equal(stillShared.sharedToCommunity, true);

      const report = await runCommunityAggregate({ asOf: ASOF });

      assert.equal(await CommunityAlert.countDocuments({}), 0);
      assert.equal(report.reports, COMMUNITY_MIN_FARMERS_INFO - 1);
    });

    it('excludes reports that were never shared', async () => {
      await seedReporters(COMMUNITY_MIN_FARMERS_INFO, { report: { shared: false } });

      const report = await runCommunityAggregate({ asOf: ASOF });

      assert.equal(await CommunityAlert.countDocuments({}), 0);
      assert.equal(report.reports, 0);
    });

    it('excludes rule-engine self-reports', async () => {
      await seedReporters(COMMUNITY_MIN_FARMERS_INFO, { report: { source: 'rules' } });

      const report = await runCommunityAggregate({ asOf: ASOF });

      assert.equal(await CommunityAlert.countDocuments({}), 0);
      assert.equal(report.reports, 0);
    });

    it('mixes ml and gemini but drops the rules report from the same district', async () => {
      await seedReporters(2, { report: { source: 'gemini' } });
      await seedReporters(1, { report: { source: 'ml' } });
      await seedReporters(3, { report: { source: 'rules' } });

      await runCommunityAggregate({ asOf: ASOF });
      const [alert] = await alerts();

      assert.equal(alert.distinctFarmers, COMMUNITY_MIN_FARMERS_INFO);
    });

    it('excludes reports below the confidence floor', async () => {
      await seedReporters(COMMUNITY_MIN_FARMERS_INFO, { report: { confidence: 0.79 } });

      const report = await runCommunityAggregate({ asOf: ASOF });

      assert.equal(await CommunityAlert.countDocuments({}), 0);
      assert.equal(report.reports, 0);
    });

    it('includes reports exactly at the confidence floor', async () => {
      await seedReporters(COMMUNITY_MIN_FARMERS_INFO, { report: { confidence: 0.8 } });

      await runCommunityAggregate({ asOf: ASOF });

      assert.equal(await CommunityAlert.countDocuments({}), 1);
    });

    it('never aggregates the UNKNOWN sentinel', async () => {
      await seedReporters(COMMUNITY_MIN_FARMERS_HIGH, {
        report: { diseaseCode: UNKNOWN_DISEASE_CODE },
      });

      const report = await runCommunityAggregate({ asOf: ASOF });

      assert.equal(await CommunityAlert.countDocuments({}), 0);
      assert.equal(report.reports, 0);
    });
  });

  describe('window sliding', () => {
    it('ages an 8-day-old report out of the window', async () => {
      await seedReporters(COMMUNITY_MIN_FARMERS_INFO - 1, { report: { ageDays: 1 } });
      await seedReporters(1, { report: { ageDays: 8 } });

      const report = await runCommunityAggregate({ asOf: ASOF });

      assert.equal(report.reports, COMMUNITY_MIN_FARMERS_INFO - 1);
      assert.equal(await CommunityAlert.countDocuments({}), 0);
    });

    it('keeps a report from the oldest day still inside the window', async () => {
      await seedReporters(COMMUNITY_MIN_FARMERS_INFO - 1, { report: { ageDays: 1 } });
      await seedReporters(1, { report: { ageDays: COMMUNITY_WINDOW_DAYS - 1 } });

      const report = await runCommunityAggregate({ asOf: ASOF });

      assert.equal(report.reports, COMMUNITY_MIN_FARMERS_INFO);
      assert.equal(await CommunityAlert.countDocuments({}), 1);
    });
  });

  describe('idempotency', () => {
    it('leaves identical state when run twice for the same window', async () => {
      await seedReporters(COMMUNITY_MIN_FARMERS_INFO);

      const first = await runCommunityAggregate({ asOf: ASOF });
      const afterFirst = await alerts();
      const itemsAfterFirst = await communityItems();

      const second = await runCommunityAggregate({ asOf: ASOF });
      const afterSecond = await alerts();
      const itemsAfterSecond = await communityItems();

      assert.equal(first.alertsInserted, 1);
      assert.equal(first.alertsUpdated, 0);
      assert.equal(second.alertsInserted, 0);
      assert.equal(second.alertsUpdated, 1);

      assert.equal(afterSecond.length, 1);
      assert.equal(String(afterSecond[0]._id), String(afterFirst[0]._id));
      assert.equal(afterSecond[0].reportCount, afterFirst[0].reportCount);
      assert.equal(afterSecond[0].distinctFarmers, afterFirst[0].distinctFarmers);
      assert.equal(afterSecond[0].level, afterFirst[0].level);

      assert.equal(itemsAfterSecond.length, itemsAfterFirst.length);
      assert.deepEqual(
        itemsAfterSecond.map((item) => item.dedupKey).sort(),
        itemsAfterFirst.map((item) => item.dedupKey).sort(),
      );
    });

    it('updates the same document when the count grows within the window', async () => {
      await seedReporters(COMMUNITY_MIN_FARMERS_INFO);
      await runCommunityAggregate({ asOf: ASOF });
      const [original] = await alerts();

      await seedReporters(COMMUNITY_MIN_FARMERS_HIGH - COMMUNITY_MIN_FARMERS_INFO);
      await runCommunityAggregate({ asOf: ASOF });
      const escalated = await alerts();

      assert.equal(escalated.length, 1);
      assert.equal(String(escalated[0]._id), String(original._id));
      assert.equal(escalated[0].level, ALERT_LEVELS.HIGH);
      assert.equal(escalated[0].reportCount, COMMUNITY_MIN_FARMERS_HIGH);
    });
  });

  describe('expiry and purge', () => {
    it('deactivates an alert whose window has passed and keeps the current one', async () => {
      await seedReporters(COMMUNITY_MIN_FARMERS_INFO);
      const lapsed = await CommunityAlert.create({
        district: DISTRICT,
        state: STATE,
        cropCode: OTHER_CROP,
        diseaseCode: 'FIXTURE_RUST',
        windowStart: daysAgo(9),
        windowEnd: daysAgo(3),
        reportCount: 4,
        distinctFarmers: 4,
        level: ALERT_LEVELS.INFO,
        active: true,
      });

      const report = await runCommunityAggregate({ asOf: ASOF });

      assert.equal(report.deactivated, 1);
      assert.equal((await CommunityAlert.findById(lapsed._id).lean()).active, false);
      const current = await CommunityAlert.findOne({ cropCode: CROP }).lean();
      assert.equal(current.active, true);
    });

    it('purges alerts older than the retention window', async () => {
      const ancient = await CommunityAlert.create({
        district: DISTRICT,
        state: STATE,
        cropCode: OTHER_CROP,
        diseaseCode: 'FIXTURE_RUST',
        windowStart: daysAgo(46),
        windowEnd: daysAgo(40),
        reportCount: 5,
        distinctFarmers: 5,
        level: ALERT_LEVELS.INFO,
        active: false,
      });

      const report = await runCommunityAggregate({ asOf: ASOF });

      assert.equal(report.purged, 1);
      assert.equal(await CommunityAlert.findById(ancient._id).lean(), null);
    });
  });

  describe('fan-out targeting', () => {
    it('reaches the right growers and nobody else', async () => {
      const reporters = await seedReporters(COMMUNITY_MIN_FARMERS_INFO);
      const neighbour = await seedFarmer();
      const wrongCrop = await seedFarmer({ cropCode: OTHER_CROP });
      const wrongDistrict = await seedFarmer({ district: OTHER_DISTRICT });
      const optedOut = await seedFarmer({ consent: false });
      const harvested = await seedFarmer({ status: 'harvested' });

      await runCommunityAggregate({ asOf: ASOF });

      const received = async (farmer) =>
        Recommendation.countDocuments({ userId: farmer.user._id, type: COMMUNITY_FEED_TYPE });

      assert.equal(await received(neighbour), 1);
      assert.equal(await received(wrongCrop), 0);
      assert.equal(await received(wrongDistrict), 0);
      assert.equal(await received(optedOut), 0);
      assert.equal(await received(harvested), 0);
      // Reporters grow the crop in the district too, so they are advised as well.
      for (const reporter of reporters) assert.equal(await received(reporter), 1);

      assert.equal(await Recommendation.countDocuments({}), COMMUNITY_MIN_FARMERS_INFO + 1);
    });

    it('emits a feed item carrying the level, count, window and trace', async () => {
      await seedReporters(COMMUNITY_MIN_FARMERS_HIGH);
      const neighbour = await seedFarmer();

      await runCommunityAggregate({ asOf: ASOF });

      const item = await Recommendation.findOne({
        userId: neighbour.user._id,
        type: COMMUNITY_FEED_TYPE,
      }).lean();

      assert.equal(item.source, COMMUNITY_FEED_SOURCE);
      assert.equal(item.priority, 'HIGH');
      assert.equal(item.data.level, ALERT_LEVELS.HIGH);
      assert.equal(item.data.reportCount, COMMUNITY_MIN_FARMERS_HIGH);
      assert.equal(item.data.district, DISTRICT);
      assert.equal(item.data.cropCode, CROP);
      assert.equal(item.data.diseaseCode, DISEASE);
      assert.equal(item.data.trace.reasonCode, 'COMMUNITY_OUTBREAK_HIGH');
      assert.equal(item.data.trace.windowDays, COMMUNITY_WINDOW_DAYS);
      assert.equal(new Date(item.validUntil).getTime(), communityWindow(ASOF).windowEnd.getTime());
      // The item targets the neighbour's own planting, not a reporter's.
      assert.equal(String(item.cropId), String(neighbour.crop._id));
      assert.equal(String(item.farmId), String(neighbour.farm._id));
    });

    it('does not duplicate feed items on a re-run', async () => {
      await seedReporters(COMMUNITY_MIN_FARMERS_INFO);
      await seedFarmer();

      const first = await runCommunityAggregate({ asOf: ASOF });
      const countAfterFirst = await Recommendation.countDocuments({});
      const second = await runCommunityAggregate({ asOf: ASOF });

      assert.equal(first.fanOutInserted, COMMUNITY_MIN_FARMERS_INFO + 1);
      assert.equal(first.fanOutUpdated, 0);
      assert.equal(second.fanOutInserted, 0);
      assert.equal(second.fanOutUpdated, COMMUNITY_MIN_FARMERS_INFO + 1);
      assert.equal(await Recommendation.countDocuments({}), countAfterFirst);
    });

    it('emits nothing at all when the group is below threshold', async () => {
      await seedReporters(COMMUNITY_MIN_FARMERS_INFO - 1);
      await seedFarmer();

      await runCommunityAggregate({ asOf: ASOF });

      assert.equal(await Recommendation.countDocuments({}), 0);
    });
  });

  describe('disease knowledge base', () => {
    it('passes registry inspect keys through untouched', async () => {
      await CropRegistry.create({
        cropCode: CROP,
        names: { en: 'Fixture crop', hi: 'Fixture crop' },
        supportLevel: 'SPECIALIZED',
        diseases: [
          {
            code: DISEASE,
            names: { en: 'Fixture disease', hi: 'Fixture disease' },
            inspect: ['fixtureInspectA', 'fixtureInspectB'],
          },
        ],
      });
      await seedReporters(COMMUNITY_MIN_FARMERS_INFO);

      await runCommunityAggregate({ asOf: ASOF });
      const [item] = await communityItems();

      assert.deepEqual(item.data.inspectKeys, ['fixtureInspectA', 'fixtureInspectB']);
    });

    it('still advises when the knowledge base has no entry for the disease', async () => {
      await CropRegistry.create({
        cropCode: CROP,
        names: { en: 'Fixture crop', hi: 'Fixture crop' },
        supportLevel: 'SPECIALIZED',
        diseases: [],
      });
      await seedReporters(COMMUNITY_MIN_FARMERS_INFO);

      const report = await runCommunityAggregate({ asOf: ASOF });
      const [item] = await communityItems();

      assert.equal(report.ok, true);
      assert.deepEqual(item.data.inspectKeys, []);
    });

    it('still advises when the registry has no document for the crop at all', async () => {
      await seedReporters(COMMUNITY_MIN_FARMERS_INFO);

      const report = await runCommunityAggregate({ asOf: ASOF });
      const [item] = await communityItems();

      assert.equal(report.ok, true);
      assert.deepEqual(item.data.inspectKeys, []);
    });
  });

  describe('run report', () => {
    it('returns a report rather than throwing on an empty database', async () => {
      const report = await runCommunityAggregate({ asOf: ASOF });

      assert.equal(report.job, COMMUNITY_JOB_NAME);
      assert.equal(report.startedAt, ASOF.toISOString());
      assert.equal(report.ok, true);
      assert.deepEqual(report.failures, []);
      assert.equal(typeof report.durationMs, 'number');
      assert.equal(report.reports, 0);
      assert.equal(report.groups, 0);
    });

    it('reports the consenting population and the window it used', async () => {
      await seedReporters(COMMUNITY_MIN_FARMERS_INFO);
      await seedFarmer({ consent: false });

      const report = await runCommunityAggregate({ asOf: ASOF });
      const { windowStart, windowEnd } = communityWindow(ASOF);

      assert.equal(report.consentingUsers, COMMUNITY_MIN_FARMERS_INFO);
      assert.equal(report.windowStart, windowStart.toISOString());
      assert.equal(report.windowEnd, windowEnd.toISOString());
      assert.equal(report.recipients, COMMUNITY_MIN_FARMERS_INFO);
    });

    it('separates districts into their own alerts', async () => {
      await seedReporters(COMMUNITY_MIN_FARMERS_INFO);
      await seedReporters(COMMUNITY_MIN_FARMERS_INFO, {
        farmer: { district: OTHER_DISTRICT },
      });

      const report = await runCommunityAggregate({ asOf: ASOF });
      const written = await alerts();

      assert.equal(report.groups, 2);
      assert.equal(written.length, 2);
      assert.deepEqual(
        written.map((alert) => alert.district).sort(),
        [OTHER_DISTRICT, DISTRICT].sort(),
      );
    });
  });

  describe('aggregation input', () => {
    it('carries only the five fields grouping needs', async () => {
      await seedReporters(1, { report: { description: 'leaves turning brown at the edges' } });

      const { reports } = await eligibleReports({ asOf: ASOF });

      assert.equal(reports.length, 1);
      assert.deepEqual(Object.keys(reports[0]).sort(), [
        'cropCode',
        'diseaseCode',
        'district',
        'farmerId',
        'state',
      ]);
    });
  });
});
