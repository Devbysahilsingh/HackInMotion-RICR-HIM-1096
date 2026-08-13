# ml-service — docs/deployment/ml-service.md
# Primary host: Hugging Face Spaces (Docker SDK, CPU basic, free), port 7860.
# Alt (OD-2): Render, same image, port injected via PORT.

FROM python:3.12-slim

# Spaces runs containers as uid 1000. Creating the user explicitly means the
# image behaves identically on Render, where it would otherwise run as root.
RUN useradd --create-home --uid 1000 mlservice

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    ENV=production \
    PORT=7860

WORKDIR /app

# Dependencies first so a code change does not re-resolve the wheel set.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY model ./model

# The model artefact and its manifest are baked into the image
# (docs/ml/inference-architecture.md). `COPY model ./model` above brings both.
#
# P4-6/P4-7: model-v1.0.onnx is the trained EfficientNet-B0 candidate, exported
# at opset 17 and parity-gated against onnxruntime (max |dprob| 1.55e-05 over
# 100 golden images, tolerance 1e-3 — docs/ml/evaluation-results/onnx-parity.json).
#
# Setting MODEL_PATH is what selects the real model over the deterministic stub.
# `build_predictor` never falls back: if this path is set and the artefact fails
# to load, the service reports degraded health and answers 503 rather than
# quietly serving hash noise as if it were a prediction.
#
# torch is deliberately absent from this image. Training lives in
# ml-service/training/ with its own dependency set, and only the ~15MB ONNX
# graph crosses the boundary (docs/security/dependency-security.md).
ENV MODEL_PATH=/app/model/model-v1.0.onnx

USER mlservice

EXPOSE 7860

# /healthz is the only public endpoint, which makes it the natural probe.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request,os,sys; sys.exit(0 if urllib.request.urlopen(f'http://127.0.0.1:{os.environ.get(\"PORT\",\"7860\")}/healthz', timeout=4).status == 200 else 1)"

# --factory: the app is built by create_app(), which validates configuration
# before a socket is ever opened. A missing SERVICE_KEY kills the container here
# rather than surfacing as a 500 on the first real request.
# 2 workers per docs/ml/inference-architecture.md; the ONNX session is
# per-worker and single-threaded, which suits a 2-vCPU free tier.
CMD ["sh", "-c", "uvicorn app.main:create_app --factory --host 0.0.0.0 --port ${PORT:-7860} --workers 2 --no-access-log"]
