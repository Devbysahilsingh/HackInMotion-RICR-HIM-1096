# Error Handling Standard

## Backend
Typed `AppError(code, httpStatus, messageKey, details?)`; central handler maps AppError→envelope, unknown→INTERNAL_ERROR (logged full with requestId; client gets generic). Async wrapper on all handlers (no unhandled rejections). Canonical codes: docs/api/error-codes.md. External failures: integrations throw typed ServiceError → services decide (fallback/tier-down/designed degraded state) — EXTERNAL_SERVICE_ERROR reaches clients only when every option is exhausted (rare by design).
## ml-service
Pydantic 422s; typed error body mirror {code, message}; never tracebacks (custom exception handlers).
## Clients (web+mobile)
Single api-error normalizer → {code, messageKey, details} → localized via `errors` namespace; per-situation rendering: field errors inline, auth→session flow, RATE_LIMITED→retry-after countdown, offline→cached-content path, everything else→ErrorState with retry. **No blank screens rule:** QueryBoundary guarantees a designed state for every query outcome; global boundaries catch render crashes with localized recovery screen.
## Specific mandated cases (problem statement §9 + master list)
missing weather/location → pending state + guidance; unsupported crop → honest support-level notice; failed upload → reason-classed retry; low ML confidence → designed uncertain outcome; API/Gemini/ML failure → tier-down invisibly or labeled cached; DB failure → honest generic 500; network failure → offline banners + cache; missing soil → degraded advice + prompt. Each has a test row (test-matrix.md).
