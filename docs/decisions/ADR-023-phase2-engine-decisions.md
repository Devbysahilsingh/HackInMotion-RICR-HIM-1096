# ADR-023 — Phase-2 engine decisions (irrigation, weather risk, crop-rec, feed)

**Status:** Accepted · 2026-08-13 · amends `docs/irrigation/irrigation-model.md`, `docs/irrigation/calculation-rules.md`, `docs/weather/weather-architecture.md`, `docs/crop-recommendation/engine.md`, `docs/api/recommendations.md` and `docs/api/weather.md`

## Context

Phase 2 turned five specified-but-unbuilt engines into code. The specifications are unusually precise about *inputs* and mostly silent about the points where a formula meets missing, mis-scaled or contradictory evidence. Eight such points had to be settled to write the code at all; each is a judgement rather than a transcription, so each is recorded here rather than left as a comment in a file nobody reads twice.

The constant pressure across all eight is CLAUDE.md rule 7: no fabricated anything. Where a decision looks conservative, that is why — the alternative was always a plausible number nobody could source.

## Decisions

### 1. Kc interpolates across LATE, not only DEVELOPMENT

`deriveStage` held Kc flat at the registry's published LATE value for the whole late season. That value is FAO-56's **Kc_end** — the coefficient reached at the *end* of the season — and FAO-56 defines the late season as a linear decline from Kc_mid to it. `crops.agronomy.json` `conventions.lateStageKc` says so explicitly. Both DEVELOPMENT and LATE therefore interpolate; they differ only in which endpoints they span (Kc_ini → Kc_mid, and Kc_mid → Kc_end).

The magnitude is not marginal: wheat declines 1.15 → 0.25 over 30 days, so flat-holding modelled the entire late season at the harvest-day value and understated ETc across grain fill. An interpolation endpoint that is not sourced still yields `kc: null` and a degraded mode — the fix adds interpolation, not invented endpoints.

### 2. Rice bypasses the depletion branch; `RAW = p × TAW` is never computed for it

FAO-56 Table 22 footnote 4 defines rice's `p = 0.20` as a fraction **of saturation**, not of total available water as it is for every other crop in the table. `RAW = p × TAW` is therefore not merely imprecise for rice — it is the wrong formula, and it would have produced a confident irrigation depth for the one crop where standing water, not depletion, is the management variable.

`registry.paddyFlooding === true` exits the rule ladder at R11, before TAW or RAW exist, returning the new verdict `MAINTAIN_WATER_LEVEL` with `targetDepthCm {min:2, max:5}` and no `amountMm`. This is a bypass, not the "verdict phrasing switch" the model document described. It is registry-driven, so rule 4 holds: the engine contains no crop code.

### 3. IST is the single day boundary for every engine and job

`date.setHours(0,0,0,0)` — the obvious way to write "start of day" — uses the host's zone. Render runs UTC, so on the deployed instance that boundary sits at 05:30 IST: between 18:30 and midnight IST "today" silently becomes tomorrow, which shifts an irrigation ledger entry into the wrong day, splits an evening's rain across two rows, and lets a feed item overlap the next day's dedup key. It would have passed every test on an IST laptop and failed only in production.

`utils/day.js` is the one place that knows the offset (a constant — India has no DST) and every engine, job and key derives its day from it. The same boundary is pushed upstream: Open-Meteo is queried with `timezone=Asia/Kolkata` and OpenWeatherMap's 3-hourly steps are folded by IST date, so the providers and we agree about which day a night-time rain belongs to.

### 4. Weather-risk severity banding is declared engine policy, and thresholds are labelled

The architecture document defines level as `f(magnitude, crop stage sensitivity, imminence)` and never defines `f`. The engine defines it: a magnitude band in a named per-risk unit, **+1** for FAO-56 MID (the only stage-sensitivity signal the registry supports), **+1** for today/tomorrow, **−1** beyond five days, clamped to LOW…CRITICAL. Every input to that arithmetic is in the trace.

This is policy, not agronomy, and so are the engine defaults used where a crop publishes no `sensitivity` threshold. Because a farmer asking "why?" must not be shown a generic number dressed as a crop-specific one, **every emitted risk carries `thresholdSource: 'REGISTRY' | 'ENGINE_DEFAULT'`**. The alternative — silently defaulting — would have made the registry's coverage gaps invisible precisely where they matter.

### 5. Crop-rec excludes factors with no evidence and renormalises the weights

Two of the four documented scoring inputs do not exist in this repository: district climate normals (the table is empty, so S_temp is never computable and S_water only for irrigated farms) and `soilSuitability` (published for one of nine crops).

