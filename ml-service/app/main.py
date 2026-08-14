"""FastAPI application: POST /predict (internal) and GET /healthz (public).

Contract: docs/ml/inference-architecture.md · Security: docs/security/ai-security.md

Nothing here is publicly browsable beyond /healthz. There is no third endpoint,
no admin surface, no debug route, and no way to reach inference without the
service key — in any environment.
"""

from __future__ import annotations

import asyncio
import re
import time
import uuid
from contextlib import asynccontextmanager
from typing import Any
from collections.abc import AsyncIterator

from anyio import to_thread
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.datastructures import UploadFile
from starlette.exceptions import HTTPException
from starlette.formparsers import MultiPartParser

from app import __version__
from app.classes import ManifestError, ModelManifest, load_manifest
from app.config import MAX_IMAGE_BYTES, ConfigError, Settings, load_settings
from app.logging_config import configure_logging
from app.policy import apply_policy
from app.predictor import ModelUnavailable, Predictor, build_predictor
from app.preprocessing import ImageRejected, preprocess
from app.schemas import (
    ErrorBody,
    ErrorResponse,
    HealthResponse,
    PredictResponse,
    ScoredClassOut,
)
from app.schemas import CROP_CODE_PATTERN
from app.security import SERVICE_KEY_HEADER, verify_service_key

# Headroom over the image cap for multipart framing (boundaries, headers, the
# cropCode field). Requests larger than this are refused before any parsing.
MULTIPART_OVERHEAD_BYTES = 64 * 1024
MAX_REQUEST_BYTES = MAX_IMAGE_BYTES + MULTIPART_OVERHEAD_BYTES

# Starlette spools multipart parts to a temporary FILE above 1MB by default.
# docs/ml/inference-architecture.md requires a stateless service with no
# filesystem writes, so the spool threshold is raised above the request cap to
# keep every upload in memory. The 8MB ceiling is what makes that safe — and
# that ceiling is only real because BodySizeLimitMiddleware counts the stream;
# see the note there for why the Content-Length check alone did not deliver it.
# (max_part_size is a constructor argument, not a class default, so it is passed
# per-call at the request.form() site instead.)
MultiPartParser.spool_max_size = MAX_REQUEST_BYTES

# Request ids come from the backend for cross-service correlation. Untrusted
# input reaching a log line gets a strict allowlist, not an escape function.
_REQUEST_ID_SAFE = re.compile(r"^[A-Za-z0-9._-]{1,64}$")


def _error(status: int, code: str, message: str) -> JSONResponse:
    """Safe error envelope: a stable code and a message that leaks nothing."""
    body = ErrorResponse(error=ErrorBody(code=code, message=message))
    return JSONResponse(status_code=status, content=body.model_dump())


class RequestBodyTooLarge(Exception):
    """More body bytes arrived than MAX_REQUEST_BYTES allows.

    Raised out of the ASGI receive channel, so it surfaces wherever the body is
    being consumed rather than at a single call site.
    """


class BodySizeLimitMiddleware:
    """Caps the request body on bytes actually received, not on what was declared.

    Content-Length is a claim, and a client can simply decline to make it: an
    HTTP/1.1 chunked request carries no Content-Length at all, so a header-only
    check is bypassed by omitting the header. Nothing underneath closed that gap
    either — Starlette's `max_part_size` bounds only *non-file* parts
    (formparsers.MultiPartParser.on_part_data checks the limit solely on the
    `file is None` branch and appends file data unchecked), so an unbounded file
    part streamed straight into the SpooledTemporaryFile and, past
    spool_max_size, onto disk. That both admitted an unbounded body and broke
    the no-filesystem-writes property the spool_max_size line above assumes.

    Counting the stream is the only cap that actually holds. The Content-Length
    fast path is kept ahead of it because rejecting before the first byte is
    read is strictly cheaper when the client is honest.
    """

    def __init__(self, app: Any, max_bytes: int) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Any, receive: Any, send: Any) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        declared = _header_value(scope, b"content-length")
        if declared is not None:
            try:
                if int(declared) > self.max_bytes:
                    await _error(413, "IMAGE_TOO_LARGE", "request body exceeds the size limit")(
                        scope, receive, send
                    )
                    return
            except ValueError:
                await _error(400, "REQUEST_INVALID", "malformed Content-Length header")(
                    scope, receive, send
                )
                return

        received = 0
        started = False

        async def counting_receive() -> Any:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_bytes:
                    raise RequestBodyTooLarge
            return message

        async def tracking_send(message: Any) -> None:
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            await self.app(scope, counting_receive, tracking_send)
        except RequestBodyTooLarge:
            if started:
                # Headers are already on the wire; there is no valid way to
                # replace the response. Let it surface as a transport error.
                raise
            await _error(413, "IMAGE_TOO_LARGE", "request body exceeds the size limit")(
                scope, receive, send
            )


def _header_value(scope: Any, name: bytes) -> str | None:
    for key, value in scope.get("headers", ()):
        if key.lower() == name:
            return value.decode("latin-1")
    return None


