# ADR-006 · AI chain (ML→Gemini→OpenRouter→rules) + KB-only advice
**Status:** Accepted · 2026-08-12
**Decision:** custom ML primary for SPECIALIZED crops with calibrated-confidence gate; Gemini 2.5 Flash (free tier) escalation + GENERAL-crop primary; OpenRouter free vision tertiary; local rule-based symptom engine terminal. **All farmer-facing guidance renders from curated KB; LLMs never author agronomic advice.**
**Alternatives:** Gemini-only (no differentiation, external dependence); ML-only (breadth gap); LLM-generated advice (hallucination risk on harm-capable content — rejected outright).
**Reason:** specialization + resilience + zero cost + honesty ("AI perceives, engines decide, KB speaks").
**Trade-offs:** chain complexity concentrated in one conductor service (heavily tested).
