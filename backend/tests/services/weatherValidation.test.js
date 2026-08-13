/**
 * Validate-then-cache — unit tests.
 *
 * docs/database/validation.md: "Weather payloads: schema-checked (arrays of 14
 * days, numeric ranges: temp −30..55°C, rain 0..500mm, et0 0..15mm);
 * out-of-range → reject fetch, keep old cache, log."
 *
 * Two properties matter more than the individual bounds:
 *
 *   - **Rejection is whole.** One bad row rejects the payload; there is no
 *     partial acceptance, because a half-written snapshot still looks
 *     authoritative to the irrigation engine (RES-03).
 *   - **The day count is per source.** Open-Meteo returns 7 past + 7 forecast;
 *     the OpenWeatherMap free tier returns forecast only and no history, so
 *     holding both to 14 would reject every fallback payload and break the
 *     exact scenario RES-01 exists to prove.
 *
 * Pure functions throughout: fixture in, object out, no clock — `splitByDay`
 * takes its `asOf` explicitly.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { WEATHER_EXPECTED_DAYS } from '../../src/config/constants.js';
import {
  MIN_DAYS_BY_SOURCE,
  RANGES,
  splitByDay,
  validateDaily,
} from '../../src/services/weatherValidation.js';

// ── Fixtures ────────────────────────────────────────────────────────────────

/** A plausible, in-range row. `index` drives the date so dates stay distinct. */
const row = (index, overrides = {}) => ({
  date: `2026-08-${String(index + 1).padStart(2, '0')}`,
  tMinC: 24,
  tMaxC: 33,
  humidityPct: 70,
  windKmh: 12,
  rainMm: 2,
  rainProbPct: 30,
  et0Mm: 4.2,
  ...overrides,
});

/** `count` consecutive valid days. */
const series = (count, overrides = {}) =>
  Array.from({ length: count }, (_, index) => row(index, overrides));

/** The full 7-past + 7-forecast series the primary returns. */
const primarySeries = () => series(WEATHER_EXPECTED_DAYS);

/** The shorter, ET₀-less series the fallback returns. */
const fallbackSeries = (count = 5) => series(count, { et0Mm: null });

// ── Happy paths ─────────────────────────────────────────────────────────────

describe('validateDaily · accepts a well-formed series', () => {
  it('accepts the primary 14-day payload and normalises it', () => {
    const result = validateDaily({ source: 'open-meteo', daily: primarySeries() });

    assert.equal(result.ok, true);
    assert.equal(result.daily.length, 14);

    assert.ok(result.daily[0].date instanceof Date, 'dates were not normalised to Date');
    assert.equal(result.daily[0].date.toISOString().slice(0, 10), '2026-08-01');
    assert.equal(result.daily[0].tMinC, 24);
    assert.equal(result.daily[0].et0Mm, 4.2);
  });

  it('returns the rows in ascending date order whatever order they arrived in', () => {
    const shuffled = [row(4), row(0), row(9), row(2), row(7), row(1), row(6), row(3)];

    const result = validateDaily({ source: 'openweathermap', daily: shuffled });

    assert.equal(result.ok, true);
    assert.deepEqual(
      result.daily.map((entry) => entry.date.toISOString().slice(0, 10)),
      [
        '2026-08-01',
        '2026-08-02',
        '2026-08-03',
        '2026-08-04',
        '2026-08-05',
        '2026-08-07',
        '2026-08-08',
        '2026-08-10',
      ],
    );
  });

  it('accepts a Date as readily as an ISO string', () => {
    const dated = series(14).map((entry) => ({
      ...entry,
      date: new Date(`${entry.date}T00:00:00Z`),
    }));

    const result = validateDaily({ source: 'open-meteo', daily: dated });
    assert.equal(result.ok, true);
    assert.equal(result.daily.length, 14);
  });

  it('normalises an absent optional field to undefined rather than null', () => {
    const sparse = row(2);
    delete sparse.humidityPct;

    const result = validateDaily({ source: 'openweathermap', daily: series(2).concat([sparse]) });
    assert.equal(result.ok, true);
    assert.equal(result.daily[2].humidityPct, undefined);
    assert.equal(result.daily[0].humidityPct, 70);
  });
});

// ── The per-source day count ────────────────────────────────────────────────

