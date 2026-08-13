/**
 * Weather risk — engine unit tests.
 *
 * docs/weather/weather-architecture.md prints six triggers; the MASTER-TODO asks
 * for "a fixture per risk", so each one gets a describe block that walks the
 * threshold: below it, exactly on it, past it, plus the registry override and
 * the numbers the verdict carries (R12). The engine is pure, so every case is a
 * fixture in / object out — no database, no server, no clock: `asOf` is always
 * passed explicitly because this project has no fake timers (ADR-022).
 *
 * Fixture weather is *shaped* like Open-Meteo daily rows and chosen to make the
 * banding arithmetic checkable by hand. The numbers are not agronomic claims,
 * and the fixture `sensitivity` objects are not any crop's sourced thresholds
 * (those live in the registry seed, with sourceRefs).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { RISK_LEVELS, WEATHER_RISK_TYPES } from '../../src/config/constants.js';
import {
  assessWeatherRisks,
  DEFAULT_THRESHOLDS,
  RISK_CONSTANTS,
  RISK_REASONS,
  RISK_TRACE_STEPS,
} from '../../src/engines/weatherRisk/weatherRisk.js';
import { dayKey } from '../../src/utils/day.js';

// ── Fixtures ────────────────────────────────────────────────────────────────

/** Fixed epoch so every expectation is a literal, not a computation. */
const AS_OF = new Date('2026-08-13T06:00:00.000Z');

/**
 * Midday UTC on the calendar day `offset` days from asOf. Midday keeps the row
 * on the same calendar day in every plausible test-runner timezone, which
 * matters because the engine buckets days by *local* midnight.
 */
const dayAt = (offset) => new Date(Date.UTC(2026, 7, 13 + offset, 12, 0, 0));

/**
 * The same instant as the engine's own IST day key. Every date the engine emits
 * — `risk.date` and the per-day entries inside `data` — is this string form, so
 * nothing in a payload is a raw Date that would serialise as a full timestamp.
 */
const dayKeyAt = (offset) => dayKey(dayAt(offset));

/** 14 rows: seven observed days behind asOf, seven forecast days from it. */
const OFFSETS = Object.freeze([-7, -6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6]);

/**
 * Benign baseline: nothing here trips any of the six triggers, so a fixture
 * only has to state the field it is testing.
 *   rain 2mm × 14 days = 28mm, comfortably above the dry-spell threshold
 *   30/20°C sits inside the disease temperature band, so humidity alone decides
 */
const BASELINE = Object.freeze({
  tMinC: 20,
  tMaxC: 30,
  rainMm: 2,
  rainProbPct: 20,
  windKmh: 10,
  humidityPct: 50,
});

/**
 * The 14-day series. `patches.all` overrides every day; a numeric key overrides
 * the single day at that offset — `series({ 3: { tMaxC: 42 } })`.
 */
const series = (patches = {}) =>
  OFFSETS.map((offset) => ({
    date: dayAt(offset),
    ...BASELINE,
    ...(patches.all ?? {}),
    ...(patches[String(offset)] ?? {}),
  }));

/** An active crop with no registry thresholds, at a non-sensitive stage. */
const input = (overrides = {}) => ({
  daily: series(),
  stage: 'INITIAL',
  cropStatus: 'active',
  asOf: AS_OF,
  ...overrides,
});

const riskOf = (result, type) => result.risks.find((risk) => risk.type === type);
const typesOf = (result) => result.risks.map((risk) => risk.type);
const rank = (level) => RISK_LEVELS.indexOf(level);

/** Pulls one trace entry by step name. */
const stepOf = (result, step) => result.trace.find((entry) => entry.step === step);

/** Every risk carries a level drawn from the published band list. */
const assertWellFormed = (risk, type) => {
  assert.ok(risk, `${type} did not fire`);
  assert.equal(risk.type, type);
  assert.ok(RISK_LEVELS.includes(risk.level), `unknown level ${risk.level}`);
  assert.ok(['REGISTRY', 'ENGINE_DEFAULT'].includes(risk.thresholdSource));
  assert.equal(typeof risk.daysAhead, 'number');
  // The emitted date is a plain calendar day, never a timestamp.
  assert.match(risk.date, /^\d{4}-\d{2}-\d{2}$/);
};

// ── Baseline sanity ─────────────────────────────────────────────────────────

describe('assessWeatherRisks · benign weather', () => {
  it('trips nothing and says so with a reason code, not an empty silence', () => {
    const result = assessWeatherRisks(input());

    assert.equal(result.hasRisks, false);
    assert.deepEqual(result.risks, []);
    assert.equal(result.reasonCode, RISK_REASONS.NO_RISK_DETECTED);
  });
});

// ── HEAVY_RAIN · "≥50mm/24h forecast, prob ≥60%" ────────────────────────────

