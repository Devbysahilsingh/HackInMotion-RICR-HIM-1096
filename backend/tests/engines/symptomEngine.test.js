/**
 * Rule-based symptom engine — engine unit tests.
 *
 * docs/ai/fallback-strategy.md §"Why this is credible": "Tested: fixture
 * answer-sets → expected candidate ordering; adversarial: contradictory answers
 * → low scores → referral path." Both halves are below.
 *
 * The engine is pure, so every case is fixture in / object out — no database,
 * no server, no clock (`asOf` is always passed explicitly).
 *
 * FIXTURES ARE SYNTHETIC. The real disease KB is authored separately; these
 * entries use the closed tag vocabulary and invented codes/keys chosen so the
 * arithmetic is checkable by hand. Nothing here is an agronomic claim about any
 * crop, and no fixture asserts that a real disease has real symptoms.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_EXPERT_THRESHOLD,
  HEALTH_SOURCES,
  MATCH_BANDS,
  MATCH_BAND_LIKELY_MIN,
  MAX_SYMPTOM_CANDIDATES,
  SYMPTOM_WEIGHTS,
} from '../../src/config/constants.js';
import { matchSymptoms } from '../../src/engines/symptom/symptomEngine.js';
import {
  ALL_SYMPTOM_TAGS,
  EXPERT_REFERRAL_REASONS,
  SKIP_CAUSES,
  SYMPTOM_AXES,
  SYMPTOM_REASONS,
  SYMPTOM_TRACE_STEPS,
  SYMPTOM_VALUES,
} from '../../src/engines/symptom/constants.js';

// ── Fixtures ────────────────────────────────────────────────────────────────

/** Fixed instant: the engine has no clock, so every call stamps this. */
const AS_OF = new Date('2026-08-13T06:00:00.000Z');

/**
 * A KB entry. i18n KEY arrays only — the one prose-bearing field is
 * `sourceRefs[].title`, which is a citation, deliberately kept prose so the
 * "keys never contain prose" assertion below is proven to be looking at the
 * right fields.
 */
const disease = (code, symptomTags, overrides = {}) => ({
  code,
  names: { en: code, hi: code },
  symptoms: [`fixture.diseases.${code}.symptoms.0`, `fixture.diseases.${code}.symptoms.1`],
  inspect: [`fixture.diseases.${code}.inspect.0`],
  nextSteps: [`fixture.diseases.${code}.nextSteps.0`],
  prevention: [`fixture.diseases.${code}.prevention.0`],
  symptomTags,
  expertThreshold: DEFAULT_EXPERT_THRESHOLD,
  sourceRefs: [{ title: 'Fixture citation with prose in it', url: 'https://example.invalid/fx' }],
  ...overrides,
});

const crop = (diseases, overrides = {}) => ({
  cropCode: 'FIXTURE_CROP',
  supportLevel: 'GENERAL',
  diseases,
  ...overrides,
});

/** Tags every axis; the reference "everything the farmer said" entry. */
const BLIGHT = disease('BLIGHT', [
  'part:LEAF',
  'pattern:SPOTS',
  'color:BROWN',
  'distribution:LOWER_LEAVES',
  'weather:HIGH_HUMIDITY',
]);

/** Tags every axis too, but disagrees with BLIGHT on three of them. */
const MILDEW = disease('MILDEW', [
  'part:LEAF',
  'pattern:POWDER',
  'color:WHITE',
  'distribution:UPPER_LEAVES',
  'weather:HIGH_HUMIDITY',
]);

/** The answer set BLIGHT matches on all four symptom axes. */
const BLIGHT_ANSWERS = Object.freeze({
  part: 'LEAF',
  pattern: 'SPOTS',
  color: 'BROWN',
  distribution: 'LOWER_LEAVES',
});

/** Humid enough to derive `weather:HIGH_HUMIDITY` and nothing else. */
const HUMID = Object.freeze({ humidityPct: 90 });

const run = (input) => matchSymptoms({ asOf: AS_OF, ...input });

const stepsOf = (result, step) => result.trace.filter((entry) => entry.step === step);
const scoringFor = (result, code) =>
  stepsOf(result, SYMPTOM_TRACE_STEPS.SCORING).find((entry) => entry.diseaseCode === code);
const codesOf = (result) => result.candidates.map((candidate) => candidate.diseaseCode);

