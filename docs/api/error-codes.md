# API Conventions & Error Codes

## Conventions (apply to every endpoint; endpoint docs only state deltas)
- Base path `/api/v1`. JSON only (multipart for uploads). UTF-8.
- **Envelope:** success `{ "success": true, "data": {...}, "meta"?: {...} }` · error `{ "success": false, "error": { "code", "messageKey", "details"?: [...] } }`. `messageKey` is an i18n key rendered client-side — the API never returns display language text.
- **Auth:** `Authorization: Bearer <access JWT>` unless marked Public. 401 = missing/invalid/expired token; ownership failures return **404** (existence not disclosed).
- **Validation:** Zod per endpoint (docs/database/validation.md); failures → 422 `VALIDATION_ERROR` with `details: [{field, rule}]`.
- **Rate limits:** global 300 req/15min/IP; stricter buckets noted per endpoint. Exceeded → 429 `RATE_LIMITED` + `Retry-After`.
- **Pagination:** `?page=1&limit=20` (max 50) → `meta: {page, limit, total}`.
- **Freshness:** data derived from external sources includes `meta.freshness: { source, fetchedAt, status: 'live'|'cached'|'historical' }`.
- **Roles:** single role (farmer). No admin role exists (no admin surface in product).
- **Versioning:** breaking changes → `/api/v2` (not expected in hackathon).

## Canonical error codes → HTTP
| Code | HTTP | Meaning / notes |
|---|---|---|
| VALIDATION_ERROR | 422 | Input failed schema; details listed |
| AUTHENTICATION_ERROR | 401 | Bad credentials / bad-expired token (message generic — no enumeration) |
| AUTHORIZATION_ERROR | 403 | Authenticated but action forbidden (rare; ownership uses 404) |
| NOT_FOUND | 404 | Missing OR not owned |
| CONFLICT | 409 | Duplicate (e.g., email registered — same generic messageKey as validation to avoid enumeration on register: see auth doc) |
| RATE_LIMITED | 429 | Bucket exceeded |
| EXTERNAL_SERVICE_ERROR | 503 | All fallbacks exhausted AND no cache (rare by design) |
| AI_ERROR | 502 | Gemini/OpenRouter failure after retries (health flow degrades to rules instead of surfacing this where possible) |
| ML_ERROR | 502 | ml-service failure (flow degrades to Gemini/rules; surfaced only if terminal) |
| UPLOAD_ERROR | 400 | File failed validation pipeline; messageKey specifies reason class |
| DATABASE_ERROR | 500 | Persistence failure (generic to client, detailed in server logs) |
| INTERNAL_ERROR | 500 | Unhandled (logged with correlation id `meta.requestId`) |

Never in any response: stack traces, driver errors, file paths, connection strings, keys, internal hostnames. Every response carries `X-Request-Id` for log correlation.
