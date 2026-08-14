# Yield Estimation (FR-Y1 — **NOT IMPLEMENTED · DATA BLOCKER RESOLVED**)

> **Status, updated 2026-08-14 (Milestone 1).** Spec complete; **the estimator is
> still not built** — there is no endpoint (`GET /crops/:id/yield-estimate`
> returns **404**, not 501), no estimator service and no UI. The
> `yieldEstimates` schema exists and is unwritten.
>
> **What changed: the data blocker is closed.** The missing term was `Y_hist`,
> the district×season×crop historical yield, and it is now sourced, acquired and
> audited — 455,359 rows of Government of India district returns covering
> **1997-98 → 2022-23**, 740 districts, with fidelity verified three ways
> against the originating authority's own API and against published national and
> state figures. Provenance and licensing: `docs/yield/dataset-research.md`.
> Quality, defects and coverage: `docs/yield/dataset-audit.md`.
>
> The other three terms were already available in the codebase — area
> (`Crop.areaValue`), irrigation method (`Farm.irrigationMethod`, incl.
> `rainfed`) and pest/disease events (`CropHealthLog`).
>
> **Scope the data supports, decided on the audit:**
>
> | | crops | why |
> |---|---|---|
> | ✅ supported | RICE · WHEAT · MAIZE · SOYBEAN · ONION · POTATO · CHILLI | 293–1,268 district-season combinations each with ≥3 recent observations; latest year 2022-23 |
> | ⛔ excluded v1 | COTTON | source publishes lint in **170 kg bales while labelling the column "Tonnes"** (audit D4). The ×0.17 conversion is *not* applied without a citable DES/Ministry of Textiles bale definition. Data is complete; this is a citation gate. Future scope. |
> | ⛔ unsupported | TOMATO | 13 districts, 5 years, latest **2014-15**, 23% zero-production, annual tier frozen at 2003. Returns `INSUFFICIENT_EVIDENCE`; there is no honest fallback. |
>
> `Y_hist` still cannot be derived, defaulted or estimated — every other factor
> is a *multiplier on it*, and multiplying an unknown by 0.8 is still unknown.
> Where the lookup has no row, the answer is `INSUFFICIENT_EVIDENCE`, never a
> plausible number (CLAUDE.md rule 7).

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

## Data plan (executed — see `docs/yield/dataset-research.md`)
| Source | Use | Verified caveat |
|---|---|---|
| **India Data Portal APY** (ISB, mirroring DES) — 455,359 rows, 1997-98→2022-23, 740 districts, ODC-By/CC-BY, no key | **PRIMARY** — static lookup built into `datasets/lookup/` | mirror licence declared two ways (both permit commercial use + attribution); exact text still owed to `datasets/licenses/` |
| data.gov.in district APY API, resource `35be999b-…` (GODL) | verification oracle; future live refresh | **live-verified to end at crop_year 2014-15**; no yield column, no unit metadata |
| DES `data.desagri.gov.in` (→2023-24) | future refresh path | client-rendered report portal, no bulk API found |
| ~~UPAg~~ | rejected | login-gated, not reproducibly fetchable |

Earlier assumptions this replaces: the 2015 cutoff applied to the *API*, not to the data
— the primary source reaches 2022-23. And tomato's "368 records → state-tier fallback"
turned out to be optimistic; the state tier is 2 groups also ending in 2014-15, so tomato
is unsupported rather than low-confidence.

Risks handled: district identity via the source's own LGD `district_code`, verified
bijective with district names (740 codes, 0 collisions) rather than by name normalization;
absurd computed yields dropped and counted, never rescaled (audit D5 — Maharashtra 1997-98
records area at the wrong magnitude); units (quintals/acre shown beside t/ha); and the
cotton bale/tonne mislabel that excludes cotton from v1 (audit D4).

## MUST-NOT claims
Never "AI/ML yield prediction/forecast"; never a single big number (range always); never imply loan/insurance suitability; disclose data vintage; label: "Estimate based on {district} government yield statistics ({years}). A planning aid, not a prediction."

## Artifacts reserved now
`yieldEstimates` schema (docs/database/schema.md) · `GET /crops/:id/yield-estimate` contract returning 501 until built (docs/api/intelligence.md) · lookup-table format `{state, district, cropCode, season, year, yieldTHa}` in `datasets/README.md`.

## Sources
data.gov.in APY catalog + api.data.gov.in/resource/35be999b… (live-verified) · upag.gov.in · data.desagri.gov.in APY query · ICRISAT DLD · ncfc.gov.in FASAL · Nature Comms s41467-019-12183-9 · ICRISAT oar 2335 · Dhaliwal 2015 · DES loss assessment PDF.
