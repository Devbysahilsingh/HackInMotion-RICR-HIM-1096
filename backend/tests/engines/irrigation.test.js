/**
 * FAO-56 simplified water balance — engine unit tests.
 *
 * Covers docs/irrigation/calculation-rules.md R1–R14 and the property tests
 * named in docs/irrigation/irrigation-model.md line 26. The engine is pure, so
 * every case is a fixture in / object out — no database, no server, no clock:
 * `asOf` is ALWAYS passed explicitly, and always the same fixed instant.
 *
 * ── ON "FAO WORKED EXAMPLES" ────────────────────────────────────────────────
 *
 * irrigation-model.md §CALCULATION says the engine is "unit-tested against FAO
 * worked examples". **This repository contains no published FAO-56 test
 * vectors.** `backend/src/knowledge/crops.agronomy.json` transcribes Table 11,
 * 12 and 22 *cells* and mentions Examples 35 and 36 only as one-line context
 * notes ("Onion Zr ~ 0.4 m, p = 0.30", "Tomato Zr ~ 0.8 m, p = 0.40"); no
 * example's ET₀ series, soil, TAW, RAW or verdict is recorded anywhere. Copying
 * numbers out of FAO-56 from memory would be fabrication (CLAUDE.md rule 7).
 *
 * So the vectors below are authored here, deterministic, and every step of the
 * arithmetic is written out in a comment so a reviewer can check them with a
 * calculator. The two FAO anchors that *are* recorded (Onion / Tomato Zr and p)
 * get their own vector, using them exactly as the knowledge file states them.
 *
 * Kc curve shapes are illustrative FAO-56-*shaped* numbers chosen to make the
 * arithmetic checkable by hand. They are not agronomic claims and are not the
 * registry's sourced values (those live in the seed, with sourceRefs).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  computeIrrigation,
  IRRIGATION_REASONS,
  IRRIGATION_TRACE_STEPS,
  MODES,
  VERDICTS,
} from '../../src/engines/irrigation/computeIrrigation.js';
import {
  AMOUNT_MAX_MM,
  AMOUNT_MIN_MM,
  AMOUNT_STEP_MM,
  COLD_START_REPLAY_DAYS,
  EFFECTIVE_RAIN_COEFF,
  HORIZON_DAYS,
  RAIN_PROB_THRESHOLD,
  SIMPLIFIED_RAIN_MM,
  SIMPLIFIED_RAIN_WINDOW_HOURS,
} from '../../src/engines/irrigation/constants.js';
import {
  LITERS_PER_ACRE_PER_MM,
  P_ETC_ADJUSTMENT_COEFF,
  P_TABLE_REFERENCE_ETC_MM_DAY,
  PADDY_WATER_DEPTH_CM,
  SOIL_AWC_MM_PER_M,
  STAGE_ROOT_DEPTH_FACTOR,
} from '../../../shared/constants/agronomy.js';

// ── Fixtures ────────────────────────────────────────────────────────────────

/** Fixed instant. Never `new Date()`; never a fake timer. */
const AS_OF = new Date('2026-08-13T06:00:00.000Z');
const MS_PER_DAY = 86_400_000;

/** A date exactly `n` whole days from `AS_OF` (negative = in the past). */
const at = (n) => new Date(AS_OF.getTime() + n * MS_PER_DAY);

/**
 * INITIAL 0–29 · DEVELOPMENT 30–69 · MID 70–109 · LATE 110–134 (total 135).
 * `kcMid` is a parameter so a vector can pick a Kc that keeps ETc a round
 * number.
 */
const curve = (kcMid = 1.2) => [
  { stage: 'INITIAL', days: 30, kc: 0.6 },
  { stage: 'DEVELOPMENT', days: 40, kc: null },
  { stage: 'MID', days: 40, kc: kcMid },
  { stage: 'LATE', days: 25, kc: 0.8 },
];

/** Sown 80 days before `AS_OF` → day 80 → MID (window 70–109), dayInStage 10. */
const SOWN_INTO_MID = at(-80);

/** A flat weather series over the inclusive offset range [from, to]. */
const series = ({ from, to, et0Mm, rainMm = 0, rainProbPct = 0 }) => {
  const out = [];
  for (let offset = from; offset <= to; offset += 1) {
    out.push({ date: at(offset), et0Mm, rainMm, rainProbPct });
  }
  return out;
};

/** Replaces the fields of one day of a series, by day offset. */
const withDay = (days, offset, patch) =>
  days.map((day) => (day.date.getTime() === at(offset).getTime() ? { ...day, ...patch } : day));

/** Drops a field from every day, modelling a provider that omitted it. */
const withoutField = (days, field) =>
  days.map((day) => {
    const copy = { ...day };
    delete copy[field];
    return copy;
  });

/** The standard call: everything overridable, `asOf` never. */
const compute = (overrides = {}) =>
  computeIrrigation({
    crop: { sowingDate: SOWN_INTO_MID, status: 'active' },
    registry: { kcStages: curve(), rootDepthM: 1.0, depletionFraction: 0.55 },
    soilType: 'loamy',
    dailyWeather: series({ from: -7, to: 5, et0Mm: 5.0 }),
    ...overrides,
    asOf: AS_OF,
  });

/** Pulls one trace entry by step name. */
const stepOf = (result, step) => result.trace.find((entry) => entry.step === step);

/** Ledger / projection day rows, whichever the run produced. */
const ledgerEntries = (result) => stepOf(result, IRRIGATION_TRACE_STEPS.LEDGER)?.entries ?? [];
const projectionRows = (result) =>
  stepOf(result, IRRIGATION_TRACE_STEPS.PROJECTION)?.projection ?? [];

/** Recursively freezes an object graph so any write attempt throws. */
const deepFreeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
};

/** Collects the paths of every non-finite number in an object graph. */
function nonFiniteNumbers(value, path = '$', found = []) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) found.push(`${path} = ${String(value)}`);
    return found;
  }
  if (Array.isArray(value)) {
    value.forEach((child, index) => nonFiniteNumbers(child, `${path}[${index}]`, found));
    return found;
  }
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    for (const [key, child] of Object.entries(value)) {
      nonFiniteNumbers(child, `${path}.${key}`, found);
    }
  }
  return found;
}

// ── R1 · crop status ────────────────────────────────────────────────────────

describe('computeIrrigation · R1 status ≠ active → NO verdict (designed state)', () => {
  // R1 "status ≠ active → NO verdict (designed state)."

  for (const status of ['planned', 'harvested']) {
    it(`a ${status} crop gets no verdict and the CROP_NOT_ACTIVE reason`, () => {
      const result = compute({ crop: { sowingDate: SOWN_INTO_MID, status } });

      assert.equal(result.hasVerdict, false);
      assert.equal(result.reasonCode, IRRIGATION_REASONS.CROP_NOT_ACTIVE);
      assert.equal(result.verdict, null);
      assert.equal(result.mode, null);
      assert.equal(result.amountMm, null);
      assert.equal(result.days, null);
    });
  }

  it('the status gate runs before any registry, soil or weather check', () => {
    const result = computeIrrigation({
      crop: { sowingDate: SOWN_INTO_MID, status: 'harvested' },
      registry: { kcStages: 'nonsense', rootDepthM: 'x' },
      soilType: 42,
      dailyWeather: 'nope',
      logs: 'nope',
      asOf: AS_OF,
    });

    assert.equal(result.reasonCode, IRRIGATION_REASONS.CROP_NOT_ACTIVE);
    assert.deepEqual(
      result.trace.map((entry) => entry.step),
      [IRRIGATION_TRACE_STEPS.INPUT, IRRIGATION_TRACE_STEPS.NO_VERDICT],
    );
  });

  /**
   * BUG (found by this suite, NOT fixed here — reported instead).
   *
   * R14 says the engine "never throws". It does: the INPUT trace entry is built
   * before any guard runs and calls `new Date(crop.sowingDate).toISOString()`
   * unconditionally (computeIrrigation.js:176). An unparseable sowingDate makes
   * `toISOString()` raise `RangeError: Invalid time value`, so a single typo in
   * one crop document 500s the whole request — the exact failure mode R14
   * exists to prevent. deriveStage guards this correctly with `toEpochMs`.
   *
   * Characterised here so the defect is on the record and the suite stays
   * honest about what the code does today.
   */
  it('degrades on an unparseable sowingDate rather than throwing (R14)', () => {
    // Building the INPUT trace entry used to call `new Date(junk).toISOString()`
    // unconditionally, so one malformed crop document raised a RangeError and
    // 500'd the request — the exact failure R14 exists to prevent.
    const result = computeIrrigation({
      crop: { sowingDate: 'not a date', status: 'active' },
      registry: { kcStages: curve(), rootDepthM: 1.0, depletionFraction: 0.55 },
      soilType: 'loamy',
      dailyWeather: series({ from: -7, to: 5, et0Mm: 5 }),
      asOf: AS_OF,
    });

    assert.equal(result.hasVerdict, false);
    assert.equal(stepOf(result, 'INPUT').sowingDate, null);
    assert.ok(result.trace.length > 0, 'a degraded result still carries its trace');
  });
});

// ── R2 · mode selection ─────────────────────────────────────────────────────

describe("computeIrrigation · R2 mode = 'full' iff every forecast day has et0Mm", () => {
  // R2 "mode = 'full' iff every forecast day has et0Mm; else 'simplified'."

  it('a complete ET₀ series over past and forecast selects full mode', () => {
    const result = compute();
    const mode = stepOf(result, IRRIGATION_TRACE_STEPS.MODE);

    assert.equal(result.mode, MODES.FULL);
    assert.deepEqual(mode, {
      step: IRRIGATION_TRACE_STEPS.MODE,
      mode: MODES.FULL,
      forecastDays: 6, // offsets 0…5 — today plus the HORIZON_DAYS ahead
      daysMissingEt0: [],
    });
  });

  for (const offset of [0, 2, 5]) {
    it(`one null et0Mm on forecast day +${offset} flips the whole run to simplified`, () => {
      const dailyWeather = withDay(series({ from: -7, to: 5, et0Mm: 5.0 }), offset, {
        et0Mm: null,
      });
      const result = compute({ dailyWeather });

      assert.equal(result.mode, MODES.SIMPLIFIED);
      assert.equal(stepOf(result, IRRIGATION_TRACE_STEPS.MODE).daysMissingEt0.length, 1);
      // The full-mode reservoir was never computed, so it cannot be reported.
      assert.equal(stepOf(result, IRRIGATION_TRACE_STEPS.RESERVOIR), undefined);
    });
  }

  for (const offset of [-7, -4, -1]) {
    it(`a null et0Mm on PAST day ${offset} does not flip the mode`, () => {
      const dailyWeather = withDay(series({ from: -7, to: 5, et0Mm: 5.0 }), offset, {
        et0Mm: null,
      });
      const result = compute({ dailyWeather });

      assert.equal(result.mode, MODES.FULL);
      assert.deepEqual(stepOf(result, IRRIGATION_TRACE_STEPS.MODE).daysMissingEt0, []);
    });
  }

  it('a non-numeric et0Mm counts as missing just as null does', () => {
    for (const et0Mm of [undefined, Number.NaN, '5', Infinity]) {
      const dailyWeather = withDay(series({ from: -7, to: 5, et0Mm: 5.0 }), 3, { et0Mm });
      assert.equal(compute({ dailyWeather }).mode, MODES.SIMPLIFIED, `accepted ${String(et0Mm)}`);
    }
  });
});

// ── R3 · beyond the Kc curve ────────────────────────────────────────────────

describe('computeIrrigation · R3 beyond LATE end → verdict NO + harvest-approaching', () => {
  // R3 "Stage boundaries inclusive-start; beyond LATE end → verdict NO +
  //     harvest-approaching note."

  it('a crop past the end of its 135-day curve ends the season', () => {
    const result = compute({ crop: { sowingDate: at(-135), status: 'active' } });

    assert.equal(result.hasVerdict, false);
    assert.equal(result.reasonCode, IRRIGATION_REASONS.BEYOND_SEASON);
    assert.equal(result.harvestApproaching, true);
    assert.equal(result.verdict, null);
    assert.equal(result.amountMm, null);
  });

  it('the last day of the curve still gets a verdict — the gate is inclusive-start', () => {
    const lastDay = compute({ crop: { sowingDate: at(-134), status: 'active' } });

    assert.equal(lastDay.hasVerdict, true);
    assert.equal(lastDay.stage, 'LATE');
    assert.notEqual(lastDay.reasonCode, IRRIGATION_REASONS.BEYOND_SEASON);
  });

  it('stays past-end however far beyond the season the date is', () => {
    const result = compute({ crop: { sowingDate: at(-500), status: 'active' } });

    assert.equal(result.reasonCode, IRRIGATION_REASONS.BEYOND_SEASON);
    assert.equal(result.harvestApproaching, true);
  });
});

// ── R4 · soil → AWC ─────────────────────────────────────────────────────────

