# Fertilizer KB — Verified Entries & Structure

Structure per crop (lives in `cropRegistry.fertilizer`, seeded from `shared/constants` source files):
```
{ context: {region, condition, varietyClass},
  recommendations: [ { source:{org,title,url,accessed}, basis:'blanket_no_soil_test'|'stcr_soil_test',
      totalNpk:{n,p2o5,k2o,unit}, organics?, micronutrients?,
      schedule:[{stage, timing, fractionKey, note}] } ],
  deficiencySymptoms: [ {nutrient, symptomKey, sourceUrl} ],
  verificationPending: bool }
```
Rule: **no number without source.url; units stored exactly as published.**

## Verified values (as researched 2026-08-12 — re-verify page-by-page during seed authoring)
| Crop | Blanket dose (as published) | Schedule core | Source | Status |
|---|---|---|---|---|
| Rice (TN, transplanted) | 120–150:40–50:40–50 kg/ha short-dur; 150:50:50 med/long; hybrid 175:60:60 | N&K in 4 splits (basal/tillering/PI/heading); P basal | TNAU Agritech rice nutrient page | ✅ |
| Maize | 135:62.5:50 varieties; 250:75:75 hybrids (kg/ha) | ¼N+P+K basal; ½N @25 DAS; ¼N @45 DAS | TNAU CPG Maize PDF | ✅ (incl. N/P/K deficiency symptom texts) |
| Tomato (TN) | FYM 25t + 75:100:50 kg/ha + borax 10 + ZnSO₄ 50 basal; +75 N @30d | as stated | TNAU vegetables schedule PDF | ✅ |
| Potato (TN hills) | 120:240:120 kg/ha half basal/half 30 DAS + MgSO₄ 60 | as stated | TNAU vegetables PDF | ⚠️ region flag: add PAU/UP value for plains before demo in northern persona |
| Chilli | basal 30:60:30 kg/ha + 30 N @30/60/90d | as stated | TNAU vegetables PDF | ✅ |
| Onion | small: 30:60:30 basal +30 N @30 DAS; Bellary: 50:150:75 basal +50 N @30 DAP + ZnSO₄ 50 | as stated | TNAU vegetables PDF | ✅ |
| Cotton (TN) | per **acre**: 32:16:16 varieties; 48:24:24 hybrids | varieties 50/50 basal & 40–45 DAS; hybrids thirds basal/40–45/60–65 DAS | TNAU Agritech cotton page | ✅ (unit flag: acre) |
| Soybean | 25:60:40 + S 20 kg/ha, basal only + FYM 5–10t | basal only (official) | ICAR-IISR Bulletin 18 (via summary) | ⚠️ pull bulletin PDF for citation |
| Wheat | PAU per acre: 50 N + 25 P2O5 (medium fertility; DAP 55kg sowing, urea 45kg before 1st & 2nd irrigation) | as stated | PAU PoP Rabi PDF | ⚠️ verify against PDF directly before KB entry |

## Source URLs
TNAU rice: agritech.tnau.ac.in/agriculture/agri_cropproduction_cereals_rice_tranpudlow_mainfield_nutrient_mgmt_inorganic.html · TNAU vegetables: agritech.tnau.ac.in/horticulture/FERTILIZER%20SCHEDULE%20FOR%20VEGETABLES.pdf · TNAU CPG maize: tnagriculture.in/dashboard/CPG/02_%20Maize.pdf · TNAU cotton: agritech.tnau.ac.in/agriculture/agri_cotton_Inorganic_manures%20.html · PAU PoP: pau.edu/content/ccil/pf/pp_rabi.pdf, pp_kharif.pdf, pp_veg.pdf · ICAR-IISR via krishakjagat.org + ResearchGate 368392183 · SHC: soilhealth.dac.gov.in · KAU regional variant: agritech.kau.in.

## Disclaimer (rendered on every fertilizer surface, en+hi)
"General guidance compiled from published TNAU/PAU/ICAR recommendations. Doses vary with your soil and region. Not a substitute for a soil test or advice from your local Krishi Vigyan Kendra / Agriculture Officer. Get a free Soil Health Card: soilhealth.dac.gov.in · Kisan Call Centre 1800-180-1551."
