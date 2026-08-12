# Weather API

| | |
|---|---|
| GET `/farms/:id/weather` | Auth (ownership) · Cache: served from weatherSnapshots only |
→ 200 `{daily:[14 days: date,tMinC,tMaxC,humidityPct,windKmh,rainMm,rainProbPct,et0Mm?], risks:[{type:'HEAVY_RAIN'|'HEAT'|'FROST'|'WIND'|'HUMIDITY_DISEASE'|'DRY_SPELL', level:'LOW'|'MEDIUM'|'HIGH'|'CRITICAL', cropCode?, titleKey, data}], freshness:{source, fetchedAt, status}}`
Risks computed per crop on the farm via registry sensitivity thresholds (docs/weather/). If snapshot missing (brand-new location): on-demand fetch attempt (8s) → else 200 with `status:'pending'` + retry hint — never 5xx for missing cache.
Errors: 404. EXTERNAL_SERVICE_ERROR only when no snapshot has EVER succeeded and on-demand fails.

No other weather endpoints — engines consume snapshots server-side; clients never talk to weather providers (keys/quota protected, freshness consistent).
