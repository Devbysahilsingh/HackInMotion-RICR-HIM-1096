# Khetri — pitch deck content (14 slides)

Source content for `presentation.pptx`. Every figure below is taken from a real
run or a committed artifact — nothing here is aspirational, and the numbers are
reproducible with the commands in `README.md`. If a number changes, re-run and
update it here rather than in the deck, so the deck has one upstream.

**Design language:** cream `#f7f4ea` ground, deep forest `#1b5638`, white cards,
thin `#e6e0ce` rules, one accent per slide. Big type, few words. Slides 4 and 9
are the ones to rehearse hardest.

---

## Slide 1 — Title

**Khetri**
Smart Farm Decision Support System

> *"A farmer's biggest risk isn't hard work — it's making the wrong decision at
> the wrong time."*

HackInMotion 2026 · Team HIM-1096

*Speaker note:* Read the quote. Then pause. That sentence is the whole product.

---

## Slide 2 — The problem

A farmer makes five high-stakes decisions every season:

| | |
|---|---|
| **What do I plant?** | wrong crop → a lost season |
| **When do I irrigate?** | missed window → yield loss |
| **Is this weather a threat?** | no warning → ruined harvest |
| **Is my crop sick?** | late detection → it spreads |
| **When do I sell?** | wrong day → someone else's margin |

The information that would answer these **already exists** — forecasts, soil
data, mandi rates, agronomic guidance. It is scattered across a dozen sources,
in the wrong language, at the wrong reading level, at the wrong moment.

**The gap is not data. It is a decision, delivered in time.**

---

## Slide 3 — What we built

One question, answered on open: **"What do I act on today?"**

A farmer sets up their field once — location, size, soil, water source, crops —
and every recommendation after that is specific to *that field*.

- **Web** (React + Vite) and **Android** (React Native + Expo) on one REST contract
- **English and Hindi** throughout, with text-to-speech readout
- **Offline-cached reads** — the app still answers on a dead connection, and says so

*Speaker note:* Change the soil type and the irrigation verdict changes. That is
the difference between personalization and a settings screen.

---

## Slide 4 — The decision engine  ⭐ *core technical slide*

Four **pure functions** — deterministic, unit-tested, no I/O, every one returns
the numbers behind its verdict.

**1 · Irrigation — real agronomy, not "it might rain"**
FAO-56 soil-water balance: reference evapotranspiration × crop coefficient for
the derived growth stage, against the soil's available water and root depth,
replayed over logged waterings and projected across the forecast.
→ *"Wait — 31 mm expected over two days clears a 22 mm deficit."*

**2 · Weather risk** — per crop, per day, against published crop sensitivities.
The response states whether the threshold was **crop-specific or a generic
default** — those are different claims and we never merge them.

**3 · Market signal** — describes what prices *have already done*. Never a
forecast. There is no endpoint that could make one.

**4 · Crop recommendation** — season · soil · water · temperature, weighted
0.30 / 0.25 / 0.30 / 0.15. **A factor with no data is dropped, not guessed at**,
and the response reports how much of the weight was actually backed by evidence.

---

## Slide 5 — Crop health: a chain, not a model

```
photo → sanitize (magic bytes · bomb guard · re-encode → EXIF stripped)
      → cache (per user + crop + image hash — never global)
      → store
      → Tier 1  local ONNX model
      → Tier 2  Gemini Vision
      → Tier 3  OpenRouter
      → Tier 4  guided symptom rules  ← local, always answers
      → confidence gate + severity engine + sourced guidance
```

Every tier that declines is recorded with its reason and shown to the farmer.

**The model never writes advice.** It returns a disease code and a confidence.
The farmer-facing text comes from a sourced TNAU/ICAR knowledge base by i18n key.
An uncertain result **stays uncertain** — it is never forced into a prediction.

---

## Slide 6 — Our ML, honestly

Trained on our own GPU. EfficientNet-B0, **39,960 deduplicated images, 36 classes**,
source-stratified splits, temperature-calibrated.

| | |
|---|---|
| Validation macro-F1 | **0.9556** |
| Calibration (ECE) | 0.0837 → **0.0042** (T = 0.5863) |
| In-domain test accuracy | **0.9632** |
| **Field-domain (PlantDoc) accuracy** | **0.1257** |
| ONNX parity | max │Δp│ **1.55e-05**, 0 argmax mismatches |
| Ship gates | **5 / 5 pass** |

**That fourth row is the slide.** A model at 0.96 in the lab scores **0.13** on
real field photographs. Most projects never measure it, so they never report it.

We measured it — which is precisely *why* the Gemini tier is load-bearing rather
than decorative, and why a farmer sees "AI-assisted" instead of a confident
wrong answer.

**And then we watched it happen.** On 2026-08-14 we pushed one real field
photograph of tomato early blight through the live chain. Our model answered
**target spot at 0.813** — confident, and wrong; the correct answer sat second at
0.087. Force the model offline and **Gemini gets it right**; force Gemini offline
too and **OpenRouter gets it right**; force all three offline and the app says
**UNKNOWN** rather than guessing. That is row four of this table, reproduced on
demand, and it is the entire argument for the architecture.

*Speaker note:* If you take one thing from this deck, take this slide. If a judge
asks "did your model actually work?" — the honest answer is "it ran in 78 ms and
it was wrong, and that is why there are four tiers." Say it exactly like that.

---

## Slide 7 — Market intelligence

Real mandi prices from **data.gov.in (Agmarknet)** — official, GODL-licensed.

- **Farm-first, not crop-first.** A mandi is not a crop: one carries nine
  commodities. We show the whole basket for the mandis near *your* field.
