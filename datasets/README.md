# datasets/

Not committed to git (except this README + manifests). Populated by `scripts/ml/download-datasets.py` on Day 0.

```
datasets/
├── raw/            # as-downloaded archives + extractions (Paddy Doctor, PlantVillage, Mendeley chilli ×2, SAR-CLD-2024, PlantDoc)
├── prepared/       # unified class folders post audit+mapping (see docs/ml/dataset-preparation.md)
├── fieldtest/      # PlantDoc-derived held-out field domain test set
├── lookup/         # static tables: district APY yield lookup (UPAg/DES CSVs — P3), market seed (CEDA-derived)
└── manifest.json   # file→split→class map, checksums, seed — reproducibility contract
```

Licenses: recorded per dataset in docs/ml/dataset-research.md + exact texts captured during audit (docs/ml/dataset-audit.md). One chilli set is CC BY-NC — acceptable for this non-commercial hackathon build; swap before any commercialization (decision log ADR-012). Zindi/competition-restricted data is never downloaded into this repo.
