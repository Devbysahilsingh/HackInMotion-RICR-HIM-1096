/**
 * The route ownership table.
 *
 * This is the artifact ST-10 derives its matrix from: adding a protected route
 * without adding a row here makes the authorization suite fail, which is the
 * point — a new endpoint cannot quietly ship without ownership coverage
 * (docs/security/authorization.md: "Matrix auto-derived from the route table").
 *
 * Fields:
 *   method, path      as mounted, with :params
 *   auth              'required' | 'public'
 *   resource          which seeded fixture supplies the addressable id
 *   ownership         'direct'  — the addressed document carries userId
 *                     'nested'  — the full parent chain is verified (AU-3)
 *                     'scoped'  — a list, filtered by userId in the query
 *                     'none'    — reference data, owned by nobody
 *   param             the path parameter carrying the id, when there is one
 *   queryParam        the query-string parameter carrying the id, for routes
 *                     that address an owned document without a path segment.
 *                     Such a route is every bit as addressable as a `:param`
 *                     one — the id is simply somewhere else — so the matrix
 *                     substitutes it the same way and demands the same 404.
 *   bodyParam         the request-body field carrying the id, same principle
 *                     again. Added in Phase 7: three POST routes take the id
 *                     they address in the body, and because they declared no
 *                     `param` or `queryParam` the ST-10 matrix had nothing to
 *                     substitute — so the three endpoints where an
 *                     attacker-supplied id is the *whole* attack were the
 *                     three the sweep skipped. ST-11 drives these.
 *   bodySample        the rest of a valid body for such a route, so it is
 *                     refused on ownership rather than on validation.
 *   multipart         true when the body is multipart rather than JSON.
 */
