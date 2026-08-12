# Crop Recommendation Engine (FR-R1 · P1)

Research basis: subagent report 2026-08-12 (FAO water-needs manual, TNAU CPG PDFs, NHB, DES crop calendar — URLs in scoring-model.md).

## Decision: rule-based weighted scoring, NOT ML
The well-known Kaggle Crop Recommendation Dataset (N,P,K,temp,humidity,pH,rainfall → 22 crops) was assessed and **rejected as an engine**: it is augmented/synthetic (self-described as "built by augmenting datasets"), trivially separable (99%+ RF accuracy = memorized bands, not agronomy), license unverifiable, and its input features (lab N/P/K, point humidity) are unobtainable from a real farmer at inference time — while our actual inputs (location, season, soil, irrigation) don't appear in it at all. A rule engine over a curated, source-cited knowledge table matches our inputs, survives viva provenance questioning, and is natively explainable. (Optional demo garnish: the Kaggle RF as an explicitly-labeled comparison slide — never as product.)

## Inputs
From profile (auto-filled): state, district, soil type, land size, irrigation method. Asked in wizard: target season (Kharif/Rabi/Zaid), preference (food/cash/any). From data: district seasonal rainfall normal (Open-Meteo climate normals or IMD-derived constant table in KB), temperature normals.

## Algorithm
1. **Hard gates** (excluded with stated reason): season ∉ crop's sowing windows for the state (DES crop calendar); soil suitability score 0; water need floor unreachable (high-need crop + rainfed + low district rainfall normal).
2. **Weighted score** over survivors: `0.30·S_season + 0.25·S_soil + 0.30·S_water + 0.15·S_temp`.
   - S_water = f(available water proxy ÷ FAO need range), penalized by drought sensitivity. Irrigation→mm proxy is our own heuristic and is **labeled as such in UI**.
   - S_temp = overlap of district seasonal normals with crop optimum range.
   - Land size: tie-breaker note only (no agronomic scoring basis — stated honestly).
3. **Output** (ranked, top 5): crop, score, reasons[] (each reason cites its source), cautions[] (duration, price volatility from our own mandi data, water risk), sources[]. No yield/profit claims (NFR-7).

```json
{ "crop":"COTTON", "score":0.84,
  "reasons":[ {"key":"cropRec.seasonMatch","source":"DES crop calendar"},
              {"key":"cropRec.soilIdeal","source":"ICAR soil classification"},
              {"key":"cropRec.waterOk","data":{"needMm":[700,1300],"availMm":900},"source":"FAO Ch.3"} ],
  "cautions":[{"key":"cropRec.longDuration","data":{"days":180}}] }
```

## API
`POST /api/v1/crop-recommendation` (Auth, RL 20/day) req `{farmId, season, preference?}` → ranked list. Pure function over registry + KB — no external calls at request time; trivially testable.

## Data requirements & storage
Knowledge lives in `cropRegistry` (seasons, soilSuitability, waterNeedMm, tempOpt, durationDays, droughtSensitivity — all sourced per scoring-model.md). District rainfall/temperature normals: small constant table in `shared/constants/climate-normals` for demo states `[DECISION REQUIRED: which 2–3 demo states — recommend MP, Maharashtra, UP]`.

## Testing
Golden cases: black-soil Kharif rainfed Nagpur → cotton/soybean rank high, rice gated out (water); clay irrigated Kharif Raipur → rice top; Rabi loam Punjab-like → wheat/potato/onion. Property: every output reason must reference a registry field with a sourceRef.

## Risks / honesty
State-level PoPs vary — national table is approximate at margins → demo scoped to chosen states; disclosed. Wheat/cotton temp facts currently secondary-sourced → verify vs ICAR-IIWBR/CICR before viva (flagged in KB). Chilli water need uses FAO "pepper" proxy — disclosed in sourceRef.

## Future
More crops (registry-only change), IMD gridded normals API, profitability layer from our own mandi history (defensible because it's our data), ICAR zone refinement (15 → 127 zones).