// ── Happy path ──────────────────────────────────────────────────────────────

describe('matchSymptoms · exact match', () => {
  it('awards every axis when all of them agree', () => {
    const result = run({
      registryCrop: crop([BLIGHT, MILDEW]),
      answers: BLIGHT_ANSWERS,
      weatherContext: HUMID,
    });

    assert.equal(result.hasVerdict, true);
    assert.equal(result.reasonCode, SYMPTOM_REASONS.CANDIDATES_MATCHED);
    assert.equal(result.candidates[0].diseaseCode, 'BLIGHT');
    assert.equal(result.candidates[0].matchScore, 1);
    assert.equal(result.candidates[0].band, MATCH_BANDS.LIKELY);
    assert.equal(result.topScore, 1);

    // The full weighted set: 2 + 3 + 2 + 1 + 1 (fallback-strategy §2).
    const total = SYMPTOM_AXES.reduce((sum, axis) => sum + SYMPTOM_WEIGHTS[axis], 0);
    const scoring = scoringFor(result, 'BLIGHT');
    assert.equal(scoring.awarded, total);
    assert.equal(scoring.answerable, total);
    assert.deepEqual(scoring.matchedTags, [
      'part:LEAF',
      'pattern:SPOTS',
      'color:BROWN',
      'distribution:LOWER_LEAVES',
      'weather:HIGH_HUMIDITY',
    ]);
  });

  it('never emits a band other than Possible/Likely', () => {
    const result = run({
      registryCrop: crop([BLIGHT, MILDEW]),
      answers: BLIGHT_ANSWERS,
      weatherContext: HUMID,
    });

    for (const candidate of result.candidates) {
      assert.ok(Object.values(MATCH_BANDS).includes(candidate.band));
      assert.notEqual(candidate.band.toUpperCase(), 'DIAGNOSED');
    }
  });

  it('bands on the score, not on the ranking', () => {
    const result = run({
      registryCrop: crop([BLIGHT, MILDEW]),
      answers: BLIGHT_ANSWERS,
      weatherContext: HUMID,
    });

    // MILDEW agrees on part + weather only: (2 + 1) / 9.
    const runnerUp = result.candidates[1];
    assert.equal(runnerUp.diseaseCode, 'MILDEW');
    assert.equal(runnerUp.matchScore, Math.round((3 / 9) * 1000) / 1000);
    assert.ok(runnerUp.matchScore < MATCH_BAND_LIKELY_MIN);
    assert.equal(runnerUp.band, MATCH_BANDS.POSSIBLE);
  });

  it('reads the referral threshold off the top candidate only', () => {
    const result = run({
      registryCrop: crop([BLIGHT, MILDEW]),
      answers: BLIGHT_ANSWERS,
      weatherContext: HUMID,
    });

    // The runner-up sits below its own threshold; that is not a referral,
    // because the assessment being offered is the top one.
    assert.ok(result.candidates[1].matchScore < result.candidates[1].expertThreshold);
    assert.equal(result.expertReferral, false);
    assert.deepEqual(result.expertReferralReasons, []);
  });

  it('carries the KB provenance the API needs to render and cite', () => {
    const result = run({ registryCrop: crop([BLIGHT]), answers: BLIGHT_ANSWERS });
    const [candidate] = result.candidates;

    assert.deepEqual(candidate.symptomKeys, BLIGHT.symptoms);
    assert.deepEqual(candidate.inspectKeys, BLIGHT.inspect);
    assert.deepEqual(candidate.nextStepKeys, BLIGHT.nextSteps);
    assert.deepEqual(candidate.preventionKeys, BLIGHT.prevention);
    assert.deepEqual(candidate.sourceRefs, BLIGHT.sourceRefs);
    assert.equal(candidate.expertThreshold, DEFAULT_EXPERT_THRESHOLD);
  });

  it('labels itself as the no-AI tier and opts out of community aggregation', () => {
    const result = run({ registryCrop: crop([BLIGHT]), answers: BLIGHT_ANSWERS });

    assert.equal(result.source, HEALTH_SOURCES.RULES);
    assert.equal(result.aiAssisted, false);
    assert.equal(result.excludedFromCommunityAggregation, true);
    assert.equal(result.asOf, AS_OF.toISOString());
  });
});

// ── Partial answers ─────────────────────────────────────────────────────────

