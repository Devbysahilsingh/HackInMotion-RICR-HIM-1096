# ml-service

Internal disease-classification inference service. FastAPI + onnxruntime (CPU),
Python 3.12, Docker. Contract: [`docs/ml/inference-architecture.md`](../docs/ml/inference-architecture.md).

> ## There is no trained model.
>
> This is the **P3-2 service skeleton**. No training has been run and none may
> be run without its own approval (CLAUDE.md rule 1). The service currently
> answers from a `StubPredictor` whose "logits" are a deterministic hash of the
> preprocessed tensor. **Its outputs carry no visual meaning at all.** Every
> such answer is stamped `modelVersion: "stub-0.0.0-untrained"`, the boot log
> prints `provisional_model_configuration`, and the thresholds it applies are
> marked `"calibrated": false` in `model/model-manifest.json`. Nothing here may
> be presented as classification performance.

---

## Endpoints

| | |
|---|---|
| `POST /predict` | Internal only. Requires `X-Service-Key` (constant-time compare). `multipart/form-data`: `image` (file, ≤8MB) + `cropCode`. → `{diseaseCode\|null, uncertain, confidence, top3:[{code,prob}], cropMismatch?, modelVersion, latencyMs}` |
| `GET /healthz` | Public liveness. → `{status, modelVersion, uptime}`. Nothing else — no class list, no thresholds, no paths, no environment name. |

There is no third route. `/docs`, `/redoc` and `/openapi.json` are served only
when `ENV=development`; they 404 everywhere else.

### Error envelope

`{"error": {"code": "...", "message": "..."}}` — never a traceback, never the
key, never an echo of the payload.

| Status | Code | When |
|---|---|---|
| 401 | `SERVICE_KEY_INVALID` | missing, wrong, or wrong-length service key |
| 400 | `REQUEST_INVALID` | unparseable body, missing `image` or `cropCode` |
| 400 | `CROP_CODE_INVALID` | `cropCode` is not a well-formed crop code |
| 400 | `IMAGE_FORMAT_UNSUPPORTED` | not JPEG/PNG/WebP (rejected on magic bytes, before any decoder runs) |
| 400 | `IMAGE_INVALID` | corrupt, truncated, or undecodable |
| 400 | `IMAGE_ANIMATED` | APNG / animated WebP |
| 413 | `IMAGE_TOO_LARGE` | >8MB, >36MP, or >6000px on a side |
| 503 | `MODEL_UNAVAILABLE` | no predictor loaded (backend tiers down to Gemini) |
| 503 | `INFERENCE_FAILED` | session error mid-request |
| 504 | `INFERENCE_TIMEOUT` | exceeded `REQUEST_TIMEOUT_SECONDS` (default 10s) |

A well-formed `cropCode` the model does not cover (`WHEAT`, `SOYBEAN`, `ONION`)
is **not** an error — it takes the `cropMismatch` branch with `200`.

---

## Running it

```bash
cd ml-service
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements-dev.txt   # Windows
# source .venv/bin/activate && pip install -r requirements-dev.txt   # POSIX

export SERVICE_KEY=$(openssl rand -hex 32)   # required — there is no keyless mode
export ENV=development
.venv/Scripts/python -m uvicorn app.main:create_app --factory --port 7860
```

Tests:

```bash
cd ml-service && .venv/Scripts/python -m pytest        # Windows
cd ml-service && ./.venv/bin/python -m pytest          # POSIX
```

Docker (as deployed):

```bash
docker build -t ml-service ml-service/
docker run -p 7860:7860 -e SERVICE_KEY=<32+ chars> ml-service
```

### Environment

