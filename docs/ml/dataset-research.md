# ML Dataset Research & Acquisition Record

**Status:** P0-4 acquisition executed 2026-08-12. Provenance, licences and integrity below are **verified against publisher endpoints**, not inferred. Class counts, quality and duplication are deliberately NOT settled here — that is the P0-5 audit's job, on evidence.

Original scoring method (quality 20 / field-data 20 / Indian relevance 15 / disease coverage 15 / ML feasibility 15 / 72h 10 / market value 5) selected the candidate set; this document now records what was actually obtained.

---

## Acquisition results (executed, verified)

| Dataset | Crops | Source | Licence (verified) | Images | Checksum | Decode |
|---|---|---|---|---|---|---|
| PlantVillage (unaugmented) | tomato, potato, maize | Mendeley `tywbtsjrjv` v1 | **Contested** — creators say CC BY-SA 3.0; this republication asserts CC0 1.0 | **55,448** | ✅ publisher-matched | 40/40 |
| PlantDoc (Cropped) | field test domain | GitHub `pratikkayal/PlantDoc-Dataset` | **CC BY 4.0** (LICENSE.txt in repo) | **2,573** | local hash only¹ | 40/40 |
| Chilli primary | chilli | Mendeley `tm3v4zmh7c` v1 | **CC BY 4.0** | **8,817** | ✅ publisher-matched | 40/40 |
| Chilli secondary | chilli | Mendeley `wzc6r6w5w5` v3 | **CC BY 4.0** | **1,515** | ✅ publisher-matched | 40/40 |
| SAR-CLD-2024 cotton | cotton | Mendeley `b3jy2p6k8w` v2 | **CC BY 4.0** | **9,137** | ✅ publisher-matched | 40/40 |
| Rice (Odisha, Sethy) | rice | Mendeley `fwcj7stb8r` v1 | **CC BY 4.0** | **5,932** | ✅ publisher-matched | 40/40 |
| ~~Paddy Doctor~~ | rice | — | **UNKNOWN — none published** | — | — | **REJECTED**, superseded |

**Total: 83,422 images, 16.3 GB on disk. Zero corrupt files in sampling. Five of six archives byte-for-byte checksum-verified against publisher-published sha256 values.**

¹ GitHub generates codeload archives per request, so no publisher checksum exists; our own sha256 is recorded for local reproducibility.

Exact byte counts, checksums, per-dataset counts and decode results: `datasets/manifest-raw.json`. Full licence records: `datasets/licenses/`.

### Published-count reconciliation

Every count was checked against the publisher's claim rather than assumed:

| Dataset | Published | Obtained | Reconciliation |
|---|---|---|---|
| PlantVillage | 54,303 | 55,448 | Surplus is the `Background_without_leaves` class this republication includes and TFDS drops. **P0-5 must decide whether to keep it.** |
| PlantDoc | ~2,598 | 2,573 | Count excludes `LICENSE.txt`/`README.md`; the cropped classification variant differs slightly from the detection figure. |
| Chilli primary | ~8,814 | 8,817 | Effectively exact. |
| Chilli secondary | 1,515 (v3) | 1,515 | **Exact** — after excluding 1,519 macOS AppleDouble stubs (see below). |
| Cotton | 2,137 original + 7,000 augmented | 9,137 | **Exact.** Augmented images must be kept out of val/test splits (P0-6). |
| Rice (Odisha) | 5,932 | 5,932 | **Exact.** |

### Structural findings that materially affect the P0-5 audit

1. **Nested archives.** Three datasets ship per-class archives *inside* the dataset archive: chilli_primary (4 class ZIPs), chilli_secondary (4 class ZIPs), cotton (`Original`/`Augmented` ZIPs). A single-level extraction left cotton showing **zero images** and chilli_primary showing 2,053 of 8,817. Recursive extraction was added to the acquisition script; without it the audit would have judged datasets on a fraction of their content.
2. **macOS AppleDouble stubs.** chilli_secondary contains 1,519 `__MACOSX/._*` files carrying image extensions but holding resource-fork data. They inflated the apparent image count to 3,030 — exactly double the true 1,515. They are excluded from inventory and must stay excluded from any class census.
3. **Rice ships `.7z`,** not ZIP; 7z support (`py7zr`) was required to reach the data at all.
4. **PlantDoc required 87 filename rewrites** for Windows compatibility (illegal characters such as `?`). Every rename is counted in the manifest so files remain traceable to their archive entries.
5. **Rice has no healthy class** (4 disease classes only). A classifier without one cannot tell a farmer their crop is fine — **an explicit P0-5 decision**, options recorded in `datasets/licenses/rice-odisha.md`.

---

## Licence findings that changed our earlier assumptions

**1. The chilli/cotton "CC BY-NC" concern was wrong — and in our favour.** Earlier planning (and ADR-012) recorded one chilli set as CC BY-NC, creating a swap-before-commercialisation obligation. Verification against the Mendeley licence objects shows **all three Mendeley datasets are CC BY 4.0 with no NonCommercial and no ShareAlike clause**. Commercial use, redistribution and modification are permitted with attribution. That obligation does not apply.

