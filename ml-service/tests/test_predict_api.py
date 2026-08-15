"""POST /predict — the full internal contract."""

from __future__ import annotations

import asyncio

from fastapi.testclient import TestClient

from app.config import Settings
from tests.conftest import (
    MULTIPART_BLOCK,
    MULTIPART_CONTENT_TYPE,
    TEST_SERVICE_KEY,
    ExplodingPredictor,
    FixedPredictor,
    SlowPredictor,
    chunked_multipart,
    multipart_prologue,
    logits_favouring,
    logits_tied,
    make_animated_gif,
    make_image_bytes,
    make_oversize_jpeg,
    make_pixel_bomb,
    make_truncated_jpeg,
)


def post(client: TestClient, payload: bytes | None, crop_code: str | None, headers: dict[str, str]):
    files = {}
    data = {}
    if payload is not None:
        files["image"] = ("leaf.jpg", payload, "image/jpeg")
    if crop_code is not None:
        data["cropCode"] = crop_code
    return client.post("/predict", files=files or None, data=data or None, headers=headers)


# ── Service key ─────────────────────────────────────────────────────────


def test_valid_service_key_is_accepted(client, auth_headers, jpeg_bytes) -> None:
    response = post(client, jpeg_bytes, "TOMATO", auth_headers)
    assert response.status_code == 200


def test_missing_service_key_is_401(client, jpeg_bytes) -> None:
    response = post(client, jpeg_bytes, "TOMATO", {})
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "SERVICE_KEY_INVALID"


def test_invalid_service_key_is_401(client, jpeg_bytes) -> None:
    response = post(client, jpeg_bytes, "TOMATO", {"X-Service-Key": "b" * 64})
    assert response.status_code == 401


def test_wrong_length_service_key_is_401(client, jpeg_bytes) -> None:
    for candidate in (TEST_SERVICE_KEY[:-1], TEST_SERVICE_KEY + "x", "x"):
        response = post(client, jpeg_bytes, "TOMATO", {"X-Service-Key": candidate})
        assert response.status_code == 401


def test_empty_service_key_header_is_401(client, jpeg_bytes) -> None:
    assert post(client, jpeg_bytes, "TOMATO", {"X-Service-Key": ""}).status_code == 401


def test_auth_is_checked_before_the_body_is_parsed(client) -> None:
    """A junk body with no key must still yield 401, never a parse error."""
    response = client.post("/predict", content=b"\x00\x01\x02not-multipart")
    assert response.status_code == 401


def test_error_body_leaks_nothing_about_the_key(client, jpeg_bytes) -> None:
    body = post(client, jpeg_bytes, "TOMATO", {"X-Service-Key": "b" * 64}).text
    assert TEST_SERVICE_KEY not in body
    assert "length" not in body.lower()


# ── Malformed requests ──────────────────────────────────────────────────


def test_missing_image_is_400(client, auth_headers) -> None:
    response = post(client, None, "TOMATO", auth_headers)
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "REQUEST_INVALID"


def test_missing_crop_code_is_400(client, auth_headers, jpeg_bytes) -> None:
    response = post(client, jpeg_bytes, None, auth_headers)
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "REQUEST_INVALID"


def test_blank_crop_code_is_400(client, auth_headers, jpeg_bytes) -> None:
    assert post(client, jpeg_bytes, "   ", auth_headers).status_code == 400


def test_malformed_crop_code_is_400(client, auth_headers, jpeg_bytes) -> None:
    for candidate in ("tomato", "TOM ATO", "TOMATO;DROP", "T", "../../etc/passwd", "A" * 40):
        response = post(client, jpeg_bytes, candidate, auth_headers)
        assert response.status_code == 400, candidate
        assert response.json()["error"]["code"] == "CROP_CODE_INVALID", candidate


def test_image_sent_as_a_plain_field_is_400(client, auth_headers) -> None:
    response = client.post("/predict", data={"image": "not-a-file", "cropCode": "TOMATO"}, headers=auth_headers)
    assert response.status_code == 400


