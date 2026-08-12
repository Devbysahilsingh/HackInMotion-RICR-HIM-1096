# Rice (Odisha) — licence and provenance record

**Acquired for:** HIM-1096 crop-health model (TODO P0-4), as the **approved substitute for Paddy Doctor** (team decision 2026-08-12, option C).

- **Title:** Rice Leaf Disease Image Samples
- **Author:** Prabira Kumar Sethy (Sambalpur University, Odisha)
- **Record:** https://data.mendeley.com/datasets/fwcj7stb8r/1 · **DOI** `10.17632/fwcj7stb8r.1` · version **1**
- **Archive:** 179,406,830 bytes · sha256 `698171eed58206229693ac90fa47931ed2f1e5796cdc746ce99e4adca88132b3` (both verified against the publisher's archive-metadata endpoint before download; re-verified locally on download — see `datasets/manifest-raw.json`)

## Licence: CC BY 4.0 — verified, unambiguous

Read directly from the Mendeley licence object for this record:

- **short_name:** `CC BY 4.0`
- **full_name:** `Creative Commons Attribution 4.0 International`
- **url:** `http://creativecommons.org/licenses/by/4.0`

**Permitted:** commercial use, redistribution, modification. **Required:** attribution, link to the licence, indication of changes, no implied endorsement.

## Citation (required)

> Sethy, P. K. (2020). *Rice Leaf Disease Image Samples* [Dataset]. Mendeley Data. https://doi.org/10.17632/fwcj7stb8r.1

## Why this dataset rather than Paddy Doctor

Paddy Doctor is the larger and better-known rice dataset (16,225 images, 13 classes), but P0-4 research found two blockers that made it unusable on our terms:

1. **Access** — IEEE DataPort requires a **paid subscription**; no Zenodo deposit exists; the official site links only to Kaggle and IEEE; the GitHub organisation holds code only.
2. **Licence** — **no authoritative licence for the images is published anywhere.** The CC BY-SA 4.0 frequently associated with it is the *arXiv article* licence (`title="Rights to this article"`), not the data licence, and the IEEE DataPort record states no licence in any metadata field.

This dataset is smaller and narrower, but it is **real Indian field data with a licence we can state truthfully** — which is what survives viva questioning. The "trained on Indian field photography" claim is preserved and now rests on verifiable ground.

## Known limitation — no healthy class ⚠ (for the P0-5 audit)

Published as 5,932 images across **4 disease classes: bacterial blight, blast, brown spot, tungro**. There is **no healthy/normal class**.

This matters: a classifier with no healthy class cannot tell a farmer their rice crop is fine — it would force every photograph into a disease. The audit must decide how to handle this, options being to source healthy rice leaves from another CC-licensed set, to route rice healthy-detection through the confidence gate (below-threshold → "no disease confidently identified"), or to accept the limitation and disclose it. **This is deliberately left to P0-5 on evidence, not pre-decided here.** Actual per-class counts also come from the audit, not from the dataset description.

### RESOLVED 2026-08-12 — ADR-021 decision 2 (approved)

`RICE_NORMAL` is supplied by **`rice_healthy_diu`** (Mendeley `g7tcwvshff`, CC BY 4.0, raw tree only) — see `datasets/licenses/rice-healthy-diu.md`. The confidence gate was explicitly **rejected** as a substitute: a four-way softmax over a healthy leaf has no correct output and can be confidently wrong.

Two audit findings also revise this file's figures:

- **Usable size is 2,446, not 5,932.** This set is 59% redundant (1,138 byte-identical copies plus verified near-duplicates). 2,446 is the only figure to quote.
- Post-dedup per class: Tungro 852 · Brown Spot 606 · Bacterial Leaf Blight 514 · Blast 474.
