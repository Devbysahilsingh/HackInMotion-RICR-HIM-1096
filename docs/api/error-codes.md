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
| PAYLOAD_TOO_LARGE | 413 | Request body exceeded the 100KB JSON limit. Added in P1-1: ST-50 asserts a 413 here, and without a mapped code the body-parser error surfaced as a 500 |
| RATE_LIMITED | 429 | Bucket exceeded |
| EXTERNAL_SERVICE_ERROR | 503 | All fallbacks exhausted AND no cache (rare by design) |
| AI_ERROR | 502 | Gemini/OpenRouter failure after retries (health flow degrades to rules instead of surfacing this where possible) |
| ML_ERROR | 502 | ml-service failure (flow degrades to Gemini/rules; surfaced only if terminal) |
| UPLOAD_ERROR | 400 | File failed the upload pipeline; messageKey specifies the reason class. **Always carries `details: [{field, rule}]`** — `field` is the multipart field (`image`) and `rule` is the reason class, matching the `{field, rule}` shape `VALIDATION_ERROR` uses. Implemented P3 (`src/middleware/uploadImage.js`) |
| DATABASE_ERROR | 500 | Persistence failure (generic to client, detailed in server logs) |
| NOT_IMPLEMENTED | 501 | Contract reserved but not built (the yield endpoint until P3). Added in P1-1 — `docs/api/intelligence.md` already specified a 501 with no code behind it |
| INTERNAL_ERROR | 500 | Unhandled (logged with correlation id `meta.requestId`) |

### `UPLOAD_ERROR` messageKeys (P3, `src/config/constants.js` → `UPLOAD_REJECTION_KEYS`)

One key per reason class; the class is also the `rule` in `details`. Exhaustiveness over `UPLOAD_REJECTION` is asserted by the ST-30 suite, so a new reason cannot ship without a translation.

| `rule` | `messageKey` |
|---|---|
| NO_FILE | `errors.uploadNoFile` |
| TOO_LARGE | `errors.uploadTooLarge` |
| UNEXPECTED_FIELD | `errors.uploadUnexpectedField` |
| TOO_MANY_FILES | `errors.uploadTooManyFiles` |
| NOT_AN_IMAGE | `errors.uploadNotAnImage` |
| UNSUPPORTED_FORMAT | `errors.uploadUnsupportedFormat` |
| DIMENSIONS_TOO_LARGE | `errors.uploadDimensionsTooLarge` |
| ANIMATED | `errors.uploadAnimated` |
| UNREADABLE | `errors.uploadUnreadable` |
| STORAGE_UNAVAILABLE | `errors.uploadStorageUnavailable` |

One exception to "`rule` is the reason class": the `STORAGE_UNAVAILABLE` response is raised by the route rather than the pipeline, and its `rule` carries the coarse storage kind (`not_configured` \| `timeout` \| `rejected` \| `injected`) so an operator can tell a missing Cloudinary credential from a provider timeout. The messageKey is the same either way — the farmer is told the same thing. Reason classes stay deliberately coarse: an honest user learns what to fix without a hostile one learning which guard fired.

Never in any response: stack traces, driver errors, file paths, connection strings, keys, internal hostnames. Every response carries `X-Request-Id` for log correlation.

**`meta.requestId` is returned in the error envelope** (implemented P1-1): every error response carries `meta: { requestId }` matching the `X-Request-Id` header, so a farmer can quote one id when reporting a problem. It discloses nothing — the id is minted per request.

Malformed JSON (`entity.parse.failed`) maps to 422 `VALIDATION_ERROR`, and an unsupported charset/encoding likewise; neither may reach the generic 500 branch.
