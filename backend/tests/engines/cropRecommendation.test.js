/**
 * Crop recommendation engine — engine unit tests.
 *
 * docs/crop-recommendation/engine.md §Testing:
 *   "Golden cases: black-soil Kharif rainfed Nagpur → cotton/soybean rank high,
 *    rice gated out (water); clay irrigated Kharif Raipur → rice top; Rabi loam
 *    Punjab-like → wheat/potato/onion. Property: every output reason must
 *    reference a registry field with a sourceRef."
 *
 * The engine is pure, so every case is fixture in / object out — no database,
 * no server, no clock. The engine reads no clock at all: `season` is an
 * argument, so nothing here needs an `asOf`.
 *
 * ── What this suite deliberately does NOT assert ─────────────────────────────
 *
 * `shared/constants/climate-normals.js` is EMPTY BY DESIGN — the repository
 * contains no IMD normals, and inventing them would fabricate the single input
 * that decides whether a farmer plants a crop their rainfall cannot support
 * (CLAUDE.md rule 7). The engine is built to degrade honestly around that: a
 * factor with no evidence is EXCLUDED from the weighted mean, the remaining
 * weights renormalise, and the exclusion is named in `limitations`.
 *
 * So two of the four documented factors are unreachable today:
 *   · S_temp  — always MISSING (needs a district temperature normal)
 *   · S_water — MISSING on a rainfed farm (needs a district rainfall normal);
 *               SOURCED on an irrigated one, via the labelled irrigation proxy
 * and the water hard gate ("high-need crop + rainfed + low district rainfall
 * normal") can never fire. Those are tested as correct-by-design behaviour.
 * Where a golden case cannot be asserted in full, the partial assertion is
 * written out and a comment names the input that is missing.
 *
 * Fixture agronomic values are registry-*shaped* numbers chosen to make the
 * arithmetic checkable by hand. They are not agronomic claims and are not the
 * registry's sourced values — the golden-case block at the bottom uses the real
 * knowledge files for that.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  CROP_REC_TRACE_STEPS,
  EVIDENCE,
  GATE_REASONS,
  TOP_N,
  WEIGHTS,
  recommendCrops,
} from '../../src/engines/cropRec/cropRecommendation.js';
import { CLIMATE_NORMALS_AVAILABLE } from '../../../shared/constants/climate-normals.js';
import { composeRegistry } from '../../src/services/registrySeedService.js';

// ── Fixtures ────────────────────────────────────────────────────────────────

/**
 * A `sourceRefs` entry shaped exactly as `normalizeSourceRefs`
 * (registrySeedService.js) emits it: the field the reference justifies, then
 * the published citation.
 */
const ref = (field, overrides = {}) => ({
  field,
  org: 'FAO',
  title: 'FAO Irrigation Water Management Manual, Chapter 3 (crop water needs)',
  url: 'fao.org/4/s2022e/s2022e07.htm',
  accessed: '2026-08-13',
  confidence: 'P',
  ...overrides,
});

/** One reference per registry field a reason can rest on. */
const ALL_REFS = Object.freeze([
  ref('names'),
  ref('seasons', { org: 'DES', title: 'Crop Calendar of Major Crops' }),
  ref('soilSuitability', { org: 'ICAR soil classification', confidence: 'S' }),
  ref('waterNeedMm'),
  ref('tempOpt', { org: 'Repo doc (secondary; primary not identified)', confidence: 'S' }),
  ref('droughtSensitivity', { org: 'Repo doc', confidence: 'S' }),
]);

/** A registry document with every field the engine reads. */
const crop = (cropCode, overrides = {}) => ({
  cropCode,
  names: { en: cropCode, hi: cropCode },
  supportLevel: 'GENERAL',
  seasons: ['KHARIF'],
  waterNeedMm: [450, 700],
  droughtSensitivity: 'LOW',
  tempOpt: { min: 20, max: 30 },
  sourceRefs: ALL_REFS,
  ...overrides,
});

const farm = (overrides = {}) => ({
  soilType: 'black',
  irrigationMethod: 'canal',
  location: { state: 'Maharashtra', district: 'Nagpur' },
  sizeValue: 2.5,
  sizeUnit: 'acre',
  ...overrides,
});

/** Assured supply — the only configuration in which S_water can be scored. */
const IRRIGATED = () => farm({ irrigationMethod: 'canal' });
const RAINFED = () => farm({ irrigationMethod: 'rainfed' });

const run = (crops, options = {}) =>
  recommendCrops({
    registryCrops: crops,
    farm: options.farm ?? IRRIGATED(),
    season: options.season ?? 'KHARIF',
    preference: options.preference,
  });

/** Pulls one trace entry by step name. */
const stepOf = (result, step) => result.trace.find((entry) => entry.step === step);

const byCode = (list, cropCode) => list.find((entry) => entry.cropCode === cropCode);

/** Float-safe comparison of two weights to the engine's own 3-place rounding. */
const at3 = (value) => Number(value.toFixed(3));

function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const entry of Object.values(value)) deepFreeze(entry);
  return value;
}

// ── The documented weights ──────────────────────────────────────────────────

describe('recommendCrops · WEIGHTS are the documented figures', () => {
  // engine.md §2 and FINAL-PLAN-SPEC §51:
  //   "0.30·S_season + 0.25·S_soil + 0.30·S_water + 0.15·S_temp"
  it('is exactly 0.30 season / 0.25 soil / 0.30 water / 0.15 temp', () => {
    assert.deepEqual(WEIGHTS, { season: 0.3, soil: 0.25, water: 0.3, temp: 0.15 });
  });

  it('sums to 1.0 — the renormalisation arithmetic depends on it', () => {
    const total = Object.values(WEIGHTS).reduce((sum, weight) => sum + weight, 0);
    assert.equal(at3(total), 1);
  });

  it('is frozen, so no caller can reweight the ranking at runtime', () => {
    assert.ok(Object.isFrozen(WEIGHTS));
  });

  it('publishes the top-5 cut documented as "(ranked, top 5)"', () => {
    assert.equal(TOP_N, 5);
  });
});

