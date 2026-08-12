# Market Data Sources

## Primary: data.gov.in "Variety-wise Daily Market Prices" (Agmarknet-fed)
- Access: REST, free API key (registration; approval usually quick but applied Day 0 first — OD-5). Filters: state, district, commodity, date. Format: JSON/CSV.
- Fields used: state, district, market, commodity, variety, arrival_date, min_price, max_price, modal_price (₹/quintal).
- Characteristics (accepted, disclosed): 1–3 day lag common; sparse days for small mandis; naming inconsistencies (alias map).
- License: Government Open Data License – India (GODL) — attribution in README.

## Fallback/seed: CEDA Ashoka Agmarknet mirror (agmarknet.ceda.ashoka.edu.in)
Bulk historical download → `scripts/seed-market.(js)` builds 60-day seed for demo commodities×states; rows labeled source:'seed'. Used when: primary key missing, primary down, or gap-filling display continuity (labeled Historical).

## Explicitly rejected
Commercial commodity APIs (cost), scraping agmarknet.gov.in live (fragility, ToS), eNAM (no public API). Recorded for viva "what did you evaluate".

## Commodity mapping (registry-driven)
`cropRegistry.market.aliases` e.g. RICE→["Paddy(Dhan)(Common)","Rice"], CHILLI→["Dry Chillies","Green Chilli"]; unmapped rows dropped + counted (drop-rate metric in job log — schema-drift alarm).