describe('matchSymptoms · partial answers', () => {
  it('scores on one axis when the farmer only knows one thing', () => {
    const result = run({ registryCrop: crop([BLIGHT, MILDEW]), answers: { pattern: 'POWDER' } });

    // MILDEW: 3/3. BLIGHT declares a pattern and it is the wrong one, so it
    // scores 0 and is dropped rather than shown as a 0% "possible".
    assert.deepEqual(codesOf(result), ['MILDEW']);
    assert.equal(result.candidates[0].matchScore, 1);
    assert.equal(scoringFor(result, 'BLIGHT').cause, SKIP_CAUSES.ZERO_MATCH);
    assert.equal(scoringFor(result, 'BLIGHT').included, false);
  });

  it('does not penalise an entry for an axis it is silent about', () => {
    const noColour = disease('NO_COLOUR', ['part:LEAF', 'pattern:SPOTS']);
    const withColour = disease('WITH_COLOUR', ['part:LEAF', 'pattern:SPOTS', 'color:BROWN']);

    const result = run({
      registryCrop: crop([noColour, withColour]),
      answers: { part: 'LEAF', pattern: 'SPOTS', color: 'BROWN' },
    });

    const silent = scoringFor(result, 'NO_COLOUR');
    const speaking = scoringFor(result, 'WITH_COLOUR');

    // The silent entry's denominator excludes colour entirely: 5/5, not 5/7.
    assert.equal(silent.answerable, SYMPTOM_WEIGHTS.part + SYMPTOM_WEIGHTS.pattern);
    assert.equal(silent.awarded, silent.answerable);
    assert.equal(
      speaking.answerable,
      SYMPTOM_WEIGHTS.part + SYMPTOM_WEIGHTS.pattern + SYMPTOM_WEIGHTS.color,
    );
    assert.equal(silent.matchScore, 1);
    assert.equal(speaking.matchScore, 1);
  });

  it('still counts a declared axis the farmer contradicted', () => {
    const result = run({
      registryCrop: crop([BLIGHT]),
      answers: { part: 'LEAF', color: 'BLACK' },
    });

    const scoring = scoringFor(result, 'BLIGHT');
    assert.equal(scoring.answerable, SYMPTOM_WEIGHTS.part + SYMPTOM_WEIGHTS.color);
    assert.equal(scoring.awarded, SYMPTOM_WEIGHTS.part);
  });
});

// ── Adversarial ─────────────────────────────────────────────────────────────

describe('matchSymptoms · contradictory answers', () => {
  it('produces low scores and routes to a human', () => {
    const result = run({
      registryCrop: crop([BLIGHT, MILDEW]),
      answers: { part: 'ROOT', pattern: 'POWDER', color: 'BLACK', distribution: 'VEINS' },
    });

    // MILDEW agrees on pattern alone: 3/8 = 0.375, under the 0.4 floor.
    assert.deepEqual(codesOf(result), ['MILDEW']);
    assert.equal(result.topScore, 0.375);
    assert.ok(result.topScore < DEFAULT_EXPERT_THRESHOLD);
    assert.equal(result.expertReferral, true);
    assert.deepEqual(result.expertReferralReasons, [EXPERT_REFERRAL_REASONS.SCORE_BELOW_THRESHOLD]);
    // BLIGHT agreed with nothing at all.
    assert.equal(scoringFor(result, 'BLIGHT').matchScore, 0);
  });

  it('gives a no-verdict rather than a 0% candidate list when nothing matches', () => {
    const result = run({
      registryCrop: crop([BLIGHT, MILDEW]),
      answers: { part: 'ROOT', pattern: 'WILT', color: 'PURPLE', distribution: 'VEINS' },
    });

    assert.equal(result.hasVerdict, false);
    assert.equal(result.reasonCode, SYMPTOM_REASONS.NO_CANDIDATE_MATCH);
    assert.deepEqual(result.candidates, []);
    assert.equal(result.expertReferral, true);
  });

  it('honours a disease that sets a higher referral bar for itself', () => {
    const cautious = disease('CAUTIOUS', ['part:LEAF', 'pattern:SPOTS', 'color:BROWN'], {
      expertThreshold: 0.9,
    });

    const result = run({
      registryCrop: crop([cautious]),
      answers: { part: 'LEAF', pattern: 'SPOTS', color: 'YELLOW' },
    });

    assert.equal(result.topScore, 0.714); // 5/7
    assert.equal(result.candidates[0].expertThreshold, 0.9);
    assert.equal(result.expertReferral, true);
  });

  it('falls back to the default threshold when the registry value is unusable', () => {
    const broken = disease('BROKEN', ['part:LEAF'], { expertThreshold: 5 });
    const result = run({ registryCrop: crop([broken]), answers: { part: 'LEAF' } });

    assert.equal(result.candidates[0].expertThreshold, DEFAULT_EXPERT_THRESHOLD);
  });
});

