# ADR-026 — Yield estimation: evidence ladder, and why the spec's two multipliers are not applied

**Status:** Accepted · 2026-08-15
**Supersedes in part:** the estimator formula in `docs/yield/yield-estimation.md`
**Context:** `docs/yield/dataset-research.md`, `docs/yield/dataset-audit.md`

---

## 1. The formula the spec asked for

```
Estimated production = Y_hist × A × F_irrigation × F_event
F_irrigation ∈ [0.75, 1.15]   basis: Zaveri & Lobell, Nat. Comms 2019
F_event      ∈ [0.70, 1.00]   basis: Dhaliwal 2015 (15–25% average pest losses)
```

## 2. What shipped

```
Estimated production = Y_hist × A
Range                = (Y_hist ± 1 SD) × A
```

Both multipliers are **reported as considered and not applied**, each carrying
its citation and a farmer-readable reason. The qualitative facts they were meant
to encode are surfaced as caveats instead.

## 3. Why

Both citations are real, and neither supports multiplying a district **median**.
Applying them anyway would have produced a number that *looks* sourced and is
not — which is worse than an unadjusted one, because the citation makes it
harder to question.

**F_irrigation.** `Y_hist` is the median yield of every field in the district,
irrigated and rainfed together. Where a particular field sits relative to that
blend depends on the district's irrigated-area share: a rainfed field in Punjab
(almost entirely irrigated) sits far below the median, while a rainfed field in
a district that is 5% irrigated sits roughly *at* it. Zaveri & Lobell measure
irrigated versus rainfed yields — a different quantity from "where does this
field sit within its district's mix". The share we would need is not in this
repository.

**F_event.** Dhaliwal reports an *average annual* loss to insect pests (~15.7%
in India at present). The years behind `Y_hist` were real years with real pests,
so that loss is already inside the observed yields. Multiplying by it again
subtracts the same loss twice. What the formula wants is the *incremental* loss
from one logged outbreak above a district's normal pest pressure; that is not
what the source measures and it is not published anywhere we have.

A third consideration decided the tie: the spec's own instruction is "max 3
factors — compounding many small factors manufactures false precision". Two
factors that cannot be defended are not a smaller error than three; they are the
error the instruction exists to prevent.

## 4. What replaces them

Qualitative caveats, which need no coefficient and state something true:

| Condition | Shown |
|---|---|
| `irrigationMethod === 'rainfed'` | "Your field is rainfed. The district average includes irrigated fields, so your harvest may be lower." |
| irrigation unknown | the district average mixes both, and we do not know which this is |
| a health event logged in 120 days | "This estimate does not account for it." |
| `latestYear` ≥ 3 years old | the vintage, in years |
| `n < 5` observations | how thin the sample is |

This tells a farmer **which way** the number is likely to be wrong without
pretending to know **by how much**.

## 5. Reopening this

The framework is in place and each factor is a data change away from applying.
`F_irrigation` needs a sourced district irrigated-area share (the DES *Land Use
Statistics* series is the obvious candidate). `F_event` needs a published
incremental-loss figure per crop and severity, not an annual average. Neither is
blocked on code.

---

## 6. Other decisions recorded here

**6.1 The ladder is four rungs, and a miss is an answer.**
`district × season → district annual → state × season → state →
INSUFFICIENT_EVIDENCE`. The endpoint answers **200 with `estimated: false`**
rather than an error: "we have no records for your crop here" is an answer, and
a 4xx would be indistinguishable from the crop not existing.

**6.2 District names are matched exactly, never fuzzily.**
The source carries post-rename names (Ananthapuramu, Dharashiv, Ahilyanagar). A
farmer who typed the older one misses the district rungs and lands on the state
tier, **and the response says so**. A near-match would silently attribute
another district's harvest history to their field, with no way for them to know.

**6.3 `Total` rows never enter the state tiers.**
They are the sum of the season rows already there (audit D1), so pooling them
would weight those districts twice.

**6.4 The two annual sources are never pooled.**
`Whole Year` (reported annually) and `Total` (summed from seasons) describe the
same quantity by different routes. Whichever has more observations wins;
`Whole Year` breaks the tie as a direct report rather than a derived sum. The
entry records which.

**6.5 Bigha produces no total.**
`utils/locationKey.js` already states the rule — the constant is the
north-Indian *pucca bigha*, the unit varies by state, and "no recommendation
ever consumes a converted bigha". A land-ceiling check tolerates that slop; a
quintal figure a farmer plans and sells against does not. The per-hectare basis
is still served, and only the multiplied total is withheld, with a reason.

**6.6 Specificity is not confidence.**
`EXACT | DISTRICT | STATE | BROAD` says how closely the evidence matches the
farmer's field. It says nothing about how likely the estimate is to be right.
Naming it `confidence` would have invented exactly the number rule 9 forbids.

**6.7 Crop scope is data, not code.**
Supported crops are those whose registry entry carries `yield.apyCropName`.
Cotton and tomato carry `null` with their reasons, and no file in `src/` names
either. An unmapped crop surfaces as a `dataGap`.

**6.8 Freshness is always `historical`.**
The lookup is a build artefact from a government release. It is never `live` and
never `cached`, and the age signal shown is `latestYear` — the most recent year
in the records — not the file's build date, which would flatter it by four years.
