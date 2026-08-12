# Inference Architecture (ml-service)

FastAPI + onnxruntime (CPU) · Python 3.12 · Docker (HF Spaces primary host, Render alt — OD-2).

## Endpoints
| | |
|---|---|
| POST `/predict` | Internal-only: requires `X-Service-Key` (shared secret w/ backend; constant-time compare). Body: image bytes (≤8MB, re-validated: decode, RGB, pixel cap) + `cropCode`. → `{diseaseCode|null, uncertain, confidence, top3:[{code,prob}], cropMismatch?, modelVersion, latencyMs}` |
| GET `/healthz` | Public liveness: `{status, modelVersion, uptime}` (no internals) |

## Request path
bytes → PIL decode (bomb-guarded) → EXIF-normalize → Resize256/CenterCrop224 → ImageNet normalize (**identical constants to training; golden-image parity test in CI**) → ONNX session (single, warmed at startup) → temperature-scaled softmax → declared-crop mask + renormalize → threshold policy (confidence-strategy.md) → response. Target latency: 40–80ms inference, <300ms E2E on free CPU host.

## Ops
Model artifact `model-vX.Y.onnx` + `manifest.json` (classes, T, thresholds, metrics, dataset manifest hash) baked into image; version surfaced in /healthz and every prediction (stored in cropHealthLogs.analysis.modelVersion). Concurrency: session shared, requests serialized by uvicorn workers (2); timeout 10s server-side; request size limit middleware; no filesystem writes (stateless); no external calls (Gemini lives in the backend, not here — single responsibility + key isolation).

## Security (docs/security/ai-security.md)
Not publicly browsable beyond /healthz; service key rotation supported via env; rejects non-image payloads before decode; structured logs without image contents; rate irrelevant (backend is the only caller and enforces user quotas).