// ── Designed no-verdict states ──────────────────────────────────────────────

describe('matchSymptoms · designed no-verdict states', () => {
  const expectNoVerdict = (result, reasonCode) => {
    assert.equal(result.hasVerdict, false);
    assert.equal(result.reasonCode, reasonCode);
    assert.deepEqual(result.candidates, []);
    assert.equal(result.topScore, null);
    assert.equal(result.expertReferral, true);
    assert.deepEqual(result.expertReferralReasons, [EXPERT_REFERRAL_REASONS.NO_VERDICT]);
    assert.equal(result.trace.at(-1).step, SYMPTOM_TRACE_STEPS.NO_VERDICT);
    assert.equal(result.trace.at(-1).reasonCode, reasonCode);
  };

  it('answers nothing at all without inventing candidates', () => {
    const result = run({
      registryCrop: crop([BLIGHT, MILDEW]),
      answers: {},
      weatherContext: HUMID,
    });

    expectNoVerdict(result, SYMPTOM_REASONS.NO_SYMPTOMS_ANSWERED);
    // Weather alone is not a symptom, even though it derived a tag.
    assert.deepEqual(result.weatherTags, ['weather:HIGH_HUMIDITY']);
  });

  it('treats a missing answers object like an empty one', () => {
    expectNoVerdict(run({ registryCrop: crop([BLIGHT]) }), SYMPTOM_REASONS.NO_SYMPTOMS_ANSWERED);
  });

  it('says so when the crop is unsupported', () => {
    const result = run({
      registryCrop: crop([BLIGHT, MILDEW], { supportLevel: 'UNSUPPORTED' }),
      answers: BLIGHT_ANSWERS,
    });

    expectNoVerdict(result, SYMPTOM_REASONS.CROP_UNSUPPORTED);
  });

  it('says so when the crop carries no disease KB', () => {
    expectNoVerdict(
      run({ registryCrop: crop([]), answers: BLIGHT_ANSWERS }),
      SYMPTOM_REASONS.DISEASE_KB_UNAVAILABLE,
    );
    expectNoVerdict(
      run({ registryCrop: { cropCode: 'X', supportLevel: 'LIMITED' }, answers: BLIGHT_ANSWERS }),
      SYMPTOM_REASONS.DISEASE_KB_UNAVAILABLE,
    );
  });

  it('says so when no registry crop was supplied at all', () => {
    expectNoVerdict(run({ answers: BLIGHT_ANSWERS }), SYMPTOM_REASONS.REGISTRY_CROP_UNAVAILABLE);
    expectNoVerdict(matchSymptoms(), SYMPTOM_REASONS.REGISTRY_CROP_UNAVAILABLE);
  });

  it('distinguishes an untagged KB from a KB that disagrees', () => {
    const untagged = disease('UNTAGGED', ['part:LEAF', 'pattern:SPOTS']);
    const result = run({ registryCrop: crop([untagged]), answers: { distribution: 'VEINS' } });

    expectNoVerdict(result, SYMPTOM_REASONS.KB_TAGS_UNAVAILABLE);
    assert.equal(scoringFor(result, 'UNTAGGED').cause, SKIP_CAUSES.NO_TAGS_ON_ANSWERED_AXES);
    assert.equal(scoringFor(result, 'UNTAGGED').matchScore, null);
  });

  it('skips a KB entry with no code instead of throwing', () => {
    const result = run({
      registryCrop: crop([{ symptomTags: ['part:LEAF'] }, BLIGHT]),
      answers: { part: 'LEAF' },
    });

    assert.deepEqual(codesOf(result), ['BLIGHT']);
    const skipped = stepsOf(result, SYMPTOM_TRACE_STEPS.SCORING).find(
      (entry) => entry.diseaseCode === null,
    );
    assert.equal(skipped.cause, SKIP_CAUSES.INVALID_DISEASE_ENTRY);
  });
});

