# ADR-022 — Backend tests run on `node:test`, not Jest

**Status:** Accepted · 2026-08-13 · supersedes the tooling rows in `docs/testing/strategy.md`, `docs/testing/api-testing.md` and `docs/security/security-testing.md`

## Context

The testing docs, written at planning time, specify **Jest + Supertest + mongodb-memory-server**. The backend scaffold delivered in P0-3 instead wired `"test": "node --test"` in `backend/package.json`, and no ADR recorded the change — so the docs and the code disagreed, and P1 had to settle it before writing the first suite.

Two further constraints bear on the choice:

- **ADR-019** put the backend on **JavaScript ESM with no build step**. Jest's ESM support still requires `--experimental-vm-modules` and careful config; every mock helper that makes Jest pleasant (`jest.mock`) is CommonJS-shaped.
- **`docs/security/dependency-security.md`** locks the dependency set and lists *no* test framework. Jest, Supertest and their trees are ~300 packages of new supply-chain surface for a project whose stated policy is "every dependency must earn its place; prefer stdlib/platform".

## Decision

Backend tests run on **Node's built-in test runner** (`node:test` + `node:assert/strict`), with:

- **HTTP driven by the platform `fetch`** against the real app bound to an ephemeral port (`tests/helpers/app.js`), instead of Supertest. This exercises real sockets, real headers and real CORS preflight handling — closer to production than Supertest's in-process injection.
- **`mongodb-memory-server` retained** as the only new dev dependency. It runs a real `mongod`, which is required: uniqueness, partial filters and TTL declarations are server behaviour, and the index-build assertion test would prove nothing against a mock.
- Test environment applied via `node --import ./tests/env.mjs`, so `NODE_ENV=test` is set before any application module loads.

## Consequences

**Gained:** zero test-framework dependencies; no transform or ESM configuration; tests run on the same runtime the server runs on; startup is fast enough that the whole suite is a single command.

**Lost:** Jest's fake timers, snapshot testing and `jest.mock`. Where the docs called for frozen time (TTL and stage maths), the code instead takes an explicit `asOf` / injected clock — which is better design anyway: `deriveStage` is a pure function precisely because nothing in it reads the clock. Where mocking of external services becomes necessary in Phase 2, `nock`-style interception will need revisiting; the plan's `msw/nock` note stands as a Phase-2 decision, not a Phase-1 one.

**Not affected:** frontend (RTL + Vitest/Jest per Phase 5), ml-service (pytest), Playwright E2E. This ADR is scoped to `backend/`.

## Alternatives rejected

- **Adopt Jest as documented** — would require `--experimental-vm-modules`, ~300 dependencies against a locked list, and a config layer, to gain features this suite does not use.
- **Vitest** — pleasant ESM support, but still a framework dependency plus its own transform stack, for a Node backend with no bundler anywhere in its pipeline.

## Follow-up

`docs/testing/strategy.md`, `docs/testing/api-testing.md` and `docs/security/security-testing.md` were updated in the same change to name the actual harness.
