# Weather API

| | |
|---|---|
| GET `/farms/:id/weather` | Auth (ownership) · Cache: served from weatherSnapshots only |
→ 200 `{daily:[up to 14 days — fewer on the fallback source: date,tMinC,tMaxC,humidityPct,windKmh,rainMm,rainProbPct,et0Mm?], risks:[{type:'HEAVY_RAIN'|'HEAT'|'FROST'|'WIND'|'HUMIDITY_DISEASE'|'DRY_SPELL', level:'LOW'|'MEDIUM'|'HIGH'|'CRITICAL', cropCode?, titleKey, data}], freshness:{source, fetchedAt, status}}`
Risks computed per crop on the farm via registry sensitivity thresholds (docs/weather/); each risk also carries `daysAhead` and `thresholdSource:'REGISTRY'|'ENGINE_DEFAULT'`. Only `status:'active'` crops are assessed — a planned or harvested crop has nothing in the ground to be at risk.

**No provider is called on this path.** This file previously mandated an "on-demand fetch attempt (8s)" for a brand-new location. CLAUDE.md rule 3 (DB-first reads: "request paths never call weather/market providers") forbids it, and P1-5 already resolved the same conflict the same way for `locationKey`. A location with no snapshot returns **200** with `freshness:{status:'pending', source:null, fetchedAt:null, retryAfterSeconds:180, reason:'awaiting_first_fetch'|'no_coordinates'}`, `daily:[]` and `risks:[]`, and the cell is queued for priority refresh — the next scheduler tick drains that queue ahead of the routine sweep. `reason` separates "not fetched yet" from "cannot be fetched": a farm with no coordinates has nothing to fetch, since the district-centroid table does not exist and inventing one would fabricate a location.
Errors: 404 (not owned / absent). No EXTERNAL_SERVICE_ERROR is reachable here — the endpoint never talks to a provider, so there is no external call to fail.

No other weather endpoints — engines consume snapshots server-side; clients never talk to weather providers (keys/quota protected, freshness consistent).
