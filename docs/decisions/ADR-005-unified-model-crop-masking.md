# ADR-005 · One unified model + inference-time crop masking
**Status:** Accepted · 2026-08-12
**Decision:** single softmax over ~34–44 classes; logits masked to declared crop's classes at inference; temperature-calibrated; validation-derived thresholds; unmasked-disagreement → crop-mismatch warning.
**Alternatives:** per-crop models (6× cost); shared backbone multi-head (equal benefit, more code); hierarchical crop-ID→disease (redundant — crop is declared).
**Reason:** one training run, one artifact, crop-conditional precision for free, clean explainability.
**Trade-offs:** class imbalance across crops handled via sampler/weights + per-crop metric gates (no crop hidden behind averages).
