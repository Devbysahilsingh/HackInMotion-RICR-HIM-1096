/**
 * Market signal engine — unit tests.
 *
 * docs/market/market-insights.md §Tests, verbatim: "Signal math unit tests
 * (synthetic series: rising/falling/flat/noisy ±4%); aggregation median
 * correctness; guidance key selection; flip-emission dedupe." The first three
 * are this file; flip emission belongs to the feed job and is not part of the
 * engine, so it is not asserted here.
 *
 * The engine is pure, so every case is a synthetic series in and an object out:
 * no database, no network, no clock. Prices are fabricated round numbers chosen
 * so the percentages are checkable by hand — they are not market data.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  MARKET_SIGNAL_THRESHOLD_PCT,
  MARKET_SIGNAL_WINDOW_OBS,
  MARKET_TREND_WINDOW_OBS,
} from '../../src/config/constants.js';
import {
  SIGNALS,
  SIGNAL_REASONS,
  SIGNAL_TRACE_STEPS,
  computeMarketSignal,
  guidanceKeyFor,
  median,
  toDailySeries,
} from '../../src/engines/marketSignal/marketSignal.js';

// ── Fixtures ────────────────────────────────────────────────────────────────

/** Fixed epoch: every date in this file is derived from it, never from now. */
const DAY_ZERO = Date.UTC(2026, 4, 1); // 1 May 2026
const MS_PER_DAY = 86_400_000;

const dayAt = (offset) => new Date(DAY_ZERO + offset * MS_PER_DAY);

/** One mandi reporting on consecutive days, oldest first. */
const dailyRows = (prices, { market = 'Kalamna', from = 0 } = {}) =>
  prices.map((modalPrice, index) => ({
    date: dayAt(from + index),
    market,
    modalPrice,
  }));

/** `count` copies of `value`. */
const flat = (count, value) => Array.from({ length: count }, () => value);

const stepOf = (result, step) => result.trace.find((entry) => entry.step === step);

const signalFor = (prices) => computeMarketSignal({ rows: dailyRows(prices) });

// ── Synthetic series (rising / falling / flat / noisy ±4%) ──────────────────

describe('computeMarketSignal · synthetic series', () => {
  it('classifies a rising series as RISING', () => {
    const result = signalFor([...flat(7, 1000), ...flat(7, 1200)]);

    assert.equal(result.trend, SIGNALS.RISING);
    assert.equal(result.changePct7d, 20);
    assert.equal(result.reasonCode, SIGNAL_REASONS.OK);
  });

  it('classifies a falling series as FALLING', () => {
    const result = signalFor([...flat(7, 1000), ...flat(7, 800)]);

    assert.equal(result.trend, SIGNALS.FALLING);
    assert.equal(result.changePct7d, -20);
  });

  it('classifies a flat series as STABLE with a change of exactly zero', () => {
    const result = signalFor(flat(14, 1000));

    assert.equal(result.trend, SIGNALS.STABLE);
    assert.equal(result.changePct7d, 0);
  });

  /**
   * The explicit boundary case from the doc: agri price noise is high, and the
   * ±5% threshold exists so day-to-day jitter does not produce a flapping
   * signal. A series that never leaves ±4% of its own level must read STABLE.
   */
  it('classifies a noisy ±4% series as STABLE, not as a trend', () => {
    const noisy = [1040, 960, 1035, 970, 1040, 962, 1038, 965, 1040, 960, 1036, 968, 1040, 961];

    for (const price of noisy) {
      assert.ok(Math.abs(price - 1000) <= 40, `${price} left the ±4% band`);
    }

    const result = signalFor(noisy);

    assert.equal(result.trend, SIGNALS.STABLE);
    assert.ok(
      Math.abs(result.changePct7d) < MARKET_SIGNAL_THRESHOLD_PCT,
      `noise produced a ${result.changePct7d}% swing`,
    );
  });

  it('does not flap when the same noisy level is sampled one day further on', () => {
    const noisy = [
      1040, 960, 1035, 970, 1040, 962, 1038, 965, 1040, 960, 1036, 968, 1040, 961, 1039,
    ];

    assert.equal(signalFor(noisy.slice(0, 14)).trend, SIGNALS.STABLE);
    assert.equal(signalFor(noisy.slice(1, 15)).trend, SIGNALS.STABLE);
  });
});

