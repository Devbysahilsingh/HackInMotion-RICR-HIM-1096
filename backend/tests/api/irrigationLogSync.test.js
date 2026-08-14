/**
 * Offline irrigation write-sync — the idempotency contract
 * (docs/offline/offline-strategy.md, docs/api/irrigation.md).
 *
 * The queue on each client may replay a write it never saw acknowledged. What
 * makes that safe is not the client: it is the unique partial index on
 * `(userId, clientRequestId)` and the route's handling of the duplicate. This
 * suite pins the distinction the whole feature turns on —
 *
 *   same submission, delivered twice  → one row   (a replay)
 *   two waterings on the same day     → two rows  (a real event, unchanged)
 *
 * Getting the second case wrong would under-count applied water, which is the
 * more dangerous error and the reason `recordIrrigation` was non-idempotent to
 * begin with.
 */
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { CropRegistry, IrrigationLog } from '../../src/models/index.js';
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

describe('Irrigation log — offline sync idempotency', () => {
  let server;
  let token;
  let cropId;

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

    const crop = await server.request(`/api/v1/farms/${farm.body.data.farm.id}/crops`, {
      method: 'POST',
      token,
      body: { cropCode: 'TOMATO', sowingDate: isoDaysFromNow(-40) },
    });
    cropId = crop.body.data.crop.id;
  });

  const logIrrigation = (body) =>
    server.request(`/api/v1/crops/${cropId}/irrigation-log`, { method: 'POST', token, body });

  const yesterday = () => new Date(Date.now() - DAY).toISOString();

  it('records a queued write and reports it as newly created', async () => {
    const res = await logIrrigation({
      date: yesterday(),
      amountMm: 25,
      clientRequestId: 'queued-write-0001',
    });

    assert.equal(res.status, 201);
    assert.equal(res.body.data.replayed, false);
    assert.equal(res.body.data.log.amountMm, 25);
    assert.equal(await IrrigationLog.countDocuments({ cropId }), 1);
  });

  it('collapses a replay of the same submission to one row', async () => {
    const body = { date: yesterday(), amountMm: 25, clientRequestId: 'queued-write-0002' };

    const first = await logIrrigation(body);
    const second = await logIrrigation(body);

    assert.equal(first.status, 201, 'first delivery should create');
    assert.equal(first.body.data.replayed, false);

    // 200, not 201: the second request created nothing and must not say it did.
    assert.equal(second.status, 200, 'replay should not claim a creation');
    assert.equal(second.body.data.replayed, true);

    // Same row returned, so a flushing queue can drop the item confidently.
    assert.equal(second.body.data.log.id, first.body.data.log.id);
    assert.equal(
      await IrrigationLog.countDocuments({ cropId }),
      1,
      'a replay must not double-water the ledger',
    );
  });

  it('collapses two concurrent deliveries of one submission', async () => {
    const body = { date: yesterday(), amountMm: 25, clientRequestId: 'queued-write-0003' };

    // The read-then-write guard cannot catch this case — both requests pass the
    // lookup before either has written. Only the unique index can, which is why
    // it exists alongside the guard rather than instead of it.
    const [a, b] = await Promise.all([logIrrigation(body), logIrrigation(body)]);

    assert.deepEqual(
      [a.status, b.status].sort(),
      [200, 201],
      'exactly one delivery should create; the other should report a replay',
    );
    assert.equal(a.body.data.log.id, b.body.data.log.id, 'both should name the same row');
    assert.equal(
      await IrrigationLog.countDocuments({ cropId }),
      1,
      'a concurrent replay must not double-water the ledger',
    );
  });

  it('still records two genuine waterings on the same day', async () => {
    const date = yesterday();

    await logIrrigation({ date, amountMm: 10, clientRequestId: 'genuine-event-0001' });
    await logIrrigation({ date, amountMm: 15, clientRequestId: 'genuine-event-0002' });

    // The event is not the key — the submission is. Two taps, two ids, two rows.
    assert.equal(
      await IrrigationLog.countDocuments({ cropId }),
      2,
      'distinct submissions on one day must both persist',
    );
  });

  it('leaves ordinary online writes with no id unaffected', async () => {
    const date = yesterday();

    const first = await logIrrigation({ date, amountMm: 10 });
    const second = await logIrrigation({ date, amountMm: 10 });

    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    assert.equal(first.body.data.replayed, false);
    assert.equal(second.body.data.replayed, false);

    // The partial index must not treat two missing ids as a collision.
    assert.equal(await IrrigationLog.countDocuments({ cropId }), 2);
  });

  it('scopes the idempotency key to the account that wrote it', async () => {
    const sharedId = 'collision-probe-0001';
    await logIrrigation({ date: yesterday(), amountMm: 12, clientRequestId: sharedId });

    const other = await server.request('/api/v1/auth/register', {
      method: 'POST',
      body: {
        name: 'Ravi Kumar',
        email: 'ravi@example.com',
        password: 'another-long-password', // pragma: allowlist-secret — fabricated value, exists only to prove it is never leaked
        language: 'en',
      },
    });
    const otherToken = other.body.data.accessToken;

    const otherFarm = await server.request('/api/v1/farms', {
      method: 'POST',
      token: otherToken,
      body: FARM_BODY,
    });
    const otherCrop = await server.request(`/api/v1/farms/${otherFarm.body.data.farm.id}/crops`, {
      method: 'POST',
      token: otherToken,
      body: { cropCode: 'TOMATO', sowingDate: isoDaysFromNow(-40) },
    });

    // The same id from a different account is a different submission. If the
    // index were global this would 409/500 — and would also leak that the id
    // exists on some other account.
    const res = await server.request(
      `/api/v1/crops/${otherCrop.body.data.crop.id}/irrigation-log`,
      {
        method: 'POST',
        token: otherToken,
        body: { date: yesterday(), amountMm: 30, clientRequestId: sharedId },
      },
    );

    assert.equal(res.status, 201);
    assert.equal(res.body.data.replayed, false);
  });

  it('rejects a malformed idempotency key rather than indexing it', async () => {
    const res = await logIrrigation({
      date: yesterday(),
      amountMm: 25,
      clientRequestId: 'no spaces or punctuation!',
    });

    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    assert.equal(await IrrigationLog.countDocuments({ cropId }), 0);
  });
});