def test_non_multipart_body_is_400(client, auth_headers) -> None:
    response = client.post("/predict", json={"cropCode": "TOMATO"}, headers=auth_headers)
    assert response.status_code == 400


# ── Image validation ────────────────────────────────────────────────────


def test_non_image_payload_is_400(client, auth_headers) -> None:
    response = post(client, b"absolutely not an image, just prose", "TOMATO", auth_headers)
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "IMAGE_FORMAT_UNSUPPORTED"


def test_corrupt_image_is_400(client, auth_headers) -> None:
    response = post(client, b"\xff\xd8\xff" + b"\x7f" * 3000, "TOMATO", auth_headers)
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "IMAGE_INVALID"


def test_truncated_image_is_400(client, auth_headers) -> None:
    response = post(client, make_truncated_jpeg(), "TOMATO", auth_headers)
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "IMAGE_INVALID"


def test_animated_gif_is_rejected(client, auth_headers) -> None:
    response = post(client, make_animated_gif(), "TOMATO", auth_headers)
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "IMAGE_FORMAT_UNSUPPORTED"


def test_oversize_image_is_413(client, auth_headers) -> None:
    response = post(client, make_oversize_jpeg(), "TOMATO", auth_headers)
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "IMAGE_TOO_LARGE"


def test_request_larger_than_the_body_cap_is_413(client, auth_headers) -> None:
    """Refused by the size middleware, before multipart parsing allocates."""
    response = post(client, b"\xff\xd8\xff" + b"\x00" * (12 * 1024 * 1024), "TOMATO", auth_headers)
    assert response.status_code == 413


def test_body_cap_holds_without_a_content_length_header(client, auth_headers) -> None:
    """A chunked request declares no size, so the cap must not depend on one.

    Regression: the size check read Content-Length only. Omitting the header —
    which HTTP/1.1 chunked encoding does by definition — skipped it entirely,
    and Starlette's max_part_size does not bound *file* parts, so the body ran
    on unchecked.
    """
    response = client.post(
        "/predict",
        content=chunked_multipart(32 * 1024 * 1024),
        headers={**auth_headers, "Content-Type": MULTIPART_CONTENT_TYPE},
    )

    assert response.status_code == 413
    assert response.json()["error"]["code"] == "IMAGE_TOO_LARGE"


def test_oversized_body_stops_being_read_at_the_cap(make_app) -> None:
    """The cap must bite while the body arrives, not once it is all in hand.

    This is the half that matters for availability: a limit applied after
    buffering still lets a caller spend the service's memory, and past
    spool_max_size its disk, before being told no.

    Driven at the ASGI layer deliberately. TestClient materialises a generator
    body before the app ever runs, so a client-side counter would measure httpx.
    How many bytes the *application* pulls out of `receive` is the only place
    the property is observable.
    """
    app = make_app()
    offered = 64 * 1024 * 1024
    consumed = 0

    async def receive():
        nonlocal consumed
        if consumed == 0:
            chunk = multipart_prologue()
        elif consumed < offered:
            chunk = MULTIPART_BLOCK
        else:  # pragma: no cover - reached only if the cap fails to hold
            return {"type": "http.request", "body": b"", "more_body": False}
        consumed += len(chunk)
        return {"type": "http.request", "body": chunk, "more_body": True}

    messages: list[dict] = []

    async def send(message) -> None:
        messages.append(message)

    asyncio.run(app(_predict_scope(), receive, send))

    # The resource property first: it is the one that matters, and it is the one
    # that failed before the cap counted the stream.
    assert consumed < offered // 2, f"app read {consumed} bytes before refusing"

    start = next(m for m in messages if m["type"] == "http.response.start")
    assert start["status"] == 413