describe('assessWeatherRisks · HEAVY_RAIN', () => {
  const { HEAVY_RAIN } = WEATHER_RISK_TYPES;

  it('below the threshold there is no risk', () => {
    const result = assessWeatherRisks(
      input({ daily: series({ 3: { rainMm: 49.9, rainProbPct: 80 } }) }),
    );

    assert.equal(riskOf(result, HEAVY_RAIN), undefined);
  });

  it('is inclusive at the threshold: exactly 50mm fires', () => {
    const result = assessWeatherRisks(
      input({ daily: series({ 3: { rainMm: 50, rainProbPct: 80 } }) }),
    );
    const risk = riskOf(result, HEAVY_RAIN);

    assertWellFormed(risk, HEAVY_RAIN);
    assert.equal(risk.level, 'LOW'); // band 0, no imminence or stage bump
    assert.equal(risk.daysAhead, 3);
  });

  it('above the threshold the level climbs with each multiple of it', () => {
    const result = assessWeatherRisks(
      input({ daily: series({ 3: { rainMm: 150, rainProbPct: 80 } }) }),
    );
    const risk = riskOf(result, HEAVY_RAIN);

    assertWellFormed(risk, HEAVY_RAIN);
    assert.equal(risk.level, 'HIGH'); // 150/50 − 1 = band 2
    assert.equal(risk.thresholdSource, 'ENGINE_DEFAULT');
  });

  it('carries the numbers behind the verdict (R12)', () => {
    const result = assessWeatherRisks(
      input({ daily: series({ 3: { rainMm: 150, rainProbPct: 80 } }) }),
    );

    assert.deepEqual(riskOf(result, HEAVY_RAIN).data, {
      rainMm: 150,
      rainProbPct: 80,
      thresholdMm: DEFAULT_THRESHOLDS.heavyRainMm24h,
      probThresholdPct: RISK_CONSTANTS.RAIN_PROB_THRESHOLD,
      stage: 'INITIAL',
    });
  });

  it('is inclusive at the probability qualifier too, and treats an absent probability as qualifying', () => {
    const at60 = assessWeatherRisks(
      input({ daily: series({ 3: { rainMm: 80, rainProbPct: 60 } }) }),
    );
    assert.ok(riskOf(at60, HEAVY_RAIN));

    const below60 = assessWeatherRisks(
      input({ daily: series({ 3: { rainMm: 80, rainProbPct: 59.9 } }) }),
    );
    assert.equal(riskOf(below60, HEAVY_RAIN), undefined);

    // The rain total is the stronger signal; discarding it would under-warn.
    const noProb = assessWeatherRisks(
      input({ daily: series({ 3: { rainMm: 80, rainProbPct: undefined } }) }),
    );
    assert.ok(riskOf(noProb, HEAVY_RAIN));
    assert.equal(riskOf(noProb, HEAVY_RAIN).data.rainProbPct, null);
  });

  it('a registry threshold overrides the engine default and is labelled REGISTRY', () => {
    const daily = series({ 3: { rainMm: 25, rainProbPct: 80 } });

    const onDefault = assessWeatherRisks(input({ daily }));
    assert.equal(riskOf(onDefault, HEAVY_RAIN), undefined, '25mm is not heavy by default');

    const onRegistry = assessWeatherRisks(input({ daily, sensitivity: { heavyRainMm24h: 20 } }));
    const risk = riskOf(onRegistry, HEAVY_RAIN);

    assertWellFormed(risk, HEAVY_RAIN);
    assert.equal(risk.thresholdSource, 'REGISTRY');
    assert.equal(risk.data.thresholdMm, 20);
  });

  it('a non-numeric registry value falls back to the default, still labelled honestly', () => {
    for (const heavyRainMm24h of [null, undefined, '20', Number.NaN, Infinity]) {
      const result = assessWeatherRisks(
        input({
          daily: series({ 3: { rainMm: 60, rainProbPct: 80 } }),
          sensitivity: { heavyRainMm24h },
        }),
      );
      const risk = riskOf(result, HEAVY_RAIN);

      assert.equal(risk.thresholdSource, 'ENGINE_DEFAULT', `accepted ${String(heavyRainMm24h)}`);
      assert.equal(risk.data.thresholdMm, DEFAULT_THRESHOLDS.heavyRainMm24h);
    }
  });

  it('survives a degenerate registry threshold without producing NaN or throwing', () => {
    // A zero threshold is nonsense the seed should never publish; the point of
    // this case is only that the engine stays finite and inside its band list.
    const result = assessWeatherRisks(
      input({
        daily: series({ 3: { rainMm: 60, rainProbPct: 80 } }),
        sensitivity: { heavyRainMm24h: 0 },
      }),
    );

    assertWellFormed(riskOf(result, HEAVY_RAIN), HEAVY_RAIN);
  });
});

// ── HEAT · "Tmax ≥ crop heatTmaxC" ──────────────────────────────────────────

