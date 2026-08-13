/**
 * Growth-stage derivation — engine unit tests.
 *
 * docs/irrigation/irrigation-model.md §"Test vectors": property tests including
 * "Kc(MID) > Kc(INITIAL) for all seeded crops". The engine is pure, so every
 * case here is a fixture in / object out — no database, no server, no clock:
 * `asOf` is always passed explicitly except in the one test that exists to
 * prove the default parameter works.
 *
 * Fixture Kc values are illustrative FAO-56-*shaped* numbers chosen to make the
 * arithmetic checkable by hand. They are not agronomic claims and are not the
 * registry's sourced values (those live in the seed, with sourceRefs).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  deriveStage,
  STAGE_REASONS,
  STAGE_TRACE_STEPS,
} from '../../src/engines/stage/deriveStage.js';

// ── Fixtures ────────────────────────────────────────────────────────────────

/** Fixed epoch so every expectation is a literal, not a computation. */
const SOWN = new Date('2026-01-01T00:00:00.000Z');

/** asOf for "n whole days after sowing" (+ optional intra-day offset in ms). */
const onDay = (n, offsetMs = 0) => new Date(SOWN.getTime() + n * 86_400_000 + offsetMs);

/** INITIAL 0–29 · DEVELOPMENT 30–69 · MID 70–109 · LATE 110–134 (total 135). */
const FULL_CURVE = Object.freeze([
  { stage: 'INITIAL', days: 30, kc: 0.6 },
  { stage: 'DEVELOPMENT', days: 40, kc: null },
  { stage: 'MID', days: 40, kc: 1.15 },
  { stage: 'LATE', days: 25, kc: 0.8 },
]);

/** Everything an active, fully described crop needs. */
const active = (overrides = {}) => ({
  sowingDate: SOWN,
  status: 'active',
  kcStages: FULL_CURVE,
  ...overrides,
});

/** Pulls one trace entry by step name. */
const stepOf = (result, step) => result.trace.find((entry) => entry.step === step);

// ── R1 · crop status ────────────────────────────────────────────────────────

describe('deriveStage · status gate (R1)', () => {
  it('planned crops get no verdict, with their own reason code', () => {
    const result = deriveStage(active({ status: 'planned', asOf: onDay(10) }));

    assert.equal(result.hasVerdict, false);
    assert.equal(result.reasonCode, STAGE_REASONS.CROP_NOT_ACTIVE_PLANNED);
    assert.equal(result.stage, null);
    assert.equal(result.kc, null);
  });

  it('harvested crops get no verdict, with a different reason code', () => {
    const result = deriveStage(active({ status: 'harvested', asOf: onDay(10) }));

    assert.equal(result.hasVerdict, false);
    assert.equal(result.reasonCode, STAGE_REASONS.CROP_NOT_ACTIVE_HARVESTED);
    assert.notEqual(result.reasonCode, STAGE_REASONS.CROP_NOT_ACTIVE_PLANNED);
  });

  it('an unknown or missing status is bad data, not a season', () => {
    for (const status of [undefined, null, '', 'ACTIVE', 'growing', 42]) {
      const result = deriveStage(active({ status, asOf: onDay(10) }));
      assert.equal(result.hasVerdict, false, `status ${String(status)} produced a verdict`);
      assert.equal(result.reasonCode, STAGE_REASONS.CROP_STATUS_INVALID);
    }
  });

  it('the status gate runs before any date or registry check', () => {
    const result = deriveStage({ sowingDate: null, status: 'harvested', kcStages: 'nonsense' });
    assert.equal(result.reasonCode, STAGE_REASONS.CROP_NOT_ACTIVE_HARVESTED);
  });
});

// ── Day arithmetic ──────────────────────────────────────────────────────────

