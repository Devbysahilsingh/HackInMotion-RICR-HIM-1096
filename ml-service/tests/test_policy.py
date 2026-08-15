"""Threshold policy, driven by synthetic probability vectors.

docs/testing/ml-testing.md asks for exactly this: synthetic vectors -> the
accept / uncertain / mismatch branches, per docs/ml/confidence-strategy.md.
"""

from __future__ import annotations

import math

import pytest

from app.policy import apply_policy, softmax
from tests.conftest import logits_favouring, logits_tied


# ── softmax / temperature ───────────────────────────────────────────────


def test_softmax_sums_to_one() -> None:
    probs = softmax([1.0, 2.0, 3.0], 1.0)
    assert sum(probs) == pytest.approx(1.0)


def test_softmax_is_stable_for_large_logits() -> None:
    probs = softmax([1000.0, 999.0, -1000.0], 1.0)
    assert all(math.isfinite(value) for value in probs)
    assert sum(probs) == pytest.approx(1.0)


def test_higher_temperature_flattens_the_distribution() -> None:
    sharp = softmax([4.0, 0.0, 0.0], 1.0)
    flat = softmax([4.0, 0.0, 0.0], 4.0)
    assert flat[0] < sharp[0]


def test_non_positive_temperature_rejected() -> None:
    with pytest.raises(ValueError):
        softmax([1.0, 2.0], 0.0)


# ── Accept branch ───────────────────────────────────────────────────────


def test_confident_prediction_is_accepted(manifest) -> None:
    outcome = apply_policy(logits_favouring(manifest, "TOMATO_LATE_BLIGHT"), "TOMATO", manifest)
    assert outcome.disease_code == "TOMATO_LATE_BLIGHT"
    assert outcome.uncertain is False
    assert outcome.crop_mismatch is False
    assert outcome.confidence >= manifest.thresholds.tau
    assert outcome.reasons == ("accepted",)


def test_top3_is_ordered_and_capped(manifest) -> None:
    outcome = apply_policy(logits_favouring(manifest, "TOMATO_LATE_BLIGHT"), "TOMATO", manifest)
    assert len(outcome.top3) == 3
    probs = [item.prob for item in outcome.top3]
    assert probs == sorted(probs, reverse=True)


def test_masked_probabilities_renormalise_to_one(manifest) -> None:
    outcome = apply_policy(logits_favouring(manifest, "POTATO_LATE_BLIGHT"), "POTATO", manifest)
    # POTATO has exactly 3 classes, so top3 covers the whole renormalised mass.
    assert sum(item.prob for item in outcome.top3) == pytest.approx(1.0)


def test_only_declared_crop_classes_can_be_returned(manifest) -> None:
    """The mask must restrict the answer set, not trip the mismatch branch.

    The lean is derived from the manifest's temperature rather than hardcoded.
    A fixed peak of 3.0 was a mild lean at T=1 (the untrained stub) and became a
    strong one at the calibrated T=0.586, which sharpened every distribution and
    pushed the non-declared crop's classes under the mask floor — so the fixture
    started exercising the mismatch branch instead of the masking branch. The
    service was right; the fixture had a temperature baked into it.
    """
    temperature = manifest.thresholds.temperature
    floor = manifest.thresholds.crop_mask_floor
    others = manifest.num_classes - 1

    # Largest peak that still leaves every other class above the floor:
    #   p_other = 1 / (exp(peak / T) + others) > floor
    max_peak = temperature * math.log(1.0 / floor - others)
    peak = max_peak / 2  # comfortably inside, so the test is not knife-edge

    outcome = apply_policy(logits_favouring(manifest, "RICE_BLAST", peak=peak), "MAIZE", manifest)
    assert outcome.crop_mismatch is False, (
        f"peak={peak:.3f} at T={temperature} should leave MAIZE above the {floor} floor"
    )
    for item in outcome.top3:
        assert item.code.startswith("MAIZE_")


# ── Uncertain branches ──────────────────────────────────────────────────


def test_low_confidence_is_uncertain(manifest) -> None:
    # Flat logits across every tomato class: nothing gets near tau.
    flat = [0.0] * manifest.num_classes
    outcome = apply_policy(flat, "TOMATO", manifest)
    assert outcome.uncertain is True
    assert outcome.disease_code is None
    assert "below_tau" in outcome.reasons


def test_margin_guard_fires_on_a_confusable_pair(manifest) -> None:
    logits = logits_tied(manifest, "TOMATO_EARLY_BLIGHT", "TOMATO_LATE_BLIGHT")
    outcome = apply_policy(logits, "TOMATO", manifest)
    margin = outcome.top3[0].prob - outcome.top3[1].prob
    assert margin < manifest.thresholds.margin_guard
    assert outcome.uncertain is True
    assert "margin_guard" in outcome.reasons
    assert outcome.disease_code is None


