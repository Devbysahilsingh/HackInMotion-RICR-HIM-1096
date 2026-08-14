/**
 * Yield evidence ladder — engine unit tests.
 *
 * The engine is pure, so every case is a fixture in / object out: no database,
 * no server, no clock. The fixture lookup below has the *shape* of the
 * committed artefact with a handful of hand-checkable entries; the tests that
 * run against the real 455,359-row artefact live in
 * `tests/services/yieldLookupArtifact.test.js` and `tests/api/yield.test.js`.
 *
 * Every rung of the documented ladder gets its own test, because "falls back
 * correctly" is the whole contract:
 *
 *   district × season → district annual → state × season → state
 *                                                        → INSUFFICIENT_EVIDENCE
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  ATTEMPT,
  EVIDENCE_REASONS,
  RESOLUTION,
  TIER_SPECIFICITY,
  matchGeography,
  resolveEvidence,
} from '../../src/engines/yield/resolveEvidence.js';
import { TIERS, TIER_ORDER } from '../../src/engines/yield/lookupSchema.js';

// ── Fixtures ────────────────────────────────────────────────────────────────

const entry = (median, overrides = {}) => ({
  medianYieldTHa: median,
  sdYieldTHa: 0.5,
  minYieldTHa: median - 0.5,
  maxYieldTHa: median + 0.5,
  n: 5,
  years: [2018, 2019, 2020, 2021, 2022],
  latestYear: 2022,
  ...overrides,
});

/** Punjab(3)/Ludhiana(36) with WHEAT at every tier, so each can be knocked out. */
const fullLookup = () => ({
  crops: ['WHEAT', 'RICE'],
  geo: {
    states: { PUNJAB: '3' },
    districts: { '3|LUDHIANA': '36' },
    names: { '3|36': { state: 'Punjab', district: 'Ludhiana' } },
  },
  tiers: {
    [TIERS.DISTRICT_SEASON]: { '3|36|WHEAT|RABI': entry(5.0) },
    [TIERS.DISTRICT_ANNUAL]: { '3|36|WHEAT': entry(4.5, { basis: 'WHOLE_YEAR' }) },
    [TIERS.STATE_SEASON]: { '3|WHEAT|RABI': entry(4.0) },
    [TIERS.STATE]: { '3|WHEAT': entry(3.5) },
  },
});

const base = { cropCode: 'WHEAT', state: 'Punjab', district: 'Ludhiana', season: 'RABI' };

// ── Geography matching ──────────────────────────────────────────────────────

describe('matchGeography', () => {
  it('resolves a state and district to their government codes', () => {
    const matched = matchGeography(fullLookup(), { state: 'Punjab', district: 'Ludhiana' });
    assert.equal(matched.stateCode, '3');
    assert.equal(matched.districtCode, '36');
    assert.equal(matched.districtMatched, true);
    // The government's own spelling comes back, so the UI shows what matched.
    assert.equal(matched.district, 'Ludhiana');
  });

  it('is insensitive to case and spacing but not to a different name', () => {
    const lookup = fullLookup();
    assert.equal(
      matchGeography(lookup, { state: '  punjab ', district: 'LUDHIANA' }).districtCode,
      '36',
    );
    // A pre-rename name is a genuinely different district as far as this is
    // concerned — the whole point of refusing to fuzzy match.
    assert.equal(
      matchGeography(lookup, { state: 'Punjab', district: 'Ludhiyana' }).districtCode,
      null,
    );
  });

  it('never resolves a district when its state did not resolve', () => {
    const matched = matchGeography(fullLookup(), { state: 'Atlantis', district: 'Ludhiana' });
    assert.equal(matched.stateCode, null);
    assert.equal(matched.districtCode, null);
  });
});

// ── The ladder, rung by rung ────────────────────────────────────────────────