// ── Gate · season ───────────────────────────────────────────────────────────

describe('recommendCrops · season gate', () => {
  it('excludes a crop the published calendar does not list for the season', () => {
    const result = run([crop('RABIONLY', { seasons: ['RABI'] })], { season: 'KHARIF' });

    assert.deepEqual(result.recommendations, []);
    assert.equal(result.excluded.length, 1);

    const [excluded] = result.excluded;
    assert.equal(excluded.cropCode, 'RABIONLY');
    assert.equal(excluded.reason, GATE_REASONS.SEASON_MISMATCH);
    assert.equal(
      excluded.reasonKey,
      'cropRec.gateSeason',
      'the exclusion carried no stated reason',
    );
    assert.deepEqual(excluded.data, { season: 'KHARIF', cropSeasons: ['RABI'] });
  });

  it('keeps a crop the calendar lists for the requested season among several', () => {
    const result = run([crop('MULTI', { seasons: ['KHARIF', 'RABI', 'ZAID'] })], {
      season: 'ZAID',
    });

    assert.deepEqual(result.excluded, []);
    assert.equal(result.recommendations.length, 1);
  });

  it('does NOT gate a crop whose seasons array is empty — absence of data is not "no season"', () => {
    // The registry records tomato's seasons as unsourced rather than as none.
    // Gating on that would silently delete the crop from every recommendation.
    const result = run([crop('UNSOURCED', { seasons: [] })]);

    assert.deepEqual(result.excluded, []);
    const [recommendation] = result.recommendations;
    assert.equal(recommendation.cropCode, 'UNSOURCED');

    // The uncertainty is reported as a caution instead of a deletion.
    assert.ok(
      recommendation.cautions.some((caution) => caution.key === 'cropRec.missingSeasons'),
      'the unsourced season list was not reported to the farmer',
    );
    assert.equal(recommendation.factors.season.evidence, EVIDENCE.MISSING);
    assert.equal(recommendation.factors.season.score, null);
  });

  it('treats a non-array seasons field the same way as an empty one', () => {
    for (const seasons of [undefined, null, 'KHARIF']) {
      const result = run([crop('ODD', { seasons })]);
      assert.deepEqual(result.excluded, [], `seasons ${String(seasons)} was gated`);
      assert.equal(result.recommendations[0].factors.season.evidence, EVIDENCE.MISSING);
    }
  });
});

// ── Gate · soil ─────────────────────────────────────────────────────────────

describe('recommendCrops · soil gate', () => {
  it('excludes a crop whose soil suitability is published as 0', () => {
    const result = run([crop('SANDYHATER', { soilSuitability: { black: 0 } })]);

    assert.deepEqual(result.recommendations, []);
    const [excluded] = result.excluded;
    assert.equal(excluded.reason, GATE_REASONS.SOIL_UNSUITABLE);
    assert.equal(excluded.reasonKey, 'cropRec.gateSoil');
    assert.deepEqual(excluded.data, { soilType: 'black', score: 0 });
  });

  it('does NOT gate a crop whose soil suitability is absent — absence is not zero', () => {
    // Only cotton publishes numeric soil scores. Reading an absent key as 0
    // would gate every other crop out of every soil.
    const result = run([crop('UNSCORED', { soilSuitability: undefined })]);

    assert.deepEqual(result.excluded, []);
    const [recommendation] = result.recommendations;
    assert.equal(recommendation.factors.soil.evidence, EVIDENCE.MISSING);
    assert.ok(
      recommendation.cautions.some((caution) => caution.key === 'cropRec.missingSoilSuitability'),
      'the missing soil evidence was not reported',
    );
  });

  it('does not gate on a soil the crop simply does not publish a score for', () => {
    // Cotton publishes black/alluvial/red and nothing else; a laterite farm is
    // "not sourced", not "unsuitable".
    const result = run(
      [crop('COTTONLIKE', { soilSuitability: { black: 3, alluvial: 2, red: 1 } })],
      {
        farm: farm({ soilType: 'laterite' }),
      },
    );

    assert.deepEqual(result.excluded, []);
    assert.equal(result.recommendations[0].factors.soil.evidence, EVIDENCE.MISSING);
  });
});

// ── Gate · support level ────────────────────────────────────────────────────

describe('recommendCrops · support-level gate', () => {
  it('excludes an UNSUPPORTED crop before any scoring runs', () => {
    const result = run([crop('OTHER', { supportLevel: 'UNSUPPORTED' })]);

    assert.deepEqual(result.recommendations, []);
    const [excluded] = result.excluded;
    assert.equal(excluded.reason, GATE_REASONS.UNSUPPORTED);
    assert.equal(excluded.reasonKey, 'cropRec.gateUnsupported');
  });

  it('gates on support level ahead of season, so an unsupported crop never reports a mismatch', () => {
    const result = run([crop('OTHER', { supportLevel: 'UNSUPPORTED', seasons: ['RABI'] })], {
      season: 'KHARIF',
    });
    assert.equal(result.excluded[0].reason, GATE_REASONS.UNSUPPORTED);
  });
});

// ── Gate · water (cannot fire today) ────────────────────────────────────────

