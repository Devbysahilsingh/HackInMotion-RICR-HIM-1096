"""Predictor backends: the deterministic stub and the ONNX harness.

The ONNX tests build a tiny hand-serialised graph (scripts/make_stub_onnx.py) so
the real loading path is exercised without a trained model existing. They skip
cleanly where onnxruntime has no wheel — see README.md.
"""

from __future__ import annotations

import sys
from array import array
from pathlib import Path

import pytest

from app.predictor import ModelUnavailable, OnnxPredictor, StubPredictor, build_predictor
from app.preprocessing import Tensor

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))


def _tensor(fill: float = 0.5) -> Tensor:
    return Tensor(data=array("f", [fill] * (3 * 224 * 224)), shape=(1, 3, 224, 224))


# ── StubPredictor ───────────────────────────────────────────────────────


def test_stub_returns_one_logit_per_class() -> None:
    predictor = StubPredictor(num_classes=35, model_version="stub-0.0.0-untrained")
    assert len(predictor.infer(_tensor())) == 35


def test_stub_is_deterministic_for_identical_input() -> None:
    predictor = StubPredictor(num_classes=35, model_version="v")
    assert predictor.infer(_tensor(0.25)) == predictor.infer(_tensor(0.25))


def test_stub_is_deterministic_across_instances() -> None:
    """No process-local state: two fresh instances agree, so the answer is
    reproducible across workers and across restarts."""
    a = StubPredictor(num_classes=35, model_version="v")
    b = StubPredictor(num_classes=35, model_version="v")
    assert a.infer(_tensor(0.75)) == b.infer(_tensor(0.75))


def test_stub_distinguishes_different_inputs() -> None:
    predictor = StubPredictor(num_classes=35, model_version="v")
    assert predictor.infer(_tensor(0.1)) != predictor.infer(_tensor(0.2))


def test_stub_declares_itself_a_stub() -> None:
    assert StubPredictor(num_classes=35, model_version="v").is_stub is True


def test_stub_rejects_a_zero_class_manifest() -> None:
    with pytest.raises(ValueError):
        StubPredictor(num_classes=0, model_version="v")


def test_warmup_runs_without_error() -> None:
    StubPredictor(num_classes=35, model_version="v").warmup()


def test_build_predictor_defaults_to_the_stub() -> None:
    predictor = build_predictor(model_path=None, num_classes=35, model_version="v")
    assert isinstance(predictor, StubPredictor)


def test_build_predictor_never_falls_back_to_the_stub(tmp_path) -> None:
    """A configured-but-broken model must fail loudly.

    Silently serving hash noise where a trained model was configured would make
    a broken deploy indistinguishable from a working one.
    """
    with pytest.raises(ModelUnavailable):
        build_predictor(
            model_path=tmp_path / "missing.onnx", num_classes=35, model_version="v"
        )


# ── OnnxPredictor ───────────────────────────────────────────────────────

onnxruntime = pytest.importorskip(
    "onnxruntime",
    reason="onnxruntime wheel unavailable on this interpreter; the Docker image pins 3.12",
)


@pytest.fixture(scope="module")
def stub_onnx(tmp_path_factory) -> Path:
    from make_stub_onnx import build_stub_onnx

    path = tmp_path_factory.mktemp("model") / "model-stub.onnx"
    path.write_bytes(build_stub_onnx(35))
    return path


def test_onnx_predictor_loads_and_infers(stub_onnx) -> None:
    predictor = OnnxPredictor(stub_onnx, num_classes=35, model_version="stub-onnx")
    logits = predictor.infer(_tensor())
    assert len(logits) == 35
    assert all(isinstance(value, float) for value in logits)
    assert predictor.is_stub is False


def test_onnx_predictor_is_deterministic(stub_onnx) -> None:
    predictor = OnnxPredictor(stub_onnx, num_classes=35, model_version="stub-onnx")
    assert predictor.infer(_tensor(0.3)) == predictor.infer(_tensor(0.3))


def test_onnx_predictor_warmup(stub_onnx) -> None:
    OnnxPredictor(stub_onnx, num_classes=35, model_version="stub-onnx").warmup()


def test_class_count_mismatch_is_fatal(stub_onnx) -> None:
    """A 35-output graph declared as 12 classes must not be served.

    This is the failure that would mislabel every prediction while every health
    check stayed green, so it is a hard error rather than a warning.
    """
    predictor = OnnxPredictor(stub_onnx, num_classes=12, model_version="stub-onnx")
    with pytest.raises(ModelUnavailable):
        predictor.infer(_tensor())


def test_corrupt_artefact_is_model_unavailable(tmp_path) -> None:
    broken = tmp_path / "broken.onnx"
    broken.write_bytes(b"this is not a protobuf")
    with pytest.raises(ModelUnavailable):
        OnnxPredictor(broken, num_classes=35, model_version="v")


def test_build_predictor_selects_onnx_when_model_path_is_set(stub_onnx) -> None:
    predictor = build_predictor(model_path=stub_onnx, num_classes=35, model_version="v")
    assert isinstance(predictor, OnnxPredictor)


def test_end_to_end_with_a_real_onnx_session(make_app, auth_headers, stub_onnx, jpeg_bytes) -> None:
    """The full request path over onnxruntime, proving the swap-in is a config
    change: same routes, same contract, different backend."""
    from fastapi.testclient import TestClient

    with TestClient(make_app(model_path=stub_onnx)) as client:
        assert client.get("/healthz").json()["status"] == "ok"
        response = client.post(
            "/predict",
            files={"image": ("leaf.jpg", jpeg_bytes, "image/jpeg")},
            data={"cropCode": "TOMATO"},
            headers=auth_headers,
        )
    assert response.status_code == 200
    body = response.json()
    assert {"uncertain", "confidence", "top3", "modelVersion", "latencyMs"} <= set(body)