describe('assessWeatherRisks · HEAT', () => {
  const { HEAT } = WEATHER_RISK_TYPES;

  it('below the threshold there is no risk', () => {
    const result = assessWeatherRisks(input({ daily: series({ 3: { tMaxC: 37.9 } }) }));

    assert.equal(riskOf(result, HEAT), undefined);
  });

  it('is inclusive at the threshold: exactly 38°C fires', () => {
    const result = assessWeatherRisks(input({ daily: series({ 3: { tMaxC: 38 } }) }));
    const risk = riskOf(result, HEAT);

    assertWellFormed(risk, HEAT);
    assert.equal(risk.level, 'LOW'); // band 0
    assert.equal(risk.daysAhead, 3);
  });

  it('above the threshold the level climbs every two degrees', () => {
    const result = assessWeatherRisks(input({ daily: series({ 3: { tMaxC: 42 } }) }));
    const risk = riskOf(result, HEAT);

    assertWellFormed(risk, HEAT);
    assert.equal(risk.level, 'HIGH'); // (42 − 38)/2 = band 2
  });

  it('picks the worst day in the window, not the first', () => {
    const result = assessWeatherRisks(
      input({ daily: series({ 2: { tMaxC: 39 }, 4: { tMaxC: 44 } }) }),
    );

    assert.equal(riskOf(result, HEAT).data.tMaxC, 44);
    assert.equal(riskOf(result, HEAT).daysAhead, 4);
  });

  it('carries the numbers behind the verdict (R12)', () => {
    const result = assessWeatherRisks(input({ daily: series({ 3: { tMaxC: 42 } }) }));

    assert.deepEqual(riskOf(result, HEAT).data, {
      tMaxC: 42,
      thresholdC: DEFAULT_THRESHOLDS.heatTmaxC,
      degreesOver: 4,
      degreesPerBand: 2,
      stage: 'INITIAL',
    });
  });

  it('a registry threshold overrides the engine default and is labelled REGISTRY', () => {
    const daily = series({ 3: { tMaxC: 35 } });

    assert.equal(riskOf(assessWeatherRisks(input({ daily })), HEAT), undefined);

    const risk = riskOf(assessWeatherRisks(input({ daily, sensitivity: { heatTmaxC: 33 } })), HEAT);

    assertWellFormed(risk, HEAT);
    assert.equal(risk.thresholdSource, 'REGISTRY');
    assert.equal(risk.data.thresholdC, 33);
    assert.equal(risk.data.degreesOver, 2);
    assert.equal(risk.level, 'MEDIUM'); // band 1
  });
});

// ── FROST · "Tmin ≤ crop frostTminC" ────────────────────────────────────────

describe('assessWeatherRisks · FROST', () => {
  const { FROST } = WEATHER_RISK_TYPES;

  it('above the threshold — a warmer night — there is no risk', () => {
    const result = assessWeatherRisks(input({ daily: series({ 3: { tMinC: 4.1 } }) }));

    assert.equal(riskOf(result, FROST), undefined);
  });

  it('is inclusive at the threshold: exactly 4°C fires', () => {
    const result = assessWeatherRisks(input({ daily: series({ 3: { tMinC: 4 } }) }));
    const risk = riskOf(result, FROST);

    assertWellFormed(risk, FROST);
    // Frost opens one band above the others: base band 1, nothing over yet.
    assert.equal(risk.level, 'MEDIUM');
    assert.equal(risk.daysAhead, 3);
  });

  it('below the threshold the level climbs every two degrees under it', () => {
    const result = assessWeatherRisks(input({ daily: series({ 3: { tMinC: 2 } }) }));

    assert.equal(riskOf(result, FROST).level, 'HIGH'); // 1 + (4 − 2)/2 = band 2
    assert.equal(
      assessWeatherRisks(input({ daily: series({ 3: { tMinC: -2 } }) })).risks.find(
        (risk) => risk.type === FROST,
      ).level,
      'CRITICAL', // 1 + 3 = band 4, clamped
    );
  });

  it('carries the numbers behind the verdict (R12)', () => {
    const result = assessWeatherRisks(input({ daily: series({ 3: { tMinC: 2 } }) }));

    assert.deepEqual(riskOf(result, FROST).data, {
      tMinC: 2,
      thresholdC: DEFAULT_THRESHOLDS.frostTminC,
      degreesUnder: 2,
      degreesPerBand: 2,
      baseBand: 1,
      stage: 'INITIAL',
    });
  });

  it('a registry threshold overrides the engine default and is labelled REGISTRY', () => {
    const daily = series({ 3: { tMinC: 8 } });

    assert.equal(riskOf(assessWeatherRisks(input({ daily })), FROST), undefined);

    const risk = riskOf(
      assessWeatherRisks(input({ daily, sensitivity: { frostTminC: 8 } })),
      FROST,
    );

    assertWellFormed(risk, FROST);
    assert.equal(risk.thresholdSource, 'REGISTRY');
    assert.equal(risk.data.thresholdC, 8);
    assert.equal(risk.data.degreesUnder, 0);
    assert.equal(risk.level, 'MEDIUM');
  });
});

// ── WIND · "≥40 km/h" ───────────────────────────────────────────────────────

describe('assessWeatherRisks · WIND', () => {
  const { WIND } = WEATHER_RISK_TYPES;

  it('below the threshold there is no risk', () => {
    const result = assessWeatherRisks(input({ daily: series({ 3: { windKmh: 39.9 } }) }));

    assert.equal(riskOf(result, WIND), undefined);
  });

  it('is inclusive at the threshold: exactly 40 km/h fires', () => {
    const result = assessWeatherRisks(input({ daily: series({ 3: { windKmh: 40 } }) }));
    const risk = riskOf(result, WIND);

    assertWellFormed(risk, WIND);
    assert.equal(risk.level, 'LOW'); // band 0
    assert.equal(risk.daysAhead, 3);
  });

  it('above the threshold the level climbs with each multiple of it', () => {
    const result = assessWeatherRisks(input({ daily: series({ 3: { windKmh: 120 } }) }));

    assert.equal(riskOf(result, WIND).level, 'HIGH'); // 120/40 − 1 = band 2
  });

  it('carries the numbers behind the verdict (R12)', () => {
    const result = assessWeatherRisks(input({ daily: series({ 3: { windKmh: 120 } }) }));

    assert.deepEqual(riskOf(result, WIND).data, {
      windKmh: 120,
      thresholdKmh: DEFAULT_THRESHOLDS.highWindKmh,
      stage: 'INITIAL',
    });
  });

  it('a registry threshold overrides the engine default and is labelled REGISTRY', () => {
    const daily = series({ 3: { windKmh: 25 } });

    assert.equal(riskOf(assessWeatherRisks(input({ daily })), WIND), undefined);

    const risk = riskOf(
      assessWeatherRisks(input({ daily, sensitivity: { highWindKmh: 20 } })),
      WIND,
    );

    assertWellFormed(risk, WIND);
    assert.equal(risk.thresholdSource, 'REGISTRY');
    assert.equal(risk.data.thresholdKmh, 20);
  });

  /**
   * Wind takes the sensitive-stage bump like every other rule. MID is peak
   * biomass and the most lodging-prone phase, so exempting it would have been
   * an arbitrary asymmetry — and the rule reported `data.stage` as an input
   * either way, which would have made the exemption invisible.
   */
  it('takes the sensitive-stage bump, like every other rule', () => {
    const daily = series({ 3: { windKmh: 80 } });

    const initial = riskOf(assessWeatherRisks(input({ daily })), WIND);
    const mid = riskOf(assessWeatherRisks(input({ daily, stage: 'MID' })), WIND);

    assert.equal(initial.level, 'MEDIUM');
    assert.equal(mid.level, 'HIGH');
    assert.equal(mid.data.stage, 'MID', 'the stage is still reported in the trace data');
  });
});