describe('deriveStage · days since sowing', () => {
  it('day 0 is the sowing day itself and sits in the first stage', () => {
    const result = deriveStage(active({ asOf: onDay(0) }));

    assert.equal(result.daysSinceSowing, 0);
    assert.equal(result.stage, 'INITIAL');
    assert.equal(result.dayInStage, 0);
    assert.equal(result.stageStartDay, 0);
    assert.equal(result.stageEndDay, 29);
    assert.equal(result.hasVerdict, true);
  });

  it('floors partial days rather than rounding them', () => {
    const almostDay30 = deriveStage(active({ asOf: onDay(29, 23 * 3_600_000) }));
    assert.equal(almostDay30.daysSinceSowing, 29);
    assert.equal(almostDay30.stage, 'INITIAL');

    const oneMsShortOfDay30 = deriveStage(active({ asOf: onDay(30, -1) }));
    assert.equal(oneMsShortOfDay30.daysSinceSowing, 29);
    assert.equal(oneMsShortOfDay30.stage, 'INITIAL');

    const exactlyDay30 = deriveStage(active({ asOf: onDay(30) }));
    assert.equal(exactlyDay30.daysSinceSowing, 30);
    assert.equal(exactlyDay30.stage, 'DEVELOPMENT');
  });

  it('accepts ISO strings and epoch numbers as well as Dates', () => {
    const fromDate = deriveStage(active({ asOf: onDay(45) }));
    const fromIso = deriveStage(active({ sowingDate: SOWN.toISOString(), asOf: onDay(45) }));
    const fromEpoch = deriveStage(
      active({ sowingDate: SOWN.getTime(), asOf: onDay(45).getTime() }),
    );

    assert.equal(fromIso.daysSinceSowing, fromDate.daysSinceSowing);
    assert.equal(fromEpoch.daysSinceSowing, fromDate.daysSinceSowing);
    assert.equal(fromEpoch.kc, fromDate.kc);
  });

  it('a future sowing date yields no verdict and reports the negative day count', () => {
    const result = deriveStage(active({ asOf: onDay(-3) }));

    assert.equal(result.hasVerdict, false);
    assert.equal(result.reasonCode, STAGE_REASONS.SOWING_DATE_IN_FUTURE);
    assert.equal(result.daysSinceSowing, -3);
    assert.equal(result.stage, null);
  });

  it('one millisecond before sowing is already "not started"', () => {
    const result = deriveStage(active({ asOf: onDay(0, -1) }));

    assert.equal(result.daysSinceSowing, -1);
    assert.equal(result.reasonCode, STAGE_REASONS.SOWING_DATE_IN_FUTURE);
  });

  it('defaults asOf to now when the caller omits it', () => {
    const tenDaysAgo = new Date(Date.now() - 10 * 86_400_000);
    const result = deriveStage({ sowingDate: tenDaysAgo, status: 'active', kcStages: FULL_CURVE });

    assert.equal(result.hasVerdict, true);
    assert.equal(result.daysSinceSowing, 10);
    assert.equal(result.stage, 'INITIAL');
  });
});

// ── R3 · stage windows ──────────────────────────────────────────────────────

