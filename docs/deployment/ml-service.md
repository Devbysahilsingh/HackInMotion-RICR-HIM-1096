# ml-service Deployment

Primary: **Hugging Face Spaces** (Docker SDK, CPU basic, free): `ml-service/Dockerfile` (python:3.12-slim, onnxruntime, model artifact + manifest baked in, uvicorn :7860 per Spaces convention); secrets: SERVICE_KEY via Space secrets; private Space visibility NOT required (endpoints are key-protected; /docs disabled) but set to public-code/no-docs consciously — decision noted.
Alt (OD-2): second Render service (same Dockerfile, :10000) — chosen if Spaces latency/sleep behavior disappoints in Day-1 test (test = 20 sequential real-image /predict round-trips from backend host; accept if p95 < 1.5s warm).
Sleep handling: backend treats ml-service timeouts as tier-down (Gemini takes over) — cold-start invisible to farmers; demo warm-up hits /predict once before stage.
Update flow: retrain → parity gates → bump MODEL_VERSION + artifact → rebuild/push → /healthz shows version → backend log confirms.
