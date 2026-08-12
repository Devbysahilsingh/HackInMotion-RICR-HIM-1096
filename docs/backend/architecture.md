# Backend Architecture (Node 20 + Express)

```
backend/src/
├── app.js            # express wiring (middleware order per docs/security/api-security.md)
├── server.js         # boot: env validation (zod — fail fast on missing secrets), db connect, cron start
├── config/           # env schema, constants
├── middleware/       # auth, loadOwned factory, validate(zod), rateLimits, errorHandler, audit
├── routes/ → controllers/   # thin: parse → service → respond (no logic in controllers)
├── services/         # domain orchestration (farmService, healthService: the AI-chain conductor, ...)
├── engines/          # PURE: irrigation/, weatherRisk/, marketSignal/, cropRec/, symptomRules/, feedComposer/
│                     #   ⇒ no imports from services/models; fixture-tested; the viva core
├── integrations/     # openMeteo, openWeather, dataGovIn, gemini, openRouter, cloudinary, mlService, groq
│                     #   each: timeout, retry, circuit counters, zod response validation, kill-switch flag
├── jobs/             # weatherRefresh(3h), marketRefresh(nightly), feedRefresh(30m), communityAggregate(6h), expiry
├── models/           # mongoose schemas (docs/database)
├── knowledge/        # registry seed source JSONs (cited), symptom weights, climate normals
└── utils/            # logger(pino+redaction), errors (typed AppError→envelope), requestId
```
Layering rule (enforced by review + eslint import boundaries): controllers→services→(engines|integrations|models); engines import nothing above utils/constants. Jobs are services on timers with run-reports. Health service = the only place the AI chain order lives (single conductor, testable with mocked tiers).
Env validation at boot (missing/malformed secret = refuse to start with clear message — no half-configured prod). Graceful shutdown: SIGTERM → stop cron, drain server, close mongo.
