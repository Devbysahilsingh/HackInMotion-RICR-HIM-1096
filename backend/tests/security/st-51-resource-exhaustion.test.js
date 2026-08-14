/**
 * ST-51 — Resource exhaustion on read paths [blocking].
 *
 * Companion to ST-50, which covers request *shape* (oversized body, malformed
 * JSON, unknown route). This file covers the other half: a well-formed,
 * authenticated, in-contract request whose cost is set by how much data the
 * system holds rather than by anything the caller owns.
 *
 * The rule these assert, stated once: **no read may return an unbounded set.**
 * A cap alone is not enough — a cap applied to the wrong sort order silently
 * changes the answer, and a cap applied silently presents a shortened series as
 * a whole one (CLAUDE.md rule 9). Each ceiling is therefore checked three ways:
 * that it binds, that it keeps the *newest* rows, and that it admits to having
 * bound.
 */
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createApp } from '../../src/app.js';
import {
  MARKET_NEARBY_SCAN_LIMIT,
  MARKET_SERIES_SCAN_LIMIT,
  PAGE_MAX,
} from '../../src/config/constants.js';
import { CropRegistry, MarketPrice } from '../../src/models/index.js';
import { startTestServer } from '../helpers/app.js';
import { clearCollections, startTestDatabase, stopTestDatabase } from '../helpers/db.js';
import { farmInput, registerUser } from '../factories/index.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Enough mandi rows to exceed both ceilings.
 *
 * Deliberately built as real-shaped data — many mandis, many commodities, many
 * days — rather than one commodity repeated, because the unbounded query was
 * unbounded in exactly that dimension: it is the *cross product* that grows
 * with the ingest.
 */
async function seedMarket({ mandis, commodities, days, state = 'Maharashtra' }) {
  const rows = [];
  const now = Date.now();

  for (let m = 0; m < mandis; m += 1) {
    for (let c = 0; c < commodities; c += 1) {
      for (let d = 0; d < days; d += 1) {
        rows.push({
          commodityCode: `C${c}`,
          state,
          district: 'Nagpur',
          market: `Mandi${m}`,
          date: new Date(now - d * MS_PER_DAY),
          minPrice: 1000,
          modalPrice: 1500,
          maxPrice: 2000,
          unit: 'quintal',
          source: 'seed',
          fetchedAt: new Date(),
        });
      }
    }
  }

  await MarketPrice.insertMany(rows, { ordered: false });
  return rows.length;
}

