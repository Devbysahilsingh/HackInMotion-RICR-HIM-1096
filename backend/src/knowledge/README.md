# `backend/src/knowledge/` — sourced crop knowledge (research artifacts)

These files are **data, not application code**. They are the sourced inputs the `cropRegistry` seed
composes documents from — `src/services/registrySeedService.js` reads them, `scripts/seed-registry.mjs`
applies the result. No file here is loaded on a request path.

| File | What it is | Status |
|---|---|---|
| `crops.agronomy.json` | FAO-56 irrigation parameters (`kcStages`, `rootDepthM`, `depletionFraction`) for the 9 SPECIALIZED/GENERAL crops | **SEEDED** — values reviewed against the published tables; open questions in its `gaps` |
| `crops.base.json` | names, seasons, water need, temp optimum, drought sensitivity, market aliases | **SEEDED** |
| `crops.fertilizer.json` | published NPK tables, **units preserved exactly as printed** (kg/ha and kg/acre both occur) | **SEEDED** |
| `crops.limited.proposal.json` | 21 candidate LIMITED-support Indian crops (code, en/hi names, seasons, family) | **PROPOSED — NOT seeded.** The seed skips it until its `status` field begins with `APPROVED`; the roster is a product decision |

Anything the seed drops — a crop without a bilingual name, or the whole unapproved LIMITED roster — is
**printed by `npm run seed:registry`**, never silently omitted. Per-document gaps travel into the database
as `dataGaps` so a served registry document says what it does not know.

Registry document shape: `docs/product/crop-support-matrix.md`. Composition rules: `registrySeedService.js`.

---

## The rule these files exist to satisfy

**No agronomic number in these files was invented, estimated, averaged or remembered.**

Every numeric value was read from a source that was actually fetched during this research pass, and
carries a citation naming the exact URL and the exact table row it came from. Where a value could not be
sourced, the field is **absent or null** and the failure is written down in that file's `gaps` array.

Specifically, and deliberately:

- No midpoint was ever computed from a published range. FAO-56 prints `Kc end 0.90-0.60` for rice; the
  file records `0.90` and keeps `"published": "0.90-0.60"`. It does not record `0.75`.
- Crop-development-stage Kc is `null` for all nine crops, because FAO-56 does not publish one. The engine
  must interpolate (FAO-56 Eq. 66). A pre-computed value would have been an invented number.
- Five LIMITED crops have `names.hi: null`. Common Hindi terms exist for all of them, but no Government of
  India document in this pass publishes them, and CLAUDE.md rule 8 forbids unsourced agronomic
  translation. An empty field is the correct output.
- Chilli's entire FAO parameter set is flagged `proxy.isProxy: true` because FAO-56 has no chilli entry at
  all. It is not presented as a chilli measurement.

An omission is fine here. A guess is not.

## Citation shape

Every `sourceRef` is an **array** of citation objects. It is an array because a single crop stage draws its
`days` from FAO-56 Table 11 and its `kc` from Table 12 — two different tables, so two citations.

```json
{
  "org": "FAO",
  "title": "<document + table>",
  "url": "<exact url fetched>",
  "accessed": "2026-08-13",
  "confidence": "P",
  "note": "<which row/variety, any caveat>"
}
```

`confidence`: `"P"` = primary/official source, `"S"` = secondary. **Every citation in both files is `P`.**
No secondary source was used for any value.

## Sources actually fetched

| Source | URL |
|---|---|
| FAO-56 Ch. 6 — Tables 11 and 12 | https://www.fao.org/4/x0490e/x0490e0b.htm |
| FAO-56 Ch. 8 — Table 22 | https://www.fao.org/4/x0490e/x0490e0e.htm |
| GoI DES — MSP statement, 12.12.2025 (English) | https://desagri.gov.in/wp-content/uploads/2025/12/MSP-Statement_English_As-on-12.12.2025.pdf |
| GoI DES — MSP statement, 12.12.2025 (Hindi) | https://desagri.gov.in/wp-content/uploads/2025/12/MSP-Statement_Hindi_As-on-12.12.2025.pdf |
| GoI DES — Appendix IV, Crop Calendar of Major Crops (.xls, ICAR-sourced) | https://desagri.gov.in/wp-content/uploads/2021/04/Appendix-IV-1.xls |
| GoI DES — crop calendar landing page | https://desagri.gov.in/document-report/4-crop-calendar-of-major-crops/ |

The FAO-56 tables were parsed from **raw HTML**, cell by cell, rather than from a prose summary of the
page — the summarised form flattened footnote markers into the numbers (it rendered `0.25-0.4` +
footnote 10 as `0.25-0.41`), which is exactly the class of error that would have put a fabricated value
into the file.

