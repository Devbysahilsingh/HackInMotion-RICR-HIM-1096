# Unified Class Map (~34 classes + cotton's 8 if OD-1 passes)

Codes are language-neutral (`CROP_CONDITION`); i18n names in shared/i18n; registry lists per-crop `mlClassCodes`.

> **Status after the P0-5 audit (2026-08-12): this file is not yet reconciled with the data, deliberately.** The audit measured what actually exists — 36 codes with data, per-class counts in `docs/ml/dataset-audit.md` — and found three mismatches with the list below: the RICE section still describes the **rejected** Paddy Doctor set (only 4 rice codes have data, and `RICE_NORMAL` is not among them); COTTON has **7** classes, not 8; and the chilli `?` codes are all present. Merge/drop/rename decisions are the team's and are listed in the audit report; this file is updated when they are made, not before.

## RICE (Paddy Doctor, 10 competition classes; +3 if full 13-set obtained)
RICE_NORMAL · RICE_BACTERIAL_LEAF_BLIGHT · RICE_BACTERIAL_LEAF_STREAK · RICE_BACTERIAL_PANICLE_BLIGHT · RICE_BLAST · RICE_BROWN_SPOT · RICE_DEAD_HEART · RICE_DOWNY_MILDEW · RICE_HISPA · RICE_TUNGRO
## TOMATO (PlantVillage 10)
TOMATO_HEALTHY · TOMATO_BACTERIAL_SPOT · TOMATO_EARLY_BLIGHT · TOMATO_LATE_BLIGHT · TOMATO_LEAF_MOLD · TOMATO_SEPTORIA_LEAF_SPOT · TOMATO_SPIDER_MITES · TOMATO_TARGET_SPOT · TOMATO_MOSAIC_VIRUS · TOMATO_YELLOW_LEAF_CURL_VIRUS
## POTATO (PV 3)
POTATO_HEALTHY · POTATO_EARLY_BLIGHT · POTATO_LATE_BLIGHT
## MAIZE (PV 4)
MAIZE_HEALTHY · MAIZE_COMMON_RUST · MAIZE_GRAY_LEAF_SPOT · MAIZE_NORTHERN_LEAF_BLIGHT
## CHILLI (Mendeley sets, reconciled)
CHILLI_HEALTHY · CHILLI_LEAF_CURL_VIRUS · CHILLI_CERCOSPORA_LEAF_SPOT · CHILLI_ANTHRACNOSE · CHILLI_BACTERIAL_SPOT? · CHILLI_NUTRIENT_DEFICIENCY?  ← final set fixed at audit (naming reconciliation between the two sets; '?' classes kept only if both census+quality pass)
## COTTON (SAR-CLD-2024, iff OD-1)
COTTON_HEALTHY · COTTON_BACTERIAL_BLIGHT · COTTON_CURL_VIRUS · COTTON_HERBICIDE_DAMAGE · COTTON_LEAF_HOPPER_JASSIDS · COTTON_LEAF_REDDENING · COTTON_LEAF_VARIEGATION · (8th per dataset docs)

Rules: class merge/drop decisions only at audit, documented here with reasons; every code has registry KB entry (symptoms/actions) BEFORE it may ship in the model (no diagnosis without guidance); PlantDoc field-test classes mapped to these codes where overlap exists (tomato/potato/maize subsets).