def test_healthy_guard_rejects_a_healthy_top1_below_tau_healthy(manifest, monkeypatch) -> None:
    """A healthy call between tau and tau_healthy must still be uncertain.

    Constructed so the ONLY failing condition is the healthy guard: confidence
    clears tau and the margin clears 0.15, yet the answer is "healthy" without
    enough evidence — the exact case where a false negative sends a farmer away
    from a treatable infection.
    """
    thresholds = manifest.thresholds
    target = (thresholds.tau + thresholds.tau_healthy) / 2
    assert thresholds.tau < target < thresholds.tau_healthy

    tomato_indices = manifest.indices_for_crop("TOMATO")
    healthy_index = manifest.classes.index("TOMATO_HEALTHY")
    others = [i for i in tomato_indices if i != healthy_index]

    # Craft probabilities directly, then invert through log to get logits.
    #
    # The inversion must account for temperature: the policy computes
    # softmax(logits / T), so a logit of log(p) realises p only when T == 1.
    # That held while the model was the untrained stub and stopped holding the
    # moment calibration shipped T=0.5863 — log(0.75) then realised 0.9454,
    # above tau_healthy, so the guard correctly did not fire and this fixture
    # was silently testing a different scenario than it documents. Multiplying
    # by T makes the constructed probability the one the test names; the
    # `confidence == approx(target)` assertion below is what proves it.
    remaining = (1.0 - target) / len(others)
    temperature = thresholds.temperature
    logits = [-40.0] * manifest.num_classes
    logits[healthy_index] = temperature * math.log(target)
    for index in others:
        logits[index] = temperature * math.log(remaining)

    outcome = apply_policy(logits, "TOMATO", manifest)
    assert outcome.top3[0].code == "TOMATO_HEALTHY"
    assert outcome.confidence == pytest.approx(target, abs=1e-3)
    assert outcome.confidence >= thresholds.tau
    assert "healthy_guard" in outcome.reasons
    assert "below_tau" not in outcome.reasons
    assert outcome.uncertain is True
    assert outcome.disease_code is None


def test_confident_healthy_above_tau_healthy_is_accepted(manifest) -> None:
    outcome = apply_policy(logits_favouring(manifest, "TOMATO_HEALTHY"), "TOMATO", manifest)
    assert outcome.disease_code == "TOMATO_HEALTHY"
    assert outcome.uncertain is False


def test_rice_normal_is_treated_as_healthy(manifest) -> None:
    """RICE_NORMAL does not carry the _HEALTHY suffix but is a healthy class."""
    thresholds = manifest.thresholds
    target = (thresholds.tau + thresholds.tau_healthy) / 2
    rice_indices = manifest.indices_for_crop("RICE")
    normal_index = manifest.classes.index("RICE_NORMAL")
    others = [i for i in rice_indices if i != normal_index]
    remaining = (1.0 - target) / len(others)

    # Temperature-scaled inversion, for the same reason as the healthy-guard
    # test above: softmax(logits / T) realises log(p) as p only when T == 1.
    temperature = thresholds.temperature
    logits = [-40.0] * manifest.num_classes
    logits[normal_index] = temperature * math.log(target)
    for index in others:
        logits[index] = temperature * math.log(remaining)

    outcome = apply_policy(logits, "RICE", manifest)
    assert "healthy_guard" in outcome.reasons
    assert outcome.disease_code is None


# ── Crop-mismatch branches ──────────────────────────────────────────────


def test_crop_not_covered_by_the_model_is_a_mismatch(manifest) -> None:
    outcome = apply_policy(logits_favouring(manifest, "TOMATO_LATE_BLIGHT"), "WHEAT", manifest)
    assert outcome.crop_mismatch is True
    assert outcome.uncertain is True
    assert outcome.disease_code is None
    assert outcome.reasons == ("crop_not_covered_by_model",)


def test_mask_below_floor_is_a_mismatch(manifest) -> None:
    # Everything points at rice while the farmer declared potato.
    logits = logits_favouring(manifest, "RICE_BLAST", peak=30.0, base=-30.0)
    outcome = apply_policy(logits, "POTATO", manifest)
    assert outcome.crop_mismatch is True
    assert outcome.uncertain is True
    assert outcome.disease_code is None
    assert outcome.reasons == ("crop_mask_below_floor",)


def test_mismatch_top3_comes_from_the_unmasked_distribution(manifest) -> None:
    logits = logits_favouring(manifest, "RICE_BLAST", peak=30.0, base=-30.0)
    outcome = apply_policy(logits, "POTATO", manifest)
    assert outcome.top3[0].code == "RICE_BLAST"


def test_mismatch_confidence_is_zero_not_a_guess(manifest) -> None:
    outcome = apply_policy(logits_favouring(manifest, "TOMATO_LATE_BLIGHT"), "WHEAT", manifest)
    assert outcome.confidence == 0.0


# ── Contract invariants ─────────────────────────────────────────────────


def test_a_prediction_is_never_forced(manifest) -> None:
    """Sweep every crop across a range of peaks: uncertain => no diseaseCode."""
    for crop in [*manifest.crops, "WHEAT", "ONION", "SOYBEAN"]:
        members = manifest.crops.get(crop) or manifest.classes
        for code in members:
            for peak in (0.0, 0.5, 1.0, 2.0, 4.0, 8.0, 30.0):
                outcome = apply_policy(logits_favouring(manifest, code, peak=peak), crop, manifest)
                if outcome.uncertain:
                    assert outcome.disease_code is None
                else:
                    assert outcome.disease_code is not None
                    assert outcome.crop_mismatch is False


def test_logit_length_mismatch_is_an_error(manifest) -> None:
    with pytest.raises(ValueError):
        apply_policy([0.0] * (manifest.num_classes - 1), "TOMATO", manifest)


def test_policy_is_deterministic(manifest) -> None:
    logits = logits_tied(manifest, "TOMATO_EARLY_BLIGHT", "TOMATO_TARGET_SPOT")
    first = apply_policy(logits, "TOMATO", manifest)
    second = apply_policy(logits, "TOMATO", manifest)
    assert first == second
