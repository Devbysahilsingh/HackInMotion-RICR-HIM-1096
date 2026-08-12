# Data Lifecycle & Retention

| Data | Created by | Updated | Expires/Deleted | Notes |
|---|---|---|---|---|
| users | register | profile edits | account deletion (P2 endpoint; cascades below) | minimal collection principle |
| refreshTokens | login/refresh | rotation | TTL at expiresAt; revoked kept until TTL for reuse detection | |
| farms/crops | farmer | farmer | farmer delete → cascade crops, healthLogs, irrigationLogs, recommendations | soft-delete not needed at MVP |
| cropHealthLogs | analysis flow | never (append) | with crop/account deletion; Cloudinary asset destroyed via publicId | images private |
| weatherSnapshots | refresh job | refresh job upsert | stale docs overwritten in place; orphan locationKeys purged weekly | history = embedded past-7-days |
| marketPrices | nightly job / seed | append-only | 180-day rolling purge (M0 size guard) | seed rows labeled source:'seed' |
| recommendations | engine jobs | acknowledge | expiry job on validUntil (+7d purge) | |
| communityAlerts | aggregation job | count updates | active=false when window passes; purge 30d | no PII at any point |
| auditLogs | middleware | never | TTL 30d | |
| seedMeta | seed scripts | version bumps | never | idempotency |

## Account deletion (FR planned P2, honest privacy story)
`DELETE /users/me` → password re-auth → cascade: farms, crops, healthLogs (+Cloudinary destroy), irrigationLogs, recommendations, refreshTokens revoked; auditLogs retained (30d TTL, legal-hygiene) with userId nulled to a tombstone hash. Community aggregates unaffected (already anonymous counts).

## Size budget (Atlas M0 = 512MB)
Estimates at demo scale (100 users): users+farms+crops <1MB; healthLogs (no image bytes) <5MB; weatherSnapshots (~50 locations ×~10KB) <1MB; marketPrices (9 commodities × ~200 markets × 180d) ≈ 30–60MB (largest tenant — rolling purge + per-state filtering keeps it bounded); recommendations <5MB. Comfortable margin; raw provider payload capping enforced.
