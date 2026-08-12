# Route Ownership Table

The authoritative machine-readable copy is `backend/src/routes/ownership-table.js`. **ST-10 generates its matrix from that file**, so a protected route added without a row there fails the authorization suite rather than shipping untested. This document is the human-readable view of the same table plus the rules behind it.

## Ownership kinds

| Kind | Meaning | Enforcement |
|---|---|---|
| `direct` | The addressed document carries `userId` | `loadOwned({model, param})` — `userId` is part of the **query filter**, so the database never returns another farmer's document |
| `nested` | The full parent chain must resolve to the caller (AU-3) | `loadOwned({..., parent: {model, foreignKey}})` — leaf *and* parent both checked |
| `scoped` | A collection read | Query filtered by `{userId}` (AU-4) — never post-filtered in JavaScript |
| `none` | Reference data or a non-resource action | Authentication only, or public |

## The table

| Method | Path | Auth | Ownership | Resource | Param |
|---|---|---|---|---|---|
| POST | `/api/v1/auth/register` | public | none | — | — |
| POST | `/api/v1/auth/login` | public | none | — | — |
| POST | `/api/v1/auth/refresh` | public¹ | none | — | — |
| POST | `/api/v1/auth/logout` | required | none | — | — |
| GET | `/api/v1/auth/me` | required | none | — | — |
| GET | `/api/v1/farms` | required | scoped | farms | — |
| POST | `/api/v1/farms` | required | none² | — | — |
| GET | `/api/v1/farms/:id` | required | direct | farm | `id` |
| PATCH | `/api/v1/farms/:id` | required | direct | farm | `id` |
| DELETE | `/api/v1/farms/:id` | required | direct | farm | `id` |
| POST | `/api/v1/farms/:farmId/crops` | required | nested | farm | `farmId` |
| GET | `/api/v1/farms/:farmId/crops` | required | nested | farm | `farmId` |
| GET | `/api/v1/crops/:id` | required | nested | crop → farm | `id` |
| PATCH | `/api/v1/crops/:id` | required | nested | crop → farm | `id` |
| DELETE | `/api/v1/crops/:id` | required | nested | crop → farm | `id` |
| GET | `/api/v1/registry/crops` | public | none | — | — |

¹ Public in the sense that it carries no access token — it is authenticated by the refresh token itself (cookie or body).
² Creation has no existing document to own; ownership is *assigned* from the session, never accepted from the body.

`/api/v1/registry/crops` is public because the crop registry is reference knowledge: it contains no personal data and every farmer sees the same document. It is the only non-auth GET in the product.

## Invariants these rows encode

- **AU-1** — every user-owned document carries `userId`, checked server-side against `req.auth.userId`.
- **AU-2** — ownership failure returns **404**, not 403. A caller must not be able to discover that a resource they cannot access exists. `AUTHORIZATION_ERROR`/403 is reserved for non-resource actions and is currently unused.
- **AU-3** — nested resources verify the whole chain. A crop whose denormalized `userId` matches but whose farm belongs to someone else is **unreachable**; the chain is the authority, not the denormalized field.
- **AU-4** — list endpoints put `{userId}` in the query. Fetch-then-filter is banned: one forgotten `.filter()` becomes a data breach.

## Rules for adding a route

1. Add the row to `backend/src/routes/ownership-table.js` in the same commit as the route.
2. Use `loadOwned` — **no handler may query by a bare id**. `Model.findById(req.params.id)` in a request path is a review blocker.
3. Never accept `userId`, `farmId` ownership or any actor identity from the request body. Derive it from `req.auth` and from already-owned parents.
4. Reject malformed ObjectIds before they reach Mongo. `loadOwned` does this; a raw query would surface a CastError as a 500 and confirm by its shape that the id was merely malformed.
5. If the route addresses a document by id, ST-10 will automatically assert: 401 without a token, 404 for another farmer's id, 404 indistinguishable from a non-existent id, 404 for a malformed id, and 401 for a tampered token.

## What ST-10 asserts

Per `docs/security/security-testing.md`: *"generated per protected endpoint — 401 (no token), 404 (other-user resource), list scoping, nested-chain checks (crop of other's farm)."*

The suite additionally asserts that every row in the table is actually mounted, so a stale row cannot make the matrix vacuously pass.

Implementation: `backend/tests/security/st-10-authorization.test.js`.
