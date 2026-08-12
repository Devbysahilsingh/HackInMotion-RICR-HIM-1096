# Authorization Design

Model: single role (farmer). No admin role/routes exist — administration = reviewed seed/maintenance scripts run by developers with their own credentials.

## Invariants
- **AU-1:** every user-owned document carries `userId`; every read/write filters or checks it against `req.user.id` server-side. No endpoint returns another user's farms/crops/images/analyses/recommendations/history/preferences — ever.
- **AU-2:** ownership failure returns **404** (existence non-disclosure), except non-resource actions → 403.
- **AU-3:** nested resources verify the FULL chain (crop → its farm → userId) — not just the leaf.
- **AU-4:** list endpoints are always scoped queries (`{userId}` in filter), never post-filtered.
- **AU-5:** images: Cloudinary URLs are unguessable but access to the LOG carrying them is ownership-checked; publicIds never enumerable via API.
- **AU-6:** community endpoints expose only aggregate documents (schema contains no PII to leak).
- **AU-7:** ml-service trusts only the backend (X-Service-Key); it holds no user concept at all.

## Implementation shape
`requireAuth` (JWT verify) → `loadOwned(model, param)` middleware factory (fetch + chain-check + attach or 404) → handler. Zero handlers query by bare id.

## Tests (blocking, per-endpoint matrix ST-10)
For EVERY protected endpoint: (a) no token → 401; (b) valid token, other user's resource id → 404; (c) tampered/expired token → 401; (d) list scoping (user B's items never appear for A). Matrix auto-derived from the route table so a new route without tests fails CI review checklist.