// ── HUMIDITY_DISEASE · "RH ≥85% + 25–32°C ≥2 days" ──────────────────────────

describe('assessWeatherRisks · HUMIDITY_DISEASE', () => {
  const { HUMIDITY_DISEASE } = WEATHER_RISK_TYPES;

  it('below the humidity threshold there is no risk', () => {
    const result = assessWeatherRisks(
      input({ daily: series({ 2: { humidityPct: 84.9 }, 3: { humidityPct: 84.9 } }) }),
    );

    assert.equal(riskOf(result, HUMIDITY_DISEASE), undefined);
  });

  it('is inclusive at the humidity threshold: exactly 85% on two consecutive days fires', () => {
    const result = assessWeatherRisks(
      input({ daily: series({ 2: { humidityPct: 85 }, 3: { humidityPct: 85 } }) }),
    );
    const risk = riskOf(result, HUMIDITY_DISEASE);

    assertWellFormed(risk, HUMIDITY_DISEASE);
    assert.equal(risk.level, 'LOW'); // exactly the minimum run → band 0
    assert.equal(risk.daysAhead, 2, 'dated from the first day of the window');
    assert.equal(risk.data.consecutiveDays, 2);
  });

  it('needs a run, not a count: one humid day, or two apart, is not a disease window', () => {
    const single = assessWeatherRisks(input({ daily: series({ 3: { humidityPct: 95 } }) }));
    assert.equal(riskOf(single, HUMIDITY_DISEASE), undefined);

    const scattered = assessWeatherRisks(
      input({ daily: series({ 1: { humidityPct: 95 }, 3: { humidityPct: 95 } }) }),
    );
    assert.equal(riskOf(scattered, HUMIDITY_DISEASE), undefined);
  });

  it('a longer run bands higher, and the longest run wins', () => {
    const result = assessWeatherRisks(
      input({
        daily: series({
          0: { humidityPct: 95 },
          2: { humidityPct: 95 },
          3: { humidityPct: 95 },
          4: { humidityPct: 95 },
        }),
      }),
    );
    const risk = riskOf(result, HUMIDITY_DISEASE);

    assertWellFormed(risk, HUMIDITY_DISEASE);
    assert.equal(risk.data.consecutiveDays, 3);
    assert.equal(risk.daysAhead, 2, 'the three-day run, not the isolated day 0');
    assert.equal(risk.level, 'MEDIUM'); // 3 − 2 = band 1
  });

  it('needs the temperature band as well as the humidity, at both of its edges', () => {
    const tooCool = assessWeatherRisks(
      input({
        daily: series({ 2: { humidityPct: 95, tMaxC: 24.9 }, 3: { humidityPct: 95, tMaxC: 24.9 } }),
      }),
    );
    assert.equal(riskOf(tooCool, HUMIDITY_DISEASE), undefined);

    const atLowerEdge = assessWeatherRisks(
      input({
        daily: series({ 2: { humidityPct: 95, tMaxC: 25 }, 3: { humidityPct: 95, tMaxC: 25 } }),
      }),
    );
    assert.ok(riskOf(atLowerEdge, HUMIDITY_DISEASE), '25°C is inside the band');

    const tooWarm = assessWeatherRisks(
      input({
        daily: series({
          2: { humidityPct: 95, tMinC: 32.1, tMaxC: 35 },
          3: { humidityPct: 95, tMinC: 32.1, tMaxC: 35 },
        }),
      }),
    );
    assert.equal(riskOf(tooWarm, HUMIDITY_DISEASE), undefined);

    const atUpperEdge = assessWeatherRisks(
      input({
        daily: series({
          2: { humidityPct: 95, tMinC: 32, tMaxC: 35 },
          3: { humidityPct: 95, tMinC: 32, tMaxC: 35 },
        }),
      }),
    );
    assert.ok(riskOf(atUpperEdge, HUMIDITY_DISEASE), '32°C is inside the band');
  });

  it('carries every day of the window and the band it was judged against (R12)', () => {
    const result = assessWeatherRisks(
      input({ daily: series({ 2: { humidityPct: 95 }, 3: { humidityPct: 95 } }) }),
    );

    assert.deepEqual(riskOf(result, HUMIDITY_DISEASE).data, {
      consecutiveDays: 2,
      humidityThresholdPct: DEFAULT_THRESHOLDS.humidityDiseasePct,
      tempBandC: [RISK_CONSTANTS.DISEASE_TEMP_MIN_C, RISK_CONSTANTS.DISEASE_TEMP_MAX_C],
      days: [
        { date: dayKeyAt(2), humidityPct: 95, tMinC: 20, tMaxC: 30 },
        { date: dayKeyAt(3), humidityPct: 95, tMinC: 20, tMaxC: 30 },
      ],
      stage: 'INITIAL',
    });
  });

  it('a registry threshold overrides the engine default and is labelled REGISTRY', () => {
    const daily = series({ 2: { humidityPct: 65 }, 3: { humidityPct: 65 } });

    assert.equal(riskOf(assessWeatherRisks(input({ daily })), HUMIDITY_DISEASE), undefined);

    const risk = riskOf(
      assessWeatherRisks(input({ daily, sensitivity: { humidityDiseasePct: 60 } })),
      HUMIDITY_DISEASE,
    );

    assertWellFormed(risk, HUMIDITY_DISEASE);
    assert.equal(risk.thresholdSource, 'REGISTRY');
    assert.equal(risk.data.humidityThresholdPct, 60);
  });
});

