# Phase 7 — Security Scorecard (2026-08-14)

A full-repository audit, run in two passes. The first pass was cut short when
five parallel audit agents were terminated by a session API limit; the second
pass — this document's current state — picked up the areas they never reached
and closed them.

Every row below was found by reading code and then proving the behaviour with a
test or a live probe. Every `FIXED` row carries a regression test that fails
against the pre-fix code, and for the three findings where that claim is easy to
doubt it was verified by reverting the fix and watching the test go red.

## Summary

| | |
|---|---|
| Total findings | 15 |
| Critical | 0 |
| High | 3 |
| Medium | 8 |
| Low | 4 |
| **Fixed** | **15** |
| Accepted (documented risk) | 2 (pre-existing) |
| Device-pending | 4 (RES-09..12) |
| Tooling-blocked | 0 |

No unexplained Critical or High finding remains. **OWASP ZAP has now been run**
(0 FAIL / 66 PASS) — it is no longer a blocker.

## Findings

### Pass 1

| # | Area | Finding | Sev | Status | Fix | Regression test |
|---|---|---|---|---|---|---|
| 1 | External AI calls | `fetch` follows up to 20 redirects and strips only `Authorization` on a cross-origin hop, so the custom `x-goog-api-key` header is replayed verbatim to whatever host a `Location` names — handing the provider key to an attacker-chosen host and turning the POST into a GET against link-local metadata (`169.254.169.254`) | **HIGH** | FIXED | `redirect: 'error'` on the Gemini/OpenRouter calls | `tests/integrations/aiVision.test.js` |
| 2 | Logging | `pino-http` logs the whole header bag; `x-api-key` was written to the log stream **in full**. Redaction named only the headers we happen to send ourselves | **HIGH** | FIXED | `x-api-key`, `x-goog-api-key`, `x-auth-token`, `proxy-authorization` added, plus unanchored paths | `st-70-log-redaction.test.js` |
| 3 | Upload pipeline | Multipart bodies were **never** operator-scrubbed. `mongoSanitize` is mounted before route matching and only ever sees what `express.json` parsed; multer interprets bracket syntax, so a part named `cropId[$ne]` arrives as a genuine operator object | **HIGH** | FIXED | `uploadImage` runs `scrubParsed` over the assembled fields | `st-40-injection.test.js` |
| 4 | Query handling | Operator-shaped query keys were **silently stripped**. Several filters are optional, so deleting `state.$ne` leaves a valid request meaning "no state filter" — the probe is answered with *more* data than the caller could ask for, and `.strict()` never sees the key | MEDIUM | FIXED | Query strings **fail closed** with `422` / `rule: operator_key`; the key is not echoed back | `st-40-injection.test.js` |
| 5 | Token verification | `sub` survives verification as whatever JSON type it was signed as, and the next act is a DB lookup keyed on it — `{$ne: null}` matches the first account | MEDIUM | FIXED | `sub` shape-checked against the ObjectId pattern inside `tokenService` | `st-05b-token-forgery.test.js` |
| 6 | ML integration | The response validator used a bare `z.object()`, which **strips** unknown keys and reports success — the silent-ignore the code comment already declared unacceptable | MEDIUM | FIXED | `.strict()`, so a contract mismatch tiers down instead of serving a half-understood answer | `st-60-services.test.js` |
| 7 | ml-service | The request size cap trusted `Content-Length` alone, so a chunked request could exceed it | MEDIUM | FIXED | `BodySizeLimitMiddleware` counts the actual stream | `ml-service/tests/test_predict_api.py` |
| 8 | Market reads | The price series was unbounded | MEDIUM | FIXED | Capped newest-first, then restored to ascending; truncation is reported | `st-51-resource-exhaustion.test.js` |
| 9 | Pagination | `page` had a floor but no ceiling, so a large offset forced an unbounded skip | MEDIUM | FIXED | `PAGE_MAX` / `PAGE_SIZE_MAX` | `st-51-resource-exhaustion.test.js` |
| 10 | Rate limiting | Farm **writes** carried only the global bucket, while each fires a provider warm | LOW | FIXED | Dedicated `farmWriteLimiter` | `st-51-resource-exhaustion.test.js` |
| 11 | Detection | Failed authentication and ownership refusals were logged **nowhere** — the two probes an attacker actually runs were the two the system could not see | LOW | FIXED | `securityEvent()` in the error handler, one structured line per refusal class | `st-50-api-hygiene.test.js` |
| 12 | Audit quality | Rate-limit audit rows recorded `req.path`, relative to the router the limiter is mounted on | LOW | FIXED | Full mount path recorded; query string dropped | `st-50-api-hygiene.test.js` |

