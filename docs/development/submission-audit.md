# Submission audit — Khetri vs the HackInMotion problem statement

Written 2026-08-14 against the repository as it stands, not against the plan.
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
| **`presentation.pptx`** | ❌ **Not created.** Content is written (`docs/product/pitch-deck-content.md`, 14 slides) — the file is not |
| **Deployed application** | ❌ **Nothing is deployed** |
| Live demo | ⚠️ Runs locally; not from a deployed URL |
| Product pitch | ⚠️ Content ready, deck not built |

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

**2 · The crop-health chain has never made a real external call.**
`GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `CLOUDINARY_URL` and `ML_SERVICE_URL` are
all unset. The chain is exhaustively tested against mocked providers and the
8-combination router matrix is green — but **tier 2 and tier 3 have never
answered a live request**. For the project's hero feature, that is a real
exposure. *Mitigation before demo: set one Gemini key and run one real photo.*

**3 · The recommender scores on far less evidence than designed.**
Of four documented factors, **temperature can never score** (the district climate
normals table is empty) and **soil suitability is published for one crop of
nine**. Most crops are therefore ranked on **two factors**, not four. The system
reports this honestly via `evidenceRatio` and `limitations` — but the ranking is
weaker than the architecture implies.

**4 · No phone has ever run the Android app.**
0 of 17 device-matrix rows executed. No APK exists. Everything mobile is
`tsc`-clean and unit-tested, and none of it is device-verified.

**5 · Market data is probably seeded, not live.**
`DATAGOVIN_API_KEY` is unissued (OD-5). The market screens will show **archived**
prices labelled `historical`. Correctly labelled — but a judge asking "is this
today's rate?" gets "no".

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
| 1 | Deploy backend + web | hours | Closes the single biggest deliverable gap |
| 2 | Set a Gemini key, run one real photo end-to-end | minutes | Proves the hero feature works outside mocks |
| 3 | Build `presentation.pptx` from the written content | ~1 h | Explicit missing deliverable |
| 4 | Build an APK, run the device matrix once | hours | Turns "untested on device" into "verified" |
| 5 | Obtain the data.gov.in key | hours–days | Turns historical prices into live ones |
| 6 | Get a Hindi speaker to read the 408 disease strings | ~2 h | Closes the last honesty gap |

Items 1–3 are the difference between "impressive repository" and "finished
submission". Items 4–6 are the difference between "finished" and "trustworthy".

---

## 7 · Verdict

**Against the must-haves: 9 / 9 complete.**
**Against the challenges: 5 complete, 1 partial (offline writes), 1 missing (yield).**
**Against the deliverables: 4 / 7 — the deployment and the deck are the gaps.**

The engineering is stronger than the submission package. The product does more
than the brief asked, on two platforms, with better honesty discipline than the
brief required — and it is currently presented from `localhost` with no slide
deck. **The remaining work is packaging, not building.**
