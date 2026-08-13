/**
 * Market signal engine — PURE (CLAUDE.md rule 5), and deliberately not a
 * predictor.
 *
 * docs/market/market-insights.md, verbatim:
 *   "Per commodity×(district|state): daily modal price series (district median
 *    across mandis when aggregating).
 *    - changePct7d = (avg last 7 obs − avg prior 7) / prior; changePct30d analogous.
 *    - Signal: RISING if changePct7d ≥ +5% · FALLING ≤ −5% · else STABLE.
 *      (Threshold: agri price noise is high; ±5% avoids flappy signals.)
 *    - Momentum note when 7d and 30d disagree."
 * and: "Never: predictions, guarantees, 'will rise'."
 *
 * Two details that are easy to get wrong and are load-bearing:
 *
 *   **Observations, not calendar days.** The doc says "avg last 7 *obs*". Small
 *   mandis report sparsely ("sparse days for small mandis"), so a calendar
 *   window would compare a 7-day average built from two prices against one
 *   built from seven. The windows are counts of available observations.
 *
 *   **Median across mandis, mean across days.** Aggregating a district uses the
 *   median so one outlier mandi cannot move the district; averaging the window
 *   uses the mean, as written.
 *
 * Insufficient data is NOT forced into STABLE. No document says what to return
 * below the window size, and reporting "steady" for a commodity with three
 * observations would be a fabricated reassurance. `trend` is null with a reason
 * code, and the caller renders the series with its freshness label instead.
 */
import {
  MARKET_SIGNAL_THRESHOLD_PCT,
  MARKET_SIGNAL_WINDOW_OBS,
  MARKET_TREND_WINDOW_OBS,
} from '../../config/constants.js';
import { dayKey } from '../../utils/day.js';

export const SIGNALS = Object.freeze({
  RISING: 'RISING',
  FALLING: 'FALLING',
  STABLE: 'STABLE',
});

export const SIGNAL_REASONS = Object.freeze({
  OK: 'OK',
  NO_OBSERVATIONS: 'NO_OBSERVATIONS',
  INSUFFICIENT_OBSERVATIONS: 'INSUFFICIENT_OBSERVATIONS',
});

export const SIGNAL_TRACE_STEPS = Object.freeze({
  INPUT: 'INPUT',
  SERIES: 'SERIES',
  WINDOWS: 'WINDOWS',
  VERDICT: 'VERDICT',
  NO_VERDICT: 'NO_VERDICT',
});

const round = (value, places = 2) => Number(value.toFixed(places));

/** Even-length medians take the mean of the two central values. */
export function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

const mean = (values) =>
  values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;

/**
 * Collapses raw rows into one modal price per day.
 *
 * @param {{date: Date|string, modalPrice: number}[]} rows
 * @returns {{date: string, modalPrice: number, mandiCount: number}[]} oldest first
 */