### Pass 2 — the completion pass

| # | Area | Finding | Sev | Status | Fix | Regression test |
|---|---|---|---|---|---|---|
| 13 | Outbound HTTP (SSRF) | The redirect fix in #1 was applied to the two call sites that were being read at the time. `utils/httpClient.js` — the shared helper behind **all four** ingestion integrations (Open-Meteo, OWM, Open-Meteo geocoding, data.gov.in) — still followed up to 20 redirects. A hijacked provider, a poisoned DNS answer or a captive portal could point `Location` at `169.254.169.254` or `127.0.0.1:4000`, and the next request would originate from the backend host. Not rated HIGH because no caller passes a credential *header* through this helper (the two keys involved ride in query strings, which a redirect does not carry), so the credential-replay half of #1 does not apply — what remains is the internal-reach half | MEDIUM | FIXED | `redirect: 'error'` in `fetchJson`. The throw is caught as a transport failure and tiers down like any provider fault, so nothing degrades | `st-41-ssrf.test.js` (§41.1 uses two real loopback servers, so it proves the *behaviour*, not the flag) |
| 14 | Mobile · local storage | Logout called `queryClient.clear()`, which empties the in-memory cache and lets the persister rewrite the on-disk copy — **on a 2-second throttle**. Between logout and that write, the previous farmer's dashboard, farms, coordinates, prices and health history remained in AsyncStorage in plain text. A phone handed over or force-closed inside that window keeps them, which is exactly the shared-handset threat the cache is cleared for | MEDIUM | FIXED | `clearPersistedCache()` deletes the key outright; called at all three session-end sites. Swallows storage failure, because logout must always end signed out | `mobile/src/security.test.ts` §2 |
| 15 | Caching | Found by the ZAP baseline. Express attaches a weak `ETag` to every JSON response, and a 200 with a validator but no freshness directive is heuristically cacheable (RFC 9111 §4.2.2). Only the public crop registry set `Cache-Control`; every authenticated route set none. A shared cache is largely blocked by RFC 9111 §3.5 for bearer requests, but the *private* cache is the one that matches this product's threat model: a shared handset or village-kiosk browser where Back re-renders the previous farmer's dashboard from disk with no token involved | LOW | FIXED | `Cache-Control: no-store` on everything under `/api/v1`, set before the routers so `registry.js` can still opt in to its documented 1h cache | `st-50-api-hygiene.test.js` §50.12; re-verified live — ZAP rule 10049 now reports "Non-Storable Content" |

## Coverage gaps closed — where the code was already correct

Stated separately and deliberately. Three of the areas the first pass left open
turned out to contain **no vulnerability**; what was missing was the proof. A
clean result from a test that did not previously exist is a real result, and
recording it as "fixed" would be dishonest in the other direction.

| Area | What was missing | What the sweep found |
|---|---|---|
| **IDOR — body-carried ids** | ST-10 generates its matrix from the ownership table and substitutes ids into **path segments and query strings**. Three POST routes take the id they address in the **body** — `/crop-recommendation` (farmId), `/crop-health/analyze` (cropId, multipart) and `/crop-health/symptom-check` (cropId) — and declared no `param`, so the sweep walked past the three endpoints where an attacker-supplied id *is* the request | All three already resolve ownership through a userId-filtered query and answer an indistinguishable 404. The table now declares `bodyParam` and **ST-11 drives them** (42 tests), including a coverage assertion so a fourth body-id route cannot ship untested |
| **Verb tampering, cross-collection ids, list filters** | The manual "change the id, then change the verb" pass | No route serves an undeclared verb; an id of the wrong kind is never a key to the right kind, even when the caller owns it; a list filtered by another farmer's `cropId` returns an empty list rather than their rows, because the userId scope is in the query and not applied afterwards (AU-4) |
| **`scripts/` command injection** | ST-40 asserted that `backend/src` reaches no shell; `scripts/` was never scanned | One process execution exists: `execFileSync('git', [...])` in `scan-staged-secrets.mjs` — argv form, literal binary, no shell. Now asserted, along with the absence of `exec`/`execSync`/`shell: true`/`eval` across the directory |
| **Upload — markup payloads** | SVG and HTML were covered in effect (neither has magic bytes, so both fail the sniff) but never tested. SVG is the classic stored-XSS carrier | All four variants refused, including a JPEG-signature-prefixed SVG, which fails one step later at the decode. No fragment of the payload is echoed back |
| **CI/CD** | The repository had **no CI configuration at all** — every gate in `docs/testing/strategy.md` was reachable only by a human remembering to run it | `.github/workflows/ci.yml` added: `permissions: contents: read`, `pull_request` (never `pull_request_target`), every third-party action pinned to a full commit SHA, `npm ci` throughout. ✅ **It has now executed.** Its first run failed two jobs, both genuinely: `ml-service tests` on the manifest drift recorded below, and `Backend tests` on ST-60.5, which fails closed when no client bundle exists and had only ever been run on a developer machine where `web/frontend/dist` happened to be present. The workflow now builds the web client before the backend suite. ⚠ ST-60.5 covers the **web bundle only** — `mobile/` has no export script, so the Hermes bundle stays unscanned in CI |