| Var | Required | Default | Notes |
|---|---|---|---|
| `SERVICE_KEY` | **yes** | — | ≥32 chars, shared with the backend. Startup fails without it in *every* environment. |
| `ENV` | no | `production` | `development` \| `test` \| `production`. Defaults to production so an unlabelled deploy is the safe one. |
| `MODEL_PATH` | no | unset | Path to the `.onnx` artefact. Unset ⇒ `StubPredictor`. Set-but-broken ⇒ startup logs `model_unavailable`, `/healthz` reports `degraded`, `/predict` returns 503 — it never silently falls back to the stub. |
| `MODEL_VERSION` | no | manifest value | Overrides the version string reported everywhere. |
| `MODEL_MANIFEST_PATH` | no | `model/model-manifest.json` | |
| `PORT` | no | `7860` | HF Spaces convention; Render injects its own. |
| `LOG_LEVEL` | no | `INFO` | |
| `REQUEST_TIMEOUT_SECONDS` | no | `10.0` | |

---

## Swapping in the real model

The predictor boundary is the whole point of the current design. The trained
model drops in **without a single change to the API contract**:

1. Export to ONNX with input `[1,3,224,224]` float32 and output `[1,35]` logits
   in the manifest's class order.
2. Regenerate the class contract, then overwrite the training-derived fields:
   ```bash
   python ml-service/scripts/generate_model_manifest.py
   ```
   Then edit `model/model-manifest.json` to set `modelVersion`, `modelFile`,
   `trained: true`, `calibrated: true`, the measured `temperature`, `tau`,
   `tauHealthy`, `cropMaskFloor`, and — critically — replace `classes` with the
   **exporter's actual output index order**. Delete each entry from
   `placeholders` as its value becomes measured.
3. Add the artefact to the image and point at it:
   ```dockerfile
   COPY model/model-vX.Y.onnx ./model/
   ENV MODEL_PATH=/app/model/model-vX.Y.onnx
   ```
4. `app/predictor.py` needs no edit. `build_predictor` selects `OnnxPredictor`
   the moment `MODEL_PATH` is set.

### What the boundary looks like

```
preprocess(bytes) -> Tensor ──> Predictor.infer(Tensor) -> list[float] logits
                                   ├── StubPredictor  (hash; today)
                                   └── OnnxPredictor  (onnxruntime; the real path)
                                              │
                              apply_policy(logits, cropCode, manifest) -> PolicyOutcome
```

`Tensor` is deliberately stdlib storage (`array('f')`), not numpy: numpy is not
on the locked ml dependency list and arrives only as an onnxruntime transitive.
Keeping preprocessing framework-free means the validation path and its tests run
on an interpreter with no onnxruntime at all. `OnnxPredictor` does the
zero-copy `numpy.frombuffer` view itself.

`scripts/make_stub_onnx.py` emits a ~700-byte hand-serialised ONNX graph
(`GlobalAveragePool → Flatten → MatMul`) purely so the `OnnxPredictor` path is
exercised end-to-end by the test suite today. **It is not a model.** The `onnx`
package is on the *training* dependency list, not this service's, which is why
the protobuf is written by hand rather than by pulling in a build-time
dependency. `.onnx` is gitignored, so it is always generated, never committed.

---

## Threshold policy

`app/policy.py`, implementing `docs/ml/confidence-strategy.md`:

- `conf ≥ τ` and the healthy rule holds → prediction, `uncertain: false`
- `conf < τ`, **or** `top1 − top2 < 0.15`, **or** a healthy top-1 below `τ_healthy` → `uncertain: true` + `top3`, `diseaseCode: null`
- declared-crop mask leaves no class above the floor → `cropMismatch: true`

**Never force a prediction.** There is no code path returning a `diseaseCode`
while `uncertain` is true, and `tests/test_policy.py::test_a_prediction_is_never_forced`
sweeps every crop and confidence level to keep it that way.

### Which numbers are real, and which are not

Everything below lives in `model/model-manifest.json`, whose `placeholders`
block says the same thing in machine-readable form.