describe('computeIrrigation · R4 AWC lookup exactly per the shared constants table', () => {
  // R4 "AWC lookup exactly per irrigation-model.md table (constants in
  //     `shared/constants/agronomy` with sourceRefs)."
  //
  // rootDepthM 1.0 × MID factor 1.0 means TAW is numerically the AWC itself,
  // so each row below reads straight off the published table.

  const soilRegistry = { kcStages: curve(1.0), rootDepthM: 1.0, depletionFraction: 0.5 };

  for (const [soilType, entry] of Object.entries(SOIL_AWC_MM_PER_M)) {
    it(`${soilType} resolves to ${entry.value} mm/m (published "${entry.published}")`, () => {
      const result = compute({ registry: soilRegistry, soilType });
      const soil = stepOf(result, IRRIGATION_TRACE_STEPS.SOIL);

      assert.equal(soil.soilType, soilType);
      assert.equal(soil.awcMmPerM, entry.value);
      assert.equal(soil.published, entry.published);
      assert.equal(soil.basis, entry.basis);
      assert.equal(soil.tawMm, entry.value * 1.0 * STAGE_ROOT_DEPTH_FACTOR.MID);
      assert.equal(result.tawMm, entry.value);
    });
  }

  it('has exactly the eight documented keys and no others', () => {
    assert.deepEqual(Object.keys(SOIL_AWC_MM_PER_M), [
      'sandy',
      'loamy',
      'clay',
      'black',
      'alluvial',
      'red',
      'laterite',
      'unknown',
    ]);
  });

  it('an unknown soil string falls back to the unknown entry and widens the claim', () => {
    for (const soilType of ['martian-regolith', 'SANDY', '', undefined, null]) {
      const result = compute({ registry: soilRegistry, soilType });
      const soil = stepOf(result, IRRIGATION_TRACE_STEPS.SOIL);

      assert.equal(soil.soilType, 'unknown', `soilType ${String(soilType)} was not normalised`);
      assert.equal(soil.awcMmPerM, SOIL_AWC_MM_PER_M.unknown.value);
      assert.equal(soil.wideUncertainty, true);
      assert.equal(result.soilUncertaintyWide, true);
    }
  });

  it('a known soil never claims wide uncertainty', () => {
    const result = compute({ registry: soilRegistry, soilType: 'clay' });
    assert.equal(result.soilUncertaintyWide, false);
    assert.equal(stepOf(result, IRRIGATION_TRACE_STEPS.SOIL).wideUncertainty, false);
  });
});

// ── R5 · idempotency ────────────────────────────────────────────────────────

describe('computeIrrigation · R5 ledger recompute is idempotent', () => {
  // R5 "Ledger recompute is idempotent: recompute from max(lastAnchor) where
  //     anchor = last log date or initialization point — same inputs, same
  //     output."

  it('the same inputs produce a deeply equal result, twice', () => {
    const input = {
      crop: {
        sowingDate: SOWN_INTO_MID,
        status: 'active',
        waterBalance: { depletionMm: 18, initialized: true },
      },
      registry: { kcStages: curve(), rootDepthM: 1.0, depletionFraction: 0.55 },
      soilType: 'loamy',
      dailyWeather: series({ from: -7, to: 5, et0Mm: 5.0, rainMm: 3, rainProbPct: 70 }),
      logs: [{ date: at(-5), amountMm: 12 }],
      asOf: AS_OF,
    };

    assert.deepEqual(computeIrrigation(input), computeIrrigation(input));
  });

  it('every verdict branch is deterministic, not just the happy one', () => {
    const branches = [
      {},
      { crop: { sowingDate: SOWN_INTO_MID, status: 'planned' } },
      { crop: { sowingDate: at(-500), status: 'active' } },
      { dailyWeather: [] },
      {
        registry: {
          kcStages: curve(),
          rootDepthM: 1.0,
          depletionFraction: 0.55,
          paddyFlooding: true,
        },
      },
      { dailyWeather: withDay(series({ from: -7, to: 5, et0Mm: 5.0 }), 1, { et0Mm: null }) },
      { dailyWeather: series({ from: -7, to: 5, et0Mm: 8.0 }) },
    ];

    for (const override of branches) {
      assert.deepEqual(compute(override), compute(override));
    }
  });

  it('the ledger fold is order-independent: shuffled logs give the same depletion', () => {
    // Four logs across the replay window; the fold buckets them by day, so the
    // order they arrive from the database must not matter.
    const logs = [
      { date: at(-6), amountMm: 3 },
      { date: at(-4), amountMm: 5 },
      { date: at(-2) },
      { date: at(-3), amountMm: 2 },
    ];
    const permutations = [
      logs,
      [...logs].reverse(),
      [logs[2], logs[0], logs[3], logs[1]],
      [logs[1], logs[3], logs[2], logs[0]],
    ];

    const results = permutations.map((permutation) => compute({ logs: permutation }));
    for (const result of results) {
      assert.deepEqual(ledgerEntries(result), ledgerEntries(results[0]));
      assert.equal(result.depletionMm, results[0].depletionMm);
      assert.equal(result.verdict, results[0].verdict);
    }
  });

  it('replays at most COLD_START_REPLAY_DAYS of history on a cold start', () => {
    const result = compute({ dailyWeather: series({ from: -30, to: 5, et0Mm: 5.0 }) });
    const ledger = stepOf(result, IRRIGATION_TRACE_STEPS.LEDGER);

    assert.equal(ledger.replayDays, COLD_START_REPLAY_DAYS);
    assert.equal(ledger.anchorOffset, -COLD_START_REPLAY_DAYS);
    assert.equal(ledger.coldStart, true);
    assert.equal(ledger.initialized, false);
  });
});

// ── R6 · effective rain ─────────────────────────────────────────────────────

describe('computeIrrigation · R6 effective rain factor 0.80', () => {
  // R6 "Effective rain factor 0.80 (named constant EFFECTIVE_RAIN_COEFF,
  //     documented)."
  //
  // Vector: loamy (AWC 160) · Zr 1.0 · MID (factor 1.0) → TAW = 160.
  // ET₀ 5.0, Kc 1.2 → ETc = 6.0/day. Rain 12.5 mm/day observed.
  //   effective rain = 0.8 × 12.5 = 10.0
  //   D(d) = D(d−1) + 6.0 − 10.0 = D(d−1) − 4.0
  //   from D = 100: 96, 92, 88, 84, 80, 76, 72
  it('discounts observed rain by exactly 0.8 in every ledger entry', () => {
    const result = compute({
      crop: {
        sowingDate: SOWN_INTO_MID,
        status: 'active',
        waterBalance: { depletionMm: 100, initialized: true },
      },
      dailyWeather: series({ from: -7, to: 5, et0Mm: 5.0, rainMm: 12.5 }),
    });

    const entries = ledgerEntries(result);
    assert.equal(entries.length, 7);

    for (const entry of entries) {
      assert.equal(entry.rainMm, 12.5);
      assert.equal(entry.effectiveRainMm, 10);
      assert.equal(entry.effectiveRainMm, entry.rainMm * EFFECTIVE_RAIN_COEFF);
      assert.equal(entry.etcMm, 6);
    }

    assert.deepEqual(
      entries.map((entry) => entry.depletionMm),
      [96, 92, 88, 84, 80, 76, 72],
    );
    assert.equal(result.depletionMm, 72);
  });

  it('applies the same coefficient to counted forecast rain', () => {
    // 20 mm at 90 % on every forecast day → 16 mm effective.
    const result = compute({
      dailyWeather: series({ from: 0, to: 5, et0Mm: 5.0, rainMm: 20, rainProbPct: 90 }),
    });

    for (const row of projectionRows(result)) {
      assert.equal(row.effectiveRainMm, 16);
      assert.equal(row.effectiveRainMm, row.rainMm * EFFECTIVE_RAIN_COEFF);
    }
  });

  it('a missing rainMm is read as zero rain, not as NaN', () => {
    const dailyWeather = withoutField(series({ from: -7, to: 5, et0Mm: 5.0 }), 'rainMm');
    const result = compute({ dailyWeather });

    for (const entry of ledgerEntries(result)) {
      assert.equal(entry.rainMm, 0);
      assert.equal(entry.effectiveRainMm, 0);
    }
    assert.equal(result.depletionMm, 42);
  });
});

// ── R7 · rain probability threshold ─────────────────────────────────────────

describe('computeIrrigation · R7 forecast rain counts iff probPct ≥ 60', () => {
  // R7 "Rain counts in projection iff probPct ≥ 60 (RAIN_PROB_THRESHOLD)."
  //
  // Vector: loamy · Zr 1.0 · MID · Kc 1.0 · ET₀ 5.0 → ETc = 5.0/day.
  // p 0.5, meanETc 5.0 → no Table-22 correction → RAW = 0.5 × 160 = 80.
  // Start from a logged D = 20 so the WAIT branch (rain ≥ deficit) cannot fire
  // and the projection runs all six days either way.
  //   prob 59: rain ignored → D: 25, 30, 35, 40, 45, 50
  //   prob 60: 4 mm × 0.8 = 3.2 counted → D: 21.8, 23.6, 25.4, 27.2, 29, 30.8
  const probeAt = (rainProbPct) =>
    compute({
      crop: {
        sowingDate: SOWN_INTO_MID,
        status: 'active',
        waterBalance: { depletionMm: 20, initialized: true },
      },
      registry: { kcStages: curve(1.0), rootDepthM: 1.0, depletionFraction: 0.5 },
      dailyWeather: series({ from: 0, to: 5, et0Mm: 5.0, rainMm: 4, rainProbPct }),
    });

  it('59 % is below the threshold: the rain is not counted', () => {
    const rows = projectionRows(probeAt(RAIN_PROB_THRESHOLD - 1));

    assert.equal(rows.length, 6);
    for (const row of rows) {
      assert.equal(row.rainProbPct, 59);
      assert.equal(row.rainCounted, false);
      assert.equal(row.effectiveRainMm, 0);
    }
    assert.deepEqual(
      rows.map((row) => row.depletionMm),
      [25, 30, 35, 40, 45, 50],
    );
  });

  it('60 % is on the threshold: the rain IS counted', () => {
    const rows = projectionRows(probeAt(RAIN_PROB_THRESHOLD));

    assert.equal(rows.length, 6);
    for (const row of rows) {
      assert.equal(row.rainProbPct, 60);
      assert.equal(row.rainCounted, true);
      assert.equal(row.effectiveRainMm, 3.2);
    }
    assert.deepEqual(
      rows.map((row) => row.depletionMm),
      [21.8, 23.6, 25.4, 27.2, 29, 30.8],
    );
  });

  it('a missing probability is not an implicit 100 %', () => {
    const result = compute({
      crop: {
        sowingDate: SOWN_INTO_MID,
        status: 'active',
        waterBalance: { depletionMm: 20, initialized: true },
      },
      registry: { kcStages: curve(1.0), rootDepthM: 1.0, depletionFraction: 0.5 },
      dailyWeather: withoutField(series({ from: 0, to: 5, et0Mm: 5.0, rainMm: 4 }), 'rainProbPct'),
    });

    for (const row of projectionRows(result)) {
      assert.equal(row.rainCounted, false);
      assert.equal(row.rainProbPct, null);
    }
  });

  it('observed rain is never probability-gated — it already happened', () => {
    // R7 scopes the threshold to the projection. The ledger applies R6 only.
    const result = compute({
      crop: {
        sowingDate: SOWN_INTO_MID,
        status: 'active',
        waterBalance: { depletionMm: 100, initialized: true },
      },
      dailyWeather: series({ from: -7, to: 5, et0Mm: 5.0, rainMm: 10, rainProbPct: 0 }),
    });

    for (const entry of ledgerEntries(result)) {
      assert.equal(entry.effectiveRainMm, 8);
    }
  });
});

// ── R8 · irrigation logs ────────────────────────────────────────────────────

