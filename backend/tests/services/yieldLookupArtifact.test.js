/**
 * The committed yield lookup — integrity and reality checks.
 *
 * Everything above this file tests the pipeline with invented fixtures. This
 * one tests the artefact that actually ships: `datasets/lookup/yield-lookup.json`,
 * built from 455,359 Government of India district returns.
 *
 * Two jobs:
 *   1. **Integrity** — the shape, the policy and the decisions hold. Cotton and
 *      tomato are absent; no entry exists below the evidence floor.
 *   2. **Reality** — the numbers are agronomically true. Punjab's wheat is
 *      around 5 t/ha because Punjab's wheat *is* around 5 t/ha, and if a future
 *      refresh breaks that, this suite says so rather than a farmer finding out.
 *
 * The bounds below are deliberately generous and are **test guards, not
 * agronomic constants** — nothing in `src/` reads them. They exist to catch a
 * unit slip or a corrupted rebuild, which is the failure mode that would put an
 * impossible number in front of a farmer.
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { MIN_OBSERVATIONS, TIERS, geoKey } from '../../src/services/yieldLookupBuilder.js';

const LOOKUP_PATH = fileURLToPath(
  new URL('../../../datasets/lookup/yield-lookup.json', import.meta.url),
);
const QUALITY_PATH = fileURLToPath(
  new URL('../../../datasets/yield/metadata/quality-report.json', import.meta.url),
);

const SUPPORTED = ['CHILLI', 'MAIZE', 'ONION', 'POTATO', 'RICE', 'SOYBEAN', 'WHEAT'];
const EXCLUDED = ['COTTON', 'TOMATO'];

/**
 * Outer limits no Indian district average has ever reached, by a wide margin.
 * A median above these means a unit changed, not that a district did well.
 */
const SANITY_CEILING_T_HA = {
  RICE: 12,
  WHEAT: 9,
  MAIZE: 16,
  SOYBEAN: 6,
  CHILLI: 16,
  ONION: 90,
  POTATO: 110,
};

let lookup;
let quality;

before(() => {
  assert.equal(
    existsSync(LOOKUP_PATH),
    true,
    'datasets/lookup/yield-lookup.json is missing — run `npm run yield:build`',
  );
  lookup = JSON.parse(readFileSync(LOOKUP_PATH, 'utf8'));
  quality = JSON.parse(readFileSync(QUALITY_PATH, 'utf8'));
});

const allEntries = function* () {
  for (const [tier, entries] of Object.entries(lookup.tiers)) {
    for (const [key, entry] of Object.entries(entries)) yield { tier, key, entry };
  }
};

const cropOf = (key) => {
  const parts = key.split('|');
  return SUPPORTED.includes(parts[parts.length - 1])
    ? parts[parts.length - 1]
    : parts[parts.length - 2];
};

// ── Scope decisions ─────────────────────────────────────────────────────────

describe('yield lookup — scope', () => {
  it('covers exactly the seven crops with sufficient evidence', () => {
    assert.deepEqual([...lookup.crops].sort(), SUPPORTED);
  });

  it('contains no cotton and no tomato, at any tier', () => {
    // Cotton: the source publishes 170 kg bales labelled "Tonnes" (audit D4).
    // Tomato: 13 districts, latest 2014-15 (audit §5). Both excluded by the
    // registry carrying no apyCropName, so this asserts the data decision held
    // all the way through the pipeline.
    for (const { key } of allEntries()) {
      for (const crop of EXCLUDED) {
        assert.equal(key.includes(crop), false, `${crop} leaked into ${key}`);
      }
    }
  });

  it('records why each excluded crop was excluded', () => {
    const excluded = quality.refinement.cropsExcluded.map((c) => c.cropCode).sort();
    assert.deepEqual(excluded, EXCLUDED);
    for (const crop of quality.refinement.cropsExcluded) {
      assert.match(crop.reason, /DELIBERATE/, `${crop.cropCode} has no recorded reason`);
    }
  });

  it('provides all four fallback tiers', () => {
    for (const tier of Object.values(TIERS)) {
      assert.ok(Object.keys(lookup.tiers[tier]).length > 0, `${tier} is empty`);
    }
  });
});

// ── Structural integrity ────────────────────────────────────────────────────