**2. PlantVillage's licence is genuinely contested — five sources, four answers.**

| Source | States | Relationship |
|---|---|---|
| PlantVillage/PSU (Hughes, co-creator) | CC 3.0 Share-Alike | originator |
| Mohanty's own HuggingFace card | CC BY-SA 3.0 | originator |
| GitHub `spMohanty/PlantVillage-Dataset` | **no licence file at all** | originator's repo |
| Mendeley `tywbtsjrjv` (what we downloaded) | CC0 1.0 | third-party republication |
| Zenodo mirror / TFDS catalog | CC BY 4.0 | downstream mirrors |

The two creator-sourced statements agree on **CC BY-SA 3.0**; the CC0 claim comes from people who did not create the data. **We comply with the strictest reading**: attribution given, no redistribution of images, non-commercial hackathon use. The unsettled question of whether a *trained model* is a ShareAlike "adaptation" has no bearing on hackathon use but must be resolved before any commercial deployment — logged as an open item.

**3. Paddy Doctor (rice) has no published licence at all.** The CC BY-SA 4.0 widely associated with it is the **arXiv article** licence (`title="Rights to this article"`), not the data licence. The IEEE DataPort record states no licence in any metadata field. A third-party assertion of CC BY 4.0 exists in UC Davis's AgML metadata but is not authorial.

---

## Rice: RESOLVED — Odisha dataset substituted (team decision, option C, 2026-08-12)

Paddy Doctor was **rejected** and replaced by **Rice Leaf Disease Image Samples** (Sethy, Mendeley `fwcj7stb8r`, DOI 10.17632/fwcj7stb8r.1): 5,932 images, 4 classes, collected in **Sambalpur/Bargarh, Odisha**, **CC BY 4.0 verified from the publisher's licence object**, no account required. Acquired and verified — checksum matched, 40/40 sample decode clean, count exact.

The trade is fewer classes in exchange for provenance we can state truthfully and Indian field data we can defend in viva. The blockers that forced it are recorded below for the record.

## Rice: the rejected route (evidence retained)

| Route | Finding |
|---|---|
| IEEE DataPort | **Paid subscription required** — "This dataset requires an IEEE DataPort Subscription to access." Not a free account; dataset is not flagged open-access |
| Zenodo | **No deposit exists** — the authors never deposited; search hits are third-party code |
| Official site (`paddydoc.github.io`) | Dataset page contains **zero download links**; homepage links only to Kaggle and IEEE |
| GitHub (`paddydoc/…`) | **Code only** — notebooks and docs, Apache-2.0 covering code, no data release assets |
| arXiv 2205.11108 | Availability statement points back at the project site; names no licence |
| Kaggle | Requires account + phone verification + competition rule acceptance. Credentials absent (`~/.kaggle/kaggle.json` not present) |

**Account-free mirrors do exist** — the 10,407-image Kaggle *training subset* is mirrored ungated on Hugging Face (`Project-AgML/paddy_disease_classification`; `anthony2261/paddy-disease-classification`, the latter preserving `variety` and `age` metadata). Both verified anonymously reachable. **But a mirror does not launder the upstream licence ambiguity**, and the Kaggle subset is not a clean subset of the full 13-class set: it collapses three stem-borer classes into `dead_heart` and drops `leaf_roller` (10 classes).

**Verified CC BY 4.0 alternatives, all account-free:**

| Dataset | Images | Classes | Field? | Indian? |
|---|---|---|---|---|
| Rice Leaf Disease Image Samples (Sethy) — Mendeley `fwcj7stb8r` | 5,932 | 4 | likely | **Yes — Odisha** |
| Rice Leaf Bacterial & Fungal Disease — Mendeley `hx6f852hw4` v2 | 6,889 (1,701 original) | 8 | yes | no (Bangladesh) |
| Rice Leaf Disease and Pest — Mendeley `vwv3nry3wr` | 19,128 (2,769 original) | 7 | yes | no (Bangladesh) |
| UCI Rice Leaf Diseases | 120 | 3 | controlled | **Yes — Gujarat** |

Rice is our flagship crop — the one place we claimed real Indian field photography — so this decision is escalated to the team rather than resolved here. Options and recommendation are in the P0-4 completion report.

---

## Datasets evaluated and rejected (viva record)

**PlantWild** (18.5k, 89 classes) — broader than scope; class-mapping cost exceeds benefit for 72h; future augmentation candidate. **Zindi/CGIAR wheat rust** — competition-restricted licence: never downloaded. **SoyNet** (9k Indian soybean, CC BY) — genuinely good, deferred as the first future expansion. **Kaggle crop-recommendation dataset** — rejected outright as synthetic with unverifiable provenance (see `docs/crop-recommendation/engine.md`). **PlantVillage augmented variant** — rejected: pre-augmented images would place near-duplicates on both sides of a train/val split.

## Domain-gap position (unchanged, restated)

Tomato/potato/maize training data is laboratory imagery; field accuracy will be lower than validation accuracy. We measure the gap on the held-out PlantDoc field set and publish the number whatever it is. Chilli and cotton field data is Bangladeshi — agroclimatically close to eastern India but a proxy, and disclosed as such.