// ── DRY_SPELL · "7-day past+forecast rain <5mm" ─────────────────────────────

describe('assessWeatherRisks · DRY_SPELL', () => {
  const { DRY_SPELL } = WEATHER_RISK_TYPES;

  it('above the threshold — enough rain — there is no risk', () => {
    const result = assessWeatherRisks(
      input({ daily: series({ all: { rainMm: 0 }, 0: { rainMm: 6 } }) }),
    );

    assert.equal(riskOf(result, DRY_SPELL), undefined);
  });

  it('is exclusive at the threshold: exactly 5mm across the window is not a dry spell', () => {
    const result = assessWeatherRisks(
      input({ daily: series({ all: { rainMm: 0 }, 0: { rainMm: 5 } }) }),
    );

    assert.equal(riskOf(result, DRY_SPELL), undefined);
  });

  it('one tenth of a millimetre under the threshold does fire', () => {
    const result = assessWeatherRisks(
      input({ daily: series({ all: { rainMm: 0 }, 0: { rainMm: 4.9 } }) }),
    );
    const risk = riskOf(result, DRY_SPELL);

    assertWellFormed(risk, DRY_SPELL);
    assert.equal(risk.level, 'LOW'); // 1 − 4.9/5 = band 0.02
    assert.equal(risk.daysAhead, 0, 'a dry spell is a condition of today, not a forecast day');
  });

  it('drier bands higher', () => {
    const result = assessWeatherRisks(input({ daily: series({ all: { rainMm: 0 } }) }));

    assert.equal(riskOf(result, DRY_SPELL).level, 'MEDIUM'); // band 1
  });

  it('carries the numbers behind the verdict (R12)', () => {
    const result = assessWeatherRisks(input({ daily: series({ all: { rainMm: 0 } }) }));

    assert.deepEqual(riskOf(result, DRY_SPELL).data, {
      totalMm: 0,
      thresholdMm: RISK_CONSTANTS.DRY_SPELL_TOTAL_MM,
      // Exactly seven days — three observed, today, three forecast. Summing the
      // whole 14-row series against a threshold calibrated for seven would
      // over-warn, since the band is not normalised by window length.
      windowDays: RISK_CONSTANTS.DRY_SPELL_WINDOW_DAYS,
      stage: 'INITIAL',
    });
  });

  it('refuses to call a drought on a short window rather than under-reporting rain', () => {
    // Three forecast days only: the total is not comparable to the threshold.
    const result = assessWeatherRisks(
      input({ daily: series({ all: { rainMm: 0 } }).slice(7, 10) }),
    );

    assert.equal(riskOf(result, DRY_SPELL), undefined);
    assert.equal(result.reasonCode, RISK_REASONS.NO_RISK_DETECTED);
  });

  it('refuses to call a drought when a day in the window has no rain reading', () => {
    const result = assessWeatherRisks(
      input({ daily: series({ all: { rainMm: 0 }, '-3': { rainMm: null } }) }),
    );

    assert.equal(riskOf(result, DRY_SPELL), undefined);
  });

  it('has no registry override, so it is always labelled ENGINE_DEFAULT', () => {
    // `sensitivity` publishes no dry-spell field; the honest label says so even
    // when the crop supplies every other threshold.
    const result = assessWeatherRisks(
      input({
        daily: series({ all: { rainMm: 0 } }),
        sensitivity: { frostTminC: 2, heatTmaxC: 40, heavyRainMm24h: 60, highWindKmh: 50 },
      }),
    );

    assert.equal(riskOf(result, DRY_SPELL).thresholdSource, 'ENGINE_DEFAULT');
  });
});

// ── Missing weather ─────────────────────────────────────────────────────────

