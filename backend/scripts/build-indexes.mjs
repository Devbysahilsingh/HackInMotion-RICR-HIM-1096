/**
 * Builds every declared index and reports what exists.
 *
 * Run against Atlas before a deploy ("indexes built (script asserts)"), and
 * exercised by the index-assertion test against an in-memory server — one
 * code path, so what the test proves is what production runs.
 *
 *   node scripts/build-indexes.mjs
 */
import { connectDatabase, disconnectDatabase, syncIndexes } from '../src/config/db.js';
import { env } from '../src/config/env.js';
import '../src/models/index.js';

if (!env.MONGODB_URI) {
  console.error('MONGODB_URI is not set — nothing to build against.');
  process.exit(1);
}

await connectDatabase(env.MONGODB_URI);

try {
  const results = await syncIndexes();
  let total = 0;

  for (const { model, indexes } of results) {
    // `_id_` is created by the server, not by us — report only declared ones.
    const declared = indexes.filter((index) => index.name !== '_id_');
    total += declared.length;
    console.log(`${model}: ${declared.map((index) => index.name).join(', ') || '(none)'}`);
  }

  console.log(`\n${results.length} models, ${total} declared indexes built.`);
} finally {
  await disconnectDatabase();
}
