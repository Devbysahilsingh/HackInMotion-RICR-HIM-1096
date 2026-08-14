/**
 * APY yield normalizer — unit tests.
 *
 * The normalizer is pure, so every case is a fixture in / object out: no file,
 * no database, no clock. Fixture rows reproduce the *shape* of the real export
 * (docs/yield/dataset-research.md) including its defects; the few that quote
 * real districts do so because the audit named them as evidence.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  AGGREGATE_SEASON_MAP,
  DROP_REASONS,
  EXPECTED_UNITS,
  OUTLIER_THRESHOLD,
  SEASON_MAP,
  UNRESOLVED_SEASONS,
  buildCropIndex,
  flagImplausibleYields,
  modifiedZScore,
  normalizeBatch,
  normalizeRow,
  parseAgYear,
} from '../../src/services/yieldNormalizer.js';

// ── Fixtures ────────────────────────────────────────────────────────────────

const CROP_INDEX = buildCropIndex([
  { cropCode: 'RICE', yield: { apyCropName: 'Rice' } },
  { cropCode: 'WHEAT', yield: { apyCropName: 'Wheat' } },
  { cropCode: 'CHILLI', yield: { apyCropName: 'Dry Chillies' } },
  // Excluded exactly as the shipped knowledge file excludes them.
  { cropCode: 'COTTON', yield: { apyCropName: null } },
  { cropCode: 'TOMATO', yield: {} },
]);

/** A row that passes every gate. Override one field per test. */
const row = (overrides = {}) => ({
  year: '2021-2022',
  state_name: 'Punjab',
  state_code: '3',
  district_name: 'Ludhiana',
  district_code: '36',
  crop_name: 'Wheat',
  crop_code: '101.0',
  crop_type: 'Cereals',
  season: 'Rabi',
  area: '150000',
  area_unit: 'Hectare',
  production: '750000',
  production_unit: 'Tonnes',
  yield: '5',
  yield_unit: 'Tonnes/Hectare',
  ...overrides,
});

const accept = (overrides) => {
  const result = normalizeRow(row(overrides), { cropIndex: CROP_INDEX });
  assert.equal(result.ok, true, `expected acceptance, got ${result.reason}`);
  return result.row;
};

const reject = (overrides) => {
  const result = normalizeRow(row(overrides), { cropIndex: CROP_INDEX });
  assert.equal(result.ok, false, 'expected rejection');
  return result;
};

// ── Crop index (registry-driven scope) ──────────────────────────────────────

describe('buildCropIndex', () => {
  it('maps the source crop name to the registry code', () => {
    assert.equal(CROP_INDEX.get('Rice'), 'RICE');
    assert.equal(CROP_INDEX.get('Dry Chillies'), 'CHILLI');
  });

  it('omits crops whose apyCropName is null or absent, so exclusion is data', () => {
    // Cotton and tomato are excluded by the knowledge file carrying no name.
    // Nothing in the normalizer mentions either crop.
    assert.equal(CROP_INDEX.has('Cotton(Lint)'), false);
    assert.equal(CROP_INDEX.has('Tomato'), false);
    assert.equal(CROP_INDEX.size, 3);
  });

  it('ignores documents with no cropCode', () => {
    assert.equal(buildCropIndex([{ yield: { apyCropName: 'Rice' } }]).size, 0);
  });

  it('survives an empty or missing registry', () => {
    assert.equal(buildCropIndex().size, 0);
    assert.equal(buildCropIndex([]).size, 0);
  });
});

// ── Agricultural year ───────────────────────────────────────────────────────

describe('parseAgYear', () => {
  it('reads the Indian agricultural year as its starting calendar year', () => {
    assert.deepEqual(parseAgYear('1997-1998'), { startYear: 1997, label: '1997-1998' });
    assert.deepEqual(parseAgYear('2022-2023'), { startYear: 2022, label: '2022-2023' });
  });

  it('rejects a span that is not one year, rather than guessing', () => {
    assert.equal(parseAgYear('1997-1999'), null);
    assert.equal(parseAgYear('2000-1999'), null);
  });

  it('rejects shapes a loose parser would silently accept', () => {
    for (const bad of ['1997', '97-98', '', null, undefined, '1997/1998', 'abcd-efgh']) {
      assert.equal(parseAgYear(bad), null, `expected null for ${JSON.stringify(bad)}`);
    }
  });
});

// ── Season mapping ──────────────────────────────────────────────────────────

