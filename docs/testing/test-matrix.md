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

## Implemented (P1) — 228 tests, all passing

| Suite | File (`backend/tests/`) | Covers |
|---|---|---|
| ST-50 API hygiene | `security/st-50-api-hygiene.test.js` | forced-500 leaks nothing · unknown-route envelope · foreign origin denied · credentials only on `/api/v1/auth` · rate-limit headers · 413 oversized body · 422 malformed JSON · correlation id · hardened headers |
| ST-01..05 Auth | `security/st-01-05-auth.test.js` | brute-force bucket (IP+email) · enumeration parity incl. a timing assertion · bcrypt 12 · cookie flags · hash-at-rest · rotation · **reuse → family revocation + audit** · idempotent logout · JWT tamper/alg-none/wrong-secret/expired/wrong-aud/wrong-iss/malformed/deleted-user |
| ST-10 Authorization | `security/st-10-authorization.test.js` | generated from `src/routes/ownership-table.js`: 401 · 404 for another farmer's resource · 404 indistinguishable from absent · 404 on malformed id · tampered token · nested chain · list scoping · client-supplied `userId` ignored · every table row mounted |
| ST-70 Log redaction | `security/st-70-log-redaction.test.js` | credentials, nested credentials, headers and config secrets never reach the log stream; audit `meta` scrubbed before persistence |
| Models & indexes | `models/indexes.test.js` | 14 collections registered · 23 declared indexes with exact keys/order/uniqueness/TTL/partial filter · no undeclared indexes · TTL on exactly two collections · server-enforced uniqueness |
| Farms API | `api/farms.test.js` | CRUD · validation · 10-farm cap · `locationKey` derivation · cascade delete · scoping |
| Crops API | `api/crops.test.js` | CRUD · stage derivation · sowing window · 12-active cap · forward-only transitions · unknown crop → `OTHER` · cascade |
| Registry | `api/registry.test.js` | deterministic composition · manifest-sourced ML classes · ADR-021 tiers · gaps recorded not invented · versioned `seedMeta` · idempotent re-run · **all-or-nothing validation** · public API with ETag/304 |
| Stage engine | `engines/deriveStage.test.js` | boundaries · interpolation · unsourced Kc · malformed input · reason precedence · trace · purity · Kc(MID) > Kc(INITIAL) |
| i18n keys | `i18n/message-keys.test.js` | every emitted messageKey resolves in en **and** hi · en/hi parity · no empty strings · non-canonical namespaces rejected |

Not yet implemented: ST-20 (privacy — needs community aggregation), ST-30 (upload), ST-40 (injection — sanitizer exists, suite pending), ST-60 (services — needs ml-service), RES-01..12 (needs external integrations).
