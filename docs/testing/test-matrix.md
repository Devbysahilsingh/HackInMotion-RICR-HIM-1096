# Requirement → Test Matrix (excerpt format; maintained alongside features)

| FR | Must work | Can fail (accepted) | Expected behavior on failure | Tests |
|---|---|---|---|---|
| FR-A1..A6 auth | register/login/refresh-rotation/logout, limits, privacy | email delivery (none exists) | n/a | ST-01..05, API auth suite |
| FR-F1..F4 farms | CRUD, GPS+manual, personalization propagation | GPS permission | manual picker path | API farms suite, RTL form, mobile matrix |
| FR-W1 weather | snapshot pipeline, both providers, cache | both providers down | serve last-known-good, ● Cached | integration w/ mocked providers, RES-01..03 |
| FR-W2 risks | rule triggers per crop thresholds | — | — | engine unit fixtures per risk type |
| FR-I1..I3 irrigation | FAO math, verdicts, ledger, simplified mode | ET₀ missing | simplified label | FAO vectors, property tests, API suite |
| FR-H1..H6 health | 3-tier chain, gating, honest UNKNOWN, KB rendering | ML down; Gemini down | tier-down invisible; rules terminal | chain unit (mocked tiers), ST-30 uploads, RES-04..06, ML pytest |
| FR-M1..M3 market | ingest/normalize/signal/fallback labels | source down/stale | cached/historical labels | normalizer unit (fixture rows incl. malformed), signal unit, RES-07 |
| FR-D1..D3 dashboard | feed priorities, dedupe, ack, p95 | — | — | composer unit, API perf check, E2E |
| FR-U2/FR-X i18n | parity, no literals, hi rendering | — | — | parity script, lint, mobile sweep |
| FR-E1 errors | envelopes, designed states everywhere | — | — | ST-50, RTL error states, E2E API-down |
| FR-R1 crop-rec | gates + scoring + sourced reasons | — | — | golden cases, property (reason→sourceRef) |
| FR-FE1 fertilizer | KB render, units preserved, disclaimer | — | — | snapshot per crop×stage, unit test |
| FR-CM1 community | thresholds, dedupe, privacy, consent | — | below threshold = silence | job unit, ST-20 |
| FR-V1 voice | intents (hi/en/hinglish fixtures), TTS, degradation | device support | tappable intents fallback | matcher unit (3-script fixtures), manual device |
| FR-O1 offline | cached reads + labels | writes offline | disabled + explained | mobile matrix, RES-09..12 |
| FR-Y1 yield | 501 contract | — | — | API contract test |
| NFR-2 resilience | full navigation, APIs dead | — | cached everything | E2E journey 2 |
| NFR-3/4 security/privacy | all ST suites | — | — | ST-01..70 |
Full per-endpoint rows generated in the living version during implementation (kept in this file).

## Implemented — current totals (2026-08-14): **1,279 backend · 109 web · 90 mobile · 141 ml-service pytest**

_The per-suite tables below were written at the phase that added them; the counts in their rows are the counts at that time. The totals above are from the most recent full run._

### P1 + P2 + P3 (backend stood at 1,203 when these landed)

| Suite | File (`backend/tests/`) | Covers |
|---|---|---|
| ST-50 API hygiene | `security/st-50-api-hygiene.test.js` | forced-500 leaks nothing · unknown-route envelope · foreign origin denied · credentials only on `/api/v1/auth` · rate-limit headers · 413 oversized body · 422 malformed JSON · correlation id · hardened headers |
| ST-01..05 Auth | `security/st-01-05-auth.test.js` | brute-force bucket (IP+email) · enumeration parity incl. a timing assertion · bcrypt 12 · cookie flags · hash-at-rest · rotation · **reuse → family revocation + audit** · idempotent logout · JWT tamper/alg-none/wrong-secret/expired/wrong-aud/wrong-iss/malformed/deleted-user |
| ST-10 Authorization | `security/st-10-authorization.test.js` | generated from `src/routes/ownership-table.js`: 401 · 404 for another farmer's resource · 404 indistinguishable from absent · 404 on malformed id · tampered token · nested chain · list scoping · client-supplied `userId` ignored · every table row mounted |
| ST-70 Log redaction | `security/st-70-log-redaction.test.js` | credentials, nested credentials, headers and config secrets never reach the log stream; audit `meta` scrubbed before persistence |
| Models & indexes | `models/indexes.test.js` | 14 collections registered · 24 declared indexes with exact keys/order/uniqueness/TTL/partial filter · no undeclared indexes · TTL on exactly two collections · server-enforced uniqueness |
| Farms API | `api/farms.test.js` | CRUD · validation · 10-farm cap · `locationKey` derivation · cascade delete · scoping |
| Crops API | `api/crops.test.js` | CRUD · stage derivation · sowing window · 12-active cap · forward-only transitions · unknown crop → `OTHER` · cascade |
| Registry | `api/registry.test.js` | deterministic composition · manifest-sourced ML classes · ADR-021 tiers · gaps recorded not invented · versioned `seedMeta` · idempotent re-run · **all-or-nothing validation** · public API with ETag/304 |
| Stage engine | `engines/deriveStage.test.js` | boundaries · interpolation · unsourced Kc · malformed input · reason precedence · trace · purity · Kc(MID) > Kc(INITIAL) |
| i18n keys | `i18n/message-keys.test.js` | every emitted messageKey resolves in en **and** hi · en/hi parity · no empty strings · non-canonical namespaces rejected |

