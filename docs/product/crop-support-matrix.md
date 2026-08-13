# Crop Support Matrix & Registry Design

## Support levels
- **SPECIALIZED** — custom ML disease model + full KB + all engines.
- **GENERAL** — no custom ML; Gemini vision + symptom rules + full KB + all engines.
- **LIMITED** — known crop, thin KB: weather/irrigation-generic (crop-family Kc defaults) + Gemini best-effort + honest coverage notice.
- **UNSUPPORTED** — unknown entry: platform features + weather only; explicit "no disease intelligence" notice; never fabricate.

## Launch matrix (post dataset research; cotton gate = OD-1)
| Crop | Level | ML classes | Disease KB | Kc/irrigation params | Mandi mapping | Fertilizer KB | Notes |
|---|---|---|---|---|---|---|---|
| Rice | SPECIALIZED | 10–13 (Paddy Doctor) | ✅ | ✅ (+standing-water logic flag) | ✅ | ✅ | Best field-data crop |
| Tomato | SPECIALIZED | 10 (PlantVillage) | ✅ | ✅ | ✅ | ✅ | Deepest disease coverage |
| Chilli | SPECIALIZED | 4–6 (Mendeley field) | ✅ incl. leaf curl | ✅ | ✅ | ✅ | BD-sourced data, disclosed |
| Maize | SPECIALIZED | 4 (PlantVillage) | ✅ | ✅ | ✅ | ✅ | |
| Potato | SPECIALIZED | 3 (PlantVillage) | ✅ | ✅ | ✅ | ✅ | Narrow but critical classes |
| Cotton | SPECIALIZED* (OD-1 gate) | 8 (SAR-CLD-2024) | ✅ | ✅ | ✅ | ✅ | *Demote to GENERAL if audit fails |
| Wheat | GENERAL | — | ✅ | ✅ | ✅ | ✅ | Future: open rust sets |
| Onion | GENERAL | — | ✅ | ✅ | ✅ (star mandi demo) | ✅ | |
| Soybean | GENERAL | — | ✅ | ✅ | ✅ | ✅ | Future: SoyNet |
| Other known crops (registry seed ~20 more) | LIMITED | — | minimal | family defaults | where mapped | generic | |
| Unknown free-text | UNSUPPORTED | — | — | — | — | — | |

## Registry document shape (collection `cropRegistry`; authoritative structure — DB doc in docs/database/schema.md)
```
{
  cropCode: "TOMATO",
  names: { en: "Tomato", hi: "टमाटर" },
  supportLevel: "SPECIALIZED",
  seasons: ["KHARIF","RABI"],            // per typical Indian calendar
  waterNeedMm: [min,max],                 // seasonal, sourced
  soilSuitability: { black: 2, loamy: 3, sandy: 1, clay: 2, ... },  // 0–3 sourced scores
  kcStages: [ { stage:"INITIAL", days:30, kc:0.6 }, ... ],          // FAO-56 sourced
  rootDepthM: 0.7, depletionFraction: 0.4,
  sensitivity: { frostTminC: 2, heatTmaxC: 38, heavyRainMm24h: 50, humidityDiseasePct: 85 },
  mlSupported: true, mlClassCodes: ["TOMATO_EARLY_BLIGHT", ...],
  diseases: [ { code, names:{en,hi}, symptoms[], inspect[], nextSteps[], prevention[], expertThreshold } ],
  fertilizer: {                                     // shipped shape — see note below
    context: { region, condition, varietyClass },
    recommendations: [ { source, basis:'blanket_no_soil_test'|'stcr_soil_test',
                         totalNpk, organics, micronutrients,
                         schedule:[ { stage, timing, fractionKey, note } ] } ],
    deficiencySymptoms: [ { nutrient, symptomKey, sourceUrl } ],
    verificationPending: bool
  },
  market: { commodityCode: "TOMATO", aliases:["Tomato"] },
  yield: { apyCropName: "Tomato" }        // P3 hook
}
```

The earlier `fertilizer: { stages:[{stage, nutrientFocus, guidanceKey, sourceRef}] }` shape has been wrong since P1-6 and never existed in code. A published dose is one *recommendation* (a whole NPK package from one source, on one basis) carrying its own split schedule — not a per-stage guidance key — because state-university recommendations are published that way and flattening them would separate a dose from the source and basis that qualify it. `totalNpk`/`organics`/`micronutrients` stay Mixed: published doses vary (single figure, variety/hybrid split, range) and the printed unit (kg/ha vs kg/acre) is preserved exactly. `verificationPending` marks numbers still awaiting primary-PDF verification.

## Extending to a new crop (no code changes)
1. Add registry document (agronomic fields sourced + cited in sourceRef).
2. Add i18n keys for names/diseases.
3. Optional: add mandi commodity mapping.
4. Optional (upgrade to SPECIALIZED): retrain model per docs/ml/model-versioning.md, update `mlClassCodes`.
Engines read only registry fields — **hardcoded crop conditionals are banned by CLAUDE.md rule**.