describe('recommendCrops · water gate cannot fire while district normals are absent', () => {
  // engine.md: "water need floor unreachable (high-need crop + rainfed + low
  // district rainfall normal)". All three conditions are required and the third
  // needs a normal, which the repository does not have.
  it('is a precondition of this whole block that the normals table is empty', () => {
    assert.equal(
      CLIMATE_NORMALS_AVAILABLE,
      false,
      'climate normals now exist — the water-gate cases below must be rewritten to exercise it',
    );
  });

  it('does not gate a high-need rainfed crop, because there is nothing to compare its need to', () => {
    // 1300 mm of demand on a rainfed field is exactly the case the gate exists
    // for. It survives because no rainfall normal exists to prove it cannot be
    // met — the engine will not gate on an assumption.
    const thirsty = crop('THIRSTY', { waterNeedMm: [700, 1300], droughtSensitivity: 'HIGH' });
    const result = run([thirsty], { farm: RAINFED() });

    assert.deepEqual(result.excluded, []);
    assert.equal(result.recommendations.length, 1);
    assert.equal(result.recommendations[0].cropCode, 'THIRSTY');
  });

  it('says why in `limitations` rather than letting the silence pass for a judgement', () => {
    const result = run([crop('THIRSTY', { waterNeedMm: [700, 1300] })], { farm: RAINFED() });

    const limitation = result.limitations.find(
      (entry) => entry.key === 'cropRec.limitationNoClimateNormals',
    );
    assert.ok(limitation, 'the empty normals table was not reported to the farmer');
    assert.deepEqual(limitation.blockedFactors, ['temp', 'water (rainfed farms only)']);
  });

  it('reports the absent normal on the recommendation itself, not only in aggregate', () => {
    const result = run([crop('THIRSTY')], { farm: RAINFED() });
    const [recommendation] = result.recommendations;

    assert.equal(recommendation.factors.water.evidence, EVIDENCE.MISSING);
    assert.equal(recommendation.factors.water.reasonKey, 'cropRec.missingRainfallNormal');
    assert.ok(
      recommendation.cautions.some((caution) => caution.key === 'cropRec.missingRainfallNormal'),
    );
  });

  it('records in the trace that no normal was found and that the table itself is empty', () => {
    const input = stepOf(run([crop('A')]), CROP_REC_TRACE_STEPS.INPUT);

    assert.equal(input.climateNormalFound, false);
    assert.equal(input.climateNormalsTableAvailable, false);
  });
});

// ── Missing evidence ────────────────────────────────────────────────────────

describe('recommendCrops · a factor with no evidence is excluded, never guessed', () => {
  it('scores a crop with no soil data on 3 factors, not 4, and says so in evidenceRatio', () => {
    // Documented weights: season .30 + soil .25 + water .30 + temp .15 = 1.00.
    // Dropping soil leaves .30 + .30 + .15 = 0.75 — which is the number the
    // task specifies, and which is UNREACHABLE today: S_temp additionally needs
    // a district temperature normal, and the normals table is empty. So the
    // achievable equivalent is asserted instead, together with the exact
    // arithmetic that produces the .25 difference.
    assert.equal(at3(WEIGHTS.season + WEIGHTS.water + WEIGHTS.temp), 0.75);
    assert.equal(at3(1 - WEIGHTS.soil), 0.75);

    const withSoil = run([crop('WITHSOIL', { soilSuitability: { black: 2 } })]);
    const withoutSoil = run([crop('NOSOIL', { soilSuitability: undefined })]);

    // season .30 + soil .25 + water .30 (temp still excluded — no normal).
    assert.equal(withSoil.recommendations[0].evidenceRatio, 0.85);
    // season .30 + water .30.
    assert.equal(withoutSoil.recommendations[0].evidenceRatio, 0.6);

    // The whole of the difference is soil's documented weight, exactly.
    assert.equal(
      at3(withSoil.recommendations[0].evidenceRatio - withoutSoil.recommendations[0].evidenceRatio),
      WEIGHTS.soil,
    );
  });

  it('has temp MISSING for every crop, on every farm, because the table is empty', () => {
    for (const method of ['canal', 'borewell', 'drip', 'sprinkler', 'rainfed', 'unknown']) {
      const result = run([crop('A')], { farm: farm({ irrigationMethod: method }) });
      const [recommendation] = result.recommendations;

      assert.equal(
        recommendation.factors.temp.evidence,
        EVIDENCE.MISSING,
        `temp was scored for irrigationMethod ${method}`,
      );
      assert.equal(recommendation.factors.temp.reasonKey, 'cropRec.missingTempNormal');
    }
  });

  it('has water MISSING for a rainfed farm and SOURCED for an irrigated one', () => {
    const rainfed = run([crop('A')], { farm: RAINFED() }).recommendations[0];
    assert.equal(rainfed.factors.water.evidence, EVIDENCE.MISSING);

    for (const method of ['canal', 'borewell', 'drip', 'sprinkler']) {
      const irrigated = run([crop('A')], { farm: farm({ irrigationMethod: method }) })
        .recommendations[0];
      assert.equal(
        irrigated.factors.water.evidence,
        EVIDENCE.SOURCED,
        `${method} did not count as assured supply`,
      );
      // "Irrigation→mm proxy is our own heuristic and is labeled as such."
      assert.equal(irrigated.factors.water.heuristic, true);
      assert.equal(irrigated.factors.water.basis, 'assured irrigation');
    }

    // `unknown` is not assured supply, so it falls to the rainfed branch.
    const unknown = run([crop('A')], { farm: farm({ irrigationMethod: 'unknown' }) })
      .recommendations[0];
    assert.equal(unknown.factors.water.evidence, EVIDENCE.MISSING);
  });

  it('excludes a crop with NO evidence at all rather than ranking it at zero', () => {
    const blank = crop('BLANK', {
      seasons: [],
      soilSuitability: undefined,
      waterNeedMm: undefined,
      tempOpt: undefined,
    });
    const result = run([blank], { farm: RAINFED() });

    assert.deepEqual(result.recommendations, []);
    const [excluded] = result.excluded;
    assert.equal(excluded.cropCode, 'BLANK');
    assert.equal(excluded.reason, 'NO_EVIDENCE');
    assert.equal(excluded.reasonKey, 'cropRec.gateNoEvidence');
    // A score of 0 would read as "we assessed this crop and it is terrible".
    assert.equal(Object.hasOwn(excluded, 'score'), false);
  });

  it('does not silently score a missing factor as 0.5 or as 0', () => {
    // Two crops identical but for soil evidence. If a missing factor were
    // substituted with a neutral 0.5 (or with 0) the two would be conflated.
    const scored = run([crop('SCORED', { soilSuitability: { black: 2 } })]).recommendations[0];
    const unscored = run([crop('UNSCORED', { soilSuitability: undefined })]).recommendations[0];

    // season 1.0 (single season), soil 2/3 = .667, water 1.0 (LOW, assured):
    //   (.30×1 + .25×.667 + .30×1) ÷ .85 = .76675 ÷ .85 = .902
    assert.equal(scored.score, 0.902);
    // (.30×1 + .30×1) ÷ .60 = 1.0 — the weight soil would have carried is gone,
    // not filled in.
    assert.equal(unscored.score, 1);

    assert.notEqual(scored.score, unscored.score, 'missing soil produced an identical score');

    // The two substitutions the design refuses to make, computed explicitly.
    const asNeutralHalf = at3((0.3 * 1 + 0.25 * 0.5 + 0.3 * 1) / 0.85);
    const asZero = at3((0.3 * 1 + 0.25 * 0 + 0.3 * 1) / 0.85);
    assert.notEqual(unscored.score, asNeutralHalf);
    assert.notEqual(unscored.score, asZero);

    // …and the honest difference between the two crops is visible in the
    // evidence ratio, not hidden inside the score.
    assert.equal(scored.evidenceRatio, 0.85);
    assert.equal(unscored.evidenceRatio, 0.6);
  });

  it('names the crops whose soil was not sourced in `limitations`', () => {
    const result = run([
      crop('ZEBRA', { soilSuitability: undefined }),
      crop('APPLE', { soilSuitability: undefined }),
      crop('SCORED', { soilSuitability: { black: 3 } }),
    ]);

    const limitation = result.limitations.find(
      (entry) => entry.key === 'cropRec.limitationSoilNotSourced',
    );
    assert.deepEqual(limitation.cropCodes, ['APPLE', 'ZEBRA']);
  });
});