describe('computeMarketSignal · threshold boundaries', () => {
  it('treats exactly +5% as RISING — the bound is inclusive', () => {
    const result = signalFor([...flat(7, 1000), ...flat(7, 1050)]);

    assert.equal(result.changePct7d, MARKET_SIGNAL_THRESHOLD_PCT);
    assert.equal(result.trend, SIGNALS.RISING);
  });

  it('treats exactly −5% as FALLING — the bound is inclusive', () => {
    const result = signalFor([...flat(7, 1000), ...flat(7, 950)]);

    assert.equal(result.changePct7d, -MARKET_SIGNAL_THRESHOLD_PCT);
    assert.equal(result.trend, SIGNALS.FALLING);
  });

  it('treats +4.99% as STABLE', () => {
    const result = signalFor([...flat(7, 1000), ...flat(7, 1049.9)]);

    assert.equal(result.changePct7d, 4.99);
    assert.equal(result.trend, SIGNALS.STABLE);
  });

  it('treats −4.99% as STABLE', () => {
    const result = signalFor([...flat(7, 1000), ...flat(7, 950.1)]);

    assert.equal(result.changePct7d, -4.99);
    assert.equal(result.trend, SIGNALS.STABLE);
  });
});

// ── Aggregation (median, not mean) ──────────────────────────────────────────

describe('median', () => {
  it('takes the middle value of an odd-length set', () => {
    assert.equal(median([3, 1, 2]), 2);
    assert.equal(median([1000]), 1000);
    assert.equal(median([5, 1, 9, 3, 7]), 5);
  });

  it('takes the mean of the two central values of an even-length set', () => {
    assert.equal(median([1, 2, 3, 4]), 2.5);
    assert.equal(median([1000, 2000]), 1500);
  });

  it('is null for an empty set rather than 0 or NaN', () => {
    assert.equal(median([]), null);
  });

  it('does not mutate or reorder the caller’s array', () => {
    const values = [3, 1, 2];
    median(values);
    assert.deepEqual(values, [3, 1, 2]);
  });
});

describe('toDailySeries · district aggregation across mandis', () => {
  it('collapses several mandis on one date into one point with a mandi count', () => {
    const rows = [
      { date: dayAt(0), market: 'Kalamna', modalPrice: 1000 },
      { date: dayAt(0), market: 'Wardha', modalPrice: 1010 },
      { date: dayAt(0), market: 'Katol', modalPrice: 990 },
    ];

    assert.deepEqual(toDailySeries(rows), [
      { date: '2026-05-01', modalPrice: 1000, mandiCount: 3 },
    ]);
  });

  /**
   * The reason the doc specifies a median: one mandi publishing a wild figure
   * must not move the district. The mean of this set is 21001.
   */
  it('is unmoved by one wild outlier mandi, which is why it is not a mean', () => {
    const sane = [
      { date: dayAt(0), market: 'Kalamna', modalPrice: 1000 },
      { date: dayAt(0), market: 'Wardha', modalPrice: 1010 },
      { date: dayAt(0), market: 'Katol', modalPrice: 990 },
      { date: dayAt(0), market: 'Umred', modalPrice: 1005 },
    ];
    const withOutlier = [...sane, { date: dayAt(0), market: 'Ramtek', modalPrice: 99_999 }];

    const [before] = toDailySeries(sane);
    const [after] = toDailySeries(withOutlier);

    assert.equal(before.modalPrice, 1002.5);
    assert.equal(after.modalPrice, 1005);
    assert.equal(after.mandiCount, 5);
    assert.ok(Math.abs(after.modalPrice - before.modalPrice) < 5, 'the outlier moved the district');
  });

  it('sorts oldest-first however the rows arrive', () => {
    const shuffled = [
      { date: dayAt(2), modalPrice: 1200 },
      { date: dayAt(0), modalPrice: 1000 },
      { date: dayAt(1), modalPrice: 1100 },
    ];

    assert.deepEqual(
      toDailySeries(shuffled).map((point) => point.date),
      ['2026-05-01', '2026-05-02', '2026-05-03'],
    );
  });

  it('skips rows whose price is not a finite number', () => {
    const rows = [
      { date: dayAt(0), modalPrice: 1000 },
      { date: dayAt(0), modalPrice: Number.NaN },
      { date: dayAt(0), modalPrice: Number.POSITIVE_INFINITY },
      { date: dayAt(0), modalPrice: '1500' },
      { date: dayAt(0), modalPrice: null },
      { date: dayAt(0) },
    ];

    assert.deepEqual(toDailySeries(rows), [
      { date: '2026-05-01', modalPrice: 1000, mandiCount: 1 },
    ]);
  });

  /**
   * A `null` date is deliberately NOT among these: `new Date(null)` is the
   * epoch, not an Invalid Date, so such a row is currently bucketed into
   * 1970-01-01 rather than skipped. Reported rather than asserted — the stored
   * schema requires `date`, so nothing on the read path can produce one, but
   * asserting the current behaviour here would enshrine it.
   */
  it('skips rows whose date is unreadable rather than bucketing them together', () => {
    const rows = [
      { date: dayAt(0), modalPrice: 1000 },
      { date: 'sometime', modalPrice: 2000 },
      { date: 'not-a-date', modalPrice: 3000 },
      { date: undefined, modalPrice: 4000 },
      { modalPrice: 5000 },
    ];

    assert.deepEqual(toDailySeries(rows), [
      { date: '2026-05-01', modalPrice: 1000, mandiCount: 1 },
    ]);
  });

  it('accepts ISO strings as well as Dates', () => {
    const rows = [
      { date: '2026-05-02T00:00:00.000Z', modalPrice: 1100 },
      { date: dayAt(0), modalPrice: 1000 },
    ];

    assert.deepEqual(
      toDailySeries(rows).map((point) => point.date),
      ['2026-05-01', '2026-05-02'],
    );
  });

  it('is empty for no rows at all', () => {
    assert.deepEqual(toDailySeries(), []);
    assert.deepEqual(toDailySeries([]), []);
  });
});

