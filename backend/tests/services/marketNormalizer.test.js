/**
 * data.gov.in → marketPrices normalization — unit tests.
 *
 * docs/market/data-normalization.md is the contract: parse & type, sanity
 * gates, canonicalization, and the drop-rate report that guards against schema
 * drift. The normalizer is pure, so every case here is a fixture row in and an
 * object out — no database, no network, and no clock: `asOf` is always the same
 * fixed instant (ADR-022 leaves this project with no fake timers).
 *
 * Prices in the fixtures are shaped like mandi quotations but are fabricated
 * test values, not sourced agronomic or market data.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  DISCARDED_FIELDS,
  DROP_REASONS,
  buildAliasIndex,
  normalizeBatch,
  normalizeRow,
  parseArrivalDate,
} from '../../src/services/marketNormalizer.js';

// ── Fixtures ────────────────────────────────────────────────────────────────

/** Fixed epoch so every age expectation is a literal, not a computation. */
const ASOF = new Date('2026-08-13T00:00:00.000Z');
const FETCHED_AT = new Date('2026-08-13T02:30:00.000Z');

const MS_PER_DAY = 86_400_000;

/**
 * Registry-shaped documents. RICE publishes a commodity code that differs from
 * its crop code (the portal calls it Paddy), TOMATO publishes an identical one,
 * ONION publishes no market block at all, and the last document has no code of
 * any kind and must simply be skipped.
 */
const REGISTRY = [
  {
    cropCode: 'RICE',
    market: { commodityCode: 'PADDY', aliases: ['Paddy(Dhan)(Common)', 'Paddy   Dhan'] },
  },
  { cropCode: 'TOMATO', market: { commodityCode: 'TOMATO', aliases: ['Tomato'] } },
  { cropCode: 'ONION' },
  { names: { en: 'nameless', hi: 'nameless' } },
];

const aliasIndex = buildAliasIndex(REGISTRY);

/** A row the portal would publish, valid in every respect. */
const sourceRow = (overrides = {}) => ({
  state: 'Maharashtra',
  district: 'Nagpur',
  market: 'Kalamna',
  commodity: 'Paddy(Dhan)(Common)',
  variety: 'Common',
  arrival_date: '10/08/2026',
  min_price: '1800',
  modal_price: '2000',
  max_price: '2200',
  ...overrides,
});

const run = (overrides = {}) =>
  normalizeRow(sourceRow(overrides), { aliasIndex, asOf: ASOF, fetchedAt: FETCHED_AT });

const batch = (rows) => normalizeBatch(rows, { aliasIndex, asOf: ASOF, fetchedAt: FETCHED_AT });

// ── Alias index ─────────────────────────────────────────────────────────────

describe('buildAliasIndex', () => {
  it('resolves the crop code, the commodity code and every alias to one code', () => {
    assert.equal(aliasIndex.get('rice'), 'PADDY');
    assert.equal(aliasIndex.get('paddy'), 'PADDY');
    assert.equal(aliasIndex.get('paddy(dhan)(common)'), 'PADDY');
    assert.equal(aliasIndex.get('tomato'), 'TOMATO');
  });

  it('falls back to the crop code when the registry publishes no market block', () => {
    assert.equal(aliasIndex.get('onion'), 'ONION');
  });

  it('skips a document with no code of any kind rather than indexing undefined', () => {
    assert.equal(aliasIndex.get(''), undefined);
    assert.equal(aliasIndex.get('undefined'), undefined);
    // RICE(2 aliases + code + cropCode = 3 distinct keys) + TOMATO(2) + ONION(1).
    assert.equal(aliasIndex.size, 6);
  });

  it('survives being called with nothing', () => {
    assert.equal(buildAliasIndex().size, 0);
    assert.equal(buildAliasIndex([]).size, 0);
  });

  it('matches case-insensitively and whitespace-insensitively', () => {
    const canonical = run({ commodity: 'Paddy(Dhan)(Common)' });
    const shouted = run({ commodity: 'PADDY(DHAN)(COMMON)' });
    const padded = run({ commodity: '  paddy(dhan)(common) ' });

    for (const result of [canonical, shouted, padded]) {
      assert.equal(result.ok, true);
      assert.equal(result.row.commodityCode, 'PADDY');
    }
  });

  it('collapses runs of internal whitespace on both sides of the match', () => {
    // The published alias itself carries a triple space; the row carries one.
    assert.equal(run({ commodity: 'Paddy Dhan' }).row.commodityCode, 'PADDY');
    assert.equal(run({ commodity: 'paddy \t\n Dhan' }).row.commodityCode, 'PADDY');
  });
});

