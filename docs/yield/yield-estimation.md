# Yield Estimation (FR-Y1 — **NOT IMPLEMENTED · BLOCKED ON DATA**)

> **Status, verified 2026-08-14.** Spec complete; **nothing is built**. There is
> no endpoint (`GET /crops/:id/yield-estimate` returns **404**, not 501), no
> estimator, and no yield model. The `yieldEstimates` schema exists and is
> unwritten.
>
> **The blocker is one input, and it is data, not code.** Of the four terms in
> the formula below, three are already available in the codebase — area
> (`Crop.areaValue`), irrigation method (`Farm.irrigationMethod`, incl.
> `rainfed`) and pest/disease events (`CropHealthLog`) — and both multipliers
> are sourced and cited. The missing term is **`Y_hist`**, the district×season×crop
> historical yield. `datasets/lookup/`, named in `datasets/README.md` as its
> home, **does not exist**; `datasets/` holds crop-disease imagery only.
>
> `Y_hist` cannot be derived, defaulted or estimated — every other factor is a
> *multiplier on it*, and multiplying an unknown by 0.8 is still unknown.
> Populating it with plausible numbers would fabricate the single input that
> decides whether a farmer plants a crop their rainfall cannot support
> (CLAUDE.md rule 7). So it stays empty and the feature stays unbuilt.

Research basis: subagent report 2026-08-12 with **live-verified** API probes (record counts and the 2015 cutoff below were confirmed against the running data.gov.in API, not assumed).

## Why NOT a 72h ML model (integrity position, citable)
India's operational forecaster (FASAL/MNCFC+ISRO+IMD) needs satellite multispectral+microwave data, agromet models, and 15+ years of refinement for 11 crops. Peer-reviewed yield-ML requires multi-temporal NDVI, daily weather, soil and management variables with ground truth. A 72h model on district APY data would memorize district means with noise — an opaque, falsely-precise version of the transparent estimator. We say this in the pitch as a deliberate choice.

## Transparent estimator (the plan)
```
Estimated production = Y_hist × A × F_irrigation × F_event
Y_hist = median of last 5 available years, district×season×crop yield (t/ha)
         fallback tiers: district all-season → state×season → state   (confidence label downgrades)
A      = farmer area (acre→ha ×0.4047)
F_irrigation ∈ [0.75, 1.15]  — rainfed vs assured irrigation  (basis: Zaveri & Lobell, Nat. Comms 2019 — irrigation ≈ +13% wheat, ¼ heat sensitivity; ICRISAT rainfed-gap report 43)
F_event ∈ [0.70, 1.0]        — major logged pest/disease event  (basis: Dhaliwal 2015: 15–25% average pest losses; DES loss assessment)
Range shown = Y_hist ± 1 SD of district's own last 5–10 yrs ("typical year-to-year range" — NOT a confidence interval)
```
Max 3 factors — compounding many small factors manufactures false precision. Every factor cited on-screen; full math shown ("2.1 t/ha district avg × 1.6 ha × 0.8 rainfed").

## Data plan
| Source | Use | Caveat |
|---|---|---|
| data.gov.in district APY API (GODL license, works with public key) | fallback/API path | **ends at crop_year 2015** — vintage disclosed per district |
| UPAg / DES portal CSVs (1997→2024-25) | primary: pre-downloaded static lookup shipped in `datasets/` | no public API — bulk download before clock; license terms to verify |
| Coverage (live-verified) | rice/wheat/maize/potato/onion/chilli/cotton/soybean solid | **tomato: 368 district records only** → state-tier fallback + low-confidence label |

Risks handled: district renames post-2015 (name normalization + parent fallback), absurd computed yields (sanity-clip vs state medians), units (quintals/acre shown beside t/ha).

## MUST-NOT claims
Never "AI/ML yield prediction/forecast"; never a single big number (range always); never imply loan/insurance suitability; disclose data vintage; label: "Estimate based on {district} government yield statistics ({years}). A planning aid, not a prediction."

## Artifacts reserved now
`yieldEstimates` schema (docs/database/schema.md) · `GET /crops/:id/yield-estimate` contract returning 501 until built (docs/api/intelligence.md) · lookup-table format `{state, district, cropCode, season, year, yieldTHa}` in `datasets/README.md`.

## Sources
data.gov.in APY catalog + api.data.gov.in/resource/35be999b… (live-verified) · upag.gov.in · data.desagri.gov.in APY query · ICRISAT DLD · ncfc.gov.in FASAL · Nature Comms s41467-019-12183-9 · ICRISAT oar 2335 · Dhaliwal 2015 · DES loss assessment PDF.
