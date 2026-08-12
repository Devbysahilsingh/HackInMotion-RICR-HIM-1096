# FINAL PLAN SPECIFICATION — Smart Farm Decision Support System
**HackInMotion 2026 · Team HIM-1096 · v2 (challenge capabilities integrated) · 2026-08-12 · STATUS: APPROVED — IMPLEMENTATION IN PROGRESS**

> Implementation runs in controlled one-TODO-at-a-time mode. **What actually exists and has been verified is recorded in `docs/development/implementation-log.md`** — this spec states intent; the log states reality. Completed so far: P0-3 (development foundation).

> SINGLE SOURCE OF TRUTH. Domain docs elaborate; conflicts resolve to this document. Open items: `[DECISION REQUIRED]` (§33 register). Implementation is gated on the explicit instruction **START IMPLEMENTATION**.

## 1. Problem
Official HackInMotion statement (traced line-by-line in `docs/requirements-traceability.md`): farmers decide crop choice, irrigation timing, weather response, disease response, and sell timing with fragmented data and no decision-grade tool. Required: full-stack platform covering auth, farm profiles, weather-driven irrigation+risk engine, crop-health monitoring, market insights, unified dashboard, persistence, responsive UI, error handling — plus six challenge capabilities (crop recommendation, voice, community alerts, fertilizer, yield, offline), all of which this plan implements or specs (none dropped).

## 2. Vision
A knowledgeable farming advisor in the farmer's pocket and language: open the app → know what to act on today → understand why (real numbers) → act → track. Advisor, not widgets. Honest, explainable, resilient, ₹0 to run.

## 3. Personas
`docs/product/personas.md`: Ramesh (Hindi-only, low digital literacy, 3ac MP — verdicts, voice, camera-first), Priya (bilingual Nashik tomato/onion — trends, early warning, explanations), Anil (progressive UP — crop-rec, fertilizer planning, shares advisories).

## 4. Requirements
FR/NFR catalog: `docs/product/requirements.md` (FR-A/F/W/I/H/M/D/DB/U/E + FR-R/V/CM/FE/Y/O; NFR-1..7). Traceability: `docs/requirements-traceability.md` (mandatory artifact — every problem-statement line mapped to feature/API/DB/UI/ML/test/docs/demo).

## 5. Feature scope
`docs/product/feature-scope.md`. P0 = all nine must-haves on web+mobile. P1 = crop recommendation, fertilizer guidance, history, explainability traces, freshness system, mandi comparison, irrigation logging. P2 = community alerts, voice, offline reads, mobile crop-rec. P3 = yield estimator (spec complete), offline write-queue, recovery/push/iOS/on-device ML. Explicit cut-order defined; cuts announced, never silent.

## 6. Architecture
`docs/architecture/overview.md` (+ mermaid → architecture-diagram.png at implementation). Clients (React web, RN/Expo Android) → one REST API (Express, Render) → MongoDB Atlas; FastAPI+ONNX ml-service internal; cron jobs ingest external data. Principles: DB-first reads; pure engines; registry-driven crops; one API contract; AI perceives/engines decide/KB speaks; zero cost; production security in demo.

## 7. Web
`docs/frontend/` (6 docs): React18+Vite+TS, Tailwind, Router, TanStack Query (+2 small contexts; no Redux — ADR-014), react-i18next, Recharts. Routes/components/state/UX-states/accessibility fully mapped; QueryBoundary guarantees designed loading/empty/error/offline states everywhere.

## 8. Mobile
`docs/mobile/` (12 docs): **React Native + Expo managed, Android** (ADR-013; comparison vs RN CLI/Flutter documented). Bottom-tab navigation, 15-screen map, camera-first scan hero flow (compress→progress→retry), SecureStore auth, persisted Query cache for offline reads, shared i18n tree, Expo Go demo + EAS APK. Mobile MVP: auth, farm/crop, camera→health, weather/irrigation, market, dashboard, hi/en.

## 9. Backend
`docs/backend/architecture.md`: Express layering (controllers→services→engines/integrations/models; engines pure), env-validated boot, pino+redaction, node-cron jobs (weather 3h, market nightly, feed 30m, community 6h), graceful shutdown. Health-analysis conductor = single place the AI chain lives.

## 10. Database
`docs/database/` (5 docs): 14 collections (users, refreshTokens, farms, crops, cropRegistry, cropHealthLogs, irrigationLogs, weatherSnapshots, marketPrices, recommendations, communityAlerts, yieldEstimates[P3], auditLogs, seedMeta) with schemas, indexes, validation layers, lifecycle/TTL/deletion-cascade; master-list entities deliberately not created are itemized with reasons.

