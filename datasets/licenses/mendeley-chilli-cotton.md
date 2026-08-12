# Mendeley Data sets (chilli ×2, cotton) — licence and provenance record

All three carry the **identical Mendeley licence object** (`id: 01d9c749-3c4d-4431-9df3-620b2dcfe144`), verified directly from the publisher API during P0-4:

- **short_name:** `CC BY 4.0`
- **full_name:** `Creative Commons Attribution 4.0 International`
- **url:** `http://creativecommons.org/licenses/by/4.0`
- **verbatim description:** *"You can share, copy and modify this dataset so long as you give appropriate credit, provide a link to the CC BY license, and indicate if changes were made, but you may not do so in a way that suggests the rights holder has endorsed you or your use of the dataset. Note that further permission may be required for any content within the dataset that is identified as belonging to a third party."*

**Permitted:** commercial use, redistribution, modification. **Required:** attribution, link to the licence, indication of changes, no implied endorsement. **No NonCommercial or ShareAlike terms on any of the three** — these are materially cleaner than the PlantVillage position. The third-party-content clause is Mendeley boilerplate; all three datasets are author-captured smartphone photography with no third-party rights asserted.

> **Correction to earlier planning:** `docs/ml/dataset-research.md` and ADR-012 previously recorded one chilli set as **CC BY-NC**, creating a "swap before commercialisation" obligation. Verification against the publisher API shows **all three are CC BY 4.0 with no NC clause**. That obligation does not apply to these datasets. (The PlantVillage ShareAlike question is separate and still open — see `plantvillage.md`.)

---

## 1. Chilli — primary (`chilli_primary`)

- **Record:** https://data.mendeley.com/datasets/tm3v4zmh7c/1 · DOI `10.17632/tm3v4zmh7c.1` · version **1** (only version)
- **Archive:** 3,037,394,349 bytes · sha256 `7b95cbbf3b725d3fc7f7315438efb374c5ce58e226473975a28e5079f7a08c4d`
- **Citation:** Arifen, R., & Islam, S. M. M. (2025). *Chilli Leaf Disease Image Dataset for Classification and Early Diagnosis in Agriculture* [Dataset]. Mendeley Data. https://doi.org/10.17632/tm3v4zmh7c.1
- **Structure caveat for P0-5:** four classes ship as ZIPs at the archive root; two more are loose image folders (`Nutrition_Deficiency`, `Powdery_Mildew`). The per-file API is hard-capped at 1000 entries and cannot fully enumerate `Nutrition_Deficiency` (claimed 1,207) — which is why the whole-dataset archive was taken. Actual counts come from the audit, not from the page description.

## 2. Chilli — secondary (`chilli_secondary`)

- **Record:** https://data.mendeley.com/datasets/wzc6r6w5w5/3 · DOI `10.17632/wzc6r6w5w5.3` · version **3**
- **Archive:** 3,249,913,514 bytes · sha256 `ab81a8e87be3b2bd22aab34ba37aedb74270acc897f7b2b069aa6a6144da7c24`
- **Citation:** Biswas, J., Hossain, M. S., & Hasan, M. M. (2026). *Chili Leaf Disease Dataset: Annotated Smartphone Images of Anthracnose, Cercospora Leaf Spot, Leaf Curl Disease, and Healthy Leaves in Bangladesh* [Dataset]. Mendeley Data. https://doi.org/10.17632/wzc6r6w5w5.3
- **Version caveat:** v3 supersedes the v2 referenced in earlier planning and is **materially different** — 1,515 images (v2: 1,544) and the healthy class renamed to **"Fresh Leaf"** while the dataset title still says "Healthy Leaves". Published v3 per-class figures: Anthracnose 347, Cercospora 367, Leaf Curl 369, Fresh Leaf 432. Pinned by DOI; the audit reconciles the label map.
- **Geography:** Bangladesh. Agroclimatically close to eastern India but a **proxy, not Indian field data** — disclosed in the README limitations.

## 3. Cotton — SAR-CLD-2024 (`cotton_sarcld2024`)

- **Record:** https://data.mendeley.com/datasets/b3jy2p6k8w/2 · DOI `10.17632/b3jy2p6k8w.2` · version **2**
- **Archive:** 1,568,238,230 bytes · sha256 `9cb2cca0669f7ff17cd65d16776296eb19dddb13073094d4da2693ca5530189c`
- **Citation:** Bishshash, P., Nirob, M. A. S., Shikder, M. H., & Sarower, A. (2024). *SAR-CLD-2024: A Comprehensive Dataset for Cotton Leaf Disease Detection* [Dataset]. Mendeley Data. https://doi.org/10.17632/b3jy2p6k8w.2
- **Leakage caveat for P0-6:** the archive contains **both** `Original Dataset.zip` (~270 MB, 2,137 images) and `Augmented Dataset.zip` (~1.30 GB, 7,000 images). Augmented images must never enter validation or test splits — near-duplicates of training images would inflate every metric.
- **Scope:** cotton's promotion to SPECIALIZED ML support is decision **OD-1**, resolved by the P0-5 audit on evidence. Acquisition does not pre-judge it.
