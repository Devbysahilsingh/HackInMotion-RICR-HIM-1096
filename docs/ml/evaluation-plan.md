# Evaluation Plan

## Battery (scripted `scripts/ml/evaluate.py`; all outputs land in docs/ml/evaluation-results/ + experiments log)
1. **Held-out test set** (in-domain): accuracy, precision/recall/F1 per class, **macro-F1 (primary metric)**, confusion matrix (rendered PNG), top-3 accuracy.
2. **Field test set (PlantDoc overlap)**: same metrics — **the honest number**; expected materially lower for PV-trained crops; published, not hidden. Rice field-ness comes from Paddy Doctor itself.
3. **Calibration:** reliability diagram + ECE pre/post temperature scaling; confidence histograms per correctness.
4. **Crop-masked evaluation:** metrics recomputed under declared-crop masking (production condition) — expected ↑; both reported.
5. **Slice checks:** per-crop macro-F1 (no crop hidden behind the average); healthy-class recall specifically.

## Dangerous-misclassification analysis (farmer-facing stakes)
Ranked severity: (1) disease→HEALTHY false negatives ("your crop is fine" while diseased = worst outcome) — stricter healthy-acceptance threshold τ_healthy > τ (confidence-strategy); (2) wrong-disease-with-treatment-divergence pairs (e.g., fungal vs viral: opposite actions) — confusion pairs audited, KB wording hedges where confusable; (3) HEALTHY→disease false positives (cost: unnecessary worry/inspection — acceptable asymmetry, stated).

## Ship gates (model may NOT ship below these)
Val macro-F1 ≥0.85 in-domain; healthy-class recall ≥0.90 @τ_healthy; field-test macro-F1 reported whatever it is (no gate — honesty gate instead: number must appear in README); calibration ECE ≤0.05 post-scaling; per-crop macro-F1 ≥0.75 or that crop's model support is demoted to GENERAL for launch (registry flip, announced).
Failure handling: gates missed → iterate within time budget; still missed → demote affected crops, ship the rest. The product never depends on the model shipping (Gemini path is full-quality).
