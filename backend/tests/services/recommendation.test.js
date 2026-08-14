/**
 * The recommendation pipeline's new stages, tested where they are pure.
 *
 * `recommendForFarm` itself is the only part that touches Mongo, and it is
 * covered end-to-end by the API suite. Everything it composes — the season
 * resolver, the land ledger, the market gate and the engine's response to
 * market evidence — is pure, so it is tested here directly against fixtures
 * rather than through a database.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  GATE_REASONS,
  WEIGHTS,
  recommendCrops,
} from '../../src/engines/cropRec/cropRecommendation.js';
import { resolveLandAvailability } from '../../src/services/recommendation/landAvailability.js';
import {
  MARKET_BANDS,
  MARKET_UNAVAILABLE_REASONS,
  resolveMarketEvidence,
} from '../../src/services/recommendation/marketEligibility.js';
import { resolveSeason } from '../../src/services/recommendation/seasonResolver.js';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const wheat = {
  cropCode: 'WHEAT',
  names: { en: 'Wheat', hi: 'गेहूँ' },
  supportLevel: 'GENERAL',
  seasons: ['RABI'],
  soilSuitability: { black: 3, sandy: 1 },
  waterNeedMm: [400, 550],
  droughtSensitivity: 'MEDIUM',
  market: { commodityCode: 'WHEAT' },
  sourceRefs: [],
};

const gram = {
  cropCode: 'GRAM',
  names: { en: 'Gram', hi: 'चना' },
  supportLevel: 'GENERAL',
  seasons: ['RABI'],
  soilSuitability: { black: 2, sandy: 2 },
  waterNeedMm: [200, 300],
  droughtSensitivity: 'LOW',
  market: { commodityCode: 'GRAM' },
  sourceRefs: [],
};

const blackSoilBorewell = {
  soilType: 'black',
  irrigationMethod: 'borewell',
  location: { state: 'Madhya Pradesh', district: 'Bhopal' },
  sizeValue: 50,
  sizeUnit: 'acre',
};

const sandySoilRainfed = {
  soilType: 'sandy',
  irrigationMethod: 'rainfed',
  location: { state: 'Madhya Pradesh', district: 'Bhopal' },
  sizeValue: 50,
  sizeUnit: 'acre',
};

const nearbyWith = (commodities) => ({
  scope: { state: 'Madhya Pradesh', district: 'Bhopal', days: 30 },
  commodities,
  mandis: [],
});

const priceRow = (commodityCode, { daysAgo = 0, modalPrice = 2455 } = {}) => ({
  commodityCode,
  latest: {
    market: 'Bhopal',
    district: 'Bhopal',
    state: 'Madhya Pradesh',
    minPrice: modalPrice - 100,
    maxPrice: modalPrice + 100,
    modalPrice,
    unit: null,
    date: new Date(Date.now() - daysAgo * 86_400_000),
    source: 'portal',
  },
  mandiCount: 2,
  observations: 9,
  trend: 'RISING',
  changePct7d: 2.4,
});

// ── Season resolver ──────────────────────────────────────────────────────────

describe('resolveSeason · the calendar answers the question the wizard used to ask', () => {
  it('points at Rabi from an August planning date, because Kharif is already sown', () => {
    const resolved = resolveSeason({ asOf: new Date('2026-08-14T09:00:00Z') });
    assert.equal(resolved.season, 'RABI');
    assert.equal(resolved.currentSeason, 'KHARIF');
    assert.equal(resolved.sowingWindowOpen, false);
  });

  it('reports the Rabi sowing window as open in November', () => {
    const resolved = resolveSeason({ asOf: new Date('2026-11-10T09:00:00Z') });
    assert.equal(resolved.season, 'RABI');
    assert.equal(resolved.sowingWindowOpen, true);
    assert.equal(resolved.year, 2026);
  });

  it('points at Zaid from January, and dates it to the year the window falls in', () => {
    const resolved = resolveSeason({ asOf: new Date('2027-01-05T09:00:00Z') });
    assert.equal(resolved.season, 'ZAID');
    assert.equal(resolved.year, 2027);
  });

  it('always states the basis, so no screen can present a convention as a measurement', () => {
    assert.equal(resolveSeason({ asOf: new Date('2026-06-01T00:00:00Z') }).basis, 'CALENDAR_MONTH');
  });
});

// ── Land availability ────────────────────────────────────────────────────────

describe('resolveLandAvailability · the land ledger, read rather than enforced', () => {
  it('counts planned and active crops against the field and gives back harvested ground', () => {
    const land = resolveLandAvailability({ sizeValue: 50, sizeUnit: 'acre' }, [
      { cropCode: 'SOYBEAN', status: 'active', areaValue: 20, areaUnit: 'acre' },
      { cropCode: 'ONION', status: 'planned', areaValue: 15, areaUnit: 'acre' },
      { cropCode: 'WHEAT', status: 'harvested', areaValue: 10, areaUnit: 'acre' },
    ]);

    assert.equal(land.totalAcres, 50);
    assert.equal(land.allocatedAcres, 35);
    assert.equal(land.availableAcres, 15);
  });

  it('converts units rather than adding hectares to acres', () => {
    const land = resolveLandAvailability({ sizeValue: 10, sizeUnit: 'hectare' }, [
      { cropCode: 'WHEAT', status: 'active', areaValue: 1, areaUnit: 'hectare' },
    ]);

    assert.equal(land.totalAcres, 24.71);
    assert.equal(land.allocatedAcres, 2.47);
  });

  it('reports crops with no recorded area rather than counting them as zero', () => {
    const land = resolveLandAvailability({ sizeValue: 10, sizeUnit: 'acre' }, [
      { cropCode: 'ONION', status: 'active' },
    ]);

    assert.equal(land.allocatedAcres, 0);
    assert.equal(land.unmeasuredCrops, 1);
  });

  it('never reports negative free land when crops overrun the recorded field size', () => {
    const land = resolveLandAvailability({ sizeValue: 5, sizeUnit: 'acre' }, [
      { cropCode: 'WHEAT', status: 'active', areaValue: 9, areaUnit: 'acre' },
    ]);

    assert.equal(land.availableAcres, 0);
  });
});

// ── Market evidence ──────────────────────────────────────────────────────────

describe('resolveMarketEvidence · what can and cannot be priced nearby', () => {
  it('marks a crop available when a nearby mandi reported it', () => {
    const evidence = resolveMarketEvidence({
      registryCrops: [wheat],
      nearby: nearbyWith([priceRow('WHEAT')]),
    });

    const entry = evidence.get('WHEAT');
    assert.equal(entry.available, true);
    assert.equal(entry.mandi, 'Bhopal');
    assert.equal(entry.modalPrice, 2455);
    assert.equal(entry.band, MARKET_BANDS.FRESH);
    assert.equal(entry.proximity, 'SAME_DISTRICT');
  });

  it('marks a crop unavailable when no nearby mandi reported it', () => {
    const evidence = resolveMarketEvidence({
      registryCrops: [wheat, gram],
      nearby: nearbyWith([priceRow('WHEAT')]),
    });

    assert.equal(evidence.get('GRAM').available, false);
    assert.equal(evidence.get('GRAM').reason, MARKET_UNAVAILABLE_REASONS.NO_NEARBY_REPORT);
  });

  it('excludes a report past the staleness cut rather than treating it as current', () => {
    const evidence = resolveMarketEvidence({
      registryCrops: [wheat],
      nearby: nearbyWith([priceRow('WHEAT', { daysAgo: 45 })]),
    });

    assert.equal(evidence.get('WHEAT').available, false);
    assert.equal(evidence.get('WHEAT').reason, MARKET_UNAVAILABLE_REASONS.REPORT_TOO_OLD);
  });

  it('honours a caller-supplied staleness policy rather than hard-coding one', () => {
    const nearby = nearbyWith([priceRow('WHEAT', { daysAgo: 10 })]);

    assert.equal(
      resolveMarketEvidence({ registryCrops: [wheat], nearby }).get('WHEAT').available,
      true,
    );
    assert.equal(
      resolveMarketEvidence({ registryCrops: [wheat], nearby, staleAfterDays: 7 }).get('WHEAT')
        .available,
      false,
    );
  });

  it('bands a week-old report as OLDER, not as fresh', () => {
    const evidence = resolveMarketEvidence({
      registryCrops: [wheat],
      nearby: nearbyWith([priceRow('WHEAT', { daysAgo: 6 })]),
    });

    assert.equal(evidence.get('WHEAT').band, MARKET_BANDS.OLDER);
  });

  it('carries the signal engine’s trend through rather than recomputing one', () => {
    const evidence = resolveMarketEvidence({
      registryCrops: [wheat],
      nearby: nearbyWith([priceRow('WHEAT')]),
    });

    assert.equal(evidence.get('WHEAT').trend, 'RISING');
    assert.equal(evidence.get('WHEAT').changePct7d, 2.4);
  });
});

// ── The market gate inside the engine ────────────────────────────────────────

describe('recommendCrops · market availability is a hard eligibility gate', () => {
  const registryCrops = [wheat, gram];

  it('excludes a crop with no nearby price, with a stated reason', () => {
    const market = resolveMarketEvidence({
      registryCrops,
      nearby: nearbyWith([priceRow('WHEAT')]),
    });

    const result = recommendCrops({
      registryCrops,
      farm: blackSoilBorewell,
      season: 'RABI',
      market,
      requireMarket: true,
    });

    assert.deepEqual(
      result.recommendations.map((entry) => entry.cropCode),
      ['WHEAT'],
    );

    const gated = result.excluded.find((entry) => entry.cropCode === 'GRAM');
    assert.equal(gated.reason, GATE_REASONS.MARKET_UNAVAILABLE);
    assert.equal(gated.reasonKey, 'cropRec.gateMarket');
  });

  it('ranks a crop once a nearby price exists for it', () => {
    const market = resolveMarketEvidence({
      registryCrops,
      nearby: nearbyWith([priceRow('WHEAT'), priceRow('GRAM', { modalPrice: 5100 })]),
    });

    const result = recommendCrops({
      registryCrops,
      farm: blackSoilBorewell,
      season: 'RABI',
      market,
      requireMarket: true,
    });

    assert.deepEqual(result.recommendations.map((entry) => entry.cropCode).sort(), [
      'GRAM',
      'WHEAT',
    ]);
  });

  it('leaves every crop rankable when the caller does not require market evidence', () => {
    // The season wizard's contract: it has no farm location and therefore no
    // mandis, and gating it would silently empty it.
    const result = recommendCrops({ registryCrops, farm: blackSoilBorewell, season: 'RABI' });

    assert.equal(result.recommendations.length, 2);
    assert.equal(
      result.excluded.some((entry) => entry.reason === GATE_REASONS.MARKET_UNAVAILABLE),
      false,
    );
  });

  it('gates on market ahead of soil, so an unrankable crop is not blamed on its soil', () => {
    const cropOnWrongSoil = { ...wheat, soilSuitability: { sandy: 0 } };

    const result = recommendCrops({
      registryCrops: [cropOnWrongSoil],
      farm: sandySoilRainfed,
      season: 'RABI',
      market: new Map([['WHEAT', { available: false, reason: 'NO_NEARBY_REPORT' }]]),
      requireMarket: true,
    });

    assert.equal(result.excluded[0].reason, GATE_REASONS.MARKET_UNAVAILABLE);
  });

  it('attaches the market evidence to the recommendation without scoring it', () => {
    const market = resolveMarketEvidence({
      registryCrops: [wheat],
      nearby: nearbyWith([priceRow('WHEAT')]),
    });

    const withMarket = recommendCrops({
      registryCrops: [wheat],
      farm: blackSoilBorewell,
      season: 'RABI',
      market,
      requireMarket: true,
    });
    const withoutMarket = recommendCrops({
      registryCrops: [wheat],
      farm: blackSoilBorewell,
      season: 'RABI',
    });

    assert.equal(withMarket.recommendations[0].market.modalPrice, 2455);
    assert.equal(withoutMarket.recommendations[0].market, null);

    // The documented weights decide the score; market decides eligibility only.
    assert.equal(withMarket.recommendations[0].score, withoutMarket.recommendations[0].score);
  });

  it('does not add a fifth weight — the published four still sum to 1', () => {
    assert.deepEqual(WEIGHTS, { season: 0.3, soil: 0.25, water: 0.3, temp: 0.15 });
  });
});

// ── Farm-specificity ─────────────────────────────────────────────────────────

describe('recommendCrops · two fields do not get one answer', () => {
  it('scores the same crop differently on different soil', () => {
    const market = resolveMarketEvidence({
      registryCrops: [wheat],
      nearby: nearbyWith([priceRow('WHEAT')]),
    });
    const args = { registryCrops: [wheat], season: 'RABI', market, requireMarket: true };

    const onBlack = recommendCrops({ ...args, farm: blackSoilBorewell });
    const onSandy = recommendCrops({
      ...args,
      farm: { ...blackSoilBorewell, soilType: 'sandy' },
    });

    assert.ok(
      onBlack.recommendations[0].score > onSandy.recommendations[0].score,
      'black soil publishes 3/3 for wheat and sandy publishes 1/3',
    );
  });

  it('scores the same crop differently on a different water source', () => {
    const market = resolveMarketEvidence({
      registryCrops: [wheat],
      nearby: nearbyWith([priceRow('WHEAT')]),
    });
    const args = { registryCrops: [wheat], season: 'RABI', market, requireMarket: true };

    const irrigated = recommendCrops({ ...args, farm: blackSoilBorewell });
    const rainfed = recommendCrops({
      ...args,
      farm: { ...blackSoilBorewell, irrigationMethod: 'rainfed' },
    });

    // Rainfed has no district rainfall normal to divide the need by, so water
    // drops out of the ranking entirely rather than being guessed at.
    assert.equal(irrigated.recommendations[0].factors.water.evidence, 'SOURCED');
    assert.equal(rainfed.recommendations[0].factors.water.evidence, 'MISSING');
    assert.ok(
      irrigated.recommendations[0].evidenceRatio > rainfed.recommendations[0].evidenceRatio,
    );
  });

  it('excludes a crop whose published calendar does not carry the resolved season', () => {
    const market = resolveMarketEvidence({
      registryCrops: [wheat],
      nearby: nearbyWith([priceRow('WHEAT')]),
    });

    const result = recommendCrops({
      registryCrops: [wheat],
      farm: blackSoilBorewell,
      season: 'KHARIF',
      market,
      requireMarket: true,
    });

    assert.equal(result.recommendations.length, 0);
    assert.equal(result.excluded[0].reason, GATE_REASONS.SEASON_MISMATCH);
  });

  it('returns an empty ranking rather than a fabricated one when nothing is priceable', () => {
    const result = recommendCrops({
      registryCrops: [wheat, gram],
      farm: blackSoilBorewell,
      season: 'RABI',
      market: resolveMarketEvidence({ registryCrops: [wheat, gram], nearby: nearbyWith([]) }),
      requireMarket: true,
    });

    assert.deepEqual(result.recommendations, []);
    assert.equal(result.excluded.length, 2);
    for (const entry of result.excluded) {
      assert.equal(entry.reason, GATE_REASONS.MARKET_UNAVAILABLE);
      assert.equal(entry.score, undefined, 'an excluded crop never carries a score');
    }
  });
});
