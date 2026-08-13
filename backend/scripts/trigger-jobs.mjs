#!/usr/bin/env node
/**
 * Manual job trigger and run-report printer.
 *
 * docs/deployment/backend.md lists `trigger-jobs` among the ops scripts and
 * notes it as "still open … belongs to Phases 2 and 8"; this is that script.
 * docs/market/market-architecture.md also calls for a "(+ manual trigger
 * script)" beside the nightly cron.
 *
 * It is a **CLI**, not an HTTP endpoint. ADR-009 rules out an admin surface,
 * and adding an authenticated job-trigger route would mean a new secret and a
 * new attack surface for something an operator can already do with a shell.
 *
 * The printed report is also the deliverable the market TODO calls for — the
 * "drop-rate report": `{fetched, inserted, duplicates, dropped:{unmapped,
 * badDate, badPrice, badGeo}, flagged, dropRate}`, straight from the run.
 *
 * Usage:
 *   node scripts/trigger-jobs.mjs                  # list the jobs
 *   node scripts/trigger-jobs.mjs weatherRefresh
 *   node scripts/trigger-jobs.mjs marketRefresh
 *   node scripts/trigger-jobs.mjs feedRefresh
 *   node scripts/trigger-jobs.mjs expiry
 *   node scripts/trigger-jobs.mjs marketRefresh --json > reports/market-run.json
 */
import { connectDatabase, disconnectDatabase } from '../src/config/db.js';
import { env } from '../src/config/env.js';
import { scheduler } from '../src/jobs/index.js';

const [name, ...flags] = process.argv.slice(2);
const asJson = flags.includes('--json');

if (!name) {
  console.log('available jobs:');
  for (const jobName of scheduler.jobNames()) console.log(`  ${jobName}`);
  console.log('\nusage: node scripts/trigger-jobs.mjs <job> [--json]');
  process.exit(0);
}

if (!scheduler.jobNames().includes(name)) {
  console.error(`unknown job: ${name}`);
  console.error(`available: ${scheduler.jobNames().join(', ')}`);
  process.exit(1);
}

if (!env.MONGODB_URI) {
  console.error('MONGODB_URI is required to run a job');
  process.exit(1);
}

await connectDatabase(env.MONGODB_URI);

try {
  // `run` bypasses the schedule but keeps the overlap guard, so triggering a
  // job that is already mid-run reports "skipped" rather than doubling it up.
  const outcome = await scheduler.run(name, new Date());

  if (asJson) {
    console.log(JSON.stringify(outcome.result ?? outcome, null, 2));
  } else {
    console.log(`job: ${name}`);
    console.log(`status: ${outcome.status} (${outcome.durationMs}ms)`);
    if (outcome.error) console.error(`error: ${outcome.error.message}`);
    if (outcome.result) console.log(JSON.stringify(outcome.result, null, 2));
  }

  // A failed run exits non-zero so a wrapper can tell without parsing output.
  process.exitCode = outcome.status === 'ok' && outcome.result?.ok !== false ? 0 : 1;
} finally {
  await disconnectDatabase();
}
