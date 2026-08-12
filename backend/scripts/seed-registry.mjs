/**
 * Seeds the crop registry from the sourced knowledge files.
 *
 * Idempotent: the version is a hash of the composed content, so re-running
 * with unchanged knowledge is a no-op, and changing a knowledge file produces
 * a new version that is applied. `--force` re-applies regardless.
 *
 * Run as an ops script from a developer machine — there is deliberately no
 * admin HTTP surface (ADR-009).
 *
 *   node scripts/seed-registry.mjs [--force] [--dry-run]
 */
import { connectDatabase, disconnectDatabase } from '../src/config/db.js';
import { env } from '../src/config/env.js';
import { CropRegistry, SeedMeta } from '../src/models/index.js';
import { applyRegistrySeed } from '../src/services/registrySeedRunner.js';
import { composeRegistry, registryVersion } from '../src/services/registrySeedService.js';

const force = process.argv.includes('--force');
const dryRun = process.argv.includes('--dry-run');

const { documents, incomplete, awaitingApproval } = composeRegistry();
const version = registryVersion(documents);

console.log(`Composed ${documents.length} registry documents → ${version}`);

if (incomplete.length > 0) {
  // Loud, never silent: a crop dropped for want of data is a knowledge gap
  // someone has to close, not an implementation detail.
  console.log(`\n${incomplete.length} crops were NOT seeded (incomplete identity):`);
  for (const entry of incomplete) {
    console.log(`  ${entry.cropCode}: missing ${entry.missing}`);
  }
}

const withGaps = documents.filter((doc) => doc.dataGaps?.length);
if (withGaps.length > 0) {
  console.log(`\n${withGaps.length} documents carry recorded data gaps:`);
  for (const doc of withGaps) {
    console.log(`  ${doc.cropCode}: ${doc.dataGaps.join('; ')}`);
  }
}

if (awaitingApproval.length > 0) {
  console.log(
    `\n${awaitingApproval.length} proposed LIMITED crops are NOT seeded — the roster is a` +
      ' product decision awaiting sign-off. Set "status": "APPROVED …" in' +
      ' src/knowledge/crops.limited.proposal.json to include them:',
  );
  console.log(`  ${awaitingApproval.join(', ')}`);
}

if (dryRun) {
  console.log('\n--dry-run: nothing written.');
  process.exit(0);
}

if (!env.MONGODB_URI) {
  console.error('MONGODB_URI is not set.');
  process.exit(1);
}

await connectDatabase(env.MONGODB_URI);

try {
  const result = await applyRegistrySeed({ CropRegistry, SeedMeta, documents, version, force });

  if (result.skipped) {
    console.log(`\nAlready at ${version} — nothing to do.`);
  } else {
    console.log(`\nApplied ${result.upserted} documents at ${version}.`);
  }
} finally {
  await disconnectDatabase();
}
