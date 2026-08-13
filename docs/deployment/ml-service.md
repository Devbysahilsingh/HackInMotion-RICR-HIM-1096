# ml-service Deployment

Primary: **Hugging Face Spaces** (Docker SDK, CPU basic, free): `ml-service/Dockerfile` (python:3.12-slim, onnxruntime, model artifact + manifest baked in, uvicorn :7860 per Spaces convention, `--workers 2`, non-root uid 1000); secrets: SERVICE_KEY via Space secrets; private Space visibility NOT required (endpoints are key-protected; /docs disabled) but set to public-code/no-docs consciously — decision noted.
Alt (OD-2): second Render service (same Dockerfile, port injected via `PORT`) — chosen if Spaces latency/sleep behavior disappoints in Day-1 test (test = 20 sequential real-image /predict round-trips from backend host; accept if p95 < 1.5s warm).
Sleep handling: backend treats ml-service timeouts as tier-down (Gemini takes over) — cold-start invisible to farmers; demo warm-up hits /predict once before stage.
Update flow: retrain → parity gates → bump MODEL_VERSION + artifact → rebuild/push → /healthz shows version → backend log confirms.

## What exists today (P3-2)

**Nothing has been deployed.** The service builds and runs locally; no Space and no Render service has been created, and no latency test (OD-2) has been run.

```
ml-service/
  Dockerfile  pyproject.toml  requirements.txt  requirements-dev.txt  README.md
  app/    main.py · config.py · security.py · preprocessing.py · predictor.py
          policy.py · classes.py · schemas.py · logging_config.py
  model/  model-manifest.json          (generated, committed — the class + threshold contract)
  scripts/ generate_model_manifest.py · make_stub_onnx.py
  tests/  141 pytest tests
```

**There is no trained model.** `MODEL_PATH` is unset, so the service answers from `StubPredictor`, whose "logits" are a deterministic hash of the preprocessed tensor and carry **no visual meaning at all**. Every answer is stamped `modelVersion: "stub-0.0.0-untrained"`, boot logs `provisional_model_configuration`, and `/healthz` reports that version. Nothing from this service may be presented as classification performance. `MODEL_PATH` set-but-broken never silently falls back to the stub: startup logs `model_unavailable`, `/healthz` reports `degraded`, `/predict` returns 503 and the backend tiers down.

**The thresholds are placeholders and must be replaced by the training run.** `model/model-manifest.json` carries `"trained": false`, `"calibrated": false`, `"provisional": true` and a `placeholders` block naming each value that is not measured:

| Value | Status |
|---|---|
| margin guard `0.15` | REAL — specified verbatim in docs/ml/confidence-strategy.md |
| `temperature = 1.0` | PLACEHOLDER — the identity, chosen so the stub cannot pretend to be calibrated |
| `tau = 0.75` | PLACEHOLDER — midpoint of the docs' *expected* 0.70–0.80 neighbourhood, not a measurement |
| `tauHealthy = 0.85` | PLACEHOLDER — only "stricter than tau" is honoured |
| `cropMaskFloor = 0.01` | PLACEHOLDER — "a small floor" with one structural constraint respected (below uniform, 1/35 = 0.0286) |
| `classOrder` | PLACEHOLDER ORDERING (sorted by code) — the exporter's real output index order is authoritative and MUST overwrite it |

A class-order mismatch mislabels every prediction while every health check stays green, so the export step is not optional: set `modelVersion`, `modelFile`, `trained`, `calibrated`, the measured temperature and thresholds, and replace `classes` with the exporter's index order, deleting each `placeholders` entry as its value becomes measured.

**Class-contract drift is guarded.** `python ml-service/scripts/generate_model_manifest.py` derives the 35 class codes, healthy classes and per-crop groupings from `datasets/manifest.json`; `--check` exits non-zero if the committed manifest is stale (CI / pre-commit use), and `tests/test_manifest.py` fails on drift. The manifest also records the dataset manifest's sha256, so the pair is diffable in review.

**`pip-audit` has not been run** against this dependency set (docs/security/dependency-security.md). It is a **pre-deploy gate**, not a P3-2 deliverable. Likewise, `requirements.txt` pins direct dependencies exactly but no transitive lock is committed — one should be generated with `pip freeze` **inside the built Linux image** before the first deploy, because a Windows-resolved closure would not build on `python:3.12-slim`.

Environment (full table in `ml-service/README.md`): `SERVICE_KEY` is required in **every** environment (≥32 chars; no keyless mode, no demo bypass, the process refuses to start without it). `ENV` defaults to `production` so an unlabelled deploy is the safe one. `MODEL_PATH`, `MODEL_VERSION`, `MODEL_MANIFEST_PATH`, `PORT`, `LOG_LEVEL`, `REQUEST_TIMEOUT_SECONDS` are optional. Configuration is validated by a frozen pydantic model over `os.environ` (`app/config.py`), not by `pydantic-settings` — see docs/deployment/environment.md.
