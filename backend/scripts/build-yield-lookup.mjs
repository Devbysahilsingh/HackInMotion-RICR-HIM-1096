#!/usr/bin/env node
/**
 * APY yield lookup build — raw government CSV → validated lookup + quality report.
 *
 * Reproducible: the only input is the file recorded in
 * `datasets/yield/metadata/source-manifest.json`, identified by sha256. Re-run
 * it and you get byte-identical outputs, or a loud failure. No network, no
 * database, no clock beyond the `generatedAt` stamp (which `--check` ignores).
 *
 * ── WHAT THIS SCRIPT WILL NOT DO ─────────────────────────────────────────────
 *
 * It will not invent a yield, and it will not repair one. Rows that fail a gate
 * are dropped, counted and — for the ones that matter — listed by district and
 * year in the quality report, so "118 implausible rows" is checkable rather
 * than asserted. The audit established that Maharashtra's 1997-98 rows record
 * area at the wrong magnitude; rescaling them would mean asserting a correction
 * to a government return, so they are rejected instead.
 *
 * If the raw file is absent it exits with instructions rather than producing an
 * empty lookup, for the same reason `seed-market.mjs` refuses to generate a
 * price series: a fabricated lookup is indistinguishable from a real one once
 * it is on disk, and it would make every yield screen a lie.
 *
 * Crop scope is registry-driven (CLAUDE.md rule 4): the crops that get a lookup
 * are exactly the crops whose `crops.base.json` entry carries
 * `yield.apyCropName`. Cotton and tomato are excluded by carrying `null`, with
 * the reason recorded on the crop — no condition in this file mentions either.
 *
 * Usage:
 *   node scripts/build-yield-lookup.mjs [--file <path>] [--out <path>] [--check] [--json]
 *
 *   --check   verify the committed outputs match what this run produces, and
 *             exit non-zero if not. This is the drift gate.
 */
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildCropIndex, normalizeBatch } from '../src/services/yieldNormalizer.js';
import { buildLookup, summarizeLookup } from '../src/services/yieldLookupBuilder.js';

const REPO_ROOT = new URL('../../', import.meta.url);
const p = (relative) => fileURLToPath(new URL(relative, REPO_ROOT));

const DEFAULT_RAW = p('datasets/yield/raw/idp-apy-crop-wise-area-production-yield.csv');
const DEFAULT_OUT = p('datasets/lookup/yield-lookup.json');
const QUALITY_REPORT = p('datasets/yield/metadata/quality-report.json');
const SOURCE_MANIFEST = p('datasets/yield/metadata/source-manifest.json');
const KNOWLEDGE = p('backend/src/knowledge/crops.base.json');

function parseArgs(argv) {
  const args = { file: DEFAULT_RAW, out: DEFAULT_OUT, check: false, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--file') args.file = argv[++i];
    else if (argv[i] === '--out') args.out = argv[++i];
    else if (argv[i] === '--check') args.check = true;
    else if (argv[i] === '--json') args.json = true;
  }
  return args;
}

/**
 * Minimal CSV reader over a stream. The export has no quoted fields and no
 * embedded newlines (verified in the audit), but quotes are handled anyway so a
 * future refresh that adds them does not silently mis-split a row. Adding a CSV
 * dependency for one build script would not earn its place
 * (docs/security/dependency-security.md).
 */
function splitRow(line) {
  const cells = [];
  let current = '';
  let quoted = false;
  for (const char of line) {
    if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) {
      cells.push(current);
      current = '';
    } else current += char;
  }
  cells.push(current);
  return cells;
}

async function readCsv(file) {
  const rl = createInterface({ input: createReadStream(file, 'utf8'), crlfDelay: Infinity });
  let header = null;
  const rows = [];
  let malformed = 0;

  for await (const line of rl) {
    if (!line.trim()) continue;
    const cells = splitRow(line);
    if (!header) {
      header = cells.map((cell) => cell.trim());
      continue;
    }
    if (cells.length !== header.length) {
      malformed += 1;
      continue;
    }
    rows.push(Object.fromEntries(header.map((name, i) => [name, cells[i]])));
  }

  return { header, rows, malformed };
}