// ── Date parsing ────────────────────────────────────────────────────────────

describe('parseArrivalDate', () => {
  it('reads DD/MM/YYYY as day-first — 03/08/2026 is 3 August, not 8 March', () => {
    const parsed = parseArrivalDate('03/08/2026');

    assert.equal(parsed.toISOString(), '2026-08-03T00:00:00.000Z');
    assert.equal(parsed.getUTCDate(), 3);
    assert.equal(parsed.getUTCMonth(), 7, 'the source was read as month-first');
    // Stated the other way round too: the US reading is 8 March.
    assert.notEqual(parsed.getTime(), Date.UTC(2026, 2, 8));
  });

  it('accepts single-digit days and months', () => {
    assert.equal(parseArrivalDate('3/8/2026').toISOString(), '2026-08-03T00:00:00.000Z');
  });

  it('rejects 31/02/2026 rather than rolling it silently into March', () => {
    assert.equal(parseArrivalDate('31/02/2026'), null);
    assert.equal(parseArrivalDate('32/01/2026'), null);
    assert.equal(parseArrivalDate('13/13/2026'), null);
    assert.equal(parseArrivalDate('00/08/2026'), null);
  });

  it('accepts ISO dates, which is how the seed files publish them', () => {
    assert.equal(parseArrivalDate('2026-08-03').toISOString(), '2026-08-03T00:00:00.000Z');
  });

  it('passes a usable Date through and rejects an unusable one', () => {
    const date = new Date('2026-08-03T00:00:00.000Z');
    assert.equal(parseArrivalDate(date), date);
    assert.equal(parseArrivalDate(new Date('nope')), null);
  });

  it('returns null on junk instead of an Invalid Date', () => {
    for (const junk of ['', '   ', 'yesterday', '2026/08/03', '3-8-2026', '03/08/26', null, 42]) {
      assert.equal(parseArrivalDate(junk), null, `accepted ${JSON.stringify(junk)}`);
    }
    assert.equal(parseArrivalDate(undefined), null);
  });
});

// ── Sanity gates ────────────────────────────────────────────────────────────

describe('normalizeRow · price gates are strict at both ends', () => {
  it('rejects a price of exactly 0 — the bound is exclusive', () => {
    assert.deepEqual(run({ min_price: '0', modal_price: '0', max_price: '0' }), {
      ok: false,
      reason: DROP_REASONS.BAD_PRICE,
    });
    // One bad field out of three is enough.
    assert.equal(run({ min_price: '0' }).reason, DROP_REASONS.BAD_PRICE);
  });

  it('rejects a price of exactly 100000 and accepts 99999', () => {
    const atCeiling = run({ min_price: '100000', modal_price: '100000', max_price: '100000' });
    assert.equal(atCeiling.ok, false);
    assert.equal(atCeiling.reason, DROP_REASONS.BAD_PRICE);

    const belowCeiling = run({ min_price: '99999', modal_price: '99999', max_price: '99999' });
    assert.equal(belowCeiling.ok, true);
    assert.equal(belowCeiling.row.modalPrice, 99999);
  });

  it('rejects negative and unreadable prices', () => {
    for (const value of ['-1', '', 'NA', 'abc', null, undefined]) {
      assert.equal(
        run({ modal_price: value }).reason,
        DROP_REASONS.BAD_PRICE,
        `accepted modal_price ${JSON.stringify(value)}`,
      );
    }
  });

  it('parses thousands separators and rounds to integer rupees', () => {
    const result = run({ min_price: '1,800.4', modal_price: '2,000.6', max_price: '2,200' });

    assert.equal(result.row.minPrice, 1800);
    assert.equal(result.row.modalPrice, 2001);
    assert.equal(result.row.maxPrice, 2200);
  });

  it('rejects an inverted band where min > max', () => {
    const result = run({ min_price: '2200', modal_price: '2000', max_price: '1800' });

    assert.equal(result.ok, false);
    assert.equal(result.reason, DROP_REASONS.BAD_PRICE);
    assert.equal(result.detail, 'min>max');
  });
});

