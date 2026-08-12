# Weather Architecture

## Required data (drives provider choice)
Daily, 7-day past + 7-day forecast per farm location: Tmin/Tmax (°C), RH (%), wind (km/h), precipitation sum (mm) + probability (%), **ET₀ FAO evapotranspiration (mm)** — the irrigation engine's key input. Optional: soil moisture layers (Open-Meteo provides; used as sanity signal only, not ground truth).

## Providers
| | Open-Meteo (PRIMARY) | OpenWeatherMap (FALLBACK) |
|---|---|---|
| Cost/key | Free, **no key**, 10k calls/day (non-commercial) | Free tier, key, 1k calls/day |
| ET₀ | ✅ `et0_fao_evapotranspiration` (daily) | ❌ → engine switches to simplified mode (labeled) |
| Fit | forecast+history one call; India coverage good | ubiquitous, stable |

Location strategy: farm lat/lon (GPS) or district centroid table (`shared/constants/geo`) when manual; rounded to 0.1° → `locationKey` (dedupes nearby farms into one fetch — quota efficiency).

## Pipeline (DB-first; clients NEVER call providers)
```
cron q3h (+on-demand for brand-new locations)
  → for each distinct active locationKey:
      Open-Meteo (timeout 8s, 1 retry jitter)
        → validate (schema + physical ranges, docs/database/validation.md)
        → upsert weatherSnapshots {daily[14], fetchedAt, expiresAt:+6h, status:'ok', source}
      on failure → OpenWeatherMap (same treatment; et0 absent)
      on both failing → existing snapshot kept, status:'stale', lastSuccessAt untouched
circuit: 3 consecutive provider failures → skip provider 10min
```
Failure never overwrites good data. `GET /farms/:id/weather` serves snapshots only, embeds freshness.

## Agricultural risk engine (weather → meaning)
Rules over snapshot × per-crop registry sensitivity thresholds; levels LOW/MEDIUM/HIGH/CRITICAL (level = f(magnitude, crop stage sensitivity, imminence)):
| Risk | Trigger (defaults; registry overrides per crop) | Example action key |
|---|---|---|
| HEAVY_RAIN | ≥50mm/24h forecast, prob ≥60% | delay irrigation/fertilizer, check drainage |
| EXTREME_HEAT | Tmax ≥ crop heatTmaxC (e.g. 38–40) | irrigate evening, mulch, shade nets |
| FROST_COLD | Tmin ≤ crop frostTminC (e.g. 2–4) | CRITICAL for tomato/potato: light irrigation evening, smoke/cover |
| HIGH_WIND | ≥40 km/h | stake crops, delay spraying |
| HUMIDITY_DISEASE | RH ≥85% + 25–32°C ≥2 days | fungal-conducive: inspect (links to health flow) |
| DRY_SPELL | 7-day past+forecast rain <5mm | water-stress watch; irrigation engine weighs in |

Each emitted risk carries trace data (the actual numbers) + recommendation feed item at its level.

## Error/edge behavior
New farm: immediate on-demand fetch; pending state designed. Provider disagreement: last-writer-wins per source field, source recorded. India-bounds validation prevents junk coordinates from wasting quota. TTL/staleness surfaced: ok ≤6h · stale >6h (still served, labeled) · pending (never fetched).
