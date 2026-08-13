# ADR-025 — Phase 5 web frontend decisions

**Status:** Accepted · 2026-08-13 · extends ADR-014 (React Query, no Redux), ADR-018 (shared/), ADR-022 (test runners)

Decisions taken while building the web client that were not settled by an existing document, plus the three places the running API disagreed with what the docs implied.

---

## 1. Flat i18n keys, `keySeparator: false`

`shared/i18n/en/fertilizer.json` already stored keys as flat strings containing dots (`"schedule.basal.full"`), and the backend's parity test asserts that **every value in a scanned namespace is a non-empty string** — a nested object fails it. i18next's default `keySeparator: '.'` would resolve `t('schedule.basal.full')` against a nested object that does not exist.

**Decision:** every resource file stays flat, and i18next runs with `keySeparator: false` / `nsSeparator: ':'`. The messageKey a route emits (`fertilizer.schedule.basal.full`) is split on the **first** dot only and resolves byte-for-byte.

**Consequence:** new keys must be flat. The parity script and the backend test both enforce it, from opposite directions.

## 2. Verification ledger lives outside the namespace files

`docs/i18n/translation-strategy.md` asks for verification state in a `_meta.verified` array per file. That cannot go in the namespace files for the reason above.

**Decision:** `shared/i18n/hi/_verification.json`, read by `scripts/check-i18n.mjs`. Absent or unreadable means zero verified — the script never assumes sign-off.

## 3. Chart series colours are not the brand palette

`brand-600` (`#277249`) **fails** the dataviz chroma floor on a white surface — the validator reports it as reading gray. Using it for a data series would make the one thing on the chart that carries meaning the hardest thing to see.

**Decision:** series colours come from the validated categorical palette (`#2a78d6`, `#eb6834`), recorded with their validator output in `components/charts/theme.ts`. Brand colour stays on buttons, chips and headings.

**Also decided:** temperature and rainfall are **two charts**, never one with two y-axes. The crossing point of a dual-axis chart is an artefact of axis placement, not a fact about the weather.

## 4. The component showcase is absent from production, not hidden in it

`component-map.md` asks for `/dev/components` "in dev builds only — **not a hidden prod route** — stripped from prod bundle".

**Decision:** the `lazy()` call itself sits inside `import.meta.env.DEV ? … : null`, not merely the `<Route>`. Vite substitutes the literal `false`, Rollup drops the branch, the dynamic import loses its only reference and no chunk is emitted. Verified: `Component showcase` appears nowhere in `dist/`.

**Why it matters:** the obvious shape — `const X = lazy(…)` at module scope with a conditional route — still ships the chunk, because the import is evaluated unconditionally. That would have been a hidden production route, which CLAUDE.md rule 2 forbids.

## 5. Language is a local preference after registration

The API accepts `language` at registration and returns it on `/auth/me`, but exposes **no** `PATCH /users/me` — `app.js` mounts no users router. A settings toggle that fired one would 404.

**Decision:** language is persisted to `localStorage` and adopted from the account on first sign-in unless the farmer has since chosen otherwise on this device. `SettingsPage` shows `communityConsent` read-only for the same reason. Neither is faked with a control that does nothing.

## 6. The E2E suite reuses one signed-in browser per worker

Two production security controls make the usual shapes fail, and neither may be relaxed for a test run (rule 2: the demo runs the production security config):

- **`storageState` cannot work.** Refresh tokens rotate and the server runs reuse detection. Replaying one saved cookie into a fresh context per test is, correctly, treated as theft: the family is killed and every later test is signed out.
- **Logging in per test cannot work.** `loginLimiter` is 5 per 15 minutes keyed on IP *and* email.

**Decision:** a worker-scoped fixture signs in once and keeps that context for the run, so the rotating token chain stays intact exactly as it would for a real farmer. Tests that need a signed-out browser live in `guards.spec.ts` and use Playwright's own `test`, spending two more attempts.

**Corollary:** the suite navigates through the app's own links rather than `page.goto`. Every full document load re-runs the auth bootstrap, and `refreshLimiter` is 60/hour/IP — a suite that `goto`s ten times per test exhausts it and appears to be signed out.

---

## Contract corrections found by running against the live API

Three client assumptions were wrong. All three were caught by probing the running backend, not by reading the docs, and each would have printed a raw identifier or a false claim at a farmer.

| Assumption | Reality | Where it would have shown |
|---|---|---|
| `recommendations.type` is snake_cased | It is **hyphenated** (`weather-risk`) | Per-type deep links silently dead |
| `irrigation.verdict` is always a verdict | **Null** when the engine declined (a crop not yet sown) | `t('irrigation.titlenull')` → raw key on screen |
| `market.signal.trend` is always a trend | **Null** with no observations | `t('market.titlenull')`, or worse, "prices are steady" — a claim with no data behind it |

`freshness` also turned out to be three shapes, not one: weather carries `fetchedAt`/`ageHours`/`staleWarning`, its pending branch carries `retryAfterSeconds`/`reason`, and market carries `latestDate`/`ageDays`. `FreshnessDot` now prefers the **server's** `staleWarning` over its own arithmetic, because the server owns that threshold.

## Two client bugs the tests found

- **The bootstrap hung forever under StrictMode.** An "already bootstrapped" ref plus a per-run `cancelled` flag meant the double mount cancelled the only in-flight refresh and then declined to start another; every route sat on "Checking your session…". De-duplication belongs in `refreshSession()`, which is already single-flight. Found by Playwright — the RTL harness does not wrap in StrictMode — and now covered by a StrictMode regression test.
- **A failed refresh left the dead access token in memory.** `refreshSession()` now clears it, so the next request goes out unauthenticated rather than with a bearer token the server has already refused.

## Not done, deliberately

- **No `i18next/no-literal-string` ESLint plugin.** `scripts/check-ui-strings.mjs` implements the rule in ~100 lines against a locked dependency list. It currently reports zero violations.
- **No axe-core or Lighthouse run.** Both are Day-3 items in `docs/testing/frontend-testing.md` and neither has been run, so no accessibility or performance score is claimed. The structural work those audits check — landmarks, labelled inputs, focus management on route change, 44px targets, `prefers-reduced-motion`, icon+text for every ranked signal — is in place and partly covered by RTL.
- **No visual review.** `MASTER-TODO` marks the charts row "✔ visual review"; no human has looked at these screens, and the Chrome extension was unavailable in this environment. The Playwright run exercises them at desktop and mobile viewports, which is not the same thing.
- **`StatePicker`/`DistrictPicker` are free-text inputs.** `component-map.md` asks for pickers, but `shared/constants/geo` is deliberately empty and `farms.js` says so explicitly: "an invented list would be worse than a late one, so the closed enum arrives with the data."
