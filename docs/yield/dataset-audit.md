# Yield Dataset Audit — quality, defects and sufficiency

**Status: audit executed 2026-08-14 against the acquired file.** Every figure below was
computed by streaming the raw CSV recorded in `docs/yield/dataset-research.md`
(sha256 `fe10fbf1…`, 455,359 rows). Nothing here is estimated or carried over from
another document.

The audit answers one question: **can the transparent estimator in
`docs/yield/yield-estimation.md` actually be built from this data, and for which crops?**
Answer: yes, for seven of nine registry crops. Cotton is excluded by decision, tomato by
evidence.

> **Reproducibility.** The findings are stated here as prose and tables. The
> machine-readable `datasets/yield/metadata/quality-report.json` is emitted by the
> refinement pipeline (Milestone 2), not hand-written, so the numbers below are
> re-derivable rather than asserted. Where the pipeline's output later disagrees with
> this document, the pipeline is right and this document is stale.

---

## 1 · Structural integrity — clean where it counts

| Check | Result |
|---|---|
| Rows parsed | 455,359 · **0 malformed** (every row has all 16 columns) |
| Duplicate `(state, district, crop, season, year)` | **0** |
| `yield == production ÷ area` | **455,359 / 455,359 exact** (tolerance `max(0.005, 2%)`) |
| Negative area / production / yield | **0 / 0 / 0** |
| `district_code` → `district_name` | **bijective**: 0 codes with multiple names, 0 names with multiple codes |
| Unit label consistency | uniform `Hectare` / `Tonnes` / `Tonnes/Hectare` — but see **D4** |
| Encoding | UTF-8, LF, unquoted, no embedded newlines |
| Missing values | `production` 5,009 (1.1%) · `crop_code` 21 · every other column **0** |

Two consequences worth stating. First, **`yield` is derived, not independently keyed** —
area and production are the primary quantities and the yield column is arithmetic over
them, so there is no third number that could disagree. Second, the **bijective district
code** is the canonical geographic key this repository has lacked; the 740 codes are a
candidate to become the gazetteer that `shared/constants/geo` has been holding a space
for.

---

## 2 · Defects found

Six. None was silently dropped; each gets a named rule in the pipeline and a counter in
the quality report.

### D1 · `season = "Total"` is an aggregate, not a season — 48,044 rows

Verified rather than assumed: across Rice, Maize and Onion, `Total` equalled the exact
sum of that district-crop-year's season rows in **15,493 cases with 0 disagreements**.

Treating it as a season would double-count. Treating it as the **district all-season
tier** hands us the spec's fallback tier 2 as *published rows* rather than as our own
arithmetic over other rows — strictly better provenance than the spec assumed.

### D2 · `season = "Whole Year"` is the primary tier for horticulture — 81,403 rows

Not a fallback. For the vegetable and spice crops it is where most of the data is:

| Crop | districts reported by season | districts reported annually |
|---|---|---|
| Potato | 369 | **537** |
| Onion | 393 | **504** |
| Chilli | 321 | **527** |

The tier ladder has to know this, or the crops with the most annual data would be the
ones most often answered "insufficient evidence".

### D3 · `Autumn` and `Winter` have no enum member — 17,650 rows

These are the eastern rice seasons (*aus* / *boro* in West Bengal, Assam, Odisha). They
are not `KHARIF`, `RABI` or `ZAID`. **They stay unresolved and are counted as dropped.**
Mapping them by resemblance would misassign whole states' rice, which is the one crop
those states report most of.

### D4 · 🔴 Cotton production is in BALES, mislabeled "Tonnes"

The decisive check, 2022-23:

| | read as tonnes | read as 170 kg bales | published (USDA FAS / PIB) |
|---|---|---|---|
| yield | 2,677 kg/ha — **physically impossible** | **455 kg/ha** | **443 kg/ha** |
| production | 34.5 Mt | **34.5 M bales** | **~35.2 M 170-kg bales** |
| area | 12.891 M ha | 12.891 M ha | 12.8–13 M ha |