describe('validateDaily · the minimum day count is per source', () => {
  it('publishes 14 for the primary and 3 for the fallback', () => {
    assert.equal(MIN_DAYS_BY_SOURCE['open-meteo'], WEATHER_EXPECTED_DAYS);
    assert.equal(MIN_DAYS_BY_SOURCE['open-meteo'], 14);
    assert.equal(MIN_DAYS_BY_SOURCE.openweathermap, 3);
  });

  it('rejects a short open-meteo payload', () => {
    const result = validateDaily({ source: 'open-meteo', daily: series(13) });

    assert.equal(result.ok, false);
    assert.equal(result.reason, 'too_few_days');
    assert.equal(result.detail, '13 < 14');
  });

  it('ACCEPTS a 5-day openweathermap payload — the fallback has no history', () => {
    const result = validateDaily({ source: 'openweathermap', daily: fallbackSeries(5) });

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.daily.length, 5);
  });

  it('still holds the fallback to its own floor', () => {
    assert.equal(validateDaily({ source: 'openweathermap', daily: fallbackSeries(3) }).ok, true);

    const tooShort = validateDaily({ source: 'openweathermap', daily: fallbackSeries(2) });
    assert.equal(tooShort.ok, false);
    assert.equal(tooShort.reason, 'too_few_days');
  });

  it('refuses a source it has no rule for, rather than guessing one', () => {
    const result = validateDaily({ source: 'weatherapi', daily: primarySeries() });

    assert.equal(result.ok, false);
    assert.equal(result.reason, 'unknown_source');
    assert.equal(result.detail, 'weatherapi');
  });

  it('refuses anything that is not an array', () => {
    for (const daily of [null, undefined, {}, 'daily', 42]) {
      const result = validateDaily({ source: 'open-meteo', daily });
      assert.equal(result.ok, false, `accepted ${String(daily)}`);
      assert.equal(result.reason, 'not_an_array');
    }
  });
});

// ── Physical ranges ─────────────────────────────────────────────────────────

describe('validateDaily · out-of-range values reject the whole payload', () => {
  const outOfRange = [
    { field: 'tMaxC', value: 999 },
    { field: 'tMaxC', value: 55.1 },
    { field: 'tMinC', value: -31 },
    { field: 'rainMm', value: 501 },
    { field: 'rainMm', value: -1 },
    { field: 'et0Mm', value: 15.5 },
    { field: 'et0Mm', value: -0.1 },
    { field: 'humidityPct', value: 101 },
    { field: 'rainProbPct', value: -5 },
    { field: 'windKmh', value: 301 },
  ];

  for (const { field, value } of outOfRange) {
    it(`rejects ${field}=${value} with reason "out_of_range"`, () => {
      const daily = primarySeries();
      // A single bad row among fourteen good ones: rejection is whole (RES-03).
      daily[9] = row(9, { [field]: value });

      const result = validateDaily({ source: 'open-meteo', daily });

      assert.equal(result.ok, false);
      assert.equal(result.reason, 'out_of_range');
      assert.equal(result.detail, `${field}=${value}`);
      assert.equal(result.daily, undefined, 'a rejected payload still returned rows');
    });
  }

  it('accepts the exact bounds — the range is inclusive', () => {
    const bounds = series(14).map((entry, index) => ({
      ...entry,
      ...(index === 0
        ? { tMinC: RANGES.tMinC[0], tMaxC: RANGES.tMaxC[1], rainMm: 0, et0Mm: 0 }
        : {}),
      ...(index === 1 ? { rainMm: RANGES.rainMm[1], et0Mm: RANGES.et0Mm[1] } : {}),
    }));

    assert.equal(validateDaily({ source: 'open-meteo', daily: bounds }).ok, true);
  });

  it('rejects a non-numeric value in a numeric field', () => {
    for (const value of ['24', Number.NaN, Infinity, {}, true]) {
      const daily = primarySeries();
      daily[3] = row(3, { humidityPct: value });

      const result = validateDaily({ source: 'open-meteo', daily });
      assert.equal(result.ok, false, `accepted humidityPct=${String(value)}`);
      assert.equal(result.reason, 'non_numeric');
      assert.equal(result.detail, 'humidityPct');
    }
  });

  it('publishes the ranges validation.md quotes', () => {
    assert.deepEqual(RANGES.tMinC, [-30, 55]);
    assert.deepEqual(RANGES.tMaxC, [-30, 55]);
    assert.deepEqual(RANGES.rainMm, [0, 500]);
    assert.deepEqual(RANGES.et0Mm, [0, 15]);
    assert.deepEqual(RANGES.humidityPct, [0, 100]);
    assert.deepEqual(RANGES.rainProbPct, [0, 100]);
  });
});

// ── Structural rules ────────────────────────────────────────────────────────

