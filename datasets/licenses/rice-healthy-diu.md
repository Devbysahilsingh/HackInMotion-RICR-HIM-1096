# Licence record — Rice Leaf and Crop Disease Detection Dataset (`rice_healthy_diu`)

**Dataset:** Rice Leaf and Crop Disease Detection Dataset
**DOI:** 10.17632/g7tcwvshff.1 (version 1, published 2024-11-20)
**Record:** https://data.mendeley.com/datasets/g7tcwvshff/1
**Contributors:** Rafi Labib · Sanjida Mim · Mayen Uddin Mojumdar
**Institution:** Daffodil International University, Bangladesh
**Acquired:** 2026-08-12, under ADR-021 decision 2 (approved).

## Licence: CC BY 4.0

Read verbatim from the publisher's own licence object at
`https://data.mendeley.com/public-api/datasets/g7tcwvshff?version=1`:

> **short_name:** `CC BY 4.0`
> **full_name:** `Creative Commons Attribution 4.0 International`
> **url:** `http://creativecommons.org/licenses/by/4.0`
> **description:** "You can share, copy and modify this dataset so long as you give appropriate credit, provide a link to the CC BY license, and indicate if changes were made, but you may not do so in a way that suggests the rights holder has endorsed you or your use of the dataset. Note that further permission may be required for any content within the dataset that is identified as belonging to a third party."

No NonCommercial clause, no ShareAlike clause. Commercial use, redistribution and modification are permitted with attribution.

**The publisher's third-party caveat is carried forward, not ignored:** if the audit finds watermarked or evidently scraped imagery inside this release (as it did in PlantDoc), those images are quarantined rather than used, on the same rule.

## Required attribution

> Labib, R., Mim, S., & Mojumdar, M. U. (2024). *Rice Leaf and Crop Disease Detection Dataset* [Dataset]. Mendeley Data. https://doi.org/10.17632/g7tcwvshff.1 — licensed CC BY 4.0.

## Integrity

The publisher publishes its own size and SHA-256 at
`https://data.mendeley.com/public-api/datasets/g7tcwvshff/files?folder_id=root&version=1`:

| | |
|---|---|
| File | `Rice Leaf and Crop Disease Detection Dataset.zip` |
| Size | 976,965,280 bytes |
| SHA-256 | `e4cc1f4bd98609167a1929d05bd4cc69ad5e80ea5b70dbcc47e97e77883678c5` |

These are the publisher's values, not ours computed after download, so the check is a genuine integrity verification rather than a self-consistency test.

## Use constraints recorded at acquisition

1. **Raw only.** The release ships Raw Data (2,508) and Augmented Data (8,258). Only the raw tree may be used — augmented images are derived from the raw ones and would leak across train/val/test.
2. **Geography disclosed.** Bangladesh-collected, not Indian field data. Agroclimatically close to eastern India; a proxy, and labelled as one.
3. **Not usable until verified.** Deduplication within and against `rice_odisha`, plus a source-separability check, are prerequisites (ADR-021 decision 2). If dataset origin turns out to be trivially predictable, the healthy class is confounded and must be reported as such.
4. The general `Rice` class (585 raw) is a whole-plant category, not a condition, and is not mapped to any class code without inspection.
