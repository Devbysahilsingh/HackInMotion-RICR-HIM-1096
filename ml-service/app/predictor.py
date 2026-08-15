"""Inference backends behind one interface.

THE MODEL DOES NOT EXIST YET. P3-2 builds the service skeleton only; no training
has happened and none may happen without its own approval (CLAUDE.md rule 1).

Two implementations sit behind `Predictor`:

* `OnnxPredictor`  — the real path. Loads a `.onnx` artefact with onnxruntime,
  one warmed session, CPU provider, single-threaded.
* `StubPredictor`  — a placeholder that returns a DETERMINISTIC score vector
  derived from a hash of the preprocessed tensor. Its outputs are arbitrary by
  construction: they exercise the contract, the threshold policy and the crop
  mask without pretending to carry any visual meaning whatsoever.

Swapping in the trained model is a config change, not a code change: set
MODEL_PATH and regenerate the manifest. Nothing above this module knows which
implementation is live except the log line and the `stub-` model-version prefix,
which are there precisely so a stub answer is never mistaken for a real one.
"""

from __future__ import annotations

import hashlib
from abc import ABC, abstractmethod
from pathlib import Path

from app.preprocessing import Tensor


class ModelUnavailable(RuntimeError):
    """The configured model could not be loaded or executed."""


class Predictor(ABC):
    """Maps a preprocessed tensor to raw, uncalibrated logits."""

    #: Reported in /healthz and on every prediction.
    model_version: str
    #: Length of the vector `infer` returns; must equal the manifest class count.
    num_classes: int
    #: True when the answers are placeholders rather than model output.
    is_stub: bool

    @abstractmethod
    def infer(self, tensor: Tensor) -> list[float]:
        """Return `num_classes` raw logits. Must be pure and side-effect free."""

    def warmup(self) -> None:
        """Run one throwaway inference so the first real request is not the
        one that pays for lazy graph initialisation."""
        zeros = Tensor(data=_zero_array(3 * 224 * 224), shape=(1, 3, 224, 224))
        self.infer(zeros)


def _zero_array(length: int):
    from array import array

    return array("f", bytes(length * 4))


class StubPredictor(Predictor):
    """Deterministic placeholder logits derived from the input tensor's hash.

    Why a hash rather than random or constant values: the contract tests need
    *determinism* (same bytes in, same answer out — an explicit requirement in
    docs/testing/ml-testing.md) and enough spread across classes to exercise the
    accept / margin-guard / crop-mismatch branches. A hash gives both, is
    reproducible across processes and machines (unlike PYTHONHASHSEED-sensitive
    builtin hash()), and is obviously not a classifier to anyone reading it.

    `spread` scales the logit range and therefore how peaked the softmax gets.
    It is a test-affordance, not a model hyperparameter.
    """

    def __init__(self, num_classes: int, model_version: str, *, spread: float = 6.0) -> None:
        if num_classes <= 0:
            raise ValueError("num_classes must be positive")
        self.num_classes = num_classes
        # The `stub-` prefix is forced here rather than assumed from the
        # manifest. It used to come for free because the manifest itself said
        # "stub-0.0.0-untrained" — but once a trained model shipped, the
        # manifest began saying "model-v1.0", and a stub handed that string
        # would have reported a real model version while serving hash noise.
        # The marker has to be a property of the backend, not of the document.
        self.model_version = model_version if model_version.startswith("stub-") else f"stub-{model_version}"
        self.is_stub = True
        self._spread = spread

    def infer(self, tensor: Tensor) -> list[float]:
        # SHAKE-256 because it emits an arbitrary-length digest: one stable
        # 16-bit draw per class, regardless of how many classes the manifest has.
        digest = hashlib.shake_256(tensor.tobytes()).digest(self.num_classes * 2)
        return [
            (int.from_bytes(digest[i * 2 : i * 2 + 2], "big") / 65535.0) * self._spread for i in range(self.num_classes)
        ]


class OnnxPredictor(Predictor):
    """onnxruntime-backed inference over a single shared, warmed session."""

    def __init__(self, model_path: Path, num_classes: int, model_version: str) -> None:
        # Imported lazily so that the whole service, and its test suite, run on
        # interpreters where no onnxruntime wheel exists. Pinned in
        # requirements.txt regardless, because the Docker image (3.12) has one.
        try:
            import numpy  # noqa: F401  (imported for the side-effect check below)
            import onnxruntime
        except ImportError as exc:  # pragma: no cover - environment-dependent
            raise ModelUnavailable("onnxruntime is not installed; set MODEL_PATH only where it is available") from exc

        if not model_path.is_file():
            raise ModelUnavailable(f"model artefact not found at {model_path}")

        options = onnxruntime.SessionOptions()
        # uvicorn already runs 2 workers (docs/ml/inference-architecture.md);
        # letting ORT also fan out oversubscribes a free-tier single-core box.
        options.intra_op_num_threads = 1
        options.inter_op_num_threads = 1
        options.log_severity_level = 3  # warnings and above; ORT is chatty at 0-2

        try:
            self._session = onnxruntime.InferenceSession(
                str(model_path),
                sess_options=options,
                providers=["CPUExecutionProvider"],
            )
        except Exception as exc:  # onnxruntime raises bare Fail/InvalidGraph types
            raise ModelUnavailable(f"could not load ONNX model: {exc}") from exc

        inputs = self._session.get_inputs()
        if len(inputs) != 1:
            raise ModelUnavailable(f"expected exactly 1 model input, found {len(inputs)}")
        self._input_name = inputs[0].name
        self.num_classes = num_classes
        self.model_version = model_version
        self.is_stub = False

    def infer(self, tensor: Tensor) -> list[float]:
        import numpy

        # frombuffer is a view, not a copy: the tensor is read-only downstream.
        matrix = numpy.frombuffer(tensor.tobytes(), dtype=numpy.float32).reshape(tensor.shape)
        try:
            outputs = self._session.run(None, {self._input_name: matrix})
        except Exception as exc:
            raise ModelUnavailable(f"inference failed: {exc}") from exc

        logits = numpy.asarray(outputs[0]).reshape(-1).tolist()
        if len(logits) != self.num_classes:
            # A silent mismatch here would mislabel every prediction while the
            # service looked perfectly healthy — the single worst failure mode.
            raise ModelUnavailable(
                f"model emits {len(logits)} scores but the manifest declares {self.num_classes} classes"
            )
        return [float(value) for value in logits]


def build_predictor(*, model_path: Path | None, num_classes: int, model_version: str) -> Predictor:
    """Pick the backend from configuration. MODEL_PATH set => real model, always.

    A missing or broken artefact raises rather than falling back to the stub:
    quietly serving hash noise where a trained model was configured is exactly
    the kind of dishonest degradation CLAUDE.md rule 7 forbids.
    """
    if model_path is None:
        return StubPredictor(num_classes=num_classes, model_version=model_version)
    return OnnxPredictor(model_path, num_classes=num_classes, model_version=model_version)