// ── Sub-scores ──────────────────────────────────────────────────────────────

describe('recommendCrops · soil sub-score maps the published 0–3 scale onto 0–1', () => {
  const soilScore = (published) =>
    run([crop('X', { soilSuitability: { black: published } })]).recommendations[0].factors.soil;

  it('maps a published 3 to 1.0', () => {
    const factor = soilScore(3);
    assert.equal(factor.score, 1);
    assert.equal(factor.published, 3);
    assert.equal(factor.scaleMax, 3);
    assert.equal(factor.soilType, 'black');
  });

  it('maps a published 2 to 0.667 — a third of the way down, rounded to 3 places', () => {
    assert.equal(soilScore(2).score, 0.667);
  });

  it('maps a published 1 to 0.333', () => {
    assert.equal(soilScore(1).score, 0.333);
  });

  it('never reaches a published 0 as a score, because 0 is a hard gate', () => {
    const result = run([crop('X', { soilSuitability: { black: 0 } })]);
    assert.deepEqual(result.recommendations, []);
    assert.equal(result.excluded[0].reason, GATE_REASONS.SOIL_UNSUITABLE);
  });
});

describe('recommendCrops · drought sensitivity penalises S_water', () => {
  const waterScore = (droughtSensitivity, options) =>
    run([crop('X', { droughtSensitivity })], options).recommendations[0].factors.water;

  it('applies a monotone penalty across the published sensitivity bands', () => {
    // Assured supply halves the penalty: an assured source can still fail, but
    // supply is not the binding constraint.
    assert.equal(waterScore('LOW').score, 1);
    assert.equal(waterScore('LOW_MED').score, 0.95);
    assert.equal(waterScore('MEDIUM').score, 0.9);
    assert.equal(waterScore('MED_HIGH').score, 0.85);
    assert.equal(waterScore('HIGH').score, 0.775);
  });

  it('treats an unpublished sensitivity as no penalty rather than as the worst case', () => {
    assert.equal(waterScore(undefined).score, 1);
    assert.equal(waterScore(undefined).droughtSensitivity, null);
  });

  it('ranks a HIGH-sensitivity crop below a LOW one on an otherwise identical farm', () => {
    const result = run([
      crop('AHIGH', { droughtSensitivity: 'HIGH' }),
      crop('BLOW', { droughtSensitivity: 'LOW' }),
    ]);

    assert.deepEqual(
      result.recommendations.map((entry) => entry.cropCode),
      ['BLOW', 'AHIGH'],
    );
    assert.ok(
      byCode(result.recommendations, 'AHIGH').score < byCode(result.recommendations, 'BLOW').score,
    );
  });

  it('CANNOT distinguish the two on a rainfed farm today — the penalty needs a rainfall normal', () => {
    // The full (un-halved) drought penalty lives on the rainfed branch, which
    // divides the district rainfall normal by the FAO need. With no normal the
    // factor is MISSING for both crops, so drought sensitivity does not reach
    // the score at all and the two are indistinguishable. This is the honest
    // outcome, not a scoring bug — it starts working the moment IMD normals
    // are loaded into shared/constants/climate-normals.js.
    const result = run(
      [crop('AHIGH', { droughtSensitivity: 'HIGH' }), crop('BLOW', { droughtSensitivity: 'LOW' })],
      { farm: RAINFED() },
    );

    const high = byCode(result.recommendations, 'AHIGH');
    const low = byCode(result.recommendations, 'BLOW');
    assert.equal(high.factors.water.evidence, EVIDENCE.MISSING);
    assert.equal(low.factors.water.evidence, EVIDENCE.MISSING);
    assert.equal(high.score, low.score);
  });
});

describe('recommendCrops · season sub-score rewards a more specific calendar', () => {
  const seasonScore = (seasons, season = 'KHARIF') =>
    run([crop('X', { seasons })], { season }).recommendations[0].factors.season.score;

  it('scores a single-season crop highest and a three-season crop lowest', () => {
    assert.equal(seasonScore(['KHARIF']), 1);
    assert.equal(seasonScore(['KHARIF', 'RABI']), 0.95);
    assert.equal(seasonScore(['KHARIF', 'RABI', 'ZAID']), 0.9);
  });

  it('is bounded below by 0.85 — a survivor of the gate does grow in this season', () => {
    assert.ok(seasonScore(['KHARIF', 'RABI', 'ZAID']) >= 0.85);
  });
});

// ── Ranking ─────────────────────────────────────────────────────────────────