| Value | Status |
|---|---|
| margin guard `0.15` | **REAL.** Specified verbatim in `docs/ml/confidence-strategy.md`. |
| `temperature = 1.0` | **PLACEHOLDER.** 1.0 is the identity — chosen precisely so the stub cannot pretend to be calibrated. Real `T` comes from LBFGS on validation NLL. |
| `τ = 0.75` | **PLACEHOLDER.** The docs give an *expected neighborhood* of 0.70–0.80; 0.75 is its midpoint, not a measurement. The real value is the precision-coverage point where val precision-of-accepted ≥ 0.90. |
| `τ_healthy = 0.85` | **PLACEHOLDER.** Only its one pinned property ("stricter than τ") is honoured. The real value is where the false-negative-disease rate among accepted-healthy is ≤5% on val. |
| `cropMaskFloor = 0.01` | **PLACEHOLDER.** The docs say "a small floor" with no number. One structural constraint is respected: it must sit below uniform (1/35 = 0.0286), or a genuinely diffuse prediction would be reported as a wrong-crop photo instead of as low confidence. |
| class order | **PLACEHOLDER ORDERING** (sorted by code). The exporter's real output index order is authoritative and must overwrite it. A silent mismatch here mislabels every prediction while every health check stays green. |
| ImageNet mean/std, Resize256/CenterCrop224 | Standard constants, **parity unverified**. The golden-image parity test in `docs/ml/inference-architecture.md` cannot exist until there is training code to compare against. `tests/test_preprocessing.py` pins the arithmetic in the meantime. |

---

## What is and is not validated

The 35 class codes are derived from `datasets/manifest.json` by
`scripts/generate_model_manifest.py`, and `tests/test_manifest.py` fails if they
drift. The dataset behind them carries limitations that survive into anything
built on top of it. Verbatim, from the manifest's `known_limitations`:

> - `RICE_NORMAL` is 100% studio imagery; healthy-rice field performance is UNVALIDATED and must not be claimed (ADR-021 decision 2, option c).
> - Both chilli sources are studio imagery separable by capture style; the merged chilli label space is not trusted until the source-separability probe runs (ADR-021 decision 4).
> - Stock-image quarantine is filename-evidence only. Pixel-burned watermarks with neutral filenames are NOT caught and need the human review queue.
> - Rotated/mirrored publisher augmentations are undetectable by the duplicate method; augmented groups are excluded by construction, not by detection.

And from the manifest's `known_confounds`, carried into
`model-manifest.json → confoundEvaluationGates`:

- **Chilli source confound is contained, not solved.** `chilli_primary` vs
  `chilli_secondary` are separable at 0.91 accuracy from a single background
  statistic. `CHILLI_ANTHRACNOSE` exists only in one source;
  `CHILLI_BACTERIAL_SPOT`, `CHILLI_NUTRIENT_DEFICIENCY` and
  `CHILLI_POWDERY_MILDEW` only in the other — those pairs are decidable by
  capture style alone. Mitigation was source-stratified splitting plus a GENERAL
  support tier; the residual risk is explicit: *"Not removed, only contained.
  The only complete fix is chilli imagery of the same classes from a second
  capture style — no such data exists in the corpus."* Chilli metrics must be
  reported with the confound stated and must not be presented as evidence of
  disease discrimination. The Grad-CAM background-reliance probe is REQUIRED
  before any chilli accuracy figure is published.
- **Rice healthy/brown-spot confound.** `rice_healthy_diu` vs `rice_odisha` are
  separable at 0.96. `RICE_NORMAL` comes only from the studio source,
  `RICE_BROWN_SPOT` only from the field source, so healthy-vs-brown-spot is
  decidable by background alone. That confusion cell must be reported
  explicitly, not folded into macro-F1.
- **Source-stratified splits are enforced**, not optional: every (class, source)
  stratum is split independently so no split aligns with a source, because
  sources are separable from background alone (chilli 0.91, rice 0.96,
  tomato 0.96).
- **The field-test set is PlantDoc only** — held out entirely, never trained on,
  1,233 images after quarantine, cluster-level disjointness from train/val
  asserted. It is the *only* lab-to-field evidence that will exist.
