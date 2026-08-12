# Dataset Audit (TODO P0-5)

**Status: EXECUTED 2026-08-12.** Every number below was produced by `scripts/ml/audit-datasets.py` over the P0-4 corpus and is reproducible from `datasets/audit-report.json` (committed). Nothing here has been acted on: no image was moved, deduplicated, split or relabelled, and the crop registry is untouched. The decisions this audit exists to inform are listed at the end and are the team's to make.

Steps 1 (integrity) and 2 (licence capture) of the original plan were completed during P0-4 — 40/40 sample decode per dataset, licences in `datasets/licenses/` — and are re-verified here at full corpus scale rather than by sampling.

---

## Method

| Stage | How |
|---|---|
| Census | Every image under declared class containers enumerated and decoded once; dimensions, format and byte size recorded. Layouts are declared explicitly, and a missing container is a hard error — a partial census is never reported as a complete one. |
| Exact duplicates | SHA-1 over file bytes, computed during the same read. |
| Near duplicates | 64-bit DCT perceptual hash → **exact** all-pairs Hamming comparison (no approximate index, so no pair within threshold 8 is missed) → **pixel verification** → union-find clustering. |
| Quality sampling | 30 images per in-scope class, seeded, rendered as contact sheets for visual review. |
| Cotton OD-1 | The criteria pre-registered in this document before any data was inspected, evaluated mechanically against post-dedup counts. |

### Why there is a verification stage

pHash alone is not usable on this data, and the first run proved it: it produced a **single 14,367-image "duplicate" cluster spanning all six datasets**, asserting that chilli leaves duplicate soybean leaves. A leaf photographed against a plain background has little high-frequency content, so unrelated crops land close together in hash space, and union-find then chains them through the dense region.

Every candidate pair is therefore verified by normalised cross-correlation of 64×64 grayscale thumbnails before it may form a cluster. The 0.95 cut is calibrated, not chosen by taste:

| Control | Result |
|---|---|
| Byte-identical pairs (must pass) | min NCC **1.000** |
| JPEG re-encode / rescale / brightness shift (must pass) | min NCC **≥0.979** |
| pHash candidates that are visibly different crops (must fail) | max NCC **0.895** |
| 20,000 random pairs | mean 0.094, p99 0.626, max 0.868, **none** above the cut |

Verification rejected **82,472 of 98,692 candidates (83.6%)**. The remaining cross-dataset cluster count fell from 303 → 0, and the surviving cross-label pairs are exactly the agronomically confusable ones (see below) — which is the sanity check that the cut is in the right place.

**Known limitation, stated rather than papered over:** copies cropped by more than ~5%, rotated or mirrored are *not* detected — pHash does not propose them and NCC would not confirm them. This matters for cotton's augmented split and is handled by exclusion, not by dedup.

---

## 1. Census

**83,421 images, 0 decode failures, 0 corrupt files.** (`manifest-raw.json` records 83,422: the extra file is `PlantDoc_Examples.png`, a README asset at the PlantDoc repository root, correctly outside every class directory.)

| Dataset | Group | Classes | In scope | Images | Imbalance | Median size |
|---|---|---|---|---|---|---|
| plantvillage | all | 39 | 18 | 55,448 | 36.2:1 | 256×256 |
| plantdoc | train | 28 | 14 | 2,336 | 89.5:1 | mixed, 85–1300 px |
| plantdoc | test | 27 | 13 | 236 | 3.0:1 | mixed, 69–1600 px |
| chilli_primary | all | 6 | 6 | 8,817 | 2.2:1 | up to 1000 px |
| chilli_secondary | all | 4 | 4 | 1,515 | 1.2:1 | 1728–4080 px |
| cotton_sarcld2024 | original | 7 | 7 | 2,137 | 5.0:1 | 800×800 |
| cotton_sarcld2024 | augmented | 7 | 7 | 7,000 | 1.0:1 | 800×800 |
| rice_odisha | all | 4 | 4 | 5,932 | 1.2:1 | ~300×300 |

**Post-deduplication counts per unified class code** (cluster-atomic: one survivor per near-duplicate cluster). 36 codes carry data:

| Code | n | Code | n | Code | n |
|---|---|---|---|---|---|
| TOMATO_YELLOW_LEAF_CURL_VIRUS | 5,430 | CHILLI_CERCOSPORA_LEAF_SPOT | 1,997 | MAIZE_COMMON_RUST | 1,307 |
| TOMATO_BACTERIAL_SPOT | 2,234 | TOMATO_SEPTORIA_LEAF_SPOT | 1,910 | MAIZE_NORTHERN_LEAF_BLIGHT | 1,168 |
| TOMATO_LATE_BLIGHT | 2,001 | CHILLI_LEAF_CURL_VIRUS | 1,873 | MAIZE_HEALTHY | 1,160 |
| TOMATO_SPIDER_MITES | 1,678 | CHILLI_HEALTHY | 1,753 | BACKGROUND_NO_LEAF | 1,135 |
| TOMATO_HEALTHY | 1,647 | TOMATO_TARGET_SPOT | 1,404 | COTTON_LEAF_REDDENING | 1,125 |
| TOMATO_EARLY_BLIGHT | 1,081 | POTATO_EARLY_BLIGHT | 1,114 | POTATO_LATE_BLIGHT | 1,097 |
| TOMATO_LEAF_MOLD | 1,042 | CHILLI_NUTRIENT_DEFICIENCY | 1,006 | COTTON_CURL_VIRUS | 958 |
| RICE_TUNGRO | 852 | CHILLI_POWDERY_MILDEW | 821 | COTTON_BACTERIAL_BLIGHT | 754 |
| COTTON_HERBICIDE_DAMAGE | 752 | CHILLI_BACTERIAL_SPOT | 743 | COTTON_HEALTHY | 723 |
| COTTON_LEAF_HOPPER_JASSIDS | 707 | RICE_BROWN_SPOT | 606 | MAIZE_GRAY_LEAF_SPOT | 580 |
| RICE_BACTERIAL_LEAF_BLIGHT | 514 | COTTON_LEAF_VARIEGATION | 507 | RICE_BLAST | 474 |
| TOMATO_MOSAIC_VIRUS | 427 | CHILLI_ANTHRACNOSE | 323 | **POTATO_HEALTHY** | **152** |

Corpus imbalance after dedup is **36:1** (TOMATO_YELLOW_LEAF_CURL_VIRUS vs POTATO_HEALTHY). `POTATO_HEALTHY` at 152 images is the outlier that matters: the ship gate requires healthy-class recall ≥0.90, and potato's healthy class has less data than any disease class in the corpus.

35 raw class directories are out of scope (other PlantVillage/PlantDoc crops: apple, grape, orange, soybean…). They are counted, not deleted — whether they serve as negative/background data is a P0-6 decision.

---

## 2. Duplicates

### Exact (byte-identical)

**2,502 groups covering 5,332 images → 2,830 redundant copies.**

| Dataset | Redundant copies |
|---|---|
| rice_odisha | 1,138 |
| chilli_primary | 881 |
| cotton_sarcld2024 | 776 |
| plantvillage | 23 |
| plantdoc | 12 |
| chilli_secondary | 0 |

Independently confirmed with `sha256sum` on sampled files: e.g. `BACTERAILBLIGHT3_{074,084,086,088}.jpg` are one image stored four times.

### Near (verified)

**16,220 pairs → 5,048 clusters → 9,021 redundant images (10.8% of the corpus).**

| Dataset | Images | Redundant | Survivors |
|---|---|---|---|
| rice_odisha | 5,932 | 3,486 | **2,446 (−59%)** |
| cotton_sarcld2024 | 9,137 | 3,611 | 5,526 |
| chilli_primary | 8,817 | 1,790 | 7,027 |
| plantdoc | 2,572 | 67 | 2,505 |
| plantvillage | 55,448 | 41 | 55,407 |
| chilli_secondary | 1,515 | 26 | 1,489 |

Cluster sizes: 2,898 pairs · 1,964 of 3–5 · 185 of 6–20 · 1 of 21–100 (47 images, chilli bacterial spot). No runaway clusters remain.

**The rice result is the headline: the Odisha set is 59% redundant.** Its usable size is ~2,446 images across 4 classes, not 5,932. Every published figure for this dataset counts the duplicates.

