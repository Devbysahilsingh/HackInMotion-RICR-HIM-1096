/**
 * Express application wiring.
 *
 * Middleware order is security-significant and follows
 * docs/security/api-security.md. Domain routes are mounted under /api/v1 by
 * the TODOs that introduce them; this file owns only cross-cutting concerns.
 */
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import pinoHttp from 'pino-http';

import { corsOrigins } from './config/env.js';
import { logger, redactPaths } from './utils/logger.js';
import { requestId } from './middleware/requestId.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { healthRouter } from './routes/health.js';

export const API_PREFIX = '/api/v1';

export function createApp() {
  const app = express();

  // Behind Render's proxy: trust exactly one hop so client IPs (rate limiting,
  // audit logs) are accurate without accepting spoofed forwarding chains.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(helmet());
  app.use(
    cors({
      origin: corsOrigins, // exact allowlist, no wildcards
      credentials: true, // required by the refresh-token cookie flow
    }),
  );
  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => req.id,
      redact: { paths: redactPaths, censor: '[redacted]' },
    }),
  );
  app.use(express.json({ limit: '100kb' }));

  // Liveness probe sits outside the API prefix: it is infrastructure, not product.
  app.use(healthRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
