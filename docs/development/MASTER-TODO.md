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

## PHASE 2 — Data pipelines & engines ✅ CODE COMPLETE (2026-08-13)
_All items P2-1..P2-9 implemented and tested. **930 backend tests passing** (was 235); lint/prettier/typecheck/`npm audit`/secret-scanner/gitleaks all clean. **Two items ship in a deliberately degraded state pending external input** — the live data.gov.in feed (OD-5 key + resource id) and the crop-rec climate normals (OD-7 + IMD sourcing). Both degrade honestly rather than fabricating data; see the notes after P2-9. Details: implementation-log.md_

- [x] **P2-1** [P0](C) **COMPLETED 2026-08-13** — Open-Meteo integration (the request was unspecified anywhere in the repo; built from the named variables and **verified against the live keyless API**) + OWM fallback (no ET₀ → simplified mode; forecast-only, so validation is per-source) + weatherSnapshots upsert + q3h job + DB-first "on-demand" path. ✔ **RES-01, RES-02, RES-03 green.** Decisions: risk-type enum reconciled to the wire contract; no provider call on the request path (CLAUDE.md rule 3 over `docs/api/weather.md`); circuit-lite + 8s timeout + 1 retry with jitter.
- [x] **P2-2** [P0](C) **COMPLETED 2026-08-13** — Weather risk engine, 6 risk types, thresholds from `cropRegistry.sensitivity` with engine defaults where absent. ✔ **fixture per risk (67 tests)** covering below/at/above threshold, registry override, missing weather, unsupported stage, determinism and purity. Every risk reports `thresholdSource` so a generic threshold is never shown as crop-specific.
- [x] **P2-3** [P0](C) **COMPLETED 2026-08-13** — Irrigation engine R1–R14, pure. ✔ **133 tests**: rule-by-rule coverage, hand-computed FAO vectors with the arithmetic shown, and the four property tests `irrigation-model.md` names. **Corrected a shipped P1 defect**: `deriveStage` held Kc flat at Kc_end across the whole late season; FAO-56 requires interpolating Kc_mid → Kc_end (wheat declines 1.15 → 0.25 over 30 days). Rice's `p = 0.20`-of-saturation hazard is handled by the R11 `paddyFlooding` bypass, so `RAW = p × TAW` is never computed for rice.
- [x] **P2-4** [P0](C) **COMPLETED 2026-08-13** — Irrigation advice + ledger endpoints (`GET /crops/:id/irrigation`, `POST|GET /crops/:id/irrigation-log`) with a new per-**user** 10/day bucket. ✔ API suite; 3 ST-10 route-table rows.
- [x] **P2-5** [P0](C) **COMPLETED 2026-08-13 (locally; live feed blocked)** — data.gov.in integration + normalizer (alias map from the registry, sanity gates, clamp-and-flag, quarantine-by-rejection) + nightly job + `scripts/seed-market.mjs` + `scripts/trigger-jobs.mjs`. ✔ **RES-07 green**; the drop-rate report is the job's own return value, printable via `npm run jobs -- marketRefresh --json`. Added the `flagged` field the normalization doc always required but the model never had. ⚠ **The live call needs `DATAGOVIN_API_KEY` and `DATAGOVIN_RESOURCE_ID`** — see below.
- [x] **P2-6** [P0](C) **COMPLETED 2026-08-13** — Market signal engine (median across mandis, observation windows not calendar days, ±5% threshold) + `/market/prices` + `/market/my-crops`. ✔ signal unit tests incl. the ±4%-noise STABLE boundary; cross-user leakage asserted by id.
- [x] **P2-7** [P0](C) **COMPLETED 2026-08-13** — Feed composer (pure) + priorities/dedup/expiry + feed-refresh job + `/dashboard` + `/recommendations` + ack. ✔ **composer tests (52) + dashboard suite (28)**. **p95 sample recorded: p50 10.5ms / p95 15.7ms / max 23.0ms** over 30 requests after 3 warm-ups, at 5 farms × 30 active crops × 40 recommendations — against a 300ms local gate. N+1 guard: 30-crop p95 ÷ 1-crop p95 ≈ **1.0** (fixed 6-query budget).
- [x] **P2-8** [P1](C) **COMPLETED 2026-08-13** — Fertilizer guidance endpoint over the KB already seeded in P1-6. ✔ **snapshot tests per crop×stage + disclaimer-on-every-response test + unit-preservation test** (cotton stays `kg/acre`, rice stays `kg/ha` — never silently converted). Onion's unit-less dose is flagged `unitUnknown` rather than rendered bare. ⏳ **wheat/soybean verification handled honestly, not closed** — see below.
- [x] **P2-9** [P1](C) **COMPLETED 2026-08-13 (engine; normals blocked)** — Crop-rec engine with the documented gates and weights (0.30/0.25/0.30/0.15), reasons carrying the registry field they rest on, and `POST /crop-recommendation` at 20/day per user. ✔ golden cases. ⚠ **The climate-normals table is deliberately empty** — see below.

**Outstanding external items (not code gaps):**
1. **OD-5 — data.gov.in.** The whole market pipeline is built and fixture-tested, but the live feed needs two variables that do not exist: `DATAGOVIN_API_KEY` (the free registered key) and `DATAGOVIN_RESOURCE_ID` (the catalogue id of "Variety-wise Daily Market Prices" — **no repository document publishes one**, and it is deliberately not defaulted rather than guessed). Until then the job reports `skipped: 'not_configured'` naming both variables, and seeded history serves labelled ● Historical. Owner: A.
2. **OD-7 + IMD normals — crop recommendation.** `shared/constants/climate-normals.js` is an empty table by design. Populating it with plausible numbers would fabricate the input that decides whether a farmer is told to plant a crop their rainfall cannot support. Consequence today: `S_temp` is never scored and `S_water` is scored only for irrigated farms; the excluded factors are named in the response's `limitations` and the weights renormalise over what was known, with `evidenceRatio` reporting how much of the documented weight was actually backed by data. Needs (a) the demo-state decision and (b) a sourced IMD extract. Owner: A/B.
3. **Wheat/soybean fertilizer verification (A/B).** Unchanged and unclosed. Wheat: PAU publishes no K₂O figure (recorded `null`, not zero) and "urea 45kg before 1st & 2nd irrigation" is ambiguous by a factor of two in top-dressed nitrogen. Soybean: the ICAR-IISR Bulletin 18 PDF was never pulled, so the entry has **no source URL** — violating the KB's own "no number without source.url" rule. Both crops carry `verificationPending: true` through to the client. Resolving needs the two primary PDFs read by a human.
4. **~21 LIMITED crop roster** — still awaiting approval (carried from P1-6).
5. **Render staging deploy** — still owner A (carried from P1-8).

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
