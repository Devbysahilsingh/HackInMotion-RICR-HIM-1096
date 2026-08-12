# ADR-021 · Dataset curation decisions from the P0-5 audit

**Status: PROPOSED — awaiting team approval. Nothing has been implemented.**
**Date:** 2026-08-12 · **Supersedes nothing; amends** ADR-012 (licence posture) and `docs/ml/crop-class-mapping.md` on approval.

Resolves the seven decisions raised by `docs/ml/dataset-audit.md`. Evidence is the committed `datasets/audit-report.json` plus publisher endpoints checked directly for any new data source. No image has been moved, deleted or relabelled: every decision below is expressed as a **curation rule applied at preparation time** (keep-lists, exclude-lists, quarantine lists with reasons), so the raw corpus stays intact and every exclusion is reversible and auditable.

A principle runs through six of the seven: **a class whose images all come from one source, competing against classes from a different source, teaches the model to recognise the source rather than the condition.** The audit found this pattern in chilli, and it is the reason several tempting "just add more data" fixes are rejected below.

---

## 1 · Cotton OD-1 — SPECIALIZED vs GENERAL

**Finding.** The gate passes mechanically, on 7 classes rather than the 8 the plan assumed, with one class below the floor.

**Evidence** (`cotton_od1_gate`, post-dedup):

| Class | Post-dedup | ≥150 |
|---|---|---|
| Leaf Redding | 576 | ✅ |
| Curl Virus | 431 | ✅ |
| Herbicide Growth Damage | 280 | ✅ |
| Healthy Leaf | 252 | ✅ |
| Bacterial Blight | 250 | ✅ |
| Leaf Hopper Jassids | 225 | ✅ |
| Leaf Variegation | **116** | ❌ |

Classes passing: 6 (criterion ≥6) · near-duplicate inflation 0.3% (criterion ≤30%) · original/augmented split cleanly separable. Visual review of 4 of 7 classes (120 images) found coherent, consistent labelling on real field photographs; both field and white-background captures appear across all classes, so background is not a class marker.

**Decision (proposed).** Promote cotton to **SPECIALIZED with 6 classes**. Exclude `COTTON_LEAF_VARIEGATION` from the shipped class set by curation rule; its 116 images stay in the corpus for a later revisit.

**Reason.** The gate's own floor is 150 and variegation has 116 — shipping it would mean overriding a criterion we pre-registered precisely so it could not be bent after seeing the data. Excluding it makes all six shipped classes clear the floor honestly. Variegation is also the safest class to drop: it is largely genetic/physiological rather than an actionable disease, so a farmer loses little, and the abstain path covers the residue.

**Mechanical vs expert.** Counts, deduplication and inflation are mechanical and settled. What is **not** settled and is not invented here: the pre-registered `<10% label error` criterion. Specifically pending agronomist sign-off:
- **(a)** the three classes not visually reviewed — Curl Virus, Herbicide Growth Damage, Leaf Redding;
- **(b)** the **39 near-identical pairs labelled COTTON_CURL_VIRUS in one image and COTTON_HEALTHY in the other** — early curl virus on a still-green leaf is exactly the case where a wrong call misleads a farmer;
- **(c)** whether *Leaf Redding* (physiological/nutritional) and *Herbicide Growth Damage* should ship as diagnoses carrying treatment advice at all, versus being reported as observations.

**Action required.** Record the 6-class decision in `crop-class-mapping.md` and the crop registry; write 6 KB entries (symptoms/actions, en+hi) — no class may ship without one; route (a)–(c) to an agronomist.

**Blocks training?** No — training may proceed on 6 classes. Blocks *shipping* cotton until KB entries and sign-off exist.
**Approval required?** **Yes** — OD-1 is a team decision, and dropping a class is a product decision.

---

## 2 · Rice healthy class

**Finding.** Rice has no healthy class at all: four disease classes, 2,446 usable images. A rice classifier as-is cannot tell a farmer their crop is fine.

**Evidence.** `class_map_reconciliation` shows six planned rice codes with no data, `RICE_NORMAL` among them. Per the instruction not to treat a threshold as a substitute: a 4-way softmax over a healthy leaf has no correct output — it must place mass on some disease, and temperature-scaled confidence can be high while being wrong. The abstain path converts that into "couldn't identify", which is honest but is not an answer, and it degrades exactly when the farmer's crop is fine — the most common real case.

