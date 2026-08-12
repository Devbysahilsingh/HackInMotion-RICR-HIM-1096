# Irrigation API

| | |
|---|---|
| GET `/crops/:id/irrigation` | Auth (ownership) |
Runs the pure FAO-56 engine (docs/irrigation/) over crop + registry + latest snapshot + irrigationLogs.
→ 200 `{verdict:'IRRIGATE_TODAY'|'IRRIGATE_IN_N_DAYS'|'WAIT_RAIN_EXPECTED'|'NO_IRRIGATION_NEEDED', days?:n, amountMm?, amountLitersPerAcre?, mode:'full'|'simplified', trace:{stage, kc, et0Series, etcMm, rainNext3:{mm,probPct}, soil:{type,tawMm,rawMm,depletionMm}, ledger:[...]}, freshness}`
`mode:'simplified'` when ET₀ unavailable (fallback weather source) — labeled in UI. Errors: 404; missing snapshot → verdict:'UNAVAILABLE' + pending hint (200, designed state).

| | |
|---|---|
| POST `/crops/:id/irrigation-log` | Auth · RL 10/day |
Req `{date, amountMm?}` → 201; water-balance ledger resets depletion (docs/irrigation/calculation-rules.md). Validation: date ∈ [sowingDate, today].

| | |
|---|---|
| GET `/crops/:id/irrigation-log` | Auth |
Ledger history for the trace UI.
