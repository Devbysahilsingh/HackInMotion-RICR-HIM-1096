"""GET /healthz and the OpenAPI surface.

/healthz is the only endpoint reachable without the service key, so what it
does NOT say matters as much as what it does.
"""

from __future__ import annotations

from fastapi.testclient import TestClient


def test_healthz_is_public(client) -> None:
    assert client.get("/healthz").status_code == 200


def test_healthz_shape_is_exactly_the_contract(client) -> None:
    body = client.get("/healthz").json()
    assert set(body) == {"status", "modelVersion", "uptime"}
    assert body["status"] in ("ok", "degraded")
    assert isinstance(body["modelVersion"], str)
    assert body["uptime"] >= 0


def test_healthz_exposes_no_internals(client) -> None:
    text = client.get("/healthz").text.lower()
    for leak in (
        "tau",
        "threshold",
        "classes",
        "tomato",
        "model_path",
        "modelpath",
        "service_key",
        "servicekey",
        "python",
        "onnx",
        "path",
        "env",
        "hostname",
    ):
        assert leak not in text, f"/healthz leaked {leak!r}"


def test_healthz_reports_degraded_without_a_predictor(make_app) -> None:
    with TestClient(make_app()) as client:
        client.app.state.predictor = None
        body = client.get("/healthz").json()
    assert body["status"] == "degraded"
    assert set(body) == {"status", "modelVersion", "uptime"}


def test_healthz_needs_no_service_key(client) -> None:
    assert client.get("/healthz", headers={"X-Service-Key": "wrong"}).status_code == 200


def test_uptime_increases(client) -> None:
    first = client.get("/healthz").json()["uptime"]
    second = client.get("/healthz").json()["uptime"]
    assert second >= first


# ── OpenAPI surface ─────────────────────────────────────────────────────


def test_docs_disabled_outside_development(make_app) -> None:
    for env in ("test", "production"):
        with TestClient(make_app(env=env)) as client:
            for path in ("/docs", "/redoc", "/openapi.json"):
                assert client.get(path).status_code == 404, f"{path} reachable in {env}"


def test_docs_available_in_development(make_app) -> None:
    with TestClient(make_app(env="development")) as client:
        assert client.get("/docs").status_code == 200
        assert client.get("/openapi.json").status_code == 200


def test_disabled_docs_return_the_error_envelope(make_app) -> None:
    with TestClient(make_app(env="production")) as client:
        body = client.get("/docs").json()
    assert body["error"]["code"] == "NOT_FOUND"