## 11. ML (custom model)
`docs/ml/` (11 docs). Scope: Rice, Tomato, Chilli, Maize, Potato specialized (+Cotton gated on Day-0 audit `[OD-1]`). Data: Paddy Doctor + PlantVillage subsets + Mendeley chilli (+SAR-CLD) ≈34–44 classes/~50k images; PlantDoc = field test set; pHash dedup + cluster-atomic splits. Model: EfficientNet-B0 transfer learning (ResNet18 baseline), unified head + crop-masking, AMP/bs32/224 on RTX 2050 (verified 4GB), 1.5–3h/run, temperature calibration, validation-derived τ + stricter τ_healthy. Ship gates incl. honesty gate (field-gap number published). Export ONNX + parity test → FastAPI CPU. Claude executes end-to-end; majors reported for approval; metrics only from committed artifacts.

## 12. AI (external)
`docs/ai/` (6 docs): chain ML→Gemini 2.5 Flash→OpenRouter→rule engine; schema-constrained structured output; registry-closed diseaseCodes; **KB-only farmer-facing advice**; prompt-injection quarantine; per-user quotas ≪ free tiers; kill-switches; disclosure that Gemini path shares the photo with the provider (consented).

## 13. Crop health
`docs/api/crop-health.md` + UF-5: photo+description → validated/re-encoded upload → tiered analysis ≤15s → structured intelligence: issue, confidence, engine-assessed severity, symptoms, what-to-inspect, next steps, prevention, expert-help threshold — KB-rendered, localized, source-labeled; uncertain = designed outcome; no-photo symptom-check path; history timeline.

## 14. Fertilizer
`docs/fertilizer/` (2 docs): curated two-tier KB (blanket vs soil-test, mirroring SAU structure) from TNAU CPG/Agritech, PAU PoP, ICAR-IISR — real sourced NPK values recorded (rice/maize/tomato/potato/chilli/onion/cotton verified; wheat/soybean primary-PDF verification flagged); stage guidance + deficiency symptoms; units preserved as published; permanent soil-test/KVC CTA + educational disclaimer; **zero generated numbers, no LLM in path** (ADR-015). P1.

## 15. Crop recommendation
`docs/crop-recommendation/` (2 docs): explainable weighted scoring (season 30 / soil 25 / water 30 / temp 15) with hard gates, over a source-cited knowledge table (FAO water needs, DES crop calendar, NHB/TNAU/KVK facts); Kaggle dataset assessed and rejected as engine (synthetic, license unverifiable, wrong features — documented for viva); output = ranked crops + cited reasons + cautions; no yield/profit claims. P1. Demo-state normals `[OD-7: pick 2–3 states — recommend MP, MH, UP]`.