**Candidate sources evaluated** (all checked at the publisher, not from search summaries):

| Source | Licence | Origin | Healthy | Verdict |
|---|---|---|---|---|
| **Mendeley `g7tcwvshff` v1** — Rice Leaf and Crop Disease Detection | **CC BY 4.0** | Daffodil Intl. University, Bangladesh, 2024-11-20 | **771 raw** | **Recommended** |
| Mendeley `hx6f852hw4` v2 — Rice Bacterial & Fungal Disease | CC BY 4.0 | Sirajganj/Pabna, Bangladesh, 2023-11-27 | in 8 classes, count not published | Secondary |
| IEEE DataPort — Indian Rice Disease Dataset (IRDD) | **none stated** | West Bengal, India (IIIT Kalyani / IIT KGP) | yes | **Rejected** |

**Decision (proposed).** Acquire **`g7tcwvshff` raw images only** (never its augmented portion) and use it to supply `RICE_NORMAL`.

**Reason.** The decisive property is not the healthy count — it is that this dataset provides healthy **together with Bacterial Leaf Blight, Blast and Tungro from the same capture campaign** (262/592/298 raw). Grafting a healthy class from one source onto diseases from another would make "healthy" perfectly predictable from capture style; here, three of our four diseases are separable from healthy *within* a single source, which is what keeps the class honest. The Odisha set then contributes volume, a fourth disease (Brown Spot) and Indian geography.

**IRDD is rejected on exactly the grounds Paddy Doctor was rejected in P0-4** — paid subscription access and no published image licence. Consistency here is deliberate: we do not relax a standard because the second dataset is more convenient.

**Action required.** Add to `dataset-sources.json` with checksums, run P0-4 acquisition and P0-5 audit over it, then **verify before use**: (i) the healthy images are rice leaves in field conditions comparable to the Odisha set; (ii) deduplicate within and against the Odisha set; (iii) a source-separability check — if a trivial probe can predict *which dataset* an image came from, the merged label space is confounded and the healthy class must be reported as such. Disclose Bangladeshi origin as we already do for `chilli_secondary`.

**Blocks training?** **Yes.** Rice cannot be trained as a shippable head without a healthy class.
**Approval required?** **Yes** — new external dataset.

### Verification outcome (2026-08-12, P0-5b) — acquired, but one condition FAILED

Acquisition passed every mechanical check and **failed the field-realism condition**:

| Condition | Result |
|---|---|
| Licence CC BY 4.0 read from publisher licence object | ✅ |
| Publisher-published sha256 + size matched | ✅ `e4cc1f4b…`, 976,965,280 B |
| Published per-class counts reproduce exactly | ✅ raw 2,508 / augmented 8,258 |
| Decode integrity | ✅ 0 failures in 10,766 |
| **No duplication against `rice_odisha`** | ✅ **0 cross-dataset clusters** |
| Internal redundancy | ✅ low — 341 of 10,766 (3.2%) |
| **(i) Healthy images field-realistic, comparable to Odisha** | ❌ **FAILED — detached leaves on white paper** |

**What the contact sheet shows.** `rice_healthy_diu` is studio imagery: single rice leaves laid on a sheet of white paper, the same pattern as `chilli_secondary`. The Odisha set is genuine in-field photography — leaves in hand, against soil, in standing crop. The two are not comparable domains.

**What still worked.** The reason this source was chosen over a healthy-only set was to keep healthy-vs-diseased decidable *within one campaign*, and that held: the same studio campaign also supplies Bacterial Leaf Blight (209), Blast (590) and Tungro (231) post-dedup. Background therefore does not by itself separate healthy from diseased.

**What did not.** Usable rice, raw-only and deduplicated, by capture domain:

| Code | Field (Odisha) | Studio (DIU) | Total | Field share |
|---|---|---|---|---|
| RICE_TUNGRO | 852 | 231 | 1,083 | 79% |
| RICE_BACTERIAL_LEAF_BLIGHT | 514 | 209 | 723 | 71% |
| RICE_BLAST | 474 | 590 | 1,064 | 45% |
| RICE_BROWN_SPOT | 606 | — | 606 | 100% |
| **RICE_NORMAL** | **0** | **582** | **582** | **0%** |

