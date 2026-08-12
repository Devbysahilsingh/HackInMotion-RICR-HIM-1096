# Dataset Audit Plan (executes Day 0 — output lands HERE)

Status: **PENDING EXECUTION** (blocked on Kaggle creds OD-6 + START IMPLEMENTATION gate). No metrics exist yet; nothing below is a result.

## Audit procedure (scripted: `scripts/ml/audit-datasets.py`)
1. **Integrity:** decode every image (PIL); corrupt → quarantine list; formats/sizes histogram.
2. **License texts:** capture exact license file/page text per dataset → recorded in this doc + decisions log.
3. **Class census:** per dataset: images/class table, imbalance ratios, naming reconciliation against our class map (crop-class-mapping.md).
4. **Duplicates/leakage:** perceptual hash (pHash, hamming ≤8) within and ACROSS datasets; cross-set dupes (esp. PlantDoc vs PlantVillage web-sourced overlap) → removed from TEST side; near-dup clusters kept within a single split only.
5. **Quality sampling:** 30 random images/class eyeballed (contact sheet generated) — label sanity, watermark/junk detection.
6. **Cotton gate (OD-1) criteria:** ≥150 clean images/class post-dedup for ≥6 of 8 classes; label error rate <10% in sample; no catastrophic near-dup inflation (>30%). Pass → SPECIALIZED; fail → GENERAL (announced, registry updated).
7. **Report:** tables + contact sheets → this file + `docs/ml/` assets; team approval required before training proceeds.

## Acceptance gates for ANY training run
No cross-split leakage (pHash verified); every class ≥50 test images or class merged/dropped (documented); license texts on file.