describe('deriveStage · stage boundaries are inclusive-start (R3)', () => {
  const boundaries = [
    { day: 0, stage: 'INITIAL', dayInStage: 0, startDay: 0, endDay: 29 },
    { day: 29, stage: 'INITIAL', dayInStage: 29, startDay: 0, endDay: 29 },
    { day: 30, stage: 'DEVELOPMENT', dayInStage: 0, startDay: 30, endDay: 69 },
    { day: 69, stage: 'DEVELOPMENT', dayInStage: 39, startDay: 30, endDay: 69 },
    { day: 70, stage: 'MID', dayInStage: 0, startDay: 70, endDay: 109 },
    { day: 109, stage: 'MID', dayInStage: 39, startDay: 70, endDay: 109 },
    { day: 110, stage: 'LATE', dayInStage: 0, startDay: 110, endDay: 134 },
    { day: 134, stage: 'LATE', dayInStage: 24, startDay: 110, endDay: 134 },
  ];

  for (const expected of boundaries) {
    it(`day ${expected.day} → ${expected.stage} (day ${expected.dayInStage} of stage)`, () => {
      const result = deriveStage(active({ asOf: onDay(expected.day) }));

      assert.equal(result.hasVerdict, true);
      assert.equal(result.stage, expected.stage);
      assert.equal(result.dayInStage, expected.dayInStage);
      assert.equal(result.stageStartDay, expected.startDay);
      assert.equal(result.stageEndDay, expected.endDay);
      assert.equal(result.totalStageDays, 135);
      assert.equal(result.harvestApproaching, false);
    });
  }

  it('every day of the season is claimed by exactly one stage', () => {
    for (let day = 0; day < 135; day += 1) {
      const result = deriveStage(active({ asOf: onDay(day) }));
      const matches = stepOf(result, STAGE_TRACE_STEPS.STAGE_WINDOWS).windows.filter(
        (w) => day >= w.startDay && day <= w.endDay,
      );
      assert.equal(matches.length, 1, `day ${day} matched ${matches.length} windows`);
      assert.equal(result.stage, matches[0].stage);
    }
  });

  it('the first day past the LATE window ends the season with a harvest signal', () => {
    const result = deriveStage(active({ asOf: onDay(135) }));

    assert.equal(result.hasVerdict, false);
    assert.equal(result.reasonCode, STAGE_REASONS.BEYOND_LATE_STAGE_END);
    assert.equal(result.harvestApproaching, true);
    assert.equal(result.daysSinceSowing, 135);
    assert.equal(result.totalStageDays, 135);
    assert.equal(result.stage, null);
    assert.equal(result.kc, null);
  });

  it('stays past-end however far beyond the season the date is', () => {
    const result = deriveStage(active({ asOf: onDay(4_000) }));

    assert.equal(result.reasonCode, STAGE_REASONS.BEYOND_LATE_STAGE_END);
    assert.equal(result.harvestApproaching, true);
    assert.equal(result.daysSinceSowing, 4_000);
  });
});

// ── Kc resolution ───────────────────────────────────────────────────────────

describe('deriveStage · Kc on the plateau stages is used as published', () => {
  it('reads the registry value for INITIAL and MID', () => {
    assert.equal(deriveStage(active({ asOf: onDay(5) })).kc, 0.6);
    assert.equal(deriveStage(active({ asOf: onDay(80) })).kc, 1.15);
  });

  /**
   * LATE is NOT a plateau. The Kc stored against it is FAO-56's Kc_end — the
   * value at the *end* of the late season — so the stage is a decline from
   * Kc_mid to it, not a flat 25 days at the harvest-day value.
   * (crops.agronomy.json `conventions.lateStageKc`.)
   *
   * Day 120 is day 10 of a 25-day LATE window: 1.15 + (10/25)(0.8 − 1.15) = 1.01.
   */
  it('declines LATE from Kc_mid to the published Kc_end rather than holding it flat', () => {
    assert.equal(deriveStage(active({ asOf: onDay(120) })).kc, 1.01);
  });

  it('reaches Kc_mid on the first LATE day and approaches Kc_end on the last', () => {
    assert.equal(deriveStage(active({ asOf: onDay(110) })).kc, 1.15);
    // Day 134 is dayInStage 24 of 25 — the published Kc_end is reached at the
    // stage boundary itself, which the crop has left by then.
    assert.equal(deriveStage(active({ asOf: onDay(134) })).kc, 0.814);
  });

  it('traces a direct read as such', () => {
    const result = deriveStage(active({ asOf: onDay(80) }));
    const entry = stepOf(result, STAGE_TRACE_STEPS.KC_DIRECT);

    assert.deepEqual(entry, { step: 'KC_DIRECT', stage: 'MID', kc: 1.15 });
    assert.equal(stepOf(result, STAGE_TRACE_STEPS.KC_INTERPOLATED), undefined);
  });
});