**Cross-dataset clusters: 0.** PlantVillage and PlantDoc share no verified duplicate images. The plan's central worry — that the "field test set" is contaminated by training data — **is not present in this corpus.** The field-test design survives.

---

## 3. Leakage across publisher-provided splits

| Boundary | Finding |
|---|---|
| **PlantDoc train ↔ test** | 14 near-duplicate clusters span the boundary (29 images); 11 groups are byte-identical across it, and **8 of those carry conflicting labels** |
| **Cotton original ↔ augmented** | 1,398 clusters span the boundary (4,114 images) — as designed; the augmented set is derived from the originals |

The PlantDoc finding is the serious one. The *same file* appears in train and test under *different diseases*:

- `2015070295153021.jpg` — train/*Corn Gray leaf spot* and test/*Corn leaf blight*
- `corn-gray-leaf-spot-f4.jpg` — train/*Corn Gray leaf spot* and test/*Corn leaf blight* (the filename itself names the disease)
- `1421_0.jpeg_itok=FMtmgePj.jpg` — train/*Potato early blight* and test/*Potato late blight*
- `tomato_V8.jpg` — train/*Tomato Septoria leaf spot* and test/*Tomato bacterial spot*

This is both leakage and label contradiction in the set we intended to use as the honest field benchmark. It is small (8 groups) and fixable by deduplicating PlantDoc against itself and dropping the contradicted files, but it must be fixed rather than inherited.

Cotton's overlap is expected, and note the limitation above: only 4,114 of 7,000 augmented images were linked back to an original, because rotations and mirrors are invisible to this method. **The augmented split must be excluded from validation and test wholesale** — dedup cannot be relied on to catch it.

### Label conflicts (near-identical images, different labels)

| Pair | n |
|---|---|
| COTTON_CURL_VIRUS ↔ COTTON_HEALTHY | 39 |
| POTATO_EARLY_BLIGHT ↔ POTATO_LATE_BLIGHT | 7 |
| POTATO_EARLY_BLIGHT ↔ TOMATO_EARLY_BLIGHT | 5 |
| MAIZE_GRAY_LEAF_SPOT ↔ MAIZE_NORTHERN_LEAF_BLIGHT | 4 |
| remaining pairs | ≤4 each |

Every one of these is a genuinely confusable pair, which is corroborating evidence for the method. The 39 cotton curl-virus/healthy conflicts deserve review: early curl virus on a leaf that still looks green is exactly the case where the model will mislead a farmer.

---

## 4. Quality sampling (visual)

73 contact sheets were generated (30 seeded samples per in-scope class) under `datasets/audit/contact-sheets/`. **24 sheets (~720 images) were reviewed in this pass**; the remaining 49 exist and are available for the team. Sheets are not committed — they are derived image data, regenerable by re-running the script.

**Findings that change decisions:**

1. **Both chilli datasets are studio images, not field images.** `chilli_primary` is background-removed cut-outs on pure white; `chilli_secondary` is single leaves laid on white paper. Nothing in either resembles a photograph a farmer would take of a chilli plant. There is also no field-realistic chilli test set anywhere in the corpus — so unlike tomato/potato/maize, **chilli has no way to measure its own domain gap.**
2. **The two chilli sets are separable by capture style alone.** `CHILLI_ANTHRACNOSE` exists only in the paper-background set; `POWDERY_MILDEW`, `NUTRIENT_DEFICIENCY` and `BACTERIAL_SPOT` only in the cut-out set. A model can score well by learning the background instead of the disease.
3. **`chilli_primary/Bacterial_Spot` is visually heterogeneous.** In the 30-image sample, several leaves show interveinal chlorosis or vein clearing (nutrient/viral in appearance) and several show no visible lesions at all. Flagged for agronomist review, not asserted as mislabelled.
4. **PlantVillage `Background_without_leaves` is Western stock/tourist photography** — streets, boats, churches, a parrot, cars, fjords. As a "not a leaf" rejection class it would teach the model that *not-a-leaf means European holiday photo*. It would not reject soil, a hand, a wall, or a chilli fruit photographed in an Indian field.
5. **PlantDoc contains watermarked stock images and non-photographs.** Shutterstock, Alamy and Getty watermarks are visible in the train set; the test `Tomato Septoria leaf spot` class contains a **screenshot of a web factsheet**, and test `Tomato leaf` (8 images) contains **chopped herbs on a cutting board**. Watermarks are learnable artifacts, and the licence position of scraped stock imagery inside a CC BY 4.0 release is not something we can verify.
6. **Cotton labelling looks sound.** Variegation, bacterial blight, jassid damage and healthy all read as coherent and consistent across their samples, in real field conditions. Both field and white-background captures appear across all classes, so background is not a class marker within cotton.
7. **PlantVillage maize NLB samples frequently show rust pustules too** — co-infection under single-label supervision is a real limitation, not a bug to fix here.
8. **Rice images are genuine field photographs** (leaves in hand, against soil, in standing crop) — the most deployment-realistic data in the corpus.

*Caveat, explicitly:* this reviewer is not an agronomist. The <10% label-error criterion in the cotton gate requires human sign-off; the observations above are what is visible, not a plant-pathology verdict.

---

## 5. Cotton gate (OD-1)

Criteria as pre-registered: ≥150 clean images/class post-dedup for ≥6 of 8 classes; label error <10% in sample; near-duplicate inflation ≤30%.

**First, a plan correction: the dataset has 7 classes, not 8.** The 8-class figure in `crop-class-mapping.md` was an assumption; SAR-CLD-2024's original split contains seven.

| Class | Raw | Post-dedup | ≥150 |
|---|---|---|---|
| Leaf Redding | 578 | 576 | ✅ |
| Curl Virus | 431 | 431 | ✅ |
| Herbicide Growth Damage | 280 | 280 | ✅ |
| Healthy Leaf | 257 | 252 | ✅ |
| Bacterial Blight | 250 | 250 | ✅ |
| Leaf Hopper Jassids | 225 | 225 | ✅ |
| **Leaf Variegation** | 116 | **116** | ❌ |

- Classes passing: **6** (threshold: ≥6) ✅
- Near-duplicate inflation: **0.3%** (threshold: ≤30%) ✅
- Label error: contact-sheet review found no obvious mislabelling; **awaiting human sign-off** ⏳

**Mechanical verdict: PASS**, on 6 of 7 rather than 6 of 8. The gate is met on its own terms, but the team should decide knowingly, because the honest reading is "passes with one class short and the smallest class at 116 images". Options: promote cotton to SPECIALIZED with all 7 classes; promote with Leaf Variegation dropped or merged; or hold at GENERAL. **This audit does not decide it.**

---

## 6. Rice class map vs reality

`crop-class-mapping.md` lists 10 rice codes from the rejected Paddy Doctor set. The substituted Odisha set supplies **4**:

| Code | Post-dedup |
|---|---|
| RICE_TUNGRO | 852 |
| RICE_BROWN_SPOT | 606 |
| RICE_BACTERIAL_LEAF_BLIGHT | 514 |
| RICE_BLAST | 474 |

No data exists for `RICE_NORMAL`, `RICE_BACTERIAL_LEAF_STREAK`, `RICE_BACTERIAL_PANICLE_BLIGHT`, `RICE_DEAD_HEART`, `RICE_DOWNY_MILDEW`, `RICE_HISPA`.

`RICE_NORMAL` is the one that is a product problem, not a coverage problem: **a rice classifier with no healthy class cannot tell a farmer their crop is fine.** Every rice photograph gets assigned one of four diseases. Under the confidence strategy, healthy rice would surface as low-confidence → "couldn't confidently identify", which is honest but is not an answer.

---

## Acceptance gates for training

| Gate | Status |
|---|---|
| No cross-split leakage (verified) | ⚠️ **Not yet met** — PlantDoc train/test overlap must be removed first (8 contradicted groups, 11 duplicate groups) |
| Every class ≥50 test images, or merged/dropped with reason | ⚠️ At a 15% test split, `POTATO_HEALTHY` (152) yields ~23 and `CHILLI_ANTHRACNOSE` (323) ~48 — both below 50 |
| Licence texts on file | ✅ `datasets/licenses/`, verified against publisher endpoints in P0-4 |
| No corrupt images | ✅ 0 decode failures across 83,421 images |

---

## Decisions this audit puts to the team

**Recommendations for all seven are now drafted in [ADR-021](../decisions/ADR-021-dataset-curation-decisions.md) — status PROPOSED, awaiting team approval. Nothing has been implemented.**

None of these are pre-empted here.

1. **Cotton OD-1** — SPECIALIZED (7 classes), SPECIALIZED minus Leaf Variegation, or stay GENERAL.
2. **Rice healthy class** — source healthy rice imagery, mask rice out of the healthy head, or demote rice's support tier. Shipping four disease classes with no healthy option is the one outcome that misinforms farmers.
3. **`Background_without_leaves`** — drop it, or keep it while accepting that it rejects the wrong things; a small India-relevant negative set would serve the product better.
4. **Chilli domain gap** — accept studio-only training with a documented limitation, gather a small field-realistic chilli validation set, or demote chilli's claimed accuracy language. Related: whether merging the two chilli sets is safe given they are separable by background.
5. **PlantDoc cleaning** — remove the 11 cross-split duplicate groups and the 8 label-contradicted files; decide separately whether watermarked stock images and non-photographs stay in a benchmark we publish numbers from.
6. **Rice's real size** — proceed with ~2,446 usable images, or seek additional rice data.
7. **`POTATO_HEALTHY` at 152** — accept, augment, merge, or source more, given the healthy-recall ship gate.

---

## Addendum — P0-5b re-audit after the rice healthy acquisition (2026-08-12)

`rice_healthy_diu` (Mendeley `g7tcwvshff`, CC BY 4.0) was acquired under ADR-021 decision 2 and the full audit re-run. **The tables above describe the 6-dataset corpus; the figures below supersede them where they differ.**

| | Before | After |
|---|---|---|
| Datasets | 6 | 7 |
| Images audited | 83,421 | **94,187** |
| Decode failures | 0 | **0** |
| Near-duplicate clusters | 5,048 | 5,236 |
| Redundant images | 9,021 | 9,362 |
| **Cross-dataset clusters** | 0 | **0** |

**The dedup gate required by decision 2 passes:** zero verified duplicates between the new dataset and `rice_odisha`, so the two are additive rather than overlapping. Internal redundancy is low (341 of 10,766, 3.2%) and publisher counts reproduce exactly (raw 2,508 / augmented 8,258).

**Rice class set, raw-only and deduplicated** — `RICE_NORMAL` now exists at **582** images:

| Code | Odisha (field) | DIU (studio) | Total |
|---|---|---|---|
| RICE_TUNGRO | 852 | 231 | 1,083 |
| RICE_BLAST | 474 | 590 | 1,064 |
| RICE_BACTERIAL_LEAF_BLIGHT | 514 | 209 | 723 |
| RICE_BROWN_SPOT | 606 | — | 606 |
| RICE_NORMAL | — | 582 | 582 |
| **Usable rice total** | 2,446 | 1,612 | **4,058** |

Two findings carry forward to ADR-021 rather than being settled here: the healthy images are **studio, not field** (detached leaves on white paper), leaving `RICE_NORMAL` with no field-realistic examples; and the audit reports **0** original↔augmented duplicate clusters for this dataset despite the publisher stating the augmented set is derived from the raw one — a demonstration of the rotation/mirror blind spot, not evidence of independence. The DIU `Rice` class (584 post-dedup) is a whole-plant category and is deliberately left unmapped.

Counts that aggregate across a dataset's groups (`mapped_codes_dedup_counts` in the JSON) include augmented images for cotton and DIU rice. **Use the per-group figures in `dedup_counts_by_class` for anything that matters.**

## Reproducing

```
python scripts/ml/audit-datasets.py                 # full run (~6 min cold, ~2 min cached)
python scripts/ml/audit-datasets.py --only cotton_sarcld2024
python scripts/ml/audit-datasets.py --ncc-min 0.97  # stricter verification
```

`--only` rewrites the report with just those datasets (cross-dataset analysis becomes meaningless), so it warns and must be followed by a full run.

Results: `datasets/audit-report.json`. Contact sheets and the hash cache land in `datasets/audit/` and are gitignored.
