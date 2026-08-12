# ADR-003 · EfficientNet-B0 + selected datasets
**Status:** Accepted (dataset audit pending execution) · 2026-08-12
**Decision:** EfficientNet-B0 transfer learning (ResNet18 pipeline baseline); train on Paddy Doctor + PlantVillage subsets + Mendeley chilli sets (+SAR-CLD cotton gated OD-1); PlantDoc as field test set only.
**Alternatives:** MobileNetV3-L (kept as latency swap), EffNet-B1 (VRAM/time cost > gain), ResNet18-only (accuracy left on table); PlantWild/SoyNet/Zindi (deferred/rejected — mapping cost, future, license).
**Reason:** best accuracy-per-parameter in 4GB envelope; datasets = evidence-scored (docs/ml/dataset-research.md).
**Trade-offs:** lab-image domain gap on 3 crops — measured on PlantDoc and disclosed rather than avoided.