describe('deriveStage · DEVELOPMENT Kc is linearly interpolated', () => {
  // FAO-56: Kc(i) = Kc_ini + (dayInStage / devDays) × (Kc_mid − Kc_ini)
  //         = 0.6 + (dayInStage / 40) × 0.55
  const expectedAt = (dayInStage) => Math.round((0.6 + (dayInStage / 40) * 0.55) * 1000) / 1000;

  it('starts at the preceding stage value on the first development day', () => {
    const result = deriveStage(active({ asOf: onDay(30) }));

    assert.equal(result.stage, 'DEVELOPMENT');
    assert.equal(result.dayInStage, 0);
    assert.equal(result.kc, 0.6);
  });

  it('is halfway between the endpoints at the midpoint of the window', () => {
    const result = deriveStage(active({ asOf: onDay(50) }));

    assert.equal(result.dayInStage, 20);
    assert.equal(result.kc, 0.875); // 0.6 + 0.5 × (1.15 − 0.6)
    assert.equal(result.kc, expectedAt(20));
  });

  it('reaches just below the following stage value on the last development day', () => {
    const lastDevDay = deriveStage(active({ asOf: onDay(69) }));

    assert.equal(lastDevDay.dayInStage, 39);
    assert.equal(lastDevDay.kc, expectedAt(39)); // 39/40 of the way up
    assert.ok(lastDevDay.kc < 1.15);
    // Kc_mid itself lands on the first day of MID — that is the FAO-56 shape.
    assert.equal(deriveStage(active({ asOf: onDay(70) })).kc, 1.15);
  });

  it('is monotonically increasing and bounded by its endpoints across the window', () => {
    let previous = -Infinity;
    for (let day = 30; day <= 69; day += 1) {
      const { kc, stage } = deriveStage(active({ asOf: onDay(day) }));
      assert.equal(stage, 'DEVELOPMENT');
      assert.ok(kc > previous, `Kc fell at day ${day}: ${kc} after ${previous}`);
      assert.ok(kc >= 0.6 && kc < 1.15, `Kc ${kc} escaped [0.6, 1.15) at day ${day}`);
      previous = kc;
    }
  });

  it('traces every number the interpolation used (R12)', () => {
    const result = deriveStage(active({ asOf: onDay(50) }));

    assert.deepEqual(stepOf(result, STAGE_TRACE_STEPS.KC_INTERPOLATED), {
      step: 'KC_INTERPOLATED',
      stage: 'DEVELOPMENT',
      fromStage: 'INITIAL',
      fromKc: 0.6,
      toStage: 'MID',
      toKc: 1.15,
      dayInStage: 20,
      stageDays: 40,
      fraction: 0.5,
      kc: 0.875,
    });
  });

  it('interpolates downward just as happily (MID → LATE shaped curve)', () => {
    const descending = [
      { stage: 'MID', days: 10, kc: 1.2 },
      { stage: 'DEVELOPMENT', days: 10, kc: null },
      { stage: 'LATE', days: 10, kc: 0.7 },
    ];
    const result = deriveStage(active({ kcStages: descending, asOf: onDay(15) }));

    assert.equal(result.stage, 'DEVELOPMENT');
    assert.equal(result.kc, 0.95); // 1.2 + 0.5 × (0.7 − 1.2)
  });

  it('handles a one-day development window without dividing by zero', () => {
    const tight = [
      { stage: 'INITIAL', days: 2, kc: 0.5 },
      { stage: 'DEVELOPMENT', days: 1, kc: null },
      { stage: 'MID', days: 2, kc: 1.1 },
    ];
    const result = deriveStage(active({ kcStages: tight, asOf: onDay(2) }));

    assert.equal(result.stage, 'DEVELOPMENT');
    assert.equal(result.kc, 0.5);
    assert.ok(Number.isFinite(result.kc));
  });
});

// ── Missing / unsourced Kc ──────────────────────────────────────────────────

