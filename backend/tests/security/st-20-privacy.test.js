/**
 * ST-20 — Community privacy [blocking].
 *
 * docs/community/community-alerts.md ("privacy test: serialize every API
 * payload and assert zero user-identifying fields") and ADR-016.
 *
 * The four invariants under test, each of which fails silently if it is only
 * asserted at the top level of a payload:
 *   1. nothing a community surface serves identifies a reporter — at any depth;
 *   2. a farmer who has not consented is absent from the aggregation *input*,
 *      not merely from its output;
 *   3. one farmer's report produces no externally visible document at all;
 *   4. `communityAlerts` carries counts, never free text from a report.
 *
 * The scanner below therefore walks the serialized JSON recursively and checks
 * both key names and values, and its own self-tests prove it would catch a
 * violation buried inside a nested array — a shallow check would pass all of
 * this while leaking.
 *
 * Real mongod, one fixed `asOf`, no fake timers (ADR-022).
 */
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { COMMUNITY_MIN_FARMERS_INFO } from '../../src/config/constants.js';
import {
  COMMUNITY_FEED_TYPE,
  eligibleReports,
  groupReports,
  runCommunityAggregate,
} from '../../src/jobs/communityAggregate.js';
import {
  CommunityAlert,
  Crop,
  CropHealthLog,
  Farm,
  Recommendation,
  User,
} from '../../src/models/index.js';
import { listCommunityAlerts, toCommunityAlertJSON } from '../../src/services/communityService.js';
import { uniqueEmail } from '../factories/index.js';
import { clearCollections, startTestDatabase, stopTestDatabase } from '../helpers/db.js';

const MS_PER_DAY = 86_400_000;
const ASOF = new Date('2026-08-13T06:30:00.000Z'); // 12:00 IST
const daysAgo = (days) => new Date(ASOF.getTime() - days * MS_PER_DAY);

const DISTRICT = 'Nashik';
const STATE = 'Maharashtra';
const CROP = 'TOMATO';
const DISEASE = 'EARLY_BLIGHT';

// ── The scanner ──────────────────────────────────────────────────────────────

/**
 * Any key that could name, locate or link back to a person, their land or their
 * photographs. Matched case-insensitively as a substring, so `reporterUserId`
 * and `farmIdList` are caught as readily as `userId`.
 */
const IDENTIFYING_KEY =
  /user|email|phone|name|farmId|cropId|_id|imageUrl|publicId|lat|lon|description/i;

/** Depth-first walk over already-serialized JSON. */
function walk(node, path, visit) {
  if (Array.isArray(node)) {
    node.forEach((entry, index) => walk(entry, `${path}[${index}]`, visit));
    return;
  }
  if (node !== null && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      visit({ kind: 'key', key, path: `${path}.${key}` });
      walk(value, `${path}.${key}`, visit);
    }
    return;
  }
  visit({ kind: 'value', value: node, path });
}

/**
 * Serializes `payload` the way an HTTP response would, then reports every
 * identifying key name and every forbidden value found anywhere inside it.
 *
 * @param {unknown} payload
 * @param {{forbiddenValues?: unknown[], checkKeys?: boolean}} [options]
 * @returns {string[]} one line per offence; empty means clean
 */