describe('assessWeatherRisks · missing weather is a state, not a throw', () => {
  it('an empty, absent or malformed daily series yields NO_WEATHER', () => {
    for (const daily of [[], undefined, null, 'nope', 42, {}, { 0: { rainMm: 1 } }]) {
      const result = assessWeatherRisks(input({ daily }));

      assert.equal(result.hasRisks, false, `accepted ${JSON.stringify(daily)}`);
      assert.deepEqual(result.risks, []);
      assert.equal(result.reasonCode, RISK_REASONS.NO_WEATHER);
      assert.equal(result.trace.at(-1).step, RISK_TRACE_STEPS.NO_VERDICT);
      assert.equal(result.trace.at(-1).reasonCode, RISK_REASONS.NO_WEATHER);
    }
  });

  it('an unreadable asOf takes the same no-verdict path', () => {
    for (const asOf of [undefined, null, '2026-08-13', Date.now()]) {
      const result = assessWeatherRisks(input({ asOf }));

      assert.equal(result.hasRisks, false, `accepted ${String(asOf)}`);
      assert.equal(result.reasonCode, RISK_REASONS.NO_WEATHER);
    }
  });

  it('survives being called with nothing at all', () => {
    const result = assessWeatherRisks();

    assert.equal(result.hasRisks, false);
    assert.equal(result.reasonCode, RISK_REASONS.NO_WEATHER);
    assert.ok(Array.isArray(result.trace));
    assert.equal(result.trace[0].step, RISK_TRACE_STEPS.INPUT);
  });

  it('a past-only series has nothing to forecast and says which gap it hit', () => {
    const result = assessWeatherRisks(input({ daily: series().slice(0, 7) }));

    assert.equal(result.hasRisks, false);
    assert.equal(result.reasonCode, RISK_REASONS.NO_FORECAST_DAYS);
    assert.equal(stepOf(result, RISK_TRACE_STEPS.WINDOW).forecastDays, 0);
    assert.equal(result.trace.at(-1).step, RISK_TRACE_STEPS.NO_VERDICT);
  });
});

// ── Crop status and stage ───────────────────────────────────────────────────

describe('assessWeatherRisks · crop status gate', () => {
  it('a planned or harvested crop has nothing in the ground to be at risk', () => {
    for (const cropStatus of ['planned', 'harvested']) {
      const result = assessWeatherRisks(
        input({ cropStatus, daily: series({ 3: { tMinC: -5, tMaxC: 45 } }) }),
      );

      assert.equal(result.hasRisks, false, `${cropStatus} produced risks`);
      assert.deepEqual(result.risks, []);
      assert.equal(result.reasonCode, RISK_REASONS.CROP_NOT_ACTIVE);
      assert.equal(result.trace.at(-1).step, RISK_TRACE_STEPS.NO_VERDICT);
    }
  });

  it('the status gate runs before any weather evaluation', () => {
    const result = assessWeatherRisks(input({ cropStatus: 'planned' }));

    assert.equal(stepOf(result, RISK_TRACE_STEPS.THRESHOLDS), undefined);
    assert.equal(stepOf(result, RISK_TRACE_STEPS.EVALUATION), undefined);
  });

  it('a farm-level assessment passes no status and is not gated', () => {
    const result = assessWeatherRisks(
      input({ cropStatus: undefined, daily: series({ 3: { tMaxC: 42 } }) }),
    );

    assert.equal(result.hasRisks, true);
    assert.ok(riskOf(result, WEATHER_RISK_TYPES.HEAT));
  });
});

describe('assessWeatherRisks · stage and registry gaps', () => {
  it('an unknown stage still gets its risks, just no sensitive-stage bump', () => {
    const daily = series({ 3: { tMaxC: 40 } });

    const known = riskOf(assessWeatherRisks(input({ daily })), WEATHER_RISK_TYPES.HEAT);
    const unknown = riskOf(
      assessWeatherRisks(input({ daily, stage: 'FLOWERING' })),
      WEATHER_RISK_TYPES.HEAT,
    );

    assertWellFormed(unknown, WEATHER_RISK_TYPES.HEAT);
    assert.equal(unknown.level, known.level);
    assert.equal(unknown.data.stage, 'FLOWERING');
  });

  it('a missing stage is not an error either', () => {
    const result = assessWeatherRisks(
      input({ stage: undefined, daily: series({ 3: { tMaxC: 40 } }) }),
    );

    assert.equal(result.hasRisks, true);
    assert.equal(riskOf(result, WEATHER_RISK_TYPES.HEAT).data.stage, undefined);
    assert.equal(stepOf(result, RISK_TRACE_STEPS.INPUT).stage, null);
  });

  it('a registry document with no sensitivity block at all works on the defaults', () => {
    for (const sensitivity of [undefined, null, {}]) {
      const result = assessWeatherRisks(
        input({ sensitivity, daily: series({ 3: { tMaxC: 42 } }) }),
      );
      const risk = riskOf(result, WEATHER_RISK_TYPES.HEAT);

      assertWellFormed(risk, WEATHER_RISK_TYPES.HEAT);
      assert.equal(risk.thresholdSource, 'ENGINE_DEFAULT');
      assert.equal(risk.data.thresholdC, DEFAULT_THRESHOLDS.heatTmaxC);
      assert.equal(stepOf(result, RISK_TRACE_STEPS.INPUT).hasRegistrySensitivity, false);
    }
  });

  it('records that a registry sensitivity was supplied', () => {
    const result = assessWeatherRisks(input({ sensitivity: { heatTmaxC: 33 } }));

    assert.equal(stepOf(result, RISK_TRACE_STEPS.INPUT).hasRegistrySensitivity, true);
  });
});

// ── Severity inputs: imminence and stage sensitivity ────────────────────────

