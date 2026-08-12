# MASTER TODO

Legend: [P0..P3] priority · (owner: A=Dev A, B=Dev B, C=Claude; solo-mode: B→A/C) · «dep» dependency · ✔=verification. Phases map dependencies, not calendar; hour targets in 72-HOUR ROADMAP below.

**Implementation status:** in progress — controlled one-TODO-at-a-time mode. Completed work is recorded in `docs/development/implementation-log.md` (authoritative record of what actually runs). TODO IDs (P0-1, P1-3, …) are assigned in reading order within each phase.

## PHASE 0 — Accounts, data, scaffold (blocks everything)
- [ ] [P0](A) Create accounts/keys: data.gov.in (FIRST — approval lag), Google AI Studio, MongoDB Atlas, Cloudinary, OpenWeatherMap, Render, Vercel, HF, cron-job.org, UptimeRobot; store in local .env ✔ each key smoke-tested by script
- [x] **P0-2** [P0](A) **CLOSED — NOT NEEDED 2026-08-12.** Kaggle credentials were required only for Paddy Doctor, which was rejected on licence grounds and replaced by the CC BY 4.0 Odisha rice dataset (no account required). OD-6 resolved as "not needed" unless the Paddy Doctor authors publish a licence.
- [x] **P0-3** [P0](C) **COMPLETED 2026-08-12** — Repo foundation + backend + web scaffolds: tooling (eslint/prettier/tsconfig/editorconfig), .gitignore/.gitattributes, two-layer secret-scanning pre-commit gate, shared/ structure, backend skeleton (env validation, logger, error envelope, /healthz, graceful shutdown), web skeleton (Vite+React+TS+Tailwind). ✔ verified: install/lint/format/typecheck/build clean, backend boots + /healthz 200, fail-fast on bad env with no secret leakage, secret gate blocks a planted fake key. **Verification pass 2:** browser render PASS (headless Chrome — React mounts, Tailwind applied, zero console errors) and real Gitleaks 8.30.1 installed + clean-scan/fake-secret/pre-commit-blocking all PASS; two allowlist defects found and fixed. Details: implementation-log.md
  - **Scope split (approved):** mobile and ml-service scaffolds moved to their own phases — see P6-1 and P3-2 — because their installs are large and unverifiable until those phases. No plan change beyond sequencing.