## Recorded conventions (both files state these inline too)

- **Table 11 row selection.** Use the row whose Region names India; otherwise the row whose Region and
  Plant Date best match Indian conditions. Only WHEAT (`Central India`) and MAIZE (`India (dry, cool)`)
  have an India row. Every alternative row FAO-56 publishes is kept per crop under
  `alternativeRowsInSource` so a reviewer can override without re-fetching anything.
- **Ranges.** First published value recorded; full string kept in `published`.
- **Root depth.** Lower bound of the published Zr range, on FAO-56 Table 22 footnote 1's own guidance:
  *"The smaller values for Zr may be used for irrigation scheduling and the larger values for modeling
  soil water stress or for rainfed conditions."* This platform schedules irrigation.
- **Kc_ini.** FAO-56 Table 12 prints Kc_ini once per crop *group* heading row and leaves it blank on most
  crop rows. Rice is the only one of the nine with its own Kc_ini (1.05); the other eight take the group
  value, and the group is named in the citation note.
- **Kc_end is an endpoint, not an average.** The `kc` on the LATE stage is the value at the *end* of the
  late season. The engine must interpolate Kc_mid → Kc_end across that stage, not hold it flat.
- **Seasons.** GoI prints "Summer" / "Spring/Summer"; recorded as `ZAID`. The source wording is preserved
  in every citation note. That mapping is a naming decision, not a claim by the source.

---

## Every gap hit

### `crops.agronomy.json`

| ID | Field | What could not be sourced / what I tried |
|---|---|---|
| **G1** | CHILLI, all fields | FAO-56 has **no** Chilli/Chillies/Capsicum entry in Table 11, 12 or 22. Verified by searching the complete raw HTML of both chapters — zero hits. All values proxied from `Sweet peppers (bell)`. Chilli is a SPECIALIZED crop here, so a wrong Kc curve mis-advises irrigation directly. **Needs approval or an Indian source.** |
| **G2** | Stage lengths for RICE, COTTON, SOYBEAN, TOMATO, POTATO, ONION, CHILLI | No India row exists in Table 11 for these seven. Read every published row for all nine crops; picked a region/plant-date analogue by the documented rule and recorded all alternatives. SOYBEAN is the weakest match: the only tropical row is 85 days with a December plant date, against Indian kharif sowing in June–July. |
| **G3** | POTATO mid-season days | Table 11 prints `30/45` with total `115/130` against plant date `Jan/Nov`, and never says which length goes with which planting. Searched Chapter 6 body text and all Table 11 footnotes for a slash convention — none exists. Recorded 30. |
| **G4** | WHEAT spring vs winter | FAO-56 publishes separate Kc_ini and Zr for winter (0.4/0.7; 1.5–1.8 m) and spring (0.3; 1.0–1.5 m) wheat and never says which applies to India. Read Table 11 footnote 2 and the Table 12 frozen/non-frozen split; both condition winter wheat on frozen soils and dormancy. Chose spring wheat and recorded the reasoning; winter values kept as alternatives. `p = 0.55` either way. |
| **G5** | Kc_end for RICE, COTTON, TOMATO; Kc_mid for COTTON | Two-value ranges with **no footnote** explaining the split. Read all 25 numbered Table 12 footnotes and searched Chapter 6 prose — only the rice Kc_ini paddy-water passage was found. Recorded first published value. Rice matters most: ponded-to-harvest vs drained-before-harvest are very different, and the platform already flags rice standing-water logic. |
| **G6** | Kc_end for WHEAT and MAIZE | Footnoted alternatives exist and were read in full — wheat's higher 0.4 is for hand-harvested crops, maize's 0.35 is for grain field-dried to ~18% moisture. Both practices are common in India and both would flip the value. I deliberately did **not** make that agronomic call; first published value recorded, footnote quoted. |
| **G7** | TOMATO / CHILLI Kc_mid | Table 12 footnote 2: staked tomatoes and peppers at 1.5–2 m need higher Kc (1.20 / 1.15). FAO-56 does not say which Indian systems are staked. Unstaked table values recorded. |
| **G8** | Development-stage Kc | Null for all nine, by design — FAO-56 publishes Kc at three points only. Not a sourcing failure; recorded as null so no computed number enters the data. |
| **G9** | Root depth single value | Table 22 publishes ranges only; no crop has a single published Zr. Lower bound taken on footnote 1's guidance; full range kept in `published`. |
| **G10** | RICE depletion fraction semantics | Table 22 footnote 4: rice `p = 0.20` is *"of saturation"*, a different reference point from every other crop (fraction of TAW between field capacity and wilting point). Recorded with a prominent caveat — this is an **engine-correctness hazard**: applying rice p through the standard TAW formula would be wrong. |
| **G11** | Climate adjustment of Kc | Table 12 values are for a subhumid climate (RHmin ≈ 45%, u2 ≈ 2 m/s). Much of India is arid to semi-arid, where FAO-56 Eq. 62 raises Kc_mid materially — Box 14 shows wheat Kc_mid spanning 1.02–1.25 by climate and wind. Not applied, because Eq. 62 needs per-location RHmin and u2, which is engine input rather than registry data. Flagged so the engine does not silently under-estimate ETc. |
| **G12** | `waterNeedMm`, `soilSuitability`, `sensitivity`, fertilizer, diseases | Out of scope for this pass — not attempted. Still need their own sourced research. |