describe('recommendCrops · ranking', () => {
  /** Nine survivors with distinct scores, built from soil evidence alone. */
  const nine = () =>
    ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'].map((code, index) =>
      crop(code, { soilSuitability: { black: index % 3 === 0 ? 3 : index % 3 } }),
    );

  it('returns at most the documented top 5', () => {
    const result = run(nine());

    assert.equal(result.recommendations.length, TOP_N);
    assert.equal(stepOf(result, CROP_REC_TRACE_STEPS.RANKING).topN, TOP_N);
    // The ones that did not make the cut are not "excluded" — they were scored.
    assert.deepEqual(result.excluded, []);
    assert.equal(stepOf(result, CROP_REC_TRACE_STEPS.SCORING).perCrop.length, 9);
  });

  it('sorts by score, descending', () => {
    const scores = run(nine()).recommendations.map((entry) => entry.score);
    for (let i = 1; i < scores.length; i += 1) {
      assert.ok(scores[i - 1] >= scores[i], `score rose at position ${i}: ${scores}`);
    }
  });

  it('breaks a score tie on evidenceRatio before cropCode', () => {
    // ZED and ABLE both score exactly 1.0; ZED was scored on more of the
    // documented weight, so it outranks ABLE despite sorting later by code.
    const result = run([
      crop('ABLE', { soilSuitability: undefined }),
      crop('ZED', { soilSuitability: { black: 3 } }),
    ]);

    assert.deepEqual(
      result.recommendations.map((entry) => [entry.cropCode, entry.score, entry.evidenceRatio]),
      [
        ['ZED', 1, 0.85],
        ['ABLE', 1, 0.6],
      ],
    );
  });

  it('breaks a remaining tie on cropCode, so the order is total', () => {
    const result = run([
      crop('BETA', { soilSuitability: undefined }),
      crop('ALPHA', { soilSuitability: undefined }),
      crop('ZED', { soilSuitability: { black: 3 } }),
    ]);

    assert.deepEqual(
      result.recommendations.map((entry) => entry.cropCode),
      ['ZED', 'ALPHA', 'BETA'],
    );
  });

  it('renders identically across ten runs whatever order the registry arrives in', () => {
    const crops = [
      crop('ALPHA', { soilSuitability: undefined }),
      crop('BETA', { soilSuitability: undefined }),
      crop('ZED', { soilSuitability: { black: 3 } }),
      crop('MID', { soilSuitability: { black: 2 } }),
      crop('LOWSOIL', { soilSuitability: { black: 1 } }),
      crop('SIX', { droughtSensitivity: 'HIGH', soilSuitability: undefined }),
    ];
    const expected = run(crops).recommendations.map((entry) => entry.cropCode);

    for (let attempt = 0; attempt < 10; attempt += 1) {
      // Rotate the input: a stable sort over a different arrival order is the
      // only way a partial ordering shows itself.
      const rotated = [
        ...crops.slice(attempt % crops.length),
        ...crops.slice(0, attempt % crops.length),
      ];
      assert.deepEqual(
        run(rotated).recommendations.map((entry) => entry.cropCode),
        expected,
        `run ${attempt} produced a different order`,
      );
    }
  });
});

// ── Property · every reason cites a registry field with a sourceRef ─────────

describe('recommendCrops · property: every reason references a field with a sourceRef', () => {
  // engine.md §Testing: "Property: every output reason must reference a
  // registry field with a sourceRef."
  const assertProperty = (result, registryCrops) => {
    const documents = new Map(registryCrops.map((entry) => [entry.cropCode, entry]));
    let checked = 0;

    for (const recommendation of result.recommendations) {
      const document = documents.get(recommendation.cropCode);
      const refs = document.sourceRefs ?? [];
      const taggedFields = new Set(refs.filter((entry) => entry.field).map((entry) => entry.field));
      // An untagged ref applies to the document as a whole.
      const hasDocumentLevelRef = refs.some((entry) => !entry.field);

      assert.ok(
        recommendation.reasons.length > 0,
        `${recommendation.cropCode} produced no reasons`,
      );

      for (const reason of recommendation.reasons) {
        assert.ok(reason.key, 'a reason carried no i18n key');
        assert.ok(
          typeof reason.field === 'string' && reason.field.length > 0,
          `${recommendation.cropCode}: reason ${reason.key} names no registry field`,
        );
        assert.ok(
          taggedFields.has(reason.field) || hasDocumentLevelRef,
          `${recommendation.cropCode}: reason ${reason.key} cites ${reason.field}, which has no sourceRef`,
        );
        checked += 1;
      }
    }

    return checked;
  };

  it('holds for a fully described crop on an irrigated farm', () => {
    const crops = [crop('FULL', { soilSuitability: { black: 3 } })];
    const checked = assertProperty(run(crops), crops);
    // season + soil + water are sourced; temp is not (no normal).
    assert.equal(checked, 3);
  });

  it('holds when some factors are missing — a reason is only emitted for sourced evidence', () => {
    const crops = [crop('PARTIAL', { seasons: [], soilSuitability: undefined })];
    const result = run(crops);

    assert.deepEqual(
      result.recommendations[0].reasons.map((reason) => reason.field),
      ['waterNeedMm'],
    );
    assert.equal(assertProperty(result, crops), 1);
  });

  it('holds when the document carries only untagged, document-level references', () => {
    const crops = [
      crop('UNTAGGED', {
        soilSuitability: { black: 3 },
        sourceRefs: [
          { org: 'FAO', title: 'Chapter 3', url: null, accessed: '2026-08-13', confidence: 'P' },
        ],
      }),
    ];
    assert.equal(assertProperty(run(crops), crops), 3);
  });

  it('collects the referenced sources onto the recommendation itself', () => {
    const result = run([crop('FULL', { soilSuitability: { black: 3 } })]);
    const fields = result.recommendations[0].sources.map((entry) => entry.field);

    // The fields the reasons rested on, plus droughtSensitivity, which modifies
    // S_water. tempOpt is absent because temp was never scored.
    assert.deepEqual(fields.sort(), [
      'droughtSensitivity',
      'seasons',
      'soilSuitability',
      'waterNeedMm',
    ]);
    for (const source of result.recommendations[0].sources) {
      assert.ok(source.org && source.title, 'a source carried no attribution');
      assert.ok(source.accessed, 'a source carried no access date');
    }
  });

  it('holds for every recommendation the real registry can produce', () => {
    const registryCrops = composeRegistry().documents.filter(
      (document) => document.supportLevel !== 'UNSUPPORTED',
    );

    let checked = 0;
    for (const [farmFixture, season] of [
      [farm({ soilType: 'black', irrigationMethod: 'rainfed' }), 'KHARIF'],
      [farm({ soilType: 'clay', irrigationMethod: 'canal' }), 'KHARIF'],
      [farm({ soilType: 'loamy', irrigationMethod: 'canal' }), 'RABI'],
      [farm({ soilType: 'sandy', irrigationMethod: 'drip' }), 'ZAID'],
    ]) {
      checked += assertProperty(
        recommendCrops({ registryCrops, farm: farmFixture, season }),
        registryCrops,
      );
    }
    assert.ok(checked > 0, 'the real registry produced no reasons to check');
  });
});

