# Indexes

24 declared indexes across the 14 collections (excluding the automatic `_id_`). The assertion source of truth is the `EXPECTED` map in `backend/tests/models/indexes.test.js`, which runs against a real `mongod` and also fails on any index that is built but *not* declared here.

| Collection | Index | Name | Type | Why |
|---|---|---|---|---|
| users | email | `email_unique` | unique | login lookup, duplicate prevention |
| refreshTokens | tokenHash | `tokenHash_unique` | unique | O(1) refresh validation |
| refreshTokens | expiresAt | `expiresAt_ttl` | TTL(0) | auto-purge expired |
| refreshTokens | familyId | `familyId` | std | family revocation on reuse |
| refreshTokens | userId | `userId` | std | revoke-all-for-user (logout everywhere, account delete) |
| farms | userId | `userId` | std | list-my-farms |
| crops | userId, farmId | `userId_farmId` | compound | ownership + farm views |
| crops | cropCode | `cropCode` | std | community fan-out targeting |
| cropRegistry | cropCode | `cropCode_unique` | unique | registry lookup |
| cropHealthLogs | userId, cropId, createdAt desc | `userId_cropId_createdAt` | compound | history timeline |
| cropHealthLogs | sharedToCommunity, createdAt | `shared_createdAt` | partial (shared=true) | community aggregation scan |
| irrigationLogs | cropId, date desc | `cropId_date` | compound | water-balance ledger |
| irrigationLogs | userId, date desc | `userId_date` | compound | user-scoped history + cascade on account delete (the cropId-prefixed index cannot serve it) |
| irrigationLogs | userId, clientRequestId | `userId_clientRequestId_unique` | unique partial (`clientRequestId` is a string) | offline write-sync idempotency — collapses a replayed submission. Partial because rows written online carry no id and a plain unique index would treat every missing value as a collision. Scoped to `userId` so one account's id cannot collide with another's |
| weatherSnapshots | locationKey, source | `locationKey_source_unique` | unique compound | upsert target |
| weatherSnapshots | expiresAt | `expiresAt` | std | refresh job selection |
| marketPrices | commodityCode, market, date | `commodity_market_date_unique` | unique compound | idempotent ingest |
| marketPrices | commodityCode, district, date desc | `commodity_district_date` | compound | trend queries |
| recommendations | userId, acknowledgedAt, priority, createdAt desc | `feed` | compound | feed query |
| recommendations | validUntil | `validUntil` | std | expiry job |
| recommendations | dedupKey | `dedupKey_unique` | unique | feed job's idempotent upsert target (P2-7) |
| communityAlerts | district, cropCode, active | `district_cropCode_active` | compound | advisory lookup |
| yieldEstimates | userId, cropId | `userId_cropId` | compound | ownership-scoped read (AU-4); the query exists though the writer is P3 |
| auditLogs | createdAt | `ttl_30d` | TTL(30d) | retention |
| seedMeta | seedName | `seedName_unique` | unique | makes "apply once" enforceable rather than conventional |

TTL is declared on exactly two collections — `auditLogs` and `refreshTokens`. `weatherSnapshots.expiresAt` and `recommendations.validUntil` are plain indexes on purpose: a stale cache must survive to be served with a freshness label, and feed items linger a further 7 days past `validUntil` under a job rather than vanishing the instant they lapse.

Reconciled with the code in P2: `refreshTokens.userId`, `irrigationLogs.userId_date`, `yieldEstimates.userId_cropId` and `seedMeta.seedName_unique` existed before Phase 2 but had never been documented here; `recommendations.dedupKey_unique` is new.

Rules: every list endpoint has a covering-ish index; no index without a named query; M0 memory is small — indexes reviewed against actual query set before adding more.
