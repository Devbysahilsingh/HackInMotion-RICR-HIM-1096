# Backend Architecture (Node 20 + Express)

As built after P2 (Phase-3+ additions marked *planned*):
```
backend/src/
├── app.js            # express wiring (middleware order per docs/security/api-security.md)
├── server.js         # boot: env validation (zod — fail fast on missing secrets), db connect, scheduler start
├── config/           # constants.js, db.js, env.js, failureFlags.js
├── middleware/       # requireAuth, loadOwned factory, validate(zod), rateLimits, sanitize, requestId, errorHandler
├── routes/           # thin: parse → service → respond. NO controllers/ layer was created — a controller file
│                     #   per route that only forwarded to a service would be a layer with no decision in it
│                     #   (auth, crops, farms, registry, market, dashboard, cropRecommendation, health,
│                     #    ownership-table.js = the ST-10 generator's source of truth)
├── services/         # domain orchestration: auth/token/audit, farm/crop, weather{,Validation}, farmWeather,
│                     #   market{,Normalizer}, irrigation, fertilizer, feed, registrySeed{,Runner}
├── engines/          # PURE: stage/, irrigation/, weatherRisk/, marketSignal/, cropRec/, feedComposer/
│                     #   (symptomRules/ planned) ⇒ no imports from services/models; fixture-tested; the viva core
├── integrations/     # openMeteo.js, openWeatherMap.js, dataGovIn.js (gemini, openRouter, cloudinary,
│                     #   mlService, groq planned) — each: timeout, retry, circuit counters, zod response
│                     #   validation, kill-switch flag
├── jobs/             # scheduler.js + index.js (registry & last-run state), weatherRefresh(3h),
│                     #   marketRefresh(nightly), feedRefresh(30m), expiry(daily); communityAggregate(6h) planned
├── models/           # 14 mongoose schemas + index.js + shared.js (docs/database)
├── knowledge/        # registry seed source JSONs (cited): crops.base, crops.agronomy, crops.fertilizer,
│                     #   crops.limited.proposal
└── utils/            # logger(pino+redaction), errors (typed AppError→envelope), requestId, respond,
                      #   httpClient (timeout+retry), circuitBreaker, day (IST boundaries), locationKey, clientContext
```
Layering rule (enforced by review + eslint import boundaries): routes→services→(engines|integrations|models); engines import nothing above utils/constants. Jobs are services on timers with run-reports. Health service = the only place the AI chain order lives (single conductor, testable with mocked tiers).
Env validation at boot (missing/malformed secret = refuse to start with clear message — no half-configured prod). Graceful shutdown: SIGTERM → stop the scheduler, drain server, close mongo.

**Scheduling is a plain injectable-clock interval, not `node-cron`.** `src/jobs/scheduler.js` exposes `tick(now)`, which decides what is due; production drives it from one unref'd `setInterval`, and a test calls it directly with whatever instant it likes. A q3h job and a nightly job cannot be proven by a suite that waits three hours, and ADR-022 left this project without fake timers — making time a parameter is what replaces them. It also adds no dependency, against a locked dependency list. A job that is still running when the next tick arrives is skipped rather than queued (both ingest paths upsert, so an overlap is harmless but wastes free-tier quota), and a throwing handler degrades that one job rather than killing every future run.

**`/healthz` now reports `jobs` and `services`**, closing the deferral recorded in docs/deployment/backend.md: `jobs` is `{at, ok, durationMs}` per job, held in memory (there is deliberately no `jobRuns` collection — the roster is fixed at 14), and `services` is the circuit breaker's `{consecutiveFailures, open}` per provider. Empty objects before the first tick are the honest answer. Because that state is in memory, a restart genuinely knows nothing about earlier runs, so every job is due at the first tick after boot — which is the catch-up behaviour docs/deployment/backend.md asks for, arrived at by having no history rather than by querying for overdue work.
