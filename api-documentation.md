# API documentation — Khetri (HIM-1096)

Consolidated reference for the `/api/v1` contract. Every row below is transcribed
from `backend/src/routes/` and from `backend/src/routes/ownership-table.js`, which
a test asserts against the live Express router — so this document cannot drift
from the mounted routes without that test failing.

Per-resource detail (field-level request/response shapes, engine semantics) lives
in `docs/api/`. This file is the single-page index the submission asks for.

- **Base URL (local):** `http://localhost:4000/api/v1`
- **Content type:** `application/json` except the two multipart upload routes
- **Auth:** `Authorization: Bearer <accessToken>` on every route marked *required*

---

## 1. Response envelope

Every response — success or failure — uses one envelope. Nothing else is ever
returned.

```jsonc
// success
{ "success": true, "data": { /* … */ }, "meta": { "page": 1, "limit": 20, "total": 42 } }

// failure
{
  "success": false,
  "error": { "code": "VALIDATION_ERROR", "messageKey": "errors.validation", "details": [] },
  "meta": { "requestId": "8f3c…" }
}
```

`messageKey` is an i18n key, never prose. The API returns **no display text in any
language** — the client resolves the key against `shared/i18n/{en,hi}`. A backend
test scans the source for emitted keys and fails if any is missing from either
language, which is what keeps this guarantee true.

### Error codes

The complete closed set (`docs/api/error-codes.md`). No route may invent one.

| Code | HTTP | Meaning |
|---|---|---|
| `VALIDATION_ERROR` | 422 | Body/query failed its Zod schema |
| `AUTHENTICATION_ERROR` | 401 | Missing, malformed or expired access token |
| `AUTHORIZATION_ERROR` | 403 | Authenticated but not permitted |
| `NOT_FOUND` | 404 | Absent **or** owned by someone else (see §2) |
| `CONFLICT` | 409 | Duplicate, or a per-account ceiling reached |
| `PAYLOAD_TOO_LARGE` | 413 | Body over the route's cap |
| `RATE_LIMITED` | 429 | Per-user or per-IP limiter tripped |
| `EXTERNAL_SERVICE_ERROR` | 502 | An upstream provider failed |
| `AI_ERROR` / `ML_ERROR` | 502 | A model tier failed and no fallback answered |
| `UPLOAD_ERROR` | 422 | Image rejected by the upload pipeline |
| `DATABASE_ERROR` | 500 | Persistence failure |
| `NOT_IMPLEMENTED` | 501 | Reserved |
| `INTERNAL_ERROR` | 500 | Unclassified; `requestId` correlates the log |

---

## 2. Authentication and ownership

**Tokens.** `POST /auth/login` returns a short-lived access token and a refresh
token. The web client receives the refresh token as an httpOnly, path-scoped
cookie; the Android client receives it in the body and stores it in
`expo-secure-store`. Refresh rotates the family and **detects reuse**: presenting
a rotated token invalidates the whole family and writes a `token_reuse` audit
event.

**Ownership is a query filter, never a post-filter.** Every owned document
carries `userId`, and reads apply it inside the database query. A farm belonging
to another account therefore returns **404, not 403** — the API never confirms
that a resource it will not serve exists (invariant AU-2).

Four ownership shapes appear in the table below:

