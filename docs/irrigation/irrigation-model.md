# Irrigation Model — FAO-56 Simplified Water Balance

## DATA vs CALCULATION vs RECOMMENDATION (strict separation)
- **DATA:** ET₀ series (weather snapshot), rain past/forecast + probability, crop Kc curve + rootDepth + depletionFraction p (registry, FAO-56 sourced), soil type → AWC (available water capacity, mm/m; sourced table below), sowing date, irrigation logs.
- **CALCULATION:** pure function `computeIrrigation(crop, registry, snapshot, logs) → {verdict, amount, trace}` — deterministic, no I/O, unit-tested against FAO worked examples.
- **RECOMMENDATION:** i18n rendering + priority mapping + feed emission. Presentation never alters math.

## The model
1. **Stage & Kc:** days since sowing vs registry kcStages (INITIAL/DEVELOPMENT/MID/LATE with FAO-56 durations per crop) → current Kc. **Two** stages interpolate, not one: DEVELOPMENT spans Kc_ini → Kc_mid (the neighbours' values; the stage itself publishes none) and **LATE spans Kc_mid → Kc_end**, because the Kc stored on LATE is FAO-56's Kc_end — the value at the *end* of the late season, not an average over it (`crops.agronomy.json`, `conventions.lateStageKc`). Holding LATE flat at Kc_end, as the engine originally did, models the whole late season at the harvest-day value: wheat declines 1.15 → 0.25 over 30 days. An interpolation endpoint that is not sourced yields Kc = null and a degraded mode, never an invented number. Harvested/planned crops → no verdict.
2. **Crop water use:** `ETc(d) = ET₀(d) × Kc` (mm/day).
3. **Soil reservoir:** `TAW = AWC(soil) × rootDepth(crop, stage-adjusted)`; `RAW = p × TAW`. AWC table (mm/m): sandy 60–100 · loamy 140–180 · clay 170–220 · black(vertisol) ~200 · alluvial ~150 · red ~120 · laterite ~100 · unknown → 120 + wider uncertainty note.
   - **As built:** these live in `shared/constants/agronomy.js` as `SOIL_AWC_MM_PER_M`, each entry carrying the `published` text alongside the `value` the engine uses; the three ranges resolve to their midpoint, which is an assumption this document already commits to. `unknown` is flagged `wideUncertainty` so the engine can lower its claim strength rather than present a modelled number with the same confidence as a known soil.
   - **Provenance caveat (open verification task).** The claim above that "sourced refs [are] in registry seed" is false — the seed contains no soil data — and the attribution "FAO Ch.: soil water properties" names no chapter, table or URL. Four of the eight keys (black, alluvial, red, laterite) are ICAR soil *orders*; FAO-56 Table 19 is organised by USDA texture class and does not tabulate them, so those four cannot have come from it directly. The values are therefore transcribed exactly as printed here, share one `AWC_SOURCE_REF` marked `confidence: 'S'` (this document, not a primary source), and are listed as requiring primary verification before demo. Nothing was invented, averaged from elsewhere, or silently upgraded to the FAO-sourced tier that `crops.agronomy.json` uses.
   - **p is ETc-corrected before RAW.** FAO-56 Table 22 footnote 2: published p assumes ETc ≈ 5 mm/day, corrected by `p = p_table + 0.04 × (5 − ETc)`. Applied with mean ETc over the verdict horizon; a corrected p outside (0, 1] is discarded in favour of the table value (see calculation-rules.md).
4. **Depletion ledger:** daily `D += ETc − effectiveRain − irrigationLogged`, clamped [0, TAW]. Effective rain = 0.8 × rain (runoff/evap discount, assumption documented). Initialization (cold start): replay past-7-days weather from snapshot; farmer's first "I irrigated" or sowing date sets D=0 ("assumed field capacity", flagged `initialized:false` until a log or 7 rain-days anchor it).
5. **Verdict horizon (next 5 days):** project D forward with forecast ETc and probability-weighted rain (counted when prob ≥60%).
   - D crosses RAW today → **IRRIGATE_TODAY**, amount = D (mm) rounded to 5mm, capped by method note (drip vs flood phrasing).
   - Crossing in n≤5 days, no qualifying rain first → **IRRIGATE_IN_N_DAYS**.
   - Qualifying rain ≥ deficit before crossing → **WAIT_RAIN_EXPECTED** (with date + mm + prob shown).
   - No crossing in horizon → **NO_IRRIGATION_NEEDED** (next check date).
   - Rice special-case: registry flag `paddyFlooding` → verdict `MAINTAIN_WATER_LEVEL`, standing-water management (maintain 2–5cm; FAO-56 single-Kc caveat documented) — honest limitation, not fake precision. This is a **bypass, not a phrasing switch**: the engine leaves before TAW/RAW are computed, because Table 22 footnote 4 defines rice's p as a fraction of saturation rather than of TAW (ADR-023).
6. **Amount conversion:** mm × 4046.86 → liters/acre (shown both; "≈2 hours of 5HP pump" future).
7. **Simplified mode (no ET₀):** rain-window heuristics (rain ≥10mm within 48h prob≥60% → wait; else stage-based interval table per crop from registry) — clearly labeled `mode:'simplified'`, lower claim strength.

## Avoiding dangerous false precision
Amounts rounded to 5mm; ranges when soil=unknown; every number in the trace; assumptions (0.8 effective-rain, AWC midpoints, probability threshold) listed in docs and viva-ready. No claim of sensed soil moisture — it's a modeled estimate, labeled.

## Test vectors (engine unit tests)
FAO-56 example-style cases + property tests: rain > ETc ⇒ D non-increasing; irrigation log resets D≈0; sandy soil crosses RAW before clay under identical weather; Kc(MID) > Kc(INITIAL) for all seeded crops; verdict monotonicity vs rain probability.
