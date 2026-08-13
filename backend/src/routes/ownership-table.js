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
  // `farmId` arrives in the body rather than the path, so there is no `param`
  // for the matrix to substitute; ownership is still a userId-filtered query
  // and a farm the caller does not own answers 404.
  { method: 'POST', path: '/api/v1/crop-recommendation', auth: 'required', ownership: 'scoped' },

  // ── Market ─────────────────────────────────────────────────────────────────
  // Mandi prices are public data with no owner, so `/prices` is authenticated
  // but unscoped. `/my-crops` reads the caller's crops and IS scoped.
  { method: 'GET', path: '/api/v1/market/prices', auth: 'required', ownership: 'none' },
  { method: 'GET', path: '/api/v1/market/my-crops', auth: 'required', ownership: 'scoped' },

  // ── Registry ───────────────────────────────────────────────────────────────
  // Reference data: no farmer owns it and it contains nothing personal, so it
  // is readable without a token. Every other route above is authenticated.
  { method: 'GET', path: '/api/v1/registry/crops', auth: 'public', ownership: 'none' },

  // ── Crop health ────────────────────────────────────────────────────────────
  // `analyze` and `symptom-check` take `cropId` in the body, so like
  // `/crop-recommendation` there is no `param` for the matrix to substitute;
  // both still resolve the crop *and* its farm through userId-filtered queries
  // (AU-3) and answer 404 for a crop the caller does not own.
  { method: 'POST', path: '/api/v1/crop-health/analyze', auth: 'required', ownership: 'scoped' },
  {
    method: 'POST',
    path: '/api/v1/crop-health/symptom-check',
    auth: 'required',
    ownership: 'scoped',
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

/** Routes addressing a specific owned document by id. */
export const addressableRoutes = () =>
  ROUTE_OWNERSHIP.filter((row) => ['direct', 'nested'].includes(row.ownership) && row.param);