describe('season mapping', () => {
  it('maps the three seasons the enum has, exactly', () => {
    assert.equal(accept({ season: 'Kharif' }).season, 'KHARIF');
    assert.equal(accept({ season: 'Rabi' }).season, 'RABI');
    assert.equal(accept({ season: 'Summer' }).season, 'ZAID');
  });

  it('routes the two aggregate labels to tiers rather than to a season', () => {
    const total = accept({ season: 'Total' });
    assert.equal(total.season, null);
    assert.equal(total.aggregate, AGGREGATE_SEASON_MAP.Total);

    const annual = accept({ season: 'Whole Year' });
    assert.equal(annual.season, null);
    assert.equal(annual.aggregate, AGGREGATE_SEASON_MAP['Whole Year']);
  });

  it('leaves Autumn and Winter unresolved instead of mapping them by resemblance', () => {
    for (const season of UNRESOLVED_SEASONS) {
      assert.equal(reject({ season }).reason, DROP_REASONS.UNRESOLVED_SEASON);
    }
    // The distinction matters: unresolved is a known gap, unknown is drift.
    assert.equal(reject({ season: 'Monsoon' }).reason, DROP_REASONS.UNKNOWN_SEASON);
  });

  it('does not invent a season from a near-miss spelling', () => {
    assert.equal(reject({ season: 'kharif' }).reason, DROP_REASONS.UNKNOWN_SEASON);
    assert.equal(Object.keys(SEASON_MAP).length, 3);
  });
});

// ── Units: asserted, never converted ────────────────────────────────────────

describe('unit handling', () => {
  it('accepts only the declared unit triple', () => {
    assert.equal(accept({}).yieldTHa, 5);
    assert.equal(EXPECTED_UNITS.production, 'Tonnes');
  });

  it('drops a row declaring any other unit rather than converting it', () => {
    // This is the cotton defect's shape: a unit string is an assertion to be
    // checked, not an instruction to convert by.
    assert.equal(reject({ production_unit: 'Bales' }).reason, DROP_REASONS.BAD_UNIT);
    assert.equal(reject({ area_unit: 'Acre' }).reason, DROP_REASONS.BAD_UNIT);
    assert.equal(reject({ yield_unit: 'Bales/Hectare' }).reason, DROP_REASONS.BAD_UNIT);
  });
});

// ── Value gates ─────────────────────────────────────────────────────────────

describe('value gates', () => {
  it('treats a nil production as nil, not as a zero yield', () => {
    // A zero here would drag the district median toward zero (audit D6).
    assert.equal(reject({ production: '' }).reason, DROP_REASONS.BAD_PRODUCTION);
    assert.equal(reject({ production: '0' }).reason, DROP_REASONS.BAD_PRODUCTION);
  });

  it('rejects non-positive area', () => {
    assert.equal(reject({ area: '0' }).reason, DROP_REASONS.BAD_AREA);
    assert.equal(reject({ area: '-5' }).reason, DROP_REASONS.BAD_AREA);
  });

  it('rejects a published yield that does not reproduce from production / area', () => {
    const result = reject({ yield: '9' });
    assert.equal(result.reason, DROP_REASONS.INCONSISTENT_YIELD);
    assert.match(result.detail, /published=9/);
  });

  it('tolerates the source rounding its own yield to three decimals', () => {
    // 2600 / 21400 = 0.12149..., published as 0.121 — a real row from 1997-98.
    const kept = accept({ area: '21400', production: '2600', yield: '0.121' });
    assert.equal(kept.yieldTHa, 0.121);
  });

  it('rejects an unmapped crop and names it, so scope drift is visible', () => {
    const result = reject({ crop_name: 'Sugarcane' });
    assert.equal(result.reason, DROP_REASONS.UNMAPPED_CROP);
    assert.equal(result.detail, 'Sugarcane');
  });

  it('rejects structurally unusable geography', () => {
    assert.equal(reject({ district_code: '' }).reason, DROP_REASONS.BAD_GEO);
    assert.equal(reject({ state_name: '   ' }).reason, DROP_REASONS.BAD_GEO);
  });

  it('carries both the district code and its display name through', () => {
    const kept = accept({});
    assert.equal(kept.districtCode, '36');
    assert.equal(kept.district, 'Ludhiana');
    assert.equal(kept.stateCode, '3');
    assert.equal(kept.year, 2021);
    assert.equal(kept.yearLabel, '2021-2022');
  });
});

// ── Outlier gate ────────────────────────────────────────────────────────────

describe('modifiedZScore', () => {
  it('is null when there is too little data to characterise a spread', () => {
    assert.equal(modifiedZScore([1, 2]), null);
    assert.equal(modifiedZScore([2, 2, 2, 2]), null, 'zero MAD cannot score anything');
  });

  it('scores a value at the median as zero', () => {
    const gate = modifiedZScore([1, 2, 3, 4, 5]);
    assert.equal(Math.abs(gate.score(3)) < 1e-9, true);
  });
});