describe('yield lookup — integrity', () => {
  it('states its unit once, and it is the unit the entries are in', () => {
    assert.equal(lookup.unit, 'tonnes_per_hectare');
  });

  it('carries the attribution the licence requires', () => {
    assert.match(lookup.source.attribution, /Directorate of Economics & Statistics/);
    assert.match(lookup.source.publisher, /Government of India/);
    assert.ok(lookup.source.sha256);
    assert.match(lookup.source.licence, /Government Open Data License/);
  });

  it('has no entry below the evidence floor', () => {
    for (const { key, entry } of allEntries()) {
      assert.ok(entry.n >= MIN_OBSERVATIONS, `${key} has n=${entry.n}`);
      assert.equal(entry.years.length, entry.n, `${key} year count disagrees with n`);
    }
  });

  it('has a positive median, an ordered range and a defined vintage everywhere', () => {
    for (const { key, entry } of allEntries()) {
      assert.ok(entry.medianYieldTHa > 0, `${key} median ${entry.medianYieldTHa}`);
      assert.ok(entry.minYieldTHa <= entry.medianYieldTHa, `${key} min above median`);
      assert.ok(entry.maxYieldTHa >= entry.medianYieldTHa, `${key} max below median`);
      assert.ok(entry.sdYieldTHa === null || entry.sdYieldTHa >= 0, `${key} negative sd`);
      assert.equal(entry.latestYear, Math.max(...entry.years), `${key} latestYear disagrees`);
    }
  });

  it('never claims data from beyond the source coverage', () => {
    for (const { key, entry } of allEntries()) {
      assert.ok(entry.latestYear <= 2022, `${key} claims ${entry.latestYear}`);
      assert.ok(Math.min(...entry.years) >= 1997, `${key} predates the source`);
    }
  });

  it('resolves every district key through the name index', () => {
    for (const key of Object.keys(lookup.tiers[TIERS.DISTRICT_SEASON])) {
      const [stateCode, districtCode] = key.split('|');
      const names = lookup.geo.names[`${stateCode}|${districtCode}`];
      assert.ok(names, `${key} has no name entry`);
      assert.equal(lookup.geo.states[geoKey(names.state)], stateCode);
      assert.equal(lookup.geo.districts[`${stateCode}|${geoKey(names.district)}`], districtCode);
    }
  });

  it('keeps every median inside a physically possible range', () => {
    for (const { key, entry } of allEntries()) {
      const ceiling = SANITY_CEILING_T_HA[cropOf(key)];
      assert.ok(ceiling, `no ceiling defined for ${key}`);
      assert.ok(
        entry.medianYieldTHa < ceiling,
        `${key} median ${entry.medianYieldTHa} >= ${ceiling}`,
      );
    }
  });

  it('marks every annual entry with which published rows it came from', () => {
    for (const [key, entry] of Object.entries(lookup.tiers[TIERS.DISTRICT_ANNUAL])) {
      assert.ok(['WHOLE_YEAR', 'TOTAL'].includes(entry.basis), `${key} basis ${entry.basis}`);
    }
  });
});

// ── Reality checks against published Indian agriculture ─────────────────────

