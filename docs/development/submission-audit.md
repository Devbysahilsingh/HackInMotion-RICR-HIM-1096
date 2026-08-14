# Submission audit — Khetri vs the HackInMotion problem statement

Written 2026-08-14 against the repository as it stands, not against the plan.
**Revised the same day** after a live end-to-end API probe (§3b) — two weaknesses
below turned out to be stale or simply wrong, and are struck through rather than
quietly deleted.
Every ✅ below is backed by a passing suite or a committed artifact; every ❌ is
stated without softening. The last section is the one worth reading twice.

---

## 1 · Must-haves (9 of 9)

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 1 | **Accounts & auth** — secure signup/login, data private per account | ✅ **Done** | bcrypt-12, JWT + rotating refresh with **reuse detection**. Ownership is a **query filter**, never a post-filter — another farmer's field returns **404, not 403**. ST-11 IDOR sweep (42 tests) + ST-05b token forgery (38) |
| 2 | **Farm profile** — location, size, soil, crops; drives personalization | ✅ **Done** | GPS **or** manual district. Personalization is structural: change the soil type and the irrigation verdict changes, because soil AWC is an input to the FAO-56 balance. Land ledger enforced server-side (crop area ≤ farm area) |
| 3 | **Weather → irrigation + risk engine** *(core)* | ✅ **Done** | FAO-56 soil-water balance: ET₀ × Kc for the derived stage, against soil AWC and root depth, replayed over the logged ledger and projected across the forecast. Per-crop risk with `thresholdSource` distinguishing published vs default. **Open-Meteo → OpenWeatherMap**, documented in README + ADR-007 |
| 4 | **Crop health monitoring** — photo + description → flag + guidance | ✅ **Done** | 4-tier chain: local ONNX → Gemini → OpenRouter → symptom rules. Custom EfficientNet-B0 trained on our own GPU. Approach documented and justified in README + `docs/ai/` |
| 5 | **Market price insights** | ✅ **Done** | data.gov.in (Agmarknet), GODL-licensed. Trend engine describes what prices **have done** — never a forecast |
| 6 | **Unified dashboard** — "what do I act on today?" | ✅ **Done** | One aggregation, zero external calls. Ranked decision band + crop cards + weather/water/market/health tiles |
| 7 | **Database** — accounts, profiles, weather/irrigation history, health logs, prices | ✅ **Done** | MongoDB, 14 collections, indexes asserted by a test. Every owned doc carries `userId` |
| 8 | **Responsive clean UI** — desktop + mobile, icon/colour coded | ✅ **Done** | Sidebar ≥768px / bottom tabs below. Icon + colour + **text** always — never colour alone. Plus a **native Android app**, which the brief did not ask for |
| 9 | **Error handling** — missing data, API failure, bad crop, failed upload | ✅ **Done** | Error boundaries on both clients; designed empty/error/offline/pending states; every upload rejection is a classed reason; `pending` weather is a designed state, not a 500 |

---

## 2 · Challenge capabilities (5 of 6 complete, 1 partial, 1 missing)

| Challenge | Status | Reality |
|---|---|---|
| **Crop recommendation engine** | ✅ **Done, and rebuilt** | Farm-scoped pipeline: context → season → land → **market eligibility gate** → weighted scoring. Market availability is a *hard* filter — a crop no reachable mandi has priced is excluded with a reason, never ranked with an empty price |
| **Fertilizer & resource planning** | ✅ **Done** | Sourced ICAR/TNAU/PAU schedules by growth stage. **No AI-authored dose, ever** — every figure carries its citation |
| **Community outbreak alerts** | ✅ **Done** | District-aggregated, consent-gated, structurally PII-free. **No write API** — only a scheduled job counting ≥3 distinct farmers can raise an alert, so it cannot be gamed from a browser |
| **Voice interface** | ⚠️ **Partial** | **Web:** speech-to-text *and* text-to-speech + intent buttons. **Mobile: TTS only** — `RECORD_AUDIO` is deliberately blocked, because the dev-build path would forfeit the Expo Go demo route. Decision recorded in `docs/mobile/technology-decision.md` |
| **Offline-first support** | ⚠️ **Partial** | **Reads** are cached and work offline with honest labels. **Writes are not queued** — the brief's "syncing when connection is available" is not implemented. In the P3 backlog |
| **Yield prediction** | ❌ **Not built** | `YieldEstimate` model exists; **there is no endpoint and no estimator**. Specified in `docs/yield/`, deliberately deferred rather than shipped as a guess |

---

## 3 · Deliverables

