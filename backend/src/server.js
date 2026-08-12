/**
 * Process entry point: validate configuration, start the server, shut down
 * cleanly. Database connection and scheduled jobs are wired in by the TODOs
 * that introduce them.
 */
import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';

const server = createApp().listen(env.PORT, () => {
  logger.info({ port: env.PORT, nodeEnv: env.NODE_ENV }, 'backend listening');
});

/** Stop accepting connections, let in-flight requests finish, then exit. */
function shutdown(signal) {
  logger.info({ signal }, 'shutting down');
  server.close((err) => {
    if (err) {
      logger.error({ err }, 'error during shutdown');
      process.exit(1);
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
