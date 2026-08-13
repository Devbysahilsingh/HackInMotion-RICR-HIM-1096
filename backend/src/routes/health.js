import { Router } from 'express';
import { readFileSync } from 'node:fs';

import { databaseStatus } from '../config/db.js';
import { tierConfig } from '../config/env.js';
import { jobStatus } from '../jobs/index.js';
import { providerCircuit } from '../utils/circuitBreaker.js';

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
    /**
     * Delivers the "jobs lastRun, services circuit states" half of the
     * documented contract, which P1 deferred until the subsystems existed.
     *
     * Both are trimmed to what an operator needs: `{at, ok, durationMs}` per
     * job and a failure count plus an open flag per provider. A full run report
     * carries per-location failure detail, which has no place in an auth-free
     * probe — and no provider name here reveals a credential or a hostname
     * beyond what ADR-007 already documents publicly.
     *
     * Empty objects before the first tick are honest: nothing has run yet.
     */
    jobs: jobStatus(),
    services: providerCircuit.state(),
    /**
     * Which crop-health tiers are configured, and which an operator has
     * switched off. Reported separately because they are different facts: a
     * missing key is a deploy that is incomplete, a pulled switch is a
     * deliberate act, and a chain answering from the rules tier for either
     * reason should not look the same on a probe.
     *
     * Only booleans — no URL, no key, no provider hostname beyond what is
     * already public.
     */
    tiers: tierConfig(),
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});