// ── Ordering ────────────────────────────────────────────────────────────────

describe('matchSymptoms · ordering', () => {
  it('breaks ties on diseaseCode ascending', () => {
    const tags = ['part:LEAF', 'pattern:SPOTS', 'color:BROWN'];
    const result = run({
      registryCrop: crop([disease('ZETA', tags), disease('ALPHA', tags)]),
      answers: { part: 'LEAF', pattern: 'SPOTS', color: 'BROWN' },
    });

    assert.deepEqual(codesOf(result), ['ALPHA', 'ZETA']);
    assert.equal(result.candidates[0].matchScore, result.candidates[1].matchScore);
  });

  it('is byte-identical under every shuffle of the registry disease array', () => {
    const tags = ['part:LEAF', 'pattern:SPOTS', 'color:BROWN'];
    const kb = [
      disease('ALPHA', tags),
      disease('BRAVO', tags),
      disease('CHARLIE', ['part:LEAF', 'pattern:SPOTS', 'color:YELLOW']),
      disease('DELTA', ['part:LEAF', 'pattern:WILT', 'color:BROWN']),
      disease('ECHO', ['part:LEAF']),
    ];
    const answers = { part: 'LEAF', pattern: 'SPOTS', color: 'BROWN' };

    // Ten deterministic permutations: rotations, and rotations of the reverse.
    const rotate = (list, by) => [...list.slice(by), ...list.slice(0, by)];
    const permutations = [
      ...kb.map((_, index) => rotate(kb, index)),
      ...kb.map((_, index) => rotate([...kb].reverse(), index)),
    ];
    assert.equal(permutations.length, 10);

    const baseline = JSON.stringify(run({ registryCrop: crop(kb), answers }));
    for (const permutation of permutations) {
      assert.equal(JSON.stringify(run({ registryCrop: crop(permutation), answers })), baseline);
    }
  });

  it(`returns at most ${MAX_SYMPTOM_CANDIDATES} candidates`, () => {
    const tags = ['part:LEAF', 'pattern:SPOTS'];
    const kb = ['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7'].map((code) => disease(code, tags));
    const result = run({ registryCrop: crop(kb), answers: { part: 'LEAF', pattern: 'SPOTS' } });

    assert.equal(result.candidates.length, MAX_SYMPTOM_CANDIDATES);
    assert.deepEqual(codesOf(result), ['D1', 'D2', 'D3', 'D4', 'D5']);
    // The cap trims the output, never the audit.
    assert.equal(stepsOf(result, SYMPTOM_TRACE_STEPS.SCORING).length, kb.length);
  });
});

// ── Weather context ─────────────────────────────────────────────────────────