`RICE_NORMAL` is the only rice class with **no field-realistic examples at all**. The model would never see a healthy rice plant photographed the way a farmer will photograph one. The likely failure is healthy-in-field → predicted as diseased, which is the *acceptable* direction under the evaluation plan (unnecessary worry, not false reassurance) — but it is unvalidated, and it undercuts the everyday case where the crop is fine.

**Status: decision 2 is PARTIALLY SATISFIED — the class now exists, its field behaviour does not.** Options put back to the team:
- **(a) Accept and disclose** — ship `RICE_NORMAL` from studio data, hold rice at GENERAL, state the limitation in the model card and README. No further acquisition.
- **(b) Add a field-realistic healthy rice source** before training. Candidate `hx6f852hw4` (CC BY 4.0, 1,701 originals, 8 classes incl. healthy) describes "outdoor lighting… as well as inside lighting" — ambiguous, and **descriptions have already misled us once**: `tm3v4zmh7c` advertised "real farm conditions" and delivered background-removed cut-outs. Any candidate must be inspected, not trusted.
- **(c) Both** — train on what we have, and treat any field healthy imagery obtained later as an evaluation-only probe, mirroring the potato approach in decision 7.

**Recommendation: (c).** It unblocks training now without asserting field performance we cannot demonstrate.

### Second finding (P0-6, 2026-08-12) — 59 label contradictions inside the healthy class ⚠

Building the splits surfaced something the P0-5b audit summary did not isolate: **59 byte-identical photographs are filed under BOTH `Healthy _leaf` and `Tungro` in this dataset's raw tree** — the exact portion approved for training.

```
Healthy _leaf/orginal/leaf/20241114_145527.jpg   ==   Tungro/orginal/20241114_145527.jpg
Healthy _leaf/orginal/leaf/20241114_150406.jpg   ==   Tungro/orginal/20241114_150406.jpg
                                     … 59 groups, all in `orginal`, none in `augmented`
```

Same camera timestamps, identical bytes. This looks like a directory copied during dataset assembly rather than isolated mislabels.

**Scale:** 59 of 771 raw healthy images (7.7%) and 59 of 298 raw tungro (19.8%). The curation rule quarantines every copy, so `RICE_NORMAL` lands at **549** usable images rather than 582.

**Why it matters beyond the count.** The contradiction is precisely the pairing the product must never get wrong: the same photograph asserting both "your crop is fine" and "your crop has tungro". Automatic quarantine removes the affected files, but it does not tell us how far the labelling defect extends into files that are *not* byte-identical — a copy that was re-encoded would not be caught.

**Not blocking:** the splits are clean and `RICE_NORMAL` still has 549 images. **Worth revisiting:** whether this publisher's labelling is reliable enough for the healthy class, given that 7.7% of it contradicts another class outright. Options unchanged from above; option (b) — finding a field-realistic healthy rice source — now has a quality argument behind it as well as a domain one.

### Method blind spot recorded

The audit reports **0 near-duplicate clusters spanning this dataset's original↔augmented boundary** — while the publisher states plainly that the augmented images are derived from the raw ones. This is not evidence of independence; it is the known limitation from P0-5 (rotations, mirrors and heavy recolouring defeat pHash) appearing in the wild. Compare cotton, where 1,398 clusters *did* span. **The raw-only rule must therefore be enforced by construction, never by trusting a dedup result.**

---

## 3 · PlantVillage `Background_without_leaves`

**Finding.** 1,135 post-dedup images that are Western stock/tourist photography — streets, boats, churches, a parrot, cars, fjords.

**Evidence.** Direct visual review of the class contact sheet. Not one sampled image is an agricultural non-leaf scene.

**Decision (proposed).** **Exclude** from the unified class set by curation rule. Retain the images in `datasets/raw/` untouched.

**Reason.** Three independent reasons, any one sufficient:
1. **It rejects the wrong things.** It would teach "not-a-leaf = European holiday photo". A farmer's failure cases are soil, a hand, a wall, a fruit, a blurred close-up — none represented.
2. **It launders the metrics.** 1,135 trivially separable images inflate overall accuracy and macro-F1 without any product benefit. Our own rule forbids fabricated metrics; an accidentally easy class is the same error with better manners.
3. It is drawn from the one source whose licence is contested (PlantVillage), so using less of it is free risk reduction.

The genuine need behind the class — rejecting non-crop photographs — is met by the confidence/abstain path, which already exists and is test-enforced. If that proves insufficient in practice, the answer is a small purpose-built negative set of Indian field non-leaf images, not this one.

