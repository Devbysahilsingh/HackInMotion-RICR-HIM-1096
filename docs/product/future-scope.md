# Future Scope

Ordered by (impact × readiness). Each item lists the hook already built into the architecture.

1. **Yield estimation v1 (P3 spec ready)** — transparent district-average estimator; hook: `yieldEstimates` schema + API contract + docs/yield/ formula. Next: ingest data.gov.in APY dataset.
2. **On-device ML** — ONNX → TFLite conversion of the trained EfficientNet-B0; hook: model artifact + preprocessing spec are deployment-agnostic; enables true offline disease scan.
3. **Soybean + wheat specialized models** — SoyNet (9k Indian images, CC BY) and open wheat-rust sets identified in dataset research; hook: crop registry support levels + unified model retraining playbook (docs/ml/model-versioning.md).
4. **Offline write queue & sync** — draft observations queued locally, synced with conflict rules; hook: docs/offline/ design + idempotent analysis endpoint.
5. **Voice v2** — full-utterance NLU (LLM intent parsing), more languages (Marathi, Telugu); hook: intent router abstraction.
6. **Community v2** — map visualization, severity weighting, extension-officer verification loop; hook: aggregation job + advisory schema.
7. **Password recovery + phone OTP auth** — needs free mail/SMS solution or budget.
8. **Push notifications** — Expo push (free) for CRITICAL alerts.
9. **Fertilizer v2** — Soil Health Card upload/parse → test-based dosage.
10. **iOS** — Expo makes this a build-target change + Apple fee.
11. **FPO / extension-worker dashboards** — multi-farmer aggregate views (new role model required — deliberately absent from MVP).
12. **Satellite/NDVI integration** (Sentinel-2 via free tiers) for field-level stress detection.