// ── Windows are observations, not calendar days ─────────────────────────────

describe('computeMarketSignal · windows count observations, not days', () => {
  it('compares the last 7 observations against the prior 7 across a sparse series', () => {
    // Fourteen reports spread over eleven weeks, with gaps a small mandi would
    // really produce. A calendar window would compare unlike things here.
    const offsets = [0, 1, 4, 11, 19, 26, 33, 40, 47, 48, 52, 60, 67, 74];
    const prices = [...flat(7, 1000), ...flat(7, 1200)];
    const rows = offsets.map((offset, index) => ({
      date: dayAt(offset),
      market: 'Kalamna',
      modalPrice: prices[index],
    }));

    const result = computeMarketSignal({ rows });

    assert.equal(result.trend, SIGNALS.RISING);
    assert.equal(result.changePct7d, 20);

    const windows = stepOf(result, SIGNAL_TRACE_STEPS.WINDOWS);
    assert.equal(windows.shortWindow.observations, MARKET_SIGNAL_WINDOW_OBS);
    assert.equal(windows.shortWindow.priorAvg, 1000);
    assert.equal(windows.shortWindow.recentAvg, 1200);
  });

  it('collapses same-day mandi reports before counting observations', () => {
    // 26 rows, but only 13 days — one day short of a verdict.
    const rows = Array.from({ length: 13 }, (_, day) => [
      { date: dayAt(day), market: 'Kalamna', modalPrice: 1000 },
      { date: dayAt(day), market: 'Wardha', modalPrice: 1100 },
    ]).flat();

    const result = computeMarketSignal({ rows });

    assert.equal(rows.length, 26);
    assert.equal(result.series.length, 13);
    assert.equal(result.trend, null);
    assert.equal(result.reasonCode, SIGNAL_REASONS.INSUFFICIENT_OBSERVATIONS);
  });
});

// ── Insufficient data is never dressed up as STABLE ─────────────────────────