describe('resolveEvidence · walks the documented ladder', () => {
  it('stops at district × season when it has one', () => {
    const result = resolveEvidence({ lookup: fullLookup(), ...base });
    assert.equal(result.resolution, RESOLUTION.RESOLVED);
    assert.equal(result.tier, TIERS.DISTRICT_SEASON);
    assert.equal(result.entry.medianYieldTHa, 5.0);
    assert.equal(result.specificity, TIER_SPECIFICITY[TIERS.DISTRICT_SEASON]);
    assert.deepEqual(
      result.attempts.map((a) => a.outcome),
      [ATTEMPT.HIT],
      'the ladder must not keep walking after a hit',
    );
  });

  it('falls to the district annual figure when the season row is missing', () => {
    const lookup = fullLookup();
    delete lookup.tiers[TIERS.DISTRICT_SEASON]['3|36|WHEAT|RABI'];

    const result = resolveEvidence({ lookup, ...base });
    assert.equal(result.tier, TIERS.DISTRICT_ANNUAL);
    assert.equal(result.entry.medianYieldTHa, 4.5);
    assert.equal(result.entry.basis, 'WHOLE_YEAR');
    assert.deepEqual(
      result.attempts.map((a) => `${a.tier}:${a.outcome}`),
      [`${TIERS.DISTRICT_SEASON}:${ATTEMPT.MISS}`, `${TIERS.DISTRICT_ANNUAL}:${ATTEMPT.HIT}`],
    );
  });

  it('falls to state × season when the district has nothing', () => {
    const lookup = fullLookup();
    delete lookup.tiers[TIERS.DISTRICT_SEASON]['3|36|WHEAT|RABI'];
    delete lookup.tiers[TIERS.DISTRICT_ANNUAL]['3|36|WHEAT'];

    const result = resolveEvidence({ lookup, ...base });
    assert.equal(result.tier, TIERS.STATE_SEASON);
    assert.equal(result.entry.medianYieldTHa, 4.0);
  });

  it('falls to the bare state figure last', () => {
    const lookup = fullLookup();
    delete lookup.tiers[TIERS.DISTRICT_SEASON]['3|36|WHEAT|RABI'];
    delete lookup.tiers[TIERS.DISTRICT_ANNUAL]['3|36|WHEAT'];
    delete lookup.tiers[TIERS.STATE_SEASON]['3|WHEAT|RABI'];

    const result = resolveEvidence({ lookup, ...base });
    assert.equal(result.tier, TIERS.STATE);
    assert.equal(result.specificity, 'BROAD');
  });

  it('reports INSUFFICIENT_EVIDENCE rather than inventing a district value', () => {
    const lookup = fullLookup();
    for (const tier of TIER_ORDER) lookup.tiers[tier] = {};

    const result = resolveEvidence({ lookup, ...base });
    assert.equal(result.resolution, RESOLUTION.INSUFFICIENT_EVIDENCE);
    assert.equal(result.reason, EVIDENCE_REASONS.NO_EVIDENCE);
    assert.equal(result.entry, null);
    assert.equal(result.tier, null);
    // All four rungs were tried and all four are recorded.
    assert.equal(result.attempts.length, 4);
    assert.ok(result.attempts.every((a) => a.outcome === ATTEMPT.MISS));
  });

  it('walks the rungs in exactly the documented order', () => {
    const lookup = fullLookup();
    for (const tier of TIER_ORDER) lookup.tiers[tier] = {};
    const result = resolveEvidence({ lookup, ...base });
    assert.deepEqual(
      result.attempts.map((a) => a.tier),
      TIER_ORDER,
    );
  });
});

// ── Degradation paths ───────────────────────────────────────────────────────

