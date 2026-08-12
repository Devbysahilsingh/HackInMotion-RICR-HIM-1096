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
- R10 D clamps [0, TAW]; TAW uses stage-adjusted root depth: rootDepthM × stageDepthFactor {INITIAL:0.4, DEV:0.7, MID:1.0, LATE:1.0}.
- R11 paddyFlooding crops bypass R9-R10 depletion phrasing → water-level guidance strings.
- R12 Trace must contain every number used (et0Series, kc, stage, etcMm/day, TAW, RAW, D series, rain projection) — explainability is contractual, UI renders trace verbatim.
- R13 All constants centralized + named; no magic numbers in engine code.
- R14 Missing weather entirely → verdict 'UNAVAILABLE' + pending (200-level designed state; never throws).