**Action required.** Exclude-list entry with this reason recorded.
**Blocks training?** No.
**Approval required?** No — engineering call, recorded here for visibility. Flag if you disagree.

---

## 4 · Chilli domain gap

**Finding.** Both chilli sources are background-controlled studio imagery, and the two are separable by capture style alone while contributing disjoint classes.

**Evidence.** `chilli_primary` (8,817 → 7,027) is background-removed cut-outs on pure white; `chilli_secondary` (1,515 → 1,489) is single leaves on white paper. `CHILLI_ANTHRACNOSE` exists only in the second; `POWDERY_MILDEW`, `NUTRIENT_DEFICIENCY`, `BACTERIAL_SPOT` only in the first. There is no field-realistic chilli imagery anywhere in the corpus, so unlike tomato/potato/maize — which have PlantDoc — **chilli has no way to measure its own domain gap.**

Worth recording: the `tm3v4zmh7c` publisher description advertises "real farm conditions with variable lighting, angles, and backgrounds". As delivered, the images are background-removed. Both can be true — photographed in a field, then segmented — but **as delivered they cannot support a field-robustness claim.** Descriptions do not override inspection.

**Decision (proposed).** Three parts:
1. **Train chilli, but hold its support tier at GENERAL** — no SPECIALIZED claim, and no accuracy language implying field robustness, until a field-realistic chilli evaluation set has actually been measured.
2. **Do not merge the two chilli sources into one label space** until a source-separability check is run. With classes disjoint across sources, a model can score well by reading the background.
3. **Acquire a field-realistic chilli evaluation probe** — candidate: Mendeley `6243z8r6t6` "Multi-Crop Disease Dataset" (**CC BY 4.0**, Chengalpattu/Kanchipuram/Krishnagiri, **Tamil Nadu, India**, in-situ field photographs, includes chilli with Leaf Curl / Anthracnose / mildew classes). **Evaluation only — never trained on**, so it cannot introduce a training confound while still measuring the gap.

Considered and rejected for training: the **COLD** chilli dataset (Karnataka, India; 2,928 raw; healthy + Cercospora + nutritional deficiency + powdery mildew — a four-class overlap with our set) is **CC BY-NC**. Adding it would re-impose the swap-before-commercialisation obligation that the P0-4 licence verification just removed from this project. Available as a fallback if the team accepts that obligation knowingly; not recommended by default.

**Reason.** The data supports a chilli classifier; it does not support a claim that the classifier works on farmer photographs. Tiering is how the registry already expresses that distinction, and the honest move is to use it rather than to publish a number the evidence cannot carry.

**Action required.** Registry tier note; source-separability check before any merged-chilli training; verify and acquire `6243z8r6t6` (per-class counts and augmentation status are not published — confirm at acquisition).
**Blocks training?** No — blocks any *claim* of chilli field accuracy, and blocks merging the two sources.
**Approval required?** **Yes** — support-tier and new-dataset decisions.

---

## 5 · PlantDoc leakage

**Finding.** 11 byte-identical groups cross PlantDoc's own train/test boundary; **8 of them carry contradictory labels** (the same file is `Corn Gray leaf spot` in train and `Corn leaf blight` in test). 14 near-duplicate clusters span the boundary (29 images).

**Evidence.** `publisher_split_leakage.plantdoc`, with file-level examples including `2015070295153021.jpg`, `corn-gray-leaf-spot-f4.jpg`, `1421_0.jpeg_itok=FMtmgePj.jpg`, `tomato_V8.jpg`.

**Decision (proposed).** Do not repair PlantDoc's split — **discard it.** Specifically:
1. **Treat the whole of PlantDoc (all 2,572 images) as a held-out field test set. Never train on any of it.** Its internal train/test boundary then carries no meaning and its leakage across that boundary becomes moot.
2. **Deduplicate PlantDoc against itself** (67 redundant images) so no image is scored twice.
3. **Quarantine the 8 label-contradicted files** — recorded in a quarantine list with the reason, excluded from scoring, not deleted. A file the publisher labelled two ways cannot serve as ground truth for either.
4. **Manually review the 236 test-set images** before publishing any number from them: the audit already found a *screenshot of a web factsheet* filed under Tomato Septoria leaf spot, and *chopped herbs on a cutting board* filed under Tomato leaf. Watermarked stock images (Shutterstock/Alamy/Getty) are also present, and their licence status inside a CC BY 4.0 release is not something we can verify.
5. Cross-source cleanliness is already proven: **0 verified duplicate clusters between PlantDoc and PlantVillage.**

