# Backend Deployment (Render)

Service: Node web service, root `backend/`, build `npm ci`, start `node src/server.js`, health check path /healthz, auto-deploy from main.
Env: full secret set (environment.md) via dashboard; NODE_ENV=production.
Free-tier ops: instance sleeps after 15min idle → cron-job.org GET /healthz q10min (hackathon window) + UptimeRobot monitor (alert + uptime evidence); in-process cron caveat: jobs pause while asleep — keep-alive makes this moot during the event; each job also runs on boot if overdue (catch-up logic).
Logs: Render log stream (pino JSON); requestId correlation with ml-service.
Manual ops scripts (`scripts/`): seed-registry, seed-demo-farm, seed-market, trigger-jobs, smoke — run via local machine against prod with ops credentials (no admin HTTP surface).
Rollback: Render redeploy previous commit; DB migrations: none destructive planned (additive schema only during event).
