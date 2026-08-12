# Backend Deployment (Render)

Service: Node web service, root `backend/`, build `npm ci`, start `node src/server.js`, health check path /healthz, auto-deploy from main.
Env: full secret set (environment.md) via dashboard; NODE_ENV=production.
Free-tier ops: instance sleeps after 15min idle → cron-job.org GET /healthz q10min (hackathon window) + UptimeRobot monitor (alert + uptime evidence); in-process cron caveat: jobs pause while asleep — keep-alive makes this moot during the event; each job also runs on boot if overdue (catch-up logic).
Logs: Render log stream (pino JSON); requestId correlation with ml-service.
Manual ops scripts (`scripts/`): seed-registry, seed-demo-farm, seed-market, trigger-jobs, smoke — run via local machine against prod with ops credentials (no admin HTTP surface).
Rollback: Render redeploy previous commit; DB migrations: none destructive planned (additive schema only during event).

## As built (P1)

**`render.yaml`** at the repo root defines the service (Blueprint-importable, or copy the settings manually). Secrets are declared with `sync: false` — Render demands them in the dashboard and they never enter git.

**Ops scripts, all under `backend/scripts/`**, run from a developer machine against the target database (there is deliberately no admin HTTP surface — ADR-009):

| Script | npm alias | Purpose |
|---|---|---|
| `build-indexes.mjs` | `npm run indexes:build` | Builds every declared index and prints what exists. `autoIndex` is off in production, so this is the deploy gate — 14 models, 23 declared indexes. |
| `seed-registry.mjs` | `npm run seed:registry` | Seeds the crop registry. Idempotent: the version is a content hash, so an unchanged re-run is a no-op. Accepts `--dry-run` and `--force`. Validates every document before writing any. |
| `smoke.mjs` | `npm run smoke -- <url>` | Read-only post-deploy verification, safe against production. 18 checks. |

**Deploy order:** set env vars → deploy → `npm run indexes:build` → `npm run seed:registry` → `npm run smoke -- <url>`.

`/healthz` currently returns `{status, service, version, db, uptimeSeconds, timestamp}`. `db` reports the live Mongoose connection state, so a process that is up but detached from Atlas reads as unhealthy rather than "ok". Job and circuit-state fields arrive with the TODOs that introduce those subsystems — nothing reports "ok" for something that does not exist yet.

Still open: `seed-demo-farm`, `seed-market` and `trigger-jobs` belong to Phases 2 and 8.
