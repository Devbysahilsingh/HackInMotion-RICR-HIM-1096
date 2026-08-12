# PlantVillage — licence and provenance record

**Acquired for:** HIM-1096 crop-health model (TODO P0-4)
**Archive obtained:** `Plant_leaf_diseases_dataset_without_augmentation.zip`
**Source used:** Mendeley Data record `tywbtsjrjv` v1 — https://data.mendeley.com/datasets/tywbtsjrjv/1 (DOI 10.17632/tywbtsjrjv.1)
**Direct file URL:** `https://data.mendeley.com/public-files/datasets/tywbtsjrjv/files/d5652a28-c1d8-4b76-97f3-72fb80f94efc/file_downloaded`
**Publisher-stated size / checksum:** 868,032,562 bytes · sha256 `ac3432453984d02a86197987e775a5429d0d59e7cc7c35bcf5a8f50349b90ff0` (verified on download — see `datasets/manifest-raw.json`)

## ⚠ Licence status: CONTESTED — five sources, four different answers

This must not be reported as a single clean licence. What each source actually states:

| Source | Licence stated | Relationship to the data |
|---|---|---|
| PlantVillage / Penn State (David Hughes, co-creator) | "Creative Commons 3.0 Share and Share Alike" | **Originator** |
| Mohanty's own HuggingFace dataset card (`mohanty/PlantVillage`) | CC-BY-SA-3.0 | **Originator** |
| GitHub `spMohanty/PlantVillage-Dataset` (canonical repo) | **No LICENSE file at all** (GitHub API reports `license: null`) | Originator's repo — default terms are all-rights-reserved |
| Mendeley `tywbtsjrjv` (the archive we downloaded) | CC0 1.0 Public Domain Dedication | **Third-party republication** by Pandian & Geetharamani |
| Zenodo record 1204914 / TensorFlow Datasets catalog | CC BY 4.0 | Downstream mirrors |

**The two creator-sourced statements agree on CC BY-SA 3.0.** The CC0 assertion originates from a derivative republication, not from the data's creators, so it cannot be relied on as authoritative.

## Our compliance position

We comply with the **strictest reasonable reading (CC BY-SA 3.0)**, which also satisfies every looser interpretation:

1. **Attribution given** — see citation below, reproduced in the project README and `docs/ml/dataset-research.md`.
2. **No redistribution** — raw and processed images stay gitignored and are never published from this repository.
3. **Non-commercial hackathon use** — permitted under all five interpretations.

**Open question flagged for the team (not resolved here):** whether a trained model constitutes an "adaptation" under ShareAlike is legally unsettled. It has no effect on hackathon use, but must be resolved before any commercial deployment. Recorded alongside the CC BY-NC chilli-set caveat in ADR-012.

## Citation (required)

> Mohanty, S.P., Hughes, D.P., Salathé, M. (2016). *Using deep learning for image-based plant disease detection.* Frontiers in Plant Science 7:1419. DOI 10.3389/fpls.2016.01419

Original data collection: Hughes, D.P. & Salathé, M. (2015), PlantVillage project.

## Selection note

The **unaugmented** archive was chosen deliberately over the augmented variant: pre-augmented images would place near-duplicates on both sides of a train/validation split, inflating metrics. Augmentation is applied by us at training time instead (`docs/ml/dataset-preparation.md`).
