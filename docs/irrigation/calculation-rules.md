# Irrigation Calculation Rules (implementation contract)

Module: `backend/src/engines/irrigation/` (pure; no imports from services). Signature:
```ts
computeIrrigation(input: {
  crop: {sowingDate, status, waterBalance:{depletionMm, lastComputedAt, initialized}},
  registry: {kcStages[], rootDepthM, depletionFraction, paddyFlooding?, simplifiedIntervals?},
  soilType, dailyWeather: DailyWx[14],           // past7 + next7, et0 nullable
  logs: {date, amountMm?}[]
}): IrrigationResult                              // verdict, amountMm?, days?, mode, trace
```
Rules R1–R14:
- R1 status ≠ active → NO verdict (designed state).
- R2 mode = 'full' iff every forecast day has et0Mm; else 'simplified'.
- R3 Stage boundaries inclusive-start; beyond LATE end → verdict NO + harvest-approaching note.
- R4 AWC lookup exactly per irrigation-model.md table (constants in `shared/constants/agronomy` with sourceRefs).
- R5 Ledger recompute is idempotent: recompute from max(lastAnchor) where anchor = last log date or initialization point — same inputs, same output.
- R6 Effective rain factor 0.80 (named constant EFFECTIVE_RAIN_COEFF, documented).
- R7 Rain counts in projection iff probPct ≥ 60 (RAIN_PROB_THRESHOLD).
- R8 Log without amountMm → treat as refill to field capacity (D=0) with 'assumed' marker in trace.
- R9 amountMm = ceil(D/5)*5, min 10, max 75 per event (>75 → split advice note).
- R10 D clamps [0, TAW]; TAW uses stage-adjusted root depth: rootDepthM × stageDepthFactor {INITIAL:0.4, **DEVELOPMENT**:0.7, MID:1.0, LATE:1.0}. (This rule originally abbreviated the second key `DEV`; the canonical spelling everywhere else — `GROWTH_STAGES`, the registry `kcStages`, `deriveStage` — is `DEVELOPMENT`, so a literal transcription key-misses and silently applies `undefined`. Corrected here; `STAGE_ROOT_DEPTH_FACTOR` in `shared/constants/agronomy.js` uses the canonical key.)
- R11 paddyFlooding crops bypass R9-R10 depletion phrasing → water-level guidance strings.
- R12 Trace must contain every number used (et0Series, kc, stage, etcMm/day, TAW, RAW, D series, rain projection) — explainability is contractual, UI renders trace verbatim.
- R13 All constants centralized + named; no magic numbers in engine code.
- R14 Missing weather entirely → verdict 'UNAVAILABLE' + pending (200-level designed state; never throws).

## Corrections and additions made while implementing (P2)

| # | What changed | Why |
|---|---|---|
| R10 key | `DEV` → `DEVELOPMENT` (above) | a literal transcription key-misses the stage map and applies `undefined` |
| Kc in LATE | `deriveStage` now interpolates Kc_mid → Kc_end across the late stage instead of holding Kc_end flat | `crops.agronomy.json` `conventions.lateStageKc` requires it. FAO-56's published Kc for LATE is Kc_**end**, the value reached at the *end* of the season. Wheat declines 1.15 → 0.25 over 30 days, so flat-holding modelled the entire late season at the harvest-day value — a large, systematic ETc understatement exactly when a crop is still filling grain |
| Depletion fraction | FAO-56 Table 22 footnote 2's ETc correction `p = p_table + 0.04 × (5 − ETc)` is applied before RAW is derived, using mean ETc over the verdict horizon | the knowledge file transcribes the footnote and states the engine must apply it; published p values assume ETc ≈ 5 mm/day |
| Out-of-range p | a corrected p outside (0, 1] is **discarded** in favour of the published table value, with `correctionRejected` in the trace — not clamped to zero | the linear correction runs off the end of its own validity under extreme demand (≈18 mm/day yields a negative p). Clamping to zero makes RAW zero and `D ≥ RAW` permanently true — "irrigate today", forever, at zero depletion. FAO publishes validity limits this repository has not transcribed, so the honest move is to drop the correction rather than invent a floor |
| Rice | `paddyFlooding` crops leave the ladder at R11, before RAW is ever computed | Table 22 footnote 4 defines rice's p = 0.20 as a fraction *of saturation*, not of TAW, so `RAW = p × TAW` is invalid for rice (ADR-023) |
| R8 | only a log **without** `amountMm` anchors the ledger at D = 0; a log carrying an amount is subtracted like any other water | treating every log as a refill meant a 5 mm top-up wiped an 80 mm standing deficit and the farmer was then told no irrigation was needed — the most dangerous direction for the error to point |
