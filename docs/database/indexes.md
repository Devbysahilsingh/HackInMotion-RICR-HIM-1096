# Indexes

| Collection | Index | Type | Why |
|---|---|---|---|
| users | email | unique | login lookup, duplicate prevention |
| refreshTokens | tokenHash | unique | O(1) refresh validation |
| refreshTokens | expiresAt | TTL(0) | auto-purge expired |
| refreshTokens | familyId | std | family revocation on reuse |
| farms | userId | std | list-my-farms |
| crops | userId, farmId | compound | ownership + farm views |
| crops | cropCode | std | community fan-out targeting |
| cropRegistry | cropCode | unique | registry lookup |
| cropHealthLogs | userId, cropId, createdAt desc | compound | history timeline |
| cropHealthLogs | sharedToCommunity, createdAt | partial (shared=true) | community aggregation scan |
| irrigationLogs | cropId, date desc | compound | water-balance ledger |
| weatherSnapshots | locationKey, source | unique compound | upsert target |
| weatherSnapshots | expiresAt | std | refresh job selection |
| marketPrices | commodityCode, market, date | unique compound | idempotent ingest |
| marketPrices | commodityCode, district, date desc | compound | trend queries |
| recommendations | userId, acknowledgedAt, priority, createdAt desc | compound | feed query |
| recommendations | validUntil | std | expiry job |
| communityAlerts | district, cropCode, active | compound | advisory lookup |
| auditLogs | createdAt | TTL(30d) | retention |

Rules: every list endpoint has a covering-ish index; no index without a named query; M0 memory is small — indexes reviewed against actual query set before adding more.
