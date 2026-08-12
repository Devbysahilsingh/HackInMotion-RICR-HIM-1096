# ML Dataset Research (final)

Method: web research verified against dataset pages/papers (2026-08-12); weighted crop scoring (quality 20 / field-data 20 / Indian relevance 15 / disease coverage 15 / ML feasibility 15 / 72h 10 / market value 5). Full scoring in conversation record; verdicts:

## Selected training datasets
| Dataset | Use | Images | Classes | Type | License | Notes |
|---|---|---|---|---|---|---|
| **Paddy Doctor** (Kaggle competition / IEEE DataPort) | Rice — train+val+test | 16,225 (10,407 labeled train) | 13 (12 disease + normal) | ✅ Real Indian paddy fields, smartphone | Open academic; competition rules accepted on Kaggle (needs team account — OD-6) | Crown asset: field-real AND Indian |
| **PlantVillage** | Tomato(10)/Potato(3)/Maize(4)/[Pepper 2 optional] | ~24k relevant subset of 54,303 | 17–19 relevant | ⚠️ Controlled/lab | Open (verify exact terms via TFDS entry during audit) | Backbone for 3 crops; domain gap measured, disclosed |
| **Mendeley chilli #1** (tm3v4zmh7c) | Chilli train | 8,814 (1000×1000) | 6 incl. Leaf Curl Virus (1,590) | ✅ Field (Bangladesh) | Mendeley open — **confirm exact CC variant at download** | Curl virus = the Indian chilli disease |
| **Mendeley chilli #2** (wzc6r6w5w5) | Chilli val/test augmentation | 1,544 | 4 | ✅ Field (Bangladesh) | CC (one set NC — non-commercial OK for hackathon, flagged) | Cross-set held-out test |
| **SAR-CLD-2024 cotton** (Mendeley b3jy2p6k8w) | Cotton — **gated by audit OD-1** | 2,200 | 8 | ✅ Field (Bangladesh, single site) | Mendeley open | ~275/class thin; include iff audit passes |
| **PlantDoc** | FIELD TEST SET (tomato/potato/maize overlap classes) — never trained on | ~2,598 (subset) | overlap classes | ✅ Field (web-curated) | CC — verify repo at download | Domain-gap measurement |

## Evaluated & rejected (viva record)
PlantWild (18.5k, 89 cls) — broader than our scope, class mapping cost > benefit for 72h (future augmentation candidate). Zindi/CGIAR wheat rust — competition-restricted license: **never used**. Kaggle misc. cotton/chilli/wheat singles — license/provenance unclear. SoyNet (9k Indian, CC BY) — good, deferred to future (4th source integration cost). Kaggle Crop-Recommendation — rejected entirely (synthetic; see docs/crop-recommendation/engine.md).

## Domain-gap position (honest, stated everywhere)
Tomato/potato/maize train mostly on lab imagery → field accuracy WILL be lower than validation accuracy; we measure it on PlantDoc and publish the number. Chilli/cotton field data is Bangladeshi (agroclimatically similar to E. India — proxy, disclosed). Rice is the flagship: trained on real Indian field photos.

## Download plan (Day 0 execution, blocked on OD-6 Kaggle creds)
`scripts/ml/download-datasets.py` → `datasets/raw/<name>/` (≈5–7GB; datasets/ is gitignored except README) → checksums recorded → audit (dataset-audit.md) → report to team before any training.