describe('computeMarketSignal · insufficient data', () => {
  it('gives no trend below 14 observations, with its own reason code', () => {
    for (const count of [1, 5, 13]) {
      const result = signalFor(flat(count, 1000));

      assert.equal(result.trend, null, `${count} observations produced a verdict`);
      assert.notEqual(result.trend, SIGNALS.STABLE, 'a data gap was reported as steady prices');
      assert.equal(result.reasonCode, SIGNAL_REASONS.INSUFFICIENT_OBSERVATIONS);
      assert.equal(result.changePct7d, null);
      assert.equal(result.changePct30d, null);
      assert.equal(result.momentumDiverges, false);
      assert.equal(result.series.length, count);
    }
  });

  it('gives a verdict at exactly 14 observations', () => {
    const result = signalFor(flat(MARKET_SIGNAL_WINDOW_OBS * 2, 1000));

    assert.equal(result.trend, SIGNALS.STABLE);
    assert.equal(result.reasonCode, SIGNAL_REASONS.OK);
  });

  it('reports no observations distinctly from too few', () => {
    for (const result of [computeMarketSignal({ rows: [] }), computeMarketSignal()]) {
      assert.equal(result.reasonCode, SIGNAL_REASONS.NO_OBSERVATIONS);
      assert.notEqual(result.reasonCode, SIGNAL_REASONS.INSUFFICIENT_OBSERVATIONS);
      assert.equal(result.trend, null);
      assert.deepEqual(result.series, []);
      assert.equal(result.latest, null);
      assert.equal(stepOf(result, SIGNAL_TRACE_STEPS.NO_VERDICT).reasonCode, 'NO_OBSERVATIONS');
    }
  });

  it('leaves the 30-day change null until 60 observations exist', () => {
    assert.equal(signalFor(flat(59, 1000)).changePct30d, null);
    assert.equal(signalFor(flat(MARKET_TREND_WINDOW_OBS * 2, 1000)).changePct30d, 0);
  });
});

// ── Momentum divergence ─────────────────────────────────────────────────────

describe('computeMarketSignal · momentum note', () => {
  /** A month-long fall with an uptick in the last week. */
  const RECENT_UPTICK = [...flat(30, 1200), ...flat(23, 950), ...flat(7, 1100)];

  it('is raised only when the 7-day and 30-day classifications differ', () => {
    const result = computeMarketSignal({ rows: dailyRows(RECENT_UPTICK) });

    assert.equal(result.trend, SIGNALS.RISING);
    assert.equal(result.longTrend, SIGNALS.FALLING);
    assert.equal(result.momentumDiverges, true);
  });

  it('is not raised when both windows agree', () => {
    const monotone = Array.from({ length: 60 }, (_, index) => 1000 + index * 20);
    const result = computeMarketSignal({ rows: dailyRows(monotone) });

    assert.equal(result.trend, SIGNALS.RISING);
    assert.equal(result.longTrend, SIGNALS.RISING);
    assert.equal(result.momentumDiverges, false);
  });

  it('is not raised when the long window cannot be classified at all', () => {
    const result = signalFor([...flat(7, 1000), ...flat(7, 1200)]);

    assert.equal(result.trend, SIGNALS.RISING);
    assert.equal(result.longTrend, null);
    assert.equal(result.changePct30d, null);
    assert.equal(result.momentumDiverges, false, 'a missing long window read as a divergence');
  });
});

// ── Guidance keys ───────────────────────────────────────────────────────────

describe('guidanceKeyFor', () => {
  it('returns one key per trend', () => {
    assert.equal(guidanceKeyFor(SIGNALS.RISING), 'market.guidanceRising');
    assert.equal(guidanceKeyFor(SIGNALS.FALLING), 'market.guidanceFalling');
    assert.equal(guidanceKeyFor(SIGNALS.STABLE), 'market.guidanceStable');
  });

  it('returns the unavailable key when there is no trend', () => {
    for (const absent of [null, undefined, '', 'RISING ', 'rising', 'UNKNOWN']) {
      assert.equal(
        guidanceKeyFor(absent),
        'market.guidanceUnavailable',
        `${JSON.stringify(absent)} was treated as a trend`,
      );
    }
  });

  it('is the key the engine’s own no-verdict result maps to', () => {
    assert.equal(
      guidanceKeyFor(computeMarketSignal({ rows: [] }).trend),
      'market.guidanceUnavailable',
    );
    assert.equal(guidanceKeyFor(signalFor(flat(13, 1000)).trend), 'market.guidanceUnavailable');
  });
});

// ── R12 · trace ─────────────────────────────────────────────────────────────