## 16. Weather
`docs/weather/weather-architecture.md`: Open-Meteo primary (keyless; **daily FAO ET₀** — the engine's fuel) → OWM fallback → last-known-good; q3h refresh, 0.1° location dedup, validate-then-cache, physical-range gates; clients never touch providers.

## 17. Irrigation
`docs/irrigation/` (3 docs): FAO-56 simplified water balance — ETc=ET₀×Kc(stage from sowing date), soil-type TAW/RAW, depletion ledger with farmer irrigation logs, probability-weighted rain projection → verdict {IRRIGATE_TODAY / IN_N_DAYS / WAIT_RAIN / NO_NEED} + mm & L/acre + full why-trace; rice paddy special-case; labeled simplified mode without ET₀; R1–R14 implementation contract; FAO test vectors. Data/calculation/recommendation strictly separated.

## 18. Market
`docs/market/` (4 docs): data.gov.in Agmarknet (GODL) nightly → sanity-gated normalization (alias maps, quarantine, drop-rate abort) → append-only history → 30-day trends + ±5% momentum signal + hedged guidance keys + mandi comparison; CEDA-derived seed labeled Historical; **no price prediction**.

## 19. Yield
`docs/yield/yield-estimation.md` (research live-verified): P3 — transparent estimator (district 5-yr median × area × ≤3 cited factors: irrigation 0.75–1.15 [Zaveri&Lobell], event 0.70–1.0 [Dhaliwal]) with year-to-year range, vintage disclosure (OGD API ends 2015 → UPAg CSV lookup plan), tomato sparsity fallback tiers; explicitly NOT ML (FASAL comparison = viva integrity answer); schema + 501-until-built API contract reserved now.

## 20. Community
`docs/community/community-alerts.md`: opt-in consent, district-level aggregation of ML/Gemini-confirmed reports, ≥3 distinct farmers/7d → advisory (≥8 → HIGH), structurally PII-free schema, dupe control, single report never alerts. P2 MVI: job + feed items + list screen.

## 21. Voice
`docs/voice/voice-interface.md` (research-based): TTS readout (web speechSynthesis / expo-speech — Expo Go-safe) + STT (Web Speech hi-IN on web; mobile via dev-build recognizer OR Groq Whisper proxy `[OD-8: decide end of Day 1]`) + deterministic trilingual keyword matcher over 6 intents + tappable-intent fallback (serves low-literacy users universally). Transcripts not stored. P2.

## 22. Offline
`docs/offline/offline-strategy.md` + `docs/mobile/offline-strategy.md`: honest scope — cached reads (dashboard/weather/market/history/registry+symptom KB) with age labels, TTS offline, token-expiry-offline read-only mode; connectivity required for auth/analysis/fresh data (stated in-app); P3 write-queue designed (idempotency keys); on-device ML evaluated → deferred with TFLite path documented.

## 23. Dashboard
`docs/api/recommendations.md`: single aggregation endpoint (p95<800ms, zero external calls) → prioritized feed (CRITICAL🔴/HIGH🟠/MEDIUM🟡/INFO🟢, icon+color+text, ack, why-traces, 20-cap overload guard) + per-crop cards + system freshness. Priority table + conflict-resolution precedence deterministic (viva-ready).

## 24. Security
`docs/security/` (9 docs): STRIDE-lite threat model (8 surfaces), auth (rotation+reuse detection), authorization invariants AU-1..7 (ownership-404), API hardening stacks, upload pipeline (re-encode = polyglot kill, EXIF strip, bomb guards), AI/ML endpoint security (internal-only ml-service, key isolation, zero-trust outputs), secrets (Gitleaks, env-only), dependency policy (locked planned dep list), ST-01..70 test suites. **No backdoors/bypasses/hidden routes/master passwords/demo auth exceptions — absolute.**

## 25. Privacy
Minimal collection; per-account isolation; images private + EXIF-stripped; community aggregation anonymous by construction; voice transcripts unstored; no trackers; account deletion cascade designed (P2); Gemini photo-sharing disclosed & consented; auditLogs TTL 30d.

## 26. i18n
`docs/i18n/` (3 docs): full hi/en parity, shared/i18n canonical tree (ADR-018), keys+params in data layer, ESLint no-literal-string, parity script blocking, curated agri terminology with **mandatory human verification**, priority order under pressure, hi-IN formatting.

## 27. APIs
`docs/api/` (12 docs): ~38 endpoints across auth/users/farms/crops+registry/crop-health/weather/irrigation/market/dashboard-recommendations/intelligence (fertilizer, crop-rec, community, yield-501, voice-transcribe); conventions+canonical error codes; every endpoint specifies auth/validation/errors/rate-limit/cache/dependencies; no endpoint without an FR.

## 28. Testing
`docs/testing/` (8 docs): blocking gates = engine math (FAO vectors), API+authz matrix, security ST suites, ML parity+evaluation battery, i18n parity, resilience 12-scenario failure injection, 2 Playwright journeys (incl. all-APIs-down), mobile manual matrix ×2 clean runs; requirement→test matrix complete.

## 29. Deployment
`docs/deployment/` (6 docs): Vercel + Render(+keep-alive) + HF Spaces `[OD-2]` + Atlas + Cloudinary + Expo/EAS; env matrix + boot validation; deploy order + production checklist; cold-start mitigations; post-deploy smoke.

## 30. GitHub
`docs/development/git-workflow.md`: HackInMotion-HIM-1096 naming + required root artifacts; feature branches, human-reviewed PRs (mandatory for Claude code), conventional commits, day tags, genuine-contribution policy (no fake commits), Gitleaks hook.

## 31. Demo
12-min arc (rehearsed ×2 + backup video): hook → live signup + farm setup → dashboard verdicts → **soil-type change flips irrigation verdict live** → mobile camera on printed diseased leaf → local-model result w/ confidence + why → **live weather-API kill → ● Cached, app keeps working** → onion mandi trend → Hindi switch + TTS readout → impact + custom-model story. NOT demoed live (risk-managed): Gemini escalation (screenshot/recording), EAS install, yield, community (screenshots if built). Warm-up + seeded farmer + hotspot fallback in run-of-show.

## 32. Viva
`docs/development/viva-prep.md`: concept-level Q&A across all domains; two team walkthrough sessions scheduled; answers bounded by committed artifacts; limitations recital rehearsed (weakness → credibility).

## 33. Open decisions `[DECISION REQUIRED]`
OD-1 cotton (post-audit) · OD-2 ml host (Day-1 test) · OD-3 headcount 1v2 · OD-4 product name · OD-5 data.gov.in key · OD-6 Kaggle creds · OD-7 demo states (rec: MP/MH/UP) · OD-8 mobile STT path (Day-1).

## 34. Risks
`docs/development/RISK-REGISTER.md` (17 risks, owners, contingencies). Top: R1 scope-vs-headcount (managed via cut-order + Claude execution), R2 dataset surprises (audit gate), R4 data.gov.in delay (seed fallback), R5 field-accuracy gap (disclosed + gated), R10 venue internet (cache-first + video backup).

## 35. Assumptions & Limitations
Assumptions: venue internet available-but-untrusted; free tiers hold; in-window training on own GPU legitimate (logs kept); Kaggle/data.gov.in obtainable Day 0. Limitations (disclosed everywhere relevant): lab-image domain gap (measured); Bangladeshi chilli/cotton data (proxy); CC BY-NC chilli set (non-commercial); mandi staleness; leaf-only scope; modeled (not sensed) soil moisture; no offline writes; Gemini findings English-only on hi UI (P3).

## 36. 72-hour roadmap & 37. Master TODO
`docs/development/MASTER-TODO.md`: 9 dependency-mapped phases, ~120 concrete tasks with owner/priority/dependency/verification; hour-blocked roadmap (Day 0 accounts+audit; Day 1 foundation+overnight training; Day 2 health chain+model integration+mobile core; Day 3 hardening+deploy+demo); slip protocol at h48/h60 checkpoints.

## 38. Definition of Done
Feature-level DoD in CLAUDE.md (validation+ownership+errors+i18n+states+tests+freshness+docs+security cases). Project-level: production checklist + final quality gate (below) all green.

---

## MASTER ARCHITECTURE AUDIT (2026-08-12, post-integration of challenge capabilities)

| Domain | Status | Note |
|---|---|---|
| Product / Web / Backend / Database / API | **READY** | |
| Mobile | READY (plan) / **RISK** | R1 — strict MVP + cut-order |
| ML | READY (plan) / NEEDS DECISION | OD-1, OD-6 gate execution |
| AI / Crop health | READY | Gemini key = Day-0 task |
| Fertilizer | READY | wheat/soybean primary-source verification flagged pre-viva |
| Crop recommendation | READY / NEEDS DECISION | OD-7 demo states |
| Weather / Irrigation | READY | |
| Market | NEEDS DECISION | OD-5 key; seed fallback ready |
| Yield | READY (P3 spec) | honest 501 contract |
| Community | READY (P2 plan) | |
| Voice | READY (P2 plan) / NEEDS DECISION | OD-8 |
| Offline | READY (P2 reads; P3 queue spec) | |
| Security / Privacy | READY | tests scheduled D2–3 |
| i18n | READY / RISK | human-verification capacity if solo (OD-3) |
| Resilience | READY | |
| Testing / Deployment / GitHub / Documentation | READY | OD-2 non-blocking |
| Demo / Viva | READY | rehearsals scheduled |
| **72h feasibility** | **RISK (managed, disclosed)** | P0 web+backend+ML fits with Claude executing; mobile MVP fits if Day-1 slip ≤3h; challenge P1s fit; P2s are genuinely at risk — cut-order handles it honestly. Nothing deleted: everything below the line has a spec'd MVI or P3 contract. |

**Cross-checks performed:** contradictions — v1 spec's "non-goals" conflict with challenge mandate RESOLVED (this v2); duplicate logic — none (engines single-sourced, mobile shares API/i18n); overengineering — flagged & avoided (no Redux, no microservices beyond ml, no admin, no notifications service, collections pruned with reasons); underengineering — none found against requirements; security gaps — none open (threat model coverage vs surfaces verified); data gaps — wheat/soybean fertilizer verification, demo-state normals, UPAg yield CSVs (all tasked); missing requirements — traceability matrix shows zero unmapped lines.

## FINAL SIGN-OFF CHECKLIST
- [ ] All official requirements mapped (traceability) · [ ] Authentication · [ ] Farm profile · [ ] Weather · [ ] Irrigation · [ ] Weather risks · [ ] Crop health · [ ] Disease AI · [ ] Market · [ ] Unified dashboard · [ ] Database · [ ] Error handling
- [ ] Crop recommendation · [ ] Voice · [ ] Community alerts · [ ] Fertilizer · [ ] Yield · [ ] Offline
- [ ] Web · [ ] Mobile (architecture/technology/API contract/security/i18n/offline/MVP/testing/deployment) · [ ] Hindi · [ ] English
- [ ] Custom ML · [ ] Gemini fallback · [ ] Security · [ ] Privacy · [ ] Resilience
- [ ] Testing · [ ] Deployment · [ ] GitHub · [ ] Documentation · [ ] Demo · [ ] Viva · [ ] 72-hour feasibility accepted (with cut-order)
- [ ] Open decisions OD-1..OD-8 acknowledged

**IMPLEMENTATION GATE: work begins only on the explicit instruction `START IMPLEMENTATION`.**
