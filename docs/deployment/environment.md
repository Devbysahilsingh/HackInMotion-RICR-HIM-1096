# Environment Matrix

Root `.env.example` documents every variable (names + placeholders only). Boot-time Zod env validation in the backend and, in ml-service, plain `os.environ` reads validated by a frozen pydantic `BaseModel` (`ml-service/app/config.py`) — **not `pydantic-settings`**, which is not on the locked ml dependency list in docs/security/dependency-security.md and which reading seven variables does not earn. Missing secret ⇒ refuse to start with a clear message, in both services.

**Implemented behaviour (P0-3, `backend/src/config/env.js`):** validation runs before the server binds and reports variable **names and rules only** — values are never echoed. `MONGODB_URI`, `JWT_SECRET` and `SERVICE_KEY` are **required when `NODE_ENV=production`** and optional in development, so a misconfigured deploy fails at boot while local work is not blocked on credentials that do not exist yet. Each becomes unconditionally required once the subsystem consuming it ships. Local development loads `.env` via Node's native `--env-file` (`npm run dev`); production reads host-injected variables (`npm start`, no file needed).

| Var | Backend | ml-service | Web (public) | Mobile (public) |
|---|---|---|---|---|
| MONGODB_URI | ✅ | — | — | — |
| JWT_SECRET / SERVICE_KEY | ✅ / ✅ | — / ✅ | — | — |
| GEMINI_API_KEY, OPENROUTER_API_KEY | ✅ (both optional — see Phase-3 table) | — | — | — |
| GROQ_API_KEY | planned (P2 voice; **not yet read by any code**) | — | — | — |
| OPENWEATHER_API_KEY, DATAGOVIN_API_KEY, DATAGOVIN_RESOURCE_ID | ✅ (all optional — see Phase-2 table) | — | — | — |
| CLOUDINARY_URL | ✅ (optional; shape-validated — see Phase-3 table) | — | — | — |
| ML_SERVICE_URL | ✅ (optional; must be a URL) | — | — | — |
| CORS_ORIGINS | ✅ | — | — | — |
| DISABLE_ML / DISABLE_GEMINI / DISABLE_OPENROUTER | ✅ (**honoured in production** — operator kill switches) | — | — | — |
| FORCE_FAIL_* / FORCE_SLOW_* (non-prod only) | ✅ | — | — | — |
| MODEL_VERSION, MODEL_PATH, MODEL_MANIFEST_PATH, ENV, REQUEST_TIMEOUT_SECONDS | — | ✅ (all optional; see ml-service README) | — | — |
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

## Phase-3 providers and storage (`backend/src/config/env.js`)

| Variable | Rule | Why |
|---|---|---|
| `GEMINI_API_KEY` | **optional even in production**, min length 1 | the crop-health chain is designed so every tier can be absent and the request still answers; the terminal rule engine is local and needs no key. Absence is reported as a tier-down with reason `not_configured` |
| `OPENROUTER_API_KEY` | **optional even in production**, min length 1 | as above — it is the tertiary transport behind the same "AI-assisted" tier |
| `CLOUDINARY_URL` | **optional even in production**, but **shape-validated**: must match `cloudinary://<key>:<secret>@<cloud-name>` | non-empty is not enough — the SDK accepts a truncated paste and fails per-request with a provider error the farmer sees, so a bad value must fail at boot instead |
| `ML_SERVICE_URL` | **optional even in production**, must parse as a URL | the primary tier for SPECIALIZED crops only; absent ⇒ `not_configured` and the chain escalates |
| `DISABLE_ML`, `DISABLE_GEMINI`, `DISABLE_OPENROUTER` | `'true'`\|`'false'`, default `'false'` | operator kill switches (docs/security/ai-security.md). **Honoured in production, unlike `FORCE_FAIL_*`** — that is their purpose: shed a quota-exhausted or misbehaving tier without a redeploy. Routing-only; no value of any of them touches auth, ownership, validation or rate limiting (rule 2) |

