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

  // ── Registry ───────────────────────────────────────────────────────────────
  // Reference data: no farmer owns it and it contains nothing personal, so it
  // is readable without a token. Every other route above is authenticated.
  { method: 'GET', path: '/api/v1/registry/crops', auth: 'public', ownership: 'none' },
];

/** Routes the ST-10 matrix must exercise for 401 / 404 / scoping behaviour. */
export const protectedRoutes = () => ROUTE_OWNERSHIP.filter((row) => row.auth === 'required');

/** Routes addressing a specific owned document by id. */
export const addressableRoutes = () =>
  ROUTE_OWNERSHIP.filter((row) => ['direct', 'nested'].includes(row.ownership) && row.param);