### Added in P2

| Suite | File (`backend/tests/`) | Covers |
|---|---|---|
| Weather providers | `integrations/weatherProviders.test.js` | Open-Meteo `buildUrl` pins every unit, window and `timezone=Asia/Kolkata` · columnar → one row per day · a payload missing any requested variable is refused · OWM IST date bucketing · 3-hourly → daily aggregation · missing key reported, not thrown |
| Weather validation | `services/weatherValidation.test.js` | per-source minimum day count (14 primary / 3 fallback) · out-of-range rejects the payload **whole** (RES-03) · duplicate date, tMin>tMax, non-numeric · null ET₀ accepted as the honest fallback value · `splitByDay` puts today in the forecast |
| Weather API + ingest | `api/weather.test.js` | fallback to OWM when the primary fails (RES-01) · both down → last-known-good served with a stale label, cache untouched (RES-02) · malformed payload never overwrites (RES-03) · `status:'pending'` + retry hint + priority queue for an unfetched cell · risks per active crop · ownership 404 |
| Circuit breaker | `utils/circuitBreaker.test.js` | opens after exactly 3 consecutive failures · 10-minute skip and half-open retry · a success resets the streak · `state()` is the `/healthz` view |
| HTTP client | `utils/httpClient.test.js` | every request bounded by the 8s timeout · retry distinguishes our fault from theirs · a 200 that is not JSON · `safeUrl` strips the query string where the keys live · failure-injection flags are routing-only and absent in production |
| Scheduler | `jobs/scheduler.test.js` | `tick(now)` runs a job only when due · a job never overlaps itself · a throwing handler degrades one job, not the scheduler · `run()` external-trigger path · `start()` returns a stop handle |
| Irrigation engine | `engines/irrigation.test.js` | one block per rule R1–R14 · five FAO-56 worked vectors incl. the two anchors recorded in `crops.agronomy.json` · properties (rain > ETc ⇒ D non-increasing; log resets D; sandy crosses RAW before clay; verdict monotonic in rain probability; purity) · incomplete registry degrades, never throws · simplified mode |
| Weather risk | `engines/weatherRisk.test.js` | one fixture block per risk type · imminence and sensitive-stage severity steps · registry vs `ENGINE_DEFAULT` thresholds · crop-status gate · deterministic ordering · trace (R12) · purity |
| Market normalizer | `services/marketNormalizer.test.js` | alias index from the registry · DD/MM/YYYY and ISO parsing incl. rolled-forward impossible dates · strict price gates · modal clamp sets `flagged` (honesty rule 9) · canonicalization · report arithmetic incl. `badGeo` · unmapped samples |
| Market signal | `engines/marketSignal.test.js` | synthetic series and threshold boundaries · district aggregation across mandis · windows count observations not days · insufficient data · momentum note · guidance keys · trace · purity |
| Market API + ingest | `api/market.test.js` | nightly ingest, upsert idempotency, drop-rate abort keeps prior data · seeded-history fallback labelled Historical (RES-07) · series and signal endpoints |
| Feed composer | `engines/feedComposer.test.js` | priority ordering in memory · dedupe by `dedupKey` · `validUntil` per type · 20-item cap evicts INFO first · rain-vs-irrigate contradiction rule · which verdicts and risk levels materialise · every candidate carries trace data (R12) · purity |
| Dashboard + feed jobs | `api/dashboard.test.js` | feed read, ack, expiry job · idempotent feed refresh · p95 sample under realistic load (local gate < 300ms against the memory server; deployed contract p95 < 800ms) |
| Fertilizer | `api/fertilizer.test.js` | `parseTiming` reads the published timing string and nothing more · every published `fractionKey` has en and hi strings · per-crop snapshot of schedule + citation |
| Crop recommendation | `engines/cropRecommendation.test.js`, `api/cropRecommendation.test.js` | documented weights · season/soil/support gates · the water gate cannot fire while district normals are absent · a factor with no evidence is excluded, never guessed · drought penalty · ranking · property: every reason references a registry field with a `sourceRef` · no yield/profit claim (NFR-7) · golden cases |

