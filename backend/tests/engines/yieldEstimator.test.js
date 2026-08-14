/**
 * Transparent production estimator — engine unit tests.
 *
 * Pure: fixture in, object out. The numbers below are chosen so every result is
 * checkable by hand — 5 t/ha over 1 hectare is 5 tonnes, and no multiplier is
 * hiding in between. That is the point of the design as much as of the test.
 *
 * The properties under test are the honesty rules, not just the arithmetic:
 *   · never a single number — a range, always
 *   · never a fabricated coefficient — both factors report not-applied
 *   · never a converted bigha in a farmer-facing quantity
 *   · never a silent absence — every withheld figure carries a reason key
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  DISCLAIMER_VERSION,
  FACTORS,
  HECTARES_PER_ACRE,
  PRODUCTION_UNAVAILABLE,
  QUINTALS_PER_TONNE,
  estimateYield,
  toHectares,
} from '../../src/engines/yield/estimateYield.js';
import { RESOLUTION } from '../../src/engines/yield/resolveEvidence.js';
import { TIERS } from '../../src/engines/yield/lookupSchema.js';

// ── Fixtures ────────────────────────────────────────────────────────────────

const resolved = (overrides = {}) => ({
  resolution: RESOLUTION.RESOLVED,
  tier: TIERS.DISTRICT_SEASON,
  specificity: 'EXACT',
  basisKey: 'yield.basisDistrictSeason',
  entry: {
    medianYieldTHa: 5,
    sdYieldTHa: 1,
    minYieldTHa: 4,
    maxYieldTHa: 6,
    n: 5,
    years: [2018, 2019, 2020, 2021, 2022],
    latestYear: 2022,
    ...(overrides.entry ?? {}),
  },
  matched: { state: 'Punjab', district: 'Ludhiana', stateCode: '3', districtCode: '36' },
  attempts: [],
  trace: [],
  ...overrides,
});

/** One hectare, expressed in acres, so production reads straight off the median. */
const ONE_HECTARE_IN_ACRES = 1 / HECTARES_PER_ACRE;

// ── Area conversion ─────────────────────────────────────────────────────────

describe('toHectares', () => {
  it('converts acres and hectares from the land ledger’s own table', () => {
    assert.equal(toHectares(1, 'hectare').hectares, 1);
    assert.ok(Math.abs(toHectares(ONE_HECTARE_IN_ACRES, 'acre').hectares - 1) < 1e-9);
  });

  it('reads an absent unit as acres, matching the land ledger’s identity rule', () => {
    assert.equal(toHectares(1, null).hectares, toHectares(1, 'acre').hectares);
  });

  it('refuses bigha rather than converting it', () => {
    // utils/locationKey.js: the constant is the north-Indian "pucca bigha", the
    // unit varies by state, and "no recommendation ever consumes a converted
    // bigha". A land-ceiling check tolerates that slop; a quintal figure a
    // farmer sells against does not.
    const result = toHectares(3, 'bigha');
    assert.equal(result.hectares, null);
    assert.equal(result.unavailable, PRODUCTION_UNAVAILABLE.AREA_UNIT_AMBIGUOUS);
  });

  it('reports a missing or non-positive area rather than defaulting one', () => {
    for (const value of [null, undefined, 0, -1]) {
      assert.equal(toHectares(value, 'acre').unavailable, PRODUCTION_UNAVAILABLE.AREA_MISSING);
    }
  });
});

// ── The estimate ────────────────────────────────────────────────────────────

