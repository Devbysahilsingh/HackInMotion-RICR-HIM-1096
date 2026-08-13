# Environment Matrix

Root `.env.example` documents every variable (names + placeholders only). Boot-time Zod env validation in backend and pydantic-settings in ml-service — missing secret ⇒ refuse to start with clear message.

**Implemented behaviour (P0-3, `backend/src/config/env.js`):** validation runs before the server binds and reports variable **names and rules only** — values are never echoed. `MONGODB_URI`, `JWT_SECRET` and `SERVICE_KEY` are **required when `NODE_ENV=production`** and optional in development, so a misconfigured deploy fails at boot while local work is not blocked on credentials that do not exist yet. Each becomes unconditionally required once the subsystem consuming it ships. Local development loads `.env` via Node's native `--env-file` (`npm run dev`); production reads host-injected variables (`npm start`, no file needed).

| Var | Backend | ml-service | Web (public) | Mobile (public) |
|---|---|---|---|---|
| MONGODB_URI | ✅ | — | — | — |
| JWT_SECRET / SERVICE_KEY | ✅ / ✅ | — / ✅ | — | — |
| GEMINI_API_KEY, OPENROUTER_API_KEY, GROQ_API_KEY | ✅ | — | — | — |
| OPENWEATHER_API_KEY, DATAGOVIN_API_KEY, DATAGOVIN_RESOURCE_ID | ✅ (all optional — see Phase-2 table) | — | — | — |
| CLOUDINARY_URL | ✅ | — | — | — |
| ML_SERVICE_URL | ✅ | — | — | — |
| CORS_ORIGINS | ✅ | — | — | — |
| DISABLE_*/FORCE_FAIL_* (non-prod) | ✅ | — | — | — |
| MODEL_VERSION | — | ✅ | — | — |
| VITE_API_URL / EXPO_PUBLIC_API_URL | — | — | ✅ | ✅ |
| SEED_DEMO_PASSWORD | ✅ (scripts only) | — | — | — |
Dev vs prod: NODE_ENV governs error verbosity in logs (never in responses), failure-flag availability, /dev/components route inclusion (web build-time). Same security middleware in both — no dev auth relaxation.

## Updated behaviour (P1, `backend/src/config/env.js`)

| Variable | Rule | Why |
|---|---|---|
| `MONGODB_URI` | required in production; must start `mongodb://` or `mongodb+srv://` | the previous `url()` check accepted `https://example.com` while its message promised a connection-string check |
| `CORS_ORIGINS` | **required in production** (was: defaulted to `http://localhost:5173` everywhere) | a deploy that forgot the variable booted "successfully" with a localhost-only allowlist — a silent outage rather than a loud one |
| `JWT_SECRET`, `SERVICE_KEY` | required in production, ≥32 chars | unchanged |
| `LOG_LEVEL` | adds `silent` | keeps test runs readable |
| `PORT` | injected by Render; defaults to 4000 | — |

## Phase-2 providers (`backend/src/config/env.js`)

| Variable | Rule | Why |
|---|---|---|
| `OPENWEATHER_API_KEY` | **optional even in production** | it buys only the *fallback* leg. Without it the primary still works and the integration reports `invalid:'no_api_key'` rather than throwing, so requiring it would turn a degraded mode into a boot failure |
| `DATAGOVIN_API_KEY` | **optional even in production** | open decision OD-5 — the key has not been issued. Requiring it would make the whole API unbootable over a subsystem designed to fall back to seeded history (`source:'seed'` rows, labelled Historical) |
| `DATAGOVIN_RESOURCE_ID` | **optional even in production**, min length 1 | the data.gov.in resource id for "Variety-wise Daily Market Prices". Configurable rather than hardcoded because the catalogue re-issues ids and no repository document records one (docs/market/data-source.md names the dataset but publishes no id) |

This is a deliberate departure from the "required once the subsystem consuming it ships" convention above: each integration reports its own absence honestly (the market job returns `skipped:'not_configured'` with the missing variable names) instead of the process refusing to start. **Open-Meteo needs no variable at all** — ADR-007 selected it precisely for being keyless, so there is no `OPENMETEO_*` to forget.

**Failure-injection flags as implemented** (`backend/src/config/failureFlags.js`): `FORCE_FAIL_OPENMETEO`, `FORCE_FAIL_OPENWEATHER`, `FORCE_FAIL_DATAGOVIN`, plus `FORCE_SLOW_OPENMETEO` / `FORCE_SLOW_OPENWEATHER` / `FORCE_SLOW_DATAGOVIN` (`=<ms>` of injected latency, used to prove the 8s timeout fires). `FORCE_FAIL_WEATHER` is honoured as an alias meaning **both** weather providers — `docs/architecture/resilience.md` uses it in its demo script and it appears in no other registry, and one switch proving RES-02 is the more useful reading. Every read is short-circuited by `isProd`, so a production host carrying one of these still behaves normally; the guard sits in one place rather than at each call site. They are routing-only: no flag weakens auth, ownership, validation or rate limiting (rule 2). `ALL_INJECTION_FLAGS` is exported so the production checklist can assert their absence.

In development a missing `JWT_SECRET` yields a **random per-process** value rather than a fixed fallback: there is no known development key to leak or accidentally trust, and tokens simply stop verifying across restarts. Production never reaches that path — the schema refuses to boot first.

## Staging checklist (Render)

Service settings live in `render.yaml` at the repo root; every secret is marked `sync: false`, so Render requires it in the dashboard and it is never committed.

Set before the first deploy: `NODE_ENV=production` · `MONGODB_URI` · `JWT_SECRET` (`openssl rand -hex 32`) · `SERVICE_KEY` (`openssl rand -hex 32`) · `CORS_ORIGINS` (exact origins, comma separated, no wildcards).

Add as each phase ships: `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `GROQ_API_KEY`, `OPENWEATHER_API_KEY`, `DATAGOVIN_API_KEY`, `DATAGOVIN_RESOURCE_ID`, `CLOUDINARY_URL`, `ML_SERVICE_URL`. The three Phase-2 ones do not block a deploy — weather runs on the keyless primary without them, and market ingest reports `skipped:'not_configured'` and serves seeded history.

Staging only, and **verified absent in production**: `DISABLE_*`, `FORCE_FAIL_*`, `FORCE_SLOW_*`.

After deploying: `cd backend && npm run smoke -- https://<service>.onrender.com` — 18 read-only checks covering health, database connectivity, hardened headers, the error envelope, anonymous rejection, registry seeding and CORS rejection.