### Added in P3

| Suite | File | Covers | Tests |
|---|---|---|---|
| Crop-health API | `backend/tests/api/cropHealth.test.js` | all five endpoints end to end · multipart intake and every rejection class over the real route · 201 vs **200 cache hit** with `freshness.status:'cached'` · ownership 404 for crop and farm · severity follow-up amendment · symptom-check · rate-limit trip (the last ST-30 fixture) | 33 |
| Tier-router matrix | `backend/tests/services/cropHealthRouter.test.js` | the 8 documented combinations of ML/Gemini/rules availability × confidence, at the service boundary with a real database: stored `source`, `escalated`, `analysis.provider` and `escalationPath` per row · uncertain never becomes a diagnosis · orphan image cleanup on failure | 22 |
| aiVision contract | `backend/tests/integrations/aiVision.test.js` | `sanitizeDescription` injection quarantine (chat-role turns, override phrasing, special tokens, fences, quotes, control chars, phone/coordinate redaction, length cap) · locked prompt skeleton · Zod mirror strips a model-invented `treatment` field · registry-closing coercion · tolerant JSON parse · tier walk, per-hop deadline, bounded retries | 64 |
| Symptom engine | `backend/tests/engines/symptomEngine.test.js` | intersection normalisation · per-axis weights · weather-tag derivation incl. absent readings · reason-code precedence · expert-referral gate · determinism under a shuffled KB · purity | 45 |
| Community aggregation | `backend/tests/jobs/communityAggregate.test.js` | IST day-aligned window · ≥3 distinct farmers · dupe control · idempotent re-run on the natural key · fan-out targeting (crop *in* the affected district) · expiry/purge · a failing group degrades one district only | 36 |
| ST-20 Privacy | `backend/tests/security/st-20-privacy.test.js` | recursive scan of every community payload for identifying keys **and** values at any depth · consent-off users absent from the aggregation *input* · one farmer produces no externally visible document · alerts carry counts, never report free text · the scanner's own self-tests | 13 |
| ST-30 Upload | `backend/tests/security/st-30-upload.test.js` | polyglot JPEG+ZIP · PNG decompression bomb · 9MB oversize · exe-renamed-jpg · corrupt/truncated JPEG · EXIF-GPS stripped from output · HEIF/AVIF conversion · animated refused · storage failure kinds · the client's claim never influences the outcome | 32 |
| Crop cascade | `backend/tests/services/cropCascade.test.js` | deleting a crop removes its health logs and destroys the Cloudinary assets best-effort | 5 |
| Disease KB i18n | `backend/tests/i18n/disease-keys.test.js` | every registry-referenced disease key resolves in English · no orphan/empty strings either way · Hindi shortfall reported rather than hidden (**0/408**) | 7 |
| ml-service | `ml-service/tests/` (`test_config`, `test_health_and_docs`, `test_logging`, `test_manifest`, `test_policy`, `test_predict_api`, `test_predictor`, `test_preprocessing`, `test_security`) | config fail-fast · key required in every environment and compared over fixed-width digests · `/predict` 401 without/with wrong key, checked before the body is parsed · magic-byte and bomb guards · policy: a prediction is never forced (swept over every crop × confidence) · manifest class-contract drift · image bytes never reach a log line | 141 |