describe('deriveStage · unknown Kc is reported, never invented', () => {
  it('a curve with no DEVELOPMENT entry simply steps INITIAL → MID', () => {
    const noDev = [
      { stage: 'INITIAL', days: 30, kc: 0.6 },
      { stage: 'MID', days: 40, kc: 1.15 },
      { stage: 'LATE', days: 25, kc: 0.8 },
    ];

    const lastInitial = deriveStage(active({ kcStages: noDev, asOf: onDay(29) }));
    assert.equal(lastInitial.stage, 'INITIAL');
    assert.equal(lastInitial.kc, 0.6);

    const firstMid = deriveStage(active({ kcStages: noDev, asOf: onDay(30) }));
    assert.equal(firstMid.stage, 'MID');
    assert.equal(firstMid.kc, 1.15);
    assert.equal(firstMid.dayInStage, 0);
    assert.equal(firstMid.reasonCode, STAGE_REASONS.STAGE_DERIVED);
    assert.equal(firstMid.totalStageDays, 95);
  });

  it('an unsourced Kc on a non-DEVELOPMENT stage returns null, not NaN', () => {
    const unsourced = [
      { stage: 'INITIAL', days: 30, kc: null },
      { stage: 'MID', days: 40, kc: 1.15 },
    ];
    const result = deriveStage(active({ kcStages: unsourced, asOf: onDay(10) }));

    assert.equal(result.hasVerdict, true, 'the stage is still known');
    assert.equal(result.stage, 'INITIAL');
    assert.equal(result.kc, null);
    assert.ok(!Number.isNaN(result.kc));
    assert.equal(result.reasonCode, STAGE_REASONS.STAGE_DERIVED_KC_UNAVAILABLE);
    assert.equal(stepOf(result, STAGE_TRACE_STEPS.KC_UNAVAILABLE).cause, 'KC_NOT_SOURCED');
  });

  it('a missing kc field behaves exactly like an explicit null', () => {
    const implicit = [{ stage: 'INITIAL', days: 30 }];
    const result = deriveStage(active({ kcStages: implicit, asOf: onDay(1) }));

    assert.equal(result.kc, null);
    assert.equal(result.reasonCode, STAGE_REASONS.STAGE_DERIVED_KC_UNAVAILABLE);
  });

  it('a non-numeric or NaN kc is treated as unsourced rather than propagated', () => {
    for (const kc of [Number.NaN, '0.7', -1, undefined]) {
      const result = deriveStage(
        active({ kcStages: [{ stage: 'MID', days: 10, kc }], asOf: onDay(1) }),
      );
      assert.equal(result.kc, null, `kc ${String(kc)} leaked through`);
      assert.equal(result.reasonCode, STAGE_REASONS.STAGE_DERIVED_KC_UNAVAILABLE);
    }
  });

  it('DEVELOPMENT with an unsourced neighbour yields null, not a half-invented Kc', () => {
    const brokenEndpoint = [
      { stage: 'INITIAL', days: 10, kc: null },
      { stage: 'DEVELOPMENT', days: 10, kc: null },
      { stage: 'MID', days: 10, kc: 1.15 },
    ];
    const result = deriveStage(active({ kcStages: brokenEndpoint, asOf: onDay(15) }));

    assert.equal(result.stage, 'DEVELOPMENT');
    assert.equal(result.kc, null);
    assert.equal(result.reasonCode, STAGE_REASONS.STAGE_DERIVED_KC_UNAVAILABLE);

    const trace = stepOf(result, STAGE_TRACE_STEPS.KC_UNAVAILABLE);
    assert.equal(trace.cause, 'INTERPOLATION_ENDPOINT_MISSING');
    assert.equal(trace.fromKc, null);
    assert.equal(trace.toKc, 1.15);
  });

  it('DEVELOPMENT first in the curve has nothing to interpolate from', () => {
    const leading = [
      { stage: 'DEVELOPMENT', days: 10, kc: null },
      { stage: 'MID', days: 10, kc: 1.15 },
    ];
    const result = deriveStage(active({ kcStages: leading, asOf: onDay(3) }));

    assert.equal(result.stage, 'DEVELOPMENT');
    assert.equal(result.kc, null);
    assert.equal(stepOf(result, STAGE_TRACE_STEPS.KC_UNAVAILABLE).fromStage, null);
  });

  it('DEVELOPMENT last in the curve has nothing to interpolate to', () => {
    const trailing = [
      { stage: 'INITIAL', days: 10, kc: 0.6 },
      { stage: 'DEVELOPMENT', days: 10, kc: null },
    ];
    const result = deriveStage(active({ kcStages: trailing, asOf: onDay(13) }));

    assert.equal(result.stage, 'DEVELOPMENT');
    assert.equal(result.kc, null);
    assert.equal(stepOf(result, STAGE_TRACE_STEPS.KC_UNAVAILABLE).toStage, null);
  });
});