/**
 * Structural facts about the file itself, independent of our crop scope.
 * These are the numbers `docs/yield/dataset-audit.md` §1 states, recomputed
 * every run so the document cannot drift away from the data unnoticed.
 */
function profileSource(rows) {
  const seasons = new Map();
  const years = new Map();
  const units = new Map();
  const states = new Set();
  const districts = new Set();
  const cropNames = new Set();
  const codeToName = new Map();
  const nameToCode = new Map();
  const seenKeys = new Set();
  const blank = {};
  let duplicateKeys = 0;
  let negatives = 0;
  let yieldInconsistent = 0;
  let geoCollisions = 0;

  const bump = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);

  for (const row of rows) {
    for (const [key, value] of Object.entries(row)) {
      if (value === '' || value == null) blank[key] = (blank[key] ?? 0) + 1;
    }

    bump(seasons, row.season);
    bump(years, row.year);
    bump(units, `${row.area_unit}|${row.production_unit}|${row.yield_unit}`);
    states.add(row.state_name);
    districts.add(`${row.state_code}|${row.district_code}`);
    cropNames.add(row.crop_name);

    const codeKey = `${row.state_code}|${row.district_code}`;
    if (codeToName.has(codeKey) && codeToName.get(codeKey) !== row.district_name)
      geoCollisions += 1;
    codeToName.set(codeKey, row.district_name);
    const nameKey = `${row.state_code}|${row.district_name}`;
    if (nameToCode.has(nameKey) && nameToCode.get(nameKey) !== row.district_code)
      geoCollisions += 1;
    nameToCode.set(nameKey, row.district_code);

    const dedupeKey = `${row.state_name}|${row.district_name}|${row.crop_name}|${row.season}|${row.year}`;
    if (seenKeys.has(dedupeKey)) duplicateKeys += 1;
    else seenKeys.add(dedupeKey);

    const area = Number(row.area);
    const production = row.production === '' ? null : Number(row.production);
    const yieldValue = Number(row.yield);
    if (area < 0 || (production !== null && production < 0) || yieldValue < 0) negatives += 1;

    if (area > 0 && production !== null && Number.isFinite(yieldValue)) {
      const derived = production / area;
      if (Math.abs(derived - yieldValue) > Math.max(0.005, derived * 0.02)) yieldInconsistent += 1;
    }
  }

  const sortedYears = [...years.keys()].sort();

  return {
    rows: rows.length,
    duplicateCompositeKeys: duplicateKeys,
    negativeValues: negatives,
    yieldNotEqualProductionOverArea: yieldInconsistent,
    districtCodeNameCollisions: geoCollisions,
    blankCounts: blank,
    distinctStates: states.size,
    distinctDistricts: districts.size,
    distinctCropNames: cropNames.size,
    unitCombinations: [...units.entries()].map(([combo, count]) => ({ combo, count })),
    temporalCoverage: {
      from: sortedYears[0] ?? null,
      to: sortedYears[sortedYears.length - 1] ?? null,
      distinctYears: sortedYears.length,
      rowsPerYear: Object.fromEntries([...years.entries()].sort()),
    },
    seasonLabels: Object.fromEntries([...seasons.entries()].sort((a, b) => b[1] - a[1])),
  };
}

/** Stable stringify so `--check` compares content, not key order or spacing. */
const stableJson = (value) => `${JSON.stringify(value, null, 2)}\n`;

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!existsSync(args.file)) {
    // `--check` still has work to do without the source, and CI is the case
    // that matters: the 56MB export is gitignored, so a fresh checkout has no
    // raw file and a hard failure there would only teach people to ignore the
    // gate. It verifies what it can and says plainly what it could not.
    if (args.check) return verifyArtefactsOnly();

    console.error(
      [
        '',
        'APY yield source not found:',
        `  ${args.file}`,
        '',
        'This script builds a lookup from REAL government yield returns and will',
        'not generate any. To produce the file:',
        '',
        '  1. Download the export recorded in datasets/yield/metadata/source-manifest.json',
        '     (India Data Portal → Crop Wise Area Production Yield; no API key needed;',
        '      a HEAD request 403s, a GET with a browser User-Agent succeeds).',
        '  2. Verify its sha256 against the manifest.',
        '  3. Save it at the path above and re-run.',
        '',
      ].join('\n'),
    );
    process.exitCode = 1;
    return;
  }

  return run(args);
}