export function toDailySeries(rows = []) {
  const byDay = new Map();

  for (const row of rows) {
    if (typeof row?.modalPrice !== 'number' || !Number.isFinite(row.modalPrice)) continue;

    // `dayKey` rejects null/undefined outright: `new Date(null)` is epoch 0
    // rather than an Invalid Date, so a row with no date would otherwise land
    // in a 1 January 1970 bucket and quietly join the series.
    const key = dayKey(row.date);
    if (!key) continue;

    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(row.modalPrice);
  }

  return [...byDay.entries()]
    .map(([date, prices]) => ({
      date,
      modalPrice: round(median(prices)),
      mandiCount: prices.length,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Percent change between the last `size` observations and the `size` before
 * them. Returns null when either window is short — a half-filled window would
 * silently compare unlike things.
 */
function windowChangePct(series, size) {
  if (series.length < size * 2) return null;

  const prices = series.map((point) => point.modalPrice);
  const recent = prices.slice(-size);
  const prior = prices.slice(-size * 2, -size);

  const priorAvg = mean(prior);
  if (!priorAvg) return null; // a zero prior average makes the ratio undefined

  const recentAvg = mean(recent);
  return {
    changePct: round(((recentAvg - priorAvg) / priorAvg) * 100),
    recentAvg: round(recentAvg),
    priorAvg: round(priorAvg),
    observations: size,
  };
}

function classify(changePct) {
  if (changePct >= MARKET_SIGNAL_THRESHOLD_PCT) return SIGNALS.RISING;
  if (changePct <= -MARKET_SIGNAL_THRESHOLD_PCT) return SIGNALS.FALLING;
  return SIGNALS.STABLE;
}

/**
 * @param {object} input
 * @param {{date: Date|string, modalPrice: number}[]} input.rows raw price rows
 * @returns {{trend: string|null, changePct7d: number|null, changePct30d: number|null,
 *            momentumDiverges: boolean, series: object[], reasonCode: string, trace: object[]}}
 */
export function computeMarketSignal({ rows = [] } = {}) {
  const series = toDailySeries(rows);

  const trace = [
    { step: SIGNAL_TRACE_STEPS.INPUT, rowCount: Array.isArray(rows) ? rows.length : 0 },
    {
      step: SIGNAL_TRACE_STEPS.SERIES,
      observations: series.length,
      firstDate: series[0]?.date ?? null,
      lastDate: series.at(-1)?.date ?? null,
    },
  ];

  const empty = {
    trend: null,
    changePct7d: null,
    changePct30d: null,
    momentumDiverges: false,
    series,
    latest: series.at(-1) ?? null,
  };

  if (series.length === 0) {
    trace.push({ step: SIGNAL_TRACE_STEPS.NO_VERDICT, reasonCode: SIGNAL_REASONS.NO_OBSERVATIONS });
    return { ...empty, reasonCode: SIGNAL_REASONS.NO_OBSERVATIONS, trace };
  }

  const short = windowChangePct(series, MARKET_SIGNAL_WINDOW_OBS);
  const long = windowChangePct(series, MARKET_TREND_WINDOW_OBS);

  trace.push({
    step: SIGNAL_TRACE_STEPS.WINDOWS,
    shortWindow: short,
    longWindow: long,
    thresholdPct: MARKET_SIGNAL_THRESHOLD_PCT,
    requiredObservations: MARKET_SIGNAL_WINDOW_OBS * 2,
  });

  // The 7-day window decides the signal; without it there is no signal to give.
  if (!short) {
    trace.push({
      step: SIGNAL_TRACE_STEPS.NO_VERDICT,
      reasonCode: SIGNAL_REASONS.INSUFFICIENT_OBSERVATIONS,
      have: series.length,
      need: MARKET_SIGNAL_WINDOW_OBS * 2,
    });
    return {
      ...empty,
      changePct30d: long?.changePct ?? null,
      reasonCode: SIGNAL_REASONS.INSUFFICIENT_OBSERVATIONS,
      trace,
    };
  }

  const trend = classify(short.changePct);
  // "Momentum note when 7d and 30d disagree" — a divergence of direction, not
  // of magnitude. Both must be classifiable for the note to mean anything.
  const longTrend = long ? classify(long.changePct) : null;
  const momentumDiverges = Boolean(longTrend && longTrend !== trend);

  trace.push({
    step: SIGNAL_TRACE_STEPS.VERDICT,
    trend,
    changePct7d: short.changePct,
    changePct30d: long?.changePct ?? null,
    longTrend,
    momentumDiverges,
  });

  return {
    trend,
    changePct7d: short.changePct,
    changePct30d: long?.changePct ?? null,
    longTrend,
    momentumDiverges,
    series,
    latest: series.at(-1),
    reasonCode: SIGNAL_REASONS.OK,
    trace,
  };
}

/**
 * The i18n key for the guidance line. Keys only — the API never returns prose
 * (rule 8), and the parameters the messages need ({pct}, {district}, {modal})
 * travel separately in `data`.
 */
export function guidanceKeyFor(trend) {
  if (trend === SIGNALS.RISING) return 'market.guidanceRising';
  if (trend === SIGNALS.FALLING) return 'market.guidanceFalling';
  if (trend === SIGNALS.STABLE) return 'market.guidanceStable';
  return 'market.guidanceUnavailable';
}
