#!/usr/bin/env node
/**
 * CEDA market seed — 60 days of real historical mandi prices.
 *
 * docs/market/data-source.md:
 *   "Fallback/seed: CEDA Ashoka Agmarknet mirror (agmarknet.ceda.ashoka.edu.in).
 *    Bulk historical download → `scripts/seed-market` builds 60-day seed for
 *    demo commodities×states; rows labeled source:'seed'. Used when: primary
 *    key missing, primary down, or gap-filling display continuity."
 * and market-architecture.md: "real historical data, labeled — not fabricated".
 *
 * ── WHAT THIS SCRIPT WILL NOT DO ─────────────────────────────────────────────
 *
 * It will not generate a price series. CLAUDE.md rule 7 is explicit — "Seeded
 * demo data = real historical/labeled data" — so this script reads a bulk
 * export that a human has downloaded from CEDA and placed on disk. If that file
 * is absent it exits with instructions rather than inventing plausible prices,
 * because a fabricated mandi series is indistinguishable from a real one once
 * it is in the database and would make every market screen a lie.
 *
 * Expected input: `datasets/lookup/ceda-market-prices.csv` (or `--file <path>`),
 * a CSV whose header names the same nine fields data.gov.in publishes:
 *   state, district, market, commodity, variety, arrival_date, min_price,
 *   max_price, modal_price
 *
 * Rows go through **exactly the same normalizer and sanity gates** as the live
 * nightly ingest — same alias map, same price bounds, same clamp-and-flag — so
 * seeded history cannot be cleaner than ingested history. Only `source` differs:
 * `'seed'`, which the API surfaces as ● Historical and never as live.
 *
 * Idempotent: writes are upserts on the `(commodityCode, market, date)` unique
 * index and the run is recorded in `seedMeta` with a content hash, so a re-run
 * with the same file is a no-op.
 *
 * Usage:
 *   node scripts/seed-market.mjs [--file <path>] [--days 60] [--dry-run]
 */
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { connectDatabase, disconnectDatabase } from '../src/config/db.js';
import { env } from '../src/config/env.js';
import { CropRegistry, MarketPrice, SeedMeta } from '../src/models/index.js';
import { buildAliasIndex, normalizeBatch } from '../src/services/marketNormalizer.js';

const SEED_NAME = 'market-ceda';
const DEFAULT_DAYS = 60;
const DEFAULT_FILE = fileURLToPath(
  new URL('../../datasets/lookup/ceda-market-prices.csv', import.meta.url),
);

function parseArgs(argv) {
  const args = { file: DEFAULT_FILE, days: DEFAULT_DAYS, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--file') args.file = argv[++i];
    else if (argv[i] === '--days') args.days = Number(argv[++i]);
    else if (argv[i] === '--dry-run') args.dryRun = true;
  }
  return args;
}

/**
 * Minimal CSV reader: split on newlines, then on commas outside quotes. The
 * export has no embedded newlines, and adding a CSV dependency for one ops
 * script would not earn its place (docs/security/dependency-security.md).
 */
function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return [];

  const splitRow = (line) => {
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
    return cells.map((cell) => cell.trim());
  };

  const header = splitRow(lines[0]).map((name) => name.toLowerCase());
  return lines.slice(1).map((line) => {
    const cells = splitRow(line);
    return Object.fromEntries(header.map((name, index) => [name, cells[index]]));
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!existsSync(args.file)) {
    console.error(
      [
        '',
        'CEDA market seed input not found:',
        `  ${args.file}`,
        '',
        'This script seeds REAL historical mandi prices and will not generate any.',
        'To produce the file:',
        '  1. Download a bulk price export from the CEDA Agmarknet mirror',
        '     (agmarknet.ceda.ashoka.edu.in) covering the demo commodities and states.',
        `  2. Save it as CSV at the path above, with a header row naming:`,
        '     state, district, market, commodity, arrival_date, min_price, max_price, modal_price',
        '  3. Re-run this script.',
        '',
        'Blocked on the same external step as the live feed (OD-5 / owner A).',
        '',
      ].join('\n'),
    );
    process.exitCode = 1;
    return;
  }

  const raw = readFileSync(args.file, 'utf8');
  const contentHash = createHash('sha256').update(raw).digest('hex').slice(0, 12);
  const version = `${SEED_NAME}-${contentHash}`;

  if (!env.MONGODB_URI) throw new Error('MONGODB_URI is required to seed');
  await connectDatabase(env.MONGODB_URI);

  try {
    const applied = await SeedMeta.findOne({ seedName: SEED_NAME }).lean();
    if (applied?.version === version && !args.dryRun) {
      console.log(`already applied: ${version} (no changes)`);
      return;
    }

    const registryDocs = await CropRegistry.find().select('cropCode market').lean();
    const aliasIndex = buildAliasIndex(registryDocs);

    const asOf = new Date();
    const rows = parseCsv(raw);

    // The same normalizer the nightly job uses — seeded history is held to the
    // identical sanity gates, so it cannot be cleaner than ingested history.
    const { rows: normalized, report } = normalizeBatch(rows, { aliasIndex, asOf });

    // Only the requested window; the export may be wider than 60 days.
    const cutoff = new Date(asOf.getTime() - args.days * 24 * 60 * 60 * 1000);
    const inWindow = normalized.filter((row) => row.date >= cutoff);

    console.log(
      JSON.stringify(
        {
          seed: SEED_NAME,
          version,
          file: args.file,
          days: args.days,
          ...report,
          inWindow: inWindow.length,
          dryRun: args.dryRun,
        },
        null,
        2,
      ),
    );

    if (args.dryRun) return;

    if (inWindow.length === 0) {
      console.error('no rows survived normalization — nothing seeded');
      process.exitCode = 1;
      return;
    }

    for (const row of inWindow) {
      await MarketPrice.updateOne(
        { commodityCode: row.commodityCode, market: row.market, date: row.date },
        // `source: 'seed'` is what makes the UI label these ● Historical. It is
        // set here, overriding the normalizer's default, and never anywhere else.
        { $set: { ...row, source: 'seed' } },
        { upsert: true },
      );
    }

    await SeedMeta.updateOne(
      { seedName: SEED_NAME },
      { $set: { seedName: SEED_NAME, version, appliedAt: new Date() } },
      { upsert: true },
    );

    console.log(`seeded ${inWindow.length} rows as source:'seed' · version ${version}`);
  } finally {
    await disconnectDatabase();
  }
}

await main();
