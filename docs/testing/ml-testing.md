# ML Testing

## pytest suites (ml-service + training utils)
- Preprocessing determinism: same bytes → identical tensor (hash) across runs; EXIF-rotated pair → same tensor.
- **Golden parity:** 100 fixed images → PyTorch vs ONNX |Δprob|<1e-3 (export gate); training-vs-inference preprocessing identity (the classic silent killer).
- Threshold policy: synthetic prob vectors → accept/uncertain/mismatch branches exactly per confidence-strategy.md; healthy-guard cases; margin cases.
- Crop masking: masked class set correct per cropCode; renormalization sums to 1; empty-mask → mismatch branch.
- Robustness inputs: corrupt jpeg, 1×1 px, huge dims (bomb guard), non-image bytes, HEIC → correct rejections, no crashes.
- API contract: /predict schema, service-key enforcement, /healthz shape.
## Evaluation battery = docs/ml/evaluation-plan.md (ship gates blocking).
## Adversarial fixtures (with ai chain, backend-side)
Non-plant photo (shoe) → imageAssessment branch; wrong-crop (rice leaf declared tomato) → mismatch warning; injected instructions in description → guidance unchanged (fixture-diffed); identical image re-upload → cache hit (no quota burn).
## Honesty rule
Every reported metric traces to a committed evaluation artifact (results JSON + confusion PNG in docs/ml/evaluation-results/); README numbers copied from artifacts only.
