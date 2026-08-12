# ADR-012 · Dataset license posture
**Status:** Accepted · 2026-08-12
**Decision:** use open/academic datasets with license texts captured at audit; accept one CC BY-NC chilli set for this non-commercial hackathon build with a documented swap-before-commercialization obligation; never use competition-restricted data (Zindi/CGIAR) or unverifiable-provenance sets (Kaggle crop-recommendation) in the product.
**Reason:** viva-proof provenance; legal hygiene; honesty over convenience.
**Trade-offs:** narrower data pool than "grab everything on Kaggle" — accepted; it is also why our story survives scrutiny.

---

## Update after P0-4 verification (2026-08-12) — licences checked against publisher endpoints

Two corrections and one rejection, all evidence-based:

1. **The CC BY-NC concern was wrong.** This ADR previously recorded one chilli set as CC BY-NC, creating a swap-before-commercialisation obligation. Reading the Mendeley licence objects directly shows **all three Mendeley sets (both chilli, cotton) are CC BY 4.0** — no NonCommercial, no ShareAlike. Commercial use, redistribution and modification are permitted with attribution. **That obligation does not apply.**

2. **PlantVillage's licence is contested, not CC0.** Five sources give four answers; the two creator-sourced statements agree on **CC BY-SA 3.0**, while the Mendeley republication we downloaded asserts CC0 1.0. We comply with the strictest reading (attribution, no redistribution). Whether a trained model is a ShareAlike "adaptation" is legally unsettled — irrelevant to hackathon use, **must be resolved before any commercial deployment**. This is now the only outstanding licence obligation.

3. **Paddy Doctor rejected on licence grounds.** No authoritative licence for its images is published anywhere; the commonly cited CC BY-SA 4.0 is the *arXiv article* licence, and the IEEE DataPort record (paid subscription) states none. Rather than assert a licence we cannot verify, the team substituted the **Odisha/Sethy rice dataset (CC BY 4.0, verified)**. Recorded in `datasets/licenses/rice-odisha.md`; the rejected entry is retained in the registry for traceability.

Principle reinforced: **a dataset's licence is what its publisher states, not what downstream mirrors assert.** Every licence in `datasets/licenses/` now cites the endpoint it was read from.
