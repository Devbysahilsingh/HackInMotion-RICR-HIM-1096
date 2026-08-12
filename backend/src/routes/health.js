import { Router } from 'express';
import { readFileSync } from 'node:fs';

const { version } = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
);

export const healthRouter = Router();

/**
 * Liveness probe for the host platform and uptime monitor
 * (docs/deployment/architecture.md). Auth-free by design, so it exposes
 * nothing internal. Subsystem checks (db, jobs, external-service circuits)
 * are added by the TODOs that introduce those subsystems — this reports only
 * what actually exists today.
 */
healthRouter.get('/healthz', (req, res) => {
  res.json({
    status: 'ok',
    service: 'him-1096-backend',
    version,
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});