describe('matchSymptoms · weather context', () => {
  const FUNGAL = disease('FUNGAL', [
    'part:LEAF',
    'pattern:SPOTS',
    'color:BROWN',
    'weather:HIGH_HUMIDITY',
  ]);
  const DRYWX = disease('DRYWX', ['part:LEAF', 'pattern:SPOTS', 'color:BROWN', 'weather:HOT_DRY']);
  const NOWX = disease('NOWX', ['part:LEAF', 'pattern:SPOTS', 'color:BROWN']);
  const NOWX_B = disease('NOWX_B', ['part:LEAF', 'pattern:SPOTS']);

  // Colour deliberately disagrees, so no entry is already pinned at 1.0 and a
  // weather match has room to move the score.
  const answers = { part: 'LEAF', pattern: 'SPOTS', color: 'YELLOW' };
  const registryCrop = crop([FUNGAL, DRYWX, NOWX, NOWX_B]);

  it('contributes to neither numerator nor denominator when absent', () => {
    const result = run({ registryCrop, answers, weatherContext: null });

    assert.deepEqual(result.weatherTags, []);
    for (const code of ['FUNGAL', 'DRYWX', 'NOWX']) {
      // 5/7 for all three: the weather axis simply is not there.
      assert.equal(scoringFor(result, code).answerable, 7);
      assert.equal(scoringFor(result, code).matchScore, 0.714);
    }
  });

  it('boosts a matching weather tag and penalises a contradicting one', () => {
    const result = run({ registryCrop, answers, weatherContext: HUMID });

    assert.deepEqual(result.weatherTags, ['weather:HIGH_HUMIDITY']);
    assert.equal(scoringFor(result, 'FUNGAL').matchScore, 0.75); // 6/8
    assert.equal(scoringFor(result, 'NOWX').matchScore, 0.714); // 5/7, unchanged
    assert.equal(scoringFor(result, 'DRYWX').matchScore, 0.625); // 5/8

    // NOWX_B leads at 1.0 (5/5) because it is silent on colour and weather —
    // the acknowledged cost of normalising over the intersection, documented in
    // the engine docblock. The trace makes it visible: it was judged on 5 of
    // the 8 weight available here, and the UI is expected to say so.
    assert.equal(scoringFor(result, 'NOWX_B').matchScore, 1);
    assert.equal(scoringFor(result, 'NOWX_B').answerable, 5);
    assert.deepEqual(codesOf(result), ['NOWX_B', 'FUNGAL', 'NOWX', 'DRYWX']);
  });

  it('leaves the relative order of weather-silent diseases untouched', () => {
    const dry = run({ registryCrop, answers, weatherContext: null });
    const humid = run({ registryCrop, answers, weatherContext: HUMID });

    const weatherSilent = (result) => codesOf(result).filter((code) => code.startsWith('NOWX'));
    assert.deepEqual(weatherSilent(dry), weatherSilent(humid));
    assert.equal(scoringFor(dry, 'NOWX').matchScore, scoringFor(humid, 'NOWX').matchScore);
    assert.equal(scoringFor(dry, 'NOWX_B').matchScore, scoringFor(humid, 'NOWX_B').matchScore);
  });

  it('derives no tag from readings that fire no rule', () => {
    const result = run({
      registryCrop,
      answers,
      weatherContext: { humidityPct: 60, rainMm: 0, tMaxC: 28 },
    });

    assert.deepEqual(result.weatherTags, []);
    assert.equal(scoringFor(result, 'FUNGAL').answerable, 7);
  });

  it('can derive more than one tag, and awards the axis once', () => {
    const both = disease('BOTH', ['part:LEAF', 'weather:HIGH_HUMIDITY', 'weather:RAIN']);
    const result = run({
      registryCrop: crop([both]),
      answers: { part: 'LEAF' },
      weatherContext: { humidityPct: 92, rainMm: 12 },
    });

    assert.deepEqual(result.weatherTags, ['weather:HIGH_HUMIDITY', 'weather:RAIN']);
    const scoring = scoringFor(result, 'BOTH');
    assert.equal(scoring.answerable, SYMPTOM_WEIGHTS.part + SYMPTOM_WEIGHTS.weather);
    assert.equal(scoring.awarded, scoring.answerable);
    assert.deepEqual(scoring.matchedTags, ['part:LEAF', 'weather:HIGH_HUMIDITY', 'weather:RAIN']);
  });

  it('will not call a hot day dry without a humidity reading', () => {
    const result = run({
      registryCrop: crop([disease('HOTDRY', ['part:LEAF', 'weather:HOT_DRY'])]),
      answers: { part: 'LEAF' },
      weatherContext: { tMaxC: 40 },
    });

    assert.deepEqual(result.weatherTags, []);
    const evaluation = stepsOf(result, SYMPTOM_TRACE_STEPS.WEATHER_CONTEXT)[0].evaluations.find(
      (entry) => entry.tag === 'weather:HOT_DRY',
    );
    assert.equal(evaluation.fired, false);
    assert.equal(evaluation.cause, 'READINGS_UNAVAILABLE');
  });

  it('ignores a malformed weather context instead of throwing', () => {
    for (const weatherContext of [undefined, null, 'humid', 42, []]) {
      const result = run({ registryCrop: crop([BLIGHT]), answers: BLIGHT_ANSWERS, weatherContext });
      assert.deepEqual(result.weatherTags, []);
      assert.equal(result.hasVerdict, true);
    }
  });
});

// ── Spread ──────────────────────────────────────────────────────────────────