// ── Malformed input · never throws ──────────────────────────────────────────

describe('deriveStage · malformed input returns a no-verdict result, never a throw', () => {
  it('an empty kcStages array is the LIMITED-crop case, not an error', () => {
    const result = deriveStage(active({ kcStages: [], asOf: onDay(10) }));

    assert.equal(result.hasVerdict, false);
    assert.equal(result.reasonCode, STAGE_REASONS.KC_STAGES_UNAVAILABLE);
    assert.equal(result.daysSinceSowing, 10, 'day count is still useful to the caller');
    assert.equal(result.totalStageDays, 0);
    assert.equal(result.stage, null);
    assert.equal(result.kc, null);
  });

  it('rejects a kcStages that is not an array', () => {
    for (const kcStages of [null, undefined, 'INITIAL', 42, { stage: 'INITIAL' }]) {
      const result = deriveStage(active({ kcStages, asOf: onDay(10) }));
      assert.equal(result.hasVerdict, false);
      assert.equal(result.reasonCode, STAGE_REASONS.KC_STAGES_INVALID);
    }
  });

  it('rejects entries with an unusable stage or duration', () => {
    const broken = [
      [{ stage: 'INITIAL', days: 0, kc: 0.6 }],
      [{ stage: 'INITIAL', days: -5, kc: 0.6 }],
      [{ stage: 'INITIAL', days: Number.NaN, kc: 0.6 }],
      [{ stage: 'INITIAL', days: '30', kc: 0.6 }],
      [{ stage: 'INITIAL', kc: 0.6 }],
      [{ stage: 'FLOWERING', days: 30, kc: 0.6 }],
      [{ days: 30, kc: 0.6 }],
      [null],
      ['INITIAL'],
      [{ stage: 'INITIAL', days: 30, kc: 0.6 }, undefined],
    ];

    for (const kcStages of broken) {
      const result = deriveStage(active({ kcStages, asOf: onDay(10) }));
      assert.equal(
        result.reasonCode,
        STAGE_REASONS.KC_STAGES_INVALID,
        `accepted ${JSON.stringify(kcStages)}`,
      );
      assert.equal(result.hasVerdict, false);
    }
  });

  it('rejects an unreadable sowing date', () => {
    for (const sowingDate of [null, undefined, '', 'yesterday', new Date('nope'), {}]) {
      const result = deriveStage(active({ sowingDate, asOf: onDay(10) }));
      assert.equal(result.hasVerdict, false, `accepted ${String(sowingDate)}`);
      assert.equal(result.reasonCode, STAGE_REASONS.SOWING_DATE_INVALID);
      assert.equal(result.daysSinceSowing, null);
    }
  });

  it('rejects an unreadable asOf', () => {
    const result = deriveStage(active({ asOf: 'sometime' }));

    assert.equal(result.hasVerdict, false);
    assert.equal(result.reasonCode, STAGE_REASONS.AS_OF_INVALID);
  });

  it('survives being called with nothing at all', () => {
    const result = deriveStage();

    assert.equal(result.hasVerdict, false);
    assert.equal(result.reasonCode, STAGE_REASONS.CROP_STATUS_INVALID);
    assert.ok(Array.isArray(result.trace));
  });
});

// ── Reason precedence ───────────────────────────────────────────────────────

