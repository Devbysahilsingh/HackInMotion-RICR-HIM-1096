"""The class contract must not drift from datasets/manifest.json."""

from __future__ import annotations

import json
import subprocess
import sys

import pytest

from app.classes import ManifestError, load_manifest
from app.config import DEFAULT_MODEL_MANIFEST
from tests.conftest import REPO_ROOT

DATASET_MANIFEST = REPO_ROOT / "datasets" / "manifest.json"


def test_class_codes_match_the_dataset_manifest_exactly(manifest) -> None:
    dataset = json.loads(DATASET_MANIFEST.read_text(encoding="utf-8"))
    assert set(manifest.classes) == set(dataset["classes"].keys())
    assert manifest.num_classes == 35


def test_generator_reports_the_committed_manifest_as_current() -> None:
    """Guards the drift the generator exists to prevent."""
    result = subprocess.run(
        [sys.executable, str(REPO_ROOT / "ml-service" / "scripts" / "generate_model_manifest.py"), "--check"],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr


def test_healthy_set_includes_rice_normal(manifest) -> None:
    # RICE_NORMAL is the reason healthy-ness comes from the manifest instead of
    # an endswith("_HEALTHY") check somewhere in the policy code.
    assert manifest.is_healthy("RICE_NORMAL")
    assert manifest.is_healthy("TOMATO_HEALTHY")
    assert not manifest.is_healthy("TOMATO_LATE_BLIGHT")


def test_every_class_belongs_to_exactly_one_crop(manifest) -> None:
    seen: dict[str, str] = {}
    for crop, codes in manifest.crops.items():
        for code in codes:
            assert code not in seen, f"{code} claimed by {seen.get(code)} and {crop}"
            seen[code] = crop
    assert set(seen) == set(manifest.classes)


def test_crop_indices_are_valid_and_ordered(manifest) -> None:
    for crop in manifest.crops:
        indices = manifest.indices_for_crop(crop)
        assert indices
        assert all(0 <= i < manifest.num_classes for i in indices)


def test_uncovered_crop_yields_no_indices(manifest) -> None:
    # The model covers 6 of the 9 supported crops; the other three are not an
    # error, they are the crop-mismatch branch.
    assert manifest.indices_for_crop("WHEAT") == ()
    assert manifest.indices_for_crop("ONION") == ()
    assert manifest.indices_for_crop("NOT_A_CROP") == ()


def test_manifest_declares_itself_untrained_and_uncalibrated(manifest) -> None:
    """The honesty markers are load-bearing, not decoration."""
    assert manifest.trained is False
    assert manifest.provisional is True
    assert manifest.thresholds.calibrated is False
    assert manifest.model_version.startswith("stub-")


def test_margin_guard_matches_the_specified_value(manifest) -> None:
    # 0.15 is the one threshold docs/ml/confidence-strategy.md actually pins.
    assert manifest.thresholds.margin_guard == pytest.approx(0.15)


def test_known_limitations_are_carried_through(manifest) -> None:
    joined = " ".join(manifest.known_limitations)
    assert "RICE_NORMAL" in joined
    assert "chilli" in joined.lower()


def test_missing_manifest_raises_manifest_error(tmp_path) -> None:
    with pytest.raises(ManifestError):
        load_manifest(tmp_path / "nope.json")


def test_malformed_manifest_raises_manifest_error(tmp_path) -> None:
    bad = tmp_path / "model-manifest.json"
    bad.write_text("{not json", encoding="utf-8")
    with pytest.raises(ManifestError):
        load_manifest(bad)


def test_manifest_with_unknown_healthy_class_is_rejected(tmp_path) -> None:
    source = json.loads(DEFAULT_MODEL_MANIFEST.read_text(encoding="utf-8"))
    source["healthyClasses"] = ["NOT_A_CLASS"]
    target = tmp_path / "model-manifest.json"
    target.write_text(json.dumps(source), encoding="utf-8")
    with pytest.raises(ManifestError):
        load_manifest(target)


def test_manifest_with_out_of_range_threshold_is_rejected(tmp_path) -> None:
    source = json.loads(DEFAULT_MODEL_MANIFEST.read_text(encoding="utf-8"))
    source["inference"]["thresholds"]["tau"] = 1.4
    target = tmp_path / "model-manifest.json"
    target.write_text(json.dumps(source), encoding="utf-8")
    with pytest.raises(ManifestError):
        load_manifest(target)


def test_model_version_override_is_honoured(tmp_path) -> None:
    overridden = load_manifest(DEFAULT_MODEL_MANIFEST, model_version_override="model-v1.2")
    assert overridden.model_version == "model-v1.2"
