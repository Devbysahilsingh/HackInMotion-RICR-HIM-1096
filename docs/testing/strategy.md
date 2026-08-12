# Testing Strategy

Philosophy: test where wrongness hurts farmers or demos — engines (math), authorization (privacy), fallbacks (resilience), upload pipeline (security), i18n parity (product promise). UI snapshots and coverage theater are explicitly deprioritized.

| Layer | Tool | Scope | Gate |
|---|---|---|---|
| Engine unit | `node:test` (ADR-022) | irrigation (FAO vectors + properties), risk rules, market signal, crop-rec golden cases, symptom scoring, feed composer priorities/dedup, stage derivation | blocking |
| API integration | `node:test` + `fetch` + mongodb-memory-server (ADR-022) | every endpoint: happy + validation + authz matrix (ST-10) + error envelopes | blocking |
| Security suites | `node:test` (ST-01..70) | docs/security/security-testing.md | blocking |
| i18n message keys | `node:test` | every messageKey the API emits resolves in en **and** hi; namespace typos rejected | blocking |
| ML | pytest | preprocessing determinism, ONNX parity golden images, threshold policy, corrupt input, schema | blocking for model ship |
| ML evaluation | scripts | full battery (docs/ml/evaluation-plan.md) + ship gates | blocking for model ship |
| Frontend | RTL + jest | QueryBoundary states, WhyTrace rendering, forms validation UX, auth bootstrap, i18n key render (no-literal check via lint) | blocking (small set) |
| i18n | script | en/hi parity + unverified counts | blocking Day 3 |
| Resilience | scripted failure-injection | 12-scenario matrix | blocking Day 3 |
| E2E web | Playwright | 2 journeys: full farmer loop; API-down loop | blocking Day 3 |
| Mobile | jest-expo + scripted manual matrix | docs/mobile/testing.md | demo sign-off |
| Deployment smoke | script vs prod URLs | healthz, auth round-trip, read endpoints, headers | post-deploy blocking |

Requirement coverage: every FR maps to ≥1 verification row in test-matrix.md (traceability mandate). Test data: factories + seed fixtures; external services mocked at integration layer (msw/nock) with recorded real payload samples; live-API tests run manually Day 2 (marked, not in CI path).

**Backend harness (as built, P1):** `cd backend && npm test` → `node --import ./tests/env.mjs --test tests/`. Layout: `tests/helpers/` (in-memory Mongo, ephemeral-port app + fetch client), `tests/factories/`, `tests/security/` (ST suites), `tests/api/`, `tests/models/`, `tests/engines/`, `tests/i18n/`. Frozen time is not available (no fake timers); code that depends on the clock takes an explicit `asOf`, which is why `deriveStage` is a pure function. Rationale: ADR-022.
