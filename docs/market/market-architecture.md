# Market Intelligence Architecture

```
data.gov.in Agmarknet resource (daily mandi prices; free key; often 1–3 days lag)
   ↓ nightly cron (+ manual trigger script)          [timeout 15s, retry 1]
validate rows (numeric sanity, modal∈[min,max] clamp+flag, date parse, commodity mapped)
   ↓
normalize (commodityCode via registry aliases; state/district canonical names; ₹/quintal)
   ↓
append marketPrices (idempotent: unique commodity+market+date)
   ↓
serve: trends/signal computed on read · signal flips emit feed items
Fallback: fetch fails → existing history serves (status 'cached') → if only seed rows exist → 'historical' label
Seed: CEDA-Agmarknet-derived 60-day history for demo commodities×states, source:'seed' (real historical data, labeled — not fabricated)
```

## Scope
Commodities: the 9 registry crops (mapped: Rice/Paddy, Wheat, Maize, Cotton, Tomato, Potato, Onion, Soybean, Dry Chillies — alias table handles Agmarknet naming variants). Markets: all mandis in demo states (OD: MP/MH/UP recommended); per-state fetch filters keep volume and M0 storage bounded (180-day rolling purge).

## Freshness & honesty
Every response carries latestDate + source; UI shows "Prices as of {date} · {mandi}". Data staleness of the government source is a disclosed characteristic, not hidden. No price forecasts anywhere.

## Failure modes
Key not approved by Day 0 (OD-5) → launch on seed history labeled Historical + retry job; portal schema drift → row validator quarantines (logged count), never poisons history; empty responses → keep cache, status cached.
