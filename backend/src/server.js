/**
 * Process entry point: validate configuration, connect the database, start the
 * server, shut down cleanly. Scheduled jobs are wired in by the TODOs that
 * introduce them.
 */
import { createApp } from './app.js';
import { connectDatabase, disconnectDatabase } from './config/db.js';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';

// The database is required before the port opens: a listening service that
// cannot read its own data would answer health checks while failing every
// request (docs/backend/architecture.md — "no half-configured prod").
if (env.MONGODB_URI) {
  await connectDatabase(env.MONGODB_URI);
} else {
  logger.warn('MONGODB_URI not set — starting without a database (development only)');
}

const server = createApp().listen(env.PORT, () => {
  logger.info({ port: env.PORT, nodeEnv: env.NODE_ENV }, 'backend listening');
});

/** Stop accepting connections, let in-flight requests finish, then exit. */
function shutdown(signal) {
  logger.info({ signal }, 'shutting down');
  server.close(async (err) => {
    if (err) {
      logger.error({ err }, 'error during shutdown');
      process.exit(1);
    }
    // Close mongo only after the last request has drained, so nothing in
    // flight loses its connection mid-write.
    try {
      await disconnectDatabase();
    } catch (closeErr) {
      logger.error({ err: closeErr }, 'error closing database');
    }
    process.exit(0);
  });
  // Do not hang forever on stuck sockets.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.fatal({ err: reason }, 'unhandled rejection');
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'uncaught exception');
  process.exit(1);
});