describe('matchSymptoms · spread speed', () => {
  it('forces a referral on rapid spread even at a perfect score', () => {
    const result = run({
      registryCrop: crop([BLIGHT, MILDEW]),
      answers: { ...BLIGHT_ANSWERS, spread: 'RAPID' },
      weatherContext: HUMID,
    });

    assert.equal(result.topScore, 1);
    assert.equal(result.candidates[0].band, MATCH_BANDS.LIKELY);
    assert.equal(result.expertReferral, true);
    assert.deepEqual(result.expertReferralReasons, [EXPERT_REFERRAL_REASONS.RAPID_SPREAD_REPORTED]);
  });

  it('reports both reasons when a weak match is also spreading fast', () => {
    const result = run({
      registryCrop: crop([BLIGHT, MILDEW]),
      answers: {
        part: 'ROOT',
        pattern: 'POWDER',
        color: 'BLACK',
        distribution: 'VEINS',
        spread: 'RAPID',
      },
    });

    assert.deepEqual(result.expertReferralReasons, [
      EXPERT_REFERRAL_REASONS.SCORE_BELOW_THRESHOLD,
      EXPERT_REFERRAL_REASONS.RAPID_SPREAD_REPORTED,
    ]);
  });

  it('does not let spread change any score', () => {
    const withoutSpread = run({ registryCrop: crop([BLIGHT, MILDEW]), answers: BLIGHT_ANSWERS });
    const withSpread = run({
      registryCrop: crop([BLIGHT, MILDEW]),
      answers: { ...BLIGHT_ANSWERS, spread: 'SLOW' },
    });

    assert.deepEqual(
      withoutSpread.candidates.map((c) => [c.diseaseCode, c.matchScore]),
      withSpread.candidates.map((c) => [c.diseaseCode, c.matchScore]),
    );
    assert.equal(withSpread.spread, 'SLOW');
    assert.equal(withoutSpread.spread, null);
  });
});

// ── Input handling ──────────────────────────────────────────────────────────

describe('matchSymptoms · input handling', () => {
  it('forgives case and whitespace in answers', () => {
    const result = run({
      registryCrop: crop([BLIGHT]),
      answers: { part: ' leaf ', pattern: 'Spots', color: 'brown', distribution: 'lower_leaves' },
    });

    assert.equal(result.candidates[0].matchScore, 1);
    assert.deepEqual(result.trace[0].rejectedAnswers, []);
  });

  it('rejects an out-of-vocabulary answer and says so in the trace', () => {
    const result = run({
      registryCrop: crop([BLIGHT]),
      answers: { part: 'LEAF', pattern: 'GLITTER', spread: 'SUPERSONIC' },
    });

    assert.deepEqual(result.trace[0].rejectedAnswers, ['pattern', 'spread']);
    assert.equal(result.trace[0].answers.pattern, null);
    assert.equal(result.spread, null);
    // Only the usable answer scored.
    assert.equal(scoringFor(result, 'BLIGHT').answerable, SYMPTOM_WEIGHTS.part);
  });

  it('ignores registry tags outside the closed vocabulary', () => {
    const typo = disease('TYPO', ['part:LEAF', 'color:MAGENTA', 'patern:SPOTS', '', 7]);
    const result = run({
      registryCrop: crop([typo]),
      answers: { part: 'LEAF', color: 'BROWN', pattern: 'SPOTS' },
    });

    const scoring = scoringFor(result, 'TYPO');
    // Neither the bad colour nor the misspelled axis enters the denominator.
    assert.equal(scoring.answerable, SYMPTOM_WEIGHTS.part);
    assert.equal(scoring.matchScore, 1);
    assert.deepEqual(scoring.unknownTags, ['color:MAGENTA', 'patern:SPOTS']);
  });

  it('survives a KB entry with no tags and no key arrays', () => {
    const bare = { code: 'BARE' };
    const result = run({ registryCrop: crop([bare, BLIGHT]), answers: { part: 'LEAF' } });

    assert.deepEqual(codesOf(result), ['BLIGHT']);
    assert.equal(scoringFor(result, 'BARE').cause, SKIP_CAUSES.NO_TAGS_ON_ANSWERED_AXES);
  });

  it('does not mutate its inputs', () => {
    const registryCrop = crop([BLIGHT, MILDEW]);
    const answers = { ...BLIGHT_ANSWERS, spread: 'SLOW' };
    const weatherContext = { ...HUMID };
    const before = JSON.stringify({ registryCrop, answers, weatherContext });

    const result = run({ registryCrop, answers, weatherContext });
    result.candidates[0].symptomKeys.push('mutated');

    assert.equal(JSON.stringify({ registryCrop, answers, weatherContext }), before);
  });

  it('stamps asOf without ever reading a clock', () => {
    assert.equal(
      matchSymptoms({ registryCrop: crop([BLIGHT]), answers: BLIGHT_ANSWERS }).asOf,
      null,
    );
    assert.equal(
      matchSymptoms({
        registryCrop: crop([BLIGHT]),
        answers: BLIGHT_ANSWERS,
        asOf: '2026-08-13T06:00:00.000Z',
      }).asOf,
      AS_OF.toISOString(),
    );
  });
});

