/**
 * Index build assertion (MASTER-TODO Phase 1: "✔ index build assertion test").
 *
 * Runs against a real mongod, not a mock: uniqueness, partial filters and TTL
 * declarations are server behaviour, and a mocked assertion would prove
 * nothing about the cluster the app actually deploys to.
 *
 * Every expectation below is transcribed from docs/database/indexes.md.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { mongoose } from '../../src/config/db.js';
import { COLLECTIONS } from '../../src/models/index.js';
import { startTestDatabase, stopTestDatabase } from '../helpers/db.js';

/** model → expected declared indexes (excluding the automatic `_id_`). */
const EXPECTED = {
  User: [{ name: 'email_unique', key: { email: 1 }, unique: true }],
  RefreshToken: [
    { name: 'tokenHash_unique', key: { tokenHash: 1 }, unique: true },
    { name: 'expiresAt_ttl', key: { expiresAt: 1 }, expireAfterSeconds: 0 },
    { name: 'familyId', key: { familyId: 1 } },
    { name: 'userId', key: { userId: 1 } },
  ],
  Farm: [{ name: 'userId', key: { userId: 1 } }],
  Crop: [
    { name: 'userId_farmId', key: { userId: 1, farmId: 1 } },
    { name: 'cropCode', key: { cropCode: 1 } },
  ],
  CropRegistry: [{ name: 'cropCode_unique', key: { cropCode: 1 }, unique: true }],
  CropHealthLog: [
    { name: 'userId_cropId_createdAt', key: { userId: 1, cropId: 1, createdAt: -1 } },
    {
      name: 'shared_createdAt',
      key: { sharedToCommunity: 1, createdAt: 1 },
      partialFilterExpression: { sharedToCommunity: true },
    },
  ],
  IrrigationLog: [
    { name: 'cropId_date', key: { cropId: 1, date: -1 } },
    { name: 'userId_date', key: { userId: 1, date: -1 } },
  ],
  WeatherSnapshot: [
    { name: 'locationKey_source_unique', key: { locationKey: 1, source: 1 }, unique: true },
    { name: 'expiresAt', key: { expiresAt: 1 } },
  ],
  MarketPrice: [
    {
      name: 'commodity_market_date_unique',
      key: { commodityCode: 1, market: 1, date: 1 },
      unique: true,
    },
    { name: 'commodity_district_date', key: { commodityCode: 1, district: 1, date: -1 } },
  ],
  Recommendation: [
    { name: 'feed', key: { userId: 1, acknowledgedAt: 1, priority: 1, createdAt: -1 } },
    { name: 'validUntil', key: { validUntil: 1 } },
    // Added in P2-7: the feed job's idempotent upsert target.
    { name: 'dedupKey_unique', key: { dedupKey: 1 }, unique: true },
  ],
  CommunityAlert: [
    { name: 'district_cropCode_active', key: { district: 1, cropCode: 1, active: 1 } },
  ],
  YieldEstimate: [{ name: 'userId_cropId', key: { userId: 1, cropId: 1 } }],
  AuditLog: [{ name: 'ttl_30d', key: { createdAt: 1 }, expireAfterSeconds: 2592000 }],
  SeedMeta: [{ name: 'seedName_unique', key: { seedName: 1 }, unique: true }],
};

describe('Mongoose models · index build assertion', () => {
  before(async () => {
    await startTestDatabase();
  });

  after(async () => {
    await stopTestDatabase();
  });

  it('registers all 14 documented collections', () => {
    const registered = mongoose.modelNames().map((name) => mongoose.model(name).collection.name);
    for (const collection of COLLECTIONS) {
      assert.ok(registered.includes(collection), `collection ${collection} is not registered`);
    }
    assert.equal(registered.length, 14, `expected 14 models, got ${registered.length}`);
  });

  for (const [modelName, expectedIndexes] of Object.entries(EXPECTED)) {
    it(`${modelName} · builds its declared indexes`, async () => {
      const built = await mongoose.model(modelName).collection.indexes();
      const byName = new Map(built.map((index) => [index.name, index]));

      for (const expected of expectedIndexes) {
        const actual = byName.get(expected.name);
        assert.ok(actual, `${modelName}: index "${expected.name}" was not built`);

        assert.deepEqual(
          actual.key,
          expected.key,
          `${modelName}.${expected.name}: wrong keys or key order`,
        );

        assert.equal(
          actual.unique ?? false,
          expected.unique ?? false,
          `${modelName}.${expected.name}: uniqueness mismatch`,
        );

        assert.equal(
          actual.expireAfterSeconds,
          expected.expireAfterSeconds,
          `${modelName}.${expected.name}: TTL mismatch`,
        );

        if (expected.partialFilterExpression) {
          assert.deepEqual(
            actual.partialFilterExpression,
            expected.partialFilterExpression,
            `${modelName}.${expected.name}: partial filter mismatch`,
          );
        }
      }

      // Nothing undeclared: an index nobody asked for costs M0 memory.
      const declaredNames = new Set(expectedIndexes.map((index) => index.name));
      const extra = built
        .map((index) => index.name)
        .filter((name) => name !== '_id_' && !declaredNames.has(name));
      assert.deepEqual(extra, [], `${modelName}: undeclared indexes present`);
    });
  }

  it('creates a TTL index on exactly the two collections that should have one', async () => {
    const withTtl = [];
    for (const name of mongoose.modelNames()) {
      const indexes = await mongoose.model(name).collection.indexes();
      if (indexes.some((index) => index.expireAfterSeconds !== undefined)) {
        withTtl.push(mongoose.model(name).collection.name);
      }
    }
    // weatherSnapshots.expiresAt and recommendations.validUntil are
    // deliberately NOT TTL — stale caches must survive to be served.
    assert.deepEqual(withTtl.sort(), ['auditLogs', 'refreshTokens']);
  });

  it('enforces uniqueness at the server, not just in the schema', async () => {
    const { User } = await import('../../src/models/index.js');
    await User.create({
      name: 'Ramesh',
      email: 'dup@example.com',
      passwordHash: 'x',
      language: 'hi',
    });

    await assert.rejects(
      () =>
        User.create({
          name: 'Other',
          email: 'DUP@example.com', // lowercased by the schema → same key
          passwordHash: 'y',
          language: 'en',
        }),
      (err) => err.code === 11000,
      'duplicate email was accepted',
    );
  });
});