describe('computeIrrigation · R8 a log without amountMm is a refill to field capacity', () => {
  // R8 "Log without amountMm → treat as refill to field capacity (D=0) with
  //     'assumed' marker in trace."

  it('an amount-less log zeroes the depletion and marks the day assumed', () => {
    const result = compute({ logs: [{ date: at(-1) }] });
    const entries = ledgerEntries(result);

    assert.equal(entries.length, 1, 'the anchor is the log day, so only it is replayed');
    assert.deepEqual(entries[0], {
      date: entries[0].date,
      etcMm: 6,
      rainMm: 0,
      effectiveRainMm: 0,
      irrigationMm: null,
      assumed: true,
      depletionBeforeMm: 0,
      depletionMm: 0,
    });
    assert.equal(result.depletionMm, 0);
    assert.equal(stepOf(result, IRRIGATION_TRACE_STEPS.LEDGER).initialized, true);
    assert.equal(stepOf(result, IRRIGATION_TRACE_STEPS.LEDGER).coldStart, false);
  });

  /**
   * A measured application is water, not an anchor. R8 makes *only* a log
   * without `amountMm` mean "refilled to field capacity"; a 2 mm top-up is
   * subtracted on its own day and the replay still starts at the window edge.
   *
   * The engine formerly reset D to 0 on ANY log, so this 2 mm entry erased the
   * 72 mm standing deficit ahead of it — the most dangerous direction for the
   * error to point, since the farmer was then told no irrigation was needed.
   *
   * ET₀ 15.0 × Kc 1.2 → ETc 18.0/day, cold start D = 0 over days −7…−1:
   *   −7: 18 · −6: 36 · −5: 54 · −4: 72
   *   −3: 72 + 18 − 2 = 88   (the amount is subtracted, not assumed)
   *   −2: 106 · −1: 124
   */
  it('a log WITH amountMm subtracts exactly that amount and does not anchor the ledger', () => {
    const result = compute({
      dailyWeather: series({ from: -7, to: 5, et0Mm: 15.0 }),
      logs: [{ date: at(-3), amountMm: 2 }],
    });
    const entries = ledgerEntries(result);

    assert.equal(entries.length, COLD_START_REPLAY_DAYS);
    assert.equal(entries[4].irrigationMm, 2);
    assert.equal(entries[4].assumed, false);
    assert.equal(entries[4].etcMm, 18);
    assert.equal(
      entries[4].depletionMm,
      entries[4].depletionBeforeMm + entries[4].etcMm - entries[4].effectiveRainMm - 2,
    );
    assert.deepEqual(
      entries.map((entry) => entry.depletionMm),
      [18, 36, 54, 72, 88, 106, 124],
    );
    for (const entry of entries) assert.equal(entry.assumed, false);
    assert.equal(stepOf(result, 'LEDGER').anchoredByRefill, false);
  });

  it('the same day with no amount is assumed instead, and reads D = 0', () => {
    const result = compute({
      dailyWeather: series({ from: -7, to: 5, et0Mm: 15.0 }),
      logs: [{ date: at(-3) }],
    });

    assert.deepEqual(
      ledgerEntries(result).map((entry) => [entry.assumed, entry.depletionMm]),
      [
        [true, 0],
        [false, 18],
        [false, 36],
      ],
    );
  });

  it('several amounts on one day are summed before subtraction', () => {
    const result = compute({
      dailyWeather: series({ from: -7, to: 5, et0Mm: 15.0 }),
      logs: [
        { date: at(-3), amountMm: 2 },
        { date: at(-3), amountMm: 5 },
      ],
    });

    // Day −3 is the fifth replayed day: 72 + 18 − (2 + 5) = 83.
    const dayMinusThree = ledgerEntries(result)[4];
    assert.equal(dayMinusThree.irrigationMm, 7);
    assert.equal(dayMinusThree.depletionMm, 83);
  });

  it('one amount-less log among several on a day still means "refilled"', () => {
    const result = compute({
      dailyWeather: series({ from: -7, to: 5, et0Mm: 15.0 }),
      logs: [{ date: at(-3), amountMm: 2 }, { date: at(-3) }],
    });

    assert.equal(ledgerEntries(result)[0].assumed, true);
    assert.equal(ledgerEntries(result)[0].depletionMm, 0);
  });

  it('future-dated logs are ignored rather than applied early', () => {
    const withFuture = compute({ logs: [{ date: at(3) }] });
    const without = compute({ logs: [] });

    assert.equal(withFuture.depletionMm, without.depletionMm);
    assert.equal(stepOf(withFuture, IRRIGATION_TRACE_STEPS.LEDGER).coldStart, true);
  });
});

// ── R9 · irrigation depth ───────────────────────────────────────────────────

describe('computeIrrigation · R9 amountMm = ceil(D/5)×5, min 10, max 75', () => {
  // R9 "amountMm = ceil(D/5)*5, min 10, max 75 per event (>75 → split advice
  //     note)."

  // Vector (floor): sandy (AWC 80) · Zr 0.3 · INITIAL (factor 0.4)
  //   effective root depth = 0.3 × 0.4 = 0.12 m → TAW = 80 × 0.12 = 9.6
  //   ET₀ 5.0, Kc 0.6 → ETc = 3.0; p = 0.5 + 0.04 × (5 − 3) = 0.58
  //   RAW = 0.58 × 9.6 = 5.568 → 5.57
  //   Carried D = 6.0 ≥ 5.57 → IRRIGATE_TODAY
  //   ceil(6/5) × 5 = 10 → already the minimum, so amount = 10 mm
  it('a small deficit floors to the 10 mm minimum', () => {
    const result = compute({
      crop: {
        sowingDate: at(-10), // day 10 → INITIAL
        status: 'active',
        waterBalance: { depletionMm: 6, initialized: true },
      },
      registry: { kcStages: curve(), rootDepthM: 0.3, depletionFraction: 0.5 },
      soilType: 'sandy',
      dailyWeather: series({ from: 0, to: 5, et0Mm: 5.0 }),
    });

    assert.equal(result.stage, 'INITIAL');
    assert.equal(result.kc, 0.6);
    assert.equal(result.tawMm, 9.6);
    assert.equal(result.rawMm, 5.57);
    assert.equal(result.depletionMm, 6);
    assert.equal(result.verdict, VERDICTS.IRRIGATE_TODAY);
    assert.equal(result.days, 0);
    assert.equal(result.amountMm, AMOUNT_MIN_MM);
    assert.equal(result.uncappedMm, 10);
    assert.equal(result.splitAdvised, false);
    assert.equal(result.amountLitersPerAcre, Math.round(10 * LITERS_PER_ACRE_PER_MM));
    assert.equal(result.amountLitersPerAcre, 40_469);
  });

  // Vector (cap): clay (AWC 195) · Zr 1.5 · MID → TAW = 195 × 1.5 = 292.5
  //   ET₀ 5.0, Kc 1.0 → ETc = 5.0; p = 0.5 + 0.04 × (5 − 5) = 0.50
  //   RAW = 0.5 × 292.5 = 146.25; carried D = 200 ≥ 146.25 → IRRIGATE_TODAY
  //   ceil(200/5) × 5 = 200 > 75 → capped to 75, splitAdvised, uncapped kept
  it('a huge deficit caps at 75 mm and says so instead of hiding the shortfall', () => {
    const result = compute({
      crop: {
        sowingDate: SOWN_INTO_MID,
        status: 'active',
        waterBalance: { depletionMm: 200, initialized: true },
      },
      registry: { kcStages: curve(1.0), rootDepthM: 1.5, depletionFraction: 0.5 },
      soilType: 'clay',
      dailyWeather: series({ from: 0, to: 5, et0Mm: 5.0 }),
    });

    assert.equal(result.tawMm, 292.5);
    assert.equal(result.rawMm, 146.25);
    assert.equal(result.verdict, VERDICTS.IRRIGATE_TODAY);
    assert.equal(result.amountMm, AMOUNT_MAX_MM);
    assert.equal(result.uncappedMm, 200);
    assert.equal(result.splitAdvised, true);
    assert.equal(result.amountLitersPerAcre, Math.round(75 * LITERS_PER_ACRE_PER_MM));
    assert.equal(result.amountLitersPerAcre, 303_515);
  });

  it('rounds up to the next 5 mm step, never down', () => {
    // TAW 292.5 / RAW 146.25 again; only the carried deficit changes.
    const amountFor = (depletionMm) =>
      compute({
        crop: {
          sowingDate: SOWN_INTO_MID,
          status: 'active',
          waterBalance: { depletionMm, initialized: true },
        },
        registry: { kcStages: curve(1.0), rootDepthM: 1.5, depletionFraction: 0.5 },
        soilType: 'clay',
        dailyWeather: series({ from: 0, to: 5, et0Mm: 5.0 }),
      });

    for (const [depletion, expected] of [
      [146.25, 150],
      [150, 150],
      [150.1, 155],
      [154.9, 155],
      [160, 160],
    ]) {
      const result = amountFor(depletion);
      assert.equal(result.verdict, VERDICTS.IRRIGATE_TODAY);
      assert.equal(result.uncappedMm, expected, `D ${depletion}`);
      assert.equal(result.uncappedMm % AMOUNT_STEP_MM, 0);
      assert.ok(result.uncappedMm >= depletion, 'rounded below the deficit');
      assert.equal(result.amountMm, Math.min(AMOUNT_MAX_MM, expected));
    }
  });

  it('litres per acre are always round(mm × 4046.86)', () => {
    for (const result of [
      compute({ dailyWeather: series({ from: -7, to: 5, et0Mm: 8.0 }) }),
      compute({
        crop: {
          sowingDate: SOWN_INTO_MID,
          status: 'active',
          waterBalance: { depletionMm: 200, initialized: true },
        },
        registry: { kcStages: curve(1.0), rootDepthM: 1.5, depletionFraction: 0.5 },
        soilType: 'clay',
        dailyWeather: series({ from: 0, to: 5, et0Mm: 5.0 }),
      }),
    ]) {
      assert.ok(result.amountMm > 0);
      assert.equal(
        result.amountLitersPerAcre,
        Math.round(result.amountMm * LITERS_PER_ACRE_PER_MM),
      );
    }
  });
});

// ── R10 · the soil reservoir ────────────────────────────────────────────────

describe('computeIrrigation · R10 TAW = AWC × stage-adjusted root depth; D clamps [0, TAW]', () => {
  // R10 "D clamps [0, TAW]; TAW uses stage-adjusted root depth: rootDepthM ×
  //      stageDepthFactor {INITIAL:0.4, DEV:0.7, MID:1.0, LATE:1.0}."

  const stageDays = { INITIAL: 10, DEVELOPMENT: 50, MID: 80, LATE: 120 };

  for (const [stage, factor] of Object.entries(STAGE_ROOT_DEPTH_FACTOR)) {
    it(`${stage} applies factor ${factor}: TAW = 160 × 1.2 × ${factor}`, () => {
      const result = compute({
        crop: { sowingDate: at(-stageDays[stage]), status: 'active' },
        registry: { kcStages: curve(1.0), rootDepthM: 1.2, depletionFraction: 0.5 },
        soilType: 'loamy',
      });
      const soil = stepOf(result, IRRIGATION_TRACE_STEPS.SOIL);

      assert.equal(result.stage, stage);
      assert.equal(soil.rootDepthM, 1.2);
      assert.equal(soil.stageFactor, factor);
      assert.equal(soil.effectiveRootDepthM, Number((1.2 * factor).toFixed(3)));
      assert.equal(soil.tawMm, Number((160 * 1.2 * factor).toFixed(2)));
      assert.equal(result.tawMm, soil.tawMm);
    });
  }

  // Vector (upper clamp): sandy (AWC 80) · Zr 0.3 · MID → TAW = 80 × 0.3 = 24.
  //   ET₀ 15.0 (the validator maximum), Kc 1.2 → ETc = 18.0/day, no rain.
  //   day −7: 0 + 18 = 18 · day −6: 18 + 18 = 36 → clamped to TAW = 24
  //   every later day stays pinned at 24 — the reservoir cannot over-empty.
  it('depletion never rises above TAW however large ETc is', () => {
    const result = compute({
      registry: { kcStages: curve(), rootDepthM: 0.3, depletionFraction: 0.5 },
      soilType: 'sandy',
      dailyWeather: series({ from: -7, to: 5, et0Mm: 15.0 }),
    });

    assert.equal(result.tawMm, 24);
    assert.deepEqual(
      ledgerEntries(result).map((entry) => entry.depletionMm),
      [18, 24, 24, 24, 24, 24, 24],
    );
    for (const entry of ledgerEntries(result)) {
      assert.ok(entry.depletionMm <= result.tawMm, `D ${entry.depletionMm} > TAW`);
    }
    assert.equal(result.depletionMm, 24);
  });

  // Vector (lower clamp): loamy · Zr 1.0 · MID → TAW = 160, D starts at 100.
  //   ETc 6.0, rain 500 mm → effective 400 mm → 100 + 6 − 400 = −294 → 0.
  it('depletion never falls below zero however large the rain is', () => {
    const result = compute({
      crop: {
        sowingDate: SOWN_INTO_MID,
        status: 'active',
        waterBalance: { depletionMm: 100, initialized: true },
      },
      dailyWeather: series({ from: -7, to: 5, et0Mm: 5.0, rainMm: 500, rainProbPct: 100 }),
    });

    assert.equal(result.tawMm, 160);
    assert.deepEqual(
      ledgerEntries(result).map((entry) => entry.depletionMm),
      [0, 0, 0, 0, 0, 0, 0],
    );
    for (const entry of ledgerEntries(result)) assert.ok(entry.depletionMm >= 0);
    for (const row of projectionRows(result)) {
      assert.ok(row.depletionMm >= 0 && row.depletionMm <= result.tawMm);
    }
  });

  it('the projection clamps to the same bounds as the ledger', () => {
    const result = compute({
      registry: { kcStages: curve(), rootDepthM: 0.3, depletionFraction: 1 },
      soilType: 'sandy',
      dailyWeather: series({ from: 0, to: 5, et0Mm: 15.0 }),
    });

    for (const row of projectionRows(result)) {
      assert.ok(row.depletionMm >= 0 && row.depletionMm <= result.tawMm);
    }
  });
});

// ── R11 · paddy ─────────────────────────────────────────────────────────────

