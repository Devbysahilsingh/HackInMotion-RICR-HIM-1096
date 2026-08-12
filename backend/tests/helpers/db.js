/**
 * In-memory MongoDB for integration suites.
 *
 * A real mongod, not a mock: index builds, unique-constraint violations and
 * TTL declarations only behave correctly against the actual server, and those
 * are exactly what the model suite has to prove.
 */
import { MongoMemoryServer } from 'mongodb-memory-server';

import { connectDatabase, disconnectDatabase, mongoose, syncIndexes } from '../../src/config/db.js';

let server = null;

/**
 * Boots an isolated database and builds every declared index.
 * `autoIndex` is off in production, so the test drives the same explicit
 * `syncIndexes()` path the deploy script uses.
 */
export async function startTestDatabase({ buildIndexes = true } = {}) {
  server = await MongoMemoryServer.create();
  await connectDatabase(server.getUri(), { serverSelectionTimeoutMS: 5_000 });
  if (buildIndexes) await syncIndexes();
  return server.getUri();
}

export async function stopTestDatabase() {
  await disconnectDatabase();
  if (server) await server.stop();
  server = null;
}

/** Wipes documents between tests without paying to rebuild indexes. */
export async function clearCollections() {
  const { collections } = mongoose.connection;
  await Promise.all(Object.values(collections).map((collection) => collection.deleteMany({})));
}