describe('estimateYield · arithmetic a farmer can check', () => {
  it('multiplies the district median by the area, and nothing else', () => {
    const result = estimateYield({ evidence: resolved(), areaValue: 1, areaUnit: 'hectare' });
    assert.equal(result.estimated, true);
    assert.equal(result.production.midTonnes, 5);
    assert.equal(result.production.midQuintals, 50);
    assert.equal(result.production.areaHectares, 1);
  });

  it('builds the range from the district’s own year-to-year spread', () => {
    const result = estimateYield({ evidence: resolved(), areaValue: 1, areaUnit: 'hectare' });
    // median 5 ± sd 1, over 1 ha.
    assert.equal(result.production.lowTonnes, 4);
    assert.equal(result.production.highTonnes, 6);
    assert.equal(result.isRange, true);
    assert.equal(result.rangeMeaningKey, 'yield.rangeTypicalYearToYear');
  });

  it('never returns a bare point estimate', () => {
    const result = estimateYield({ evidence: resolved(), areaValue: 2, areaUnit: 'acre' });
    assert.equal(result.isRange, true);
    assert.ok(result.production.lowQuintals < result.production.midQuintals);
    assert.ok(result.production.highQuintals > result.production.midQuintals);
  });

  it('never lets the low end of the range go negative', () => {
    // A district whose spread exceeds its median would otherwise produce a
    // negative harvest, which is not a thing.
    const evidence = resolved({
      entry: {
        medianYieldTHa: 1,
        sdYieldTHa: 3,
        n: 5,
        years: [2018, 2019, 2020, 2021, 2022],
        latestYear: 2022,
      },
    });
    const result = estimateYield({ evidence, areaValue: 1, areaUnit: 'hectare' });
    assert.equal(result.production.lowTonnes, 0);
    assert.equal(result.basis.lowYieldTHa, 0);
  });

  it('serves the per-area basis in both t/ha and quintal/acre', () => {
    const result = estimateYield({ evidence: resolved(), areaValue: 1, areaUnit: 'hectare' });
    assert.equal(result.basis.medianYieldTHa, 5);
    // 5 t/ha × 10 quintal/t × 0.4047 ha/acre ≈ 20.23 quintal/acre.
    assert.ok(
      Math.abs(
        result.basis.medianYieldQuintalPerAcre - 5 * QUINTALS_PER_TONNE * HECTARES_PER_ACRE,
      ) < 0.01,
    );
  });

  it('reports which years and how many observations it used', () => {
    const result = estimateYield({ evidence: resolved(), areaValue: 1, areaUnit: 'hectare' });
    assert.deepEqual(result.basis.years, [2018, 2019, 2020, 2021, 2022]);
    assert.equal(result.basis.observations, 5);
    assert.equal(result.basis.latestYear, 2022);
  });

  it('carries a disclaimer and its version on every estimate', () => {
    const result = estimateYield({ evidence: resolved(), areaValue: 1, areaUnit: 'hectare' });
    assert.equal(result.disclaimerKey, 'yield.disclaimer');
    assert.equal(result.disclaimerVersion, DISCLAIMER_VERSION);
  });
});

// ── The factors that are NOT applied ────────────────────────────────────────

describe('estimateYield · applies no coefficient it cannot source', () => {
  it('reports both spec factors as considered and not applied', () => {
    const result = estimateYield({
      evidence: resolved(),
      areaValue: 1,
      areaUnit: 'hectare',
      irrigationMethod: 'rainfed',
      healthEvents: [{ diseaseCode: 'RICE_BLAST' }],
    });

    assert.equal(result.factors.length, 2);
    for (const factor of result.factors) {
      assert.equal(factor.applied, false, `${factor.factor} was applied`);
      assert.equal(factor.multiplier, null);
      assert.match(factor.reasonKey, /^yield\./);
      // The citation travels with the refusal, so the reasoning is checkable.
      assert.ok(factor.sourceRef?.title, `${factor.factor} has no citation`);
    }
  });

  it('leaves the arithmetic untouched whatever the irrigation method is', () => {
    // The proof that no hidden multiplier exists: every method yields the same
    // number, and only the caveat changes.
    const totals = ['rainfed', 'canal', 'drip', 'unknown', null].map(
      (irrigationMethod) =>
        estimateYield({ evidence: resolved(), areaValue: 1, areaUnit: 'hectare', irrigationMethod })
          .production.midTonnes,
    );
    assert.deepEqual(totals, [5, 5, 5, 5, 5]);
  });

  it('leaves the arithmetic untouched when a disease was logged', () => {
    const withEvent = estimateYield({
      evidence: resolved(),
      areaValue: 1,
      areaUnit: 'hectare',
      healthEvents: [{ diseaseCode: 'RICE_BLAST' }, { diseaseCode: 'RICE_BLIGHT' }],
    });
    const without = estimateYield({ evidence: resolved(), areaValue: 1, areaUnit: 'hectare' });
    assert.equal(withEvent.production.midTonnes, without.production.midTonnes);
  });

  it('records the input each factor saw, even though it changed nothing', () => {
    const result = estimateYield({
      evidence: resolved(),
      areaValue: 1,
      areaUnit: 'hectare',
      irrigationMethod: 'rainfed',
      healthEvents: [{ diseaseCode: 'RICE_BLAST' }],
    });
    const irrigation = result.factors.find((f) => f.factor === FACTORS.IRRIGATION);
    const event = result.factors.find((f) => f.factor === FACTORS.PEST_DISEASE_EVENT);
    assert.equal(irrigation.inputValue, 'rainfed');
    assert.equal(event.inputValue, 1);
  });
});

// ── Qualitative caveats, which replace the multipliers ──────────────────────

