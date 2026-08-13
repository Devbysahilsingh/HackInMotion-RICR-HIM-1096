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
# (docs/ml/inference-architecture.md). Today `model/` holds the manifest only —
# NO TRAINED MODEL EXISTS. With MODEL_PATH unset the service starts on the
# deterministic StubPredictor, whose model version is literally
# "stub-0.0.0-untrained" so a stub answer cannot be mistaken for a real one.
#
# When training ships, that becomes:
#   COPY model/model-vX.Y.onnx ./model/
#   ENV MODEL_PATH=/app/model/model-vX.Y.onnx
# and nothing else in this file, or in the API contract, changes.

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