**Resilience matrix:** RES-01 (primary down → fallback), RES-02 (both down → last-known-good, labelled), RES-03 (malformed payload → cache untouched) and RES-07 (mandi source down/stale → seeded history, labelled Historical) are implemented in the suites above. RES-04..06 (ml-service down → AI-assisted; ML+Gemini down → OpenRouter → rules; all AI down → rules) are covered **as behaviour** by the tier-router matrix, which asserts the source label, escalation flag and per-hop reason code for each of those states; what is not done is the RES procedure itself — toggling `FORCE_FAIL_ML`/`GEMINI`/`OPENROUTER` against a running deployment and observing the UI, which needs a deployed ml-service.

**Resolved:** the `varietyClass` defect that suite recorded is fixed — `CropRegistry`'s fertilizer sub-schema now declares the field, so TNAU's three rice doses and two cotton doses reach the farmer labelled with the variety class each applies to. The recording test was replaced with a positive end-to-end assertion (knowledge file → seed → wire).

**Suite status.** ST-20 and ST-30 are **implemented** (files above). ST-40 and ST-60 are **partial**:

| Suite | Part | Status |
|---|---|---|
| ST-40 | `$`-operator payloads in every string field (sanitizer) | **partial** — the sanitizer is applied globally (`src/middleware/sanitize.js`, mounted ahead of every route) and `security/st-50-api-hygiene.test.js` ST-50.11 asserts a deeply nested `{$ne: null}` body is rejected rather than partly sanitized; there is no per-endpoint sweep over every string field |
| ST-40 | instruction-injection in the health `description` | covered — `integrations/aiVision.test.js` adversarial fixtures: the injected instruction is both quarantined in the untrusted-note block **and** stripped, and the built prompt is asserted against it |
| ST-40 | XSS payload round-trip (stored text escaped on render — RTL test) | **not covered** — needs the web client |
| ST-60 | ml-service `/predict` without key → 401, wrong key → 401 | covered — `ml-service/tests/test_predict_api.py` + `test_security.py` (incl. auth-before-body-parse and fixed-width digest compare). The "+ audit" half is not: ml-service writes no audit record |
| ST-60 | Gemini key absent from all client bundles (grep `dist`/APK) | **⚠ BLOCKED** — the client apps now exist and the scanner does too: `scripts/scan-apk-strings.mjs` (`npm run scan:apk <file.apk>`, also `--bundle <file>`) reads the archive with Node's zlib, decompresses every text member (`assets/index.android.bundle` above all) and matches credential *shapes* — Google/OpenRouter/OpenAI/Groq keys, a Cloudinary URL, a Mongo SRV URI, AWS ids, private-key blocks — rather than a denylist of this project's keys, so a secret nobody thought to list still matches. A finding reports member + byte offset + **pattern name** and never the matched text. **It has never been run against a real artefact: no APK has been built** (`eas init` not run, no Expo account linked). The web `dist` half is likewise unscanned. What holds by construction meanwhile: the mobile bundle carries exactly one `EXPO_PUBLIC_*` value, the API base URL (`mobile/src/config/env.ts`) |
| ST-60 | kill-switch flags degrade without auth impact | covered — `utils/httpClient.test.js` (flags are routing-only and inert in production, incl. the Phase-3 providers) + the tier-router matrix rows that assert a `disabled` hop lands in `escalationPath` and the chain still answers |

Not yet implemented: the ST-40 per-endpoint `$`-operator sweep, the ST-40 XSS round-trip, the ST-60 client-bundle key grep (blocked on a built artefact), RES-09..12 (device procedures — see below), and the live RES-04..06 procedure (needs a deployed ml-service).

### Added in P6 — mobile (2026-08-14)

**11 suites / 90 tests, all passing** (`npm --prefix mobile test`, jest-expo); `tsc --noEmit` clean. Web rose to **109 / 109** across 14 files, backend to **1,279 / 1,279** across 255 suites.