The world's best cotton yields are ~1,800 kg lint/ha; India's national average is under
500. Read as tonnes the figure is impossible; read as 170 kg bales it lands within 3%
of the published number, three years running (2019-20: 418 vs 436; 2020-21: 421 vs 445;
2022-23: 455 vs 443).

So the `production_unit` and `yield_unit` labels are **wrong for cotton**, and the
data.gov.in original — which ships no unit metadata at all — cannot correct them.

**Decision (project owner, 2026-08-14): COTTON IS EXCLUDED FROM v1.** The ×0.17
conversion is *not* applied on the strength of this inference. It ships only once a
citable DES or Ministry of Textiles definition of the bale is captured. Cotton stays
documented as conditionally supported and moves to future scope — the data itself is
complete and current (450 districts, 438 district-season combinations, latest year
2022-23), so this is a citation gate, not a data gate.

The same defect near-certainly applies to Jute and Mesta (180 kg bales) and Coconut
(nuts). None is a registry crop; noted so nobody adds one casually.

### D5 · Extreme outliers are a locatable source defect, not noise — 118 rows

118 rows exceed any physiological ceiling. Every top case is a tiny-area row:

| crop | district | year | area | production | implied yield |
|---|---|---|---|---|---|
| Rice | Kolhapur (MH) | 1997-98 | 1,100 | 246,100 | 223.7 t/ha |
| Maize | Nashik (MH) | 1997-98 | 1 | 1,494 | 1,494 t/ha |
| Onion | Srikakulam (AP) | 2017-18 | 2 | 8,140 | 4,070 t/ha |

Read Kolhapur's area as *hundreds* of hectares (110,000 ha) and the yield becomes
2.24 t/ha, which is unremarkable. **Maharashtra 1997-98 has area recorded at the wrong
magnitude.** This is diagnosis, not repair: the rows are dropped and counted, never
rescaled, because rescaling would mean asserting a correction to a government return on
the basis of a pattern.

Median aggregation over the last five years already suppresses most of these — the
affected years are largely outside the window — but an explicit sanity gate is still
required so the residue cannot reach a farmer.

### D6 · Zero-production rows are "reported nil", not zero yield — 569 in the target crops

They must never enter a median, which they would drag toward zero. Per crop:
Maize 253 · Cotton 196 · Chilli 103 · **Tomato 93** · Onion 60 · Rice 52 · Soybean 41 ·
Potato 37 · Wheat 32.

---

## 3 · Nomenclature caveats that must reach the screen

Two source crop names do not mean what a farmer will assume, and both are load-bearing:

- **`Dry Chillies` is dry weight.** Median yield ~1.0 t/ha. A green-chilli grower
  reading this as their own expected harvest would be badly misled — green chilli yields
  are several times higher. The disclaimer must say *dry*.
- **`Cotton(Lint)` is ginned lint,** not kapas (seed cotton). Moot in v1 since cotton is
  excluded, but it is the second half of why cotton is gated.

---

## 4 · Refinement rules

Applied to the nine registry crops (130,164 of the 455,359 rows). Every rule produces a
counter; nothing is discarded silently.

| Rule | Action | Rows |
|---|---|---|
| crop not in the registry | out of scope | 325,195 (of the full file) |
| `season = "Total"` | routed to the **district all-season** tier | 19,024 |
| `season = "Whole Year"` | routed to the **district annual** tier | 18,529 |
| `season ∈ {Autumn, Winter}` | **unresolved — dropped, counted** (D3) | 10,726 |
| `area ≤ 0` | dropped | 0 |
| `production` blank or `≤ 0` | dropped (D6) | 569 |
| `yield ≤ 0` | dropped | 1 |
| **survives to the seasonal tier** | | **81,315** |

`19,024 + 18,529 + 10,726 + 569 + 1 + 81,315 = 130,164` ✓

Season mapping is exact and closed — no fuzzy matching:

```
Kharif → KHARIF     Rabi → RABI     Summer → ZAID
Total  → (district all-season tier)  Whole Year → (district annual tier)
Autumn, Winter → UNRESOLVED
```

Crop mapping is likewise exact, and belongs in `CropRegistry.yield.apyCropName` — a
field the schema already declares and nothing has ever populated:

| registry code | `apyCropName` | rows | status |
|---|---|---|---|
| RICE | `Rice` | 31,636 | ✅ |
| WHEAT | `Wheat` | 12,905 | ✅ |
| MAIZE | `Maize` | 30,781 | ✅ |
| SOYBEAN | `Soyabean` | 6,160 | ✅ |
| ONION | `Onion` | 14,822 | ✅ |
| POTATO | `Potato` | 14,108 | ✅ |
| CHILLI | `Dry Chillies` | 11,141 | ✅ dry-weight caveat |
| COTTON | `Cotton(Lint)` | 8,204 | ⛔ excluded v1 (D4) |
| TOMATO | `Tomato` | 407 | ⛔ unsupported (§5) |

---

## 5 · Sufficiency

Coverage after refinement. "≥3 obs" counts district-season combinations having at least
three observations within the last five *available* years for that combination.

| Crop | districts | district×season combos | ≥3 obs | with full 5 | annual-tier districts (≥3) | all-season districts | state×season groups | latest year |
|---|---|---|---|---|---|---|---|---|
| RICE | 722 | 1,151 | **986** | 872 | 98¹ | 463 | 57 | 2022-23 |
| MAIZE | 715 | 1,454 | **1,268** | 1,182 | 156¹ | 482 | 61 | 2022-23 |
| WHEAT | 636 | 680 | **619** | 583 | 60¹ | 28 | 34 | 2022-23 |
| ONION | 393 | 691 | **535** | 496 | **410** | 216 | 36 | 2022-23 |
| POTATO | 369 | 578 | **439** | 387 | **460** | 208 | 35 | 2022-23 |
| SOYBEAN | 436 | 509 | **393** | 319 | 54¹ | 71 | 27 | 2022-23 |
| CHILLI | 321 | 475 | **293** | 264 | **449** | 142 | 25 | 2022-23 |
| ~~COTTON~~ | 450 | 578 | 438 | 387 | 58 | 109 | 34 | 2022-23 |
| **TOMATO** | **13** | **26** | 26 | **0** | **0** | 13 | 2 | **2014-15** |

¹ district count only; the ≥3-observation figure was measured for the horticultural
crops, where the annual tier carries the data, and is not yet measured for the cereals,
where it is a minor fallback. The pipeline will emit it for all.

A worked example of exactly what the estimator computes — real rows, nothing invented:

```
RICE · Andhra Pradesh · Ananthapuramu · KHARIF
  2022: 3.693   2021: 2.081   2020: 2.724   2019: 3.610   2018: 2.674   t/ha
  median 2.724      SD 0.684
```

### Tomato is unsupportable — the numbers, not a judgement call

- **13 districts** across 7 states with any seasonal record at all.
- **5 distinct years**, the most recent **2014-15** — eleven years stale.
- **0 combinations** have a full five years.
- **93 of 407 rows (23%)** report zero production.
- The annual tier looks better at 115 districts until you read its dates: **the latest
  `Whole Year` tomato observation is 2003**, and **0 districts** reach three
  observations in five years.

This confirms rather than contradicts the original spec, which flagged tomato as
"368 district records only → state-tier fallback + low-confidence label". Having now
counted, even the state tier is 2 groups ending in 2014-15. **Tomato returns
`INSUFFICIENT_EVIDENCE`.** There is no honest fallback for it, and a low-confidence
label on eleven-year-old data from 13 districts would be a label doing work that a
refusal should do.

---

## 6 · Verdict

**The `Y_hist` blocker is closed for seven crops:** RICE, WHEAT, MAIZE, SOYBEAN, ONION,
POTATO, CHILLI — 1997-98 to 2022-23, 293–1,268 district-season combinations each with at
least three recent observations, latest observation 2022-23 for the large majority, from
Government of India returns whose fidelity was verified three ways.

**Cotton** is gated on one citation, not on data.
**Tomato** is gated on evidence that does not exist.
**Autumn/Winter rice** stays unresolved by choice.

Still open, and not required by this milestone: no canonical state/district gazetteer
exists yet to match `Farm.location.district` against (the 740 codes are the candidate);
and the `F_irrigation` / `F_event` multipliers still need re-verification against their
cited sources before either is coded.