**Reason.** PlantDoc's value to this project is exactly one thing — an honest measure of the lab-to-field gap. That value requires only that it be disjoint from training (it is) and correctly labelled (it partly is not). Fixing the split would preserve a training role we do not want and would leave the label contradictions untouched.

**Action required.** Quarantine list + dedup rule in `prepare-datasets.py`; 236-image manual review; record the excluded files with reasons.
**Blocks training?** **Yes, for the acceptance gate** — "no cross-split leakage" cannot be certified until this rule is implemented. Cheap to clear.
**Approval required?** No for the mechanical parts (engineering call); **yes** if you want the watermarked stock images kept in a benchmark we publish numbers from.

---

## 6 · Rice's real usable size

**Finding.** The Odisha set is 59% redundant: 5,932 published, **2,446 genuinely distinct**.

**Evidence.** 1,138 byte-identical redundant copies (independently re-confirmed with `sha256sum`) plus verified near-duplicates → 3,486 redundant of 5,932. Post-dedup per class: Tungro 852, Brown Spot 606, Bacterial Leaf Blight 514, Blast 474.

**Decision (proposed).** **2,446 is the effective dataset size** and is the only figure to be used in any document, slide or README. Duplicates are excluded by curation rule, not deleted. Additional rice data comes from `g7tcwvshff` raw (decision 2), not from counting copies.

**Reason.** Reporting 5,932 would overstate our data by 2.4× and would silently inflate any per-class metric computed over duplicated images. Publisher counts are claims about files, not about distinct information.

**Action required.** Correct 5,932 → 2,446 wherever the number appears (`dataset-research.md`, planning docs); state the post-acquisition figure once `g7tcwvshff` has been audited.
**Blocks training?** No.
**Approval required?** No — this is a measurement, not a choice. Approval is needed only for the acquisition in decision 2.

---

## 7 · `POTATO_HEALTHY` at 152

**Finding.** The smallest class in the corpus, 36:1 against the largest, and the only in-scope healthy class with no field imagery anywhere — PlantDoc has `Potato leaf early blight` and `Potato leaf late blight` but **no healthy potato class at all.**

**Evidence.** PlantVillage `Potato___healthy` = 152 raw, 152 post-dedup (essentially duplicate-free — the images are distinct, there are simply few of them). At a 15% test split that yields ~23 test images, below the ≥50 acceptance floor.

**Decision (proposed).** Four parts, and explicitly **not** a weakening of the ship gate:
1. **Keep the ship gate as written** — healthy recall ≥0.90 @τ_healthy, per-crop macro-F1 ≥0.75. The gate exists for the failure mode that harms farmers most ("your crop is fine" while it is not).
2. **Do not graft a foreign-source healthy class into training.** The available option — Mendeley `ptz377bwb8` (CC BY 4.0, Universitas Gadjah Mada, Central Java, Indonesia; labels verified by their Department of Plant Protection) — has **201 healthy field images**. Mixing 152 lab images and 201 field images as one class against lab-only disease classes would make "healthy" largely predictable from capture style. It would raise the count and corrupt the meaning.
3. **Use those 201 images as an evaluation-only field probe for potato healthy recall.** Never trained on, so no confound is introduced, and it measures precisely the quantity the gate cares about. (Its taxonomy is by causal agent — bacteria/fungi/virus/nematode/pest/phytophthora/healthy — so only the healthy class maps cleanly to ours; no disease mapping is proposed.)
4. **Change the split rule for this class instead of the gate:** allocate a fixed ≥50-image test set for `POTATO_HEALTHY` (~33% rather than 15%), accepting a smaller training share, so the acceptance floor is met by allocation rather than by lowering the bar. Handle the residual imbalance at train time via the already-planned class-weighted CE + WeightedRandomSampler — never by oversampling on disk.
5. **If potato still fails its per-crop gate, demote potato to GENERAL** — the documented, announced failure path.

**Reason.** The honest options are to measure better, allocate better, or demote — not to manufacture a healthy class out of a different photographic domain and call the gate passed.

**Action required.** Per-class split-size override in the preparation script; acquire `ptz377bwb8` as an evaluation-only probe; record potato as an at-risk crop in the evaluation plan.
**Blocks training?** No — blocks *shipping* potato if the gate fails.
**Approval required?** **Yes** — new external dataset (evaluation-only) and the per-class split override.

