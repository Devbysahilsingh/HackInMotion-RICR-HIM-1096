# Fertilizer & Resource Planning (FR-FE1 · P1)

Research basis: subagent report 2026-08-12 (TNAU Agritech + CPG PDFs, PAU PoP, ICAR-IISR, Soil Health Card scheme — URLs in knowledge-base.md).

## Product definition
Per active crop, stage-driven guidance cards: **what nutrient matters now, when to apply, what deficiency looks like** — from published government/SAU recommendations, each number source-attributed, framed as educational compilation. Persistent CTA: free Soil Health Card (soilhealth.dac.gov.in) / KVK / Kisan Call Centre 1800-180-1551 for personalized dosing.

## Approach decision: curated rule-based KB, AI only for phrasing-free rendering
No public API/dataset exists for crop→fertilizer recommendations (verified); Kaggle "fertilizer prediction" sets are synthetic. Every SAU publishes the same two-tier structure — **blanket dose (official fallback when no soil test) + STCR soil-test dose** — so our KB mirrors it. LLMs are NOT in this path at all: recommendations render from KB fields via i18n templates. (This is stricter than "AI assists explanation" — deliberate: fertilizer misinformation is the highest-harm hallucination class in this product.)

## Behavior
- No soil test (default): stage-based guidance from blanket recommendation, labeled "General recommendation (no soil test) — Source: TNAU/PAU/ICAR", ranges preserved as published (units as published — TNAU cotton is per acre; display layer converts alongside original).
- Deficiency-symptom checker: KB symptom texts (TNAU CPG verbatim, translated with curation) surfaced in crop-health rule engine too (nutrient deficiency is a differential for disease).
- Soil-test values present (P3 upload): defer to the card, don't recompute.
- Uncovered crop/region: say so; never extrapolate numbers.

## MUST-NOT rules (enforced in CLAUDE.md)
No invented/averaged/silently-converted numbers; no "prescription"/"expert advice" language; no guarantee claims; no ICAR/TNAU endorsement implication ("compiled from published recommendations of…"); no pesticide-dosage creep; visible-damage cases route to KVK/Kisan Call Centre, not generated answers.

## API & storage
KB embedded in `cropRegistry.fertilizer` (docs/database/schema.md). `GET /crops/:id/fertilizer-guidance` (Auth) → current-stage card + full schedule + sources + disclaimer key. Pure read; RL standard.

## Testing
Snapshot tests: each crop×stage renders expected guidanceKey + sourceRef; unit-preservation test (per-acre sources never silently become per-ha); disclaimer presence test on every response.

## Risks
Regional variance (TNAU potato ≠ Punjab potato — flagged per-entry; ship with stated region context). Wheat + soybean primary-PDF verification pending (KB entries marked `verificationPending: true` until done — UI shows source anyway). Hindi translation of agronomic terms needs human check (team plan).

## Future
SHC card upload/parse → STCR-based tier; region-aware KB variants (PAU for north); organics/biofertilizer module; cost calculator using market urea/DAP prices.