describe('computeIrrigation · R11 paddyFlooding bypasses the depletion branch', () => {
  // R11 "paddyFlooding crops bypass R9-R10 depletion phrasing → water-level
  //      guidance strings."
  //
  // The engine comment states why this matters beyond phrasing: FAO-56 Table 22
  // footnote 4 defines rice's p as a fraction of *saturation*, not of TAW, so
  // `RAW = p × TAW` is arithmetically invalid for rice and must never run.

  const paddy = () =>
    compute({
      registry: {
        kcStages: curve(),
        rootDepthM: 1.0,
        depletionFraction: 0.2,
        paddyFlooding: true,
      },
      soilType: 'clay',
    });

  it('returns standing-water guidance with the 2–5 cm target depth', () => {
    const result = paddy();

    assert.equal(result.verdict, VERDICTS.MAINTAIN_WATER_LEVEL);
    assert.equal(result.hasVerdict, true);
    assert.equal(result.reasonCode, IRRIGATION_REASONS.PADDY_STANDING_WATER);
    assert.deepEqual(result.targetDepthCm, { min: 2, max: 5 });
    assert.deepEqual(result.targetDepthCm, PADDY_WATER_DEPTH_CM);
    assert.equal(result.amountMm, null);
    assert.equal(result.amountLitersPerAcre, null);
    assert.equal(result.days, null);
  });

  it('NEVER computes RAW = p × TAW for a paddy crop — the whole point of R11', () => {
    const result = paddy();

    assert.ok(!('rawMm' in result), 'rawMm leaked onto a paddy result');
    assert.ok(!('tawMm' in result), 'tawMm leaked onto a paddy result');
    assert.ok(!('depletionMm' in result), 'depletionMm leaked onto a paddy result');
    assert.equal(stepOf(result, IRRIGATION_TRACE_STEPS.RESERVOIR), undefined);
    assert.equal(stepOf(result, IRRIGATION_TRACE_STEPS.DEPLETION_FRACTION), undefined);
    assert.equal(stepOf(result, IRRIGATION_TRACE_STEPS.LEDGER), undefined);
    assert.equal(stepOf(result, IRRIGATION_TRACE_STEPS.PROJECTION), undefined);
    assert.equal(stepOf(result, IRRIGATION_TRACE_STEPS.SOIL), undefined);

    const serialised = JSON.stringify(result);
    assert.ok(!serialised.includes('rawMm'), 'RAW appears somewhere in the paddy trace');
  });

  it('takes the paddy branch whatever the soil or deficit would have implied', () => {
    for (const soilType of ['sandy', 'clay', 'unknown']) {
      const result = compute({
        crop: {
          sowingDate: SOWN_INTO_MID,
          status: 'active',
          waterBalance: { depletionMm: 500, initialized: true },
        },
        registry: {
          kcStages: curve(),
          rootDepthM: 1.0,
          depletionFraction: 0.2,
          paddyFlooding: true,
        },
        soilType,
        dailyWeather: series({ from: -7, to: 5, et0Mm: 15.0 }),
      });
      assert.equal(result.verdict, VERDICTS.MAINTAIN_WATER_LEVEL);
      assert.ok(!('rawMm' in result));
    }
  });

  it('a falsy or absent paddyFlooding flag does NOT take the branch', () => {
    for (const paddyFlooding of [false, undefined, null, 'true', 1]) {
      const result = compute({
        registry: { kcStages: curve(), rootDepthM: 1.0, depletionFraction: 0.55, paddyFlooding },
      });
      assert.notEqual(result.verdict, VERDICTS.MAINTAIN_WATER_LEVEL, String(paddyFlooding));
      assert.ok('rawMm' in result);
    }
  });
});

// ── R12 · trace ─────────────────────────────────────────────────────────────