---

---

## Post-P0-6 resolution of the outstanding gates (2026-08-13)

### Confounds are now measured, not suspected

`scripts/ml/probe-confounds.py` answers "can a class be identified from capture style rather than disease?" with evidence. It **trains nothing**: separability is measured with a fixed background statistic (mean and std of the outer ring of the cached 64×64 thumbnail) and an exhaustive threshold sweep. That makes the number a **lower bound** — a learned model would do at least as well.

| Crop | Source separability | Source-disjoint class pairs | Confounded |
|---|---|---|---|
| **CHILLI** | **0.91** | 3 — all `ANTHRACNOSE` vs `BACTERIAL_SPOT` / `NUTRIENT_DEFICIENCY` / `POWDERY_MILDEW` | **YES** |
| **RICE** | **0.96** | 1 — `RICE_NORMAL` vs `RICE_BROWN_SPOT` | **YES** |
| TOMATO | 0.96 | none | no |
| POTATO | 0.95 | none | no |
| MAIZE | 0.91 | none | no |
| COTTON | single source | none | no |

The tomato/potato/maize result is the reassuring one: PlantDoc and PlantVillage *are* trivially separable (field vs lab, exactly as expected), but because PlantDoc is field-test-only and every class exists in both sources, no class is decidable by source. The design already handles it.

**Fixes applied:**
- **Source-stratified splits.** Each (class, source) stratum is split independently, so no split can align with capture style. Previously nothing prevented it.
- Per-class source composition and split-by-source balance recorded in the manifest.
- `known_confounds` carried in the manifest with a mandatory **evaluation gate** per confound.

**Chilli — contained, not removed.** The complete fix would be chilli imagery of the same classes in a second capture style, which does not exist in this corpus. One option *would* remove the disjointness outright: **excluding `CHILLI_ANTHRACNOSE`** (323 unique images, the only chilli_secondary-only class) collapses all three disjoint pairs. That costs a real disease class, so it is a product decision and **is not applied** — it needs your call.

**Rice — contained, not removed.** `RICE_NORMAL` (studio-only) versus `RICE_BROWN_SPOT` (field-only) cannot be de-confounded with the data on hand. Dropping either is worse: one is the healthy class we just added, the other a major disease with 606 genuine field images. The gate now requires the `RICE_NORMAL ↔ RICE_BROWN_SPOT` confusion cell to be reported explicitly, and warns that unusually high `RICE_NORMAL` recall is evidence of the shortcut rather than of skill.

### Healthy-rice: additional data is NOT required before training

Training is not blocked — `RICE_NORMAL` exists at 549 images. What is blocked is any *claim* about field performance, and no amount of studio data fixes that. Acquiring more data now would also violate the approved option (c), which reserves field-realistic healthy rice for evaluation unless separately approved for training. So the limitation is **encoded** rather than papered over: registry tier GENERAL, `pre_training_checks_required` entry, manifest limitation, and the evaluation gate above. **The only measure that removes the confound is field-realistic healthy rice used for training — which needs your separate approval.**

### Field-test review: objective rules applied, remainder scoped

`scripts/ml/review-fieldtest.py` renders every field-test image into numbered sheets with an index, so any flagged cell resolves to an exact path. **31 images quarantined after direct visual inspection**, each recorded in `scripts/ml/manual-quarantine.json` with its evidence, category, reviewer and sheet cell:

| Category | n | Examples |
|---|---|---|
| `stock_watermark` | 18 | burned-in Alamy, Dreamstime, Shutterstock, Colourbox, photobucket, Minden Pictures marks |
| `composite_figure` | 8 | multi-panel figures showing several different diseases in one image |
| `not_a_photograph` | 4 | a web-factsheet screenshot, a bullet-point slide, a line illustration, a conference poster |
| `not_a_plant_leaf` | 1 | chopped herbs on a cutting board |

Nothing was deleted and **no label was changed** — these images leave the evaluation set, they are not reassigned.

**`TOMATO_SPIDER_MITES` has no usable field test.** Its field-test set was **2 images, and both are disease-comparison figures** — filenames `SpotSpeckBlightMite-….jpg` and `comparing-diseases-4-canker-tomato-….jpg` corroborate the pixels. After quarantine the class has **zero** field-test images, so its lab-to-field gap is unmeasurable and must be reported as such rather than as a number.

