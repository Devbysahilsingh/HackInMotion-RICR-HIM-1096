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
