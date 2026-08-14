# Yield Dataset Research & Acquisition Record

**Status: acquisition executed and verified 2026-08-14.** This document records what
was searched, what was obtained, and what it is licensed under. Data *quality* is
deliberately not settled here — that is `docs/yield/dataset-audit.md`'s job, on
evidence. The estimator itself remains unbuilt; see `docs/yield/yield-estimation.md`.

The problem this closes is the one that doc names: `Y_hist`, the district × season ×
crop historical yield, was the single missing input and could not be derived,
defaulted or estimated. It is now sourced.

---

## What was required

The estimator needs one quantity — **observed yield in tonnes per hectare, keyed by
(state, district, crop, season, year)** — from a source that is:

1. **attributable** to a named publisher, with a URL that can be re-fetched;
2. **licensed** for use in a product, with the attribution obligation known;
3. **granular** to the district a farmer actually lives in *today*, not to a historical
   boundary;
4. **recent** enough that the vintage can be disclosed without the number being useless;
5. **observed**, not modelled — a government return, not somebody's estimate.

Requirement 3 is what eliminated the most academically respectable candidate; see
ICRISAT DLD below.

---

## Candidates evaluated

| # | Candidate | Publisher | Coverage | Licence | Score | Outcome |
|---|---|---|---|---|---|---|
| A | **Area, Production, Yield (APY) — Crop Wise** | India Data Portal (ISB Bharti Institute), from DES | **1997-98 → 2022-23**, 34 states, **740 districts**, 115 crops, 455,359 rows | ODC-By / CC BY 4.0 (see conflict below); upstream GODL | **9/10** | ✅ **PRIMARY** |
| B | District-wise, season-wise crop production statistics from 1997 | Ministry of Agriculture & Farmers Welfare via data.gov.in | 1997 → 2014-15, 246,091 rows | GODL-India | **6/10** | ✅ **verification oracle** |
| C | Area, Production & Yield reports | DES (`data.desagri.gov.in`) | 1997-98 → **2023-24** | GODL-India | 5/10 | ⏸ future refresh path |
| D | UPAg — Unified Portal for Agricultural Statistics | DA&FW | → 2023-24 | GoI | 3/10 | ✗ login-gated |
| E | District Level Database (DLD) | ICRISAT | 1966 → 2015-16, 20 states, 571 districts | research use, unverified | 5/10 | ✗ wrong geography |
| F | District Crop Area Production Yield Dataset | AIKosh (IndiaAI / MeitY) | "N.A." | claims "MIT" | 2/10 | ✗ metadata stub |
| G | Assorted "Crop Production in India" sets | Kaggle | ≤2014 | unstated | 2/10 | ✗ no provenance |

### Why A won

It is the only candidate that satisfies all five requirements at once. It carries an
explicit `yield` column **with its unit named in a sibling column**, and — decisively —
`state_code` / `district_code` (LGD codes) that were verified to be a **perfect 1:1
bijection with the district names**, 740 codes, zero collisions in either direction.
That gives the feature a canonical district key, which this repository has never had:
`shared/constants/geo` is empty by decision, and both `marketNormalizer.js` and
`climate-normals.js` record the same absence.

### Why the others lost

**B (data.gov.in)** is the more authoritative publisher and the only one with a live
API, and it stays in the design as both the verification oracle and the eventual live
refresh path. It loses as the primary source on three counts, all live-verified rather
than assumed: it **ends at crop_year 2014-15** (2013 → 13,650 rows, 2014 → 10,973,
2015 → 562, 2016 and later → 0), it has **no yield column** and **no unit metadata at
all**, and it carries pre-2015 district names. Eight missing years matter when the
whole feature turns on "the last five available years".

**C (DES portal)** is the freshest and most authoritative of all, reaching 2023-24. It
is a client-rendered report portal; no bulk API was found. It is the right place to
refresh from later, by hand, once.

**E (ICRISAT DLD)** is excellent scholarship and the wrong shape for this product. Its
apportioned database maps everything onto **1966 district boundaries** so that a
50-year time series is internally comparable. That is precisely what a researcher wants
and precisely what a farmer's `Farm.location.district` cannot be matched against. It
also covers 20 states only and ends 2015-16.

**F (AIKosh)** publishes no temporal coverage, no columns, no units, a file size of 0
and 0 downloads, and declares an "MIT" licence — which is not a licence any Government
of India statistical release carries. An unreliable metadata record is worse than none.

**G (Kaggle)** are undocumented derivatives of B. Rejected on the standing rule against
adopting a dataset because it happens to have a yield column.

---

## What was acquired

```
source    India Data Portal — Crop Wise Area Production Yield
url       https://ckandev.indiadataportal.com/dataset/f2bbc28c-6c7c-462b-9064-ea4c4213d466/
          resource/f980409d-49a2-42ae-9eb0-182365005c04/download/crop-wise-area-production-yield.csv
retrieved 2026-08-14      bytes 56,222,102      rows 455,359 + header
sha256    fe10fbf129b3501bbb3d282c7600402a8ed7248c116f2cc9428bc2b573d1d4a9
columns   id, year, state_name, state_code, district_name, district_code,
          crop_name, crop_code, crop_type, season,
          area, area_unit, production, production_unit, yield, yield_unit
```