- **`TOMATO_SPIDER_MITES` has no usable field-test evidence.** Its field-test
  set was 2 images, both disease-comparison figures; after quarantine, zero
  (ADR-021). Its lab-to-field gap is unmeasurable and must be reported as
  unmeasurable rather than as a number.
- **Field-test review coverage is 16.5%** (209 of 1,264 images visually
  reviewed). Any field-test number published before the remainder is reviewed
  must state that coverage.

`COTTON` sits at the SPECIALIZED tier and ships only once each class has a KB
entry (en+hi) and the agronomist sign-off lands; `CHILLI` and `RICE` sit at
GENERAL with **no field-robustness claim**.

---

## Security posture

Per `docs/security/ai-security.md`:

- `SERVICE_KEY` from env, ≥32 chars, enforced in every environment. **There is
  no keyless mode, no demo bypass, and no fallback path to inference without the
  key.** Missing key ⇒ the process refuses to start.
- Both keys are reduced to SHA-256 digests before `hmac.compare_digest`, so a
  wrong-*length* guess costs exactly what a wrong-*value* guess costs. Timing
  cannot be asserted reliably in CI, so `tests/test_security.py` pins the
  mechanism instead.
- Auth is checked **before** the request body is parsed.
- Non-image payloads are rejected on magic bytes, before any decoder runs.
  Decompression bombs are refused from the header, before pixel data is
  materialised.
- The service holds **zero external API keys**. Gemini/OpenRouter/Groq live in
  the backend — single responsibility, key isolation.
- No filesystem writes at request time (the multipart spool threshold is raised
  above the request cap so uploads never touch disk) and no outbound network
  calls of any kind.
- Structured JSON logs. Image content never enters a log line — only a byte
  count — and `tests/test_logging.py` asserts it by planting a marker in the
  payload and searching every record for it.

---

## Layout

```
app/
  main.py             routes, middleware, error envelope, lifespan
  config.py           env validation; fails fast
  security.py         constant-time service-key compare
  preprocessing.py    format sniff, bomb guards, EXIF, resize/crop/normalize
  predictor.py        Predictor ABC + StubPredictor + OnnxPredictor
  policy.py           threshold policy (pure; no I/O, no framework imports)
  classes.py          model-manifest loader — the class contract
  schemas.py          pydantic wire schemas
  logging_config.py   JSON formatter
model/
  model-manifest.json  generated; committed; the class + threshold contract
scripts/
  generate_model_manifest.py   derives the contract from datasets/manifest.json
  make_stub_onnx.py            tiny ONNX graph so the real path is testable
tests/                         141 tests
```

`app/policy.py` follows the backend's engine rules (CLAUDE.md rule 5): pure,
deterministic, fixture-tested, and every outcome carries a why-trace. There is
no `if cropCode == "TOMATO"` anywhere in this service (rule 4) — crops, healthy
classes and thresholds all come from the manifest.

---

## Known environment notes

- **Python 3.13 works for local development.** `onnxruntime` 1.28.0 publishes a
  cp313 wheel, so the full suite including the ONNX-backed tests runs on 3.13.
  The `OnnxPredictor` import is lazy regardless, so on an interpreter without an
  onnxruntime wheel the service still starts on the stub and the suite still
  passes — those tests `skip` rather than fail.
- `.python-version` pins **3.12**, matching `python:3.12-slim` in the Dockerfile
  and `docs/deployment/ml-service.md`. It records the deployment target, not a
  local requirement.
- `requirements.txt` pins direct dependencies exactly. A full transitive lock
  should be generated with `pip freeze` **inside the built Linux image** before
  the first deploy; a Windows-resolved closure would not build on
  `python:3.12-slim`, so none is committed.
- `pip-audit` (per `docs/security/dependency-security.md`) has **not** been run
  against this dependency set yet — it is a pre-deploy gate, not a P3-2
  deliverable.