describe('yield lookup — matches published Indian yields', () => {
  const districtSeason = (state, district, crop, season) => {
    const stateCode = lookup.geo.states[geoKey(state)];
    const districtCode = lookup.geo.districts[`${stateCode}|${geoKey(district)}`];
    return lookup.tiers[TIERS.DISTRICT_SEASON][`${stateCode}|${districtCode}|${crop}|${season}`];
  };

  it('puts Ludhiana wheat where Punjab wheat actually is (~4.7-5.1 t/ha)', () => {
    const entry = districtSeason('Punjab', 'Ludhiana', 'WHEAT', 'RABI');
    assert.ok(entry, 'Ludhiana wheat Rabi missing');
    assert.ok(entry.medianYieldTHa > 4 && entry.medianYieldTHa < 6, `got ${entry.medianYieldTHa}`);
    assert.equal(entry.latestYear, 2022);
  });

  it('puts Punjab above Bihar on wheat, as every published series does', () => {
    const punjab = lookup.tiers[TIERS.STATE][`${lookup.geo.states.PUNJAB}|WHEAT`];
    const bihar = lookup.tiers[TIERS.STATE][`${lookup.geo.states.BIHAR}|WHEAT`];
    assert.ok(punjab && bihar);
    assert.ok(
      punjab.medianYieldTHa > bihar.medianYieldTHa,
      `${punjab.medianYieldTHa} vs ${bihar.medianYieldTHa}`,
    );
  });

  it('reproduces the worked example in the audit, row for row', () => {
    // docs/yield/dataset-audit.md §5: Ananthapuramu Kharif rice, 2018-2022,
    // yields 2.674 / 3.610 / 2.724 / 2.081 / 3.693 → median 2.724.
    const entry = districtSeason('Andhra Pradesh', 'Ananthapuramu', 'RICE', 'KHARIF');
    assert.ok(entry, 'Ananthapuramu Kharif rice missing');
    assert.equal(entry.medianYieldTHa, 2.724);
    assert.deepEqual(entry.years, [2018, 2019, 2020, 2021, 2022]);
    assert.equal(entry.n, 5);
  });

  it('keeps onion and potato in vegetable territory and cereals in cereal territory', () => {
    // Order-of-magnitude separation is the cheapest possible detector of a
    // crop-mapping mix-up.
    const medianFor = (crop) => {
      const values = [];
      for (const { key, entry } of allEntries()) {
        if (cropOf(key) === crop) values.push(entry.medianYieldTHa);
      }
      values.sort((a, b) => a - b);
      return values[values.length >> 1];
    };
    assert.ok(medianFor('ONION') > 5, `onion ${medianFor('ONION')}`);
    assert.ok(medianFor('POTATO') > 5, `potato ${medianFor('POTATO')}`);
    assert.ok(medianFor('WHEAT') < 5, `wheat ${medianFor('WHEAT')}`);
    assert.ok(medianFor('SOYBEAN') < 3, `soybean ${medianFor('SOYBEAN')}`);
  });

  it('keeps chilli at dry-chilli scale, which is what the source publishes', () => {
    // Dry chillies run around 1-3 t/ha; green chilli is several times higher.
    // If this ever reads like green weight, the label on screen is wrong.
    const values = [];
    for (const { key, entry } of allEntries()) {
      if (cropOf(key) === 'CHILLI') values.push(entry.medianYieldTHa);
    }
    values.sort((a, b) => a - b);
    assert.ok(
      values[values.length >> 1] < 5,
      `chilli median-of-medians ${values[values.length >> 1]}`,
    );
  });
});

// ── The quality report is the audit's evidence ──────────────────────────────

describe('yield quality report', () => {
  it('confirms the source is structurally clean', () => {
    const p = quality.sourceProfile;
    assert.equal(p.rows, 455359);
    assert.equal(p.malformedRows, 0);
    assert.equal(p.duplicateCompositeKeys, 0);
    assert.equal(p.negativeValues, 0);
    assert.equal(p.yieldNotEqualProductionOverArea, 0);
    assert.equal(p.districtCodeNameCollisions, 0);
    assert.equal(p.distinctStates, 34);
    assert.equal(p.distinctDistricts, 740);
    assert.equal(p.temporalCoverage.from, '1997-1998');
    assert.equal(p.temporalCoverage.to, '2022-2023');
  });

  it('accounts for every source row', () => {
    const r = quality.refinement;
    assert.equal(r.accepted + r.droppedTotal, r.fetched);
    assert.equal(r.fetched, quality.sourceProfile.rows);
  });

  it('names the known issues rather than leaving them to a reader to notice', () => {
    const ids = quality.knownIssues.map((i) => i.id);
    for (const id of ['D3', 'D4', 'D5', 'D7', 'D8', 'D9', 'D10']) {
      assert.ok(ids.includes(id), `known issue ${id} missing from the report`);
    }
  });

  it('shows where the outlier gate cut, for every crop it kept', () => {
    for (const crop of SUPPORTED) {
      const gate = quality.refinement.outlierGateByCrop[crop];
      assert.ok(gate, `${crop} has no gate record`);
      assert.ok(gate.kept > 0);
      if (gate.rejected > 0) {
        assert.ok(
          gate.lowestRejectedYieldTHa > gate.highestKeptYieldTHa,
          `${crop} rejected a yield below one it kept`,
        );
      }
    }
  });
});