describe('validateDaily · structural rules', () => {
  it('rejects a duplicate date — a repeat would silently overwrite a day', () => {
    const daily = primarySeries();
    daily[5] = row(4);

    const result = validateDaily({ source: 'open-meteo', daily });

    assert.equal(result.ok, false);
    assert.equal(result.reason, 'duplicate_date');
    assert.equal(result.detail, '2026-08-05');
  });

  it('treats two different timestamps on the same calendar day as duplicates', () => {
    const daily = fallbackSeries(3).concat([row(0, { date: '2026-08-01T18:00:00Z' })]);

    const result = validateDaily({ source: 'openweathermap', daily });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'duplicate_date');
  });

  it('rejects tMinC above tMaxC', () => {
    const daily = primarySeries();
    daily[2] = row(2, { tMinC: 34, tMaxC: 30 });

    const result = validateDaily({ source: 'open-meteo', daily });

    assert.equal(result.ok, false);
    assert.equal(result.reason, 'tmin_above_tmax');
    assert.equal(result.detail, '34>30');
  });

  it('accepts tMinC exactly equal to tMaxC', () => {
    const daily = primarySeries();
    daily[2] = row(2, { tMinC: 30, tMaxC: 30 });

    assert.equal(validateDaily({ source: 'open-meteo', daily }).ok, true);
  });

  it('rejects a missing required field, naming which one', () => {
    for (const field of ['date', 'tMinC', 'tMaxC']) {
      for (const value of [null, undefined]) {
        const daily = primarySeries();
        daily[7] = row(7, { [field]: value });

        const result = validateDaily({ source: 'open-meteo', daily });
        assert.equal(result.ok, false, `accepted ${field}=${String(value)}`);
        assert.equal(result.reason, 'missing_required_field');
        assert.equal(result.detail, field);
      }
    }
  });

  it('rejects an unparseable date', () => {
    const daily = primarySeries();
    daily[1] = row(1, { date: 'the day before yesterday' });

    const result = validateDaily({ source: 'open-meteo', daily });

    assert.equal(result.ok, false);
    assert.equal(result.reason, 'unparseable_date');
  });

  it('rejects a row that is not an object', () => {
    for (const bad of [null, 'row', 42]) {
      const daily = primarySeries();
      daily[0] = bad;

      const result = validateDaily({ source: 'open-meteo', daily });
      assert.equal(result.ok, false, `accepted a ${typeof bad} row`);
      assert.equal(result.reason, 'row_not_an_object');
    }
  });
});

// ── The ET₀ fallback path ───────────────────────────────────────────────────

describe('validateDaily · a null ET₀ is the honest fallback value, not an error', () => {
  it('accepts a series with null et0Mm on every row', () => {
    const result = validateDaily({ source: 'openweathermap', daily: fallbackSeries(5) });

    assert.equal(result.ok, true);
    for (const entry of result.daily) {
      assert.equal(entry.et0Mm, undefined, 'a null ET₀ was coerced to a number');
    }
  });

  it('accepts a null ET₀ on the primary too — a variable it could not model', () => {
    const daily = primarySeries();
    daily[3] = row(3, { et0Mm: null });

    const result = validateDaily({ source: 'open-meteo', daily });
    assert.equal(result.ok, true);
    assert.equal(result.daily[3].et0Mm, undefined);
  });

  it('accepts nulls in every optional field at once', () => {
    const bare = series(5, {
      humidityPct: null,
      windKmh: null,
      rainMm: null,
      rainProbPct: null,
      et0Mm: null,
    });

    const result = validateDaily({ source: 'openweathermap', daily: bare });
    assert.equal(result.ok, true);
    assert.deepEqual(Object.keys(result.daily[0]), [
      'date',
      'tMinC',
      'tMaxC',
      'humidityPct',
      'windKmh',
      'rainMm',
      'rainProbPct',
      'et0Mm',
    ]);
  });
});

// ── splitByDay ──────────────────────────────────────────────────────────────

describe('splitByDay · today belongs to the forecast', () => {
  /**
   * Local-midnight dates, because the split is taken at local midnight
   * (`setHours(0,0,0,0)`). Building the fixture the same way keeps the case
   * true in any zone the suite happens to run in.
   */
  const localMidnight = (dayOffset) => new Date(2026, 7, 13 + dayOffset);
  const asOf = new Date(2026, 7, 13, 14, 30, 0);

  const daily = [-2, -1, 0, 1, 2].map((offset) => ({
    date: localMidnight(offset),
    tMinC: 24,
    tMaxC: 33,
  }));

  it('puts today in `forecast`, never in `past`', () => {
    const { past, forecast } = splitByDay(daily, asOf);

    assert.equal(past.length, 2);
    assert.equal(forecast.length, 3);
    assert.equal(forecast[0].date.getTime(), localMidnight(0).getTime());
    assert.ok(past.every((entry) => entry.date < localMidnight(0)));
  });

  it('splits at local midnight, not at the moment of `asOf`', () => {
    // A reading stamped earlier today is still forecast-side.
    const withMorning = [{ date: new Date(2026, 7, 13, 6, 0), tMinC: 24, tMaxC: 33 }, ...daily];

    const { past, forecast } = splitByDay(withMorning, asOf);

    assert.equal(past.length, 2);
    assert.equal(forecast.length, 4);
  });

  it('is stable at exactly midnight', () => {
    const { past, forecast } = splitByDay(daily, localMidnight(0));

    assert.equal(past.length, 2);
    assert.equal(forecast.length, 3);
  });

  it('returns two empty halves for an empty series', () => {
    assert.deepEqual(splitByDay([], asOf), { past: [], forecast: [] });
  });

  it('composes with validateDaily output', () => {
    // Local-midnight dates again, for the same reason: the boundary is local.
    const localSeries = Array.from({ length: 14 }, (_, index) => ({
      ...row(index),
      date: new Date(2026, 7, 1 + index),
    }));
    const validated = validateDaily({ source: 'open-meteo', daily: localSeries });
    assert.equal(validated.ok, true);

    const { past, forecast } = splitByDay(validated.daily, new Date(2026, 7, 8, 9, 0));

    assert.equal(past.length + forecast.length, 14);
    assert.equal(past.length, 7, 'the seven past days did not land on the past side');
    assert.equal(forecast.length, 7);
  });
});
