# datasets/

Not committed to git (except this README, the manifests, the audit report and the licence records). Populated by `scripts/ml/download_datasets.py` (P0-4) and analysed by `scripts/ml/audit-datasets.py` (P0-5).

```
datasets/
├── raw/               # as-downloaded extractions (PlantVillage, PlantDoc, Mendeley chilli ×2, SAR-CLD-2024, rice Odisha)
├── _archives/         # the downloaded archives themselves
├── audit/             # P0-5 working data: contact sheets + hash cache (regenerable, ignored)
├── prepared/          # unified class folders post audit+mapping (see docs/ml/dataset-preparation.md)
├── fieldtest/         # PlantDoc-derived held-out field domain test set
├── lookup/            # static tables: district APY yield lookup (UPAg/DES CSVs — P3), market seed (CEDA-derived)
├── licenses/          # captured licence texts — compliance evidence, committed
├── manifest-raw.json  # acquisition record: checksums, counts, decode results
├── audit-report.json  # P0-5 audit results — machine-readable, committed
└── manifest.json      # file→split→class map, checksums, seed — reproducibility contract
```

Licenses: recorded per dataset in docs/ml/dataset-research.md, with the exact texts in `licenses/`. All three Mendeley sets (both chilli, cotton) and the rice set are **CC BY 4.0** — verified against the publisher endpoints during P0-4; the earlier CC BY-NC assumption was wrong and is corrected in ADR-012. PlantVillage's licence is contested (creators say CC BY-SA 3.0, the republication says CC0 1.0); we comply with the strictest reading and do not redistribute. Zindi/competition-restricted data is never downloaded into this repo.
