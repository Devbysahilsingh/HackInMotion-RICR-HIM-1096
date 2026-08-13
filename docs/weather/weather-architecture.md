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

## The actual requests (as built, P2 — no earlier doc specified either)

**Open-Meteo** `GET https://api.open-meteo.com/v1/forecast` (`backend/src/integrations/openMeteo.js`):

| Param | Value | Why |
|---|---|---|
| `latitude` / `longitude` | farm cell | — |
| `daily` | `temperature_2m_min, temperature_2m_max, relative_humidity_2m_mean, wind_speed_10m_max, precipitation_sum, precipitation_probability_max, et0_fao_evapotranspiration` | the seven variables named in "Required data", in order → `tMinC, tMaxC, humidityPct, windKmh, rainMm, rainProbPct, et0Mm` |
| `timezone` | `Asia/Kolkata` | fixed, not `auto`: every day boundary in this system is IST, and inferring one would make the boundary depend on the farm's coordinates |
| `past_days` / `forecast_days` | `7` / `7` | the 14-row series |
| `temperature_unit` / `wind_speed_unit` / `precipitation_unit` | `celsius` / `kmh` / `mm` | pinned explicitly so a silent upstream default change cannot turn 15 km/h into 15 mph |

Verified against the live keyless API on 2026-08-13: 14 daily rows, every requested field present and non-null, `daily_units` returning exactly `°C / % / km/h / mm / % / mm`. That verified sample is the test fixture.

**OpenWeatherMap fallback** `GET https://api.openweathermap.org/data/2.5/forecast?units=metric` (`backend/src/integrations/openWeatherMap.js`). The free endpoint returns **~5 days of 3-hourly steps, no past days and no ET₀**. Steps are folded to daily rows by **IST calendar date** — min of minima, max of maxima, mean humidity, max wind, summed `rain.3h`, max probability — so a fallback day means the same thing as a primary day. Wind arrives in m/s and is converted to km/h; `et0Mm` is `null` on every row and the irrigation engine drops to `mode:'simplified'` (R2). No ET₀ is ever derived: that would be a fabricated agronomic number (rule 7).

**Consequence for validation.** A fallback snapshot is forecast-only and shorter than 14 days, so the "arrays of 14 days" rule in docs/database/validation.md is enforced **per source** — `open-meteo` 14, `openweathermap` 3 (`MIN_DAYS_BY_SOURCE` in `backend/src/services/weatherValidation.js`). Applying 14 to both would fail every fallback fetch and break RES-01, the test that exists to prove fallback works. Physical ranges and whole-payload rejection (RES-03) are unchanged and shared by both sources.

## Pipeline (DB-first; clients NEVER call providers)
```
scheduler q3h (brand-new locations are queued for the NEXT tick, not fetched on the request path)
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
| HEAT | Tmax ≥ crop heatTmaxC (e.g. 38–40) | irrigate evening, mulch, shade nets |
| FROST | Tmin ≤ crop frostTminC (e.g. 2–4) | CRITICAL for tomato/potato: light irrigation evening, smoke/cover |
| WIND | ≥40 km/h | stake crops, delay spraying |
| HUMIDITY_DISEASE | RH ≥85% + 25–32°C ≥2 days | fungal-conducive: inspect (links to health flow) |
| DRY_SPELL | 7-day past+forecast rain <5mm | water-stress watch; irrigation engine weighs in |

Each emitted risk carries trace data (the actual numbers) + recommendation feed item at its level.

**Enum reconciliation (P2):** this file previously wrote `EXTREME_HEAT / FROST_COLD / HIGH_WIND`; docs/api/weather.md writes `HEAT / FROST / WIND`. The wire contract wins — clients are written against it — so the spellings above are corrected to match `WEATHER_RISK_TYPES` in `backend/src/config/constants.js`. There is one set of names now.

**Engine defaults where the registry is silent** (`DEFAULT_THRESHOLDS`, `backend/src/engines/weatherRisk/weatherRisk.js`): `heavyRainMm24h 50 · heatTmaxC 38 · frostTminC 4 · highWindKmh 40 · humidityDiseasePct 85`. Heat and frost take the *earlier-warning* end of the ranges printed above: a warning a farmer does not need costs attention, one that arrives late costs a crop. These are engine policy, not a sourced agronomic claim about any particular crop — so **every emitted risk carries `thresholdSource: 'REGISTRY' | 'ENGINE_DEFAULT'`**, and a generic threshold is never presented as crop-specific. A registry threshold that is non-positive or non-finite falls back to the default rather than producing a confident wrong answer (`heavyRainMm24h: 0` would make every dry day exceed it); `frostTminC` is finiteness-checked only, because a crop safe to −2 °C is a real value.

**Severity banding, now defined.** `level = f(magnitude, stage sensitivity, imminence)` named the inputs but never defined `f`. The engine defines it, as declared engine policy rather than a sourced claim: a magnitude band (steps past the threshold, in a named per-risk unit — 2 °C per band for heat and frost, one multiple of the threshold for the 0-based quantities, consecutive days for humidity, dryness fraction for dry spell), **+1** band if the crop is in FAO-56 MID (peak-Kc, peak-biomass — the only stage-sensitivity signal the registry supports), **+1** if the event lands today or tomorrow and **−1** beyond five days ahead. Band 0 is LOW, clamped to CRITICAL. Frost starts one band higher than heat by construction. Every input to the step is written into the trace, so the banding is auditable per risk rather than a number the UI must trust.

## Error/edge behavior
New farm: no provider call on the request path (rule 3, DB-first reads). The read returns `status:'pending'` with a retry hint and flags the cell for priority refresh, which the next scheduler tick drains ahead of the routine sweep — see docs/api/weather.md. Provider disagreement: last-writer-wins per source field, source recorded. India-bounds validation prevents junk coordinates from wasting quota. TTL/staleness surfaced: ok ≤6h · stale >6h (still served, labeled) · pending (never fetched).
