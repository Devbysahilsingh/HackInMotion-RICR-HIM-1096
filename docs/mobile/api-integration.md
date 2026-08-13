# Mobile API Integration

Same `/api/v1` contract as web — no mobile-specific endpoints. Client policies:
- **Auth:** access token in JS memory; 401 → single-flight refresh (SecureStore refresh token, sent in the request **body** — no cookies on native) → one replay; refresh *refused* → AuthStack. Logout wipes SecureStore.
- **Timeouts/retry:** 15s default, 45s upload; GET retries ×2 (backoff) on retryable errors, mutations never auto-retry (duplication guard).
- **Pagination:** infinite-scroll via Query `useInfiniteQuery` (health history); the other paged endpoints take explicit page params.
- **Upload:** multipart with progress events; compress first (≤1600px/q85 via expo-image-manipulator); failed upload → the same compressed file is retained in the screen and offered for retry.
- **Freshness/offline:** persisted Query cache; NetInfo offline ⇒ serve cache + ● Cached badges + disabled writes with explanation; reconnect ⇒ refetch active queries.
- **Versioning:** base URL env-configured; /api/v1 pinned; server messageKeys decouple copy from app releases (i18n resources ship in-app; new keys→fallback en handled).

## As built (Phase 6)

### One axios instance — `mobile/src/api/client.ts`

Structurally the same as `web/frontend/src/api/client.ts`: bearer header, correlation id, single-flight refresh-on-401, one replay, every failure normalised to `ApiError`. Two things genuinely differ, and both come from the platform rather than from taste:

1. **No cookies.** The web keeps the refresh token in a path-scoped httpOnly cookie. React Native has no such thing, so the token is read out of SecureStore and sent in the request body — a shape `backend/src/routes/auth.js` supports on every route that takes one. The server contract did not change to accommodate the phone.
2. **The rotated token has to be stored.** A browser is handed the successor by `Set-Cookie` and files it itself. Here `/auth/refresh` returns the next refresh token in its body, and dropping it would log the farmer out at the following rotation. It is written to SecureStore **before** the new access token is published, so a failed write fails the refresh rather than handing out a session whose successor has already been consumed server-side.

**Correlation id.** Every request carries `X-Request-Id`. `crypto.randomUUID` is not guaranteed on Hermes, so there is a real fallback (`mob-<base36 time>-<random>`) — a farmer-reported failure can be found in the server log without asking them to read a stack trace.

**Error normalisation.** `toApiError` maps: a documented error envelope → its `code`/`messageKey`/`details` plus `retryAfterSeconds` parsed from the `Retry-After` header; `ECONNABORTED`/`ETIMEDOUT` → `TIMEOUT`; `ERR_CANCELED` → `CANCELLED`; no response at all → `NETWORK_ERROR`; a status with no recognisable envelope (an HTML 502 from a proxy) → `INTERNAL_ERROR`. `unwrap()` raises rather than handing a screen `undefined` when the body is not the documented envelope.

`Retry-After` is read only in the whole-seconds form `middleware/rateLimits.js` actually emits. The HTTP-date form is legal and unparsed on purpose: guessing at clock skew would produce a worse number than showing none.

### Shared modules, not a second transcription

The client reads its contract from `shared/`, which is the same copy the web reads:

| Module | What mobile takes from it |
|---|---|
| `@shared/types/api` | every wire type and enum |
| `@shared/client/errors` | `ApiError`, `isApiError`, `isApiErrorBody`, `isRetryable`, `retryAfterSeconds` |
| `@shared/client/queryKeys` | `queryKeys` registry + `STALE_TIME` |
| `@shared/client/units` | acre-equivalent land ledger (crop area ≤ farm area) |
| `@shared/client/format` | Intl date/number/currency formatting |

Metro reaches them through `watchFolders: ['../shared']` plus an `@shared` alias in `resolver.extraNodeModules`; `tsconfig.json` and `jest.config.js` declare the same alias. `disableHierarchicalLookup` is deliberately **not** set — see architecture.md.

### Endpoint surface — `mobile/src/api/endpoints.ts`

| Group | Calls |
|---|---|
| `authApi` | `POST /auth/register` · `POST /auth/login` · `POST /auth/refresh` (via `client.ts`) · `POST /auth/logout` · `GET /auth/me` |
| `usersApi` | `PATCH /users/me` — language, `units.land`, `voiceEnabled`, `communityConsent` |
| `farmsApi` | `GET/POST /farms` · `GET/PATCH/DELETE /farms/:id` · `GET /farms/:id/weather` |
| `cropsApi` | `GET/POST /farms/:id/crops` · `GET/PATCH/DELETE /crops/:id` · `GET /crops/:id/irrigation` · `POST/GET /crops/:id/irrigation-log` · `GET /crops/:id/fertilizer-guidance` |
| `dashboardApi` | `GET /dashboard` |
| `recommendationsApi` | `GET /recommendations` · `POST /recommendations/:id/ack` |
| `cropRecApi` | `POST /crop-recommendation` |
| `marketApi` | `GET /market/prices` · `GET /market/my-crops` · `GET /market/nearby` |
| `registryApi` | `GET /registry/crops` (list and `?code=`) |
| `healthApi` | `POST /crop-health/analyze` (multipart, 45s, progress, abort signal) · `GET /crop-health/logs` · `GET /crop-health/logs/:id` · `POST /crop-health/logs/:id/severity` · `POST /crop-health/symptom-check` |
| `communityApi` | `GET /community/alerts` |

**`PATCH /users/me` is new server surface built for this client** (`backend/src/routes/users.js`, `docs/api/users.md`, ownership row `none³`, rate limit 30/h/user). Before it, `setCommunityConsent` existed in `communityService` with no route in front of it, so community sharing was unreachable from any client and the web settings page showed the flag read-only. See the Phase 6 entry in `docs/development/implementation-log.md`.

## Deliberately not built

- **No idempotency key on upload.** The earlier plan named "idempotency uuid per attempt (server dedupe field reserved P3)". The server implements de-duplication differently — a `(userId, cropId, imageHash)` cache over the re-encoded bytes that answers **200** on a hit (ADR-024 §3–4) — so a client-generated key would be a second, weaker mechanism for the same job. The client sends none.
- **No client-side retry of the analyze call.** It is rate-limited 3/min and 10/day; an automatic retry spends the farmer's budget on their behalf.