- **Your crops highlighted, every other price still visible** — because a farmer
  growing onion still sells into a market trading wheat and soybean.
- **A quiet mandi is shown, not hidden** — dashed, labelled *"published nothing
  in the last seven days"*, so its silence is information rather than an absence.
- **No invented distances.** Agmarknet publishes no mandi coordinates, so we say
  "in your district", never a fabricated "12 km".

**In *What to plant*, market availability is a hard eligibility gate:** a crop no
reachable mandi has priced is excluded with a stated reason, never ranked with an
empty price column.

---

## Slide 8 — Trust is the feature

Every data-bearing surface carries an honesty label — this is a contract, not a
UI flourish:

**● Live** · **● Cached** · **● Historical** · **● Pending**
**● Local AI** · **● AI-assisted** · **● Guided assessment**

- Every recommendation shows its **working** — the actual numbers, on the page,
  not behind a "why?" nobody opens.
- Every agronomic figure carries its **citation** (ICAR · TNAU · PAU · FAO-56).
- **No AI-authored dosages, ever.** Not one pesticide name or quantity comes
  from a model.
- Missing data is **named**, not filled with a plausible number.

*Speaker note:* A farmer who is misled once never opens the app again. Trust is
not a nice-to-have here; it is the retention strategy.

---

## Slide 9 — Resilience  ⭐ *demo this live*

Every external provider is assumed to fail.

| Provider | Fallback |
|---|---|
| Open-Meteo | → OpenWeatherMap |
| data.gov.in | → cache → seeded history |
| Local model | → Gemini → OpenRouter → local rules |

- **Request paths never call a provider.** Scheduled jobs ingest with
  validate-then-cache; a failed fetch **never overwrites last-known-good**.
- Every degraded state is **labelled**, never disguised as fresh.
- Failure-injection flags (`FORCE_FAIL_*`) let us prove it on stage.

**Live demo:** turn every external API off. The app keeps answering — and tells
the farmer exactly what it is working from.

---

## Slide 10 — Security is a feature

A full adversarial audit, run against a **live instance** with real HTTP.

| | |
|---|---|
| Vulnerabilities found and fixed | **15** — each with a regression test that fails against the pre-fix code |
| OWASP ZAP baseline | **0 FAIL · 66 PASS** |
| Authenticated probe suite | **86 / 86** |
| Secret scanning | Gitleaks, full history — **clean** |

- bcrypt-12 · rotating refresh tokens with **reuse detection**
- Ownership enforced **in the query**, never after: another farmer's field is a
  **404, not a 403** — we never confirm a resource we will not serve
- Uploads: magic-byte sniff → bomb guard → full re-encode (**EXIF and GPS stripped**)
- **No admin surface. No demo bypass. No backdoor.** The demo runs production security.

---

## Slide 11 — Built for the farmer, not the judge

- **Hindi and English**: **1,489 keys, 0 missing**, parity gated in CI. Zero
  hardcoded strings — enforced by a repo script.
- **≤ 2 taps to a verdict.** Icon + colour + text, never colour alone.
- **Voice readout** on seven surfaces.
- **Community alerts** — district-aggregated, consent-gated, structurally
  PII-free. **No write API**: only a scheduled job that counts ≥3 distinct
  farmers can raise an alert, so it cannot be gamed from a browser.
- Designed for a **dusty screen in bright sunlight**, on a phone, by someone who
  may not read fluently.

---

## Slide 12 — Architecture & stack

*(insert `architecture-diagram.png`)*

**React + Vite** (web) · **React Native + Expo SDK 54** (Android)
→ **Node 20 / Express** — JWT, ownership middleware, Zod validation, rate limits
→ **MongoDB Atlas** — 14 collections, every owned document carries `userId`
→ **FastAPI + ONNX** ml-service — internal only, `X-Service-Key`

**38 REST routes**, documented in `api-documentation.md` and transcribed from an
ownership table that a test asserts against the live router — so the docs cannot
drift from the code without the build failing.

**Every service is free-tier. Zero cost. No credit card.**

---

## Slide 13 — What is done, and what is not

**Feature-complete on both clients.** All 9 must-haves + all 6 challenge
capabilities, verified by real runs:

| Suite | Result |
|---|---|
| Backend API | **1,566 / 1,566** |
| Web client | **131 / 131** |
| Android client | **110 / 110** |
| ml-service | **143** (+1 known manifest-hash drift, documented) |

Gates: lint 0 errors · both typechecks clean · i18n parity · 0 hardcoded strings
· Gitleaks clean · production build green.

**Not done, and we will not claim it:** nothing is deployed and no phone has run
the app. Deployment is **deliberately held** until the qualifier result — every
free tier starts burning a finite window the moment it is provisioned. Everything
it needs is committed and locally proven: `render.yaml`, the env checklist, and a
smoke suite passing **18/18** against a production-mode server on a real database.

*Speaker note:* Say this plainly. A team that knows exactly what it has not done
is more credible than one that claims everything.

---

## Slide 14 — Impact & what's next

**Today** — a farmer opens one app and knows what to do, why, and how sure we
are. In their language. On a bad connection.

**Next**
- Deploy + demo seed *(hours away — everything is prepared)*
- Yield estimator *(specified, not built — we will not ship a number we cannot source)*
- On-device TFLite for offline diagnosis
- More crops — SoyNet identified for soybean
- Offline write-sync, voice v2, iOS

**The principle we will not trade away:** never show a farmer a number we cannot
stand behind.

> **Khetri — because the right decision, at the right time, is the whole harvest.**