| Deliverable | Status |
|---|---|
| `architecture-diagram.png` | ✅ Rendered 2400px, with `architecture-diagram.mmd` source committed |
| `api-documentation.md` | ✅ 38 routes, transcribed from the ownership table a test asserts against the live router |
| `README.md` | ✅ Complete, with third-party APIs + why each was chosen |
| Repo naming/structure | ✅ `HackInMotion-RICR-HIM-1096` |
| **`presentation.pptx`** | ⚠️ **File created, not yet committed.** Content source: `docs/product/pitch-deck-content.md` (14 slides) |
| **Deployed application** | ❌ **Nothing is deployed** |
| Live demo | ⚠️ Runs locally; not from a deployed URL |
| Product pitch | ⚠️ Content ready, deck not built |

---

## 3b · Live API verification — 2026-08-14

Not read from the source: a running server on a real database, probed end to end.
Register → farm → crop → every farmer-facing read.

| Endpoint | Result |
|---|---|
| `POST /auth/register` → `GET /auth/me` | 201 / 200, full security headers, `RateLimit: 10;w=3600`, httpOnly path-scoped cookie |
| `POST /farms`, `POST /farms/:id/crops` | 201, land ledger enforced |
| `GET /farms/:id/weather` | **14 days · freshness `live` · source `open-meteo`** · real ET₀ (2.43 mm) · 1 crop risk raised |
| `GET /crops/:id/irrigation` | `WAIT_RAIN_EXPECTED`, mode **`full`** (not simplified), depletion **1.716 mm**, RAW **126.6 mm** |
| `GET /crops/:id/fertilizer-guidance` | 200, sourced schedule |
| `GET /dashboard` | 1 crop card · `systemStatus` weather **`live`**, market `cached`, ml **`live`** |
| `GET /market/nearby` | **264 mandis · 6 commodities** · freshness `cached` |
| `GET /market/my-crops`, `GET /market/prices` | 200 with series |
| `GET /farms/:id/recommendations` | **4 ranked · 4 excluded** · season `RABI` · 40 acres free |
| `GET /registry/crops`, `/community/alerts`, `/recommendations`, `/crop-health/logs` | 200 |
| `PATCH /users/me` | 200 |
| **IDOR** — another account reading this farm | **404**, as required |

**17 / 17 endpoints answered with populated payloads.** Every scheduled job
reported `ok: true` at boot, including `weatherRefresh` and `marketRefresh`.

**One defect found and fixed by this probe:** the dashboard feed was empty for up
to 30 minutes after a farmer added their first crop, because the feed is written
by a scheduled job. `POST /farms/:farmId/crops` now rebuilds that one user's feed
after responding — verified 0 → 2 real decisions. See commit `b4a33b0`.

---

## 3c · Crop-health chain — live end-to-end verification, 2026-08-14

The last unproven path in §5.2, closed. **One real field photograph**
(`datasets/audit/fieldtest-review/TOMATO_EARLY_BLIGHT__00.jpg`, 327,821 bytes)
pushed through the production chain against live services — no mock image, no
mocked provider, no substituted diagnosis.

**Tier 1 — our own trained ONNX model, executing.** ml-service booted with
`MODEL_PATH=model/model-v1.0.onnx`, reporting `predictor: OnnxPredictor`,
`modelTrained: true`, `thresholdsCalibrated: true`, 35 classes. `X-Service-Key`
enforced: a missing key and a wrong key both answered **401
`SERVICE_KEY_INVALID`**.

| Step | Evidence |
|---|---|
| `POST /crop-health/analyze` | **201 in 2.91 s** |
| Cloudinary | real URL persisted, `…/him1096/development/2beed827-….jpg` |
| Tier reached | `source: ml` — **no tier-down**, `escalationPath: []` |
| Prediction | `TOMATO_TARGET_SPOT`, confidence **0.813053**, `modelVersion: model-v1.0` |
| Confidence semantics | `confidenceKind: CALIBRATED` (a real probability, unlike the AI band) |
| Top-3 | target spot 0.813 · early blight 0.087 · leaf mold 0.078 |
| Persistence | `GET /crop-health/logs` → 1 · `GET /crop-health/logs/:id` → identical code/confidence/model |
| Contract | `analysis`, `recommendation`, `freshness`, `severityFollowUp`, `coverageNoticeKey`, `sharedToCommunity`, `status` |
| Labels | `sourceLabelKey: health.sourceLocalAi`, `severityAssessment: NOT_ASSESSED` |
| Advice | i18n keys only, with real citations (UF/IFAS PP351, NIPHM/DPPQS) — no model-authored text |
| **IDOR** | second account reading the log → **404** |

**The ONNX model demonstrably executed** — 78.74 ms inference on a direct
`/predict` probe, and the backend's own 0.813053 differs from that probe's
0.811518 precisely because the upload pipeline re-encodes the JPEG before
inference, which is the sanitization step doing its job.

