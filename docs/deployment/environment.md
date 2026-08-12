# Environment Matrix

Root `.env.example` documents every variable (names + placeholders only). Boot-time Zod env validation in backend and pydantic-settings in ml-service — missing secret ⇒ refuse to start with clear message.

**Implemented behaviour (P0-3, `backend/src/config/env.js`):** validation runs before the server binds and reports variable **names and rules only** — values are never echoed. `MONGODB_URI`, `JWT_SECRET` and `SERVICE_KEY` are **required when `NODE_ENV=production`** and optional in development, so a misconfigured deploy fails at boot while local work is not blocked on credentials that do not exist yet. Each becomes unconditionally required once the subsystem consuming it ships. Local development loads `.env` via Node's native `--env-file` (`npm run dev`); production reads host-injected variables (`npm start`, no file needed).

| Var | Backend | ml-service | Web (public) | Mobile (public) |
|---|---|---|---|---|
| MONGODB_URI | ✅ | — | — | — |
| JWT_SECRET / SERVICE_KEY | ✅ / ✅ | — / ✅ | — | — |
| GEMINI_API_KEY, OPENROUTER_API_KEY, GROQ_API_KEY | ✅ | — | — | — |
| OPENWEATHER_API_KEY, DATAGOVIN_API_KEY | ✅ | — | — | — |
| CLOUDINARY_URL | ✅ | — | — | — |
| ML_SERVICE_URL | ✅ | — | — | — |
| CORS_ORIGINS | ✅ | — | — | — |
| DISABLE_*/FORCE_FAIL_* (non-prod) | ✅ | — | — | — |
| MODEL_VERSION | — | ✅ | — | — |
| VITE_API_URL / EXPO_PUBLIC_API_URL | — | — | ✅ | ✅ |
| SEED_DEMO_PASSWORD | ✅ (scripts only) | — | — | — |
Dev vs prod: NODE_ENV governs error verbosity in logs (never in responses), failure-flag availability, /dev/components route inclusion (web build-time). Same security middleware in both — no dev auth relaxation.