/**
 * Source-free integrity verification, used by `--check` when the raw export is
 * absent.
 *
 * It CANNOT prove the committed lookup is what the pipeline produces — that
 * needs the source — and it does not pretend to. What it does prove is that the
 * three committed artefacts still agree with each other: the lookup was built
 * from the file the manifest records, and the quality report's counts still
 * describe the lookup sitting next to it. A hand-edit to any one of them breaks
 * that agreement.
 *
 * The stronger guarantee in CI is `tests/services/yieldLookupArtifact.test.js`,
 * which asserts the lookup against real Indian yields and runs under `npm test`.
 */
function verifyArtefactsOnly() {
  const problems = [];
  const require = (condition, message) => {
    if (!condition) problems.push(message);
  };

  for (const path of [DEFAULT_OUT, QUALITY_REPORT, SOURCE_MANIFEST]) {
    if (!existsSync(path)) problems.push(`missing artefact: ${path}`);
  }
  if (problems.length) {
    console.error('yield lookup --check FAILED:\n  ' + problems.join('\n  '));
    process.exitCode = 1;
    return;
  }

  const lookup = JSON.parse(readFileSync(DEFAULT_OUT, 'utf8'));
  const quality = JSON.parse(readFileSync(QUALITY_REPORT, 'utf8'));
  const manifest = JSON.parse(readFileSync(SOURCE_MANIFEST, 'utf8'));
  const declared = manifest.sources?.find((s) => s.id === 'idp-apy');

  require(declared, 'source-manifest.json has no idp-apy source');
  require(lookup.source?.sha256 ===
    declared?.sha256, `lookup was built from ${lookup.source?.sha256} but the manifest records ${declared?.sha256}`);
  require(quality.source?.sha256 ===
    declared?.sha256, `quality report was built from ${quality.source?.sha256} but the manifest records ${declared?.sha256}`);
  require(JSON.stringify(quality.lookup?.crops) ===
    JSON.stringify(lookup.crops), 'quality report and lookup disagree on the crop list');

  for (const [tier, entries] of Object.entries(lookup.tiers ?? {})) {
    const claimed = quality.lookup?.entriesPerTier?.[tier];
    const actual = Object.keys(entries).length;
    require(claimed ===
      actual, `${tier}: report claims ${claimed} entries, lookup holds ${actual}`);
  }

  if (problems.length) {
    console.error('yield lookup --check FAILED:\n  ' + problems.join('\n  '));
    process.exitCode = 1;
    return;
  }

  console.log(
    [
      'yield lookup --check: committed artefacts are mutually consistent ✔',
      `  built from sha256 ${declared.sha256}`,
      `  crops ${lookup.crops.join(', ')}`,
      '',
      '  NOTE: the raw export is absent, so this did NOT rebuild and compare.',
      '  Run with the source present for the full comparison. The value-level',
      '  guarantee in CI is tests/services/yieldLookupArtifact.test.js.',
    ].join('\n'),
  );
}

