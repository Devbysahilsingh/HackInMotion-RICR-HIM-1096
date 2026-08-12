# Model Versioning & Lifecycle

- **Artifact:** `model-v{major}.{minor}.onnx` + manifest (classes[], temperature, τ, τ_healthy, metrics {val, field}, dataset manifest hash, training config hash, created). Major = class-set change; minor = retrain same classes.
- **Storage:** artifacts in ml-service repo dir via Git LFS if >100MB (ours ~20MB — plain git fine); every deployed version tagged `model-vX.Y`.
- **Traceability:** cropHealthLogs stores modelVersion per analysis → any past diagnosis auditable against its model's known metrics.
- **Upgrade path (new crop → SPECIALIZED):** extend class map → registry mlClassCodes + KB entries first → retrain per training-plan → full evaluation battery → parity test → deploy → registry supportLevel flip. No code changes outside registry+artifact (registry-driven contract).
- **Rollback:** previous artifact kept in image history; env `MODEL_VERSION` pin; /healthz surfaces active version.
- **Future targets documented:** ONNX→TFLite (on-device Android), quantization (int8 dynamic — try only post-hackathon; accuracy re-validation mandatory).
