# Dataset Preparation

Pipeline (`scripts/ml/prepare-datasets.py`, deterministic, seeded):
1. **Ingest** from `datasets/raw/` using audit's keep-lists (corrupt/quarantined excluded).
2. **Class mapping** → unified codes (crop-class-mapping.md); unmappable → excluded, counted.
3. **Resize policy:** none at rest (train-time transforms handle it); EXIF orientation normalized; RGB coerced; save-as-is to `datasets/prepared/<classCode>/`.
4. **Splits:** stratified 70/15/15 per class, seeded (SEED=42); **near-duplicate clusters assigned atomically to one split** (leakage prevention); Paddy Doctor: respect competition's held-out philosophy — our test split from labeled train only.
5. **Field test set:** PlantDoc overlap classes → `datasets/fieldtest/` — NEVER seen in training/val; cross-set dedup vs train enforced.
6. **Class balancing:** no oversampling on disk; handled at train time via WeightedRandomSampler + class-weighted CE (evaluation-plan covers per-class reporting so imbalance isn't hidden).
7. **Manifest:** `datasets/manifest.json` — file→split→class, checksums, counts, seed, script version. Reproducibility contract: same raw + same script version ⇒ identical splits.

## Augmentation (train only; torchvision v2 / albumentations)
RandomResizedCrop(224, scale 0.7–1.0) · HFlip · Rotation ±20° · ColorJitter (0.3/0.3/0.2) · GaussianBlur p=0.15 · RandomErasing p=0.1 · **domain-gap set:** RandomShadow/brightness extremes p=0.2, simulated background patches behind segmented PlantVillage leaves where masks exist (stretch — only if Day-1 time allows; not load-bearing). Val/test: Resize(256)→CenterCrop(224) only. Normalization: ImageNet stats (documented — must match inference exactly; golden-image parity test).