// ── NFR-7 · no yield or profit claims ──────────────────────────────────────

describe('recommendCrops · makes no yield or profit claim (NFR-7)', () => {
  const FORBIDDEN = /yield|profit|income|earn|price/i;

  const offendingKeys = (value, path = '') => {
    if (value === null || typeof value !== 'object') return [];
    if (Array.isArray(value))
      return value.flatMap((entry, index) => offendingKeys(entry, `${path}[${index}]`));

    return Object.entries(value).flatMap(([key, entry]) => [
      ...(FORBIDDEN.test(key) ? [`${path}.${key}`] : []),
      ...offendingKeys(entry, `${path}.${key}`),
    ]);
  };

  it('emits no yield/profit/income/earnings/price key anywhere in a recommendation', () => {
    const result = run([crop('FULL', { soilSuitability: { black: 3 } }), crop('B')], {
      preference: 'cash',
    });

    for (const recommendation of result.recommendations) {
      assert.deepEqual(
        offendingKeys(recommendation, recommendation.cropCode),
        [],
        'a recommendation carried a yield or profit key',
      );
    }
  });

  it('holds across the whole response for the real registry', () => {
    const registryCrops = composeRegistry().documents.filter(
      (document) => document.supportLevel !== 'UNSUPPORTED',
    );
    const result = recommendCrops({
      registryCrops,
      farm: farm({ soilType: 'black', irrigationMethod: 'canal' }),
      season: 'KHARIF',
    });

    for (const recommendation of result.recommendations) {
      assert.deepEqual(offendingKeys(recommendation, recommendation.cropCode), []);
    }
  });
});

// ── Cautions ────────────────────────────────────────────────────────────────

describe('recommendCrops · cautions record what the score could not take in', () => {
  it('records a preference as noted-but-unscored, because it has no documented weight', () => {
    const result = run([crop('A')], { preference: 'cash' });

    const caution = result.recommendations[0].cautions.find(
      (entry) => entry.key === 'cropRec.preferenceNotScored',
    );
    assert.deepEqual(caution.data, { preference: 'cash' });
  });

  it('says nothing about a preference of "any"', () => {
    const result = run([crop('A')], { preference: 'any' });
    assert.ok(
      !result.recommendations[0].cautions.some(
        (entry) => entry.key === 'cropRec.preferenceNotScored',
      ),
    );
  });

  it('carries the registry’s own recorded data gaps through to the farmer', () => {
    const result = run([crop('A', { dataGaps: ['FAO-56 Kc stages not sourced'] })]);

    const caution = result.recommendations[0].cautions.find(
      (entry) => entry.key === 'cropRec.registryDataGaps',
    );
    assert.deepEqual(caution.data.gaps, ['FAO-56 Kc stages not sourced']);
  });
});

// ── R12 · trace ─────────────────────────────────────────────────────────────

describe('recommendCrops · trace (R12)', () => {
  it('records the inputs, the gates, the scoring and the ranking, in that order', () => {
    const result = run([crop('KEEP'), crop('DROP', { seasons: ['RABI'] })], {
      preference: 'food',
    });

    assert.deepEqual(
      result.trace.map((entry) => entry.step),
      [
        CROP_REC_TRACE_STEPS.INPUT,
        CROP_REC_TRACE_STEPS.GATES,
        CROP_REC_TRACE_STEPS.SCORING,
        CROP_REC_TRACE_STEPS.RANKING,
      ],
    );
  });

  it('publishes every input the ranking depended on', () => {
    const result = run([crop('A'), crop('B')], { preference: 'food' });

    assert.deepEqual(stepOf(result, CROP_REC_TRACE_STEPS.INPUT), {
      step: 'INPUT',
      season: 'KHARIF',
      preference: 'food',
      soilType: 'black',
      irrigationMethod: 'canal',
      state: 'Maharashtra',
      district: 'Nagpur',
      candidateCount: 2,
      climateNormalFound: false,
      climateNormalsTableAvailable: false,
    });
  });

  it('publishes each exclusion with its reason and the number of survivors', () => {
    const result = run([crop('KEEP'), crop('DROP', { seasons: ['RABI'] })]);

    assert.deepEqual(stepOf(result, CROP_REC_TRACE_STEPS.GATES), {
      step: 'GATES',
      excluded: [{ cropCode: 'DROP', reason: GATE_REASONS.SEASON_MISMATCH }],
      survivors: 1,
    });
  });

  it('publishes the weights it used and every score it computed', () => {
    const result = run([crop('A', { soilSuitability: { black: 3 } }), crop('B')]);
    const scoring = stepOf(result, CROP_REC_TRACE_STEPS.SCORING);

    assert.deepEqual(scoring.weights, WEIGHTS);
    assert.deepEqual(scoring.perCrop, [
      { cropCode: 'A', score: 1, evidenceRatio: 0.85 },
      { cropCode: 'B', score: 1, evidenceRatio: 0.6 },
    ]);
  });

  it('publishes the ranked order that was actually served', () => {
    const result = run([crop('A', { soilSuitability: { black: 3 } }), crop('B')]);

    assert.deepEqual(stepOf(result, CROP_REC_TRACE_STEPS.RANKING), {
      step: 'RANKING',
      topN: TOP_N,
      ranked: ['A', 'B'],
    });
    assert.deepEqual(
      result.recommendations.map((entry) => entry.cropCode),
      stepOf(result, CROP_REC_TRACE_STEPS.RANKING).ranked,
    );
  });

  it('is structured data, never prose', () => {
    for (const entry of run([crop('A')]).trace) {
      assert.equal(typeof entry, 'object');
      assert.equal(typeof entry.step, 'string');
    }
  });
});