describe('ST-51 · resource exhaustion on read paths', () => {
  let server;
  let token;
  let farmId;

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
    const registered = await registerUser(server);
    token = registered.accessToken;

    const created = await server.request('/api/v1/farms', {
      method: 'POST',
      token,
      body: farmInput(),
    });
    farmId = created.body.data.farm.id;

    await CropRegistry.create({
      cropCode: 'C0',
      names: { en: 'C0', hi: 'C0' },
      supportLevel: 'GENERAL',
      seasons: ['KHARIF'],
      market: { commodityCode: 'C0' },
    });
  });

  // ── The price series ───────────────────────────────────────────────────────

  it('ST-51.1 · a price series is capped, and says so when it is', async () => {
    // One commodity across many mandis for the full 90-day window: the shape a
    // state-level query takes on a populated cluster.
    await seedMarket({ mandis: 30, commodities: 1, days: 90 });

    const res = await server.request('/api/v1/market/prices?commodity=C0&days=90', { token });

    assert.equal(res.status, 200);
    const { series, freshness } = res.body.data;

    assert.ok(
      series.length <= MARKET_SERIES_SCAN_LIMIT,
      `series returned ${series.length} rows, above the ${MARKET_SERIES_SCAN_LIMIT} ceiling`,
    );
    // 30 × 90 = 2,700 rows exist, so the cap must actually have bound here —
    // otherwise the assertion above would pass on an accidentally small fixture.
    assert.equal(
      freshness.truncated,
      true,
      'a shortened series did not report itself as truncated',
    );
  });

  it('ST-51.2 · capping the series keeps the newest observations, not the oldest', async () => {
    await seedMarket({ mandis: 30, commodities: 1, days: 90 });

    const res = await server.request('/api/v1/market/prices?commodity=C0&days=90', { token });
    const { series } = res.body.data;

    // The ordering contract: ascending on the wire.
    const dates = series.map((row) => new Date(row.date).getTime());
    assert.deepEqual(
      dates,
      [...dates].sort((a, b) => a - b),
      'series is not ascending by date',
    );

    // The load-bearing half. A cap on an ascending sort would have discarded
    // today and kept 90 days ago, leaving the 7- and 30-observation windows
    // describing the wrong fortnight while still looking like a valid answer.
    const newest = await MarketPrice.find({ commodityCode: 'C0' })
      .sort({ date: -1 })
      .limit(1)
      .lean();
    const newestServed = Math.max(...dates);
    assert.equal(
      newestServed,
      new Date(newest[0].date).getTime(),
      'the cap discarded the newest observations',
    );
  });

  it('ST-51.3 · an untruncated series is not falsely labelled', async () => {
    await seedMarket({ mandis: 2, commodities: 1, days: 10 });

    const res = await server.request('/api/v1/market/prices?commodity=C0&days=90', { token });

    assert.equal(res.body.data.series.length, 20);
    assert.equal(res.body.data.freshness.truncated, false);
  });

  // ── Nearby mandis ──────────────────────────────────────────────────────────

  it('ST-51.4 · nearby mandis reads a bounded number of rows', async () => {
    // 40 × 8 × 60 = 19,200 rows — every one of which used to be pulled into
    // memory to build a response of a few dozen kilobytes. The response size
    // never showed the problem; that is what made it worth a test.
    const seeded = await seedMarket({ mandis: 40, commodities: 8, days: 60 });
    assert.ok(seeded > MARKET_NEARBY_SCAN_LIMIT, 'fixture too small to exercise the ceiling');

    const res = await server.request(`/api/v1/market/nearby?farmId=${farmId}&days=90`, { token });

    assert.equal(res.status, 200);
    assert.equal(res.body.data.freshness.truncated, true);

    // The ceiling is on rows scanned, so the observable proof is that the
    // grouped result cannot exceed what that many rows could describe.
    const pairs = res.body.data.mandis.reduce((sum, m) => sum + m.commodities.length, 0);
    assert.ok(
      pairs <= MARKET_NEARBY_SCAN_LIMIT,
      `grouped ${pairs} pairs, above the ${MARKET_NEARBY_SCAN_LIMIT} row ceiling`,
    );
  });

  it('ST-51.5 · a small state is served whole and not labelled truncated', async () => {
    await seedMarket({ mandis: 3, commodities: 2, days: 5 });

    const res = await server.request(`/api/v1/market/nearby?farmId=${farmId}&days=90`, { token });

    assert.equal(res.status, 200);
    assert.equal(res.body.data.counts.mandis, 3);
    assert.equal(res.body.data.freshness.truncated, false);
  });

  // ── Pagination bounds ──────────────────────────────────────────────────────

  /**
   * `limit` was bounded from the start; `page` was not, so these two cases are
   * asserted together — the pair is the contract, and a future edit that adds a
   * ceiling to one and forgets the other should fail here.
   */
  const PAGINATED = ['/api/v1/recommendations', '/api/v1/crop-health/logs'];

  it('ST-51.6 · every paginated read rejects an out-of-range page', async () => {
    for (const path of PAGINATED) {
      for (const page of [PAGE_MAX + 1, 1e9, 1e300, 0, -1, 2.5, Number.NaN]) {
        const res = await server.request(`${path}?page=${page}`, { token });

        assert.equal(res.status, 422, `${path}?page=${page} returned ${res.status}`);
        assert.equal(res.body.error.code, 'VALIDATION_ERROR');
      }

      // Control: the ceiling itself is still a legal page, or the bound is off
      // by one and every assertion above proves only that something was refused.
      const ok = await server.request(`${path}?page=${PAGE_MAX}`, { token });
      assert.equal(ok.status, 200, `${path} refused its own maximum page`);
    }
  });

  it('ST-51.7 · every paginated read rejects an out-of-range limit', async () => {
    for (const path of PAGINATED) {
      for (const limit of [0, -1, 51, 1e9, Number.NaN, 'Infinity', 2.5]) {
        const res = await server.request(`${path}?limit=${limit}`, { token });

        assert.equal(res.status, 422, `${path}?limit=${limit} returned ${res.status}`);
        assert.equal(res.body.error.code, 'VALIDATION_ERROR');
      }
    }
  });

  /**
   * Duplicated query parameters.
   *
   * Express parses `?days=1&days=99999` into an array, and `z.coerce.number()`
   * over an array is `NaN` — so this already refuses rather than silently
   * taking one of the two. Asserted because which value wins is a classic
   * parameter-pollution bug, and "it happens to be rejected today" is not a
   * property that survives a query-parser change without a test.
   */
  it('ST-51.8 · a duplicated query parameter is refused, never silently resolved', async () => {
    const cases = [
      '/api/v1/market/prices?commodity=C0&days=1&days=99999',
      '/api/v1/recommendations?limit=5&limit=50',
      '/api/v1/recommendations?page=1&page=99999',
    ];

    for (const path of cases) {
      const res = await server.request(path, { token });
      assert.equal(res.status, 422, `${path} returned ${res.status}`);
      assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    }
  });

  it('ST-51.9 · a bracketed query parameter cannot smuggle a shape past the schema', async () => {
    for (const path of ['/api/v1/recommendations?limit[]=5', '/api/v1/recommendations?page[0]=1']) {
      const res = await server.request(path, { token });
      assert.equal(res.status, 422, `${path} returned ${res.status}`);
    }
  });

  // ── Request shape ──────────────────────────────────────────────────────────

  it('ST-51.10 · a very wide object is refused without echoing it back', async () => {
    const wide = {};
    for (let i = 0; i < 10_000; i += 1) wide[`k${i}`] = 1;

    const res = await server.request('/api/v1/farms', { method: 'POST', token, body: wide });

    assert.equal(res.status, 422);
    // The failure must not be proportional to the attack: an error body that
    // named all ten thousand rejected keys would turn a 100KB request into a
    // reflected amplification.
    assert.ok(res.text.length < 4096, `error body grew to ${res.text.length} bytes with the input`);
    assert.ok(!res.text.includes('k9999'), 'error body echoed caller-supplied key names');
  });

  it('ST-51.11 · the sanitizer depth guard fires on its own, not via a schema', async () => {
    // No operator key and no strict-schema collision, so only the depth guard
    // can reject this. ST-50.11 sends `{$ne: null}` at depth 40, which Zod
    // would refuse anyway — it never proved the guard itself runs.
    let payload = { leaf: 1 };
    for (let depth = 0; depth < 40; depth += 1) payload = { nested: payload };

    const res = await server.request('/api/v1/no-such-route', { method: 'POST', body: payload });

    assert.equal(res.status, 422);
    assert.deepEqual(res.body.error.details, [{ field: '(root)', rule: 'too_deep' }]);

    // Control: an ordinary nested body is untouched and reaches routing.
    const shallow = await server.request('/api/v1/no-such-route', {
      method: 'POST',
      body: { a: { b: { c: 1 } } },
    });
    assert.equal(shallow.status, 404);
  });
});
