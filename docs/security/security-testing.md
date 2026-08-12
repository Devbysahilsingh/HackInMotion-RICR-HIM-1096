# Security Testing Plan

Tooling (realistically runnable in-hackathon): Jest+Supertest suites (automated, in CI mindset), Gitleaks (pre-commit + history), npm audit/pip-audit, Postman collection for manual probes, OWASP ZAP baseline scan (Day 3 if time — nice-to-have, not gating).

## Suites (blocking = must pass before deploy)
- **ST-01..05 Auth [blocking]:** brute-force lockout behavior; enumeration uniformity (message+status parity); token-in-memory only (no localStorage writes — web test); refresh rotation + reuse → family revocation; JWT tamper/expiry/alg-none/audience suite.
- **ST-10 Authorization matrix [blocking]:** generated per protected endpoint — 401 (no token), 404 (other-user resource), list scoping, nested-chain checks (crop of other's farm).
- **ST-20 Privacy [blocking]:** community payload serialization contains no user-identifying fields; health log of user A unreachable by B via every route incl. image URLs endpoint; consent-off users absent from aggregation input.
- **ST-30 Upload [blocking]:** polyglot JPEG+ZIP, PNG decompression bomb, 9MB oversize, exe-renamed-jpg, corrupt JPEG, EXIF-GPS stripped in output, HEIC conversion, rate-limit trip.
- **ST-40 Injection:** $-operator payloads in every string field (sanitizer), instruction-injection in health description (guidance unchanged fixture), XSS payload round-trip (stored text is escaped on render — RTL test).
- **ST-50 API hygiene:** stack-trace absence on forced 500; unknown route envelope; CORS reject foreign origin; rate-limit headers; oversized JSON body 413.
- **ST-60 Services:** ml-service /predict without key → 401; with wrong key → 401 + audit; Gemini key absent from all client bundles (grep dist/APK); kill-switch flags degrade without auth impact.
- **ST-70 Secrets:** Gitleaks clean on full history; .env absent from git; log-redaction spot checks.

Schedule: ST suites written alongside features (security DoD), full run Day 2 night + Day 3 pre-deploy + post-deploy smoke against production URLs (read-only subset).