describe('normalizeRow · date gates', () => {
  it('rejects a date in the future', () => {
    // asOf is 13 August 2026.
    const result = run({ arrival_date: '14/08/2026' });

    assert.equal(result.ok, false);
    assert.equal(result.reason, DROP_REASONS.BAD_DATE);
    assert.equal(result.detail, 'ageDays=-1');
    // Today itself is in range.
    assert.equal(run({ arrival_date: '13/08/2026' }).ok, true);
  });

  it('rejects a row 91 days old and accepts one 89 days old', () => {
    // Guards the arithmetic behind the two literals below.
    const age = (literal) => (ASOF.getTime() - parseArrivalDate(literal).getTime()) / MS_PER_DAY;
    assert.equal(age('14/05/2026'), 91);
    assert.equal(age('15/05/2026'), 90);
    assert.equal(age('16/05/2026'), 89);

    const tooOld = run({ arrival_date: '14/05/2026' });
    assert.equal(tooOld.ok, false);
    assert.equal(tooOld.reason, DROP_REASONS.BAD_DATE);
    assert.equal(tooOld.detail, 'ageDays=91');

    // The bound itself is inclusive: exactly 90 days still counts.
    assert.equal(run({ arrival_date: '15/05/2026' }).ok, true);
    assert.equal(run({ arrival_date: '16/05/2026' }).ok, true);
  });

  it('reports an unparseable date separately from an out-of-range one', () => {
    const result = run({ arrival_date: 'sometime last week' });

    assert.equal(result.reason, DROP_REASONS.BAD_DATE);
    assert.equal(result.detail, 'sometime last week');
  });
});

describe('normalizeRow · modal clamp (honesty rule 9)', () => {
  it('clamps a modal below min UP to min and flags the row', () => {
    const result = run({ min_price: '1800', modal_price: '1500', max_price: '2200' });

    assert.equal(result.ok, true);
    assert.equal(result.flagged, true);
    assert.equal(result.row.modalPrice, 1800);
    assert.equal(result.row.flagged, true, 'the adjustment was not recorded on the stored row');
    assert.equal(result.row.minPrice, 1800);
    assert.equal(result.row.maxPrice, 2200);
  });

  it('clamps a modal above max DOWN to max and flags the row', () => {
    const result = run({ min_price: '1800', modal_price: '2500', max_price: '2200' });

    assert.equal(result.ok, true);
    assert.equal(result.flagged, true);
    assert.equal(result.row.modalPrice, 2200);
    assert.equal(result.row.flagged, true);
  });

  it('leaves a modal inside the band alone and unflagged', () => {
    for (const modal of ['1800', '2000', '2200']) {
      const result = run({ modal_price: modal });
      assert.equal(result.flagged, false, `modal ${modal} was flagged`);
      assert.equal(result.row.modalPrice, Number(modal));
      assert.equal(result.row.flagged, false);
    }
  });
});

describe('normalizeRow · canonicalization', () => {
  it('drops a commodity the registry does not map', () => {
    const result = run({ commodity: 'Dragon Fruit' });

    assert.equal(result.ok, false);
    assert.equal(result.reason, DROP_REASONS.UNMAPPED);
    assert.equal(result.detail, 'Dragon Fruit');
  });

  it('drops a row missing any part of its geography', () => {
    for (const field of ['state', 'district', 'market']) {
      for (const value of ['', '   ', null, undefined]) {
        const result = run({ [field]: value });
        assert.equal(
          result.reason,
          DROP_REASONS.BAD_GEO,
          `accepted ${field}=${JSON.stringify(value)}`,
        );
      }
    }
  });

  it('stores geography trimmed and whitespace-collapsed, with case preserved', () => {
    const result = run({ state: '  Maharashtra ', district: 'Nagpur', market: 'Kalamna   Mandi' });

    assert.equal(result.row.state, 'Maharashtra');
    assert.equal(result.row.market, 'Kalamna Mandi');
  });

  it('stamps unit, source and fetchedAt rather than trusting the payload', () => {
    const result = run({ unit: 'kg', source: 'trustworthy' });

    assert.equal(result.row.unit, 'quintal');
    assert.equal(result.row.source, 'datagovin');
    assert.equal(result.row.fetchedAt, FETCHED_AT);
    assert.equal(result.row.date.toISOString(), '2026-08-10T00:00:00.000Z');
  });

  it('discards `variety` — it has no storage target', () => {
    const result = run({ variety: 'Local' });

    assert.deepEqual(DISCARDED_FIELDS, ['variety']);
    assert.equal('variety' in result.row, false, 'variety reached the normalized row');
    assert.deepEqual(Object.keys(result.row).sort(), [
      'commodityCode',
      'date',
      'district',
      'fetchedAt',
      'flagged',
      'market',
      'maxPrice',
      'minPrice',
      'modalPrice',
      'source',
      'state',
      'unit',
    ]);
  });
});