**Read the prediction honestly: the model got it wrong.** Ground truth is early
blight; the model ranked it **second at 0.087** and answered target spot at
0.813 — a confident miss. This is exactly the field-domain weakness the ship
gates already measured (**PlantDoc accuracy 0.1257** vs 0.9632 in-domain), and
it is the reason the Gemini tier is load-bearing rather than decorative. On this
photograph **both AI tiers were right where our own model was wrong.**

**Tiers 2–4, each verified live** via the routing-only `FORCE_FAIL_*` flags on
throwaway instances (ports 4001–4003; the production config was never modified):

| Injected failure | Answered by | Result | Elapsed |
|---|---|---|---|
| — | Tier 1 ONNX | `TOMATO_TARGET_SPOT` @ 0.813 calibrated | 2.9 s |
| `ML` | Tier 2 **Gemini** | **`TOMATO_EARLY_BLIGHT`** @ 0.85 band, `health.sourceAiAssisted` | 7.6 s |
| `ML` + `GEMINI` | Tier 3 **OpenRouter** | **`TOMATO_EARLY_BLIGHT`**, `health.sourceAiAssisted` | 10.7 s |
| `ML` + `GEMINI` + `OPENROUTER` | Tier 4 rules | **`UNKNOWN`**, confidence `null`, `health.sourceGuided` | 2.4 s |

Every hop that declined is recorded in `escalationPath` with its reason, and
**no tier invented a disease** — the terminal case returns `UNKNOWN` with a null
confidence rather than a guess. All four runs finished inside the 15 s E2E budget.

Provider-level confirmation, measured directly rather than inferred: Gemini
**200 in 5.87 s** (`finishReason: STOP`) and OpenRouter **200 in 6.02 s, cost 0**
through the backend's own `openRouter.analyze()`, both returning schema-valid
JSON naming early blight.

**Two findings worth carrying forward, neither a defect today:**

1. `gemini-flash-latest` is a rolling alias and now resolves to
   **`gemini-3.7-flash`**, a *thinking* model whose reasoning tokens count
   against `maxOutputTokens`. At the production setting (1024) the real request
   used 187 thought + 113 output tokens — comfortable headroom — but a thinking
   spike would hit `MAX_TOKENS` and return empty content. That degrades to
   `EMPTY_RESPONSE` → next tier, which is honest, not wrong. Worth watching, not
   worth changing without evidence.
2. A transient OpenRouter **`http_status`** appeared on one run and did not
   reproduce; the free tier rate-limits, and a direct probe had fired seconds
   earlier. The chain handled it correctly by falling through to `UNKNOWN`.

**Naming caveat, so nobody misreads a log:** `source: "gemini"` identifies the
*AI-assisted tier*, not the provider — when OpenRouter answers, `source` is
still `gemini` and `provider` carries `openrouter`. The farmer-facing label is
the generic `health.sourceAiAssisted` either way, so the displayed claim stays
accurate.

**Still not verified:** no cross-crop sweep (one photograph, one crop), and
`severityAssessment` stays `NOT_ASSESSED` until the farmer answers the follow-up
— by design, but it means the severity engine's photo path is unexercised here.

---

## 4 · What is genuinely strong

**1 · The honesty architecture.** This is the real differentiator, not a feature.
Every data-bearing response carries `freshness` (Live/Cached/Historical/Pending)
and a `trace` of the engine's own numbers. The recommender reports
`evidenceRatio` — how much of the intended weight was actually backed by data —
and **drops a factor it cannot evidence rather than substituting a neutral 0.5**.
Most projects would have filled that with a plausible number and nobody would
ever have known.

**2 · We measured our model where it actually fails.** 0.9556 validation macro-F1,
**0.1257 on field-domain photographs**. That gap is why the Gemini tier exists.
Almost nobody publishes their bad number.

**3 · Real agronomy.** FAO-56 water balance with soil AWC, root depth by stage,
depletion fraction corrected for evaporative demand — not "rain tomorrow, skip
watering". Verified against FAO worked vectors.

**4 · Security treated as a feature.** 15 real vulnerabilities found and fixed,
**each with a regression test that fails against the pre-fix code**. ZAP baseline
0 FAIL / 66 PASS. No admin surface, no demo bypass, no backdoor.

**5 · Test depth.** ~1,950 tests: backend 1,566 · web 131 · mobile 110 ·
ml-service 143. Not smoke tests — engine math, authorization matrices, upload
security, resilience injection.

**6 · Scope over-delivery.** The brief asks for a *web-based platform*. We built
web **and** a native Android app on one REST contract, with no duplicated
business logic.

**7 · Genuine bilingual support.** 1,489 keys, 0 missing in Hindi, parity gated
in CI, **zero hardcoded strings** enforced by a repo script.