No API key and no authentication. A `HEAD` request returns 403; a `GET` with an
ordinary browser `User-Agent` succeeds — worth knowing before anyone concludes the URL
is dead.

The raw file lives at `datasets/yield/raw/` and is **gitignored**, like every other raw
dataset in this repository. The machine-readable acquisition record is
`datasets/yield/metadata/source-manifest.json` and **is** committed, matching how
`datasets/manifest-raw.json` carries the ML sets' provenance.

---

## Provenance verification

A mirror is only worth its fidelity, so it was checked three ways rather than trusted.

**1 · Exact row match against the originating authority.** The same cell, fetched from
data.gov.in's own API:

| | area (ha) | production |
|---|---|---|
| India Data Portal | 269,400 | 1,142,600 |
| data.gov.in API | 269,400 | 1,142,600 |

*(Gujarat / Amreli / Cotton(Lint) / Kharif / 2010-11.)* Identical.

**2 · State yields against published DES state figures.** Wheat 2022-23: computed
Punjab 4.71 t/ha against a published ≈4.66; Uttar Pradesh 3.735 against ≈3.66.

**3 · National cotton yield against USDA FAS / PIB.** Detailed in the audit — it both
validates the file and exposes a unit defect.

### One check that did not pass, stated plainly

Summing district rows to national totals runs **~14–15% above the published all-India
wheat and rice figures**, while every yield — national, state and district — matches.
Indian district returns are not required to reconcile to DES state estimates, which
derive from crop-cutting experiments rather than from district arithmetic; that is the
likely explanation and it is **not proven here**, so it is recorded as open rather than
waved away.

It does not affect this feature: the estimator reads per-district yields and never sums
them. Closing it properly needs a wider row-by-row cross-check against data.gov.in,
which needs a registered key (OD-5).

---

## Licence findings

**The upstream data is unambiguous.** The Government Open Data License – India (GODL)
grants a worldwide, royalty-free, non-exclusive licence to use, adapt and create
derivative works **for commercial and non-commercial purposes**, with attribution
mandatory in the form
`[Provider], [Year], [Dataset Name], [Repository], [Date], [URL]. Published under [Licence]: [URL]`.
Zero-cost rule (CLAUDE.md 10) satisfied; nothing here is paid or quota-limited.

**The mirror's own licence is contested, and is recorded as contested.** The CKAN
catalogue field says *Open Data Commons Attribution License*; the portal's site footer
says *Creative Commons Attribution 4.0 International*. The copyright policy page is
client-rendered and could not be captured. All three readings — ODC-By, CC BY 4.0,
GODL — permit commercial use and require attribution, so **the discrepancy does not
change what we may do**, but the exact text is still owed to `datasets/licenses/`.

This is handled the way ADR-012 handles PlantVillage's contested licence: comply with
the strictest reading, record the conflict where a reviewer will see it, and **do not
redistribute** the raw file. Only the manifest, the audit report and the derived lookup
are committed.

**Attribution obligation, to be rendered on-screen wherever a yield estimate appears:**

> Directorate of Economics & Statistics, Department of Agriculture & Farmers Welfare,
> Government of India — *Area, Production and Yield of crops, district-wise and
> season-wise*, via India Data Portal (ISB), accessed 2026-08-14.

---

## Credential disclosure

The data.gov.in probes in this record used **the portal's own published sample key**,
which data.gov.in prints on every resource page. It is a documented public demo
credential, not a secret; it appears nowhere in this repository; and its quota was
exhausted partway through the audit, which is exactly why it cannot serve a product.

Volume ingestion still requires a registered `DATAGOVIN_API_KEY` — open decision **OD-5**,
unchanged. Nothing in this feature depends on it: the primary source needs no key.

---

## Sources

India Data Portal APY catalogue `ckandev.indiadataportal.com/dataset/area-production-yield-apy` ·
India Data Portal / ISB Bharti Institute `isb.edu/faculty-and-research/bharti-institute-of-public-policy/india-data-portal` ·
data.gov.in resource `35be999b-0208-4354-b557-f6ca9a5355de` (catalog `f4435c3b-96be-4002-9839-aa3897dc732b`) ·
GODL-India `data.gov.in/government-open-data-license-india` ·
DES APY reports `data.desagri.gov.in/website/crops-apy-report-web` ·
UPAg `upag.gov.in` · ICRISAT DLD `data.icrisat.org/dld` ·
USDA FAS India cotton `ipad.fas.usda.gov/countrysummary/Default.aspx?id=IN&crop=Cotton` ·
PIB cotton 2022-23 release PRID 1897932.