describe('estimateYield · states what it cannot quantify', () => {
  const limitationKeys = (options) =>
    estimateYield({
      evidence: resolved(),
      areaValue: 1,
      areaUnit: 'hectare',
      ...options,
    }).limitations.map((l) => l.key);

  it('warns a rainfed field that the district average includes irrigated land', () => {
    assert.ok(limitationKeys({ irrigationMethod: 'rainfed' }).includes('yield.limitRainfed'));
  });

  it('says so when the irrigation method is unknown', () => {
    assert.ok(
      limitationKeys({ irrigationMethod: 'unknown' }).includes('yield.limitIrrigationUnknown'),
    );
    assert.ok(limitationKeys({ irrigationMethod: null }).includes('yield.limitIrrigationUnknown'));
  });

  it('does not warn an irrigated field about irrigation', () => {
    const keys = limitationKeys({ irrigationMethod: 'canal' });
    assert.equal(keys.includes('yield.limitRainfed'), false);
    assert.equal(keys.includes('yield.limitIrrigationUnknown'), false);
  });

  it('mentions a logged disease without pricing it', () => {
    const keys = limitationKeys({ healthEvents: [{ diseaseCode: 'RICE_BLAST' }] });
    assert.ok(keys.includes('yield.limitHealthEvent'));
  });

  it('flags stale data by its own vintage', () => {
    assert.ok(limitationKeys({ asOfYear: 2026 }).includes('yield.limitVintage'));
    assert.equal(limitationKeys({ asOfYear: 2023 }).includes('yield.limitVintage'), false);
  });

  it('flags a thin sample and an absent spread', () => {
    const thin = resolved({
      entry: {
        medianYieldTHa: 5,
        sdYieldTHa: null,
        n: 3,
        years: [2020, 2021, 2022],
        latestYear: 2022,
      },
    });
    const keys = estimateYield({
      evidence: thin,
      areaValue: 1,
      areaUnit: 'hectare',
      asOfYear: 2022,
    }).limitations.map((l) => l.key);
    assert.ok(keys.includes('yield.limitFewObservations'));
    assert.ok(keys.includes('yield.limitNoSpread'));
  });

  it('still produces a mid figure when the spread is unknown, with no fake range', () => {
    const noSpread = resolved({
      entry: {
        medianYieldTHa: 5,
        sdYieldTHa: null,
        n: 3,
        years: [2020, 2021, 2022],
        latestYear: 2022,
      },
    });
    const result = estimateYield({ evidence: noSpread, areaValue: 1, areaUnit: 'hectare' });
    assert.equal(result.production.midTonnes, 5);
    assert.equal(result.production.lowTonnes, null);
    assert.equal(result.production.highTonnes, null);
  });
});

// ── Withheld figures always carry a reason ──────────────────────────────────

describe('estimateYield · withholds rather than guesses', () => {
  it('serves the yield basis but no total when the area is missing', () => {
    const result = estimateYield({ evidence: resolved(), areaValue: null });
    assert.equal(result.estimated, true);
    assert.equal(result.basis.medianYieldTHa, 5, 'the district figure is still useful on its own');
    assert.equal(result.production, null);
    assert.equal(result.productionUnavailableReason, PRODUCTION_UNAVAILABLE.AREA_MISSING);
    assert.equal(result.productionUnavailableReasonKey, 'yield.productionAreaMissing');
  });

  it('serves the yield basis but no total for a bigha area', () => {
    const result = estimateYield({ evidence: resolved(), areaValue: 4, areaUnit: 'bigha' });
    assert.equal(result.production, null);
    assert.equal(result.productionUnavailableReasonKey, 'yield.productionAreaUnitAmbiguous');
    assert.equal(result.basis.medianYieldTHa, 5);
  });

  it('estimates nothing at all when the evidence did not resolve', () => {
    const result = estimateYield({
      evidence: {
        resolution: RESOLUTION.INSUFFICIENT_EVIDENCE,
        entry: null,
        reasonKey: 'yield.evidenceNone',
        reason: 'NO_EVIDENCE',
      },
      areaValue: 1,
      areaUnit: 'hectare',
    });
    assert.equal(result.estimated, false);
    assert.equal(result.reasonKey, 'yield.evidenceNone');
    assert.ok(result.trace.some((s) => s.step === 'NOT_ESTIMATED'));

    // Every field a client reads is present and explicitly empty, so an
    // absent key never has to be told apart from a null one.
    assert.equal(result.production, null);
    assert.equal(result.basis, null);
    assert.equal(result.isRange, false);
    assert.deepEqual(result.factors, []);
    assert.deepEqual(result.limitations, []);
    assert.equal(result.disclaimerKey, 'yield.disclaimer');
  });
});

// ── Trace ───────────────────────────────────────────────────────────────────

describe('estimateYield · shows its working', () => {
  it('publishes the formula alongside the numbers that went into it', () => {
    const result = estimateYield({ evidence: resolved(), areaValue: 1, areaUnit: 'hectare' });
    const production = result.trace.find((s) => s.step === 'PRODUCTION');
    const range = result.trace.find((s) => s.step === 'RANGE');

    assert.equal(production.formula, 'medianYieldTHa × areaHectares');
    assert.equal(production.medianYieldTHa, 5);
    assert.equal(production.areaHectares, 1);
    assert.equal(range.formula, '(medianYieldTHa ± sdYieldTHa) × areaHectares');
    assert.equal(range.sdYieldTHa, 1);
  });

  it('names which factors were and were not applied', () => {
    const result = estimateYield({ evidence: resolved(), areaValue: 1, areaUnit: 'hectare' });
    const factors = result.trace.find((s) => s.step === 'FACTORS');
    assert.deepEqual(factors.applied, []);
    assert.deepEqual(factors.notApplied, [FACTORS.IRRIGATION, FACTORS.PEST_DISEASE_EVENT]);
  });
});