- [x] **P0-4** [P0](C) **COMPLETED 2026-08-12** — `scripts/ml/download_datasets.py` + declarative `dataset-sources.json` → 6 datasets, **83,422 images, 16.3 GB**, all extracted safely. ✔ verified: 5/6 archives checksum-matched against publisher values (PlantDoc has no publisher hash), 40/40 sample decode clean on every dataset, zero corrupt files, counts reconciled against published figures, re-run proven idempotent. Licences captured in `datasets/licenses/`. **Rice: Paddy Doctor REJECTED** (paid-subscription access + no published image licence) → **substituted Odisha/Sethy CC BY 4.0 set** per team decision (option C). Details: implementation-log.md
- [x] **P0-5** [P0](C) **COMPLETED 2026-08-12** — Dataset audit per docs/ml/dataset-audit.md: `scripts/ml/audit-datasets.py` + `datasets/audit-report.json`. ✔ verified: 83,421 images, 0 decode failures; 9,021 near-duplicate redundant images (10.8%) after pixel-verified clustering; **0 cross-dataset clusters** (PlantDoc field test is clean of PlantVillage); **PlantDoc train↔test leakage found** (11 duplicate groups, 8 label-contradicted); **rice_odisha is 59% redundant** (2,446 usable, not 5,932); cotton **OD-1 mechanical verdict PASS on 6 of 7 classes** (the plan's 8-class assumption was wrong). Verification cut calibrated against controls, not guessed. **Team decisions still open** — cotton OD-1, rice healthy class, Background_without_leaves, chilli domain gap, PlantDoc cleaning, POTATO_HEALTHY=152. Details: implementation-log.md ⏳ awaiting team approval of the report
- [x] **P0-5b** [P0](C) **COMPLETED 2026-08-12** — Rice healthy acquisition per ADR-021 decision 2 (all 7 audit decisions approved). `rice_healthy_diu` (Mendeley `g7tcwvshff`, **CC BY 4.0**, publisher sha256 matched, counts exact, 0 decode failures, **0 duplicates against rice_odisha**). `RICE_NORMAL` = **582** usable; rice rises 2,446 → **4,058** across 5 classes. ⚠ **One condition failed:** the healthy images are studio (leaves on white paper), not field — `RICE_NORMAL` has zero field-realistic examples. Options in ADR-021; **team decision pending**. Details: implementation-log.md
- [x] **P0-6** [P0](C) **COMPLETED 2026-08-12** — `scripts/ml/prepare-datasets.py` + `curation-rules.json` (ADR-021 decisions as data) → `datasets/manifest.json`. **39,960 unique images, 36 classes → train 27,009 / val 5,811 / test 5,876 / fieldtest 1,264**; 54,227 exclusions each carrying its rule and reason. ✔ verified: 0 clusters span splits (asserted), field test disjoint from train/val, **all 36 classes ≥50 test images**, counts match the P0-5 unique figures, and re-running reproduced identical split hashes. No training, no preprocessing, raw corpus untouched. ⚠ Found: **59 byte-identical rice images filed as both healthy and tungro** (quarantined; `RICE_NORMAL` = 549). Details: implementation-log.md
- [x] **P0-6b** [P0](C) **COMPLETED 2026-08-13** — Pre-training gates resolved. `probe-confounds.py` (measures source separability with a fixed statistic, trains nothing): **chilli 0.91 and rice 0.96 separable, both CONFOUNDED**; tomato/potato/maize separable but not confounded. Fixed by **source-stratified splits** + `known_confounds` with mandatory evaluation gates. Healthy-rice: no acquisition needed, limitation + gate encoded. `review-fieldtest.py` + **31 images quarantined after visual review** (18 stock watermarks, 8 composite figures, 4 non-photographs, 1 non-leaf); **`TOMATO_SPIDER_MITES` field test is now zero** (both its images were disease-comparison figures). Review coverage stated: 209/1,264. ✔ re-validated: gates PASS, split hashes reproducible, exclusions traceable, raw untouched. Details: implementation-log.md
- [x] **P1-x** [P1](C) Field test set from PlantDoc overlap — **delivered as part of P0-6**: whole of PlantDoc held out, 1,233 images after quarantine ✔ cross-set dedup vs train = **zero verified clusters**

## PHASE 1 — Backend foundation ✅ COMPLETE (2026-08-13)
_All items P1-1..P1-8 implemented, tested and reviewed. **235 backend tests passing**; ST-50, ST-01..05, ST-10 and ST-70 green; lint/prettier/typecheck/`npm audit`/secret-scanners/gitleaks all clean. The only outstanding piece is the external Render deploy (see the note after P1-8)._
- [x] **P1-1** [P0](C→A review) **COMPLETED 2026-08-13** — Express app skeleton: middleware order per api-security.md (helmet → CORS allowlist → requestId → global rate limit → 100KB JSON → mongo-sanitize → pino+redaction → routes → error handler), env zod validation, error envelope with `meta.requestId`, `/healthz` reporting real db state. ✔ **ST-50 green (9 assertions)**. Decisions: ADR-022 (test runner), `PAYLOAD_TOO_LARGE`/`NOT_IMPLEMENTED` added to the error catalogue, CORS credentials scoped to `/api/v1/auth`, `CORS_ORIGINS` now required in production.
- [x] **P1-2** [P0](C) **COMPLETED 2026-08-13** — **14 Mongoose models** (the documented set; the "×12" count excluded communityAlerts P2 and yieldEstimates P3, both of which get schemas but no writes) + `scripts/build-indexes.mjs`. ✔ **index build assertion test green against a real mongod** — 23 declared indexes, keys/order/uniqueness/TTL/partial-filter all asserted, undeclared indexes rejected, TTL confirmed on exactly `refreshTokens` and `auditLogs`.
- [x] **P1-3** [P0](C) **COMPLETED 2026-08-13** — Auth: register/login (bcrypt **cost 12**, timing-equalised via a decoy hash, generic errors), JWT HS256 with pinned algorithm + issuer + audience, refresh rotation, **family reuse detection**, logout (idempotent), `/auth/me`, rate limits (login 5/15min keyed IP+email, register 10/h, refresh 60/h, global 300/15min), auditLogs. ✔ **ST-01..05 green (21 assertions)**.
- [x] **P1-4** [P0](C) **COMPLETED 2026-08-13** — `loadOwned` factory (filter-level ownership, full parent-chain check, ObjectId rejected before query) + **route table** `src/routes/ownership-table.js` + `docs/security/route-ownership.md`. ✔ **ST-10 matrix green** — generated from the table, so an unlisted protected route fails CI.
- [x] **P1-5** [P0](C) **COMPLETED 2026-08-13** — Farms CRUD + location registration hook (0.1° `locationKey` derivation only — **no provider call on the request path**, DB-first rule 3), 10-farm cap, India-bbox validation, cascade delete. ✔ API suite green (23 tests).
- [x] **P1-6** [P0](C) **COMPLETED 2026-08-13** — cropRegistry model + `src/knowledge/` authored from primary sources + `scripts/seed-registry.mjs` + public registry API with ETag. **9 crops seeded with FAO-56 Kc/root-depth/depletion transcribed from the published tables**, each value carrying a `sourceRef` URL; fertilizer NPK transcribed with units preserved exactly as published; `mlClassCodes` taken from `datasets/manifest.json` (35 real classes) **not** the stale crop-class-mapping doc; ADR-021 tier overrides applied. ✔ **seedMeta versioned** (content hash), seed validates all documents before writing any, re-run is a no-op, registry API serves. ⏳ **~21 LIMITED stubs proposed but NOT seeded — awaiting roster approval** (gated in code on the proposal's `status`).
- [x] **P1-7** [P0](C) **COMPLETED 2026-08-13** — Crops CRUD (nested ownership, 12-active cap, sowing window, forward-only status transitions, cascade) + **pure** `engines/stage/deriveStage.js` with FAO-56 DEVELOPMENT interpolation and a structured trace (R12). ✔ API suite + **57 stage unit tests** incl. boundaries, empty/invalid registries, and the Kc(MID) > Kc(INITIAL) property.
- [x] **P1-8** [P0](A/C) **COMPLETED 2026-08-13 (implementation + review)** — Security review pass and deployment configuration. Adversarial review ran **live probes against a running instance** (in-memory mongod, real HTTP), not static reading: **no critical finding**; **2 HIGH** (non-atomic refresh rotation that let two concurrent presentations of one token both succeed with zero `token_reuse` audits; `X-Forwarded-For` resetting the login/global rate-limit buckets outside production), **4 MEDIUM** (crop cap bypassable via `planned`->`active`; unauthenticated 500 + stack-trace log flood from a malformed `rt` cookie; unbounded `User-Agent` persisted on every auth event; `rate_limited` audit events never written because the helper was dead code), **5 low** — **all fixed, each with a regression test that fails against the old code**. Deployment configuration delivered and locally verified: `render.yaml` (every secret `sync: false`, no value in git), staging env checklist in `docs/deployment/environment.md`, and `backend/scripts/smoke.mjs` — **18/18 checks pass against a local `NODE_ENV=production` server backed by a real database**. ⚠ **The Render deploy itself is NOT done and is NOT claimed:** no Render account exists (Phase-0 accounts row above is still open). Deploying and verifying staging `/healthz` remain **external setup items** tracked in Phase 0 / Phase 8 — see "Remaining external item" below.

**Remaining external item (not a Phase-1 code gap):** Render account creation + staging deploy + staging `/healthz` verification. Everything locally verifiable is done and committed (`render.yaml`, env checklist, `npm run smoke -- <url>`); the deploy needs account access. Owner: A. Tracked in the Phase-0 accounts row and Phase 8 deploy sequence.

## PHASE 2 — Data pipelines & engines
- [ ] [P0](C) Open-Meteo integration (validated fetch, locationKey rounding) + OWM fallback + weatherSnapshots upsert + cron q3h + on-demand path ✔ RES-01..03
- [ ] [P0](C) Weather risk engine (6 risk types × registry thresholds) ✔ fixture per risk
- [ ] [P0](C) Irrigation engine R1–R14 (pure) + FAO test vectors + property tests ✔ all vectors pass; A walkthrough
- [ ] [P0](C) Irrigation API + ledger endpoints ✔ API suite
- [ ] [P0](C) data.gov.in integration + normalizer (alias map, sanity gates, quarantine) + nightly cron + CEDA seed script ✔ RES-07; drop-rate report
- [ ] [P0](C) Market signal + trends + my-crops endpoints ✔ signal unit tests
- [ ] [P0](C) Feed composer + priorities/dedup/expiry + feed-refresh job + /dashboard aggregation ✔ composer tests; p95 sample
- [ ] [P1](C) Fertilizer KB seeds (from docs/fertilizer/knowledge-base.md, sources embedded; wheat/soybean verification task (A/B)) + guidance endpoint ✔ snapshot tests + disclaimer test
- [ ] [P1](C) Crop-rec engine (gates+weights+reasons w/ sourceRefs) + endpoint + climate-normals constants for demo states ✔ golden cases

## PHASE 3 — Crop health chain (the hero)
- [ ] [P0](C) Upload pipeline: multer limits→magic bytes→bomb guard→sharp re-encode→EXIF strip→Cloudinary ✔ ST-30 all fixtures
- [ ] **P3-2** [P0](C) ml-service FastAPI skeleton (scaffold moved here from P0-3): /predict (service key), /healthz, preprocessing, ONNX runtime harness (stub model first) ✔ pytest contract suite
- [ ] [P0](C) Gemini integration: prompt builder + responseSchema + zod validation + registry-closing + kill-switch ✔ recorded-payload tests + adversarial fixtures
- [ ] [P0](C) OpenRouter tertiary (same contract) ✔ tier test
- [ ] [P0](C) Rule-based symptom engine (KB weights) + symptom-check endpoint ✔ fixture answer-sets ordering
- [ ] [P0](C) Health service conductor: registry routing, confidence gating, tier-down, source labeling, image-hash cache, recommendation emission ✔ 8-combination router matrix test
- [ ] [P1](C) Severity follow-up endpoint (engine-derived) ✔ unit
- [ ] [P2](C) Community consent field + aggregation job + alerts endpoint + fan-out ✔ ST-20 + job tests

## PHASE 4 — ML training (parallel track from Phase 0 completion; RTX 2050)
- [ ] [P0](C) Training env: venv py3.12, torch cu12x, verify CUDA visible ✔ torch.cuda.is_available() true
- [ ] [P0](C) Training pipeline code (config-driven, AMP, sampler, checkpoints, early stop, experiments log) ✔ Run 0 ResNet18 sanity gates
- [ ] [P0](C) «audit approval» EffNet-B0 Run 1+2 (overnight) ✔ curves logged; no-leakage smell check
- [ ] [P0](C) Temperature calibration + τ/τ_healthy derivation ✔ curves committed
- [ ] [P0](C) Evaluation battery + field-test gap + error analysis ✔ ship gates table; report to team
- [ ] [P0](C) ONNX export + golden parity + manifest ✔ parity <1e-3
- [ ] [P0](C) Artifact into ml-service + real-model integration test ✔ E2E analyze with real leaf images (sample set)
- [ ] [P1](C) Grad-CAM background-reliance probe ✔ findings in error-analysis
- [ ] [P2](C) Optional Run 3 / augmentation experiment if gates need it

## PHASE 5 — Web frontend
- [ ] [P0](C→B pass) Vite scaffold + Tailwind + router + Query + axios interceptors + i18n init + QueryBoundary ✔ auth bootstrap flow works
- [ ] [P0](C/B) ui/ primitives (list in component-map) ✔ RTL chip/dot tests
- [ ] [P0](C/B) Auth pages + guards ✔ E2E segment
- [ ] [P0](C/B) Farm + crop forms/flows (GPS+manual, pickers) ✔ RTL validation
- [ ] [P0](C/B) Dashboard (feed, crop cards, ack, why-trace) ✔ E2E
- [ ] [P0](C/B) Scan flow + result page (all branches incl. uncertain) ✔ E2E + fixtures
- [ ] [P0](C/B) Weather/irrigation page + market page (Recharts; load dataviz skill at build) ✔ visual review
- [ ] [P1](B/C) History views; fertilizer tab; crop-rec wizard; freshness dots everywhere ✔ walkthrough
- [ ] [P2](B) Community page; voice (web STT+TTS+intent buttons); TTS speak buttons
- [ ] [P0](B/A) **Hindi resources verification pass** «all screens» ✔ parity script + human sign-off

## PHASE 6 — Mobile
- [ ] **P6-1** [P0](C) Expo scaffold (moved here from P0-3) + navigation + shared/i18n metro config + interceptors + SecureStore auth ✔ login on device
- [ ] [P0](C/B) Screens: LanguageIntro, Auth, Dashboard, FarmList/Form, CropForm/Detail ✔ manual matrix rows
- [ ] [P0](C/B) Camera flow (permissions, capture, compress, upload progress/retry) + Analyzing + Result ✔ real-device E2E with printed leaf
- [ ] [P0](C/B) Weather/irrigation + market screens ✔ matrix
- [ ] [P1](C) Offline persistence + banners + prefetch registry ✔ RES-09..12
- [ ] [P1](B) Settings (language/consent/logout) + history list ✔ matrix
- [ ] [P2](C/B) TTS readout; STT decision point (dev build or Groq path or intents-only)
- [ ] [P0](A/B) EAS APK build + demo phone install ✔ APK smoke + strings-scan

## PHASE 7 — Security & resilience hardening
- [ ] [P0](C) Complete ST-01..70 automated suites; (A) reviews + runs ✔ all blocking green
- [ ] [P0](C) Failure-injection flags + RES matrix scripted parts ✔ 12/12 documented pass
- [ ] [P0](A) npm/pip audits; Gitleaks history scan ✔ clean or excepted
- [ ] [P1](A) ZAP baseline (time-permitting) ✔ report archived

## PHASE 8 — Deploy & seed
- [ ] [P0](A+C) Deploy sequence per docs/deployment/architecture.md ✔ production-checklist.md fully ticked
- [ ] [P0](C) Demo farmer seed (rich 30-day history: health logs, ledger, price context) ✔ demo dashboard rich on login
- [ ] [P0](A) Keep-alive + monitors ✔ uptime evidence collecting

## PHASE 9 — Demo, docs, submission
- [ ] [P0](B/A) Demo script (docs/product + FINAL-PLAN-SPEC §37) + rehearsal ×2 incl. failure toggle + backup video ✔ timed ≤12min
- [ ] [P0](C) architecture-diagram.png (render mermaid), api-documentation.md (from docs/api), README final (real metrics from artifacts only), screenshots ✔ repo deliverables complete
- [ ] [P0](B) presentation.pptx ✔ team review
- [ ] [P0](all) Viva walkthrough sessions ×2 ✔ each member explains each subsystem
- [ ] [P0](A) Submission: repo naming/structure check vs general instructions, tags, final push ✔ checklist

## P3 backlog (architected, deferred)
Yield estimator implementation (lookup ingestion + endpoint) · offline write queue · password recovery/OTP · push notifications · on-device TFLite · SoyNet soybean model · account deletion endpoint · Marathi voice.

---

# 72-HOUR ROADMAP (dependency-mapped; owners as above)
**Day 0 / hours 0–6:** Phase 0 complete; audit approved; overnight = nothing yet (data ready).
**Day 1 / hours 6–30:** Phases 1–2 backend (C codes, A reviews continuously); web scaffold+auth+farm flows (Phase 5 start); mobile scaffold (Phase 6 start); **night 1: ML Runs 0–2 overnight**; STT dev-build go/no-go decided.
**Day 2 / hours 30–54:** Phase 3 health chain E2E with stub→real model (model integrated by evening: calibration+eval midday); dashboard+scan+market web screens; mobile core screens+camera; fertilizer+crop-rec (P1); i18n Hindi drafting continuous, verification session evening; security suites accumulating; **night 2: optional Run 3 / buffer**.
**Day 3 / hours 54–72:** mobile completion + offline; P2 items per cut-order; Phase 7 hardening full pass; Phase 8 deploy by hour 62; Phase 9 demo prep, rehearsals, docs freeze, submission by hour 70; buffer 2h.
Slip protocol: cut-order in docs/product/feature-scope.md executes automatically at defined checkpoints (hour 48: P2 gate; hour 60: P1 gate) — announced in team channel, never silent.