describe('deriveStage · reason precedence is fixed', () => {
  it('crop state outranks registry gaps: future sowing beats an empty curve', () => {
    const result = deriveStage(active({ kcStages: [], asOf: onDay(-1) }));
    assert.equal(result.reasonCode, STAGE_REASONS.SOWING_DATE_IN_FUTURE);
  });

  it('structural damage to the curve outranks the day count', () => {
    const result = deriveStage(active({ kcStages: 'nope', asOf: onDay(-1) }));
    assert.equal(result.reasonCode, STAGE_REASONS.KC_STAGES_INVALID);
  });

  it('an unreadable date outranks a damaged curve', () => {
    const result = deriveStage(active({ sowingDate: null, kcStages: 'nope' }));
    assert.equal(result.reasonCode, STAGE_REASONS.SOWING_DATE_INVALID);
  });
});

// ── R12 · trace ─────────────────────────────────────────────────────────────

describe('deriveStage · trace (R12)', () => {
  it('records the inputs, the day maths, the windows, the match and the Kc', () => {
    const result = deriveStage(active({ asOf: onDay(50) }));
    const steps = result.trace.map((entry) => entry.step);

    assert.deepEqual(steps, [
      STAGE_TRACE_STEPS.INPUT,
      STAGE_TRACE_STEPS.DAYS_SINCE_SOWING,
      STAGE_TRACE_STEPS.STAGE_WINDOWS,
      STAGE_TRACE_STEPS.STAGE_MATCH,
      STAGE_TRACE_STEPS.KC_INTERPOLATED,
    ]);

    assert.deepEqual(stepOf(result, STAGE_TRACE_STEPS.INPUT), {
      step: 'INPUT',
      sowingDate: '2026-01-01T00:00:00.000Z',
      asOf: '2026-02-20T00:00:00.000Z',
      status: 'active',
      stageCount: 4,
    });
    assert.deepEqual(stepOf(result, STAGE_TRACE_STEPS.DAYS_SINCE_SOWING), {
      step: 'DAYS_SINCE_SOWING',
      elapsedMs: 50 * 86_400_000,
      daysSinceSowing: 50,
    });
    assert.deepEqual(stepOf(result, STAGE_TRACE_STEPS.STAGE_MATCH), {
      step: 'STAGE_MATCH',
      stage: 'DEVELOPMENT',
      stageIndex: 1,
      startDay: 30,
      endDay: 69,
      dayInStage: 20,
    });
  });

  it('publishes the full window table so the UI can draw the season', () => {
    const result = deriveStage(active({ asOf: onDay(50) }));
    const windows = stepOf(result, STAGE_TRACE_STEPS.STAGE_WINDOWS);

    assert.equal(windows.totalDays, 135);
    assert.deepEqual(windows.windows, [
      { stage: 'INITIAL', days: 30, kc: 0.6, startDay: 0, endDay: 29 },
      { stage: 'DEVELOPMENT', days: 40, kc: null, startDay: 30, endDay: 69 },
      { stage: 'MID', days: 40, kc: 1.15, startDay: 70, endDay: 109 },
      { stage: 'LATE', days: 25, kc: 0.8, startDay: 110, endDay: 134 },
    ]);
  });

  it('is structured data, not prose, and every no-verdict path ends with its reason', () => {
    const cases = [
      active({ status: 'planned' }),
      active({ asOf: onDay(-1) }),
      active({ kcStages: [], asOf: onDay(1) }),
      active({ kcStages: 'nope', asOf: onDay(1) }),
      active({ asOf: onDay(200) }),
    ];

    for (const input of cases) {
      const result = deriveStage(input);
      const last = result.trace.at(-1);

      assert.equal(last.step, STAGE_TRACE_STEPS.NO_VERDICT);
      assert.equal(last.reasonCode, result.reasonCode);
      for (const entry of result.trace) {
        assert.equal(typeof entry, 'object');
        assert.equal(typeof entry.step, 'string');
      }
    }
  });
});

// ── Purity and property tests ───────────────────────────────────────────────

describe('deriveStage · purity', () => {
  it('is deterministic: identical inputs give a deeply equal result', () => {
    const input = active({ asOf: onDay(55) });
    assert.deepEqual(deriveStage(input), deriveStage(input));
  });

  it('does not mutate the inputs it is handed', () => {
    const kcStages = FULL_CURVE.map((entry) => ({ ...entry }));
    const snapshot = JSON.parse(JSON.stringify(kcStages));
    const sowingDate = new Date(SOWN);

    deriveStage({ sowingDate, status: 'active', kcStages, asOf: onDay(50) });

    assert.deepEqual(JSON.parse(JSON.stringify(kcStages)), snapshot);
    assert.equal(sowingDate.getTime(), SOWN.getTime());
  });
});