describe('assessWeatherRisks · imminence raises severity', () => {
  it('the same magnitude nearer in time never bands lower than one further out', () => {
    const levelAt = (offset) =>
      riskOf(
        assessWeatherRisks(input({ daily: series({ [offset]: { tMaxC: 40 } }) })),
        WEATHER_RISK_TYPES.HEAT,
      ).level;

    const tomorrow = levelAt(1);
    const midWeek = levelAt(3);
    const farOut = levelAt(6);

    assert.equal(tomorrow, 'HIGH'); // band 1 + 1
    assert.equal(midWeek, 'MEDIUM'); // band 1 + 0
    assert.equal(farOut, 'LOW'); // band 1 − 1
    assert.ok(rank(tomorrow) >= rank(midWeek));
    assert.ok(rank(midWeek) >= rank(farOut));
  });
});

describe('assessWeatherRisks · sensitive stages raise severity', () => {
  it('MID never bands lower than INITIAL for the same weather', () => {
    const daily = series({
      1: { rainMm: 60, rainProbPct: 80 },
      2: { tMaxC: 40 },
      3: { tMinC: 3 },
      4: { windKmh: 80 },
    });

    const initial = assessWeatherRisks(input({ daily, stage: 'INITIAL' }));
    const mid = assessWeatherRisks(input({ daily, stage: 'MID' }));

    assert.equal(initial.risks.length, mid.risks.length);
    for (const risk of initial.risks) {
      const bumped = riskOf(mid, risk.type);
      assert.ok(
        rank(bumped.level) >= rank(risk.level),
        `${risk.type} fell from ${risk.level} to ${bumped.level} at MID`,
      );
    }

    // The bump is at most one band, and it is a step, not a doubling.
    assert.equal(riskOf(initial, WEATHER_RISK_TYPES.HEAT).level, 'MEDIUM');
    assert.equal(riskOf(mid, WEATHER_RISK_TYPES.HEAT).level, 'HIGH');
  });
});

// ── Ordering and determinism ────────────────────────────────────────────────

describe('assessWeatherRisks · risk ordering is deterministic', () => {
  it('sorts worst level first, then soonest', () => {
    const result = assessWeatherRisks(
      input({
        daily: series({
          1: { rainMm: 50, rainProbPct: 80 }, // band 0 + imminence 1 → MEDIUM
          2: { tMaxC: 42 }, //                   band 2             → HIGH
          3: { tMinC: -2 }, //                   band 4, clamped    → CRITICAL
          5: { windKmh: 80 }, //                 band 1             → MEDIUM
        }),
      }),
    );

    assert.deepEqual(typesOf(result), ['FROST', 'HEAT', 'HEAVY_RAIN', 'WIND']);
    assert.deepEqual(
      result.risks.map((risk) => risk.level),
      ['CRITICAL', 'HIGH', 'MEDIUM', 'MEDIUM'],
    );
    // The two MEDIUMs are separated by imminence, not by type order.
    assert.deepEqual(
      result.risks.slice(2).map((risk) => risk.daysAhead),
      [1, 5],
    );
  });

  it('breaks a level-and-day tie with the fixed type order', () => {
    const result = assessWeatherRisks(
      input({ daily: series({ 2: { rainMm: 100, rainProbPct: 80, tMaxC: 40, windKmh: 80 } }) }),
    );

    assert.equal(result.risks.length, 3);
    assert.deepEqual(typesOf(result), ['HEAVY_RAIN', 'HEAT', 'WIND']);
    for (const risk of result.risks) {
      assert.equal(risk.level, 'MEDIUM');
      assert.equal(risk.daysAhead, 2);
    }
    // …which is exactly the order the type constant publishes.
    const published = Object.values(WEATHER_RISK_TYPES);
    assert.deepEqual(
      typesOf(result),
      published.filter((type) => typesOf(result).includes(type)),
    );
  });

  it('is deterministic: identical inputs give a deeply equal result', () => {
    const fixture = input({
      daily: series({ 1: { rainMm: 90, rainProbPct: 70 }, 3: { tMinC: 1 }, 5: { windKmh: 65 } }),
      sensitivity: { heatTmaxC: 36 },
      stage: 'MID',
    });

    assert.deepEqual(assessWeatherRisks(fixture), assessWeatherRisks(fixture));
    assert.deepEqual(assessWeatherRisks(input()), assessWeatherRisks(input()));
  });
});

// ── R12 · trace ─────────────────────────────────────────────────────────────