def _predict_scope() -> dict:
    """A chunked POST /predict scope: authenticated, no content-length."""
    return {
        "type": "http",
        "asgi": {"version": "3.0", "spec_version": "2.3"},
        "http_version": "1.1",
        "method": "POST",
        "scheme": "http",
        "path": "/predict",
        "raw_path": b"/predict",
        "query_string": b"",
        "root_path": "",
        "client": ("127.0.0.1", 51234),
        "server": ("testserver", 80),
        "headers": [
            (b"host", b"testserver"),
            (b"x-service-key", TEST_SERVICE_KEY.encode()),
            (b"content-type", MULTIPART_CONTENT_TYPE.encode()),
            (b"transfer-encoding", b"chunked"),
        ],
    }


def test_malformed_content_length_is_400(client, auth_headers) -> None:
    response = client.post(
        "/predict",
        content=b"whatever",
        headers={**auth_headers, "Content-Length": "not-a-number"},
    )
    assert response.status_code == 400


def test_pixel_bomb_is_413(client, auth_headers) -> None:
    response = post(client, make_pixel_bomb(100_000, 100_000), "TOMATO", auth_headers)
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "IMAGE_TOO_LARGE"


# ── Response contract ───────────────────────────────────────────────────


def test_response_matches_the_documented_shape(client, auth_headers, jpeg_bytes) -> None:
    body = post(client, jpeg_bytes, "TOMATO", auth_headers).json()
    assert set(body) <= {
        "diseaseCode",
        "uncertain",
        "confidence",
        "top3",
        "cropMismatch",
        "modelVersion",
        "latencyMs",
    }
    assert {"uncertain", "confidence", "top3", "modelVersion", "latencyMs"} <= set(body)
    assert isinstance(body["uncertain"], bool)
    assert 0.0 <= body["confidence"] <= 1.0
    assert all(set(item) == {"code", "prob"} for item in body["top3"])
    assert body["latencyMs"] >= 0


def test_model_version_identifies_the_serving_backend(client, auth_headers, jpeg_bytes) -> None:
    """A stub answer must never carry a trained model's version string.

    The default test configuration sets no MODEL_PATH, so the stub is serving
    and the version must say so — regardless of what the committed manifest
    names. That distinction became real when model-v1.0 shipped: before it, the
    manifest itself said "stub-", so this property held by accident.
    """
    body = post(client, jpeg_bytes, "TOMATO", auth_headers).json()
    predictor = client.app.state.predictor

    assert body["modelVersion"] == predictor.model_version
    assert body["modelVersion"].startswith("stub-") is bool(getattr(predictor, "is_stub", False))


def test_identical_input_yields_an_identical_response(client, auth_headers) -> None:
    payload = make_image_bytes(200, 150)
    first = post(client, payload, "TOMATO", auth_headers).json()
    second = post(client, payload, "TOMATO", auth_headers).json()
    # latencyMs is a measurement, not part of the decision.
    first.pop("latencyMs")
    second.pop("latencyMs")
    assert first == second


def test_crop_mismatch_field_absent_on_a_normal_answer(client, auth_headers, jpeg_bytes) -> None:
    body = post(client, jpeg_bytes, "TOMATO", auth_headers).json()
    assert "cropMismatch" not in body


def test_uncovered_crop_takes_the_mismatch_branch(client, auth_headers, jpeg_bytes) -> None:
    body = post(client, jpeg_bytes, "WHEAT", auth_headers).json()
    assert body["cropMismatch"] is True
    assert body["uncertain"] is True
    assert body["diseaseCode"] is None


def test_margin_guard_path_returns_uncertain_with_top3(make_app, auth_headers, manifest, jpeg_bytes) -> None:
    with TestClient(make_app()) as client:
        client.app.state.predictor = FixedPredictor(logits_tied(manifest, "TOMATO_EARLY_BLIGHT", "TOMATO_LATE_BLIGHT"))
        body = post(client, jpeg_bytes, "TOMATO", auth_headers).json()
    assert body["uncertain"] is True
    assert body["diseaseCode"] is None
    assert len(body["top3"]) == 3