describe('resolveEvidence · degrades honestly', () => {
  it('skips the district rungs when the district name does not match', () => {
    // "Ludhiyana" is not "Ludhiana". The district rungs cannot be attempted,
    // and the response says so rather than silently using a neighbour.
    const result = resolveEvidence({ lookup: fullLookup(), ...base, district: 'Ludhiyana' });
    assert.equal(result.tier, TIERS.STATE_SEASON);

    const skipped = result.attempts.filter((a) => a.outcome === ATTEMPT.SKIPPED);
    assert.equal(skipped.length, 2);
    assert.deepEqual(skipped[0].missing, ['districtCode']);
    assert.equal(result.matched.districtMatched, false);
  });

  it('skips both season rungs when the season is unknown', () => {
    const result = resolveEvidence({ lookup: fullLookup(), ...base, season: null });
    assert.equal(result.tier, TIERS.DISTRICT_ANNUAL);
    const skipped = result.attempts.filter((a) => a.outcome === ATTEMPT.SKIPPED);
    assert.ok(skipped.some((a) => a.missing.includes('season')));
  });

  it('refuses a crop the lookup does not carry, naming no crop of its own', () => {
    // Cotton and tomato reach this branch in production. The engine knows only
    // that the lookup lacks them (CLAUDE.md rule 4).
    for (const cropCode of ['COTTON', 'TOMATO', 'SUGARCANE']) {
      const result = resolveEvidence({ lookup: fullLookup(), ...base, cropCode });
      assert.equal(result.resolution, RESOLUTION.INSUFFICIENT_EVIDENCE);
      assert.equal(result.reason, EVIDENCE_REASONS.CROP_NOT_SUPPORTED);
      assert.equal(
        result.attempts.length,
        0,
        'no rung should be attempted for an unsupported crop',
      );
    }
  });

  it('stops at the state when the state itself does not resolve', () => {
    const result = resolveEvidence({ lookup: fullLookup(), ...base, state: 'Atlantis' });
    assert.equal(result.reason, EVIDENCE_REASONS.STATE_UNRESOLVED);
    assert.equal(result.attempts.length, 0);
  });

  it('reports a missing lookup as an operational fault, not as absent data', () => {
    for (const lookup of [null, undefined, {}, { crops: [] }]) {
      const result = resolveEvidence({ lookup, ...base });
      assert.equal(result.resolution, RESOLUTION.INSUFFICIENT_EVIDENCE);
      assert.equal(result.reason, EVIDENCE_REASONS.LOOKUP_UNAVAILABLE);
    }
  });

  it('carries an i18n key for every failure, never prose', () => {
    const results = [
      resolveEvidence({ lookup: fullLookup(), ...base, cropCode: 'COTTON' }),
      resolveEvidence({ lookup: fullLookup(), ...base, state: 'Atlantis' }),
      resolveEvidence({ lookup: null, ...base }),
    ];
    for (const result of results) {
      assert.match(result.reasonKey, /^yield\./);
    }
  });
});

// ── Trace (rule R12) ────────────────────────────────────────────────────────

describe('resolveEvidence · emits a trace for every outcome', () => {
  it('records the inputs, the geo match, the whole walk and the evidence', () => {
    const result = resolveEvidence({ lookup: fullLookup(), ...base });
    const steps = result.trace.map((s) => s.step);
    assert.deepEqual(steps, ['INPUT', 'GEO_MATCH', 'LADDER', 'EVIDENCE']);

    const evidenceStep = result.trace.at(-1);
    assert.equal(evidenceStep.medianYieldTHa, 5.0);
    assert.deepEqual(evidenceStep.years, [2018, 2019, 2020, 2021, 2022]);
    assert.equal(evidenceStep.observations, 5);
  });

  it('names the unmatched district input so the UI can explain a state answer', () => {
    const result = resolveEvidence({ lookup: fullLookup(), ...base, district: 'Ludhiyana' });
    const geo = result.trace.find((s) => s.step === 'GEO_MATCH');
    assert.equal(geo.districtUnmatchedInput, 'Ludhiyana');
    assert.equal(geo.districtMatched, false);
  });

  it('still traces when nothing was found', () => {
    const result = resolveEvidence({ lookup: fullLookup(), ...base, state: 'Atlantis' });
    assert.ok(result.trace.some((s) => s.step === 'NO_EVIDENCE'));
  });
});
