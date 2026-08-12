# CLAUDE.md — Operating Manual (Smart Farm Decision Support System · HackInMotion 2026 · HIM-1096)

**Read this before any work. `docs/FINAL-PLAN-SPEC.md` is the single source of truth for intent; `docs/development/implementation-log.md` is the source of truth for what actually exists and has been verified; this file is the enforcement layer.**

**Current phase: IMPLEMENTATION — controlled, one TODO at a time.** The user recommends/approves each TODO before it is built. Never chain TODOs autonomously: implement exactly the approved TODO, verify it, report, then stop and wait. If an unexpected prerequisite appears, stop and explain rather than absorbing it silently.

**Completed:** P0-3 development foundation (tooling, secret gate, backend + web scaffolds). **Next:** proposed for approval — see implementation-log.md.

**How to run what exists:** root `npm install` (installs tooling and enables the pre-commit hook) · `cd backend && npm install && npm run dev` (needs `backend/.env`; copy names from `.env.example`) · `cd web/frontend && npm install && npm run dev`. Repo-wide checks: `npm run lint`, `npm run format:check`.

## Project context
India-focused farmer decision-support platform (web + Android). Farmer → Farm → Crop → decisions: irrigate? weather risk? crop sick? fertilize? sell? plant what? Every recommendation personalized (≥3 profile factors), explainable (why-trace), localized (hi/en), resilient (cache-first), and honest (freshness/confidence labels). Full problem statement: FINAL-PLAN-SPEC §2; traceability: docs/requirements-traceability.md.

## Architecture (fixed — do not re-architect)
React+Vite web (Vercel) & React Native+Expo Android — one REST contract → Node20/Express (Render) with pure engines + cron jobs → MongoDB Atlas M0 → FastAPI+ONNX ml-service (internal, X-Service-Key). External: Open-Meteo→OWM, data.gov.in→seed, Gemini→OpenRouter→rules, Cloudinary, Groq(P2). Details: docs/architecture/, docs/backend/, docs/frontend/, docs/mobile/.

## Non-negotiable rules
1. **One approved TODO at a time.** No feature work beyond the approved TODO's scope; no autonomous chaining; no final ML training or deployment without its own approval.
2. **Security = feature:** every endpoint: Zod validation + auth + ownership (404 pattern) + rate limit + safe errors. NO backdoors, master passwords, hidden/secret routes, demo auth bypasses, hardcoded credentials, client-only authorization — ever, under any time pressure. Demo runs production security config.
3. **DB-first reads:** request paths never call weather/market providers; jobs ingest with validate-then-cache; failures never overwrite last-known-good.
4. **Registry-driven crops:** `if (cropCode === 'TOMATO')`-style conditionals are banned; all crop knowledge lives in cropRegistry documents.
5. **Engines are pure:** engines/ import nothing above utils/constants; deterministic; fixture-tested; every output carries a trace (R12).
6. **AI perceives, engines decide, KB speaks:** LLMs never author farmer-facing agronomic advice, dosages, or treatment text; Gemini output is schema-validated, registry-closed; uncertain results are never forced into predictions.
7. **No fabricated anything:** no invented metrics, NPK numbers, yields, licenses, API limits, or "demo mode" fake data. Seeded demo data = real historical/labeled data. Failed runs get logged as failed.
8. **i18n:** zero hardcoded user-facing strings; keys+params in DB/API; shared/i18n canonical; agronomic Hindi requires human verification before demo.
9. **Honesty labels:** cached/stale/AI-assisted/estimated content always labeled (● system); severity is engine-assessed, never model-fabricated.
10. **Zero cost:** no paid service may be introduced; free-tier quotas guarded by per-user caps.
11. **Secrets:** env-only; Gitleaks hook; never in code/README/screenshots/logs/client bundles.
12. **Privacy:** community data district-aggregated, consent-gated, structurally PII-free; no analytics trackers; images private per account.

## Conventions
- **Code style:** match surrounding file; TypeScript on clients, JS (or TS if scaffolded so) backend; conventional commits (`feat(scope): …`) + Claude co-author trailer on Claude commits; comments only for non-obvious constraints.
- **API:** /api/v1; envelope {success, data|error{code,messageKey,details}}; codes from docs/api/error-codes.md only; no endpoint without an FR mapping.
- **DB:** schemas/indexes per docs/database/; every owned doc has userId; no new collections without documented justification (see "deliberately NOT collections" list).
- **ML:** all work per docs/ml/ (audit gates → training config-driven → evaluation battery → ship gates → parity-tested ONNX). Major strategy changes (arch swap, class restructure, dataset add/drop) require team approval; routine experiments don't. Metrics only from committed artifacts.
- **Testing:** blocking suites in docs/testing/strategy.md table; feature DoD below; failure-injection flags are routing-only, non-prod.
- **Git:** feature branches → PR → human review (always, for Claude-authored code); main stays demoable; no fake/padding commits.
- **Docs:** update the relevant docs/ file in the same PR as the change it describes; ADR for any decision that alters an existing ADR.

## Definition of Done (per feature)
Implements FR + validation + ownership + safe errors + rate limit (if applicable) + i18n keys en+hi + loading/empty/error/offline states + freshness labels (if data-bearing) + tests per test-matrix + docs updated + security abuse cases considered (docs/security DoD).

## Things Claude must NOT do
Start implementation before the gate · weaken/skip any rule above to save time · add dependencies beyond docs/security/dependency-security.md list without stated justification · invent agronomic facts, translations of agronomic terms without flagging for human verification, or dataset/license claims · create admin surfaces, notification services, or new external dependencies "while at it" · commit datasets, models >LFS threshold, .env, or generated artifacts · optimize for feature count over the P0 core · silently execute the cut-order (announce cuts) · claim anything works that hasn't run.

## Open decisions (check before relying)
OD-1 cotton gate (post-audit) · OD-2 ml-service host (Day-1 latency test) · OD-3 team headcount · OD-4 product name (KrishiSaarthi placeholder) · OD-5 data.gov.in key · OD-6 Kaggle credentials. Full list: FINAL-PLAN-SPEC §42.
