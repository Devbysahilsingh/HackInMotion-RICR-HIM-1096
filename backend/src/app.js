/**
 * Express application wiring.
 *
 * Middleware order is security-significant and follows
 * docs/security/api-security.md:
 *   helmet → CORS allowlist → global rate limit → JSON body limit →
 *   mongo-sanitize → pino-http (redaction) → routes → error handler
 *
 * `requestId` is inserted before the logger because pino-http derives its
 * correlation id from it; everything else keeps the documented order.
 */
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import pinoHttp from 'pino-http';

import { JSON_BODY_LIMIT, REFRESH_COOKIE_PATH } from './config/constants.js';
import { corsOrigins, isProd } from './config/env.js';
import { logger, redactPaths } from './utils/logger.js';
import { requestId } from './middleware/requestId.js';
import { globalLimiter } from './middleware/rateLimits.js';
import { mongoSanitize } from './middleware/sanitize.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { healthRouter } from './routes/health.js';
import { authRouter } from './routes/auth.js';
import { farmsRouter } from './routes/farms.js';
import { cropsRouter } from './routes/crops.js';
import { cropRecommendationRouter } from './routes/cropRecommendation.js';
import { dashboardRouter, recommendationsRouter } from './routes/dashboard.js';
import { marketRouter } from './routes/market.js';
import { registryRouter } from './routes/registry.js';
import { cropHealthRouter } from './routes/cropHealth.js';
import { communityRouter } from './routes/community.js';
import { usersRouter } from './routes/users.js';

export const API_PREFIX = '/api/v1';

/**
 * @param {{ extraRouters?: import('express').Router[] }} [options]
 *   `extraRouters` is a composition seam for tests that need to exercise the
 *   terminal error handler (ST-50 asserts a forced 500 leaks no stack). It is
 *   an in-process argument, not configuration: no environment variable, header
 *   or request can reach it, and the deployed entry point passes nothing.
 */
export function createApp({ extraRouters = [] } = {}) {
  const app = express();

  // `req.ip` keys the rate-limit buckets and is written into audit rows, so
  // whoever controls it controls brute-force protection and the forensic
  // record. In production exactly one hop is trusted — Render's proxy, which
  // appends the real peer, so a client-supplied X-Forwarded-For is ignored.
  //
  // Everywhere else there is NO proxy, and trusting one hop would make the
  // header itself authoritative: an attacker could reset their own bucket by
  // varying it. Local and test runs therefore use the socket address.
  app.set('trust proxy', isProd ? 1 : false);
  app.disable('x-powered-by');

  app.use(helmet());

  // Credentials are granted only on the auth path, because that is the only
  // place the refresh cookie flows (docs/deployment/architecture.md:
  // "credentials on auth path only"). Every other route gets the same exact
  // origin allowlist with credentials off, so a compromised page on an allowed
  // origin cannot ride a cookie into the wider API.
  const originPolicy = { origin: corsOrigins };
  app.use(REFRESH_COOKIE_PATH, cors({ ...originPolicy, credentials: true }));
  app.use(cors(originPolicy));

  app.use(requestId);
  app.use(globalLimiter);
  app.use(express.json({ limit: JSON_BODY_LIMIT }));
  app.use(mongoSanitize);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => req.id,
      redact: { paths: redactPaths, censor: '[redacted]' },
    }),
  );

  // Liveness probe sits outside the API prefix: it is infrastructure, not product.
  app.use(healthRouter);

  app.use(`${API_PREFIX}/auth`, authRouter);
  app.use(`${API_PREFIX}/users`, usersRouter);
  // Crops are addressed both under their farm and directly, so this router
  // mounts at the API root and declares both path shapes itself. It is mounted
  // before the farms router because `/farms/:id/crops` shares that prefix:
  // mounted after, every nested crop request would first enter the farms
  // router, run its auth middleware, match nothing, and fall through — paying
  // for two user lookups per request.
  app.use(API_PREFIX, cropsRouter);
  app.use(`${API_PREFIX}/farms`, farmsRouter);
  app.use(`${API_PREFIX}/dashboard`, dashboardRouter);
  app.use(`${API_PREFIX}/recommendations`, recommendationsRouter);
  app.use(`${API_PREFIX}/crop-recommendation`, cropRecommendationRouter);
  app.use(`${API_PREFIX}/market`, marketRouter);
  app.use(`${API_PREFIX}/registry`, registryRouter);
  // Multipart lives entirely inside this router (multer is mounted per-route),
  // so no global body parser change is needed and no other route can be sent a
  // multipart body — `express.json` above simply ignores it and validation
  // rejects the empty result.
  app.use(`${API_PREFIX}/crop-health`, cropHealthRouter);
  app.use(`${API_PREFIX}/community`, communityRouter);

  for (const router of extraRouters) app.use(router);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
