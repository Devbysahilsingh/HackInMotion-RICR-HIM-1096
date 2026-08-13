/**
 * Process entry point: validate configuration, connect the database, start the
 * server, shut down cleanly. Scheduled jobs are wired in by the TODOs that
 * introduce them.
 */
import { createApp } from './app.js';
import { connectDatabase, disconnectDatabase } from './config/db.js';
import { env } from './config/env.js';
import { scheduler } from './jobs/index.js';
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

/**
 * Scheduled jobs run in-process (docs/architecture/overview.md: "Jobs
 * (node-cron in-process) … accepted trade-off: job pauses if instance sleeps →
 * keep-alive ping"). The scheduler is a plain interval that asks, once a
 * minute, which jobs are due — no cron dependency, and time is a parameter, so
 * the same `tick` a suite calls with an explicit instant is the one production
 * runs.
 *
 * Started only when a database is present: without one every job would fail on
 * its first query and fill the log with noise that says nothing new.
 *
 * The first tick runs every job immediately, which is the documented catch-up
 * behaviour ("each job also runs on boot if overdue") — every job here upserts,
 * so an unnecessary run costs one provider call, never a duplicate row.
 */
let stopScheduler = () => {};
if (env.MONGODB_URI) {
  stopScheduler = scheduler.start();
  logger.info({ jobs: scheduler.jobNames() }, 'scheduler started');
}

/** Stop accepting connections, let in-flight requests finish, then exit. */
function shutdown(signal) {
  logger.info({ signal }, 'shutting down');
  // Stop scheduling before draining: a job started during shutdown would
  // outlive the connection it needs (docs/backend/architecture.md:
  // "SIGTERM → stop cron, drain server, close mongo").
  stopScheduler();
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