describe('computeIrrigation · R12 the trace contains every number used', () => {
  // R12 "Trace must contain every number used (et0Series, kc, stage, etcMm/day,
  //      TAW, RAW, D series, rain projection) — explainability is contractual,
  //      UI renders trace verbatim."

  it('walks INPUT → STAGE → MODE → SOIL → p → RESERVOIR → LEDGER → PROJECTION → VERDICT', () => {
    const result = compute();

    assert.deepEqual(
      result.trace.map((entry) => entry.step),
      [
        IRRIGATION_TRACE_STEPS.INPUT,
        IRRIGATION_TRACE_STEPS.STAGE,
        IRRIGATION_TRACE_STEPS.MODE,
        IRRIGATION_TRACE_STEPS.SOIL,
        IRRIGATION_TRACE_STEPS.DEPLETION_FRACTION,
        IRRIGATION_TRACE_STEPS.RESERVOIR,
        IRRIGATION_TRACE_STEPS.LEDGER,
        IRRIGATION_TRACE_STEPS.PROJECTION,
        IRRIGATION_TRACE_STEPS.VERDICT,
      ],
    );
  });

  it('INPUT echoes what the engine was handed, including the water balance', () => {
    const result = compute({ logs: [{ date: at(-2), amountMm: 5 }] });

    assert.deepEqual(stepOf(result, IRRIGATION_TRACE_STEPS.INPUT), {
      step: IRRIGATION_TRACE_STEPS.INPUT,
      sowingDate: SOWN_INTO_MID.toISOString(),
      status: 'active',
      soilType: 'loamy',
      weatherDays: 13,
      logCount: 1,
      asOf: '2026-08-13T06:00:00.000Z',
      waterBalance: { depletionMm: 0, initialized: false },
    });
  });

  it('STAGE carries the stage, the Kc and the nested stage-engine trace', () => {
    const stage = stepOf(compute(), IRRIGATION_TRACE_STEPS.STAGE);

    assert.equal(stage.stage, 'MID');
    assert.equal(stage.kc, 1.2);
    assert.equal(stage.daysSinceSowing, 80);
    assert.equal(stage.dayInStage, 10);
    assert.equal(stage.harvestApproaching, false);
    assert.ok(Array.isArray(stage.stageTrace), 'the stage derivation is not re-derivable');
    assert.ok(stage.stageTrace.some((entry) => entry.step === 'STAGE_WINDOWS'));
  });

  it('RESERVOIR carries tawMm, rawMm and p', () => {
    const result = compute();

    assert.deepEqual(stepOf(result, IRRIGATION_TRACE_STEPS.RESERVOIR), {
      step: IRRIGATION_TRACE_STEPS.RESERVOIR,
      tawMm: 160,
      rawMm: 81.6,
      p: 0.51,
    });
    assert.equal(result.tawMm, 160);
    assert.equal(result.rawMm, 81.6);
  });

  it('DEPLETION_FRACTION shows the Table-22 footnote-2 correction in full', () => {
    assert.deepEqual(stepOf(compute(), IRRIGATION_TRACE_STEPS.DEPLETION_FRACTION), {
      step: IRRIGATION_TRACE_STEPS.DEPLETION_FRACTION,
      p: 0.51,
      adjusted: true,
      pTable: 0.55,
      correctionRejected: false,
      correctionRaw: 0.51,
      meanEtcMmDay: 6,
      referenceEtcMmDay: P_TABLE_REFERENCE_ETC_MM_DAY,
      coefficient: P_ETC_ADJUSTMENT_COEFF,
    });
  });

  it('LEDGER carries a per-day entry with etcMm, effectiveRainMm and depletionMm', () => {
    const result = compute({
      dailyWeather: series({ from: -7, to: 5, et0Mm: 5.0, rainMm: 2.5, rainProbPct: 40 }),
    });
    const ledger = stepOf(result, IRRIGATION_TRACE_STEPS.LEDGER);

    assert.equal(ledger.replayDays, 7);
    assert.equal(ledger.entries.length, 7);
    assert.equal(ledger.depletionMm, result.depletionMm);

    for (const entry of ledger.entries) {
      assert.deepEqual(Object.keys(entry), [
        'date',
        'etcMm',
        'rainMm',
        'effectiveRainMm',
        'irrigationMm',
        'assumed',
        'depletionBeforeMm',
        'depletionMm',
      ]);
      assert.equal(typeof entry.etcMm, 'number');
      assert.equal(typeof entry.effectiveRainMm, 'number');
      assert.equal(typeof entry.depletionMm, 'number');
      assert.match(entry.date, /^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('PROJECTION carries a per-day row with et0Mm, etcMm and depletionMm', () => {
    const result = compute({
      dailyWeather: series({ from: -7, to: 5, et0Mm: 5.0, rainMm: 3, rainProbPct: 30 }),
    });
    const rows = projectionRows(result);

    assert.equal(rows.length, 6);
    for (const row of rows) {
      assert.deepEqual(Object.keys(row), [
        'date',
        'daysAhead',
        'et0Mm',
        'etcMm',
        'rainMm',
        'rainProbPct',
        'rainCounted',
        'effectiveRainMm',
        'depletionMm',
      ]);
      assert.equal(row.et0Mm, 5);
      assert.equal(row.etcMm, 6); // 5.0 × Kc 1.2
      assert.equal(typeof row.depletionMm, 'number');
    }
    assert.deepEqual(
      rows.map((row) => row.daysAhead),
      [0, 1, 2, 3, 4, 5],
    );
  });

  it('is structured data, not prose, and every no-verdict path ends with its reason', () => {
    const cases = [
      { crop: { sowingDate: SOWN_INTO_MID, status: 'planned' } },
      { crop: { sowingDate: at(-500), status: 'active' } },
      { dailyWeather: [] },
      { dailyWeather: series({ from: -7, to: -1, et0Mm: 5.0 }) },
      { registry: { kcStages: [], rootDepthM: 1, depletionFraction: 0.5 } },
      { registry: { kcStages: curve(), depletionFraction: 0.5 } },
      { dailyWeather: withDay(series({ from: -7, to: 5, et0Mm: 5.0 }), 2, { et0Mm: null }) },
    ];

    for (const override of cases) {
      const result = compute(override);
      const last = result.trace.at(-1);

      assert.equal(result.hasVerdict, false);
      assert.equal(last.step, IRRIGATION_TRACE_STEPS.NO_VERDICT);
      assert.equal(last.reasonCode, result.reasonCode);
      for (const entry of result.trace) {
        assert.equal(typeof entry, 'object');
        assert.equal(typeof entry.step, 'string');
      }
    }
  });

  it('only ever returns a reason code drawn from the exported set', () => {
    const codes = new Set(Object.values(IRRIGATION_REASONS));
    const verdicts = new Set([...Object.values(VERDICTS), null]);
    const cases = [
      {},
      { crop: { sowingDate: SOWN_INTO_MID, status: 'planned' } },
      { crop: { sowingDate: at(-500), status: 'active' } },
      { dailyWeather: [] },
      { dailyWeather: undefined },
      { dailyWeather: series({ from: -7, to: -1, et0Mm: 5.0 }) },
      { registry: { kcStages: [], rootDepthM: 1, depletionFraction: 0.5 } },
      { registry: { kcStages: curve(), rootDepthM: 1 } },
      {
        registry: { kcStages: curve(), rootDepthM: 1, depletionFraction: 0.5, paddyFlooding: true },
      },
      { dailyWeather: withDay(series({ from: -7, to: 5, et0Mm: 5.0 }), 2, { et0Mm: null }) },
      { dailyWeather: series({ from: -7, to: 5, et0Mm: 8.0 }) },
    ];

    for (const override of cases) {
      const result = compute(override);
      assert.ok(codes.has(result.reasonCode), `unknown reason code ${result.reasonCode}`);
      assert.ok(verdicts.has(result.verdict), `unknown verdict ${result.verdict}`);
    }
  });
});

// ── R13 · named constants ───────────────────────────────────────────────────

describe('computeIrrigation · R13 all constants centralized + named', () => {
  // R13 "All constants centralized + named; no magic numbers in engine code."

  it('publishes the documented values', () => {
    assert.equal(EFFECTIVE_RAIN_COEFF, 0.8);
    assert.equal(RAIN_PROB_THRESHOLD, 60);
    assert.equal(HORIZON_DAYS, 5);
    assert.equal(COLD_START_REPLAY_DAYS, 7);
    assert.equal(AMOUNT_STEP_MM, 5);
    assert.equal(AMOUNT_MIN_MM, 10);
    assert.equal(AMOUNT_MAX_MM, 75);
    assert.equal(SIMPLIFIED_RAIN_MM, 10);
    assert.equal(SIMPLIFIED_RAIN_WINDOW_HOURS, 48);
    assert.equal(LITERS_PER_ACRE_PER_MM, 4046.86);
    assert.equal(P_TABLE_REFERENCE_ETC_MM_DAY, 5);
    assert.equal(P_ETC_ADJUSTMENT_COEFF, 0.04);
    assert.deepEqual(PADDY_WATER_DEPTH_CM, { min: 2, max: 5 });
    assert.deepEqual(STAGE_ROOT_DEPTH_FACTOR, {
      INITIAL: 0.4,
      DEVELOPMENT: 0.7,
      MID: 1.0,
      LATE: 1.0,
    });
  });

  it('the exported enums are frozen so no caller can mutate the contract', () => {
    assert.ok(Object.isFrozen(VERDICTS));
    assert.ok(Object.isFrozen(MODES));
    assert.ok(Object.isFrozen(IRRIGATION_REASONS));
    assert.ok(Object.isFrozen(IRRIGATION_TRACE_STEPS));
    assert.ok(Object.isFrozen(SOIL_AWC_MM_PER_M));
    assert.ok(Object.isFrozen(STAGE_ROOT_DEPTH_FACTOR));

    for (const [key, value] of Object.entries(IRRIGATION_REASONS)) {
      assert.equal(key, value);
      assert.match(value, /^[A-Z][A-Z_]*[A-Z]$/);
    }
  });

  it('the engine output is derived from the constants, not from inlined literals', () => {
    // Effective rain: the ledger's discount is EFFECTIVE_RAIN_COEFF exactly.
    const rain = compute({
      crop: {
        sowingDate: SOWN_INTO_MID,
        status: 'active',
        waterBalance: { depletionMm: 90, initialized: true },
      },
      dailyWeather: series({ from: -7, to: 5, et0Mm: 5.0, rainMm: 7 }),
    });
    for (const entry of ledgerEntries(rain)) {
      assert.equal(entry.effectiveRainMm, Number((7 * EFFECTIVE_RAIN_COEFF).toFixed(3)));
    }

    // Probability threshold: the counted/ignored split sits on the constant.
    const gated = (rainProbPct) =>
      projectionRows(
        compute({
          crop: {
            sowingDate: SOWN_INTO_MID,
            status: 'active',
            waterBalance: { depletionMm: 20, initialized: true },
          },
          registry: { kcStages: curve(1.0), rootDepthM: 1.0, depletionFraction: 0.5 },
          dailyWeather: series({ from: 0, to: 5, et0Mm: 5.0, rainMm: 4, rainProbPct }),
        }),
      )[0].rainCounted;
    assert.equal(gated(RAIN_PROB_THRESHOLD - 1), false);
    assert.equal(gated(RAIN_PROB_THRESHOLD), true);

    // Horizon: the "come back later" figure is HORIZON_DAYS, and the projection
    // covers today plus HORIZON_DAYS more (offsets 0…5).
    const quiet = compute();
    assert.equal(quiet.verdict, VERDICTS.NO_IRRIGATION_NEEDED);
    assert.equal(quiet.nextCheckDays, HORIZON_DAYS);
    assert.equal(projectionRows(quiet).at(-1).daysAhead, HORIZON_DAYS);

    // Amount bounds and the litres conversion.
    const capped = compute({
      crop: {
        sowingDate: SOWN_INTO_MID,
        status: 'active',
        waterBalance: { depletionMm: 400, initialized: true },
      },
      registry: { kcStages: curve(1.0), rootDepthM: 1.5, depletionFraction: 0.5 },
      soilType: 'clay',
      dailyWeather: series({ from: 0, to: 5, et0Mm: 5.0 }),
    });
    assert.equal(capped.amountMm, AMOUNT_MAX_MM);
    assert.equal(capped.amountLitersPerAcre, Math.round(AMOUNT_MAX_MM * LITERS_PER_ACRE_PER_MM));

    // Cold start replays COLD_START_REPLAY_DAYS days, no more.
    const long = compute({ dailyWeather: series({ from: -40, to: 5, et0Mm: 5.0 }) });
    assert.equal(ledgerEntries(long).length, COLD_START_REPLAY_DAYS);
  });
});

// ── R14 · missing weather ───────────────────────────────────────────────────

describe("computeIrrigation · R14 missing weather → 'UNAVAILABLE', never a throw", () => {
  // R14 "Missing weather entirely → verdict 'UNAVAILABLE' + pending (200-level
  //      designed state; never throws)."

  it('an empty dailyWeather array is NO_WEATHER', () => {
    const result = compute({ dailyWeather: [] });

    assert.equal(result.verdict, VERDICTS.UNAVAILABLE);
    assert.equal(result.reasonCode, IRRIGATION_REASONS.NO_WEATHER);
    assert.equal(result.hasVerdict, false);
    assert.equal(result.mode, null);
    assert.equal(result.amountMm, null);
  });

  it('an absent or non-array dailyWeather is NO_WEATHER too', () => {
    for (const dailyWeather of [undefined, null, 'nope', 42, {}]) {
      const result = compute({ dailyWeather });
      assert.equal(result.verdict, VERDICTS.UNAVAILABLE, `accepted ${String(dailyWeather)}`);
      assert.equal(result.reasonCode, IRRIGATION_REASONS.NO_WEATHER);
    }
  });

  it('a series with only past days is NO_FORECAST — there is nothing to project', () => {
    const result = compute({ dailyWeather: series({ from: -7, to: -1, et0Mm: 5.0 }) });

    assert.equal(result.verdict, VERDICTS.UNAVAILABLE);
    assert.equal(result.reasonCode, IRRIGATION_REASONS.NO_FORECAST);
    assert.equal(result.hasVerdict, false);
  });

  it('a series whose only forecast day is past the horizon is also NO_FORECAST', () => {
    const result = compute({
      dailyWeather: [
        ...series({ from: -7, to: -1, et0Mm: 5.0 }),
        ...series({ from: 9, to: 12, et0Mm: 5.0 }),
      ],
    });

    assert.equal(result.reasonCode, IRRIGATION_REASONS.NO_FORECAST);
  });

  it('undated or unparseable weather rows are dropped, not crashed on', () => {
    const dailyWeather = [
      { date: 'not a date', et0Mm: 5, rainMm: 0, rainProbPct: 0 },
      { et0Mm: 5, rainMm: 0, rainProbPct: 0 },
      ...series({ from: 0, to: 5, et0Mm: 5.0 }),
    ];

    assert.doesNotThrow(() => compute({ dailyWeather }));
    const result = compute({ dailyWeather });
    assert.equal(result.hasVerdict, true);
    assert.equal(projectionRows(result).length, 6);
  });

  it('nothing throws for any shape of nonsense, including no arguments at all', () => {
    assert.doesNotThrow(() => computeIrrigation());
    assert.doesNotThrow(() => computeIrrigation({}));
    assert.doesNotThrow(() => computeIrrigation({ crop: {}, registry: {}, asOf: AS_OF }));
    assert.equal(computeIrrigation().hasVerdict, false);
    assert.equal(computeIrrigation().reasonCode, IRRIGATION_REASONS.CROP_NOT_ACTIVE);
  });

  /**
   * BUG (found by this suite, NOT fixed here — reported instead).
   *
   * The destructuring defaults `crop = {}` and `registry = {}` only fire for
   * `undefined`. A `null` crop — which is exactly what a failed populate or a
   * deleted document hands back — reaches `crop.sowingDate` and throws a
   * TypeError, again against R14's "never throws".
   */
  it('degrades on a null crop or registry rather than throwing (R14)', () => {
    // `= {}` destructuring defaults only fire for `undefined`, so a null crop —
    // a failed populate, a deleted document — used to reach `crop.sowingDate`
    // and throw a TypeError.
    const noCrop = computeIrrigation({ crop: null, asOf: AS_OF });
    assert.equal(noCrop.hasVerdict, false);
    assert.equal(noCrop.reasonCode, IRRIGATION_REASONS.CROP_NOT_ACTIVE);

    const noRegistry = computeIrrigation({
      crop: { sowingDate: SOWN_INTO_MID, status: 'active' },
      registry: null,
      soilType: 'loamy',
      dailyWeather: series({ from: -7, to: 5, et0Mm: 5 }),
      asOf: AS_OF,
    });
    assert.equal(noRegistry.hasVerdict, false);
    assert.ok(noRegistry.trace.length > 0);
  });
});

// ── B · hand-computed vectors ───────────────────────────────────────────────

describe('computeIrrigation · vector 1 — steady demand, no crossing (NO_IRRIGATION_NEEDED)', () => {
  /*
   * loamy soil (AWC 160 mm/m) · rootDepthM 1.0 · stage MID (factor 1.0)
   *   effective root depth = 1.0 × 1.0                      = 1.0 m
   *   TAW = 160 × 1.0                                       = 160.0 mm
   * depletionFraction (Table 22) p_table = 0.55
   *   ET₀ 5.0 mm/day flat, Kc 1.2 → ETc = 5.0 × 1.2         = 6.0 mm/day
   *   Table-22 footnote 2: p = 0.55 + 0.04 × (5 − 6)        = 0.51
   *   RAW = 0.51 × 160                                      = 81.6 mm
   * ledger — 7 past days at 6.0 mm, zero rain, cold start D = 0
   *   6, 12, 18, 24, 30, 36, 42                             → D = 42.0 mm
   * projection — 6 horizon days (offsets 0…5) at 6.0 mm
   *   48, 54, 60, 66, 72, 78; 42 + 6 × 6 = 78 < 81.6        → NO crossing
   */
  const result = compute();

  it('resolves the stage and Kc the whole vector rests on', () => {
    assert.equal(result.stage, 'MID');
    assert.equal(result.kc, 1.2);
    assert.equal(result.mode, MODES.FULL);
    assert.equal(stepOf(result, IRRIGATION_TRACE_STEPS.STAGE).daysSinceSowing, 80);
  });

  it('TAW = AWC × Zr × stageFactor = 160 × 1.0 × 1.0 = 160.0', () => {
    const soil = stepOf(result, IRRIGATION_TRACE_STEPS.SOIL);

    assert.equal(soil.awcMmPerM, 160);
    assert.equal(soil.rootDepthM, 1.0);
    assert.equal(soil.stageFactor, 1.0);
    assert.equal(soil.effectiveRootDepthM, 1.0);
    assert.equal(soil.tawMm, 160.0);
    assert.equal(result.tawMm, 160.0);
  });

  it('ETc = ET₀ × Kc = 5.0 × 1.2 = 6.0 mm/day on every modelled day', () => {
    for (const entry of ledgerEntries(result)) assert.equal(entry.etcMm, 6.0);
    for (const row of projectionRows(result)) {
      assert.equal(row.et0Mm, 5.0);
      assert.equal(row.etcMm, 6.0);
    }
  });

  it('p = 0.55 + 0.04 × (5 − 6) = 0.51 (Table 22 footnote 2)', () => {
    const p = stepOf(result, IRRIGATION_TRACE_STEPS.DEPLETION_FRACTION);

    assert.equal(p.pTable, 0.55);
    assert.equal(p.meanEtcMmDay, 6.0);
    assert.equal(p.referenceEtcMmDay, 5);
    assert.equal(p.coefficient, 0.04);
    assert.equal(p.adjusted, true);
    assert.equal(p.correctionRejected, false);
    assert.equal(p.p, 0.51);
    assert.equal(p.p, Number((0.55 + 0.04 * (5 - 6)).toFixed(3)));
  });

  it('RAW = p × TAW = 0.51 × 160 = 81.6', () => {
    assert.equal(result.rawMm, 81.6);
    assert.equal(result.rawMm, Number((0.51 * 160).toFixed(2)));
  });

  it('the ledger folds 7 past days from D = 0 to D = 42.0', () => {
    const ledger = stepOf(result, IRRIGATION_TRACE_STEPS.LEDGER);

    assert.equal(ledger.coldStart, true);
    assert.equal(ledger.initialized, false);
    assert.equal(ledger.replayDays, 7);
    assert.equal(ledger.anchorOffset, -7);
    assert.deepEqual(
      ledger.entries.map((entry) => entry.depletionMm),
      [6, 12, 18, 24, 30, 36, 42],
    );
    assert.equal(result.depletionMm, 42.0);
  });

  it('the projection reaches 78.0 < 81.6 and stops short of RAW', () => {
    assert.deepEqual(
      projectionRows(result).map((row) => row.depletionMm),
      [48, 54, 60, 66, 72, 78],
    );
    assert.equal(projectionRows(result).at(-1).depletionMm, 42 + 6 * 6);
    assert.ok(projectionRows(result).at(-1).depletionMm < result.rawMm);
    assert.equal(stepOf(result, IRRIGATION_TRACE_STEPS.PROJECTION).outcome, 'no_crossing');
  });

  it('verdict NO_IRRIGATION_NEEDED, with the next check date and no amount', () => {
    assert.equal(result.verdict, VERDICTS.NO_IRRIGATION_NEEDED);
    assert.equal(result.hasVerdict, true);
    assert.equal(result.reasonCode, IRRIGATION_REASONS.OK);
    assert.equal(result.days, null);
    assert.equal(result.amountMm, null);
    assert.equal(result.amountLitersPerAcre, null);
    assert.equal(result.nextCheckDays, HORIZON_DAYS);
  });
});

describe('computeIrrigation · vector 2 — high demand, already past RAW (IRRIGATE_TODAY)', () => {
  /*
   * Same reservoir as vector 1, hotter weather.
   *   loamy 160 · Zr 1.0 · MID → TAW                        = 160.0 mm
   *   ET₀ 8.0, Kc 1.2 → ETc = 8.0 × 1.2                     = 9.6 mm/day
   *   p = 0.55 + 0.04 × (5 − 9.6) = 0.55 − 0.184            = 0.366
   *   RAW = 0.366 × 160                                     = 58.56 mm
   * ledger — 7 past days at 9.6 mm, no rain, cold start D = 0
   *   9.6, 19.2, 28.8, 38.4, 48.0, 57.6, 67.2               → D = 67.2 mm
   *   67.2 ≥ 58.56 → the deficit is ALREADY past RAW today
   * amount — ceil(67.2 / 5) × 5 = ceil(13.44) × 5 = 14 × 5  = 70 mm
   *   70 ≤ 75, so no split note; 70 × 4046.86 = 283 280.2   → 283 280 L/acre
   */
  const result = compute({ dailyWeather: series({ from: -7, to: 5, et0Mm: 8.0 }) });

  it('ETc = 8.0 × 1.2 = 9.6 and the ledger reaches D = 67.2', () => {
    assert.deepEqual(
      ledgerEntries(result).map((entry) => entry.etcMm),
      [9.6, 9.6, 9.6, 9.6, 9.6, 9.6, 9.6],
    );
    assert.deepEqual(
      ledgerEntries(result).map((entry) => entry.depletionMm),
      [9.6, 19.2, 28.8, 38.4, 48, 57.6, 67.2],
    );
    assert.equal(result.depletionMm, 67.2);
  });

  it('p = 0.55 + 0.04 × (5 − 9.6) = 0.366 and RAW = 0.366 × 160 = 58.56', () => {
    assert.equal(stepOf(result, IRRIGATION_TRACE_STEPS.DEPLETION_FRACTION).meanEtcMmDay, 9.6);
    assert.equal(stepOf(result, IRRIGATION_TRACE_STEPS.DEPLETION_FRACTION).p, 0.366);
    assert.equal(result.tawMm, 160);
    assert.equal(result.rawMm, 58.56);
  });

  it('67.2 ≥ 58.56 → IRRIGATE_TODAY with no projection needed', () => {
    assert.equal(result.verdict, VERDICTS.IRRIGATE_TODAY);
    assert.equal(result.days, 0);
    assert.ok(result.depletionMm >= result.rawMm);
    assert.equal(stepOf(result, IRRIGATION_TRACE_STEPS.PROJECTION), undefined);
  });

  it('amount = ceil(67.2/5) × 5 = 70 mm = 283 280 L/acre', () => {
    assert.equal(result.amountMm, 70);
    assert.equal(result.uncappedMm, 70);
    assert.equal(result.splitAdvised, false);
    assert.equal(result.amountLitersPerAcre, 283_280);
    assert.equal(result.amountLitersPerAcre, Math.round(70 * LITERS_PER_ACRE_PER_MM));
  });
});

describe('computeIrrigation · vector 3 — shallow sandy reservoir (IRRIGATE_IN_N_DAYS)', () => {
  /*
   * sandy soil (AWC 80 mm/m) · rootDepthM 0.6 · stage MID (factor 1.0)
   *   TAW = 80 × 0.6                                        = 48.0 mm
   *   ET₀ 4.0, Kc 1.2 → ETc = 4.0 × 1.2                     = 4.8 mm/day
   *   p = 0.55 + 0.04 × (5 − 4.8) = 0.55 + 0.008            = 0.558
   *   RAW = 0.558 × 48 = 26.784                             → 26.78 mm
   * ledger — only 3 past days are in the snapshot, cold start D = 0
   *   4.8, 9.6, 14.4                                        → D = 14.4 mm
   *   14.4 < 26.78 → not today
   * projection — no rain
   *   day 0: 14.4 + 4.8 = 19.2   (< 26.78)
   *   day 1: 19.2 + 4.8 = 24.0   (< 26.78)
   *   day 2: 24.0 + 4.8 = 28.8   (≥ 26.78) → crosses on day +2
   * amount — ceil(28.8/5) × 5 = ceil(5.76) × 5 = 6 × 5      = 30 mm
   *   30 × 4046.86 = 121 405.8                              → 121 406 L/acre
   */
  const result = compute({
    registry: { kcStages: curve(), rootDepthM: 0.6, depletionFraction: 0.55 },
    soilType: 'sandy',
    dailyWeather: series({ from: -3, to: 5, et0Mm: 4.0 }),
  });

  it('TAW = 80 × 0.6 = 48.0 and RAW = 0.558 × 48 = 26.78', () => {
    assert.equal(result.tawMm, 48.0);
    assert.equal(stepOf(result, IRRIGATION_TRACE_STEPS.DEPLETION_FRACTION).meanEtcMmDay, 4.8);
    assert.equal(stepOf(result, IRRIGATION_TRACE_STEPS.DEPLETION_FRACTION).p, 0.558);
    assert.equal(result.rawMm, 26.78);
  });

  it('the ledger replays the three days it actually has: D = 14.4', () => {
    assert.equal(stepOf(result, IRRIGATION_TRACE_STEPS.LEDGER).replayDays, 3);
    assert.deepEqual(
      ledgerEntries(result).map((entry) => entry.depletionMm),
      [4.8, 9.6, 14.4],
    );
    assert.equal(result.depletionMm, 14.4);
  });

  it('the projection crosses RAW on day +2: 19.2 → 24.0 → 28.8', () => {
    assert.deepEqual(
      projectionRows(result).map((row) => row.depletionMm),
      [19.2, 24, 28.8],
    );
    assert.equal(stepOf(result, IRRIGATION_TRACE_STEPS.PROJECTION).outcome, 'crosses_raw');
    assert.equal(result.verdict, VERDICTS.IRRIGATE_IN_N_DAYS);
    assert.equal(result.days, 2);
  });

  it('amount = ceil(28.8/5) × 5 = 30 mm = 121 406 L/acre', () => {
    assert.equal(result.amountMm, 30);
    assert.equal(result.splitAdvised, false);
    assert.equal(result.amountLitersPerAcre, 121_406);
    assert.equal(result.amountLitersPerAcre, Math.round(30 * LITERS_PER_ACRE_PER_MM));
  });
});

describe('computeIrrigation · vector 4 — qualifying rain covers the deficit (WAIT_RAIN_EXPECTED)', () => {
  /*
   * Vector 1's reservoir and weather, with 70 mm at 85 % forecast for day +2.
   *   TAW = 160.0 · ETc = 6.0/day · p = 0.51 · RAW = 81.6
   *   ledger (7 past days, no rain)                         → D = 42.0
   * projection:
   *   day 0: prob 0 → rain ignored; 42.0 + 6.0              = 48.0  (< 81.6)
   *   day 1: prob 0 → rain ignored; 48.0 + 6.0              = 54.0  (< 81.6)
   *   day 2: prob 85 ≥ 60 → counted; effective = 0.8 × 70   = 56.0
   *          56.0 ≥ the 54.0 standing deficit               → WAIT
   */
  const result = compute({
    dailyWeather: withDay(series({ from: -7, to: 5, et0Mm: 5.0 }), 2, {
      rainMm: 70,
      rainProbPct: 85,
    }),
  });

  it('reaches day +2 with a 54.0 mm deficit still short of RAW', () => {
    assert.equal(result.depletionMm, 42);
    assert.equal(result.rawMm, 81.6);
    assert.deepEqual(
      projectionRows(result).map((row) => row.depletionMm),
      [48, 54],
    );
    assert.equal(stepOf(result, IRRIGATION_TRACE_STEPS.PROJECTION).outcome, 'rain_covers_deficit');
  });

  it('0.8 × 70 = 56.0 ≥ 54.0 → WAIT_RAIN_EXPECTED on day +2, no amount', () => {
    assert.equal(result.verdict, VERDICTS.WAIT_RAIN_EXPECTED);
    assert.equal(result.days, 2);
    assert.equal(result.amountMm, null);
    assert.equal(result.amountLitersPerAcre, null);
    assert.equal(result.rain.mm, 70);
    assert.equal(result.rain.probPct, 85);

    const verdict = stepOf(result, IRRIGATION_TRACE_STEPS.VERDICT);
    assert.equal(verdict.rain.effectiveMm, 56);
    assert.equal(verdict.rain.effectiveMm, 70 * EFFECTIVE_RAIN_COEFF);
    assert.equal(verdict.deficitMm, 54);
  });

  it('the same rain below the probability threshold does NOT trigger the wait', () => {
    const unlikely = compute({
      dailyWeather: withDay(series({ from: -7, to: 5, et0Mm: 5.0 }), 2, {
        rainMm: 70,
        rainProbPct: RAIN_PROB_THRESHOLD - 1,
      }),
    });

    assert.equal(unlikely.verdict, VERDICTS.NO_IRRIGATION_NEEDED);
    assert.equal(projectionRows(unlikely).length, 6);
  });
});

describe('computeIrrigation · vector 5 — the two FAO-56 anchors recorded in crops.agronomy.json', () => {
  /*
   * These are the ONLY FAO worked-example figures this repository records, both
   * as context notes on the Table-22 citations in crops.agronomy.json:
   *
   *   ONION  "FAO-56 Example 35 … uses 'Onion Zr ~ 0.4 m, p = 0.30'"
   *   TOMATO "FAO-56 Example 36 … uses 'Tomato Zr ~ 0.8 m, p = 0.40'"
   *
   * FAO-56 does not state a soil for either in anything this repo holds, so the
   * soil is stated here and the arithmetic worked from it. Full-grown crop =
   * MID stage, so the stage root-depth factor is 1.0 and Zr is used as
   * published — which is the condition the examples describe.
   */

  // ONION · stated soil: loamy (AWC 160 mm/m) · Zr 0.4 m · MID (factor 1.0)
  //   TAW = 160 × 0.4                                       = 64.0 mm
  //   Kc_mid 1.05, ET₀ 5.0 → ETc = 5.0 × 1.05               = 5.25 mm/day
  //   p = 0.30 + 0.04 × (5 − 5.25) = 0.30 − 0.01            = 0.29
  //   RAW = 0.29 × 64 = 18.56                               = 18.56 mm
  it('Onion Zr 0.4 / p 0.30 on loamy → TAW 64.0, RAW 18.56', () => {
    const onion = [
      { stage: 'INITIAL', days: 20, kc: 0.7 },
      { stage: 'DEVELOPMENT', days: 35, kc: null },
      { stage: 'MID', days: 110, kc: 1.05 },
      { stage: 'LATE', days: 45, kc: 0.75 },
    ];
    const result = compute({
      crop: { sowingDate: at(-60), status: 'active' }, // day 60 → MID (55–164)
      registry: { kcStages: onion, rootDepthM: 0.4, depletionFraction: 0.3 },
      soilType: 'loamy',
    });

    assert.equal(result.stage, 'MID');
    assert.equal(result.kc, 1.05);
    assert.equal(stepOf(result, IRRIGATION_TRACE_STEPS.SOIL).stageFactor, 1.0);
    assert.equal(stepOf(result, IRRIGATION_TRACE_STEPS.SOIL).effectiveRootDepthM, 0.4);
    assert.equal(result.tawMm, 64.0);
    assert.equal(result.tawMm, SOIL_AWC_MM_PER_M.loamy.value * 0.4);

    const p = stepOf(result, IRRIGATION_TRACE_STEPS.DEPLETION_FRACTION);
    assert.equal(p.pTable, 0.3);
    assert.equal(p.meanEtcMmDay, 5.25);
    assert.equal(p.p, 0.29);
    assert.equal(result.rawMm, 18.56);
    assert.equal(result.rawMm, Number((0.29 * 64).toFixed(2)));
  });

  // TOMATO · stated soil: clay (AWC 195 mm/m) · Zr 0.8 m · MID (factor 1.0)
  //   TAW = 195 × 0.8                                       = 156.0 mm
  //   Kc_mid 1.15, ET₀ 5.0 → ETc = 5.0 × 1.15               = 5.75 mm/day
  //   p = 0.40 + 0.04 × (5 − 5.75) = 0.40 − 0.03            = 0.37
  //   RAW = 0.37 × 156                                      = 57.72 mm
  it('Tomato Zr 0.8 / p 0.40 on clay → TAW 156.0, RAW 57.72', () => {
    const tomato = [
      { stage: 'INITIAL', days: 30, kc: 0.6 },
      { stage: 'DEVELOPMENT', days: 40, kc: null },
      { stage: 'MID', days: 40, kc: 1.15 },
      { stage: 'LATE', days: 25, kc: 0.7 },
    ];
    const result = compute({
      registry: { kcStages: tomato, rootDepthM: 0.8, depletionFraction: 0.4 },
      soilType: 'clay',
    });

    assert.equal(result.stage, 'MID');
    assert.equal(result.kc, 1.15);
    assert.equal(stepOf(result, IRRIGATION_TRACE_STEPS.SOIL).effectiveRootDepthM, 0.8);
    assert.equal(result.tawMm, 156.0);
    assert.equal(result.tawMm, SOIL_AWC_MM_PER_M.clay.value * 0.8);

    const p = stepOf(result, IRRIGATION_TRACE_STEPS.DEPLETION_FRACTION);
    assert.equal(p.pTable, 0.4);
    assert.equal(p.meanEtcMmDay, 5.75);
    assert.equal(p.p, 0.37);
    assert.equal(result.rawMm, 57.72);
    assert.equal(result.rawMm, Number((0.37 * 156).toFixed(2)));

    // ledger: 7 days at 5.75 → 40.25; projection 46, 51.75, 57.5, 63.25 ≥ 57.72
    assert.equal(result.depletionMm, 40.25);
    assert.equal(result.verdict, VERDICTS.IRRIGATE_IN_N_DAYS);
    assert.equal(result.days, 3);
    assert.equal(result.amountMm, 65); // ceil(63.25/5) × 5 = 13 × 5
  });
});

// ── C · property tests (irrigation-model.md line 26) ────────────────────────

describe('computeIrrigation · property: rain > ETc ⇒ D non-increasing', () => {
  // irrigation-model.md §"Test vectors": "rain > ETc ⇒ D non-increasing".

  it('a series whose effective rain exceeds ETc every day never raises D', () => {
    // ETc = 5.0 × 1.0 = 5.0/day; rain 20 mm → effective 16.0 > 5.0.
    const result = compute({
      crop: {
        sowingDate: SOWN_INTO_MID,
        status: 'active',
        waterBalance: { depletionMm: 100, initialized: true },
      },
      registry: { kcStages: curve(1.0), rootDepthM: 1.0, depletionFraction: 0.5 },
      dailyWeather: series({ from: -7, to: 5, et0Mm: 5.0, rainMm: 20, rainProbPct: 10 }),
    });

    const entries = ledgerEntries(result);
    assert.equal(entries.length, 7);

    let previous = Infinity;
    for (const entry of entries) {
      assert.ok(
        entry.effectiveRainMm > entry.etcMm,
        `precondition broken: rain ${entry.effectiveRainMm} !> ETc ${entry.etcMm}`,
      );
      assert.ok(entry.depletionMm <= previous, `D rose to ${entry.depletionMm} from ${previous}`);
      previous = entry.depletionMm;
    }
    assert.deepEqual(
      entries.map((entry) => entry.depletionMm),
      [89, 78, 67, 56, 45, 34, 23],
    );
  });

  it('holds across a sweep of rain rates, for every rate above ETc', () => {
    for (const rainMm of [7, 10, 25, 60, 200]) {
      const result = compute({
        crop: {
          sowingDate: SOWN_INTO_MID,
          status: 'active',
          waterBalance: { depletionMm: 120, initialized: true },
        },
        registry: { kcStages: curve(1.0), rootDepthM: 1.0, depletionFraction: 0.5 },
        dailyWeather: series({ from: -7, to: 5, et0Mm: 5.0, rainMm }),
      });

      let previous = Infinity;
      for (const entry of ledgerEntries(result)) {
        assert.ok(entry.effectiveRainMm > entry.etcMm, `rain ${rainMm} is not above ETc`);
        assert.ok(entry.depletionMm <= previous, `rain ${rainMm}: D rose`);
        previous = entry.depletionMm;
      }
    }
  });

  it('and the converse holds: rain below ETc leaves D non-decreasing', () => {
    // effective rain 0.8 × 2 = 1.6 < ETc 5.0.
    const result = compute({
      registry: { kcStages: curve(1.0), rootDepthM: 1.0, depletionFraction: 0.5 },
      dailyWeather: series({ from: -7, to: 5, et0Mm: 5.0, rainMm: 2 }),
    });

    let previous = -Infinity;
    for (const entry of ledgerEntries(result)) {
      assert.ok(entry.depletionMm >= previous);
      previous = entry.depletionMm;
    }
  });
});

describe('computeIrrigation · property: an irrigation log resets D ≈ 0', () => {
  // irrigation-model.md §"Test vectors": "irrigation log resets D≈0".

  it('a same-day amount-less log leaves the run at D = 0', () => {
    const parched = compute({ dailyWeather: series({ from: -7, to: 5, et0Mm: 12.0 }) });
    const logged = compute({
      dailyWeather: series({ from: -7, to: 5, et0Mm: 12.0 }),
      logs: [{ date: at(-1) }],
    });

    assert.ok(parched.depletionMm > 0, 'precondition: the unlogged run is depleted');
    assert.equal(logged.depletionMm, 0);
    assert.equal(ledgerEntries(logged).at(-1).assumed, true);
    assert.equal(ledgerEntries(logged).at(-1).depletionMm, 0);
  });

  it('holds for a log on any day of the replay window', () => {
    for (const offset of [-7, -5, -3, -1]) {
      const result = compute({
        dailyWeather: series({ from: -7, to: 5, et0Mm: 12.0 }),
        logs: [{ date: at(offset) }],
      });
      const entries = ledgerEntries(result);

      assert.equal(entries[0].depletionMm, 0, `log on day ${offset} did not reset D`);
      assert.equal(entries[0].assumed, true);
      assert.equal(entries.length, Math.abs(offset), 'the replay did not re-anchor on the log');
    }
  });

  it('a refill turns an IRRIGATE_TODAY into a quiet day', () => {
    const before = compute({ dailyWeather: series({ from: -7, to: 5, et0Mm: 8.0 }) });
    const after = compute({
      dailyWeather: series({ from: -7, to: 5, et0Mm: 8.0 }),
      logs: [{ date: at(-1) }],
    });

    assert.equal(before.verdict, VERDICTS.IRRIGATE_TODAY);
    assert.notEqual(after.verdict, VERDICTS.IRRIGATE_TODAY);
    assert.equal(after.depletionMm, 0);
  });
});

describe('computeIrrigation · property: sandy crosses RAW before clay under identical weather', () => {
  // irrigation-model.md §"Test vectors": "sandy soil crosses RAW before clay
  // under identical weather".
  //
  // Everything but soilType is identical: Zr 1.0 · MID · Kc 1.0 · ET₀ 5.0 →
  // ETc 5.0 · p 0.5 (meanETc = 5, so the Table-22 correction is a no-op).
  //   sandy: TAW = 80  → RAW = 40.0    clay: TAW = 195 → RAW = 97.5
  //   both start from the same 7-day cold-start ledger: D = 35.0

  const under = (soilType) =>
    compute({
      registry: { kcStages: curve(1.0), rootDepthM: 1.0, depletionFraction: 0.5 },
      soilType,
      dailyWeather: series({ from: -7, to: 5, et0Mm: 5.0 }),
    });

  /** Days until the deficit reaches RAW; Infinity when it never does. */
  const crossingDay = (result) => {
    if (result.verdict === VERDICTS.IRRIGATE_TODAY) return 0;
    if (result.verdict === VERDICTS.IRRIGATE_IN_N_DAYS) return result.days;
    return Infinity;
  };

  it('the two runs differ only in the reservoir the identical weather empties', () => {
    const sandy = under('sandy');
    const clay = under('clay');

    assert.equal(sandy.depletionMm, clay.depletionMm, 'the ledgers must be identical');
    assert.equal(sandy.depletionMm, 35);
    assert.equal(sandy.tawMm, 80);
    assert.equal(clay.tawMm, 195);
    assert.equal(sandy.rawMm, 40);
    assert.equal(clay.rawMm, 97.5);
    assert.ok(sandy.rawMm < clay.rawMm);
  });

  it('sandy crosses first: it irrigates while clay still has headroom', () => {
    const sandy = under('sandy');
    const clay = under('clay');

    assert.ok(
      crossingDay(sandy) <= crossingDay(clay),
      `sandy crossed at ${crossingDay(sandy)}, clay at ${crossingDay(clay)}`,
    );
    assert.equal(sandy.verdict, VERDICTS.IRRIGATE_IN_N_DAYS);
    assert.equal(sandy.days, 0);
    assert.equal(clay.verdict, VERDICTS.NO_IRRIGATION_NEEDED);
  });

  it('the ordering holds right across the AWC table, driest soil first', () => {
    const ordered = Object.entries(SOIL_AWC_MM_PER_M)
      .map(([soilType, entry]) => ({ soilType, awc: entry.value, result: under(soilType) }))
      .sort((a, b) => a.awc - b.awc);

    let previous = -Infinity;
    for (const { soilType, result } of ordered) {
      const day = crossingDay(result);
      assert.ok(
        day >= previous,
        `${soilType} crossed at ${day}, before a drier soil's ${previous}`,
      );
      previous = day;
    }
  });
});

describe('computeIrrigation · property: verdict monotonicity vs rain probability', () => {
  // irrigation-model.md §"Test vectors": "verdict monotonicity vs rain
  // probability". Raising the chance of rain must never make the advice MORE
  // urgent.

  /** Urgency ranking, most urgent first. */
  const urgency = {
    [VERDICTS.IRRIGATE_TODAY]: 3,
    [VERDICTS.IRRIGATE_IN_N_DAYS]: 2,
    [VERDICTS.NO_IRRIGATION_NEEDED]: 1,
    [VERDICTS.WAIT_RAIN_EXPECTED]: 0,
  };

  const sweep = (build) => {
    const observations = [];
    for (let rainProbPct = 0; rainProbPct <= 100; rainProbPct += 5) {
      const result = build(rainProbPct);
      assert.ok(result.verdict in urgency, `unranked verdict ${result.verdict}`);
      observations.push({ rainProbPct, verdict: result.verdict, rank: urgency[result.verdict] });
    }
    return observations;
  };

  it('urgency never rises as the probability of rain rises (sandy fixture)', () => {
    const observations = sweep((rainProbPct) =>
      compute({
        registry: { kcStages: curve(), rootDepthM: 0.6, depletionFraction: 0.55 },
        soilType: 'sandy',
        dailyWeather: series({ from: -3, to: 5, et0Mm: 4.0, rainMm: 5, rainProbPct }),
      }),
    );

    let previous = Infinity;
    for (const observation of observations) {
      assert.ok(
        observation.rank <= previous,
        `at ${observation.rainProbPct}% the advice became ${observation.verdict}`,
      );
      previous = observation.rank;
    }
    // And the step really is at the threshold, not somewhere arbitrary.
    assert.equal(
      observations.find((o) => o.rainProbPct === RAIN_PROB_THRESHOLD - 5).verdict,
      VERDICTS.IRRIGATE_IN_N_DAYS,
    );
    assert.equal(
      observations.find((o) => o.rainProbPct === RAIN_PROB_THRESHOLD).verdict,
      VERDICTS.WAIT_RAIN_EXPECTED,
    );
  });

  it('holds on a loamy fixture that starts already depleted', () => {
    const observations = sweep((rainProbPct) =>
      compute({
        crop: {
          sowingDate: SOWN_INTO_MID,
          status: 'active',
          waterBalance: { depletionMm: 60, initialized: true },
        },
        registry: { kcStages: curve(1.0), rootDepthM: 1.0, depletionFraction: 0.5 },
        dailyWeather: series({ from: 0, to: 5, et0Mm: 5.0, rainMm: 15, rainProbPct }),
      }),
    );

    let previous = Infinity;
    for (const observation of observations) {
      assert.ok(observation.rank <= previous, `rank rose at ${observation.rainProbPct}%`);
      previous = observation.rank;
    }
  });

  it('a run already past RAW is unmoved by probability — it is today either way', () => {
    // Vector 2's ledger (D = 67.2 ≥ RAW 58.56) with rain only in the forecast:
    // the deficit is already banked, so no forecast probability can move it.
    for (let rainProbPct = 0; rainProbPct <= 100; rainProbPct += 25) {
      const result = compute({
        dailyWeather: [
          ...series({ from: -7, to: -1, et0Mm: 8.0 }),
          ...series({ from: 0, to: 5, et0Mm: 8.0, rainMm: 5, rainProbPct }),
        ],
      });
      assert.equal(result.verdict, VERDICTS.IRRIGATE_TODAY, `at ${rainProbPct}%`);
      assert.equal(result.amountMm, 70);
    }
  });
});

describe('computeIrrigation · property: purity', () => {
  // CLAUDE.md rule 5: "Engines are pure … deterministic; fixture-tested".

  const buildInput = () => ({
    crop: {
      sowingDate: SOWN_INTO_MID,
      status: 'active',
      waterBalance: { depletionMm: 12, initialized: true, lastComputedAt: at(-1) },
    },
    registry: {
      kcStages: curve(),
      rootDepthM: 1.0,
      depletionFraction: 0.55,
      simplifiedIntervals: [],
    },
    soilType: 'loamy',
    dailyWeather: series({ from: -7, to: 5, et0Mm: 5.0, rainMm: 4, rainProbPct: 55 }),
    logs: [{ date: at(-3), amountMm: 8 }, { date: at(-6) }],
    asOf: AS_OF,
  });

  it('runs against a deeply frozen input graph without throwing', () => {
    const input = deepFreeze(buildInput());

    assert.ok(Object.isFrozen(input.dailyWeather[0]));
    assert.ok(Object.isFrozen(input.registry.kcStages));
    assert.doesNotThrow(() => computeIrrigation(input));
    assert.equal(computeIrrigation(input).hasVerdict, true);
  });

  it('leaves every input byte-identical afterwards', () => {
    const input = buildInput();
    const snapshot = JSON.stringify(input);

    computeIrrigation(input);

    assert.equal(JSON.stringify(input), snapshot);
    assert.equal(input.crop.waterBalance.depletionMm, 12);
    assert.equal(input.dailyWeather.length, 13);
    assert.equal(input.logs.length, 2);
  });

  it('does not reorder the caller’s weather or log arrays in place', () => {
    const input = buildInput();
    input.dailyWeather = [...input.dailyWeather].reverse();
    const weatherOrder = input.dailyWeather.map((day) => day.date.getTime());
    const logOrder = input.logs.map((log) => log.date.getTime());

    computeIrrigation(input);

    assert.deepEqual(
      input.dailyWeather.map((day) => day.date.getTime()),
      weatherOrder,
    );
    assert.deepEqual(
      input.logs.map((log) => log.date.getTime()),
      logOrder,
    );
  });

  it('two frozen calls agree exactly', () => {
    const input = deepFreeze(buildInput());
    assert.deepEqual(computeIrrigation(input), computeIrrigation(input));
  });
});

// ── D · boundaries and numerical stability ──────────────────────────────────

describe('computeIrrigation · rainfall boundaries', () => {
  it('zero rainfall throughout is a pure ETc accumulation', () => {
    const result = compute();

    for (const entry of ledgerEntries(result)) {
      assert.equal(entry.rainMm, 0);
      assert.equal(entry.effectiveRainMm, 0);
      assert.equal(entry.depletionMm, entry.depletionBeforeMm + entry.etcMm);
    }
    for (const row of projectionRows(result)) {
      assert.equal(row.effectiveRainMm, 0);
      assert.equal(row.rainCounted, false);
    }
  });

  it('rainfall far exceeding demand parks the reservoir at full, not below empty', () => {
    const result = compute({
      crop: {
        sowingDate: SOWN_INTO_MID,
        status: 'active',
        waterBalance: { depletionMm: 150, initialized: true },
      },
      dailyWeather: series({ from: -7, to: 5, et0Mm: 5.0, rainMm: 250, rainProbPct: 95 }),
    });

    assert.equal(result.depletionMm, 0);
    assert.equal(result.verdict, VERDICTS.NO_IRRIGATION_NEEDED);
    for (const row of projectionRows(result)) assert.equal(row.depletionMm, 0);
  });

  it('rain exactly equal to the deficit still counts as covering it', () => {
    // D = 20 standing; 25 mm × 0.8 = 20.0 effective — the branch is `>=`.
    const result = compute({
      crop: {
        sowingDate: SOWN_INTO_MID,
        status: 'active',
        waterBalance: { depletionMm: 20, initialized: true },
      },
      registry: { kcStages: curve(1.0), rootDepthM: 1.0, depletionFraction: 0.5 },
      dailyWeather: series({ from: 0, to: 5, et0Mm: 5.0, rainMm: 25, rainProbPct: 60 }),
    });

    assert.equal(result.verdict, VERDICTS.WAIT_RAIN_EXPECTED);
    assert.equal(result.days, 0);
    assert.equal(stepOf(result, IRRIGATION_TRACE_STEPS.VERDICT).rain.effectiveMm, 20);
  });
});

describe('computeIrrigation · an incomplete registry degrades, never throws', () => {
  it('no kcStages at all → KC_UNAVAILABLE', () => {
    for (const kcStages of [[], undefined, null]) {
      const result = compute({ registry: { kcStages, rootDepthM: 1.0, depletionFraction: 0.5 } });

      assert.equal(result.hasVerdict, false);
      assert.equal(result.reasonCode, IRRIGATION_REASONS.KC_UNAVAILABLE);
      assert.equal(result.amountMm, null);
    }
  });

  it('a structurally broken kcStages is KC_UNAVAILABLE, not a crash', () => {
    for (const kcStages of ['nope', 42, [{ stage: 'FLOWERING', days: 10 }], [null]]) {
      assert.doesNotThrow(() =>
        compute({ registry: { kcStages, rootDepthM: 1.0, depletionFraction: 0.5 } }),
      );
      const result = compute({ registry: { kcStages, rootDepthM: 1.0, depletionFraction: 0.5 } });
      assert.equal(result.reasonCode, IRRIGATION_REASONS.KC_UNAVAILABLE);
    }
  });

  it('a stage whose Kc was never sourced cannot give ETc → KC_UNAVAILABLE', () => {
    const unsourced = [
      { stage: 'INITIAL', days: 30, kc: null },
      { stage: 'MID', days: 40, kc: null },
    ];
    const result = compute({
      crop: { sowingDate: at(-10), status: 'active' },
      registry: { kcStages: unsourced, rootDepthM: 1.0, depletionFraction: 0.5 },
    });

    assert.equal(result.verdict, VERDICTS.UNAVAILABLE);
    assert.equal(result.reasonCode, IRRIGATION_REASONS.KC_UNAVAILABLE);
  });

  it('a missing rootDepthM → SOIL_RESERVOIR_UNKNOWN', () => {
    for (const rootDepthM of [undefined, null, 'deep', Number.NaN, Infinity]) {
      const result = compute({
        registry: { kcStages: curve(), rootDepthM, depletionFraction: 0.5 },
      });

      assert.equal(result.verdict, VERDICTS.UNAVAILABLE, `accepted ${String(rootDepthM)}`);
      assert.equal(result.reasonCode, IRRIGATION_REASONS.SOIL_RESERVOIR_UNKNOWN);
      assert.equal(result.hasVerdict, false);
      // The soil that WAS resolvable is still traced, so the UI can say what is
      // known and what is not.
      assert.equal(stepOf(result, IRRIGATION_TRACE_STEPS.SOIL).awcMmPerM, 160);
      assert.equal(stepOf(result, IRRIGATION_TRACE_STEPS.RESERVOIR), undefined);
    }
  });

  it('a missing depletionFraction → SOIL_RESERVOIR_UNKNOWN', () => {
    for (const depletionFraction of [undefined, null, '0.5', Number.NaN]) {
      const result = compute({
        registry: { kcStages: curve(), rootDepthM: 1.0, depletionFraction },
      });

      assert.equal(result.verdict, VERDICTS.UNAVAILABLE, `accepted ${String(depletionFraction)}`);
      assert.equal(result.reasonCode, IRRIGATION_REASONS.SOIL_RESERVOIR_UNKNOWN);
      // The trace shows what the registry actually held — nullish becomes null,
      // an unusable value is echoed verbatim rather than laundered into one.
      assert.equal(
        stepOf(result, IRRIGATION_TRACE_STEPS.SOIL).depletionFraction,
        depletionFraction ?? null,
      );
      assert.equal(stepOf(result, IRRIGATION_TRACE_STEPS.RESERVOIR), undefined);
    }
  });

  it('an entirely empty registry object is still a designed state', () => {
    assert.doesNotThrow(() => compute({ registry: {} }));
    assert.equal(compute({ registry: {} }).reasonCode, IRRIGATION_REASONS.KC_UNAVAILABLE);
  });
});

describe('computeIrrigation · numerical stability', () => {
  /** The validator's stated ET₀ maximum, paired with an absurd rainfall. */
  const EXTREME = { et0Mm: 15, rainMm: 500, rainProbPct: 100 };

  it('produces no NaN or Infinity anywhere in the result or the trace', () => {
    const result = compute({
      soilType: 'unknown',
      dailyWeather: series({ from: -7, to: 5, ...EXTREME }),
    });

    assert.deepEqual(nonFiniteNumbers(result), []);
    assert.equal(result.hasVerdict, true);
    assert.equal(result.tawMm, 120);
    assert.equal(result.soilUncertaintyWide, true);
  });

  it('stays finite across a matrix of extreme inputs', () => {
    const matrix = [
      { soilType: 'sandy', et0Mm: 15, rainMm: 0, rootDepthM: 0.1, depletionFraction: 0.01 },
      { soilType: 'clay', et0Mm: 15, rainMm: 500, rootDepthM: 3, depletionFraction: 0.99 },
      { soilType: 'unknown', et0Mm: 0, rainMm: 500, rootDepthM: 1, depletionFraction: 0.5 },
      { soilType: 'black', et0Mm: 0, rainMm: 0, rootDepthM: 0.05, depletionFraction: 0.5 },
      { soilType: 'red', et0Mm: 15, rainMm: 0.0001, rootDepthM: 1, depletionFraction: 0.5 },
    ];

    for (const { soilType, et0Mm, rainMm, rootDepthM, depletionFraction } of matrix) {
      const result = compute({
        registry: { kcStages: curve(), rootDepthM, depletionFraction },
        soilType,
        dailyWeather: series({ from: -7, to: 5, et0Mm, rainMm, rainProbPct: 100 }),
      });

      assert.deepEqual(
        nonFiniteNumbers(result),
        [],
        `non-finite numbers for ${soilType} / ET₀ ${et0Mm} / rain ${rainMm}`,
      );
      if (result.amountMm != null) {
        assert.ok(result.amountMm >= AMOUNT_MIN_MM && result.amountMm <= AMOUNT_MAX_MM);
      }
    }
  });

  it('a zero ET₀ series leaves the depletion exactly where it started', () => {
    const result = compute({
      crop: {
        sowingDate: SOWN_INTO_MID,
        status: 'active',
        waterBalance: { depletionMm: 30, initialized: true },
      },
      dailyWeather: series({ from: -7, to: 5, et0Mm: 0 }),
    });

    assert.equal(result.depletionMm, 30);
    assert.deepEqual(nonFiniteNumbers(result), []);
    for (const row of projectionRows(result)) assert.equal(row.depletionMm, 30);
  });

  /**
   * Under extreme evaporative demand the linear Table-22 correction runs off
   * the end of its own validity. Clamping the result to zero — as this once did
   * — makes RAW zero, so `D >= RAW` is true at any depletion and the crop is
   * told to irrigate today, forever, including at D = 0. An out-of-range
   * correction is therefore discarded and the published table value stands.
   */
  it('discards an out-of-range depletion-fraction correction instead of clamping it to zero', () => {
    // ETc = 15 × 1.2 = 18 → p = 0.5 + 0.04 × (5 − 18) = −0.02, which is not a
    // usable fraction, so the published 0.50 is kept.
    const result = compute({
      registry: { kcStages: curve(), rootDepthM: 0.3, depletionFraction: 0.5 },
      soilType: 'sandy',
      dailyWeather: series({ from: -7, to: 5, et0Mm: 15.0 }),
    });
    const p = stepOf(result, IRRIGATION_TRACE_STEPS.DEPLETION_FRACTION);

    assert.equal(p.correctionRaw, -0.02);
    assert.equal(p.correctionRejected, true);
    assert.equal(p.adjusted, false);
    assert.equal(p.p, 0.5, 'the published table value stands');

    // TAW = sandy 80 × (0.3 × MID 1.0) = 24 → RAW = 0.5 × 24 = 12, not zero.
    assert.equal(result.rawMm, 12);
    assert.ok(result.rawMm > 0, 'a zero RAW would mean "irrigate today" at any depletion');
    assert.deepEqual(nonFiniteNumbers(result), []);
  });
});

describe('computeIrrigation · simplified mode (irrigation-model.md §7)', () => {
  /** Full-mode weather with one forecast ET₀ knocked out (R2 → simplified). */
  const simplifiedWeather = (patch = {}, offset = 4) =>
    withDay(
      withDay(series({ from: -7, to: 5, et0Mm: 5.0 }), offset, { et0Mm: null }),
      patch.offset ?? 1,
      patch.day ?? {},
    );

  it('a crop with no simplifiedIntervals says so instead of inventing one', () => {
    for (const simplifiedIntervals of [undefined, [], [{ stage: 'INITIAL', intervalDays: 6 }]]) {
      const result = compute({
        registry: {
          kcStages: curve(),
          rootDepthM: 1.0,
          depletionFraction: 0.55,
          simplifiedIntervals,
        },
        dailyWeather: simplifiedWeather(),
      });

      assert.equal(result.verdict, VERDICTS.UNAVAILABLE);
      assert.equal(result.reasonCode, IRRIGATION_REASONS.SIMPLIFIED_INTERVALS_NOT_SOURCED);
      assert.equal(result.mode, MODES.SIMPLIFIED);
      assert.equal(result.hasVerdict, false);
      assert.equal(result.stage, 'MID', 'the stage is still worth reporting');
      assert.equal(result.amountMm, null);
    }
  });

  it('a sourced interval for the current stage is used, labelled simplified', () => {
    const result = compute({
      registry: {
        kcStages: curve(),
        rootDepthM: 1.0,
        depletionFraction: 0.55,
        simplifiedIntervals: [{ stage: 'MID', intervalDays: 4 }],
      },
      dailyWeather: simplifiedWeather(),
    });

    assert.equal(result.verdict, VERDICTS.IRRIGATE_IN_N_DAYS);
    assert.equal(result.mode, MODES.SIMPLIFIED);
    assert.equal(result.days, 4);
    assert.equal(result.amountMm, null, 'simplified mode never quotes a depth');
    assert.equal(
      stepOf(result, IRRIGATION_TRACE_STEPS.VERDICT).basis,
      'registry simplifiedIntervals',
    );
  });

  // §7: "rain ≥10mm within 48h prob≥60% → wait".
  it('10 mm at 60 % inside 48 h wins over the interval table', () => {
    const result = compute({
      registry: { kcStages: curve(), rootDepthM: 1.0, depletionFraction: 0.55 },
      dailyWeather: simplifiedWeather({
        offset: 1,
        day: { rainMm: SIMPLIFIED_RAIN_MM, rainProbPct: RAIN_PROB_THRESHOLD },
      }),
    });

    assert.equal(result.verdict, VERDICTS.WAIT_RAIN_EXPECTED);
    assert.equal(result.mode, MODES.SIMPLIFIED);
    assert.equal(result.hasVerdict, true);
    assert.equal(result.reasonCode, IRRIGATION_REASONS.OK);
    assert.equal(result.days, 1);

    const verdict = stepOf(result, IRRIGATION_TRACE_STEPS.VERDICT);
    assert.equal(verdict.rain.mm, 10);
    assert.equal(verdict.rain.probPct, 60);
    assert.deepEqual(verdict.thresholds, {
      mm: SIMPLIFIED_RAIN_MM,
      probPct: RAIN_PROB_THRESHOLD,
      windowHours: SIMPLIFIED_RAIN_WINDOW_HOURS,
    });
  });

  it('just under either threshold does not qualify', () => {
    const misses = [
      { rainMm: SIMPLIFIED_RAIN_MM - 0.1, rainProbPct: 90 },
      { rainMm: 30, rainProbPct: RAIN_PROB_THRESHOLD - 1 },
    ];

    for (const day of misses) {
      const result = compute({
        registry: { kcStages: curve(), rootDepthM: 1.0, depletionFraction: 0.55 },
        dailyWeather: simplifiedWeather({ offset: 1, day }),
      });
      assert.equal(
        result.reasonCode,
        IRRIGATION_REASONS.SIMPLIFIED_INTERVALS_NOT_SOURCED,
        `${JSON.stringify(day)} qualified`,
      );
    }
  });

  it('qualifying rain outside the 48-hour window does not qualify either', () => {
    const windowDays = Math.ceil(SIMPLIFIED_RAIN_WINDOW_HOURS / 24);
    const inside = compute({
      registry: { kcStages: curve(), rootDepthM: 1.0, depletionFraction: 0.55 },
      dailyWeather: simplifiedWeather({ offset: windowDays, day: { rainMm: 30, rainProbPct: 90 } }),
    });
    const outside = compute({
      registry: { kcStages: curve(), rootDepthM: 1.0, depletionFraction: 0.55 },
      dailyWeather: simplifiedWeather({
        offset: windowDays + 1,
        day: { rainMm: 30, rainProbPct: 90 },
      }),
    });

    assert.equal(inside.verdict, VERDICTS.WAIT_RAIN_EXPECTED);
    assert.equal(inside.days, windowDays);
    assert.equal(outside.reasonCode, IRRIGATION_REASONS.SIMPLIFIED_INTERVALS_NOT_SOURCED);
  });

  it('never reports a reservoir it did not compute', () => {
    const result = compute({
      registry: { kcStages: curve(), rootDepthM: 1.0, depletionFraction: 0.55 },
      dailyWeather: simplifiedWeather(),
    });

    assert.ok(!('tawMm' in result));
    assert.ok(!('rawMm' in result));
    assert.equal(stepOf(result, IRRIGATION_TRACE_STEPS.RESERVOIR), undefined);
    assert.equal(stepOf(result, IRRIGATION_TRACE_STEPS.LEDGER), undefined);
  });
});
