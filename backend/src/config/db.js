/**
 * MongoDB connection lifecycle.
 *
 * ADR-002 rules the implementation here: no server-side transactions, so every
 * multi-document operation elsewhere in the codebase is written to be ordered
 * and idempotent rather than atomic.
 */
import mongoose from 'mongoose';

import { logger } from '../utils/logger.js';

// Reject anything the schema does not declare, everywhere, rather than
// silently persisting attacker-chosen fields (docs/database/validation.md).
mongoose.set('strict', true);
mongoose.set('strictQuery', true);
// Index builds are triggered explicitly by scripts/tests, never implicitly on
// a production boot where a large build would stall the first requests.
mongoose.set('autoIndex', false);

/** @returns {Promise<typeof mongoose>} */
export async function connectDatabase(uri, options = {}) {
  if (!uri) throw new Error('connectDatabase requires a connection string');

  mongoose.connection.on('error', (err) => logger.error({ err }, 'mongo connection error'));
  mongoose.connection.on('disconnected', () => logger.warn('mongo disconnected'));

  await mongoose.connect(uri, {
    // Fail fast rather than queueing requests against a dead cluster: a hung
    // request path is indistinguishable from an outage to the farmer.
    serverSelectionTimeoutMS: 10_000,
    socketTimeoutMS: 45_000,
    ...options,
  });

  logger.info({ db: mongoose.connection.name }, 'mongo connected');
  return mongoose;
}

export async function disconnectDatabase() {
  await mongoose.connection.close();
}

/**
 * Connection state for `/healthz`. Reports what is true right now; it never
 * claims 'ok' for a subsystem that has not been wired (P0-3 decision 8).
 * @returns {'connected'|'connecting'|'disconnected'|'disconnecting'|'unknown'}
 */
export function databaseStatus() {
  return (
    { 0: 'disconnected', 1: 'connected', 2: 'connecting', 3: 'disconnecting' }[
      mongoose.connection.readyState
    ] ?? 'unknown'
  );
}

/**
 * Builds every index declared by the registered models and returns what was
 * created. The deploy gate ("indexes built (script asserts)") and the
 * index-build assertion test both run through this one path, so the thing the
 * test proves is the thing production runs.
 */
export async function syncIndexes() {
  const results = [];
  for (const name of mongoose.modelNames()) {
    const model = mongoose.model(name);
    await model.createIndexes();
    results.push({ model: name, indexes: await model.collection.indexes() });
  }
  return results;
}

export { mongoose };
