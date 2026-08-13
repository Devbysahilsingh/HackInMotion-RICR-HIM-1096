# 🌾 KrishiSaarthi — Smart Farm Decision Support System

> *Working name (final name pending — OD-4). HackInMotion 2026 · Team HIM-1096.*
> **STATUS: IMPLEMENTATION IN PROGRESS.** Backend, ML training, web client and the Android app are built and tested; **nothing is deployed and no phone has run the app.** Sections marked ⏳ are still owed. No placeholder claims are made below.
>
> **Built and verified (2026-08-14):** backend API (**1,279 / 1,279 tests**) · React web client (**109 / 109**) · Expo Android client (**90 / 90**) · ml-service FastAPI + ONNX (**140 / 141 pytest** — one known failure, below) · trained EfficientNet-B0 with calibrated thresholds. **Not done:** deployment (Render / Vercel / HF Spaces), the APK build, and every device- and demo-day verification that depends on them.
>
> The one failing test is `test_generator_reports_the_committed_manifest_as_current`: `ml-service/model/model-manifest.json` records a `datasetManifest.sha256` that does not match the committed `datasets/manifest.json`. Both files are unchanged since the Phase-4 commit `29543d1`, so the drift was committed there — it is not a regression, and it is deliberately left for the ML owner rather than silently regenerated, because regenerating a model manifest rewrites recorded metrics.

*"A farmer's biggest risk isn't hard work — it's making the wrong decision at the wrong time."*

## The problem
Indian small and mid-sized farmers make five recurring, high-stakes decisions — what to plant, when to irrigate, how to respond to weather, whether a crop is diseased, and when to sell — with fragmented information and no tool that turns data into personalized, timely, explainable guidance in their language.

## The solution
A web + Android platform where a farmer sets up their farm (location, size, soil, crops) and gets one prioritized answer to *"what do I act on today?"* — powered by:
- **FAO-56 water-balance irrigation engine** — real agronomy (ET₀ × crop coefficient × soil water holding), not "it might rain."
- **Custom-trained crop-disease vision model** (EfficientNet-B0, trained on our own GPU; rice model trained on real Indian field photos) with calibrated confidence — and an honest three-tier fallback: local model → Gemini Vision → guided symptom assessment.
- **Mandi price intelligence** from government Agmarknet data — trends and signals, never fake predictions.
- **Crop recommendation + fertilizer guidance** from source-cited ICAR/TNAU/PAU knowledge — every number carries its source; no AI-invented dosages, ever.
- **Full Hindi + English**, voice readout, community outbreak alerts (privacy-first), offline-cached reads.
- **Cache-first resilience:** the app keeps working — labeled honestly — when any external API dies.

## Why it matters
Personalization is structural (change your soil type and watch the irrigation verdict change); every recommendation shows its "why" with real numbers; every data card shows freshness (● Live / ● Cached / ● Historical / ● Local AI / ● AI-assisted). Trust through transparency, built for low digital literacy (≤2 taps to a verdict, icon+color+text, big targets, voice).

## Architecture
See `docs/architecture/overview.md` (+ `architecture-diagram.png` ⏳ rendered at implementation).
React (Vercel) + React Native/Expo (Android) → Express API (Render; JWT + refresh rotation, ownership enforcement, rate limits) → MongoDB Atlas → FastAPI + ONNX ml-service (internal). Jobs ingest weather (Open-Meteo→OpenWeatherMap) and mandi prices (data.gov.in→cache→seed) with validate-then-cache; engines are pure, tested functions.

## Custom ML (honest summary)
Datasets: PlantVillage subsets, Mendeley field chilli sets, SAR-CLD cotton (audit-gated), and a CC BY 4.0 Odisha rice set — **Paddy Doctor was rejected** on licence grounds (paid-subscription access, no published image licence) and replaced. PlantDoc is held out entirely as a field-domain test set. After deduplication and source-stratified splitting: **39,960 unique images, 36 classes**. Unified EfficientNet-B0 with crop-aware masking and temperature-calibrated confidence.

Metrics, from committed artifacts only (`docs/ml/evaluation-results/`, `ml-service/training/`):

| | |
|---|---|
| Best validation macro-F1 | **0.9556** |
| Calibration | T = **0.5863**, ECE 0.0837 → **0.0042** |
| Shipped thresholds | τ = 0.70 · τ_healthy = 0.80 (recorded policy override, re-validated against all 6 documented criteria) |
| Ship gates | **5 / 5 pass** |
| ONNX parity | max \|Δprob\| **1.55e-05** over 100 golden images, 0 argmax mismatches |
| In-domain test accuracy | **0.9632** |
| **Field-domain (PlantDoc) accuracy** | **0.1257** |