// ── Purity ──────────────────────────────────────────────────────────────────

describe('recommendCrops · purity', () => {
  it('is deterministic: identical inputs give a deeply equal result', () => {
    const input = {
      registryCrops: [crop('A', { soilSuitability: { black: 2 } }), crop('B')],
      farm: IRRIGATED(),
      season: 'KHARIF',
      preference: 'cash',
    };

    assert.deepEqual(recommendCrops(input), recommendCrops(input));
  });

  it('accepts deeply frozen inputs without throwing or mutating them', () => {
    const registryCrops = deepFreeze([crop('A', { soilSuitability: { black: 2 } }), crop('B')]);
    const frozenFarm = deepFreeze(IRRIGATED());
    const snapshot = JSON.parse(JSON.stringify(registryCrops));

    const result = recommendCrops({ registryCrops, farm: frozenFarm, season: 'KHARIF' });

    assert.equal(result.recommendations.length, 2);
    assert.deepEqual(JSON.parse(JSON.stringify(registryCrops)), snapshot);
  });

  it('survives being called with nothing at all', () => {
    const result = recommendCrops();

    assert.deepEqual(result.recommendations, []);
    assert.deepEqual(result.excluded, []);
    assert.ok(Array.isArray(result.trace));
    assert.ok(
      result.limitations.some((entry) => entry.key === 'cropRec.limitationNoClimateNormals'),
    );
  });
});

// ── Golden cases (engine.md §Testing) ───────────────────────────────────────

/**
 * These run against the REAL knowledge files (`crops.base.json` +
 * `crops.agronomy.json`, composed exactly as the seed composes them), so the
 * seasons, water needs, soil scores, drought bands and temperature optima are
 * the sourced ones — nothing agronomic is invented here.
 *
 * Each block asserts what today's data can actually support and names, in a
 * comment, the input that is missing for the rest.
 */