### `crops.limited.proposal.json`

| ID | Field | What could not be sourced / what I tried |
|---|---|---|
| **L1** | Mandi commodity mapping, all 21 crops | Could **not** confirm any crop appears in the Agmarknet commodity vocabulary. `agmarknet.gov.in/SearchCmmMkt.aspx` now returns a 1 KB JavaScript SPA shell ("Agmarknet 2.0") with no server-rendered list; the data.gov.in resource needs an API key (OD-5, still open); live scraping is already ruled out in `docs/market/data-source.md`. No `mandiCommodity` asserted. MSP inclusion is used as evidence a crop is major **by value** — not as evidence of mandi coverage. |
| **L2** | `names.hi` for HORSEGRAM, FIELDPEA, CASTOR, LINSEED, SUGARCANE | Not MSP crops, so absent from the only bilingual GoI document in this pass. The crop-calendar workbook is English-only and `docs/i18n/agricultural-terminology.md` covers just the 9 core crops. Recorded `null`. |
| **L3** | Devanagari transcription method | The official Hindi MSP PDF embeds a legacy non-Unicode font; its text layer extracts corrupted (`Ïवार` for ज्वार, `Ǔतल` for तिल, `कुसुʁ` for कुसुम्भ, `सरसɉ` for सरसों). After pypdf/PyMuPDF extraction failed, page 1 was rendered at 6× and the glyphs read visually from the official document. Accurate, but a real transcription-risk surface — an extra reason every term is `hiVerified: false`. |
| **L4** | ZAID mapping | Neither GoI source uses "Zaid"; they use "Summer", "Spring/Summer", "Pre Rabi". Read every season column header across all 12 sheets. Summer → ZAID, source wording preserved; sesame's "Pre Rabi" has no enum member and is dropped. If the registry should mirror source vocabulary, the enum needs a SUMMER member. |
| **L5** | `family` for PEARLMILLET, FINGERMILLET, PIGEONPEA, BLACKGRAM, HORSEGRAM, MUSTARD, LINSEED, NIGER, JUTE | FAO-56 Table 12 has no row for these. `family` left null; a `proposedFaoProxy` donor is suggested for eight and explicitly labelled a proposal. **JUTE has no defensible donor at all** and is left with nothing — its group ("Fibre Crops") contains only cotton, flax and sisal. Note also that FAO classes flax as a *fibre* crop while Indian linseed is an oilseed, so even that proxy is shaky. |
| **L6** | Horticultural crops | The list is entirely field crops. Banana, mango, turmeric, garlic, brinjal, okra, cabbage, cauliflower, coriander and cumin are prominent in mandi data but absent, because both GoI sources used here cover field crops only and no equally citable GoI source giving crop **and** season for horticulture was located. Omitted rather than added from memory. |
| **L7** | `cropCode` spelling | Proposed, not sourced. Several crops are known in India by Hindi-origin names that the MSP statement itself uses as English labels (Jowar, Bajra, Ragi, Arhar, Moong, Urad, Masur). English botanical codes were used with GoI labels kept in `names.en`; a reviewer may prefer codes matching the MSP/Agmarknet labels, which interacts with the market alias map. |
| **L8** | TLS on desagri.gov.in | The host presents an incomplete certificate chain; WebFetch failed with *"unable to get local issuer certificate"*. Fetched via curl with verification relaxed and sanity-checked the contents (GoI page structure, expected table shape, ICAR attribution footers). Worth knowing before automating these fetches. |

---

## Before any of this is used

1. Resolve **G1** (chilli proxy) — a SPECIALIZED crop should not ship on bell-pepper coefficients unreviewed.
2. Resolve **G5/G6** — decide which end of each published Kc_end range applies to Indian practice.
3. Resolve **G10** in the irrigation engine — rice `p` is not on the same scale as the other eight crops.
4. Get a Hindi-literate reviewer to sign off `crops.limited.proposal.json` and fill the five null names
   (CLAUDE.md rule 8).
5. Approve or cut the 21 proposed crops, then re-check **L1** once the data.gov.in key exists.