describe('assessWeatherRisks · trace (R12)', () => {
  it('opens with the inputs and closes with the evaluation', () => {
    const result = assessWeatherRisks(input({ daily: series({ 3: { tMaxC: 42 } }) }));

    assert.deepEqual(
      result.trace.map((entry) => entry.step),
      [
        RISK_TRACE_STEPS.INPUT,
        RISK_TRACE_STEPS.THRESHOLDS,
        RISK_TRACE_STEPS.WINDOW,
        RISK_TRACE_STEPS.EVALUATION,
      ],
    );

    assert.deepEqual(result.trace[0], {
      step: 'INPUT',
      dayCount: 14,
      stage: 'INITIAL',
      cropStatus: 'active',
      asOf: '2026-08-13T06:00:00.000Z',
      hasRegistrySensitivity: false,
    });
  });

  it('lists every threshold with the source it came from', () => {
    const result = assessWeatherRisks(input({ sensitivity: { frostTminC: 8, heatTmaxC: 33 } }));
    const { thresholds } = stepOf(result, RISK_TRACE_STEPS.THRESHOLDS);

    assert.deepEqual(Object.keys(thresholds).sort(), Object.keys(DEFAULT_THRESHOLDS).sort());
    assert.deepEqual(thresholds, {
      heavyRainMm24h: { value: 50, source: 'ENGINE_DEFAULT' },
      heatTmaxC: { value: 33, source: 'REGISTRY' },
      frostTminC: { value: 8, source: 'REGISTRY' },
      highWindKmh: { value: 40, source: 'ENGINE_DEFAULT' },
      humidityDiseasePct: { value: 85, source: 'ENGINE_DEFAULT' },
    });
  });

  it('publishes the window it looked at, past and forecast separated', () => {
    const result = assessWeatherRisks(input());

    assert.deepEqual(stepOf(result, RISK_TRACE_STEPS.WINDOW), {
      step: 'WINDOW',
      forecastDays: 7,
      pastDays: 7,
      horizonDays: RISK_CONSTANTS.HORIZON_DAYS,
    });
  });

  it('names what was evaluated and what fired, in the order it is returned', () => {
    const result = assessWeatherRisks(
      input({ daily: series({ 2: { tMaxC: 42 }, 3: { tMinC: -2 } }) }),
    );
    const evaluation = stepOf(result, RISK_TRACE_STEPS.EVALUATION);

    assert.equal(evaluation.evaluated, Object.keys(WEATHER_RISK_TYPES).length);
    assert.deepEqual(evaluation.triggered, [
      { type: 'FROST', level: 'CRITICAL' },
      { type: 'HEAT', level: 'HIGH' },
    ]);
  });

  it('is structured data, not prose, and every no-verdict path ends with its reason', () => {
    const cases = [
      input({ daily: [] }),
      input({ asOf: 'sometime' }),
      input({ cropStatus: 'harvested' }),
      input({ daily: series().slice(0, 7) }),
      input(),
    ];

    for (const fixture of cases) {
      const result = assessWeatherRisks(fixture);
      const last = result.trace.at(-1);

      assert.equal(last.step, RISK_TRACE_STEPS.NO_VERDICT);
      assert.equal(last.reasonCode, result.reasonCode);
      for (const entry of result.trace) {
        assert.equal(typeof entry, 'object');
        assert.equal(typeof entry.step, 'string');
      }
    }
  });

  it('only ever returns a code drawn from the exported set', () => {
    const codes = new Set(Object.values(RISK_REASONS));
    const cases = [
      input({ daily: [] }),
      input({ daily: 'nope' }),
      input({ cropStatus: 'planned' }),
      input({ daily: series().slice(0, 7) }),
      input(),
      input({ daily: series({ 3: { tMaxC: 42 } }) }),
    ];

    for (const fixture of cases) {
      const { reasonCode } = assessWeatherRisks(fixture);
      if (reasonCode === undefined) continue; // a verdict carries no reason code
      assert.ok(codes.has(reasonCode), `unknown reason code ${reasonCode}`);
    }
  });

  it('reason codes are UPPER_SNAKE and match their keys', () => {
    for (const [key, value] of Object.entries(RISK_REASONS)) {
      assert.equal(key, value);
      assert.match(value, /^[A-Z][A-Z_]*[A-Z]$/);
    }
    assert.ok(Object.isFrozen(RISK_REASONS));
    assert.ok(Object.isFrozen(RISK_TRACE_STEPS));
    assert.ok(Object.isFrozen(DEFAULT_THRESHOLDS));
    assert.ok(Object.isFrozen(RISK_CONSTANTS));
  });
});

// ── Purity ──────────────────────────────────────────────────────────────────

describe('assessWeatherRisks · purity', () => {
  /** Freezes the whole graph so any write would throw under ESM strict mode. */
  const deepFreeze = (value) => {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.freeze(value);
      for (const key of Object.getOwnPropertyNames(value)) deepFreeze(value[key]);
    }
    return value;
  };

  it('does not mutate the inputs it is handed, even when they are frozen', () => {
    const fixture = {
      daily: series({ 1: { rainMm: 90, rainProbPct: 70 }, 3: { tMinC: 1 }, 5: { windKmh: 65 } }),
      sensitivity: { heatTmaxC: 33, frostTminC: 6 },
      stage: 'MID',
      cropStatus: 'active',
      asOf: new Date(AS_OF),
    };
    const snapshot = structuredClone(fixture);
    deepFreeze(fixture);

    const result = assessWeatherRisks(fixture);

    assert.equal(result.hasRisks, true, 'the frozen fixture still produced a verdict');
    assert.deepEqual(fixture, snapshot);
    assert.deepEqual(
      fixture.daily.map((day) => day.date.getTime()),
      snapshot.daily.map((day) => day.date.getTime()),
    );
    assert.equal(fixture.asOf.getTime(), AS_OF.getTime());
    assert.equal(
      Object.hasOwn(fixture.daily[0], 'daysAhead'),
      false,
      'daysAhead leaked into the input',
    );
  });

  it('does not reorder the caller’s array while sorting its own copy', () => {
    const daily = series({ 3: { tMaxC: 42 } });
    const order = daily.map((day) => day.date.getTime());

    assessWeatherRisks(input({ daily }));

    assert.deepEqual(
      daily.map((day) => day.date.getTime()),
      order,
    );
  });

  it('holds no state between calls: a risky call does not colour the next benign one', () => {
    assessWeatherRisks(input({ daily: series({ 3: { tMinC: -5 } }) }));
    const benign = assessWeatherRisks(input());

    assert.equal(benign.hasRisks, false);
    assert.deepEqual(benign.risks, []);
    assert.equal(benign.reasonCode, RISK_REASONS.NO_RISK_DETECTED);
  });
});
