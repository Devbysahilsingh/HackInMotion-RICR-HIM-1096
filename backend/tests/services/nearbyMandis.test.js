/**
 * Nearby mandis: a mandi trades many commodities, and a crop is only a filter.
 *
 * ## The modelling mistake this guards against
 *
 * `priceSeries` is commodity-first — "where can I sell ONION?" — which is the
 * wrong opening question for a farmer looking at their local market, and, being
 * keyed on one commodity, structurally unable to show that a single mandi
 * trades seven. Nagpur APMC really does carry seven in the live feed.
 *
 * ## And the distance that must never be invented
 *
 * Agmarknet publishes no mandi coordinates — a row has state, district and a
 * market name. A kilometre figure would therefore have to be fabricated, which
 * rule 7 forbids. Proximity is expressed only as the data supports it:
 * SAME_DISTRICT or SAME_STATE. These tests assert no numeric distance is ever
 * produced.
 */
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { MarketPrice } from '../../src/models/index.js';
import { nearbyMandis } from '../../src/services/marketService.js';
import { clearCollections, startTestDatabase, stopTestDatabase } from '../helpers/db.js';

const today = () => new Date();

const row = (market, district, state, commodityCode, modalPrice, date = today()) =>
  MarketPrice.create({
    commodityCode,
    market,
    district,
    state,
    date,
    minPrice: modalPrice - 100,
    maxPrice: modalPrice + 100,
    modalPrice,
    source: 'datagovin',
    unit: 'quintal',
    fetchedAt: new Date(),
  });

describe('nearbyMandis', () => {
  before(async () => {
    await startTestDatabase();
  });

  after(async () => {
    await stopTestDatabase();
  });

  beforeEach(async () => {
    await clearCollections();

    // One mandi in the farmer's own district carrying three commodities …
    await row('Bhopal APMC', 'Bhopal', 'Madhya Pradesh', 'ONION', 1550);
    await row('Bhopal APMC', 'Bhopal', 'Madhya Pradesh', 'WHEAT', 2400);
    await row('Bhopal APMC', 'Bhopal', 'Madhya Pradesh', 'POTATO', 1200);
    // … one elsewhere in the same state …
    await row('Indore APMC', 'Indore', 'Madhya Pradesh', 'ONION', 1600);
    // … and one in a different state, which must never appear.
    await row('Nashik APMC', 'Nashik', 'Maharashtra', 'ONION', 1700);
  });

  it('groups by mandi so one mandi shows its whole basket', async () => {
    const result = await nearbyMandis({ state: 'Madhya Pradesh', district: 'Bhopal' });

    const bhopal = result.mandis.find((m) => m.market === 'Bhopal APMC');
    assert.ok(bhopal, 'the farmer’s own mandi is listed');
    assert.equal(bhopal.commodities.length, 3, 'a mandi is not one crop');
    assert.deepEqual(bhopal.commodities.map((c) => c.commodityCode).sort(), [
      'ONION',
      'POTATO',
      'WHEAT',
    ]);
  });

  it('puts the farmer’s own district first and labels proximity honestly', async () => {
    const result = await nearbyMandis({ state: 'Madhya Pradesh', district: 'Bhopal' });

    assert.equal(result.mandis[0].market, 'Bhopal APMC');
    assert.equal(result.mandis[0].proximity, 'SAME_DISTRICT');
    assert.equal(result.mandis.find((m) => m.market === 'Indore APMC').proximity, 'SAME_STATE');
  });

  it('never produces a numeric distance, because none can be sourced', async () => {
    const result = await nearbyMandis({ state: 'Madhya Pradesh', district: 'Bhopal' });

    const serialized = JSON.stringify(result);
    assert.ok(!/"distance/i.test(serialized), 'no distance field may exist');
    assert.ok(!/\bkm\b/i.test(serialized), 'and no kilometre figure may be implied');
    for (const mandi of result.mandis) {
      assert.ok(['SAME_DISTRICT', 'SAME_STATE'].includes(mandi.proximity));
    }
  });

  it('never crosses into another state', async () => {
    const result = await nearbyMandis({ state: 'Madhya Pradesh', district: 'Bhopal' });

    assert.ok(result.mandis.every((m) => m.state === 'Madhya Pradesh'));
    assert.ok(!result.mandis.some((m) => m.market === 'Nashik APMC'));
  });

  it('reports exactly what is on offer nearby', async () => {
    const result = await nearbyMandis({ state: 'Madhya Pradesh', district: 'Bhopal' });

    assert.deepEqual(result.availableCommodities, ['ONION', 'POTATO', 'WHEAT']);
    assert.equal(result.counts.mandis, 2);
    assert.equal(result.counts.inDistrict, 1);
  });

  it('treats a crop as a filter over the same place, not a new question', async () => {
    const all = await nearbyMandis({ state: 'Madhya Pradesh', district: 'Bhopal' });
    const onion = await nearbyMandis({
      state: 'Madhya Pradesh',
      district: 'Bhopal',
      commodityCode: 'ONION',
    });

    // Same location, narrowed contents — the farmer never re-picks a place.
    assert.equal(onion.scope.state, all.scope.state);
    assert.equal(onion.scope.district, all.scope.district);
    assert.ok(onion.mandis.every((m) => m.commodities.every((c) => c.commodityCode === 'ONION')));
    assert.equal(onion.mandis.length, 2, 'both mandis trade onion');
  });

  it('carries the full price triple and a real source on every observation', async () => {
    const result = await nearbyMandis({ state: 'Madhya Pradesh', district: 'Bhopal' });

    for (const mandi of result.mandis) {
      for (const c of mandi.commodities) {
        assert.ok(c.minPrice > 0 && c.modalPrice > 0 && c.maxPrice > 0);
        assert.ok(c.date instanceof Date || typeof c.date === 'string');
        assert.equal(c.source, 'datagovin', 'provenance travels with the price');
      }
    }
  });

  it('returns an honest empty result where there is no data', async () => {
    const result = await nearbyMandis({ state: 'Kerala', district: 'Wayanad' });

    assert.deepEqual(result.mandis, []);
    assert.deepEqual(result.availableCommodities, []);
    assert.equal(result.counts.mandis, 0);
    // Empty, not fabricated — the caller can say "we checked and found nothing".
    assert.equal(result.scope.state, 'Kerala');
  });

  it('keeps only the newest observation per mandi and commodity', async () => {
    const old = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    await row('Bhopal APMC', 'Bhopal', 'Madhya Pradesh', 'ONION', 999, old);

    const result = await nearbyMandis({ state: 'Madhya Pradesh', district: 'Bhopal' });
    const onion = result.mandis
      .find((m) => m.market === 'Bhopal APMC')
      .commodities.filter((c) => c.commodityCode === 'ONION');

    assert.equal(onion.length, 1, 'one row per commodity, not a history');
    assert.equal(onion[0].modalPrice, 1550, 'and it is the newest one');
  });
});
