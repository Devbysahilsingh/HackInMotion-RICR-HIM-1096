# 🌾 KrishiSaarthi — Smart Farm Decision Support System

> *Working name (final name pending — OD-4). HackInMotion 2026 · Team HIM-1096.*
> **STATUS: PLANNING COMPLETE — implementation not yet started.** Sections marked ⏳ fill in during/after implementation; no placeholder claims are made below.

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
Datasets: Paddy Doctor (16k real Indian field images), PlantVillage subsets, Mendeley field chilli sets, SAR-CLD cotton (audit-gated); PlantDoc held out as a field-domain test set. ~34–44 classes, unified EfficientNet-B0 with crop-aware masking, temperature-calibrated confidence, validation-derived thresholds. **Metrics: ⏳ published from evaluation artifacts after training — including the field-domain (lab→field gap) number, whatever it is.** Known limitations are documented in `docs/ml/` and stated in our pitch.

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

## Setup / Environment / Local development ⏳
Filled at implementation: per-app install & run commands, .env.example walkthrough (variable names already documented in docs/deployment/environment.md), seed scripts, test commands.

## API documentation
Complete endpoint specs: `docs/api/` (summarized into `api-documentation.md` ⏳ at submission).

## Database
Schema, indexes, lifecycle: `docs/database/`.

## Deployment ⏳ (URLs added when live)
Plan: docs/deployment/. Web: Vercel · API: Render · ML: HF Spaces · DB: Atlas · Android: Expo Go + APK.

## Screenshots ⏳
Farm dashboard design references are tracked in `Design-refrences/` for implementation alignment.

## Team & contributions
See `docs/development/team-plan.md` — real ownership per member; commit history reflects genuine work (project policy: no manufactured contributions).

## Testing
Strategy + requirement-mapped matrix: `docs/testing/`. Blocking gates: engine math (FAO-56 vectors), authorization matrix, upload security, resilience failure-injection (12 scenarios), i18n parity, E2E farmer journey incl. all-APIs-down.

## Future scope
`docs/product/future-scope.md` — yield estimator (spec complete), on-device ML (TFLite path), more crops (SoyNet identified), offline write-sync, voice v2, community v2, iOS.

## HackInMotion context
Requirement coverage — every must-have and all six challenge capabilities — is traced line-by-line in `docs/requirements-traceability.md`.
