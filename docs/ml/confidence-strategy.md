# Confidence Strategy

## Calibration
Temperature scaling (single T, LBFGS on val NLL) — softmax probabilities become trustworthy before any thresholding. ECE reported pre/post.

## Thresholds (derived from validation curves, not guessed)
- **τ (general acceptance):** chosen where val precision-of-accepted ≥0.90 while maximizing coverage (precision-coverage curve; expected neighborhood 0.70–0.80 — final value = data's answer, recorded with the curve in evaluation results).
- **τ_healthy (stricter):** healthy predictions accepted only if P(healthy) ≥ τ_healthy, set where false-negative-disease rate among accepted-healthy ≤5% on val. Below τ_healthy → treated as uncertain even if top-1.
- Margin guard: top1−top2 < 0.15 → uncertain (confusable pair) regardless of τ.

## Runtime policy (ml-service returns; backend routes)
| Condition | Response → backend action |
|---|---|
| conf ≥ τ (and healthy rule satisfied) | prediction + confidence + top3 → serve, source 'ml' |
| conf < τ or margin/healthy guard | `{uncertain:true, top3}` → escalate Gemini (top3 passed as context hint, prompt forbids anchor bias: "candidates, may be wrong") |
| declared-crop mask leaves no class ≥ small floor | crop-mismatch warning branch |
Uncertainty is a designed product outcome (UF-5): "couldn't confidently identify" + retake tips + symptom checklist. **Never force a prediction** — contractual (test-enforced).