## Verified secure (attacks that failed because the code is correct)

NoSQL operator objects in the login body do not authenticate; ownership failures
return **404, not 403**, on every probed route; `alg=none`, forged-signature,
malformed and wrong-scheme tokens are all refused with one generic 401;
`PATCH /users/me` rejects `role`, `isAdmin`, `passwordHash` and every other
unlisted field; a create body naming another `userId` produces no document for
that user; a crop cannot be re-pointed at another farm; the user projection
never carries `passwordHash` or a refresh token; prototype pollution via
`__proto__`/`constructor.prototype` does not mutate `Object.prototype`;
production error bodies carry no stack frame, filesystem path, Mongo connection
string, driver error text or env var name.

**Mobile:** the refresh token reaches SecureStore and nothing else; the access
token reaches no persistent store; no module outside `api/session.ts` touches
SecureStore; no `console` call anywhere names a credential and only the error
boundary calls `console.error` (the one call the production strip keeps); there
is no `Linking.openURL`, no React Navigation `linking` config behind the
declared `krishisaarthi` scheme, and no WebView; no API host is hard-coded
outside `config/env.ts`; `RECORD_AUDIO` is declined at the plugin *and* blocked;
cleartext HTTP is not re-enabled for release builds.

**ml-service:** service-key comparison is constant-time *including length*
(both sides SHA-256'd first); the container runs as a non-root uid; OpenAPI docs
are disabled outside development; the image carries no secret; the decode path
guards dimensions, pixel count, animation and truncation before materialising
pixels.

## Tool results

| Tool | Scope | Result |
|---|---|---|
| **OWASP ZAP baseline** | `NODE_ENV=production` instance, 8 URLs | **0 FAIL · 66 PASS · 1 informational** |
| `scripts/security-probe.mjs` | Same instance, authenticated | **86 / 86** |
| Gitleaks | Working tree **and** `--all --full-history` (15 commits) | no leaks |
| `npm audit --omit=dev` | backend, web | 0 / 0 |
| `pip-audit` | `requirements.txt`, `requirements-dev.txt` | no known vulnerabilities |
| Bundle scan | Hermes `.hbc` | PASS |

### What the ZAP run does and does not cover

The first invocation was pointed at `/` and reported `0 FAIL` over **two** URLs —
both 404s. That is a vacuous result and is recorded here rather than quoted as a
pass: a JSON API serves no HTML, so ZAP's spider has nothing to crawl, and
baseline mode never acquires a bearer token. The run above targets a real API
endpoint and reaches 8 URLs.

The division of labour is a property of the target, not a workaround: **ZAP
examines the unauthenticated surface** with 66 passive rules (headers,
disclosure, caching, cookie handling, information leaks), and
**`security-probe.mjs` authenticates and probes what lies behind the token**
(IDOR answers, pagination ceilings, mass-assignment refusals, error shapes).
ZAP's *active* injection rules are not run; those are covered by ST-40 against
the code rather than over the wire.

## Accepted risks (pre-existing, not introduced here)

| Risk | Reason | Mitigation | Owner |
|---|---|---|---|
| Mobile `npm audit`: 20 findings (`postcss`, `image-size`, `uuid`) | All reached through Metro / `@expo/config-plugins` — build tooling, not runtime. Verified **absent from the shipped Hermes bundle**. Fixing means moving off the Expo SDK 54 pin, which is load-bearing for the demo handset's Expo Go 54.0.8 | Bundle verified clean; re-check on any SDK move | A |
| `ml-service` manifest test failing | `model-manifest.json` records a `datasetManifest.sha256` that does not match `datasets/manifest.json`. Both unchanged since Phase-4 commit `29543d1` — committed drift, not a regression, and not a security defect | Left for the ML owner: regenerating a model manifest rewrites recorded metrics | ML owner |
| `python:3.12-slim` base image pinned by tag, not digest | A tag is a movable pointer, so a rebuild can pull different bytes. Pinning by digest is correct practice and has a real maintenance cost (every security patch needs a manual digest bump) | The image carries no secret, runs as a non-root uid, and is rebuilt from a pinned `requirements.txt` that `pip-audit` gates | A |

## Device pending — not passed, not claimed

| ID | Scenario | State |
|---|---|---|
| RES-09 | Mobile cold start offline → cached dashboard renders with banners | ⏳ **PENDING — PHYSICAL DEVICE REQUIRED.** Mechanism built and unit-tested (persister, NetInfo online manager, offline-aware `AuthContext` bootstrap); rendering last session's dashboard on a handset with no signal is a device observation |
| RES-10 | Connection drop mid-upload → retry UX, image retained, no orphan log | ⏳ **PENDING — PHYSICAL DEVICE REQUIRED** for the airplane-toggle procedure. The client half (same bytes re-sent on retry) is asserted in `hooks/useAnalyze.test.ts`; the orphan-log half is a backend property already covered |
| RES-11 | Token expiry offline → read-only cached mode, no wipe | ⏳ **PENDING — PHYSICAL DEVICE REQUIRED.** Both guards are code-verified and one is unit-tested. Known residual, unchanged: a captive portal answers with an HTTP response and is indistinguishable from a refusal |
| RES-12 | Recovery → labels flip to ● Live, no stuck state | ⏳ **PENDING — PHYSICAL DEVICE REQUIRED.** `refetchOnReconnect` is on and the online manager is unit-tested; "no stuck state" is a claim about the UI after a real reconnect |

## Not verified

| Item | Why | Owner |
|---|---|---|
| A fully green CI pipeline | The workflow has now run. Five jobs pass; the two that failed were fixed at the root (client build for ST-60.5, dataset-hash drift for the manifest check) and both were reproduced and re-run green in a clean checkout of the pushed commit. The *corrected* pipeline has not yet been observed green on GitHub's own runners, so that is not claimed | A |
| ST-60.5 against the mobile bundle | CI builds `web/frontend/dist` only. `mobile/` exposes no export script, so `mobile/dist` is never produced and the Hermes bundle is not grepped for provider keys. `scripts/scan-apk-strings.mjs` exists for this and needs an `expo export` step to feed it | A |
| RES-04..06 live procedure | Toggling `FORCE_FAIL_ML` / `_GEMINI` / `_OPENROUTER` against a running deployment and watching the UI. Needs a deployed ml-service and provider credentials; all four are unset. The *behaviour* is covered by the 8-combination tier-router matrix | A |
| Hindi agronomic strings | 568/1152 human-verified; the disease KB is 0/408. A key-set parity check proves both languages have every key and proves nothing about correctness | Human reviewer |

## How to re-run the gates

```bash
npm run lint && npm run format:check && npm run check:i18n && npm run check:ui-strings
# ST-60.5 greps the built client bundle and fails closed if there is none, so
# the web build is a prerequisite of the backend suite on a clean checkout.
npm --prefix web/frontend ci && npm --prefix web/frontend exec vite build
npm --prefix backend test          # 1505
npm --prefix web/frontend test     # 131
npm --prefix mobile test           # 110
cd ml-service && ./.venv/Scripts/python -m pytest   # 144

gitleaks detect --no-banner --redact --log-opts="--all --full-history"
npm --prefix backend audit --omit=dev
cd ml-service && ./.venv/Scripts/python -m pip_audit -r requirements.txt

# Dynamic checks — never point these at production data.
# Start a production-mode instance first:
#   cd backend && NODE_ENV=production PORT=4100 node --env-file=.env src/server.js
DEMO_EMAIL=... DEMO_PASSWORD=... node scripts/security-probe.mjs http://127.0.0.1:4100

docker run --rm -v "$(pwd -W)/reports:/zap/wrk:rw" -t ghcr.io/zaproxy/zaproxy:stable \
  zap-baseline.py -t http://host.docker.internal:4100/api/v1/registry/crops \
  -r zap-report.html -J zap-report.json -I

node scripts/scan-apk-strings.mjs --bundle mobile/dist/_expo/static/js/android/*.hbc
```