**Coverage is stated honestly: 209 of 1,264 field-test images reviewed (16.5%).** Sheets are ordered by path, so "sheet 00" is the first 30 images of a class, not a random sample. The remaining 1,055 may still contain pixel-burned watermarks or figures that no filename rule can catch; the manifest carries this coverage so no field-test number can be published without it.

**Left explicitly to human judgement, not guessed:** whether images bearing an author credit (©T.A. Zitter, ©D. Maeso, university-extension marks) are acceptable in a published benchmark; whether a plant in a photograph is the labelled species; and every agronomic label question, including the cotton items (a)–(c) from decision 1.

## TRAINING READINESS

### Resolved by this record (pending your approval)
- **Cotton scope** — 6 SPECIALIZED classes, variegation held back; gate met on its own terms rather than by reinterpretation.
- **`Background_without_leaves`** — excluded, with the rejection need redirected to the abstain path.
- **Rice's true size** — 2,446, fixed as the reportable number.
- **PlantDoc's role** — field test set only, never trained on; leakage dissolved rather than patched.
- **Chilli's honest ceiling** — trainable, not claimable as field-robust; tier held at GENERAL.
- **Potato's weak class** — gate preserved; fixed by allocation and by an evaluation-only probe.
- **Method for all of the above** — curation rules over keep/exclude/quarantine lists; the raw corpus stays byte-for-byte intact.

### Still blocking training
1. **Rice has no healthy class.** Hard blocker for a shippable rice head. Requires approval to acquire `g7tcwvshff`, then acquisition + audit + source-separability check.
2. **PlantDoc quarantine + dedup rule is not implemented.** The "no cross-split leakage" acceptance gate cannot be certified until it is. Cheap, but it is a gate.
3. **Curation rules exist only as prose.** Nothing in this record is machine-readable yet; `prepare-datasets.py` (P0-6) is where they become real, and no split has been generated.

### Not blocking training, but blocking *ship*
- 6 cotton KB entries (en+hi) — no diagnosis ships without guidance.
- Agronomist sign-off on cotton items (a)–(c).
- Manual review of PlantDoc's 236 test images before any published number.

### What must happen next
1. **You approve, amend or reject each decision above** — five of the seven need your explicit sign-off (1, 2, 4, 7, and the stock-image question in 5).
2. **P0-6 — dataset preparation:** encode the approved rules as keep/exclude/quarantine lists, then class map → cluster-atomic splits → manifest, with the leakage check as a hard assertion rather than a report.
3. **Rice acquisition** (if approved) runs as its own P0-4-style task before P0-6 completes, since it changes the class map.
4. **Then, and only then, training.** No model has been trained, no split generated, no preprocessing run.

### Open decisions touched
**OD-1 resolved pending approval** (cotton → SPECIALIZED, 6 classes). ADR-012 gains one amendment if the COLD fallback is ever taken (CC BY-NC would restore a swap-before-commercialisation obligation); as recommended, it is not.

## Sources for new data (verified at publisher, 2026-08-12)
- [Mendeley `g7tcwvshff` — Rice Leaf and Crop Disease Detection Dataset](https://data.mendeley.com/datasets/g7tcwvshff/1) · CC BY 4.0
- [Mendeley `hx6f852hw4` — Rice Leaf Bacterial and Fungal Disease Dataset](https://data.mendeley.com/datasets/hx6f852hw4/2) · CC BY 4.0
- [IEEE DataPort — Indian Rice Disease Dataset (IRDD)](https://ieee-dataport.org/documents/indian-rice-disease-dataset-irdd) · **rejected** — paid subscription, no licence stated
- [Mendeley `ptz377bwb8` — Potato Leaf Disease Dataset in Uncontrolled Environment](https://data.mendeley.com/datasets/ptz377bwb8/1) · CC BY 4.0 · [Data in Brief record](https://pmc.ncbi.nlm.nih.gov/articles/PMC10733095/)
- [Mendeley `6243z8r6t6` — Multi-Crop Disease Dataset (Tamil Nadu)](https://data.mendeley.com/datasets/6243z8r6t6/1) · CC BY 4.0
- [COLD chilli/onion dataset record](https://pmc.ncbi.nlm.nih.gov/articles/PMC11170091/) · **CC BY-NC** — fallback only