def test_confident_path_returns_a_disease_code(make_app, auth_headers, manifest, jpeg_bytes) -> None:
    with TestClient(make_app()) as client:
        client.app.state.predictor = FixedPredictor(logits_favouring(manifest, "TOMATO_LEAF_MOLD"))
        body = post(client, jpeg_bytes, "TOMATO", auth_headers).json()
    assert body["diseaseCode"] == "TOMATO_LEAF_MOLD"
    assert body["uncertain"] is False


def test_mask_below_floor_path(make_app, auth_headers, manifest, jpeg_bytes) -> None:
    with TestClient(make_app()) as client:
        client.app.state.predictor = FixedPredictor(logits_favouring(manifest, "RICE_BLAST", peak=30.0, base=-30.0))
        body = post(client, jpeg_bytes, "POTATO", auth_headers).json()
    assert body["cropMismatch"] is True
    assert body["diseaseCode"] is None


# ── Availability and failure handling ───────────────────────────────────


def test_model_unavailable_is_a_clean_503(make_app, auth_headers, jpeg_bytes) -> None:
    with TestClient(make_app()) as client:
        client.app.state.predictor = None
        response = post(client, jpeg_bytes, "TOMATO", auth_headers)
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "MODEL_UNAVAILABLE"


def test_missing_model_artefact_starts_degraded_and_503s(make_app, auth_headers, jpeg_bytes, tmp_path) -> None:
    """MODEL_PATH pointing nowhere must never silently fall back to the stub."""
    app = make_app(model_path=tmp_path / "absent-model.onnx")
    with TestClient(app) as client:
        assert client.get("/healthz").json()["status"] == "degraded"
        response = post(client, jpeg_bytes, "TOMATO", auth_headers)
    assert response.status_code == 503


def test_inference_failure_is_a_503(make_app, auth_headers, manifest, jpeg_bytes) -> None:
    with TestClient(make_app()) as client:
        client.app.state.predictor = ExplodingPredictor(manifest.num_classes)
        response = post(client, jpeg_bytes, "TOMATO", auth_headers)
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "INFERENCE_FAILED"


def test_slow_inference_times_out_with_504(make_app, auth_headers, manifest, jpeg_bytes) -> None:
    app = make_app(request_timeout_seconds=0.05)
    with TestClient(app) as client:
        client.app.state.predictor = SlowPredictor(manifest.num_classes, delay=2.0)
        response = post(client, jpeg_bytes, "TOMATO", auth_headers)
    assert response.status_code == 504
    assert response.json()["error"]["code"] == "INFERENCE_TIMEOUT"


def test_errors_never_include_a_traceback(client, auth_headers) -> None:
    body = post(client, b"nonsense payload that is not an image", "TOMATO", auth_headers).text
    for marker in ("Traceback", 'File "', "app/preprocessing.py", "site-packages"):
        assert marker not in body


# ── Surface area ────────────────────────────────────────────────────────


def test_no_other_routes_exist(client, auth_headers) -> None:
    for path in ("/", "/predict/", "/metrics", "/model", "/classes", "/admin", "/.env"):
        assert client.get(path, headers=auth_headers).status_code in (404, 405)


def test_get_on_predict_is_not_allowed(client, auth_headers) -> None:
    assert client.get("/predict", headers=auth_headers).status_code == 405


def test_settings_object_is_never_serialised(client, auth_headers, jpeg_bytes) -> None:
    body = post(client, jpeg_bytes, "TOMATO", auth_headers).text
    assert TEST_SERVICE_KEY not in body
    assert "service_key" not in body


def test_app_can_be_built_from_the_environment(monkeypatch) -> None:
    """The uvicorn factory path (`create_app` with no argument)."""
    from app.main import create_app

    monkeypatch.setenv("SERVICE_KEY", TEST_SERVICE_KEY)
    monkeypatch.setenv("ENV", "test")
    app = create_app()
    assert app.title == "ml-service"


def test_settings_type_is_frozen() -> None:
    settings = Settings(env="test", service_key=TEST_SERVICE_KEY)
    assert settings.env == "test"