// ── Contract-wide invariants ────────────────────────────────────────────────

describe('matchSymptoms · contract invariants', () => {
  const anyResult = () =>
    run({
      registryCrop: crop([BLIGHT, MILDEW]),
      answers: { ...BLIGHT_ANSWERS, spread: 'SLOW' },
      weatherContext: HUMID,
    });

  it('emits i18n keys and codes only — never prose', () => {
    const hasSpace = (value) => typeof value === 'string' && /\s/.test(value);

    for (const candidate of anyResult().candidates) {
      const keyFields = [
        candidate.diseaseCode,
        candidate.band,
        ...candidate.matchedTags,
        ...candidate.symptomKeys,
        ...candidate.inspectKeys,
        ...candidate.nextStepKeys,
        ...candidate.preventionKeys,
      ];
      for (const value of keyFields) assert.equal(hasSpace(value), false, `prose leaked: ${value}`);
      // sourceRefs are citations and DO carry prose — that is what a citation
      // is, and it is the reason the loop above enumerates fields explicitly.
      assert.ok(hasSpace(candidate.sourceRefs[0].title));
    }
  });

  it('opens on INPUT and closes on a verdict step', () => {
    for (const result of [
      anyResult(),
      run({ registryCrop: crop([]), answers: BLIGHT_ANSWERS }),
      run({ registryCrop: crop([BLIGHT]), answers: {} }),
    ]) {
      assert.equal(result.trace[0].step, SYMPTOM_TRACE_STEPS.INPUT);
      assert.ok(
        [SYMPTOM_TRACE_STEPS.VERDICT, SYMPTOM_TRACE_STEPS.NO_VERDICT].includes(
          result.trace.at(-1).step,
        ),
      );
    }
  });

  it('accounts for every scored disease in the trace', () => {
    const kb = [BLIGHT, MILDEW, disease('THIRD', ['part:STEM'])];
    const result = run({ registryCrop: crop(kb), answers: BLIGHT_ANSWERS, weatherContext: HUMID });

    const scored = stepsOf(result, SYMPTOM_TRACE_STEPS.SCORING).map((entry) => entry.diseaseCode);
    assert.equal(scored.length, kb.length);
    for (const entry of kb) assert.ok(scored.includes(entry.code));

    const verdict = result.trace.at(-1);
    assert.equal(verdict.scoredCount, kb.length);
    assert.equal(verdict.candidateCount, result.candidates.length);
    assert.equal(verdict.topDiseaseCode, 'BLIGHT');
  });

  it('records the answers and the derived weather tags on the INPUT step', () => {
    const input = anyResult().trace[0];

    assert.deepEqual(input.answers, { ...BLIGHT_ANSWERS, spread: 'SLOW' });
    assert.deepEqual(input.weatherTags, ['weather:HIGH_HUMIDITY']);
    assert.equal(input.diseaseCount, 2);
    assert.equal(input.supportLevel, 'GENERAL');
  });

  it('is deterministic: the same input twice is deeply equal', () => {
    assert.deepEqual(anyResult(), anyResult());
  });

  it('keeps the tag vocabulary closed and axis-namespaced', () => {
    assert.equal(ALL_SYMPTOM_TAGS.length, new Set(ALL_SYMPTOM_TAGS).size);
    for (const axis of SYMPTOM_AXES) {
      assert.ok(SYMPTOM_VALUES[axis].length > 0);
      for (const value of SYMPTOM_VALUES[axis]) {
        assert.ok(ALL_SYMPTOM_TAGS.includes(`${axis}:${value}`));
      }
    }
    // The weights map and the axis list are the same five axes.
    assert.deepEqual([...SYMPTOM_AXES].sort(), Object.keys(SYMPTOM_WEIGHTS).sort());
  });
});