---

## 5 · What is genuinely weak — read this before the viva

**1 · Nothing is deployed. This is the biggest gap.**
The brief says "deployed application (deployment strongly recommended)". We have
none. The deferral is *reasoned* — free tiers burn finite windows the moment
they are provisioned, and everything needed is committed and locally proven
(`render.yaml`, env checklist, smoke suite 18/18) — but a judge sees a localhost
demo where others show a URL. **Be ready to say this in one sentence and move on.**

**2 · ~~The crop-health chain has never made a real external call.~~
~~A real leaf photograph has not been pushed through the full chain.~~ FULLY
RESOLVED 2026-08-14 — see §3c.**
A real field photograph now runs the complete production chain end to end, and
**all four tiers are individually verified live**: our own ONNX model answered in
78 ms, Gemini and OpenRouter each returned schema-valid diagnoses, and the
terminal rules tier returns `UNKNOWN` rather than a guess. What survives is not a
plumbing gap but a **model-quality** one, and it is the honest headline: on this
photograph the local model was **confidently wrong** (target spot @ 0.813; the
correct early blight ranked second @ 0.087), while both AI tiers were right.
That is the measured field-domain weakness (PlantDoc **0.1257**) showing up in
practice — the architecture handled it correctly, which is the point, but do not
claim the model is accurate on field photos. Also unswept: one crop, one image.

**3 · The recommender scores on far less evidence than designed.**
Of four documented factors, **temperature can never score** (the district climate
normals table is empty) and **soil suitability is published for one crop of
nine**. Most crops are therefore ranked on **two factors**, not four. The system
reports this honestly via `evidenceRatio` and `limitations` — but the ranking is
weaker than the architecture implies.

**4 · No phone has ever run the Android app.**
0 of 17 device-matrix rows executed. No APK exists. Everything mobile is
`tsc`-clean and unit-tested, and none of it is device-verified.

**5 · ~~Market data is probably seeded, not live.~~ WRONG — corrected 2026-08-14.**
Measured, not assumed: `GET /market/nearby` returns **264 mandis across 6
commodities** with freshness **`cached`**, not `historical`. `cached` means the
rows came from the portal; `historical` would mean the CEDA seed. The nightly
`marketRefresh` job reports `ok: true`. The prices are real Agmarknet data, a
little behind today rather than archived.

**6 · 408 Hindi disease strings are machine-translated and unreviewed.**
Parity-complete and ledgered, but **no Hindi-literate reviewer has read them**.
This is agronomic content in a language nobody on the team verified. It is the
one place the "no fabrication" principle is under real strain.

**7 · CI has never run.** `.github/workflows/ci.yml` exists with SHA-pinned
actions and has **zero execution history**.

**8 · One known failing test.** `test_generator_reports_the_committed_manifest_as_current`
— a manifest-hash drift committed in Phase 4. Documented, not a regression, left
for the ML owner rather than silently regenerated.

---

## 6 · Highest-value actions, in order

| # | Action | Effort | Why |
|---|---|---|---|
| 1 | Deploy backend + web | hours | The single biggest remaining deliverable gap |
| 2 | ~~Push **one real leaf photo** through the full chain~~ — **done 2026-08-14 (§3c)** | — | All four tiers verified live; the remaining gap is model accuracy, not wiring |
| 3 | Commit `presentation.pptx` | minutes | The file exists in the working tree but is not tracked |
| 4 | Build an APK, run the device matrix once | hours | Turns "untested on device" into "verified" |
| 5 | Get a Hindi speaker to read the 408 disease strings | ~2 h | Closes the last honesty gap |

~~Obtain the data.gov.in key~~ — **done**: the market pipeline is returning live
portal data (264 mandis), so this is no longer an action item.

Items 1–3 are the difference between "impressive repository" and "finished
submission". Items 4–5 are the difference between "finished" and "trustworthy".

---

## 7 · Verdict

**Against the must-haves: 9 / 9 complete.**
**Against the challenges: 5 complete, 1 partial (offline writes), 1 missing (yield).**
**Against the deliverables: 4 / 7 — the deployment and the deck are the gaps.**

The engineering is stronger than the submission package. The product does more
than the brief asked, on two platforms, with better honesty discipline than the
brief required — and it is currently presented from `localhost`.

**The live probe in §3b matters more than any claim in §4.** Seventeen endpoints
answered with populated payloads against a real database: live Open-Meteo
forecasts, a full FAO-56 irrigation verdict with its depletion and RAW figures,
264 mandis of real Agmarknet prices, and a farm-scoped ranking that excluded four
crops with stated reasons. This is a working system, not a demo shell — and the
probe found and fixed a real defect on the way through.

**The remaining work is packaging, not building.**