def _request_id(request: Request) -> str:
    incoming = request.headers.get("X-Request-Id", "")
    if _REQUEST_ID_SAFE.match(incoming):
        return incoming
    return uuid.uuid4().hex[:16]


def create_app(settings: Settings | None = None) -> FastAPI:
    """Build the application. Called as a uvicorn factory in production."""
    resolved = settings or load_settings()
    logger = configure_logging(resolved.log_level)

    try:
        manifest = load_manifest(
            resolved.model_manifest_path,
            model_version_override=resolved.model_version_override,
        )
    except ManifestError as exc:
        # The class contract is not optional. Without it the service cannot map
        # an output index to a disease code, and guessing is not an option.
        raise ConfigError(str(exc)) from exc

    @asynccontextmanager
    async def lifespan(application: FastAPI) -> AsyncIterator[None]:
        application.state.started_at = time.monotonic()
        application.state.manifest = manifest
        application.state.predictor = None

        try:
            predictor: Predictor = build_predictor(
                model_path=resolved.model_path,
                num_classes=manifest.num_classes,
                model_version=manifest.model_version,
            )
            predictor.warmup()
            application.state.predictor = predictor
        except (ModelUnavailable, ValueError) as exc:
            # Start anyway, report `degraded`, and 503 every /predict. The
            # backend treats an ml-service failure as a tier-down to Gemini
            # (docs/architecture/resilience.md), so a container that refuses to
            # boot buys nothing and loses the health signal that says why.
            logger.error("model_unavailable", extra={"reason": str(exc)})

        logger.info(
            "startup",
            extra={
                "serviceVersion": __version__,
                "modelVersion": manifest.model_version,
                "env": resolved.env,
                "classes": manifest.num_classes,
                "predictor": type(application.state.predictor).__name__
                if application.state.predictor
                else None,
                # Surfaced on every boot on purpose: an operator reading the
                # logs must never have to wonder whether the answers are real.
                "modelTrained": manifest.trained,
                "thresholdsCalibrated": manifest.thresholds.calibrated,
            },
        )
        if not manifest.trained or not manifest.thresholds.calibrated:
            logger.warning(
                "provisional_model_configuration",
                extra={
                    "detail": (
                        "No trained model and/or no calibrated thresholds. "
                        "Predictions are placeholders; see model/model-manifest.json."
                    )
                },
            )

        yield

        logger.info("shutdown", extra={"modelVersion": manifest.model_version})

    application = FastAPI(
        title="ml-service",
        version=__version__,
        lifespan=lifespan,
        # docs/security/ai-security.md: OpenAPI docs disabled outside development.
        docs_url="/docs" if resolved.docs_enabled else None,
        redoc_url="/redoc" if resolved.docs_enabled else None,
        openapi_url="/openapi.json" if resolved.docs_enabled else None,
    )
    application.state.settings = resolved

    # ── Middleware ──────────────────────────────────────────────────────
    application.add_middleware(BodySizeLimitMiddleware, max_bytes=MAX_REQUEST_BYTES)

    # ── Error handlers (safe errors, stable codes) ───────────────────────
    @application.exception_handler(HTTPException)
    async def http_exception_handler(_: Request, exc: HTTPException) -> JSONResponse:
        code = "NOT_FOUND" if exc.status_code == 404 else "REQUEST_INVALID"
        return _error(exc.status_code, code, "request could not be served")

    @application.exception_handler(RequestValidationError)
    async def validation_exception_handler(_: Request, __: RequestValidationError) -> JSONResponse:
        return _error(400, "REQUEST_INVALID", "request failed validation")

    @application.exception_handler(Exception)
    async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
        # Log the type, never the payload, never a traceback in the response.
        logger.error(
            "unhandled_error",
            extra={"requestId": _request_id(request), "errorType": type(exc).__name__},
        )
        return _error(500, "INTERNAL_ERROR", "internal error")

    # ── Routes ──────────────────────────────────────────────────────────

    def _serving_model_version() -> str:
        """The version of the backend actually serving, not of the document.

        A degraded service has no predictor, so it falls back to the manifest —
        which is the right answer there: nothing is serving, and the manifest
        names what *should* be. When a predictor exists it is authoritative,
        which is what keeps a stub from reporting a trained model's version.
        """
        predictor = getattr(application.state, "predictor", None)
        return predictor.model_version if predictor else manifest.model_version

    @application.get("/healthz", response_model=HealthResponse)
    async def healthz(request: Request) -> HealthResponse:
        """Public liveness. Exposes no internals: no class list, no thresholds,
        no model path, no environment name, no dependency versions."""
        ready = getattr(request.app.state, "predictor", None) is not None
        started_at = getattr(request.app.state, "started_at", time.monotonic())
        return HealthResponse(
            status="ok" if ready else "degraded",
            modelVersion=_serving_model_version(),
            uptime=round(time.monotonic() - started_at, 3),
        )

    @application.post("/predict")
    async def predict(request: Request) -> Any:
        started = time.perf_counter()
        request_id = _request_id(request)

        # 1. Authenticate before touching the body at all.
        if not verify_service_key(request.headers.get(SERVICE_KEY_HEADER), resolved.service_key):
            logger.warning(
                "service_key_rejected",
                extra={"requestId": request_id, "path": "/predict"},
            )
            return _error(401, "SERVICE_KEY_INVALID", "invalid or missing service key")

        # 2. Parse the multipart body.
        try:
            form = await request.form(
                max_files=4, max_fields=8, max_part_size=MAX_REQUEST_BYTES
            )
        except RequestBodyTooLarge:
            # Not a parse failure: the body outgrew the cap mid-stream. Let it
            # reach BodySizeLimitMiddleware, which answers 413. Collapsing it
            # into the 400 below would report "malformed" for a well-formed
            # request whose only fault was its size.
            raise
        except Exception:  # noqa: BLE001 — a parser fault is a client fault here
            # Deliberately broad. Starlette's multipart parser raises several
            # unrelated types for a malformed body, and every one of them means
            # the same thing to the caller: the request could not be read. The
            # one case that is *not* a parse failure is re-raised above.
            return _error(400, "REQUEST_INVALID", "request body could not be parsed")

        try:
            upload = form.get("image")
            crop_code_raw = form.get("cropCode")

            if not isinstance(upload, UploadFile):
                return _error(400, "REQUEST_INVALID", "missing 'image' file part")
            if not isinstance(crop_code_raw, str) or not crop_code_raw.strip():
                return _error(400, "REQUEST_INVALID", "missing 'cropCode' field")

            crop_code = crop_code_raw.strip()
            if not CROP_CODE_PATTERN.match(crop_code):
                return _error(400, "CROP_CODE_INVALID", "cropCode is not a valid crop code")

            payload = await upload.read()
        finally:
            await form.close()

        # 3. Model availability.
        predictor: Predictor | None = getattr(request.app.state, "predictor", None)
        if predictor is None:
            logger.error("predict_unavailable", extra={"requestId": request_id})
            return _error(503, "MODEL_UNAVAILABLE", "model is not available")

        # 4. Validate + preprocess + infer, under a server-side timeout.
        try:
            outcome = await asyncio.wait_for(
                # abandon_on_cancel=True is required for the timeout to mean
                # anything: anyio's default makes cancellation *wait* for the
                # worker thread, so a hung inference would hold the request
                # open past the deadline. Abandoning is safe here because the
                # blocking half is pure computation — no locks, no I/O, no
                # partially-written state to leave behind.
                to_thread.run_sync(
                    _run_inference,
                    predictor,
                    manifest,
                    payload,
                    crop_code,
                    abandon_on_cancel=True,
                ),
                timeout=resolved.request_timeout_seconds,
            )
        except ImageRejected as exc:
            logger.info(
                "image_rejected",
                extra={
                    "requestId": request_id,
                    "code": exc.code,
                    "cropCode": crop_code,
                    # Byte count only — image content never enters a log line.
                    "bytes": len(payload),
                },
            )
            status = 413 if exc.code == "IMAGE_TOO_LARGE" else 400
            return _error(status, exc.code, exc.message)
        except TimeoutError:
            logger.error("inference_timeout", extra={"requestId": request_id, "cropCode": crop_code})
            return _error(504, "INFERENCE_TIMEOUT", "inference timed out")
        except ModelUnavailable as exc:
            logger.error(
                "inference_failed",
                extra={"requestId": request_id, "reason": str(exc)},
            )
            return _error(503, "INFERENCE_FAILED", "inference failed")

        latency_ms = round((time.perf_counter() - started) * 1000, 2)
        response = PredictResponse(
            diseaseCode=outcome.disease_code,
            uncertain=outcome.uncertain,
            confidence=round(outcome.confidence, 6),
            top3=[ScoredClassOut(code=item.code, prob=round(item.prob, 6)) for item in outcome.top3],
            cropMismatch=True if outcome.crop_mismatch else None,
            modelVersion=_serving_model_version(),
            latencyMs=latency_ms,
        )

        logger.info(
            "predict",
            extra={
                "requestId": request_id,
                "cropCode": crop_code,
                "bytes": len(payload),
                "uncertain": outcome.uncertain,
                "cropMismatch": outcome.crop_mismatch,
                "reasons": list(outcome.reasons),
                "modelVersion": _serving_model_version(),
                "latencyMs": latency_ms,
            },
        )
        # `cropMismatch?` is optional in the contract, so it is emitted only when
        # the branch fired. `diseaseCode` is NOT optional — it is documented as
        # `diseaseCode|null` and an explicit null is the signal that the service
        # declined to predict, which is a first-class outcome here.
        body = response.model_dump()
        if body["cropMismatch"] is None:
            del body["cropMismatch"]
        return JSONResponse(content=body)

    return application


def _run_inference(predictor: Predictor, manifest: ModelManifest, payload: bytes, crop_code: str):
    """Blocking half of the request path, executed off the event loop."""
    tensor = preprocess(payload, manifest.preprocessing)
    logits = predictor.infer(tensor)
    return apply_policy(logits, crop_code, manifest)
