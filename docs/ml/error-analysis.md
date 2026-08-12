# Error Analysis Plan (executes after each evaluation run)

Scripted (`scripts/ml/error-analysis.py`) + human review checklist; findings recorded here per model version.

1. **Confusion clusters:** top-10 confused pairs; per pair: sample grid rendered, hypothesis (visual similarity? label noise? class definition overlap?), action (KB hedging / class merge proposal / augmentation tweak).
2. **Per-crop breakdown:** which crops underperform; images/class correlation check (is it just data volume?).
3. **Background reliance probe:** Grad-CAM on 20 samples/crop — is attention on lesions or on lab backgrounds? (PlantVillage risk). Field-test gap per class quantifies it; documented in README limitations.
4. **Overfitting check:** train-val curve divergence; val vs test delta.
5. **Confidence autopsy:** high-confidence-wrong samples individually reviewed (worst failure mode); count reported.
6. **Field degradation:** in-domain vs PlantDoc per-class delta table — the honest slide.
7. **Label-noise sweep:** top-loss training samples (potential mislabels) → quarantine list → retrain decision if >2%/class.
Actions taken recirculate through training-plan (documented experiments); "poor results reported honestly and investigated" is the operating rule — no metric laundering.