export const ROUTE_OWNERSHIP = [
  // ── Auth ───────────────────────────────────────────────────────────────────
  { method: 'POST', path: '/api/v1/auth/register', auth: 'public', ownership: 'none' },
  { method: 'POST', path: '/api/v1/auth/login', auth: 'public', ownership: 'none' },
  { method: 'POST', path: '/api/v1/auth/refresh', auth: 'public', ownership: 'none' },
  { method: 'POST', path: '/api/v1/auth/logout', auth: 'required', ownership: 'none' },
  { method: 'GET', path: '/api/v1/auth/me', auth: 'required', ownership: 'none' },

  // ── Users ──────────────────────────────────────────────────────────────────
  // `me` is a literal, not an id: the document written is the one the access
  // token resolved to, so there is nothing to own *through* — the row is
  // 'none' for the same reason `GET /auth/me` is, not because a check was
  // skipped. No request shape addresses another account (no `:id` exists).
  { method: 'PATCH', path: '/api/v1/users/me', auth: 'required', ownership: 'none' },

  // ── Farms ──────────────────────────────────────────────────────────────────
  { method: 'GET', path: '/api/v1/farms', auth: 'required', ownership: 'scoped' },
  { method: 'POST', path: '/api/v1/farms', auth: 'required', ownership: 'none' },
  {
    method: 'GET',
    path: '/api/v1/farms/:id',
    auth: 'required',
    ownership: 'direct',
    resource: 'farm',
    param: 'id',
  },
  {
    method: 'PATCH',
    path: '/api/v1/farms/:id',
    auth: 'required',
    ownership: 'direct',
    resource: 'farm',
    param: 'id',
  },
  {
    method: 'DELETE',
    path: '/api/v1/farms/:id',
    auth: 'required',
    ownership: 'direct',
    resource: 'farm',
    param: 'id',
  },

  {
    method: 'GET',
    path: '/api/v1/farms/:id/weather',
    auth: 'required',
    ownership: 'direct',
    resource: 'farm',
    param: 'id',
  },

  // What to plant on this field. Farm-scoped — the ranking depends on the
  // field's soil, water source, standing crops, free land and reachable
  // mandis — so `loadOwned` resolves `:id` before the pipeline runs, exactly
  // as it does for the weather read above.
  {
    method: 'GET',
    path: '/api/v1/farms/:id/recommendations',
    auth: 'required',
    ownership: 'direct',
    resource: 'farm',
    param: 'id',
  },
  {
    method: 'GET',
    path: '/api/v1/farms/:id/recommendations/:cropCode',
    auth: 'required',
    ownership: 'direct',
    resource: 'farm',
    param: 'id',
  },

  // Optional farm profile photo. Same ownership shape as the farm itself —
  // `loadOwned` resolves `:id` before multer ever buffers a byte.
  {
    method: 'POST',
    path: '/api/v1/farms/:id/photo',
    auth: 'required',
    ownership: 'direct',
    resource: 'farm',
    param: 'id',
    multipart: true,
  },
  {
    method: 'DELETE',
    path: '/api/v1/farms/:id/photo',
    auth: 'required',
    ownership: 'direct',
    resource: 'farm',
    param: 'id',
  },

  // ── Crops ──────────────────────────────────────────────────────────────────
  {
    method: 'POST',
    path: '/api/v1/farms/:farmId/crops',
    auth: 'required',
    ownership: 'nested',
    resource: 'farm',
    param: 'farmId',
  },
  {
    method: 'GET',
    path: '/api/v1/farms/:farmId/crops',
    auth: 'required',
    ownership: 'nested',
    resource: 'farm',
    param: 'farmId',
  },
  {
    method: 'GET',
    path: '/api/v1/crops/:id',
    auth: 'required',
    ownership: 'nested',
    resource: 'crop',
    param: 'id',
  },
  {
    method: 'PATCH',
    path: '/api/v1/crops/:id',
    auth: 'required',
    ownership: 'nested',
    resource: 'crop',
    param: 'id',
  },
  {
    method: 'DELETE',
    path: '/api/v1/crops/:id',
    auth: 'required',
    ownership: 'nested',
    resource: 'crop',
    param: 'id',
  },

  // Optional crop profile photo — distinct from a crop-health diagnostic
  // scan. Same nested ownership chain as the crop itself (AU-3: the farm
  // above the crop is verified too).
  {
    method: 'POST',
    path: '/api/v1/crops/:id/photo',
    auth: 'required',
    ownership: 'nested',
    resource: 'crop',
    param: 'id',
    multipart: true,
  },
  {
    method: 'DELETE',
    path: '/api/v1/crops/:id/photo',
    auth: 'required',
    ownership: 'nested',
    resource: 'crop',
    param: 'id',
  },

  // ── Irrigation (crop-scoped, so the full chain is verified) ────────────────
  {
    method: 'GET',
    path: '/api/v1/crops/:id/irrigation',
    auth: 'required',
    ownership: 'nested',
    resource: 'crop',
    param: 'id',
  },
  {
    method: 'POST',
    path: '/api/v1/crops/:id/irrigation-log',
    auth: 'required',
    ownership: 'nested',
    resource: 'crop',
    param: 'id',
  },
  {
    method: 'GET',
    path: '/api/v1/crops/:id/irrigation-log',
    auth: 'required',
    ownership: 'nested',
    resource: 'crop',
    param: 'id',
  },

  // ── Fertilizer ─────────────────────────────────────────────────────────────
  {
    method: 'GET',
    path: '/api/v1/crops/:id/fertilizer-guidance',
    auth: 'required',
    ownership: 'nested',
    resource: 'crop',
    param: 'id',
  },

  // ── Dashboard & feed ───────────────────────────────────────────────────────
  { method: 'GET', path: '/api/v1/dashboard', auth: 'required', ownership: 'scoped' },
  { method: 'GET', path: '/api/v1/recommendations', auth: 'required', ownership: 'scoped' },
  {
    method: 'POST',
    path: '/api/v1/recommendations/:id/ack',
    auth: 'required',
    ownership: 'direct',
    resource: 'recommendation',
    param: 'id',
  },

  // ── Crop recommendation ────────────────────────────────────────────────────
  // `farmId` arrives in the body rather than the path; ownership is still a
  // userId-filtered query and a farm the caller does not own answers 404.
  // `bodyParam` is what lets the matrix substitute it (ST-11).
  {
    method: 'POST',
    path: '/api/v1/crop-recommendation',
    auth: 'required',
    ownership: 'direct',
    resource: 'farm',
    bodyParam: 'farmId',
    bodySample: { season: 'KHARIF' },
  },

  // ── Market ─────────────────────────────────────────────────────────────────
  // Mandi prices are public data with no owner, so `/prices` is authenticated
  // but unscoped. `/my-crops` reads the caller's crops and IS scoped.
  { method: 'GET', path: '/api/v1/market/prices', auth: 'required', ownership: 'none' },
  { method: 'GET', path: '/api/v1/market/my-crops', auth: 'required', ownership: 'scoped' },
  // `/nearby` answers "what is trading near THIS farm", so it addresses one
  // owned farm — by `farmId` in the query string rather than a path segment.
  // That difference is presentational only: it is as addressable as any
  // `/:id` route and gets the same 401 / 404 / malformed-id matrix.
  {
    method: 'GET',
    path: '/api/v1/market/nearby',
    auth: 'required',
    ownership: 'direct',
    resource: 'farm',
    queryParam: 'farmId',
  },

  // ── Registry ───────────────────────────────────────────────────────────────
  // Reference data: no farmer owns it and it contains nothing personal, so it
  // is readable without a token. Every other route above is authenticated.
  { method: 'GET', path: '/api/v1/registry/crops', auth: 'public', ownership: 'none' },

  // ── Crop health ────────────────────────────────────────────────────────────
  // `analyze` and `symptom-check` take `cropId` in the body — `analyze` as a
  // multipart field. Both resolve the crop *and* its farm through
  // userId-filtered queries (AU-3) and answer 404 for a crop the caller does
  // not own; `bodyParam` is what makes the matrix prove it (ST-11).
  {
    method: 'POST',
    path: '/api/v1/crop-health/analyze',
    auth: 'required',
    ownership: 'direct',
    resource: 'crop',
    bodyParam: 'cropId',
    multipart: true,
  },
  {
    method: 'POST',
    path: '/api/v1/crop-health/symptom-check',
    auth: 'required',
    ownership: 'direct',
    resource: 'crop',
    bodyParam: 'cropId',
    bodySample: { answers: { part: 'leaf' } },
  },
  { method: 'GET', path: '/api/v1/crop-health/logs', auth: 'required', ownership: 'scoped' },
  {
    method: 'GET',
    path: '/api/v1/crop-health/logs/:id',
    auth: 'required',
    ownership: 'direct',
    resource: 'cropHealthLog',
    param: 'id',
  },
  {
    method: 'POST',
    path: '/api/v1/crop-health/logs/:id/severity',
    auth: 'required',
    ownership: 'direct',
    resource: 'cropHealthLog',
    param: 'id',
  },

  // ── Community ──────────────────────────────────────────────────────────────
  // District aggregates. Authenticated but unscoped: the documents are
  // structurally PII-free counts that belong to no farmer (AU-6), and there is
  // deliberately no write API — the aggregation job is the only writer.
  { method: 'GET', path: '/api/v1/community/alerts', auth: 'required', ownership: 'none' },
];

/** Routes the ST-10 matrix must exercise for 401 / 404 / scoping behaviour. */
export const protectedRoutes = () => ROUTE_OWNERSHIP.filter((row) => row.auth === 'required');

/**
 * Routes addressing a specific owned document by id — wherever that id rides.
 * A route carrying it in the query string is exactly as attackable as one
 * carrying it in the path, so both belong in the same matrix.
 */
export const addressableRoutes = () =>
  ROUTE_OWNERSHIP.filter(
    (row) => ['direct', 'nested'].includes(row.ownership) && (row.param || row.queryParam),
  );

/**
 * Routes addressing an owned document by an id carried in the request BODY.
 *
 * Kept separate from `addressableRoutes` for one practical reason: a body-borne
 * id cannot be substituted by rewriting a URL, and one of these routes is
 * multipart, so the sweep needs a different request builder. ST-11 owns it and
 * asserts that every row here is exercised, so a fourth body-id route cannot
 * join the table without being tested.
 */
export const bodyAddressableRoutes = () => ROUTE_OWNERSHIP.filter((row) => row.bodyParam);
