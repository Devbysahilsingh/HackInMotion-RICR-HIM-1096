/**
 * Yield lookup builder — unit tests.
 *
 * Pure aggregation: fixtures in, lookup out. Yield values here are chosen so
 * every median and standard deviation is checkable by hand; they are not
 * agronomic claims. The tests that assert against real Indian yields live in
 * `yieldLookupArtifact.test.js`, against the committed lookup.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  ANNUAL_BASIS,
  LOOKBACK_YEARS,
  MIN_OBSERVATIONS,
  TIERS,
  buildEntry,
  buildLookup,
  geoKey,
  summarizeLookup,
} from '../../src/services/yieldLookupBuilder.js';

const META = { source: { id: 'test' }, generatedAt: '2026-08-14T00:00:00.000Z' };

/** One normalized row. */
const obs = (overrides = {}) => ({
  cropCode: 'RICE',
  state: 'Punjab',
  stateCode: '3',
  district: 'Ludhiana',
  districtCode: '36',
  season: 'KHARIF',
  aggregate: null,
  year: 2022,
  yearLabel: '2022-2023',
  areaHa: 1000,
  productionT: 3000,
  yieldTHa: 3,
  ...overrides,
});

/** N consecutive years ending at 2022, with the given yields (newest last). */
const series = (yields, overrides = {}) =>
  yields.map((yieldTHa, i) =>
    obs({ year: 2022 - (yields.length - 1 - i), yieldTHa, ...overrides }),
  );

// ── geoKey ──────────────────────────────────────────────────────────────────

describe('geoKey', () => {
  it('folds case, whitespace and punctuation into one key', () => {
    assert.equal(geoKey('Ludhiana'), 'LUDHIANA');
    assert.equal(geoKey('  ludhiana  '), 'LUDHIANA');
    assert.equal(geoKey('Jammu And Kashmir'), 'JAMMUANDKASHMIR');
    assert.equal(geoKey('Y.S.R.'), 'YSR');
  });

  it('does not collapse genuinely different names', () => {
    // Exact match only — a renamed district must miss and fall through to the
    // state tier rather than borrow another district's history.
    assert.notEqual(geoKey('Ananthapuramu'), geoKey('Anantapur'));
    assert.notEqual(geoKey('Dharashiv'), geoKey('Osmanabad'));
  });

  it('is total over empty input', () => {
    assert.equal(geoKey(null), '');
    assert.equal(geoKey(undefined), '');
  });
});

// ── buildEntry ──────────────────────────────────────────────────────────────

describe('buildEntry', () => {
  it('takes the median, not the mean, so one bad year cannot dominate', () => {
    const entry = buildEntry(series([2, 2, 3, 4, 200]));
    assert.equal(entry.medianYieldTHa, 3);
    assert.equal(entry.n, 5);
  });

  it('reports the spread over the same window the median came from', () => {
    const entry = buildEntry(series([1, 2, 3, 4, 5]));
    assert.equal(entry.medianYieldTHa, 3);
    // Sample SD of 1..5 is sqrt(10/4) = 1.581.
    assert.equal(entry.sdYieldTHa, 1.581);
    assert.equal(entry.minYieldTHa, 1);
    assert.equal(entry.maxYieldTHa, 5);
  });

  it('keeps the last N available years rather than the last N calendar years', () => {
    // 2005 then a gap then 2018..2022: the window is the six that exist,
    // trimmed to the newest five. A calendar anchor would have emptied it.
    const rows = [obs({ year: 2005, yieldTHa: 9 }), ...series([1, 2, 3, 4, 5]).slice(0, 5)];
    const entry = buildEntry(rows);
    assert.equal(entry.n, LOOKBACK_YEARS);
    assert.equal(entry.years.includes(2005), false);
    assert.equal(entry.latestYear, 2022);
  });

  it('publishes a stale entry rather than hiding it, and stamps the vintage', () => {
    const entry = buildEntry([
      obs({ year: 2001, yieldTHa: 2 }),
      obs({ year: 2002, yieldTHa: 3 }),
      obs({ year: 2003, yieldTHa: 4 }),
    ]);
    assert.equal(entry.latestYear, 2003);
    assert.equal(entry.n, 3);
  });

  it('returns null below the evidence floor instead of a one-point "median"', () => {
    assert.equal(buildEntry(series([2, 3])), null);
    assert.equal(buildEntry([]), null);
    assert.equal(buildEntry(series([2, 3, 4])).n, MIN_OBSERVATIONS);
  });

  it('collapses many districts in one year to a single point when pooling a state', () => {
    // Without this a state-year with 30 reporting districts would outweigh a
    // state-year with 3 inside the same median.
    const rows = [
      ...Array.from({ length: 30 }, () => obs({ year: 2022, yieldTHa: 10 })),
      obs({ year: 2021, yieldTHa: 2 }),
      obs({ year: 2020, yieldTHa: 2 }),
    ];
    const entry = buildEntry(rows, { perYear: true });
    assert.equal(entry.n, 3);
    assert.equal(entry.medianYieldTHa, 2);
    assert.deepEqual(entry.districtsPerYear, [1, 1, 30]);
  });
});