| Suite | File (`mobile/src/`) | Covers | Tests |
|---|---|---|---|
| axios interceptors | `api/client.test.ts` | bearer header · `X-Request-Id` incl. the non-Hermes fallback · single-flight refresh under concurrent 401s · exactly one replay · rotated token stored before the access token is published · **a refusal clears the credential, a transport failure does not** · `Retry-After` parsing · the whole `toApiError` taxonomy · envelope unwrapping | 16 |
| Token custody | `api/session.test.ts` | access token memory-only · refresh token SecureStore-only · SecureStore failures swallowed to null · the session-lost event bus | 8 |
| Upload state machine | `hooks/useAnalyze.test.ts` | every stage transition · observed (never timed) progress · cancel aborts and orphans the run · **retry re-sends the same compressed bytes** (RES-10's testable half) · all seven failure classes against the exact envelopes `middleware/uploadImage.js` emits | 23 |
| Analyzing screen | `screens/scan/AnalyzingScreen.test.tsx` | staged live-region copy · determinate progress only while measurable · cancel confirmation · per-kind failure panel incl. the `Retry-After` wait sentence | 5 |
| Geolocation | `hooks/useGeolocation.test.ts` | the failure taxonomy kept distinct — services off vs. refusal vs. can't-ask-again vs. timeout vs. provider error vs. outside-India · six-decimal rounding · boundary accepted · a late fix discarded after `clear()` | 11 |
| Network detection | `hooks/useOnlineManager.test.ts` | NetInfo → React Query's online manager · `isInternetReachable ?? isConnected` · the `known` flag before the first event | 5 |
| Foreground refetch | `hooks/useAppStateRefetch.test.tsx` | fires only on the background→active edge · only when online · suppressible (the camera flow stands it down) · registry exempt | 6 |
| Offline write guard | `hooks/useOfflineWriteGuard.test.tsx` | blocked only once NetInfo has answered · reason string | 3 |
| Registry prefetch | `hooks/usePrefetchRegistry.test.tsx` | once per signed-in session · skipped offline · retried on reconnect · list then crops · not marked warmed on failure | 5 |
| Domain components | `components/domain/{WhyTrace,IrrigationVerdictCard}.test.tsx` | heterogeneous trace steps render whatever numbers they carry · verdict copy · the three honesty labels · the null-verdict branch | 8 |

Also added on the web, closing holes the old fixtures had been hiding (see the Phase 6 implementation-log entry — five wire-type drifts): `components/domain/FertilizerGuidanceView.test.tsx` (6), `components/domain/IrrigationVerdictCard.test.tsx` (3), `pages/health/SymptomCheckPage.test.tsx` (3), and a rewritten escalation-path assertion in `AnalysisResult.test.tsx` that requires each provider to appear by name and the string `undefined` to appear nowhere.

**RES-09..12 — the client apps exist; the scenarios have not been run.**

| # | Scenario | Status |
|---|---|---|
| RES-09 | mobile cold-start offline → cached dashboard renders + banners | **⏳ MANUAL DEVICE TEST PENDING.** The mechanism is built and partly unit-tested: `PersistQueryClientProvider` (AsyncStorage, 24h `maxAge`, success-only dehydration), NetInfo-driven online manager (5 tests), offline banner, and an `AuthContext` bootstrap that checks NetInfo *before* attempting a refresh. Rendering last session's dashboard on a handset with no signal is a device observation. |
| RES-10 | connection drop mid-upload → retry UX, image retained, no orphan logs | **⚠ PARTIAL.** The client half is asserted in `hooks/useAnalyze.test.ts`: the compressed file is held in a ref and `retry()` re-sends the same bytes; a `network` failure sets `canRetrySameImage`. The orphan-log half is a backend property already covered by the tier-router matrix. The airplane-toggle-mid-flight procedure is ⏳ MANUAL DEVICE TEST PENDING. |
| RES-11 | token expiry offline → read-only cached mode, no wipe | **⚠ PARTIAL.** Two guards are code-verified and one is unit-tested: `AuthContext` does not attempt the refresh at all while NetInfo reports offline, and `api/client.ts` clears the SecureStore token only when the server actually answered (`error.response != null`) — asserted in `api/client.test.ts`. The device scenario is ⏳ MANUAL DEVICE TEST PENDING. Known residual: a captive portal answers with an HTTP response and is therefore indistinguishable from a refusal. |
| RES-12 | recovery (flags off) → labels flip to ● Live on next fetch, no stuck state | **⏳ MANUAL DEVICE TEST PENDING.** `refetchOnReconnect` is on and the online manager is NetInfo-driven (unit-tested), but "no stuck state" is a claim about the UI after a real reconnect. |

**None of RES-09..12 may be reported as passing.** They are device scenarios and no physical device or emulator has run the app. The full scripted matrix is `docs/mobile/testing.md` (17 rows, **zero executed**).

**ST-60 client half** — see the ST-60 rows above: the scanner exists, no APK does.
