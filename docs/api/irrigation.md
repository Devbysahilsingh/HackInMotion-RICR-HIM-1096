# Irrigation API

| | |
|---|---|
| GET `/crops/:id/irrigation` | Auth (ownership) |
Runs the pure FAO-56 engine (docs/irrigation/) over crop + registry + latest snapshot + irrigationLogs.
→ 200 `{verdict:'IRRIGATE_TODAY'|'IRRIGATE_IN_N_DAYS'|'WAIT_RAIN_EXPECTED'|'NO_IRRIGATION_NEEDED'|'MAINTAIN_WATER_LEVEL'|'UNAVAILABLE', days?:n, amountMm?, amountLitersPerAcre?, mode:'full'|'simplified', trace:{stage, kc, et0Series, etcMm, rainNext3:{mm,probPct}, soil:{type,tawMm,rawMm,depletionMm}, ledger:[...]}, freshness}`
`mode:'simplified'` when ET₀ unavailable (fallback weather source) — labeled in UI. Errors: 404; missing snapshot → verdict:'UNAVAILABLE' + pending hint (200, designed state).
Two members of that union were missing from the published list and are added here (`backend/src/engines/irrigation/constants.js` is authoritative):
- `UNAVAILABLE` — already returned by the line above; the union simply omitted it. Every no-verdict-but-answerable state uses it (no weather, no forecast, Kc unsourced, soil reservoir unknown, simplified mode with no sourced interval), each with its own `reasonCode`.
- `MAINTAIN_WATER_LEVEL` — the paddy standing-water verdict R11 requires. No document proposed a name for it; this is that name. Carries `targetDepthCm:{min:2,max:5}` and `reasonCode:'PADDY_STANDING_WATER'`, and no `amountMm`/`days`, because depletion scheduling does not apply (ADR-023).

| | |
|---|---|
| POST `/crops/:id/irrigation-log` | Auth · RL 10/day |
Req `{date, amountMm?}` → 201; water-balance ledger resets depletion (docs/irrigation/calculation-rules.md). Validation: date ∈ [sowingDate, today].

| | |
|---|---|
| GET `/crops/:id/irrigation-log` | Auth |
Ledger history for the trace UI.
