# API Testing

Harness: Jest + Supertest + mongodb-memory-server (isolated per suite); integrations mocked via nock with recorded sample payloads (`tests/fixtures/external/`); time frozen (jest fake timers) for TTL/stage math; factories (`tests/factories/`) for user/farm/crop/log.
Per endpoint (template): happy path (status+envelope+DB effect) · validation cases (each Zod rule) · auth 401 · ownership 404 (other-user fixture) · rate-limit 429 (bucket exhaust) · error envelope shape on forced failure. Auth extra: rotation chain, reuse→family revocation, cookie flags asserted.
Special suites: health analyze = tier-router matrix (8 combinations of ML/Gemini/rules availability × confidence) asserting source labels + escalation flags; jobs = invoked directly with mocked integrations, asserting cache-preservation on failure + idempotent re-runs; dashboard = seeded scenario asserting priority order + dedupe + p95 sanity (<300ms local against memory server).
Manual live checks (Day 2, once, recorded): real Open-Meteo/data.gov.in/Gemini round-trips with our validators (payload drift detection).