function scanForIdentity(payload, { forbiddenValues = [], checkKeys = true } = {}) {
  const serialized = JSON.parse(JSON.stringify(payload));
  const forbidden = new Set(
    forbiddenValues
      // A fixture field that happens to be unset must not enter the set as the
      // string "undefined", which would then match nothing and hide a real leak.
      .filter((value) => value !== null && value !== undefined && value !== '')
      .map((value) => String(value)),
  );
  const offences = [];

  walk(serialized, '$', (node) => {
    if (node.kind === 'key' && checkKeys && IDENTIFYING_KEY.test(node.key)) {
      offences.push(`identifying key at ${node.path}`);
    }
    if (node.kind === 'value' && node.value !== null && forbidden.has(String(node.value))) {
      offences.push(`identifying value at ${node.path}: ${String(node.value)}`);
    }
  });

  return offences;
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

let seq = 0;

/**
 * Every fixture string is deliberately distinctive, so a leak is detected by
 * value and not only by key name — a district called "Nashik" appearing in a
 * payload is correct, a farm called "FieldOfReporter-3" never is.
 */
async function seedFarmer({ consent = true, district = DISTRICT, cropCode = CROP } = {}) {
  seq += 1;
  const user = await User.create({
    name: `ReporterPerson-${seq}-${randomUUID().slice(0, 8)}`,
    email: uniqueEmail(`reporter-${seq}`),
    passwordHash: `not-a-real-hash-${seq}`, // pragma: allowlist-secret — fabricated fixture value
    phone: `+91900000${String(seq).padStart(4, '0')}`,
    communityConsent: consent,
  });

  const farm = await Farm.create({
    userId: user._id,
    name: `FieldOfReporter-${seq}-${randomUUID().slice(0, 8)}`,
    location: { lat: 20.0059, lon: 73.7897, state: STATE, district, source: 'gps' },
    sizeValue: 2,
    sizeUnit: 'acre',
    soilType: 'black',
    irrigationMethod: 'drip',
  });

  const crop = await Crop.create({
    userId: user._id,
    farmId: farm._id,
    cropCode,
    variety: `VarietyOfReporter-${seq}`,
    sowingDate: daysAgo(40),
    status: 'active',
  });

  return { user, farm, crop };
}

async function seedReport(farmer, { description, diseaseCode = DISEASE } = {}) {
  const log = await CropHealthLog.create({
    userId: farmer.user._id,
    cropId: farmer.crop._id,
    farmId: farmer.farm._id,
    imageUrl: `https://images.invalid/${randomUUID()}.jpg`,
    imagePublicId: `him1096-test/${randomUUID()}`,
    description,
    analysis: { source: 'ml', diseaseCode, confidence: 0.93, modelVersion: 'fixture-v1' },
    sharedToCommunity: true,
    status: 'analyzed',
  });

  await CropHealthLog.collection.updateOne({ _id: log._id }, { $set: { createdAt: daysAgo(1) } });

  return log;
}

/** Everything about a person that must never appear in a community payload. */
function identityOf(farmer, extras = []) {
  return [
    String(farmer.user._id),
    farmer.user.name,
    farmer.user.email,
    farmer.user.phone,
    String(farmer.farm._id),
    farmer.farm.name,
    String(farmer.crop._id),
    farmer.crop.variety,
    farmer.farm.location.lat,
    farmer.farm.location.lon,
    ...extras,
  ];
}

describe('ST-20 · community privacy', () => {
  before(async () => {
    await startTestDatabase();
  });

  after(async () => {
    await stopTestDatabase();
  });

  beforeEach(async () => {
    await clearCollections();
  });

  describe('the scanner itself', () => {
    it('finds an identifying key nested inside objects and arrays', () => {
      assert.ok(scanForIdentity({ a: { b: { userId: 'x' } } }).length > 0);
      assert.ok(scanForIdentity({ a: [{ b: [{ email: 'x' }] }] }).length > 0);
      assert.ok(scanForIdentity([[{ deep: { farmId: 'x' } }]]).length > 0);
    });

    it('finds a forbidden value nested inside objects and arrays', () => {
      const secret = 'abc123';
      assert.ok(
        scanForIdentity({ a: { b: [{ c: secret }] } }, { forbiddenValues: [secret] }).length > 0,
      );
    });

    it('passes a payload that is genuinely clean', () => {
      assert.deepEqual(
        scanForIdentity(
          { district: DISTRICT, reportCount: 3, nested: [{ level: 'INFO' }] },
          { forbiddenValues: ['abc123'] },
        ),
        [],
      );
    });
  });

  describe('aggregation input', () => {
    it('never loads a report from a farmer who has not consented', async () => {
      const consenting = await seedFarmer();
      await seedReport(consenting);
      const optedOut = await seedFarmer({ consent: false });
      await seedReport(optedOut);

      // The opted-out farmer's log exists and is flagged shared — the exclusion
      // has to come from the consent check, not from missing data.
      assert.equal(
        await CropHealthLog.countDocuments({
          userId: optedOut.user._id,
          sharedToCommunity: true,
        }),
        1,
      );

      const { reports, consenting: population } = await eligibleReports({ asOf: ASOF });

      assert.deepEqual(
        reports.map((report) => report.farmerId),
        [String(consenting.user._id)],
      );
      assert.ok(!population.map(String).includes(String(optedOut.user._id)));
    });

    it('drops a farmer who withdrew consent after reporting', async () => {
      const farmer = await seedFarmer();
      await seedReport(farmer);
      await User.updateOne({ _id: farmer.user._id }, { $set: { communityConsent: false } });

      const { reports } = await eligibleReports({ asOf: ASOF });

      assert.deepEqual(reports, []);
    });

    it('discards reporter identities the moment they have been counted', async () => {
      const grouped = groupReports([
        {
          farmerId: 'farmer-a',
          district: DISTRICT,
          state: STATE,
          cropCode: CROP,
          diseaseCode: DISEASE,
        },
        {
          farmerId: 'farmer-b',
          district: DISTRICT,
          state: STATE,
          cropCode: CROP,
          diseaseCode: DISEASE,
        },
      ]);

      assert.equal(grouped[0].distinctFarmers, 2);
      assert.deepEqual(scanForIdentity(grouped, { forbiddenValues: ['farmer-a', 'farmer-b'] }), []);
    });
  });

  describe('a single report is invisible', () => {
    it('produces no alert, no advisory and an empty payload', async () => {
      const lone = await seedFarmer();
      // Ten photographs from one farmer are still one farmer.
      for (let index = 0; index < 10; index += 1) {
        await seedReport(lone, { description: `observation number ${index}` });
      }
      const neighbour = await seedFarmer();

      await runCommunityAggregate({ asOf: ASOF });

      assert.equal(await CommunityAlert.countDocuments({}), 0);
      assert.equal(await Recommendation.countDocuments({}), 0);
      assert.deepEqual(await listCommunityAlerts(neighbour.user._id, { asOf: ASOF }), []);
      assert.deepEqual(await listCommunityAlerts(lone.user._id, { asOf: ASOF }), []);
    });
  });

  describe('stored aggregates', () => {
    it('carries counts and codes only — no field that could name a reporter', async () => {
      const reporters = [];
      for (let index = 0; index < COMMUNITY_MIN_FARMERS_INFO; index += 1) {
        const farmer = await seedFarmer();
        await seedReport(farmer, { description: `free text from reporter ${index}` });
        reporters.push(farmer);
      }

      await runCommunityAggregate({ asOf: ASOF });
      const stored = await CommunityAlert.find({}).lean();

      assert.equal(stored.length, 1);
      // The schema is the guarantee, so the field list is asserted exactly: a
      // field added to `communityAlerts` has to be reviewed here before it can
      // ship.
      assert.deepEqual(Object.keys(stored[0]).sort(), [
        '__v',
        '_id',
        'active',
        'createdAt',
        'cropCode',
        'diseaseCode',
        'distinctFarmers',
        'district',
        'level',
        'reportCount',
        'state',
        'updatedAt',
        'windowEnd',
        'windowStart',
      ]);

      // Values only: the stored document legitimately has its own `_id`, but no
      // reporter, farm, crop, photograph or note may appear in it.
      const forbiddenValues = reporters.flatMap((farmer) => identityOf(farmer));
      const descriptions = (await CropHealthLog.find({}).lean()).flatMap((log) => [
        log.description,
        log.imageUrl,
      ]);

      assert.deepEqual(
        scanForIdentity(stored, {
          checkKeys: false,
          forbiddenValues: [...forbiddenValues, ...descriptions],
        }),
        [],
      );
    });
  });

  describe('served payloads', () => {
    it('serves no identifying field to a recipient, at any depth', async () => {
      const reporters = [];
      for (let index = 0; index < COMMUNITY_MIN_FARMERS_INFO; index += 1) {
        const farmer = await seedFarmer();
        await seedReport(farmer, { description: `free text from reporter ${index}` });
        reporters.push(farmer);
      }
      const neighbour = await seedFarmer();

      await runCommunityAggregate({ asOf: ASOF });

      const forbiddenValues = reporters.flatMap((farmer) => identityOf(farmer));
      const payload = await listCommunityAlerts(neighbour.user._id, { asOf: ASOF });

      assert.equal(payload.length, 1);
      assert.deepEqual(scanForIdentity(payload, { forbiddenValues }), []);
      // Proves the scan ran against something real rather than an empty array.
      assert.equal(payload[0].district, DISTRICT);
      assert.equal(payload[0].reportCount, COMMUNITY_MIN_FARMERS_INFO);
    });

    it('serves the same payload for an explicitly requested district', async () => {
      for (let index = 0; index < COMMUNITY_MIN_FARMERS_INFO; index += 1) {
        await seedReport(await seedFarmer());
      }
      const outsider = await seedFarmer({ district: 'Pune' });

      await runCommunityAggregate({ asOf: ASOF });

      const payload = await listCommunityAlerts(outsider.user._id, {
        district: DISTRICT,
        state: STATE,
        asOf: ASOF,
      });

      assert.equal(payload.length, 1);
      assert.deepEqual(scanForIdentity(payload), []);
    });

    it('never serves the population counter the threshold is applied to', async () => {
      const projected = toCommunityAlertJSON({
        _id: 'abc',
        district: DISTRICT,
        state: STATE,
        cropCode: CROP,
        diseaseCode: DISEASE,
        reportCount: 4,
        distinctFarmers: 4,
        level: 'INFO',
        active: true,
        windowStart: ASOF,
        windowEnd: ASOF,
        createdAt: ASOF,
        updatedAt: ASOF,
      });

      assert.deepEqual(Object.keys(projected).sort(), [
        'cropCode',
        'diseaseCode',
        'district',
        'level',
        'reportCount',
        'state',
        'windowEnd',
        'windowStart',
      ]);
      assert.equal(projected.distinctFarmers, undefined);
    });

    it('puts no reporter identity into a fanned-out advisory', async () => {
      const reporters = [];
      for (let index = 0; index < COMMUNITY_MIN_FARMERS_INFO; index += 1) {
        const farmer = await seedFarmer();
        await seedReport(farmer, { description: `free text from reporter ${index}` });
        reporters.push(farmer);
      }
      const neighbour = await seedFarmer();

      await runCommunityAggregate({ asOf: ASOF });

      const item = await Recommendation.findOne({
        userId: neighbour.user._id,
        type: COMMUNITY_FEED_TYPE,
      }).lean();
      assert.ok(item, 'the neighbour received no advisory to inspect');

      // The advisory *content* must be identity-free by key and by value.
      assert.deepEqual(
        scanForIdentity(item.data, {
          forbiddenValues: reporters.flatMap((farmer) => identityOf(farmer)),
        }),
        [],
      );

      // The envelope legitimately carries the recipient's own ids — that is how
      // a feed item reaches them — so it is scanned by value only, and the
      // values that must not be there are every reporter's.
      const reporterValues = reporters.flatMap((farmer) => identityOf(farmer));
      const reportText = (await CropHealthLog.find({}).lean()).flatMap((log) => [
        log.description,
        log.imageUrl,
      ]);

      assert.deepEqual(
        scanForIdentity(item, {
          checkKeys: false,
          forbiddenValues: [...reporterValues, ...reportText],
        }),
        [],
      );
      assert.equal(String(item.userId), String(neighbour.user._id));
    });

    it('puts no reporter identity into any advisory, including the reporters own', async () => {
      const reporters = [];
      for (let index = 0; index < COMMUNITY_MIN_FARMERS_INFO; index += 1) {
        const farmer = await seedFarmer();
        await seedReport(farmer, { description: `free text from reporter ${index}` });
        reporters.push(farmer);
      }

      await runCommunityAggregate({ asOf: ASOF });

      const items = await Recommendation.find({ type: COMMUNITY_FEED_TYPE }).lean();
      assert.equal(items.length, COMMUNITY_MIN_FARMERS_INFO);

      for (const item of items) {
        // Every advisory's payload is scanned, not just the first: a per-target
        // build could differ between recipients.
        assert.deepEqual(
          scanForIdentity(item.data, {
            forbiddenValues: reporters.flatMap((farmer) => identityOf(farmer)),
          }),
          [],
        );
      }
    });
  });
});
