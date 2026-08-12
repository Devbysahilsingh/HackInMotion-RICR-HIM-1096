# Crop Suitability Knowledge Table (sourced)

Confidence: **P** primary/government verified · **S** secondary (verify before viva). Water needs from FAO Irrigation Water Management Manual Ch.3 (primary). This table seeds `cropRegistry` agronomic fields; every value carries sourceRef in the seed data.

| Crop | Season(s) | Best soils (score 3) → unsuitable (0) | Temp opt °C | Water need mm/season | Drought sensitivity | Conf |
|---|---|---|---|---|---|---|
| Rice | Kharif (+Rabi south/east) | clay, clay-loam/alluvial (needs standing water) → sandy 0 | 30–32 (germ ≥10–12, max 36–38) | 450–700 (FAO; paddy-condition rainfall need much higher per TNAU) | High | P (TNAU CPG, FAO) |
| Wheat | Rabi | well-drained loam/clay-loam, alluvial | 10–15 winter ideal | 450–650 | Low–Med | P water/season; **S temp/soil → verify ICAR-IIWBR** |
| Maize | Kharif (+Rabi/spring) | well-drained loam/alluvial | 21–32 (max 40–44) | 500–800 | Med–High | P (TNAU CPG, FAO) |
| Cotton | Kharif (long, 6–8mo) | deep black (regur) 3, alluvial 2, red 1 | 21–30, dry ripening | 700–1300 | Low (deep roots) | P water; S soil corroboration → verify ICAR-CICR |
| Soybean | Kharif (rainfed typical) | loam/black belt, well-drained | 20–35 (germ ≥15) | 450–700 | Low–Med | P (KVK PoP, FAO) |
| Tomato | Multi-season | well-drained sandy loam + organics | fruit set 15–20 (hot-set >20) | 400–800 | Med–High | P water; pH conflict in sources — **do not quote pH** |
| Potato | Rabi (plains) | sandy loam, slightly acidic | ~24 vegetative, ~20 tuberisation | 500–700 | High (shallow roots) | P (NHB, FAO) |
| Chilli | Kharif (+Rabi south) | light fertile loam, pH 6–7 | 20–30 | 600–900 (FAO "pepper" proxy — disclosed) | Med–High | P/S |
| Onion | Rabi main (+Kharif MH) | friable sandy loam–loam, humus | 13–25 | 350–550 | Med–High | P (NHB, Kerala Agri, FAO) |

Framework axes: Kharif/Rabi per Govt. Arthapedia/DES; state sowing windows per DES Crop Calendar; 15 agro-climatic zones (Planning Commission) as optional refinement; ICAR 8 soil types as the soil vocabulary (mapped to our farm soilType enum).

## Sources (recorded per-value in seed data)
FAO Ch.3 water needs: fao.org/4/s2022e/s2022e07.htm · TNAU CPG Rice/Maize: tnagriculture.in/dashboard/CPG/ · DES crop calendar: desagri.gov.in/document-report/4-crop-calendar-of-major-crops/ · Arthapedia cropping seasons: ies.gov.in · NHB potato/onion PDFs: nhb.gov.in · KVK soybean PoP: kvkwestkhasihills.nic.in · Apni Kheti chilli · agropedia IIT-K paddy.

## Open verification tasks (pre-viva)
- [ ] Wheat temp/soil vs ICAR-IIWBR or PAU PoP
- [ ] Cotton soil claims vs ICAR-CICR
- [ ] Tomato pH via TNAU horticulture portal (until then: omitted)
- [ ] Demo-state rainfall normals table sourced (IMD normals)