That last row is the number most projects omit. A model at 0.96 in-domain scores **0.13** on real field photographs, so the Gemini Vision tier is load-bearing for actual farmer photos rather than a decorative fallback — and rice's perfect healthy/brown-spot separation is a background-shortcut signature, not evidence of skill. Known limitations are documented in `docs/ml/` and stated in our pitch.

## Third-party services (all free, no credit card — research & justification in docs)
| Service | Role | Why chosen | Doc |
|---|---|---|---|
| Open-Meteo | weather + FAO ET₀ | free, keyless, only free source with ET₀ (powers the irrigation engine) | docs/weather/ · ADR-007 |
| OpenWeatherMap | weather fallback | ubiquitous free tier | 〃 |
| data.gov.in (Agmarknet) | mandi prices | official govt source, GODL license | docs/market/ |
| Gemini 2.5 Flash | vision second-opinion / general-crop analysis | best free multimodal tier (1,500 req/day, no card) | docs/ai/ |
| OpenRouter free models | vision tertiary fallback | free chain depth | 〃 |
| Cloudinary | image storage | free tier, re-encoded uploads only | docs/security/image-upload-security.md |
| MongoDB Atlas M0 / Render / Vercel / HF Spaces / Expo | hosting | zero-cost, documented trade-offs | docs/deployment/ · ADR-011 |

## Security & privacy (first-class)
Threat-modeled (docs/security/, 9 documents): bcrypt-12 + rotating refresh tokens with reuse detection, per-resource ownership enforcement, validated + re-encoded image uploads (EXIF stripped), rate limiting, secrets scanning, no admin surface, **no backdoors or demo bypasses — the demo runs production security**. Community alerts are opt-in and district-aggregated with structurally PII-free storage.

## Repository structure
```
web/frontend · mobile · backend · ml-service · shared (i18n, constants, schemas)
docs/ (23 domains — start at docs/FINAL-PLAN-SPEC.md) · datasets/ (gitignored; see datasets/README.md)
scripts/ · assets/ · CLAUDE.md · .env.example
```

## Android app
`mobile/` — Expo SDK 54 · React Native 0.81 · React 19 · TypeScript. Same `/api/v1` contract as the web, no duplicated business logic: engines stay on the server, translations come from `shared/i18n`, wire types from `shared/types/api.ts`. 23 screens across four tabs — camera-first, offline-cached reads, Hindi/English, text-to-speech. The SDK is **pinned to 54 to match the Expo Go build on the demo handset** — do not upgrade it (`docs/mobile/technology-decision.md`).

**`mobile/README.md` is the runbook** — setup, the API-base-URL table (a phone's `localhost` is not your laptop), LAN/tunnel workflows, firewall rules, the EAS build recipe and the security notes. It is not duplicated here.

Two things worth knowing before you open it: voice **input** does not ship (`RECORD_AUDIO` is blocked — the shipped voice feature is text-to-speech only; the reasoning is in `docs/mobile/technology-decision.md`), and **no APK has been built and no phone has run the app** — the scripted device matrix in `docs/mobile/testing.md` has zero executed rows.

Design and decision records: `docs/mobile/` (architecture, navigation, screen map, authentication, offline strategy, camera & upload, i18n, security, testing, deployment).

## Setup / Environment / Local development ⏳
Per-app install & run commands, .env.example walkthrough (variable names documented in docs/deployment/environment.md), seed scripts and test commands. Today, the short version:

```bash
npm install                        # repo tooling + the pre-commit secret hook
npm --prefix backend install && npm --prefix backend run dev     # needs backend/.env
npm --prefix web/frontend install && npm --prefix web/frontend run dev
npm --prefix mobile install && npm --prefix mobile start         # see mobile/README.md first
npm run verify                     # lint · format · i18n parity · UI strings · all three test suites
```

## API documentation
Complete endpoint specs: `docs/api/` (summarized into `api-documentation.md` ⏳ at submission).

## Database
Schema, indexes, lifecycle: `docs/database/`.

## Deployment ⏳ (URLs added when live)
Plan: docs/deployment/. Web: Vercel · API: Render · ML: HF Spaces · DB: Atlas · Android: Expo Go + APK.

## Screenshots ⏳
Farm dashboard design references are tracked in `Design-refrences/` for implementation alignment and UI review.

## Team & contributions
See `docs/development/team-plan.md` — real ownership per member; commit history reflects genuine work (project policy: no manufactured contributions).

## Testing
Strategy + requirement-mapped matrix: `docs/testing/`. Blocking gates: engine math (FAO-56 vectors), authorization matrix, upload security, resilience failure-injection (12 scenarios), i18n parity, E2E farmer journey incl. all-APIs-down.

## Future scope
`docs/product/future-scope.md` — yield estimator (spec complete), on-device ML (TFLite path), more crops (SoyNet identified), offline write-sync, voice v2, community v2, iOS.

## HackInMotion context
Requirement coverage — every must-have and all six challenge capabilities — is traced line-by-line in `docs/requirements-traceability.md`.