describe('recommendCrops · golden cases', () => {
  const registryCrops = composeRegistry().documents.filter(
    (document) => document.supportLevel !== 'UNSUPPORTED',
  );

  const golden = (farmFixture, season) =>
    recommendCrops({ registryCrops, farm: farmFixture, season });

  const ranked = (result) => result.recommendations.map((entry) => entry.cropCode);
  const scoredCodes = (result) =>
    stepOf(result, CROP_REC_TRACE_STEPS.SCORING).perCrop.map((entry) => entry.cropCode);

  it('has the nine sourced crops to rank', () => {
    assert.deepEqual(registryCrops.map((document) => document.cropCode).sort(), [
      'CHILLI',
      'COTTON',
      'MAIZE',
      'ONION',
      'POTATO',
      'RICE',
      'SOYBEAN',
      'TOMATO',
      'WHEAT',
    ]);
  });

  describe('black-soil Kharif rainfed Nagpur', () => {
    const result = golden(
      {
        soilType: 'black',
        irrigationMethod: 'rainfed',
        location: { state: 'Maharashtra', district: 'Nagpur' },
      },
      'KHARIF',
    );

    it('ranks cotton and soybean high — the assertable half of the golden case', () => {
      // Cotton is the only crop that publishes a soil score, and black soil is
      // its published 3. Soybean is Kharif-only, so its season score is 1.0.
      assert.equal(ranked(result)[0], 'COTTON');
      assert.ok(ranked(result).slice(0, 2).includes('SOYBEAN'));

      const cotton = byCode(result.recommendations, 'COTTON');
      assert.equal(cotton.score, 1);
      // season .30 + soil .25 — water and temp both need a district normal.
      assert.equal(cotton.evidenceRatio, 0.55);
      assert.equal(cotton.factors.soil.published, 3);
    });

    it('does NOT gate rice out — the water gate needs a Nagpur rainfall normal that does not exist', () => {
      // engine.md expects "rice gated out (water)". That gate requires
      // "high-need crop + rainfed + LOW DISTRICT RAINFALL NORMAL"; the third
      // term lives in shared/constants/climate-normals.js, which is empty by
      // design. Until an IMD Kharif rainfall normal for Nagpur is loaded, rice
      // survives the gates and is scored on its season evidence alone.
      assert.equal(byCode(result.excluded, 'RICE'), undefined);
      assert.ok(scoredCodes(result).includes('RICE'));

      const rice = stepOf(result, CROP_REC_TRACE_STEPS.SCORING).perCrop.find(
        (entry) => entry.cropCode === 'RICE',
      );
      // Only the season factor is backed by data — 0.30 of the documented 1.00.
      assert.equal(rice.evidenceRatio, 0.3);

      // It is absent from the served top 5, but only because it ties with three
      // other 0.95/0.30 crops and loses the cropCode tie-break. That is an
      // alphabetical accident, NOT the agronomic exclusion the golden case
      // wants, so it is recorded rather than asserted as the desired behaviour.
      assert.ok(!ranked(result).includes('RICE'));
      assert.deepEqual(
        stepOf(result, CROP_REC_TRACE_STEPS.SCORING)
          .perCrop.filter((entry) => entry.score === 0.95 && entry.evidenceRatio === 0.3)
          .map((entry) => entry.cropCode),
        ['CHILLI', 'MAIZE', 'ONION', 'RICE'],
      );
    });

    it('reports that soil ranking is weak because only cotton publishes soil scores', () => {
      const limitation = result.limitations.find(
        (entry) => entry.key === 'cropRec.limitationSoilNotSourced',
      );
      assert.deepEqual(limitation.cropCodes, ['CHILLI', 'MAIZE', 'ONION', 'RICE', 'SOYBEAN']);

      // Cotton is the only survivor scored on more than the season weight.
      const aboveSeasonOnly = result.recommendations.filter((entry) => entry.evidenceRatio > 0.3);
      assert.deepEqual(
        aboveSeasonOnly.map((entry) => entry.cropCode),
        ['COTTON'],
      );
    });

    it('excludes tomato for NO_EVIDENCE — the real-data instance of the every-factor-missing path', () => {
      // crops.base.json records no seasons and no soilSuitability for tomato,
      // the farm is rainfed so water is unknowable, and temp needs a normal.
      const tomato = byCode(result.excluded, 'TOMATO');
      assert.equal(tomato.reason, 'NO_EVIDENCE');
      assert.equal(tomato.reasonKey, 'cropRec.gateNoEvidence');
    });

    it('excludes the Rabi-only crops by season, with their published calendars attached', () => {
      for (const cropCode of ['WHEAT', 'POTATO']) {
        const excluded = byCode(result.excluded, cropCode);
        assert.equal(excluded.reason, GATE_REASONS.SEASON_MISMATCH, cropCode);
        assert.deepEqual(excluded.data, { season: 'KHARIF', cropSeasons: ['RABI'] });
      }
    });

    it('names the missing climate normals in `limitations`', () => {
      assert.ok(
        result.limitations.some((entry) => entry.key === 'cropRec.limitationNoClimateNormals'),
      );
    });
  });

  describe('clay irrigated Kharif Raipur', () => {
    const result = golden(
      {
        soilType: 'clay',
        irrigationMethod: 'canal',
        location: { state: 'Chhattisgarh', district: 'Raipur' },
      },
      'KHARIF',
    );

    it('CANNOT put rice top — no soil score is published for rice on any soil', () => {
      // engine.md expects "clay irrigated Kharif Raipur → rice top". Two
      // sourced inputs are missing for that:
      //   1. scoring-model.md describes clay as rice's best soil in PROSE
      //      ("clay, clay-loam/alluvial (needs standing water) → sandy 0") but
      //      publishes numeric scores for cotton alone, so crops.base.json has
      //      no rice soilSuitability map and rice forfeits the 0.25 soil weight
      //      that would lift it above cotton on a clay field.
      //   2. rice's HIGH drought sensitivity applies the largest S_water
      //      penalty, and the assured-irrigation branch has no rainfall figure
      //      with which to offset it.
      // What IS assertable: rice is scored rather than gated, on the irrigation
      // heuristic, and its soil factor is explicitly MISSING.
      const rice = byCode(result.recommendations, 'RICE') ?? null;
      assert.equal(rice, null, 'rice reached the top 5 — re-check this comment against the data');

      assert.ok(scoredCodes(result).includes('RICE'));
      assert.equal(byCode(result.excluded, 'RICE'), undefined);
      assert.equal(ranked(result)[0], 'COTTON');

      const limitation = result.limitations.find(
        (entry) => entry.key === 'cropRec.limitationSoilNotSourced',
      );
      assert.ok(
        limitation.cropCodes.includes('RICE'),
        'rice’s missing soil score was not reported',
      );
    });

    it('scores water for every survivor, because the supply is assured', () => {
      for (const recommendation of result.recommendations) {
        assert.equal(recommendation.factors.water.evidence, EVIDENCE.SOURCED);
        // Rule 9: our own proxy, labelled as an estimate.
        assert.equal(recommendation.factors.water.heuristic, true);
        assert.equal(recommendation.evidenceRatio, 0.6);
      }
    });

    it('keeps tomato in the ranking on water evidence alone, rather than dropping it', () => {
      // Same crop that was NO_EVIDENCE on the rainfed Nagpur farm: with an
      // assured supply one factor becomes knowable, so it is scored — on 0.30
      // of the documented weight, and it says so.
      const scoring = stepOf(result, CROP_REC_TRACE_STEPS.SCORING).perCrop.find(
        (entry) => entry.cropCode === 'TOMATO',
      );
      assert.equal(scoring.evidenceRatio, 0.3);
    });

    it('still cannot consider temperature, and says so', () => {
      assert.ok(
        result.limitations.some((entry) => entry.key === 'cropRec.limitationNoClimateNormals'),
      );
      for (const recommendation of result.recommendations) {
        assert.equal(recommendation.factors.temp.evidence, EVIDENCE.MISSING);
      }
    });
  });

  describe('Rabi loam, Punjab-like', () => {
    // engine.md states no irrigation method for this case; canal is chosen so
    // the water factor is exercised at all. It is a test-fixture choice, not an
    // agronomic claim about Punjab.
    const result = golden(
      {
        soilType: 'loamy',
        irrigationMethod: 'canal',
        location: { state: 'Punjab', district: 'Ludhiana' },
      },
      'RABI',
    );

    it('puts wheat first — the assertable part of "wheat/potato/onion"', () => {
      assert.equal(ranked(result)[0], 'WHEAT');
      assert.equal(byCode(result.recommendations, 'WHEAT').score, 0.975);
    });

    it('carries onion and potato into the top 5', () => {
      assert.ok(ranked(result).includes('ONION'));
      assert.ok(ranked(result).includes('POTATO'));
    });

    it('CANNOT make wheat/potato/onion the top three — no soil evidence separates them', () => {
      // Chilli and maize tie at 0.90 above potato's 0.887 purely on season
      // specificity. Nothing else can separate them: no crop but cotton
      // publishes a soilSuitability score, so loam contributes nothing to any
      // of these five, and temp is unavailable. A published soil-suitability
      // row for loam (scoring-model.md describes wheat as "well-drained
      // loam/clay-loam" in prose, without scores) is the missing input.
      assert.deepEqual(ranked(result), ['WHEAT', 'CHILLI', 'MAIZE', 'ONION', 'POTATO']);
      for (const recommendation of result.recommendations) {
        assert.equal(recommendation.factors.soil.evidence, EVIDENCE.MISSING);
      }
    });

    it('gates the Kharif-only crops out by season', () => {
      for (const cropCode of ['COTTON', 'SOYBEAN']) {
        assert.equal(byCode(result.excluded, cropCode).reason, GATE_REASONS.SEASON_MISMATCH);
      }
    });
  });
});