// ── Batch report ────────────────────────────────────────────────────────────

describe('normalizeBatch · report arithmetic', () => {
  /**
   * Ten rows: 4 accepted (1 of them clamped), 2 unmapped, 2 badPrice, 1 badDate,
   * 1 badGeo. Every count below is checkable by eye against this list.
   */
  const MIXED = [
    sourceRow({ market: 'Kalamna', arrival_date: '10/08/2026' }),
    sourceRow({ market: 'Kalamna', arrival_date: '11/08/2026' }),
    sourceRow({ commodity: 'Tomato', market: 'Kalamna', arrival_date: '11/08/2026' }),
    // Clamped: modal below min.
    sourceRow({ market: 'Wardha', modal_price: '1500' }),
    sourceRow({ commodity: 'Dragon Fruit' }),
    sourceRow({ commodity: '  dragon   fruit  ' }),
    sourceRow({ modal_price: '0' }),
    sourceRow({ min_price: '3000', max_price: '1000' }),
    sourceRow({ arrival_date: '01/01/2026' }),
    sourceRow({ district: '  ' }),
  ];

  it('counts every bucket, the total and the rate', () => {
    const { rows, report } = batch(MIXED);

    assert.equal(report.fetched, 10);
    assert.equal(report.accepted, 4);
    assert.equal(rows.length, 4);
    assert.equal(report.flagged, 1);
    assert.deepEqual(report.dropped, { unmapped: 2, badDate: 1, badPrice: 2, badGeo: 1 });
    assert.equal(report.droppedTotal, 6);
    assert.equal(report.dropRate, 0.6);
    assert.equal(report.accepted + report.droppedTotal, report.fetched);
  });

  it('returns only accepted rows, each carrying its flag', () => {
    const { rows } = batch(MIXED);

    assert.equal(rows.filter((row) => row.flagged).length, 1);
    assert.equal(
      rows.every((row) => row.commodityCode === 'PADDY' || row.commodityCode === 'TOMATO'),
      true,
    );
  });

  it('reports a rate of 0 for an empty batch rather than dividing by zero', () => {
    for (const empty of [[], null, undefined, 'not an array']) {
      const { rows, report } = batch(empty);

      assert.equal(report.fetched, 0);
      assert.equal(report.accepted, 0);
      assert.equal(report.droppedTotal, 0);
      assert.equal(report.dropRate, 0);
      assert.ok(Number.isFinite(report.dropRate));
      assert.deepEqual(rows, []);
    }
  });

  it('reports a rate of 1 when every row is unusable', () => {
    const { report } = batch([sourceRow({ commodity: 'Dragon Fruit' }), sourceRow({ state: '' })]);

    assert.equal(report.dropRate, 1);
    assert.equal(report.accepted, 0);
  });

  it('rounds the rate to four places rather than publishing a float artefact', () => {
    const rows = [sourceRow({ commodity: 'Dragon Fruit' })];
    for (let index = 0; index < 2; index += 1) {
      rows.push(sourceRow({ market: `Mandi ${index}` }));
    }

    assert.equal(batch(rows).report.dropRate, 0.3333);
  });
});

describe('normalizeBatch · unmapped samples', () => {
  it('samples the unmapped commodity strings so drift is diagnosable', () => {
    const { report } = batch([sourceRow({ commodity: 'Dragon Fruit' }), sourceRow()]);

    assert.deepEqual(report.samples.unmapped, ['Dragon Fruit']);
  });

  it('deduplicates samples across whitespace and keeps the display form', () => {
    const { report } = batch([
      sourceRow({ commodity: 'Dragon Fruit' }),
      sourceRow({ commodity: 'Dragon Fruit' }),
      sourceRow({ commodity: 'Star Apple' }),
    ]);

    assert.deepEqual(report.samples.unmapped, ['Dragon Fruit', 'Star Apple']);
    assert.equal(report.dropped.unmapped, 3, 'deduping the samples must not dedupe the count');
  });

  it('caps the samples at ten while still counting every drop', () => {
    const rows = Array.from({ length: 25 }, (_, index) =>
      sourceRow({ commodity: `Unmapped Crop ${index}` }),
    );

    const { report } = batch(rows);

    assert.equal(report.dropped.unmapped, 25);
    assert.equal(report.samples.unmapped.length, 10);
    assert.deepEqual(report.samples.unmapped[0], 'Unmapped Crop 0');
    assert.equal(new Set(report.samples.unmapped).size, 10);
  });
});
