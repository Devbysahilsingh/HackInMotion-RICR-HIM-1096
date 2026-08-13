/**
 * Feed composer — engine unit tests (pure).
 *
 * Spec: docs/irrigation/recommendation-engine.md (titled "Central Recommendation
 * Engine (feed composer)" — the file is misfiled under irrigation/) and
 * docs/api/recommendations.md.
 *
 * The composer imports nothing above utils/constants (CLAUDE.md rule 5), so
 * every case here is fixture in / object out: no database, no server, no clock.
 * `asOf` is always passed explicitly — this project has no fake timers
 * (ADR-022) — and it is always the same literal instant, so every expectation
 * below is a value rather than a computation.
 *
 * Ids are plain strings. The composer only ever `String()`s them, and using
 * ObjectIds here would imply a database the engine never touches.
 *
 * Fixture verdicts, risk levels and trends are shaped like the engines' real
 * output. They are not agronomic claims.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { FEED_MAX_ACTIVE_PER_USER, FEED_PRIORITY_RANK } from '../../src/config/constants.js';
import {
  composeFeed,
  dedupKeyFor,
  FEED_TYPES,
  irrigationCandidate,
  isActive,
  marketCandidate,
  PRIORITIES,
  resolveContradictions,
  SOURCES,
  validUntilFor,
  weatherRiskCandidate,
} from '../../src/engines/feedComposer/feedComposer.js';
import { endOfDay } from '../../src/utils/day.js';

// ── Fixtures ────────────────────────────────────────────────────────────────

/** 12:00 IST on 13 August 2026. One instant for the whole file. */
const ASOF = new Date('2026-08-13T06:30:00.000Z');

const USER = 'user-alice';
const FARM = 'farm-north';
const CROP_A = 'crop-wheat';
const CROP_B = 'crop-tomato';

const MS_PER_DAY = 86_400_000;

/**
 * A candidate the composer will accept. The default carries no
 * `data.verdict`/`data.riskType`, so it matches no contradiction rule unless a
 * case opts in.
 */
const candidate = (overrides = {}) => ({
  userId: USER,
  farmId: FARM,
  cropId: CROP_A,
  type: FEED_TYPES.IRRIGATION,
  priority: PRIORITIES.MEDIUM,
  source: SOURCES.RULE_ENGINE,
  titleKey: 'irrigation.titleIRRIGATE_IN_N_DAYS',
  bodyKey: 'irrigation.bodyIRRIGATE_IN_N_DAYS',
  discriminator: 'IRRIGATE_IN_N_DAYS',
  data: { trace: [{ step: 'INPUT' }] },
  validUntil: validUntilFor({ type: FEED_TYPES.IRRIGATION, asOf: ASOF }),
  ...overrides,
});

/** A weather-risk candidate, which the composer orders ahead of irrigation. */
const riskCandidate = (overrides = {}) =>
  candidate({
    type: FEED_TYPES.WEATHER_RISK,
    source: SOURCES.WEATHER,
    priority: PRIORITIES.HIGH,
    titleKey: 'weather.titleFROST',
    bodyKey: 'weather.bodyFROST',
    discriminator: 'FROST',
    data: { riskType: 'FROST', trace: { tMinC: 1 } },
    ...overrides,
  });