A factor with no evidence is **excluded from the weighted mean and its weight removed from the denominator**, rather than defaulted to a neutral 0.5. A neutral default is a guess wearing a score's clothing, and it would rank crops against each other on numbers nobody sourced. The cost is that a crop scored on two factors is not directly comparable to one scored on four — so each result reports `evidenceRatio` (how much of the documented weight was actually backed by data), each excluded factor appears in `cautions`, and the whole run reports `limitations` naming what the ranking could not consider. Ties break on `evidenceRatio` before crop code, so better-founded rankings win.

### 6. Feed ordering happens in memory, not in the index

The documented order is CRITICAL > HIGH > MEDIUM > INFO, but the `feed` index sorts `priority: 1` — the *strings*, ascending — which yields CRITICAL, HIGH, INFO, MEDIUM. INFO above MEDIUM is precisely backwards for a farmer.

Rather than reshape the index (a numeric rank column would duplicate state that can drift from the enum), the composer orders a bounded candidate set in memory against an explicit `FEED_PRIORITY_RANK`, then type precedence, then the dedup key so the order is total and two identical runs render identically. The set is bounded by the 20-item per-user cap, so this is cheap; the index still serves the *query*, just not the sort.

### 7. `dedupKey` is a stored field with a unique index

`docs/api/recommendations.md` asks for "idempotent upserts, dedupe type+cropId+day". That tuple is insufficient and has nowhere to live: two simultaneous weather risks on one crop share it (one would silently overwrite the other — the frost warning disappearing behind the rain warning), farm-level items have no `cropId`, and it omits `userId`, so keys collide across accounts.

The composed key `userId | type | cropId-or-farm:farmId | discriminator | IST day` is stored on the document with a unique index. Idempotency is then enforced by the database on a single indexed equality, not by job logic — the same structural guarantee `marketPrices` already gets from `(commodityCode, market, date)`. A re-run is a no-op at the storage layer, which is a much stronger claim than a re-run being careful.

### 8. No on-demand provider fetch on the weather request path

`docs/api/weather.md` and `docs/api/farms.md` both specified an "immediate on-demand fetch (8s)" for a brand-new location. CLAUDE.md rule 3 forbids it outright ("request paths never call weather/market providers"), and P1-5 had already resolved the identical conflict in the rule's favour for `locationKey`.

The rule wins. A location with no snapshot returns 200 with `freshness.status:'pending'`, `retryAfterSeconds: 180` and a `reason` of `awaiting_first_fetch` or `no_coordinates`, and the cell is queued for priority refresh which the next scheduler tick drains ahead of the routine sweep. The farmer waits for a tick, not for a provider; the request path cannot be made slow, cannot burn free-tier quota per view, and cannot 5xx because someone else's API is down. `no_coordinates` is distinguished honestly: without a district-centroid table there is nothing to fetch, and inventing one would fabricate a location.

## Consequences

**Gained:** two agronomic errors (LATE Kc, rice RAW) removed before they ever reached a farmer; one class of production-only timezone bug removed structurally; three places where the system could have presented a guess as a sourced number now label themselves (`thresholdSource`, `evidenceRatio`, `flagged`); feed idempotency enforced by the database.

**Lost / accepted:** severity banding, the drought penalty ramp and the irrigation heuristics are project policy with no external citation — they are named, traced and labelled as such, but a reviewer should not read them as sourced agronomy. Crop-rec rankings currently rest on a fraction of the documented weight, and will keep doing so until `shared/constants/climate-normals.js` and the registry's `soilSuitability` coverage are filled in.

**Not affected:** the registry-driven rule (no crop-code conditionals survive any of this), engine purity, and the API envelope.

## Alternatives rejected

- **Neutral 0.5 for missing crop-rec factors** — produces a complete-looking score from incomplete evidence; the farmer cannot tell the difference and neither can the ranking.
- **Clamping a negative ETc-corrected `p` to zero** instead of discarding the correction — zero `p` makes RAW zero and `D ≥ RAW` permanently true, i.e. "irrigate today" forever at zero depletion. The published table value is the safer fallback, and FAO's own validity limits are not transcribed in this repository.
- **A numeric `priorityRank` field on `recommendations`** to let the index sort correctly — duplicated state that can drift from the enum, for a set small enough to sort in memory.
- **`node-cron` for scheduling** — a dependency against a locked list, and it would have made "what runs at 02:00 on the 3rd tick" untestable without waiting or faking timers (see docs/backend/architecture.md).
- **Keeping the on-demand weather fetch** and treating rule 3 as advisory — the rule exists to keep p95 independent of third parties and quota independent of traffic; both are load-bearing on the free tier.

## Follow-up

The documents listed in the status line were corrected in the same change. Open items this ADR does **not** settle: the AWC table's provenance (`shared/constants/agronomy.js` — sourced only to a prose line in `irrigation-model.md`, four keys are ICAR soil orders FAO-56 does not tabulate; requires primary verification before demo) and the empty `shared/constants/geo` and `climate-normals` tables, which gate the crop-rec water/temp factors and market geography canonicalisation.