All four provider/storage variables stay optional in production for the same reason the Phase-2 keys do: **requiring one would convert a designed degraded mode into a boot failure.** Every tier can be absent — ml-service, Gemini, OpenRouter and Cloudinary — and the request still answers, because the last tier is the local rule engine. What is *not* optional is honesty: each integration reports its own absence as a tier-down with a reason code, and `tierConfig()` (read by `/healthz` and the conductor) reports `{configured, disabled}` per tier so a missing key never looks like a model that answered UNKNOWN. The one case with no fallback is storage — an upload has nothing to degrade to — so an absent `CLOUDINARY_URL` yields `UPLOAD_ERROR` / `errors.uploadStorageUnavailable` with `rule: 'not_configured'`, not a 500.

**Failure-injection flags as implemented** (`backend/src/config/failureFlags.js`): `FORCE_FAIL_OPENMETEO`, `FORCE_FAIL_OPENWEATHER`, `FORCE_FAIL_DATAGOVIN`, and — added in Phase 3 for RES-04..06 — `FORCE_FAIL_ML`, `FORCE_FAIL_GEMINI`, `FORCE_FAIL_OPENROUTER`, `FORCE_FAIL_CLOUDINARY`; plus the matching `FORCE_SLOW_OPENMETEO` / `FORCE_SLOW_OPENWEATHER` / `FORCE_SLOW_DATAGOVIN` / `FORCE_SLOW_ML` / `FORCE_SLOW_GEMINI` / `FORCE_SLOW_OPENROUTER` / `FORCE_SLOW_CLOUDINARY` (`=<ms>` of injected latency, used to prove a timeout fires). `FORCE_FAIL_WEATHER` is honoured as an alias meaning **both** weather providers — `docs/architecture/resilience.md` uses it in its demo script and it appears in no other registry, and one switch proving RES-02 is the more useful reading. Every read is short-circuited by `isProd`, so a production host carrying one of these still behaves normally; the guard sits in one place rather than at each call site. They are routing-only: no flag weakens auth, ownership, validation or rate limiting (rule 2). `ALL_INJECTION_FLAGS` is exported so the production checklist can assert their absence.

In development a missing `JWT_SECRET` yields a **random per-process** value rather than a fixed fallback: there is no known development key to leak or accidentally trust, and tokens simply stop verifying across restarts. Production never reaches that path — the schema refuses to boot first.

## Staging checklist (Render)

Service settings live in `render.yaml` at the repo root; every secret is marked `sync: false`, so Render requires it in the dashboard and it is never committed.

Set before the first deploy: `NODE_ENV=production` · `MONGODB_URI` · `JWT_SECRET` (`openssl rand -hex 32`) · `SERVICE_KEY` (`openssl rand -hex 32`) · `CORS_ORIGINS` (exact origins, comma separated, no wildcards).

Add as each phase ships: `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `GROQ_API_KEY`, `OPENWEATHER_API_KEY`, `DATAGOVIN_API_KEY`, `DATAGOVIN_RESOURCE_ID`, `CLOUDINARY_URL`, `ML_SERVICE_URL`. None of them blocks a deploy: the three Phase-2 ones because weather runs on the keyless primary and market ingest reports `skipped:'not_configured'` and serves seeded history; the four Phase-3 ones because the crop-health chain terminates in a local rule engine. `GROQ_API_KEY` is still unread by any code (P2 voice).

Staging only, and **verified absent in production**: `FORCE_FAIL_*`, `FORCE_SLOW_*` (these are also inert in production — `isProd` short-circuits every read — so the checklist assertion is defence in depth). `DISABLE_ML`/`DISABLE_GEMINI`/`DISABLE_OPENROUTER` are **not** on that list: they are production kill switches and are expected to be present and `false`.

After deploying: `cd backend && npm run smoke -- https://<service>.onrender.com` — 18 read-only checks covering health, database connectivity, hardened headers, the error envelope, anonymous rejection, registry seeding and CORS rejection.
