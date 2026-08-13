# MongoDB Schema Design

Atlas M0 (512MB). 14 collections — each justified; entities from the master instruction that we deliberately did NOT create as collections are listed at the bottom with reasons. All user-owned documents carry `userId` (ownership invariant AU-1). All docs carry `createdAt`/`updatedAt`.

## users
```
{ _id, name, email (unique, lowercase), phone?, passwordHash (bcrypt 12),
  language: 'en'|'hi', units: { land:'acre'|'hectare'|'bigha' },
  voiceEnabled: bool, communityConsent: bool (default false, explicit opt-in),
  lastLoginAt }
```
## refreshTokens
```
{ _id, userId, tokenHash (sha256, unique), familyId, jti, expiresAt (TTL),
  revokedAt?, replacedByJti?, userAgent, ip }
```
Rotation: on refresh, current jti revoked + new issued in same family; reuse of a revoked jti → revoke whole family (docs/security/authentication.md).

## farms
```
{ _id, userId (idx), name, location: { lat?, lon?, state, district, source:'gps'|'manual' },
  sizeValue, sizeUnit, soilType: 'alluvial'|'black'|'red'|'laterite'|'sandy'|'loamy'|'clay'|'unknown',
  irrigationMethod: 'canal'|'borewell'|'rainfed'|'drip'|'sprinkler'|'unknown', notes? }
```
## crops  (crop INSTANCE on a farm; registry holds knowledge)
```
{ _id, userId (idx), farmId (idx), cropCode (→cropRegistry), variety?, sowingDate,
  areaValue?, areaUnit?, status:'planned'|'active'|'harvested',
  waterBalance: { depletionMm, lastComputedAt, initialized: bool } }
```
## cropRegistry  (reference knowledge; structure in docs/product/crop-support-matrix.md)
Seeded by script; read-heavy; includes diseases[] (knowledge base) and fertilizer{} (KB) — **disease + fertilizer knowledge live inside the registry document** rather than separate `diseaseKnowledge`/`fertilizerKnowledge` collections: they are always fetched with the crop, never queried independently, and stay < 16MB by orders of magnitude. Revisit only if KBs grow past ~100 crops.

## cropHealthLogs  (= cropObservations + cropAnalyses merged — one observation always has 0..1 analysis; separate collections would force a join on every read)
```
{ _id, userId (idx), cropId (idx), farmId, imageUrl, imagePublicId, description?,
  analysis: { source:'ml'|'gemini'|'rules', modelVersion?, diseaseCode|'UNKNOWN',
              confidence?, top3?, severityAssessment?, escalated: bool },
  recommendationSnapshot: { titleKey, data },        // i18n key + params
  sharedToCommunity: bool (requires users.communityConsent),
  status:'analyzed'|'failed'|'pending' }
```
## irrigationLogs
```
{ _id, userId (idx), cropId (idx), date, amountMm?, source:'farmer'|'assumed' }
```
## weatherSnapshots  (cache + history)
```
{ _id, locationKey ("lat,lon" rounded 0.1°; unique+source), source:'open-meteo'|'openweathermap',
  fetchedAt, expiresAt, status:'ok'|'stale', lastSuccessAt,
  daily: [ { date, tMinC, tMaxC, humidityPct, windKmh, rainMm, rainProbPct, et0Mm? } ],  // 7 past + 7 forecast
  raw?: <trimmed provider payload for debugging, capped> }
```
Failed fetches never overwrite `daily`; they only update `status`.

## marketPrices  (append-only history)
```
{ _id, commodityCode, state, district, market, date,
  minPrice, modalPrice, maxPrice, unit:'quintal', source:'datagovin'|'seed',
  flagged: bool (default false),                   // see below
  fetchedAt }   // unique index (commodityCode, market, date)
```
`flagged` is set when the published modal price fell outside `[minPrice, maxPrice]` and was clamped to the nearest bound during ingest (docs/market/data-normalization.md §2). The rule was documented from the start but the field was not, so a clamped row was indistinguishable from a published one — an adjusted number presenting itself as the mandi's own, which honesty rule 9 forbids. Added P2-5.
## recommendations  (dashboard feed items — doubles as in-app notifications; no separate notifications collection)
```
{ _id, userId (idx), farmId?, cropId?, type:'irrigation'|'weather-risk'|'health'|'market'|'fertilizer'|'community'|'crop-suggestion',
  priority:'CRITICAL'|'HIGH'|'MEDIUM'|'INFO',
  source:'WEATHER'|'ML'|'RULE_ENGINE'|'MARKET'|'COMMUNITY'|'HYBRID',
  titleKey, bodyKey, data:{...}                      // i18n params + why-trace numbers
  confidence?, validUntil (TTL-ish; job expires), acknowledgedAt?,
  dedupKey (required, unique idx) }                  // see below
```
`dedupKey` is the feed job's idempotent upsert key: `userId | type | cropId-or-farm:farmId | discriminator | IST day`. docs/api/recommendations.md specifies "dedupe type+cropId+day", which is insufficient and has no home on the document: two simultaneous weather risks on one crop share that tuple (one would silently overwrite the other), farm-level items have no `cropId`, and the tuple omits `userId`, so the key would collide across accounts. Storing the composed key makes the upsert filter a single indexed equality and puts idempotency in the database rather than in job logic — the same way `marketPrices` does it. Added P2-7.
## communityAlerts  (P2)
```
{ _id, district, state, cropCode, diseaseCode, windowStart, windowEnd,
  reportCount, distinctFarmers, level:'INFO'|'HIGH', active: bool }
```
Generated by aggregation job over cropHealthLogs (sharedToCommunity=true, source ml|gemini, confidence≥τ). Contains ZERO reporter identifiers.

## yieldEstimates  (P3 — schema reserved, no writes in MVP)
```
{ _id, userId, cropId, districtAvgYield, areaValue, adjustments:[{factor, multiplier, reasonKey}],
  estimateRange:{low, high, unit}, inputsSnapshot, disclaimerVersion }
```
## auditLogs
```
{ _id, userId?, event:'login'|'login_failed'|'token_reuse'|'rate_limited'|'upload_rejected'|..., ip, meta, createdAt (TTL 30d) }
```
## seedMeta
`{ _id, seedName, version, appliedAt }` — idempotent seed tracking (registry, demo farm, market seed).

## Deliberately NOT collections (master-list reconciliation)
- `fields` — farms model one field; multi-field farms = multiple farm docs (simpler; documented for farmers).
- `cropObservations`/`cropAnalyses` — merged into cropHealthLogs (above).
- `diseaseKnowledge`/`fertilizerKnowledge` — embedded in cropRegistry (above).
- `weatherHistory` — weatherSnapshots retains past 7 days per refresh; long-horizon history unnecessary for engines.
- `irrigationRecommendations` — computed on read (pure engine) + emitted into `recommendations`; storing separately would duplicate.
- `marketHistory` — marketPrices IS the history (append-only).
- `communityReports` — derived view over cropHealthLogs; separate copy would risk PII duplication.
- `voiceInteractions` — not stored (privacy, minimal collection).
- `notifications` — recommendations collection serves in-app feed.
- `images` — Cloudinary is the store; URLs live on cropHealthLogs.
