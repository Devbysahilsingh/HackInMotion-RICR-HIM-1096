# MASTER TODO

Legend: [P0..P3] priority · (owner: A=Dev A, B=Dev B, C=Claude; solo-mode: B→A/C) · «dep» dependency · ✔=verification. Phases map dependencies, not calendar; hour targets in 72-HOUR ROADMAP below.

**Implementation status:** in progress — controlled one-TODO-at-a-time mode. Completed work is recorded in `docs/development/implementation-log.md` (authoritative record of what actually runs). TODO IDs (P0-1, P1-3, …) are assigned in reading order within each phase.

## PHASE 0 — Accounts, data, scaffold (blocks everything)
- [ ] [P0](A) Create accounts/keys: data.gov.in (FIRST — approval lag), Google AI Studio, MongoDB Atlas, Cloudinary, OpenWeatherMap, Render, Vercel, HF, cron-job.org, UptimeRobot; store in local .env ✔ each key smoke-tested by script
- [x] **P0-2** [P0](A) **CLOSED — NOT NEEDED 2026-08-12.** Kaggle credentials were required only for Paddy Doctor, which was rejected on licence grounds and replaced by the CC BY 4.0 Odisha rice dataset (no account required). OD-6 resolved as "not needed" unless the Paddy Doctor authors publish a licence.
- [x] **P0-3** [P0](C) **COMPLETED 2026-08-12** — Repo foundation + backend + web scaffolds: tooling (eslint/prettier/tsconfig/editorconfig), .gitignore/.gitattributes, two-layer secret-scanning pre-commit gate, shared/ structure, backend skeleton (env validation, logger, error envelope, /healthz, graceful shutdown), web skeleton (Vite+React+TS+Tailwind). ✔ verified: install/lint/format/typecheck/build clean, backend boots + /healthz 200, fail-fast on bad env with no secret leakage, secret gate blocks a planted fake key. **Verification pass 2:** browser render PASS (headless Chrome — React mounts, Tailwind applied, zero console errors) and real Gitleaks 8.30.1 installed + clean-scan/fake-secret/pre-commit-blocking all PASS; two allowlist defects found and fixed. Details: implementation-log.md
  - **Scope split (approved):** mobile and ml-service scaffolds moved to their own phases — see P6-1 and P3-2 — because their installs are large and unverifiable until those phases. No plan change beyond sequencing.
- [x] **P0-4** [P0](C) **COMPLETED 2026-08-12** — `scripts/ml/download_datasets.py` + declarative `dataset-sources.json` → 6 datasets, **83,422 images, 16.3 GB**, all extracted safely. ✔ verified: 5/6 archives checksum-matched against publisher values (PlantDoc has no publisher hash), 40/40 sample decode clean on every dataset, zero corrupt files, counts reconciled against published figures, re-run proven idempotent. Licences captured in `datasets/licenses/`. **Rice: Paddy Doctor REJECTED** (paid-subscription access + no published image licence) → **substituted Odisha/Sethy CC BY 4.0 set** per team decision (option C). Details: implementation-log.md
- [ ] [P0](C) Dataset audit per docs/ml/dataset-audit.md → report + **cotton verdict OD-1** ✔ team approves report
- [ ] [P0](C) `scripts/ml/prepare-datasets.py`: class map, pHash dedup, cluster-atomic splits, manifest ✔ leakage check zero; class census table
- [ ] [P1](C) Field test set from PlantDoc overlap ✔ cross-set dedup vs train = zero

## PHASE 1 — Backend foundation
- [ ] [P0](C→A review) Express app skeleton: middleware stack order, env zod validation, pino+redaction, error envelope, /healthz ✔ ST-50 subset green
- [ ] [P0](C) Mongoose models ×12 + indexes script ✔ index build assertion test
- [ ] [P0](C) Auth: register/login (bcrypt12, generic errors), JWT issue/verify, refresh rotation + family reuse detection, logout, /auth/me, rate limits, auditLogs ✔ ST-01..05 green
- [ ] [P0](C) Ownership middleware factory + route table ✔ ST-10 matrix harness runs
- [ ] [P0](C) Farms CRUD + location registration hook ✔ API suite
- [ ] [P0](C) cropRegistry model + seed script from knowledge/ JSONs (9 crops full + ~20 LIMITED stubs; sources embedded) ✔ seedMeta versioned; registry API serves
- [ ] [P0](C) Crops CRUD + stage derivation util ✔ API suite + stage unit tests
- [ ] [P0](A) Review pass + secrets into Render env (staging) ✔ deployed skeleton healthz green

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
