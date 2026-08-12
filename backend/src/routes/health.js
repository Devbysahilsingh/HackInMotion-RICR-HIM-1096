import { Router } from 'express';
import { readFileSync } from 'node:fs';

import { databaseStatus } from '../config/db.js';

const { version } = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
);

export const healthRouter = Router();

/**
 * Liveness probe for the host platform and uptime monitor
 * (docs/deployment/architecture.md). Auth-free by design, so it reports
 * subsystem state without exposing anything internal: no connection strings,
 * no hostnames, no error text. Fields appear only once the subsystem behind
 * them exists — job and circuit state arrive with the TODOs that add them.
 */
healthRouter.get('/healthz', (req, res) => {
  res.json({
    status: 'ok',
    service: 'him-1096-backend',
    version,
    db: databaseStatus(),
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});
