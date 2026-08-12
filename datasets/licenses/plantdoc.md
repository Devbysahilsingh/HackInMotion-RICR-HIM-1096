# PlantDoc — licence and provenance record

**Acquired for:** HIM-1096 crop-health model (TODO P0-4) — used as the **held-out field-domain test set**, never for training (`docs/ml/dataset-preparation.md`).
**Archive obtained:** `PlantDoc-Dataset-master.zip`
**Source used:** GitHub `pratikkayal/PlantDoc-Dataset` — the authors' own repository
**Direct URL:** `https://codeload.github.com/pratikkayal/PlantDoc-Dataset/zip/refs/heads/master`
**Integrity note:** GitHub generates codeload archives per request, so no publisher checksum or `Content-Length` exists. Our own sha256 of the retrieved archive is recorded in `datasets/manifest-raw.json` for local reproducibility; it is not expected to match across re-downloads if the branch advances.

## Licence: CC BY 4.0 — unambiguous

Verified directly against the source repository, with three consistent signals and **no disagreement between sources**:

- `LICENSE.txt` in the repository root contains the full Creative Commons Attribution 4.0 International legal code (18,649 bytes).
- The GitHub API reports `license: cc-by-4.0`.
- The repository README states "Creative Commons Attribution 4.0 International".

**Permitted:** commercial use, redistribution, and derivative works — provided attribution is given and changes are indicated. This is materially more permissive than the PlantVillage position and imposes no share-alike obligation.

## Our compliance position

Attribution is given below and in `docs/ml/dataset-research.md`. Raw images remain gitignored and are not redistributed from this repository.

## Citation (required)

> Singh, D., Jain, N., Jain, P., Kayal, P., Kumawat, S., Batra, N. (2020). *PlantDoc: A Dataset for Visual Plant Disease Detection.* Proceedings of the 7th ACM IKDD CoDS and 25th COMAD, 249–253. DOI 10.1145/3371158.3371196

## Scope note (important for the P0-5 audit)

This repository hosts the **Cropped-PlantDoc classification** variant — per-class `train/` and `test/` folders, which is what a leaf-disease classifier needs. The 2,598-image / 13-species / 17-disease figure quoted in the paper describes the *detection* dataset with bounding boxes, distributed separately. Research reported **28 class directories in `train/` and 27 in `test/`**; the discrepancy (one class lacking a test split) must be confirmed and handled during the P0-5 audit when the label map is built.