/** Deterministic shuffle — a seeded LCG, so a failure is reproducible. */
function shuffle(items, seed) {
  const copy = [...items];
  let state = seed;
  for (let i = copy.length - 1; i > 0; i -= 1) {
    state = (state * 1103515245 + 12345) % 2147483648;
    const j = state % (i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

const keysOf = (result) => result.items.map((item) => item.dedupKey);
const prioritiesOf = (result) => result.items.map((item) => item.priority);

/** Freezes an object and everything reachable from it. */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const entry of Object.values(value)) deepFreeze(entry);
  return value;
}

// ── Ordering ────────────────────────────────────────────────────────────────

describe('composeFeed · priority ordering', () => {
  it('returns CRITICAL → HIGH → MEDIUM → INFO whatever order the candidates arrive in', () => {
    const candidates = [
      riskCandidate({ cropId: 'crop-info', priority: PRIORITIES.INFO, discriminator: 'WIND' }),
      riskCandidate({ cropId: 'crop-critical', priority: PRIORITIES.CRITICAL }),
      candidate({ cropId: 'crop-medium', priority: PRIORITIES.MEDIUM }),
      riskCandidate({ cropId: 'crop-high', priority: PRIORITIES.HIGH }),
    ];

    for (const seed of [1, 7, 99, 12_345]) {
      const result = composeFeed({ candidates: shuffle(candidates, seed), asOf: ASOF });
      assert.deepEqual(prioritiesOf(result), ['CRITICAL', 'HIGH', 'MEDIUM', 'INFO']);
    }
  });

  /**
   * The trap the composer exists to avoid: the `feed` index sorts `priority: 1`
   * — the strings ascending — and 'INFO' sorts before 'MEDIUM'. A naive
   * index-order feed would show a tip above a "irrigate this week" item.
   */
  it('puts MEDIUM above INFO, which the naive string sort gets backwards', () => {
    assert.ok('INFO'.localeCompare('MEDIUM') < 0, 'premise: INFO sorts first alphabetically');
    assert.ok(
      FEED_PRIORITY_RANK.MEDIUM < FEED_PRIORITY_RANK.INFO,
      'the rank map must contradict the alphabet',
    );

    const info = candidate({ cropId: 'crop-info', priority: PRIORITIES.INFO });
    const medium = candidate({ cropId: 'crop-medium', priority: PRIORITIES.MEDIUM });

    assert.deepEqual(prioritiesOf(composeFeed({ candidates: [info, medium], asOf: ASOF })), [
      'MEDIUM',
      'INFO',
    ]);
    assert.deepEqual(prioritiesOf(composeFeed({ candidates: [medium, info], asOf: ASOF })), [
      'MEDIUM',
      'INFO',
    ]);
  });

  it('orders weather risk ahead of irrigation ahead of market at equal priority', () => {
    const candidates = [
      candidate({
        cropId: CROP_A,
        type: FEED_TYPES.MARKET,
        source: SOURCES.MARKET,
        priority: PRIORITIES.MEDIUM,
        discriminator: 'WHEAT:RISING',
      }),
      candidate({ cropId: CROP_A, priority: PRIORITIES.MEDIUM }),
      riskCandidate({ cropId: CROP_A, priority: PRIORITIES.MEDIUM, discriminator: 'WIND' }),
    ];

    const result = composeFeed({ candidates: shuffle(candidates, 3), asOf: ASOF });

    assert.deepEqual(
      result.items.map((item) => item.type),
      ['weather-risk', 'irrigation', 'market'],
    );
  });

  it('is a TOTAL order: same priority and same type still order identically every run', () => {
    // Two items that tie on priority AND type, so only the final tiebreak can
    // separate them. Without one, two documents written in the same
    // millisecond would render in a different order on every request.
    const candidates = [
      candidate({ cropId: CROP_A, priority: PRIORITIES.HIGH }),
      candidate({ cropId: CROP_B, priority: PRIORITIES.HIGH }),
      riskCandidate({ cropId: CROP_A, priority: PRIORITIES.HIGH, discriminator: 'FROST' }),
      riskCandidate({ cropId: CROP_B, priority: PRIORITIES.HIGH, discriminator: 'FROST' }),
    ];

    const expected = keysOf(composeFeed({ candidates, asOf: ASOF }));
    assert.equal(expected.length, 4);
    assert.equal(new Set(expected).size, 4);

    for (let run = 0; run < 10; run += 1) {
      const result = composeFeed({ candidates: shuffle(candidates, run + 1), asOf: ASOF });
      assert.deepEqual(keysOf(result), expected, `run ${run} produced a different order`);
    }
  });

  it('reports nothing to drop when nothing collides or overflows', () => {
    const result = composeFeed({
      candidates: [candidate({ cropId: CROP_A }), candidate({ cropId: CROP_B })],
      asOf: ASOF,
    });

    assert.deepEqual(result.dropped, { duplicates: 0, capped: 0 });
  });

  it('survives being called with nothing at all', () => {
    assert.deepEqual(composeFeed(), { items: [], dropped: { duplicates: 0, capped: 0 } });
    assert.deepEqual(composeFeed({ candidates: [], asOf: ASOF }).items, []);
  });
});

// ── Dedup ───────────────────────────────────────────────────────────────────

describe('composeFeed · deduplication', () => {
  it('collapses two candidates sharing user, type, crop, discriminator and day', () => {
    const first = candidate({ priority: PRIORITIES.MEDIUM });
    const second = candidate({ priority: PRIORITIES.MEDIUM, bodyKey: 'irrigation.bodyOther' });

    const result = composeFeed({ candidates: [first, second], asOf: ASOF });

    assert.equal(result.items.length, 1);
    assert.equal(result.dropped.duplicates, 1);
    assert.equal(
      result.items[0].dedupKey,
      dedupKeyFor({
        userId: USER,
        type: FEED_TYPES.IRRIGATION,
        cropId: CROP_A,
        farmId: FARM,
        discriminator: 'IRRIGATE_IN_N_DAYS',
        asOf: ASOF,
      }),
    );
  });

  it('keeps the HIGHER-priority item when two collide, whichever arrived first', () => {
    const low = candidate({ priority: PRIORITIES.INFO, bodyKey: 'irrigation.bodyLow' });
    const high = candidate({ priority: PRIORITIES.CRITICAL, bodyKey: 'irrigation.bodyHigh' });

    for (const order of [
      [low, high],
      [high, low],
    ]) {
      const result = composeFeed({ candidates: order, asOf: ASOF });

      assert.equal(result.items.length, 1);
      assert.equal(result.dropped.duplicates, 1);
      assert.equal(result.items[0].priority, 'CRITICAL');
      assert.equal(result.items[0].bodyKey, 'irrigation.bodyHigh');
    }
  });

  it('keeps two weather risks of DIFFERENT type on the same crop and day apart', () => {
    // The discriminator's whole purpose: "dedupe type+cropId+day" alone would
    // silently lose one of a simultaneous frost and heavy rain.
    const frost = weatherRiskCandidate({
      userId: USER,
      farmId: FARM,
      cropId: CROP_A,
      cropCode: 'WHEAT',
      risk: { type: 'FROST', level: 'HIGH', daysAhead: 1, date: '2026-08-14', data: { tMinC: 1 } },
      asOf: ASOF,
    });
    const rain = weatherRiskCandidate({
      userId: USER,
      farmId: FARM,
      cropId: CROP_A,
      cropCode: 'WHEAT',
      risk: {
        type: 'HEAVY_RAIN',
        level: 'HIGH',
        daysAhead: 1,
        date: '2026-08-14',
        data: { rainMm: 80 },
      },
      asOf: ASOF,
    });

    const result = composeFeed({ candidates: [frost, rain], asOf: ASOF });

    assert.equal(result.items.length, 2);
    assert.equal(result.dropped.duplicates, 0);
    assert.deepEqual(result.items.map((item) => item.data.riskType).sort(), [
      'FROST',
      'HEAVY_RAIN',
    ]);
  });

  it('keeps a farm-level item and a crop-level item of the same type apart', () => {
    const farmLevel = candidate({ cropId: undefined });
    const cropLevel = candidate({ cropId: CROP_A });

    const result = composeFeed({ candidates: [farmLevel, cropLevel], asOf: ASOF });

    assert.equal(result.items.length, 2);
    assert.equal(result.dropped.duplicates, 0);

    const keys = keysOf(result);
    assert.ok(
      keys.some((key) => key.includes(`|farm:${FARM}|`)),
      'the farm-level key lost its farm segment',
    );
    assert.ok(keys.some((key) => key.includes(`|${CROP_A}|`)));
  });

  it('never collides across accounts, days or types', () => {
    const base = {
      userId: USER,
      type: FEED_TYPES.IRRIGATION,
      cropId: CROP_A,
      farmId: FARM,
      discriminator: 'IRRIGATE_TODAY',
      asOf: ASOF,
    };
    const key = dedupKeyFor(base);

    assert.notEqual(key, dedupKeyFor({ ...base, userId: 'user-bob' }));
    assert.notEqual(key, dedupKeyFor({ ...base, type: FEED_TYPES.WEATHER_RISK }));
    assert.notEqual(key, dedupKeyFor({ ...base, cropId: CROP_B }));
    assert.notEqual(key, dedupKeyFor({ ...base, discriminator: 'IRRIGATE_IN_N_DAYS' }));
    assert.notEqual(
      key,
      dedupKeyFor({ ...base, asOf: new Date(ASOF.getTime() + MS_PER_DAY) }),
      'tomorrow shares today’s key',
    );

    // The day segment is the IST day, not the host day.
    assert.equal(key, `${USER}|irrigation|${CROP_A}|IRRIGATE_TODAY|2026-08-13`);
  });
});

// ── validUntil / isActive ───────────────────────────────────────────────────

describe('validUntilFor · expiry per type', () => {
  it('irrigation lapses at the end of the day (recommendation-engine.md: "irrigation EOD")', () => {
    const until = validUntilFor({ type: FEED_TYPES.IRRIGATION, asOf: ASOF });

    // 18:29:59.999Z is 23:59:59.999 IST. Stamping 23:59:59.999 **UTC** onto the
    // IST calendar date — as this once did — lands at 05:29 IST the following
    // morning, keeping "irrigate today" live 5h30m into the next day and
    // overlapping the next day's dedup key.
    assert.equal(until.toISOString(), '2026-08-13T18:29:59.999Z');
    assert.equal(until.getTime(), endOfDay(ASOF).getTime());
  });

  it('a weather risk lapses on the day of the event, not the day it was raised', () => {
    const until = validUntilFor({
      type: FEED_TYPES.WEATHER_RISK,
      asOf: ASOF,
      eventDate: '2026-08-16',
    });

    assert.equal(until.toISOString(), '2026-08-16T18:29:59.999Z');
  });

  it('a weather risk with no event date falls back to today', () => {
    const until = validUntilFor({ type: FEED_TYPES.WEATHER_RISK, asOf: ASOF });
    assert.equal(until.toISOString(), '2026-08-13T18:29:59.999Z');
  });

  it('a market item lasts 48 hours from asOf ("market 48h")', () => {
    const until = validUntilFor({ type: FEED_TYPES.MARKET, asOf: ASOF });

    assert.equal(until.getTime() - ASOF.getTime(), 2 * MS_PER_DAY);
    assert.equal(until.toISOString(), '2026-08-15T06:30:00.000Z');
  });

  it('an unlisted type defaults to one day, or to the days it is given', () => {
    assert.equal(
      validUntilFor({ type: 'health', asOf: ASOF }).getTime() - ASOF.getTime(),
      MS_PER_DAY,
    );
    assert.equal(
      validUntilFor({ type: 'health', asOf: ASOF, days: 5 }).getTime() - ASOF.getTime(),
      5 * MS_PER_DAY,
    );
  });
});

describe('isActive · the query-time expiry predicate', () => {
  const future = new Date(ASOF.getTime() + MS_PER_DAY);
  const past = new Date(ASOF.getTime() - 1);

  it('is true only for an unacknowledged item that has not lapsed', () => {
    assert.equal(isActive({ validUntil: future }, ASOF), true);
  });

  it('is false for an acknowledged item, however long it has left', () => {
    assert.equal(isActive({ validUntil: future, acknowledgedAt: ASOF }, ASOF), false);
  });

  it('is false past validUntil, and at the boundary itself', () => {
    assert.equal(isActive({ validUntil: past }, ASOF), false);
    assert.equal(isActive({ validUntil: ASOF }, ASOF), false, 'the boundary is exclusive');
  });

  it('accepts an ISO string as readily as a Date', () => {
    assert.equal(isActive({ validUntil: future.toISOString() }, ASOF), true);
    assert.equal(isActive({ validUntil: past.toISOString() }, ASOF), false);
  });
});

// ── Cap ─────────────────────────────────────────────────────────────────────

describe('composeFeed · the 20-item cap evicts INFO first', () => {
  /** 2 CRITICAL + 3 HIGH + 5 MEDIUM + 20 INFO, each on its own crop. */
  const overflowing = () => {
    const build = (priority, count, offset) =>
      Array.from({ length: count }, (_, index) =>
        priority === PRIORITIES.CRITICAL || priority === PRIORITIES.HIGH
          ? riskCandidate({ cropId: `crop-${offset + index}`, priority })
          : candidate({ cropId: `crop-${offset + index}`, priority }),
      );

    return [
      ...build(PRIORITIES.CRITICAL, 2, 0),
      ...build(PRIORITIES.HIGH, 3, 100),
      ...build(PRIORITIES.MEDIUM, 5, 200),
      ...build(PRIORITIES.INFO, 20, 300),
    ];
  };

  it('slices to the cap and reports the remainder rather than dropping it silently', () => {
    const candidates = overflowing();
    assert.equal(candidates.length, 30);

    const result = composeFeed({ candidates: shuffle(candidates, 42), asOf: ASOF });

    assert.equal(result.items.length, FEED_MAX_ACTIVE_PER_USER);
    assert.equal(result.dropped.capped, 30 - FEED_MAX_ACTIVE_PER_USER);
    assert.equal(result.dropped.duplicates, 0);
  });

  it('evicts only INFO — no CRITICAL, HIGH or MEDIUM item is ever lost to the cap', () => {
    const candidates = overflowing();
    const result = composeFeed({ candidates: shuffle(candidates, 7), asOf: ASOF });

    const kept = prioritiesOf(result);
    assert.equal(kept.filter((priority) => priority === 'CRITICAL').length, 2);
    assert.equal(kept.filter((priority) => priority === 'HIGH').length, 3);
    assert.equal(kept.filter((priority) => priority === 'MEDIUM').length, 5);
    assert.equal(kept.filter((priority) => priority === 'INFO').length, 10);

    // Stated the other way round: every item that did not survive is INFO.
    const survivors = new Set(keysOf(result));
    const evicted = candidates.filter(
      (item) => !survivors.has(dedupKeyFor({ ...item, asOf: ASOF })),
    );
    assert.equal(evicted.length, 10);
    for (const item of evicted) {
      assert.equal(item.priority, 'INFO', 'a non-INFO item was evicted by the cap');
    }
  });

  it('does not cap a feed that exactly fills it', () => {
    const candidates = Array.from({ length: FEED_MAX_ACTIVE_PER_USER }, (_, index) =>
      candidate({ cropId: `crop-${index}` }),
    );

    const result = composeFeed({ candidates, asOf: ASOF });

    assert.equal(result.items.length, FEED_MAX_ACTIVE_PER_USER);
    assert.equal(result.dropped.capped, 0);
  });
});

// ── Contradictions ──────────────────────────────────────────────────────────

describe('resolveContradictions · heavy rain versus irrigate today', () => {
  const irrigateToday = (cropId) =>
    irrigationCandidate({
      userId: USER,
      farmId: FARM,
      cropId,
      cropCode: 'WHEAT',
      result: {
        hasVerdict: true,
        verdict: 'IRRIGATE_TODAY',
        amountMm: 30,
        amountLitersPerAcre: 121_406,
        mode: 'FULL',
        stage: 'MID',
        trace: [{ step: 'VERDICT', verdict: 'IRRIGATE_TODAY' }],
      },
      asOf: ASOF,
    });

  const heavyRain = (cropId) =>
    weatherRiskCandidate({
      userId: USER,
      farmId: FARM,
      cropId,
      cropCode: 'WHEAT',
      risk: {
        type: 'HEAVY_RAIN',
        level: 'CRITICAL',
        daysAhead: 0,
        date: '2026-08-13',
        thresholdSource: 'REGISTRY',
        data: { rainMm: 120, thresholdMm: 50 },
      },
      asOf: ASOF,
    });

  it('replaces the pair on ONE crop with a single HYBRID hold-for-rain item', () => {
    const result = composeFeed({
      candidates: [irrigateToday(CROP_A), heavyRain(CROP_A)],
      asOf: ASOF,
    });

    assert.equal(result.items.length, 1, 'the farmer was given two opposing instructions');

    const [item] = result.items;
    assert.equal(item.source, SOURCES.HYBRID);
    assert.equal(item.titleKey, 'irrigation.titleHoldForRain');
    assert.equal(item.bodyKey, 'irrigation.bodyHoldForRain');
    // The rain is the more urgent fact and sets the level.
    assert.equal(item.priority, PRIORITIES.CRITICAL);
    assert.equal(item.cropId, CROP_A);
    assert.deepEqual(item.data.supersedes, ['IRRIGATE_TODAY', 'HEAVY_RAIN']);
    // The rain item's whole payload travels with the merge, trace included, so
    // the "why?" expander can still show what the irrigation was held for.
    assert.equal(item.data.rain.riskType, 'HEAVY_RAIN');
    assert.equal(item.data.rain.level, 'CRITICAL');
    assert.equal(item.data.rain.trace.rainMm, 120);
    // R12 survives the merge: the irrigation trace is still attached.
    assert.ok(Array.isArray(item.data.trace) && item.data.trace.length > 0);
  });

  it('leaves neither source item behind', () => {
    const result = composeFeed({
      candidates: [irrigateToday(CROP_A), heavyRain(CROP_A)],
      asOf: ASOF,
    });

    const titles = result.items.map((item) => item.titleKey);
    assert.ok(!titles.includes('irrigation.titleIRRIGATE_TODAY'));
    assert.ok(!titles.includes('weather.titleHEAVY_RAIN'));
    assert.equal(result.dropped.duplicates, 0);
    assert.equal(result.dropped.capped, 0);
  });

  it('does NOT merge the same pair when they land on different crops', () => {
    const result = composeFeed({
      candidates: [irrigateToday(CROP_A), heavyRain(CROP_B)],
      asOf: ASOF,
    });

    assert.equal(result.items.length, 2);
    assert.deepEqual(result.items.map((item) => item.source).sort(), ['RULE_ENGINE', 'WEATHER']);
    assert.ok(!result.items.some((item) => item.source === SOURCES.HYBRID));
  });

  it('leaves a non-contradicting pair on one crop untouched', () => {
    const frost = weatherRiskCandidate({
      userId: USER,
      farmId: FARM,
      cropId: CROP_A,
      cropCode: 'WHEAT',
      risk: { type: 'FROST', level: 'HIGH', daysAhead: 2, date: '2026-08-15', data: { tMinC: 1 } },
      asOf: ASOF,
    });

    const resolved = resolveContradictions([irrigateToday(CROP_A), frost]);

    assert.equal(resolved.length, 2);
    assert.ok(!resolved.some((item) => item.source === SOURCES.HYBRID));
  });

  it('returns a new array and mutates nothing it was handed', () => {
    const candidates = [irrigateToday(CROP_A), heavyRain(CROP_A)];
    const snapshot = JSON.parse(JSON.stringify(candidates));

    const resolved = resolveContradictions(candidates);

    assert.notEqual(resolved, candidates);
    assert.deepEqual(JSON.parse(JSON.stringify(candidates)), snapshot);
  });
});

// ── Candidate builders ──────────────────────────────────────────────────────

describe('irrigationCandidate · which verdicts reach the feed', () => {
  const build = (result) =>
    irrigationCandidate({
      userId: USER,
      farmId: FARM,
      cropId: CROP_A,
      cropCode: 'WHEAT',
      result,
      asOf: ASOF,
    });

  const verdict = (overrides = {}) => ({
    hasVerdict: true,
    verdict: 'IRRIGATE_TODAY',
    mode: 'FULL',
    stage: 'MID',
    trace: [{ step: 'VERDICT' }],
    ...overrides,
  });

  it('emits nothing for NO_IRRIGATION_NEEDED — a dead item per crop per day', () => {
    assert.equal(build(verdict({ verdict: 'NO_IRRIGATION_NEEDED' })), null);
  });

  it('emits nothing when the engine reached no verdict at all', () => {
    assert.equal(build({ hasVerdict: false, verdict: 'UNAVAILABLE', trace: [] }), null);
    assert.equal(build({ hasVerdict: false, verdict: null, trace: [] }), null);
    assert.equal(build(null), null);
    assert.equal(build(undefined), null);
  });

  it('emits nothing for a verdict string the priority table does not list', () => {
    assert.equal(build(verdict({ verdict: 'HARVEST_NOW' })), null);
  });

  const priorities = [
    ['IRRIGATE_TODAY', 'HIGH'],
    ['IRRIGATE_IN_N_DAYS', 'MEDIUM'],
    ['WAIT_RAIN_EXPECTED', 'INFO'],
    ['MAINTAIN_WATER_LEVEL', 'MEDIUM'],
  ];

  for (const [verdictName, priority] of priorities) {
    it(`emits ${verdictName} at ${priority}, keyed by the verdict`, () => {
      const item = build(verdict({ verdict: verdictName, amountMm: 25, days: 3 }));

      assert.ok(item, `${verdictName} was not materialised`);
      assert.equal(item.priority, priority);
      assert.equal(item.type, FEED_TYPES.IRRIGATION);
      assert.equal(item.source, SOURCES.RULE_ENGINE);
      assert.equal(item.titleKey, `irrigation.title${verdictName}`);
      assert.equal(item.bodyKey, `irrigation.body${verdictName}`);
      assert.equal(item.discriminator, verdictName);
      assert.equal(item.cropId, CROP_A);
      assert.equal(item.farmId, FARM);
      assert.equal(item.data.cropCode, 'WHEAT');
      assert.equal(item.data.verdict, verdictName);
      assert.equal(item.validUntil.toISOString(), '2026-08-13T18:29:59.999Z');
    });
  }

  it('carries null rather than an invented number for absent amounts', () => {
    const item = build(verdict({ verdict: 'WAIT_RAIN_EXPECTED' }));

    assert.equal(item.data.amountMm, null);
    assert.equal(item.data.amountLitersPerAcre, null);
    assert.equal(item.data.days, null);
    assert.equal(item.data.freshness, null);
  });
});

describe('weatherRiskCandidate · risk level maps to priority', () => {
  const build = (risk) =>
    weatherRiskCandidate({
      userId: USER,
      farmId: FARM,
      cropId: CROP_A,
      cropCode: 'WHEAT',
      risk,
      asOf: ASOF,
    });

  const risk = (overrides = {}) => ({
    type: 'FROST',
    level: 'HIGH',
    daysAhead: 1,
    date: '2026-08-14',
    thresholdSource: 'REGISTRY',
    data: { tMinC: 1, thresholdC: 4 },
    ...overrides,
  });

  it('emits nothing for a LOW risk — a warning nobody must act on is noise', () => {
    assert.equal(build(risk({ level: 'LOW' })), null);
  });

  it('emits nothing for a level the table does not list', () => {
    assert.equal(build(risk({ level: 'NONE' })), null);
    assert.equal(build(risk({ level: undefined })), null);
  });

  for (const [level, priority] of [
    ['CRITICAL', 'CRITICAL'],
    ['HIGH', 'HIGH'],
    ['MEDIUM', 'MEDIUM'],
  ]) {
    it(`emits a ${level} risk at ${priority}, discriminated by the risk type`, () => {
      const item = build(risk({ level }));

      assert.ok(item);
      assert.equal(item.priority, priority);
      assert.equal(item.type, FEED_TYPES.WEATHER_RISK);
      assert.equal(item.source, SOURCES.WEATHER);
      assert.equal(item.titleKey, 'weather.titleFROST');
      assert.equal(item.discriminator, 'FROST');
      assert.equal(item.data.riskType, 'FROST');
      assert.equal(item.data.level, level);
      assert.equal(item.data.thresholdSource, 'REGISTRY');
      assert.equal(item.validUntil.toISOString(), '2026-08-14T18:29:59.999Z');
    });
  }
});

describe('marketCandidate · emitted on a flip, not on a state', () => {
  const build = (signal, previousTrend) =>
    marketCandidate({ userId: USER, cropCode: 'ONION', signal, previousTrend, asOf: ASOF });

  const signal = (overrides = {}) => ({
    trend: 'RISING',
    guidanceKey: 'market.guidanceRising',
    changePct7d: 20,
    changePct30d: null,
    trace: [{ step: 'VERDICT', trend: 'RISING' }],
    ...overrides,
  });

  it('emits nothing when the trend is unchanged since the last item', () => {
    assert.equal(build(signal(), 'RISING'), null);
  });

  it('emits nothing when the engine reached no trend', () => {
    assert.equal(build(signal({ trend: null }), 'RISING'), null);
    assert.equal(build(undefined, 'RISING'), null);
  });

  it('emits a MEDIUM item when the trend differs from the previous one', () => {
    const item = build(signal(), 'FALLING');

    assert.ok(item);
    assert.equal(item.priority, PRIORITIES.MEDIUM);
    assert.equal(item.type, FEED_TYPES.MARKET);
    assert.equal(item.source, SOURCES.MARKET);
    assert.equal(item.titleKey, 'market.titleRISING');
    assert.equal(item.bodyKey, 'market.guidanceRising');
    assert.equal(item.discriminator, 'ONION:RISING');
    assert.equal(item.data.previousTrend, 'FALLING');
    assert.equal(item.data.changePct7d, 20);
    assert.equal(item.validUntil.toISOString(), '2026-08-15T06:30:00.000Z');
    // A market item is farm-less and crop-less; the key falls back accordingly.
    assert.equal(item.cropId, undefined);
  });

  it('emits the first-ever signal, when there is no previous trend to compare', () => {
    const item = build(signal(), undefined);

    assert.ok(item);
    assert.equal(item.data.previousTrend, null);
  });
});

// ── R12 · trace ─────────────────────────────────────────────────────────────

describe('every emitted candidate carries trace data (R12)', () => {
  const nonEmpty = (trace) =>
    trace != null &&
    (Array.isArray(trace) ? trace.length > 0 : Object.keys(trace ?? {}).length > 0);

  it('irrigation carries the engine trace', () => {
    const item = irrigationCandidate({
      userId: USER,
      farmId: FARM,
      cropId: CROP_A,
      cropCode: 'WHEAT',
      result: {
        hasVerdict: true,
        verdict: 'IRRIGATE_TODAY',
        mode: 'FULL',
        trace: [{ step: 'INPUT' }, { step: 'VERDICT' }],
      },
      asOf: ASOF,
    });

    assert.ok(nonEmpty(item.data.trace), 'no recommendation without trace data');
    assert.equal(item.data.trace.length, 2);
  });

  it('a weather risk carries the numbers behind the verdict', () => {
    const item = weatherRiskCandidate({
      userId: USER,
      farmId: FARM,
      cropId: CROP_A,
      cropCode: 'WHEAT',
      risk: {
        type: 'HEAT',
        level: 'HIGH',
        daysAhead: 2,
        date: '2026-08-15',
        data: { tMaxC: 43, thresholdC: 38, degreesOver: 5 },
      },
      asOf: ASOF,
    });

    assert.ok(nonEmpty(item.data.trace));
    assert.equal(item.data.trace.tMaxC, 43);
  });

  it('a market item carries the signal trace when the signal supplies one', () => {
    const item = marketCandidate({
      userId: USER,
      cropCode: 'ONION',
      signal: {
        trend: 'FALLING',
        guidanceKey: 'market.guidanceFalling',
        trace: [{ step: 'WINDOWS' }],
      },
      previousTrend: 'RISING',
      asOf: ASOF,
    });

    assert.ok(nonEmpty(item.data.trace));
  });

  /**
   * Recorded, not fixed (source bug, reported separately): `marketCandidate`
   * coalesces a missing `signal.trace` to null instead of refusing to emit, and
   * `marketService.myCropSignals` — the job's only signal source — projects a
   * signal WITHOUT `trace`. Every market item the feed job writes therefore
   * lands with `data.trace: null`, which R12 forbids.
   */
  it('degrades a traceless signal to null rather than refusing it (documented gap)', () => {
    const item = marketCandidate({
      userId: USER,
      cropCode: 'ONION',
      signal: { trend: 'FALLING', guidanceKey: 'market.guidanceFalling' },
      previousTrend: 'RISING',
      asOf: ASOF,
    });

    assert.ok(item, 'premise: the item is emitted regardless');
    assert.equal(item.data.trace, null);
    assert.equal(nonEmpty(item.data.trace), false);
  });
});

// ── Purity ──────────────────────────────────────────────────────────────────

describe('composeFeed · purity (rule 5)', () => {
  const frozenCandidates = () =>
    deepFreeze([
      candidate({ cropId: CROP_A, priority: PRIORITIES.INFO }),
      candidate({
        cropId: CROP_A,
        priority: PRIORITIES.HIGH,
        discriminator: 'IRRIGATE_TODAY',
        data: { verdict: 'IRRIGATE_TODAY', trace: [{ step: 'VERDICT' }] },
      }),
      riskCandidate({
        cropId: CROP_A,
        priority: PRIORITIES.CRITICAL,
        discriminator: 'HEAVY_RAIN',
        titleKey: 'weather.titleHEAVY_RAIN',
        data: { riskType: 'HEAVY_RAIN', trace: { rainMm: 120 } },
      }),
      candidate({ cropId: CROP_B, priority: PRIORITIES.MEDIUM }),
    ]);

  it('does not throw or mutate when every candidate is deeply frozen', () => {
    const candidates = frozenCandidates();

    // The set deliberately includes the contradiction pair, the dedup path and
    // the sort, so all three write paths run against frozen input.
    const result = composeFeed({ candidates, asOf: ASOF });

    assert.ok(result.items.length > 0);
    assert.ok(Object.isFrozen(candidates));
    for (const item of candidates) assert.ok(Object.isFrozen(item));
  });

  it('is deterministic: identical inputs give a deeply equal result', () => {
    const candidates = frozenCandidates();

    assert.deepEqual(
      composeFeed({ candidates, asOf: ASOF }),
      composeFeed({ candidates, asOf: ASOF }),
    );
  });

  it('never hands back a reference into the candidate array', () => {
    const candidates = [candidate({ cropId: CROP_A })];
    const result = composeFeed({ candidates, asOf: ASOF });

    assert.notEqual(result.items[0], candidates[0]);
    assert.equal(candidates[0].dedupKey, undefined, 'the composer stamped the input');
  });
});
