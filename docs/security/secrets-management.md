# Secrets Management

## Inventory (all env-only; `.env.example` lists names + placeholders, never values)
`MONGODB_URI · JWT_SECRET · SERVICE_KEY (ml) · GEMINI_API_KEY · OPENROUTER_API_KEY · OPENWEATHER_API_KEY · DATAGOVIN_API_KEY · CLOUDINARY_URL · GROQ_API_KEY (P2) · CORS_ORIGINS · MODEL_VERSION`

## Rules
1. `.env` gitignored from commit #1; `.env.example` committed; secrets injected via host dashboards (Render/Vercel/HF) — never in code, README, screenshots, logs, or client bundles.
2. **Two-layer pre-commit secret gate** (implemented + verified in P0-3; rationale in ADR-020): layer 1 is `scripts/scan-staged-secrets.mjs`, a dependency-free Node scanner that runs on every machine; layer 2 is **Gitleaks 8.30.1** (installed via winget, on PATH), which runs additionally. Enabled automatically by `npm install` at the repo root (`prepare` sets `core.hooksPath=.githooks`). Both layers verified against planted fake credentials: commit blocked, value redacted, no commit created. Allowlisting rule learned the hard way — **never allowlist on a word appearing inside a secret** (it hid AWS's published test key); exclude only whole placeholder files. Full-history Gitleaks scan still required before the repo is made public.
   - *Environment note:* a shell opened before the Gitleaks install has a stale PATH and will fall back to layer 1 only, printing the informational notice. Open a new shell (or restart the editor) so layer 2 engages.
3. Log redaction: pino redact paths (authorization, cookie, password, *_KEY, *_URI); error envelope never echoes config.
4. Generation: JWT_SECRET & SERVICE_KEY = 256-bit random (`openssl rand -hex 32`); rotation procedure documented (issue new → deploy → old sessions naturally expire ≤30min/7d).
5. Client apps: ZERO secrets by construction — web talks only to our backend; mobile likewise; Vite/Expo env vars are treated as public by policy (only API base URLs live there).
6. Screenshot/demo hygiene: pre-demo checklist item — env panels never shown on screen; browser devtools closed during recordings.
7. Incident response (leak): rotate affected key immediately, purge from history (BFG) BEFORE any push if caught locally, audit usage window on provider dashboard.