| Shape | Meaning |
|---|---|
| `none` | No owned resource in play (public data, or the caller's own token) |
| `scoped` | List filtered by `userId` in the query |
| `direct` | Path param resolved through `loadOwned` against `{_id, userId}` |
| `nested` | Crop resolved by `userId` **and** its parent farm re-verified (AU-3) |

---

## 3. Endpoints

### Auth — `/auth`

| Method | Path | Auth | Ownership | Notes |
|---|---|---|---|---|
| POST | `/auth/register` | public | none | Creates the account, returns a session |
| POST | `/auth/login` | public | none | Rate-limited per IP and per account |
| POST | `/auth/refresh` | public | none | Rotates the family; reuse invalidates it |
| POST | `/auth/logout` | required | none | Revokes the presented refresh family |
| GET | `/auth/me` | required | none | The signed-in user |

### Users — `/users`

| Method | Path | Auth | Ownership | Notes |
|---|---|---|---|---|
| PATCH | `/users/me` | required | none | Preferences only — `language`, `units.land`, `voiceEnabled`, `communityConsent`. Strict schema: `name`/`email`/`passwordHash` are **rejected**, not stripped |

### Farms — `/farms`

| Method | Path | Auth | Ownership | Notes |
|---|---|---|---|---|
| GET | `/farms` | required | scoped | List projection, carries `cropCount` |
| POST | `/farms` | required | none | Max 10 farms per account (409 past it) |
| GET | `/farms/:id` | required | direct | Farm **and** its crops with derived stages |
| PATCH | `/farms/:id` | required | direct | Size may not drop below allocated crop area |
| DELETE | `/farms/:id` | required | direct | Cascades crops, logs, ledger, recommendations |
| POST | `/farms/:id/photo` | required | direct | multipart `image`; replaces and destroys the old asset |
| DELETE | `/farms/:id/photo` | required | direct | 204; idempotent |
| GET | `/farms/:id/weather` | required | direct | DB-only read of the ingested snapshot + crop risks |
| GET | `/farms/:id/recommendations` | required | direct | **What to plant** — see §4 |
| GET | `/farms/:id/recommendations/:cropCode` | required | direct | One crop out of the *same* ranking |

### Crops — `/farms/:farmId/crops` and `/crops`

| Method | Path | Auth | Ownership | Notes |
|---|---|---|---|---|
| GET | `/farms/:farmId/crops` | required | nested | Crops on one farm |
| POST | `/farms/:farmId/crops` | required | nested | Land ledger enforced: crop area ≤ farm's free area |
| GET | `/crops/:id` | required | nested | Crop + registry entry + derived stage |
| PATCH | `/crops/:id` | required | nested | `status`, `variety`, `areaValue` only |
| DELETE | `/crops/:id` | required | nested | |
| POST | `/crops/:id/photo` | required | nested | multipart `image` |
| DELETE | `/crops/:id/photo` | required | nested | 204 |
| GET | `/crops/:id/irrigation` | required | nested | FAO-56 verdict — see §4 |
| GET | `/crops/:id/irrigation-log` | required | nested | Paginated watering ledger |
| POST | `/crops/:id/irrigation-log` | required | nested | Omitting `amountMm` means "refilled fully" (rule R8). Optional `clientRequestId` makes the write idempotent for the offline queue — a replay returns **200 + `replayed: true`** with the original row instead of **201**. See §4b |
| GET | `/crops/:id/fertilizer-guidance` | required | nested | Sourced schedule; never an AI-authored dose |

### Crop health — `/crop-health`

| Method | Path | Auth | Ownership | Notes |
|---|---|---|---|---|
| POST | `/crop-health/analyze` | required | direct | multipart `image` + `cropId`. 10/day + 3/min. See §4 |
| GET | `/crop-health/logs` | required | scoped | Filters: `cropId`, `farmId`, `page`, `limit` |
| GET | `/crop-health/logs/:id` | required | direct | Full analysis + guidance |
| POST | `/crop-health/logs/:id/severity` | required | direct | Two follow-up answers, re-run through the same severity engine |
| POST | `/crop-health/symptom-check` | required | direct | No-photo guided assessment |

### Weather, market, registry, community

| Method | Path | Auth | Ownership | Notes |
|---|---|---|---|---|
| GET | `/market/prices` | required | none | One commodity's series + signal; ≤90-day window |
| GET | `/market/my-crops` | required | scoped | A signal per active crop the caller grows |
| GET | `/market/nearby` | required | direct | Farm-first: mandis with their whole basket + per-commodity rollup |
| GET | `/registry/crops` | **public** | none | The sourced crop registry; `?code=` for one entry |
| GET | `/community/alerts` | required | none | District-aggregated outbreak advisories. **No write API** |

### Dashboard and recommendations feed

| Method | Path | Auth | Ownership | Notes |
|---|---|---|---|---|
| GET | `/dashboard` | required | scoped | **One aggregation, zero external calls** — feed, crop cards, farm summary, system status |
| GET | `/recommendations` | required | scoped | Paginated decision history |
| POST | `/recommendations/:id/ack` | required | direct | 204; idempotent |
| POST | `/crop-recommendation` | required | direct | Season wizard (farm + season in the body) — see §4 |

### Operational

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/healthz` | public | Liveness; no database round-trip |

---

## 4. The four decision engines

Every engine is a **pure function** (`backend/src/engines/`) that imports nothing
above `utils/` and `constants/`. Each returns a `trace` — the numbers behind the
verdict — so a client can show its working (requirement R12).

### Irrigation — `GET /crops/:id/irrigation`

FAO-56 soil-water balance. Reference evapotranspiration × crop coefficient for
the derived growth stage, against the soil's available water and the crop's
root depth, replayed over the logged waterings and projected across the forecast.

Returns one of `IRRIGATE_TODAY`, `IRRIGATE_IN_N_DAYS`, `WAIT_RAIN_EXPECTED`,
`NO_IRRIGATION_NEEDED`, `MAINTAIN_WATER_LEVEL` or `UNAVAILABLE` — the last being
a real outcome, not an error. `mode: 'simplified'` flags a forecast with no ET₀,
and `soilUncertaintyWide` flags an unspecified soil. Both are surfaced in the UI.

### Weather risk — inside `GET /farms/:id/weather`

Per-crop, per-day risk assessment against the registry's published crop
sensitivities. `thresholdSource` distinguishes a **crop-specific published
threshold** from an **engine default** — the UI states which, because "onion is
heat-stressed above this" and "we used a generic band" are different claims.

### Crop health — `POST /crop-health/analyze`

A tiered conductor, not a single model:

```
sanitize (magic bytes, bomb guards, decode/re-encode → EXIF stripped)
  → cache lookup (userId + cropId + imageHash — never global)
  → store (Cloudinary, server-chosen id)
  → tier walk:  local ONNX model  →  Gemini Vision  →  OpenRouter  →  symptom rules
  → confidence gating + severity engine + knowledge-base guidance
```

`escalationPath` records every tier that declined and why. **The model never
authors advice**: it produces a disease code and a confidence, and the farmer-
facing text comes from the sourced TNAU/ICAR knowledge base by i18n key. An
uncertain result stays uncertain — it is never forced into a prediction.

### What to plant — `GET /farms/:id/recommendations`

Pipeline: **FarmContext → SeasonResolver → LandAvailability → MarketEligibility →
scoring engine**.

- Season is resolved from the calendar (`basis: 'CALENDAR_MONTH'`), overridable by `?season=`.
- **Market availability is a hard eligibility gate.** A crop no reachable mandi has priced is excluded with a stated reason rather than ranked with an empty market column.
- Scoring uses the four documented weights — season 0.30, soil 0.25, water 0.30, temp 0.15 — and **a factor with no evidence is dropped, never guessed at**. `evidenceRatio` reports how much of the weight was actually backed by data.
- `GET …/:cropCode` re-runs the identical pipeline and *selects* a crop from its result, so a card and the page it opens cannot disagree about the score.

---

## 4b. Offline write-sync — `clientRequestId`

The one write a farmer makes with no signal is a watering. Both clients queue
it locally and replay it on reconnect, which is only safe because the server can
tell a *re-delivery* from a *second event*.

**Request.** `POST /crops/:id/irrigation-log` accepts an optional
`clientRequestId`: 8–64 characters, `[A-Za-z0-9-]` only (a UUIDv4 is 36).
Anything else is a `422 VALIDATION_ERROR` — it is client-supplied text that
reaches an index, so it is bounded before it gets there.

| Case | Status | `replayed` | Rows written |
|---|---|---|---|
| First delivery | `201` | `false` | 1 |
| Same `clientRequestId` again | `200` | `true` | 0 — the original row is returned |
| Different id, same day | `201` | `false` | 1 — a genuine second watering |
| No id (ordinary online write) | `201` | `false` | 1 — unchanged behaviour |

**The id identifies a submission, never a day.** A farmer can genuinely irrigate
twice in one day, so `(cropId, date)` remains deliberately non-unique;
collapsing on it would under-count applied water, which is the more dangerous
error.

**Scoped per account.** Uniqueness is `(userId, clientRequestId)`, so the same
id from another account is a separate submission — a guessed id can neither
collide with nor probe for someone else's ledger.

**Enforced twice, on purpose.** A unique *partial* index is the race-proof
authority (two concurrent flushes both pass any read-then-write check), and a
lookup runs first so the guarantee still holds on a database where
`npm run indexes:build` has not been run. The index is partial so the many rows
written online with no id are not indexed at all.

---

## 5. Honesty contract

Two response fields exist purely so a client cannot present a guess as a
measurement, and both are mandatory on data-bearing responses.

**`freshness`** — `live` (inside TTL) · `cached` (last known good) · `historical`
(archived, not current) · `pending` (never fetched). Market responses carry
`latestDate` + `ageDays` instead of `fetchedAt`, because what matters is how old
the newest *price* is.

**`trace`** — the engine's own steps and figures. Never prose, never a model's
internal reasoning.

Request paths **never call an external provider**. Weather and mandi data are
ingested by scheduled jobs using validate-then-cache; a failed fetch never
overwrites the last known good value. A farm whose grid cell has never been
fetched returns `status: 'pending'` with a retry hint — a designed state, not a
500.

---

## 6. Rate limits

Per-user where a user exists, per-IP otherwise (`backend/src/middleware/rateLimits.js`).

| Surface | Limit |
|---|---|
| Login | per-IP + per-account, with lockout |
| `POST /crop-health/analyze` | 10/day **and** 3/min |
| `POST /crop-health/symptom-check` | 30/day |
| `POST /crop-recommendation` | 20/day |
| Farm/crop writes | 60/h |
| `PATCH /users/me` | 30/h |
| Photo uploads | separate, tighter bucket |

The limiter runs **before** the multipart parser on upload routes, so a
rate-limited caller is refused before a byte is buffered.

---

## 7. Uploads

Two routes accept multipart, both with the field name fixed to `image`
(`docs/security/image-upload-security.md`):

1. Multer memory storage — no temp file, no filename derived from user input, 8 MB hard cap, one file, bounded part count.
2. Magic-byte sniff on the **bytes**, never the declared MIME type.
3. Decompression-bomb guards on the declared dimensions.
4. Full decode and re-encode — which strips EXIF, including GPS, and defeats polyglots.
5. Upload to Cloudinary with a server-chosen public id.

A rejection returns `UPLOAD_ERROR` with a coarse reason class — enough for an
honest user to fix, not enough to tell a hostile one which guard they tripped.
