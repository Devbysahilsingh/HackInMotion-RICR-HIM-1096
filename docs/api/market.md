# Market API

| | |
|---|---|
| GET `/market/prices?commodity=&state=&district=&days=30` | Auth · served from marketPrices only |
→ 200 `{series:[{date, market, minPrice, modalPrice, maxPrice}], signal:{trend:'RISING'|'FALLING'|'STABLE', changePct7d, changePct30d, guidanceKey}, freshness:{latestDate, source, status:'cached'|'historical'}}`
commodity validated against registry mappings; district optional (state-level aggregate). Signal math: docs/market/market-insights.md. Always date-labeled; `historical` when serving seed data.

| | |
|---|---|
| GET `/market/compare?commodity=&state=&date=` | Auth · P1 |
Same-commodity across markets in state for latest available date → table for "which mandi pays better".

| | |
|---|---|
| GET `/market/my-crops` | Auth |
Convenience: signals for all user's active crops (dashboard cards). Aggregates the above.

No prediction endpoints (NFR-7). Dependencies: marketPrices, cropRegistry, crops.
