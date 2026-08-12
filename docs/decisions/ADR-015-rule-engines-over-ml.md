# ADR-015 · Rule-based engines for crop-rec, fertilizer, yield (no ML/LLM)
**Status:** Accepted · 2026-08-12
**Decision:** crop recommendation = weighted scoring over sourced knowledge table (Kaggle dataset rejected: synthetic, license-unverified, wrong features); fertilizer = curated KB from TNAU/PAU/ICAR with zero generated numbers; yield = transparent district-average estimator with cited adjustment factors (P3), explicitly not ML.
**Reason:** inputs match what farmers can actually provide; every output citable; viva-defensible provenance; hallucination-free on harm-capable content.
**Trade-offs:** knowledge curation effort (sourced by research agents; seed authoring budgeted); "less AI" optics — countered by the genuine custom vision model + the integrity narrative.