describe('deriveStage · property: Kc(MID) > Kc(INITIAL)', () => {
  // docs/irrigation/irrigation-model.md §"Test vectors":
  //   "Kc(MID) > Kc(INITIAL) for all seeded crops".
  // Curve shapes only — sourced values live in the registry seed.
  const curves = {
    shortDuration: [
      { stage: 'INITIAL', days: 20, kc: 0.4 },
      { stage: 'DEVELOPMENT', days: 30, kc: null },
      { stage: 'MID', days: 30, kc: 1.05 },
      { stage: 'LATE', days: 20, kc: 0.65 },
    ],
    longDuration: [
      { stage: 'INITIAL', days: 35, kc: 0.7 },
      { stage: 'DEVELOPMENT', days: 45, kc: null },
      { stage: 'MID', days: 60, kc: 1.2 },
      { stage: 'LATE', days: 30, kc: 0.75 },
    ],
    noDevelopment: [
      { stage: 'INITIAL', days: 25, kc: 0.5 },
      { stage: 'MID', days: 40, kc: 1.1 },
      { stage: 'LATE', days: 20, kc: 0.9 },
    ],
    standard: [...FULL_CURVE],
  };

  for (const [name, kcStages] of Object.entries(curves)) {
    it(`${name}: mid-season Kc exceeds initial Kc, with DEVELOPMENT between them`, () => {
      const dayIn = (stage) => {
        let cursor = 0;
        for (const entry of kcStages) {
          if (entry.stage === stage) return cursor;
          cursor += entry.days;
        }
        return null;
      };

      const initial = deriveStage(active({ kcStages, asOf: onDay(dayIn('INITIAL')) }));
      const mid = deriveStage(active({ kcStages, asOf: onDay(dayIn('MID')) }));

      assert.equal(initial.stage, 'INITIAL');
      assert.equal(mid.stage, 'MID');
      assert.ok(mid.kc > initial.kc, `Kc(MID)=${mid.kc} !> Kc(INITIAL)=${initial.kc}`);

      const devStart = dayIn('DEVELOPMENT');
      if (devStart == null) return;
      const dev = deriveStage(active({ kcStages, asOf: onDay(devStart + 1) }));
      assert.ok(dev.kc >= initial.kc && dev.kc <= mid.kc, `Kc(DEV)=${dev.kc} left the band`);
    });
  }
});

describe('deriveStage · reason codes are a stable contract', () => {
  it('every code is UPPER_SNAKE and matches its key', () => {
    for (const [key, value] of Object.entries(STAGE_REASONS)) {
      assert.equal(key, value);
      assert.match(value, /^[A-Z][A-Z_]*[A-Z]$/);
    }
    assert.ok(Object.isFrozen(STAGE_REASONS));
  });

  it('only ever returns a code drawn from the exported set', () => {
    const codes = new Set(Object.values(STAGE_REASONS));
    const inputs = [
      active({ asOf: onDay(0) }),
      active({ asOf: onDay(50) }),
      active({ asOf: onDay(200) }),
      active({ asOf: onDay(-1) }),
      active({ status: 'planned' }),
      active({ status: 'harvested' }),
      active({ status: 'zzz' }),
      active({ sowingDate: 'nope' }),
      active({ asOf: 'nope' }),
      active({ kcStages: [], asOf: onDay(1) }),
      active({ kcStages: 'nope', asOf: onDay(1) }),
      active({ kcStages: [{ stage: 'MID', days: 5 }], asOf: onDay(1) }),
    ];

    for (const input of inputs) {
      const { reasonCode } = deriveStage(input);
      assert.ok(codes.has(reasonCode), `unknown reason code ${reasonCode}`);
    }
  });
});