// ── buildLookup ─────────────────────────────────────────────────────────────

describe('buildLookup', () => {
  it('files a seasonal row into the district, state-season and state tiers', () => {
    const lookup = buildLookup(series([2, 3, 4, 5, 6]), META);
    assert.ok(lookup.tiers[TIERS.DISTRICT_SEASON]['3|36|RICE|KHARIF']);
    assert.ok(lookup.tiers[TIERS.STATE_SEASON]['3|RICE|KHARIF']);
    assert.ok(lookup.tiers[TIERS.STATE]['3|RICE']);
    assert.equal(lookup.tiers[TIERS.DISTRICT_SEASON]['3|36|RICE|KHARIF'].medianYieldTHa, 4);
  });

  it('never lets a Total row into the state tiers, because it re-counts the season rows', () => {
    const seasonRows = series([2, 3, 4, 5, 6]);
    const totalRows = series([100, 100, 100, 100, 100], { season: null, aggregate: 'ALL_SEASON' });
    const lookup = buildLookup([...seasonRows, ...totalRows], META);

    // Untouched by the 100s: if Total had been pooled the median would move.
    assert.equal(lookup.tiers[TIERS.STATE]['3|RICE'].medianYieldTHa, 4);
    assert.equal(lookup.tiers[TIERS.STATE_SEASON]['3|RICE|KHARIF'].medianYieldTHa, 4);
  });

  it('prefers a directly reported annual figure over a derived sum of seasons', () => {
    const wholeYear = series([9, 9, 9, 9, 9], { season: null, aggregate: 'ANNUAL' });
    const total = series([1, 1, 1, 1, 1], { season: null, aggregate: 'ALL_SEASON' });
    const entry = buildLookup([...wholeYear, ...total], META).tiers[TIERS.DISTRICT_ANNUAL][
      '3|36|RICE'
    ];

    assert.equal(entry.basis, ANNUAL_BASIS.WHOLE_YEAR);
    assert.equal(entry.medianYieldTHa, 9);
  });

  it('falls back to the Total rows when the annual report is too thin', () => {
    const wholeYear = series([9, 9], { season: null, aggregate: 'ANNUAL' });
    const total = series([1, 1, 1, 1, 1], { season: null, aggregate: 'ALL_SEASON' });
    const entry = buildLookup([...wholeYear, ...total], META).tiers[TIERS.DISTRICT_ANNUAL][
      '3|36|RICE'
    ];

    assert.equal(entry.basis, ANNUAL_BASIS.TOTAL);
    assert.equal(entry.medianYieldTHa, 1);
  });

  it('never pools the two annual sources together', () => {
    const wholeYear = series([9, 9, 9, 9, 9], { season: null, aggregate: 'ANNUAL' });
    const total = series([1, 1, 1, 1, 1], { season: null, aggregate: 'ALL_SEASON' });
    const entry = buildLookup([...wholeYear, ...total], META).tiers[TIERS.DISTRICT_ANNUAL][
      '3|36|RICE'
    ];
    // A pooled median of five 9s and five 1s would be 5.
    assert.notEqual(entry.medianYieldTHa, 5);
    assert.equal(entry.n, 5);
  });

  it('builds a name index that resolves a farmer-typed place to its code', () => {
    const lookup = buildLookup(series([2, 3, 4]), META);
    assert.equal(lookup.geo.states.PUNJAB, '3');
    assert.equal(lookup.geo.districts['3|LUDHIANA'], '36');
    assert.deepEqual(lookup.geo.names['3|36'], { state: 'Punjab', district: 'Ludhiana' });
  });

  it('omits a key entirely when its evidence is below the floor', () => {
    const lookup = buildLookup(series([2, 3]), META);
    assert.equal(Object.keys(lookup.tiers[TIERS.DISTRICT_SEASON]).length, 0);
    assert.equal(lookup.crops.length, 1, 'the crop still appears — the rows existed');
  });

  it('records the policy it was built under, so a reader need not infer it', () => {
    const lookup = buildLookup(series([2, 3, 4]), META);
    assert.equal(lookup.policy.lookbackYears, LOOKBACK_YEARS);
    assert.equal(lookup.policy.minObservations, MIN_OBSERVATIONS);
    assert.equal(lookup.policy.aggregation, 'median');
    assert.equal(lookup.unit, 'tonnes_per_hectare');
    assert.match(lookup.policy.note, /product policy/);
  });
});

// ── summarizeLookup ─────────────────────────────────────────────────────────

describe('summarizeLookup', () => {
  it('counts entries per crop per tier', () => {
    const lookup = buildLookup(
      [
        ...series([2, 3, 4, 5, 6]),
        ...series([1, 2, 3, 4, 5], { cropCode: 'WHEAT', season: 'RABI' }),
      ],
      META,
    );
    const summary = summarizeLookup(lookup);
    assert.equal(summary.RICE[TIERS.DISTRICT_SEASON], 1);
    assert.equal(summary.WHEAT[TIERS.DISTRICT_SEASON], 1);
    assert.equal(summary.RICE[TIERS.STATE], 1);
  });
});
