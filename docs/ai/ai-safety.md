# AI Safety & Honesty Rules

1. **No LLM-authored agronomic advice.** Farmer-facing guidance renders exclusively from the curated KB (sourced). Enforced: response-schema has no advice field; any model-emitted advice text is discarded; test asserts KB-key-only rendering.
2. **No fabricated certainty.** ML confidence = calibrated probability (shown); Gemini = band labeled "AI-assisted"; rules = match bands. UNKNOWN/uncertain is a first-class outcome; forcing predictions is contractually banned (test-enforced).
3. **No dosage generation** anywhere (pesticide or fertilizer). KB numbers only, with sources. Edge cases route to KVK / Kisan Call Centre 1800-180-1551.
4. **Prompt-injection defense:** farmer description quarantined as untrusted data in prompts; server strips instruction-like patterns; images are re-encoded (EXIF/steganography-adjacent metadata gone) before any AI sees them.
5. **Privacy:** images to Gemini go under free-tier terms (may train — DISCLOSED in privacy note: "AI analysis shares the photo with the AI provider"); user consents at first use; custom-ML path keeps photos entirely on our infra (a stated advantage). No PII in prompts (no name/phone/exact location — state-level only).
6. **Escalation honesty:** UI shows which tier answered (Local AI / AI-assisted / Guided assessment) — never blended into one anonymous "AI".
7. **Anti-anchor:** ML top3 passed to Gemini labeled unverified; evaluation checks Gemini-tier disagreement rate (if ~0, anchoring suspected → hint removed).
8. **Kill-switches:** env flags disable any tier independently (ops safety, also powers failure-injection tests).