describe('flagImplausibleYields', () => {
  /** A believable district spread, plus one row with area off by 100x. */
  const riceRows = [
    ...[2.1, 2.3, 2.0, 2.5, 2.2, 2.4, 1.9, 2.6, 2.15, 2.35].map((yieldTHa, i) => ({
      cropCode: 'RICE',
      yieldTHa,
      district: `D${i}`,
    })),
    { cropCode: 'RICE', yieldTHa: 223.727, district: 'Kolhapur' },
  ];

  it('removes a yield two orders of magnitude too high', () => {
    const { kept, flagged } = flagImplausibleYields(riceRows);
    assert.equal(flagged.length, 1);
    assert.equal(flagged[0].district, 'Kolhapur');
    assert.equal(kept.length, 10);
    assert.equal(flagged[0].outlierScore > OUTLIER_THRESHOLD, true);
  });

  it('keeps low yields, because a failed season is real and trimming it would bias estimates upward', () => {
    const withFailure = [
      ...riceRows.slice(0, 10),
      { cropCode: 'RICE', yieldTHa: 0.05, district: 'Drought' },
    ];
    const { kept, flagged } = flagImplausibleYields(withFailure);
    assert.equal(flagged.length, 0);
    assert.equal(
      kept.some((r) => r.district === 'Drought'),
      true,
    );
  });

  it('scores each crop against its own distribution, never a shared ceiling', () => {
    // 30 t/ha is ordinary for onion and impossible for wheat. A single
    // threshold could not be right for both.
    const mixed = [
      ...Array.from({ length: 10 }, (_, i) => ({ cropCode: 'ONION', yieldTHa: 25 + i * 0.5 })),
      { cropCode: 'ONION', yieldTHa: 30 },
      ...Array.from({ length: 10 }, (_, i) => ({ cropCode: 'WHEAT', yieldTHa: 3 + i * 0.1 })),
      { cropCode: 'WHEAT', yieldTHa: 30 },
    ];
    const { flagged } = flagImplausibleYields(mixed);
    assert.equal(flagged.length, 1);
    assert.equal(flagged[0].cropCode, 'WHEAT');
  });

  it('passes everything through when a crop has too few rows to judge', () => {
    const { kept, flagged } = flagImplausibleYields([{ cropCode: 'RICE', yieldTHa: 999 }]);
    assert.equal(flagged.length, 0);
    assert.equal(kept.length, 1);
  });
});

// ── Batch report ────────────────────────────────────────────────────────────

describe('normalizeBatch', () => {
  it('counts every rejection and never loses a row silently', () => {
    const rows = [
      row(),
      row({ season: 'Autumn' }),
      row({ crop_name: 'Sugarcane' }),
      row({ production: '' }),
      row({ production_unit: 'Bales' }),
    ];
    const { rows: kept, report } = normalizeBatch(rows, { cropIndex: CROP_INDEX });

    assert.equal(kept.length, 1);
    assert.equal(report.fetched, 5);
    assert.equal(report.accepted, 1);
    assert.equal(report.dropped[DROP_REASONS.UNRESOLVED_SEASON], 1);
    assert.equal(report.dropped[DROP_REASONS.UNMAPPED_CROP], 1);
    assert.equal(report.dropped[DROP_REASONS.BAD_PRODUCTION], 1);
    assert.equal(report.dropped[DROP_REASONS.BAD_UNIT], 1);
    assert.equal(report.accepted + report.droppedTotal, report.fetched);
  });

  it('names the unmapped crops with their counts, since most of the file is out of scope', () => {
    const rows = [
      row({ crop_name: 'Sugarcane' }),
      row({ crop_name: 'Sugarcane' }),
      row({ crop_name: 'Urad' }),
    ];
    const { report } = normalizeBatch(rows, { cropIndex: CROP_INDEX });
    assert.deepEqual(report.unmappedCropNames, [
      { name: 'Sugarcane', count: 2 },
      { name: 'Urad', count: 1 },
    ]);
  });

  it('reports where the outlier gate cut, per crop', () => {
    const rows = [
      ...[2.1, 2.3, 2.0, 2.5, 2.2, 2.4, 1.9, 2.6].map((y, i) =>
        row({
          crop_name: 'Rice',
          area: '1000',
          production: String(y * 1000),
          yield: String(y),
          district_code: String(i),
        }),
      ),
      row({ crop_name: 'Rice', area: '10', production: '2000', yield: '200', district_code: '99' }),
    ];
    const { report } = normalizeBatch(rows, { cropIndex: CROP_INDEX });
    const gate = report.outlierGateByCrop.RICE;
    assert.equal(gate.rejected, 1);
    assert.equal(gate.kept, 8);
    assert.equal(gate.lowestRejectedYieldTHa, 200);
    assert.equal(gate.highestKeptYieldTHa, 2.6);
  });

  it('handles an empty or non-array batch without throwing', () => {
    for (const input of [[], null, undefined]) {
      const { rows: kept, report } = normalizeBatch(input, { cropIndex: CROP_INDEX });
      assert.equal(kept.length, 0);
      assert.equal(report.fetched, 0);
      assert.equal(report.dropRate, 0);
    }
  });
});
