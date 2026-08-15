"""The class contract, loaded from model/model-manifest.json.

CLAUDE.md rule 4 (registry-driven) applies here as much as it does to crops in
the backend: there is no `if crop == "TOMATO"` anywhere in this service. Class
codes, the crop grouping, the healthy set and the thresholds all arrive from the
manifest, which scripts/generate_model_manifest.py derives from
datasets/manifest.json so the contract cannot drift from the training data.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

# Fallback margin guard if the manifest omits it. 0.15 is specified verbatim in
# docs/ml/confidence-strategy.md, so it is the one value safe to hardcode.
SPEC_MARGIN_GUARD = 0.15


class ManifestError(RuntimeError):
    """The model manifest is missing, unreadable, or internally inconsistent."""


@dataclass(frozen=True)
class Thresholds:
    """Threshold policy inputs.

    `calibrated` is False until a training run measures temperature and the
    acceptance thresholds from validation curves. It is carried through to the
    logs on purpose: a service answering with provisional thresholds should say
    so every time it starts.
    """

    tau: float
    tau_healthy: float
    margin_guard: float
    crop_mask_floor: float
    temperature: float
    calibrated: bool


@dataclass(frozen=True)
class Preprocessing:
    resize_shortest_side: int
    center_crop: int
    mean: tuple[float, float, float]
    std: tuple[float, float, float]


@dataclass(frozen=True)
class ModelManifest:
    model_version: str
    trained: bool
    provisional: bool
    classes: tuple[str, ...]
    healthy_classes: frozenset[str]
    crops: dict[str, tuple[str, ...]]
    thresholds: Thresholds
    preprocessing: Preprocessing
    dataset_manifest_sha256: str | None
    known_limitations: tuple[str, ...]

    @property
    def num_classes(self) -> int:
        return len(self.classes)

    def indices_for_crop(self, crop_code: str) -> tuple[int, ...]:
        """Output indices belonging to a declared crop; empty tuple if unknown.

        An unknown crop is not an error here — the model simply covers 6 of the
        9 supported crops, and "the model has nothing to say about wheat" is the
        crop-mismatch branch, not a 500.
        """
        codes = self.crops.get(crop_code)
        if not codes:
            return ()
        lookup = {code: index for index, code in enumerate(self.classes)}
        return tuple(lookup[code] for code in codes)

    def is_healthy(self, class_code: str) -> bool:
        return class_code in self.healthy_classes


def _require(data: dict[str, Any], key: str) -> Any:
    if key not in data:
        raise ManifestError(f"model manifest is missing required key {key!r}")
    return data[key]


def load_manifest(path: Path, *, model_version_override: str | None = None) -> ModelManifest:
    """Read and validate the model manifest. Raises ManifestError on any doubt."""
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ManifestError(f"model manifest not found at {path} — run scripts/generate_model_manifest.py") from exc
    except json.JSONDecodeError as exc:
        raise ManifestError(f"model manifest at {path} is not valid JSON: {exc}") from exc

    classes = tuple(_require(raw, "classes"))
    if not classes:
        raise ManifestError("model manifest declares zero classes")
    if len(set(classes)) != len(classes):
        raise ManifestError("model manifest contains duplicate class codes")

    healthy = frozenset(raw.get("healthyClasses", ()))
    unknown_healthy = healthy - set(classes)
    if unknown_healthy:
        raise ManifestError(f"healthyClasses references unknown codes: {sorted(unknown_healthy)}")

    crops_raw: dict[str, list[str]] = _require(raw, "crops")
    crops: dict[str, tuple[str, ...]] = {}
    for crop_code, members in crops_raw.items():
        unknown = set(members) - set(classes)
        if unknown:
            raise ManifestError(f"crop {crop_code} references unknown classes: {sorted(unknown)}")
        crops[crop_code] = tuple(members)

    inference = _require(raw, "inference")
    threshold_values = _require(inference, "thresholds")
    thresholds = Thresholds(
        tau=float(_require(threshold_values, "tau")),
        tau_healthy=float(_require(threshold_values, "tauHealthy")),
        margin_guard=float(threshold_values.get("marginGuard", SPEC_MARGIN_GUARD)),
        crop_mask_floor=float(_require(threshold_values, "cropMaskFloor")),
        temperature=float(_require(inference, "temperature")),
        calibrated=bool(raw.get("calibrated", False)),
    )
    if thresholds.temperature <= 0:
        raise ManifestError("temperature must be > 0")
    for name, value in (
        ("tau", thresholds.tau),
        ("tauHealthy", thresholds.tau_healthy),
        ("marginGuard", thresholds.margin_guard),
        ("cropMaskFloor", thresholds.crop_mask_floor),
    ):
        if not 0.0 <= value <= 1.0:
            raise ManifestError(f"threshold {name} must lie in [0, 1] (got {value})")

    pre_raw = _require(raw, "preprocessing")
    mean = tuple(float(v) for v in _require(pre_raw, "mean"))
    std = tuple(float(v) for v in _require(pre_raw, "std"))
    if len(mean) != 3 or len(std) != 3:
        raise ManifestError("preprocessing mean/std must each have 3 channels")
    if any(v <= 0 for v in std):
        raise ManifestError("preprocessing std values must be > 0")

    preprocessing = Preprocessing(
        resize_shortest_side=int(_require(pre_raw, "resizeShortestSide")),
        center_crop=int(_require(pre_raw, "centerCrop")),
        mean=mean,  # type: ignore[arg-type]
        std=std,  # type: ignore[arg-type]
    )

    return ModelManifest(
        # MODEL_VERSION in the environment lets a rebuild re-label an artifact
        # without regenerating the manifest; the manifest value is the default.
        model_version=model_version_override or str(_require(raw, "modelVersion")),
        trained=bool(raw.get("trained", False)),
        provisional=bool(raw.get("provisional", True)),
        classes=classes,
        healthy_classes=healthy,
        crops=crops,
        thresholds=thresholds,
        preprocessing=preprocessing,
        dataset_manifest_sha256=(raw.get("datasetManifest") or {}).get("sha256"),
        known_limitations=tuple(raw.get("knownLimitations", ())),
    )