async function run(args) {
  const rawBytes = readFileSync(args.file);
  const sha256 = createHash('sha256').update(rawBytes).digest('hex');

  const manifest = existsSync(SOURCE_MANIFEST)
    ? JSON.parse(readFileSync(SOURCE_MANIFEST, 'utf8'))
    : null;
  const declared = manifest?.sources?.find((s) => s.id === 'idp-apy');

  // A silent input swap would rewrite every yield a farmer sees. The build
  // refuses rather than proceeding against an unrecorded file.
  if (declared && declared.sha256 !== sha256) {
    console.error(
      [
        '',
        'REFUSING TO BUILD — the source file does not match the manifest.',
        `  manifest sha256 : ${declared.sha256}`,
        `  actual   sha256 : ${sha256}`,
        '',
        'Either restore the recorded file, or update the manifest deliberately',
        're-running the audit in docs/yield/dataset-audit.md against the new data.',
        '',
      ].join('\n'),
    );
    process.exitCode = 1;
    return;
  }

  const { header, rows, malformed } = await readCsv(args.file);
  const profile = profileSource(rows);
  profile.malformedRows = malformed;
  profile.header = header;

  const knowledge = JSON.parse(readFileSync(KNOWLEDGE, 'utf8'));
  const registryDocs = Object.values(knowledge.crops ?? {});
  const cropIndex = buildCropIndex(registryDocs);

  const excluded = registryDocs
    .filter((crop) => !crop.yield?.apyCropName)
    .map((crop) => ({ cropCode: crop.cropCode, reason: crop.yield?.excluded ?? 'not mapped' }));

  const { rows: cleanRows, report } = normalizeBatch(rows, { cropIndex });

  const generatedAt = new Date().toISOString();
  const source = {
    id: 'idp-apy',
    name: declared?.name ?? 'Area, Production, Yield (APY) — Crop Wise Area Production Yield',
    publisher: declared?.originating_authority ?? 'Directorate of Economics & Statistics, GoI',
    via: declared?.publisher ?? 'India Data Portal (ISB Bharti Institute)',
    url: declared?.download_url ?? null,
    retrievedAt: declared?.retrieved_at ?? null,
    sha256,
    licence: declared?.license?.upstream_license ?? 'GODL-India',
    attribution:
      'Directorate of Economics & Statistics, Department of Agriculture & Farmers Welfare, Government of India — Area, Production and Yield of crops, district-wise and season-wise, via India Data Portal (ISB).',
    coverage: {
      from: profile.temporalCoverage.from,
      to: profile.temporalCoverage.to,
      states: profile.distinctStates,
      districts: profile.distinctDistricts,
    },
  };

  const lookup = buildLookup(cleanRows, { source, generatedAt });
  const perCrop = summarizeLookup(lookup);

  const quality = {
    generatedAt,
    generator: 'backend/scripts/build-yield-lookup.mjs',
    source: { file: 'datasets/yield/raw/idp-apy-crop-wise-area-production-yield.csv', sha256 },
    sourceProfile: profile,
    refinement: {
      cropsInScope: [...cropIndex.entries()].map(([apyCropName, cropCode]) => ({
        cropCode,
        apyCropName,
      })),
      cropsExcluded: excluded,
      ...report,
    },
    lookup: {
      policy: lookup.policy,
      crops: lookup.crops,
      entriesPerTier: Object.fromEntries(
        Object.entries(lookup.tiers).map(([tier, entries]) => [tier, Object.keys(entries).length]),
      ),
      entriesPerCropPerTier: perCrop,
      geo: {
        states: Object.keys(lookup.geo.states).length,
        districts: Object.keys(lookup.geo.districts).length,
      },
    },
    knownIssues: [
      {
        id: 'D3',
        severity: 'accepted',
        title: 'Autumn and Winter seasons are unresolved',
        detail:
          'The eastern rice seasons (aus / boro) have no member in the KHARIF|RABI|ZAID enum. Their rows are dropped and counted rather than mapped by resemblance, which would misassign the rice of the states that grow the most of it.',
      },
      {
        id: 'D4',
        severity: 'blocking-for-cotton',
        title: 'Cotton production is published in 170 kg bales, labelled "Tonnes"',
        detail:
          'Read as tonnes, 2022-23 gives 2,677 kg lint/ha, which is physically impossible; read as 170 kg bales it gives 455 kg/ha against a published 443. COTTON is therefore excluded from the lookup and the x0.17 conversion is NOT applied without a citable DES or Ministry of Textiles bale definition. Data is complete and current — this is a citation gate.',
      },
      {
        id: 'D5',
        severity: 'handled',
        title: 'Some rows record area at the wrong magnitude',
        detail:
          'Concentrated in Maharashtra 1997-98. Detected by an Iglewicz-Hoaglin modified z-score (published threshold 3.5) on log yield, upper tail only, per crop. Dropped and listed under refinement.implausibleSamples — never rescaled, because rescaling would assert a correction to a government return.',
      },
      {
        id: 'D7',
        severity: 'label-required',
        title: 'CHILLI is DRY chillies',
        detail:
          'The APY series is dry weight. Green-chilli yields are several times higher, so any surface showing a chilli estimate must say dry.',
      },
      {
        id: 'D8',
        severity: 'blocking-for-tomato',
        title: 'Tomato evidence is insufficient at every tier',
        detail:
          'The source has a Tomato series: 13 districts, 5 distinct years, latest 2014-15, 23% zero-production rows, annual tier last observed 2003. TOMATO is excluded and the API answers INSUFFICIENT_EVIDENCE.',
      },
      {
        id: 'D9',
        severity: 'open',
        title: 'District sums exceed published all-India totals by ~14-15%',
        detail:
          'Every yield matches published national, state and district figures, but summing district area/production overshoots the all-India wheat and rice totals. Indian district returns are not required to reconcile to DES state estimates, which derive from crop-cutting experiments — that is the likely explanation and it is not proven here. It cannot affect this feature: the estimator reads per-district yields and never sums them.',
      },
      {
        id: 'D10',
        severity: 'known-limitation',
        title: 'District names are matched exactly, never fuzzily',
        detail:
          'The source carries post-rename district names (Ananthapuramu, Dharashiv, Ahilyanagar). A farmer who typed an older name will not match and falls through to the state tier, which is stated in the response. A near-match would silently attribute another district history to their field.',
      },
    ],
  };

  const lookupJson = stableJson(lookup);
  const qualityJson = stableJson(quality);

  if (args.check) {
    const problems = [];
    const compare = (path, produced) => {
      if (!existsSync(path)) return problems.push(`missing: ${path}`);
      // `generatedAt` legitimately differs every run; everything else must not.
      const strip = (text) => text.replace(/"generatedAt": "[^"]*"/g, '"generatedAt": "*"');
      if (strip(readFileSync(path, 'utf8')) !== strip(produced)) problems.push(`drifted: ${path}`);
    };
    compare(args.out, lookupJson);
    compare(QUALITY_REPORT, qualityJson);

    if (problems.length) {
      console.error('yield lookup --check FAILED:\n  ' + problems.join('\n  '));
      process.exitCode = 1;
      return;
    }
    console.log('yield lookup --check: committed artefacts match this build ✔');
    return;
  }

  mkdirSync(dirname(args.out), { recursive: true });
  mkdirSync(dirname(QUALITY_REPORT), { recursive: true });
  writeFileSync(args.out, lookupJson);
  writeFileSync(QUALITY_REPORT, qualityJson);

  const summary = {
    sourceRows: profile.rows,
    acceptedRows: report.accepted,
    dropRate: report.dropRate,
    crops: lookup.crops,
    entriesPerTier: quality.lookup.entriesPerTier,
    out: args.out,
    qualityReport: QUALITY_REPORT,
  };

  if (args.json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  console.log(`yield lookup built from ${profile.rows.toLocaleString()} source rows`);
  console.log(
    `  accepted        ${report.accepted.toLocaleString()} (drop rate ${report.dropRate})`,
  );
  console.log(`  crops           ${lookup.crops.join(', ')}`);
  for (const [tier, count] of Object.entries(quality.lookup.entriesPerTier)) {
    console.log(`  ${tier.padEnd(15)} ${count.toLocaleString()} entries`);
  }
  console.log(`  written         ${args.out}`);
  console.log(`  quality report  ${QUALITY_REPORT}`);
}

await main();
