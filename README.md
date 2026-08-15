
> **HackInMotion 2026 · Team HIM-1096**

**Khetri** is an evidence-aware smart farming platform designed to help farmers make better decisions about **what to grow, when to irrigate, crop health, weather, market prices, and farm management**.

### ▶ Live Demo

[Khetri — Live Demo](https://hack-in-motion-ricr-him-1096.vercel.app/?utm_source=chatgpt.com)

**Web + Android · Hindi + English · AI/ML · Explainable decisions · Offline resilience**

---

## 🚀 What Khetri Does

Khetri turns scattered agricultural information into a single farm-aware decision layer.

A farmer creates a farm profile containing:

* Location
* Land size
* Soil type
* Current crops
* Growing stage
* Water conditions

The platform then uses that context across its decision engines to answer the practical question:

> **“What should I act on today?”**

### Core capabilities

| Capability                  | What Khetri provides                                                 |
| --------------------------- | -------------------------------------------------------------------- |
| 🌱 Crop Recommendation      | Farm-specific crop ranking using season, soil, water and temperature |
| 💧 Irrigation               | FAO-56 based water-balance and irrigation decisions                  |
| 🦠 Crop Health              | ML vision + AI-assisted analysis + symptom-based resilience          |
| 🌦 Weather                  | Current, forecast and freshness-aware weather information            |
| 💰 Mandi Intelligence       | Government-sourced mandi prices and market signals                   |
| 🧪 Crop/Fertilizer Guidance | Source-backed agricultural recommendations                           |
| 🌾 Farm Management          | Farm, crop and field-level decision context                          |
| 🌐 Bilingual UX             | Complete English + Hindi interface                                   |
| 📱 Android                  | Native Expo/React Native experience                                  |
| 📡 Offline Resilience       | Cached reads and resilient field workflows                           |
| 🔊 Voice                    | Text-to-speech decision readout                                      |
| 🚨 Community Alerts         | Privacy-conscious district-level agricultural alerts                 |

---

# ⭐ Why Khetri Is Different

## 1. Evidence-aware recommendations

Khetri does not silently invent missing information.

The crop recommendation engine evaluates:

* Season — **30%**
* Soil — **25%**
* Water — **30%**
* Temperature — **15%**

When reliable evidence for a factor is unavailable, that factor is excluded and the remaining weights are renormalized.

Every recommendation exposes an **`evidenceRatio`**, allowing the user to understand how much of the intended decision model is actually backed by available data.

Implementation:

`backend/src/engines/cropRec/cropRecommendation.js`

---

## 2. Recommendations are farm-specific

Khetri does not provide the same crop list to every farmer.

The recommendation pipeline considers:

```text
Farm Context
     ↓
Season Resolver
     ↓
Land Availability
     ↓
Market Eligibility
     ↓
Evidence-aware Scoring
     ↓
Ranked Recommendation
```

This means the recommendation changes when the farmer's actual farm conditions change.

---

## 3. Market eligibility is part of the recommendation

A crop recommendation is only useful if the farmer can realistically act on it.

Khetri therefore considers market availability as an eligibility condition rather than displaying empty or unsupported price information.

Implementation:

`backend/src/services/recommendation/marketEligibility.js`

---

# 💧 4. FAO-56 Irrigation Engine

Khetri's irrigation engine is based on agricultural water-balance calculations rather than a simple weather rule.

The engine incorporates:

* Reference evapotranspiration (ET₀)
* Crop coefficient
* Growth stage
* Soil water availability
* Root depth
* Logged irrigation
* Forecast conditions

Conceptually:

```text
Weather + Crop + Growth Stage + Soil + Water Ledger
                         ↓
                  FAO-56 Engine
                         ↓
                Irrigation Decision
                         ↓
                Explainable Working
```

The UI exposes the working behind the recommendation instead of presenting only a final number.

Implementation:

`backend/src/engines/irrigation/computeIrrigation.js`

---

# 🧠 5. Resilient Crop-Health Intelligence

Crop health is designed as a **multi-tier decision system** rather than relying on a single external provider.

```text
EfficientNet-B0 ONNX
        ↓
   Gemini Vision
        ↓
 OpenRouter Vision
        ↓
 Local Symptom Rules
```

Each tier can independently decline based on conditions such as confidence, unsupported crops, provider availability, timeout or quota.

The response records the escalation path so the application knows which source produced the result.

The final local tier uses a sourced agricultural knowledge base and can return an explicit `UNKNOWN` state when confidence is insufficient.

### Why this architecture matters

A farming application should not depend on one model, one API provider, or one network connection.

Khetri therefore treats **availability, evidence and confidence as first-class states**.

Implementation:

`backend/src/services/cropHealthService.js`

---

# 🤖 6. Custom ML Model

Khetri includes a custom **EfficientNet-B0** crop-disease model trained and evaluated as part of the project.

### Dataset

* **39,929 unique images**
* **35 classes**
* Source-stratified dataset construction
* Deduplication
* Held-out field-domain evaluation
* Temperature-calibrated confidence
* ONNX deployment

### Model metrics

| Metric                              |          Result |
| ----------------------------------- | --------------: |
| Best validation macro-F1            |      **0.9556** |
| Temperature                         |      **0.5863** |
| Calibrated ECE                      |      **0.0042** |
| ONNX maximum probability difference | **1.55 × 10⁻⁵** |
| ONNX argmax mismatches              |     **0 / 100** |
| In-domain test accuracy             |      **0.9632** |

The deployed model is treated as an **evidence source**, not as an unrestricted text-generation system.

---

# 📚 7. AI Does Not Generate Agricultural Dosage

A major design principle of Khetri is the separation between:

**AI prediction → structured agricultural code → sourced knowledge → farmer-facing advice**

The ML/AI layer does not independently invent fertilizer or treatment dosage.

Farmer-facing agricultural guidance is generated from the application's curated knowledge base and international/national agricultural references.

This creates a clear boundary between:

* Prediction
* Evidence
* Recommendation
* Presentation

---

# 🌦 8. Freshness-Aware Data

Every data-bearing surface communicates its freshness.

Khetri distinguishes between:

* **Live**
* **Cached**
* **Historical**
* **Pending**
* **Local AI**
* **AI-assisted**

A cached value is never silently presented as live information.

Implementation:

`web/frontend/src/components/ui/FreshnessDot.tsx`

---

# 🔍 9. Explainable Decision Traces

Khetri's engines return the reasoning data behind their decisions.

Instead of:

> “Irrigate today.”

the system can expose the factors contributing to that result.

This makes the platform useful not only as a recommendation engine, but also as a **decision-support and learning tool**.

Implementation:

`web/frontend/src/components/domain/IrrigationWorking.tsx`

---

# 🔐 10. Security by Design

Security is integrated into the backend architecture.

Key protections include:

* bcrypt password hashing
* Rotating refresh tokens
* Refresh-token reuse detection
* Resource ownership enforcement
* Rate limiting
* Request validation
* Upload validation
* Magic-byte inspection
* Image re-encoding
* EXIF/GPS stripping
* Secret scanning
* Hardened production configuration

Ownership is enforced directly in database queries so users cannot access another farmer's resources.

The system does not rely on a special frontend-only demo bypass.

---

# 🌐 11. Hindi + English

Khetri is designed for bilingual agricultural use.

The application contains:

* **1,549 i18n keys**
* Hindi/English parity checks
* Shared translations
* Shared API types
* No hardcoded user-facing strings

The same business logic powers both language experiences.

---

# 📱 12. Web + Android

Khetri provides the same decision platform through:

### Web

* React
* Vite
* TypeScript
* Responsive farmer-first interface

### Android

* React Native
* Expo SDK 54
* TypeScript
* Camera-first workflows
* Offline-aware reads
* Hindi/English
* Text-to-speech

Both clients use the same backend REST contract.

Business logic remains server-side rather than being duplicated across platforms.

---

# 📡 13. Offline Resilience

Agricultural applications cannot assume perfect connectivity.

Khetri therefore uses cache-first behaviour for supported reads and explicitly labels cached information.

The irrigation workflow also supports a local write queue.

```text
Farmer action
     ↓
Local Outbox
     ↓
clientRequestId
     ↓
Reconnect
     ↓
Server Deduplication
     ↓
Persistent Record
```

This prevents a repeated network submission from becoming duplicate irrigation records.

Implementation:

`shared/client/irrigationOutbox.ts`

---

# 🚨 14. Privacy-Conscious Community Intelligence

Community alerts operate on district-level aggregation rather than exposing individual farmer information.

The design uses:

* Consent-gated participation
* Aggregated district signals
* PII-conscious storage
* Minimum farmer thresholds
* Scheduled aggregation

The community system is intentionally separated from individual farmer records.

---

# 🏗 Architecture

![Architecture](architecture-diagram.png)

```text
┌──────────────────────┐
│     React Web        │
│       Vercel         │
└──────────┬───────────┘
           │
┌──────────▼───────────┐
│ React Native / Expo  │
│       Android        │
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│    Express API       │
│       Render         │
│                      │
│  9 Decision Engines  │
└──────────┬───────────┘
           │
     ┌─────┴─────┐
     ▼           ▼
 MongoDB      FastAPI
  Atlas       + ONNX
              ML Service
```

### Backend architecture

The backend is organized around pure decision engines with clear separation between:

* API layer
* Services
* Decision engines
* Knowledge base
* Persistence
* External integrations

The major engines include:

* Crop Recommendation
* Irrigation
* Crop Health
* Market
* Weather
* Fertilizer
* Community
* Severity
* Supporting decision services

---

# 📊 Verification

Khetri has an automated verification suite covering backend, web, Android and ML services.

| Suite                |            Result |
| -------------------- | ----------------: |
| Backend API          | **1,735 / 1,735** |
| React Web            |     **146 / 146** |
| Expo Android         |     **110 / 110** |
| ML Service           |     **144 / 144** |
| ESLint               |      **0 errors** |
| TypeScript           |         **Clean** |
| Prettier             |         **Clean** |
| i18n parity          |    **1,549 keys** |
| Hardcoded UI strings |             **0** |
| Production build     |         **Green** |

Total automated tests:

**2,135**

---

# 🛡 Security Verification

The security workflow includes regression coverage for discovered security issues.

Security verification includes:

* Authentication
* Authorization
* Ownership boundaries
* Upload validation
* Token lifecycle
* Rate limiting
* Headers
* CORS
* Secret scanning

ZAP baseline:

**66 PASS · 0 FAIL**

---

# 🌾 Product Philosophy

Khetri is built around one principle:

> **A farming decision should be explainable, evidence-aware and resilient to missing data.**

That principle appears throughout the architecture:

```text
Missing data
     ↓
Don't invent it
     ↓
Reduce available evidence
     ↓
Expose the evidence level
     ↓
Produce the safest supported decision
```

This is why Khetri is more than a dashboard.

It is a **decision-support system designed around evidence and resilience**.

---

# 🧪 Technology Stack

| Layer                | Technology                         |
| -------------------- | ---------------------------------- |
| Web                  | React + Vite + TypeScript          |
| Android              | React Native + Expo                |
| Backend              | Node.js + Express                  |
| Database             | MongoDB Atlas                      |
| ML Service           | FastAPI + ONNX                     |
| ML Model             | EfficientNet-B0                    |
| Hosting              | Vercel + Render + MongoDB Atlas    |
| Weather              | Open-Meteo + OpenWeatherMap        |
| Market               | Government Agmarknet / data.gov.in |
| AI Vision            | Gemini + OpenRouter                |
| Image Storage        | Cloudinary                         |
| Internationalization | Shared Hindi + English resources   |

---

# 🌍 External Data Sources

Khetri uses external services for specific data domains:

| Source                  | Purpose               |
| ----------------------- | --------------------- |
| Open-Meteo              | Weather + ET₀         |
| OpenWeatherMap          | Weather fallback      |
| data.gov.in / Agmarknet | Mandi prices          |
| Gemini                  | Vision second opinion |
| OpenRouter              | Vision fallback       |
| Cloudinary              | Image storage         |

External data is validated before entering the application's cache/data layer.

---

# ☁️ Deployment

| Component   | Platform        | Status        |
| ----------- | --------------- | ------------- |
| Web         | Vercel          | **Live**      |
| REST API    | Render          | **Live**      |
| Database    | MongoDB Atlas   | **Live**      |
| Crop Health | Four-tier chain | **Live**      |
| Android     | Expo            | **Available** |

Production configuration uses the same security model as the application's production environment.

Secrets are managed through deployment configuration rather than committed to the repository.

---

# 🎯 Demo

### Demo account

```text
Email:    demo.farmer@khetri-demo.in
Password: Khetri@Demo2026

### Recommended evaluation flow

1. Open the live application.
2. Sign in with the demo account.
3. Open the farm dashboard.
4. Inspect the crop recommendations.
5. Change farm/soil context.
6. Compare the resulting decision.
7. Open irrigation working.
8. Inspect market prices.
9. Try crop-health analysis.
10. Switch between Hindi and English.

The key experience to evaluate is not a static dashboard.

It is how **changing farm evidence changes the resulting decision**.

---

# 📁 Repository Structure

```text
web/frontend/       Web application
mobile/             Android application
backend/            Express API + decision engines
ml-service/         FastAPI + ONNX inference
shared/             Shared types, i18n and client utilities
docs/               Architecture, security and product documentation
datasets/           Dataset documentation / local datasets
scripts/            Verification and development tooling
```

---

# 🛠 Local Development

```bash
npm install

npm --prefix backend install
npm --prefix backend run dev

npm --prefix web/frontend install
npm --prefix web/frontend run dev

npm --prefix mobile install
npm --prefix mobile start
```

For Android-specific setup and networking, see:

`mobile/README.md`

---

# 📖 Documentation

Key references:

* `api-documentation.md`
* `docs/architecture/overview.md`
* `docs/security/`
* `docs/ml/`
* `docs/testing/`
* `docs/deployment/`
* `docs/product/`
* `docs/mobile/`

---

# 🔭 Future Scope

Planned extensions include:

* On-device ML
* Additional crop coverage
* More offline workflows
* Voice interaction improvements
* Community intelligence expansion
* iOS support

---

# 👥 Team

**Team HIM-1096 · HackInMotion 2026**

See:

`docs/development/team-plan.md`

for project ownership and contribution structure.

---

## 🌾 Khetri

**From agricultural data to actionable decisions.**

> **Know your field. Understand the evidence. Make the next decision better.**