describe('computeMarketSignal · trace (R12)', () => {
  it('records the input, the series, the windows and the verdict with their numbers', () => {
    const result = signalFor([...flat(7, 1000), ...flat(7, 1200)]);

    assert.deepEqual(
      result.trace.map((entry) => entry.step),
      [
        SIGNAL_TRACE_STEPS.INPUT,
        SIGNAL_TRACE_STEPS.SERIES,
        SIGNAL_TRACE_STEPS.WINDOWS,
        SIGNAL_TRACE_STEPS.VERDICT,
      ],
    );

    assert.deepEqual(stepOf(result, SIGNAL_TRACE_STEPS.INPUT), { step: 'INPUT', rowCount: 14 });
    assert.deepEqual(stepOf(result, SIGNAL_TRACE_STEPS.SERIES), {
      step: 'SERIES',
      observations: 14,
      firstDate: '2026-05-01',
      lastDate: '2026-05-14',
    });
    assert.deepEqual(stepOf(result, SIGNAL_TRACE_STEPS.WINDOWS), {
      step: 'WINDOWS',
      shortWindow: { changePct: 20, recentAvg: 1200, priorAvg: 1000, observations: 7 },
      longWindow: null,
      thresholdPct: MARKET_SIGNAL_THRESHOLD_PCT,
      requiredObservations: 14,
    });
    assert.deepEqual(stepOf(result, SIGNAL_TRACE_STEPS.VERDICT), {
      step: 'VERDICT',
      trend: 'RISING',
      changePct7d: 20,
      changePct30d: null,
      longTrend: null,
      momentumDiverges: false,
    });
  });

  it('ends every no-verdict path with its reason and the counts behind it', () => {
    const result = signalFor(flat(9, 1000));
    const last = result.trace.at(-1);

    assert.equal(last.step, SIGNAL_TRACE_STEPS.NO_VERDICT);
    assert.equal(last.reasonCode, result.reasonCode);
    assert.equal(last.have, 9);
    assert.equal(last.need, 14);
  });

  it('is structured data throughout, never prose', () => {
    for (const result of [signalFor(flat(20, 1000)), computeMarketSignal({ rows: [] })]) {
      for (const entry of result.trace) {
        assert.equal(typeof entry, 'object');
        assert.equal(typeof entry.step, 'string');
      }
    }
  });
});

// ── Purity ──────────────────────────────────────────────────────────────────

describe('computeMarketSignal · purity', () => {
  const deepFreeze = (rows) => Object.freeze(rows.map((row) => Object.freeze({ ...row })));

  it('is deterministic: identical inputs give a deeply equal result', () => {
    const rows = dailyRows([...flat(7, 1000), ...flat(7, 1200)]);

    assert.deepEqual(computeMarketSignal({ rows }), computeMarketSignal({ rows }));
  });

  it('does not mutate the rows it is handed, even frozen ones', () => {
    const rows = deepFreeze(dailyRows([...flat(7, 1000), ...flat(7, 1200)]));
    const snapshot = rows.map((row) => ({ ...row, date: row.date.getTime() }));

    const result = computeMarketSignal({ rows });

    assert.equal(result.trend, SIGNALS.RISING);
    assert.deepEqual(
      rows.map((row) => ({ ...row, date: row.date.getTime() })),
      snapshot,
    );
  });

  it('only ever returns a signal and a reason code from the exported sets', () => {
    const signals = new Set([...Object.values(SIGNALS), null]);
    const reasons = new Set(Object.values(SIGNAL_REASONS));

    const cases = [
      [],
      flat(1, 1000),
      flat(13, 1000),
      flat(14, 1000),
      [...flat(7, 1000), ...flat(7, 1200)],
      [...flat(7, 1000), ...flat(7, 800)],
      Array.from({ length: 60 }, (_, index) => 1000 + index * 20),
    ];

    for (const prices of cases) {
      const result = computeMarketSignal({ rows: dailyRows(prices) });
      assert.ok(signals.has(result.trend), `unknown trend ${result.trend}`);
      assert.ok(reasons.has(result.reasonCode), `unknown reason ${result.reasonCode}`);
    }

    assert.ok(Object.isFrozen(SIGNALS));
    assert.ok(Object.isFrozen(SIGNAL_REASONS));
  });
});
