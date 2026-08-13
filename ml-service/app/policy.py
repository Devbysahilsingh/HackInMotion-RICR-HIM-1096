"""Threshold policy — pure functions, no I/O, no framework imports.

Implements docs/ml/confidence-strategy.md exactly:

    conf >= tau (and the healthy rule holds)   -> prediction
    conf <  tau, or top1-top2 < 0.15,          -> uncertain + top3
      or a healthy top-1 below tau_healthy
    declared-crop mask leaves no class above
      a small floor                            -> crop-mismatch branch

"Never force a prediction" is contractual: there is no code path in this module
that returns a diseaseCode while `uncertain` is true.

Same spirit as the backend's engines/ (CLAUDE.md rule 5): deterministic, pure,
fixture-tested, and every outcome carries a trace of why it was reached.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from app.classes import ModelManifest

TOP_K = 3


@dataclass(frozen=True)
class ScoredClass:
    code: str
    prob: float


@dataclass(frozen=True)
class PolicyOutcome:
    """The decision plus its reasons.

    `reasons` never reaches the farmer or the wire — it is the why-trace for
    logs and tests. The response schema is fixed by
    docs/ml/inference-architecture.md and gains no fields here.
    """

    disease_code: str | None
    uncertain: bool
    confidence: float
    top3: tuple[ScoredClass, ...]
    crop_mismatch: bool
    reasons: tuple[str, ...]


def softmax(logits: list[float], temperature: float) -> list[float]:
    """Temperature-scaled softmax, max-shifted for numerical stability.

    temperature == 1.0 means *no calibration has been applied*, which is the
    current state of the world — see model-manifest.json `placeholders`.
    """
    if temperature <= 0:
        raise ValueError("temperature must be > 0")
    if not logits:
        raise ValueError("logits must not be empty")

    scaled = [value / temperature for value in logits]
    peak = max(scaled)
    exponentiated = [math.exp(value - peak) for value in scaled]
    total = sum(exponentiated)
    if total <= 0:  # pragma: no cover - only reachable with non-finite logits
        raise ValueError("softmax denominator collapsed to zero")
    return [value / total for value in exponentiated]


def _top_k(probs: list[float], classes: tuple[str, ...], indices: tuple[int, ...]) -> tuple[ScoredClass, ...]:
    # Ties broken by class code so the response is deterministic for identical
    # inputs, which the determinism test depends on.
    ranked = sorted(indices, key=lambda i: (-probs[i], classes[i]))
    return tuple(ScoredClass(code=classes[i], prob=probs[i]) for i in ranked[:TOP_K])


def apply_policy(logits: list[float], crop_code: str, manifest: ModelManifest) -> PolicyOutcome:
    """Turn raw logits + a declared crop into the response decision."""
    if len(logits) != manifest.num_classes:
        raise ValueError(
            f"expected {manifest.num_classes} logits, got {len(logits)}"
        )

    thresholds = manifest.thresholds
    probs = softmax(logits, thresholds.temperature)
    all_indices = tuple(range(manifest.num_classes))
    crop_indices = manifest.indices_for_crop(crop_code)

    # ── Crop-mismatch branch ────────────────────────────────────────────
    # Two distinct situations collapse here on purpose. Either the model has no
    # classes for this crop at all (it covers 6 of the 9 supported crops), or it
    # has some but none scored above the floor. Both mean the same thing to the
    # farmer — "this doesn't look like the crop you told us" — and the response
    # schema has no field to distinguish them, so inventing one would break the
    # contract for a distinction the UI cannot use.
    if not crop_indices:
        return PolicyOutcome(
            disease_code=None,
            uncertain=True,
            confidence=0.0,
            top3=_top_k(probs, manifest.classes, all_indices),
            crop_mismatch=True,
            reasons=("crop_not_covered_by_model",),
        )

    best_in_crop = max(probs[i] for i in crop_indices)
    if best_in_crop < thresholds.crop_mask_floor:
        # top3 comes from the UNMASKED distribution here: the useful signal for
        # the backend is what the image actually looked like, not the best of a
        # set of classes the model just rejected.
        return PolicyOutcome(
            disease_code=None,
            uncertain=True,
            confidence=0.0,
            top3=_top_k(probs, manifest.classes, all_indices),
            crop_mismatch=True,
            reasons=("crop_mask_below_floor",),
        )

    # ── Mask + renormalise ──────────────────────────────────────────────
    mass = sum(probs[i] for i in crop_indices)
    masked = [0.0] * manifest.num_classes
    for index in crop_indices:
        masked[index] = probs[index] / mass

    ranked = _top_k(masked, manifest.classes, crop_indices)
    top1 = ranked[0]
    # A crop with a single class has no runner-up; treating the margin as the
    # full confidence keeps the guard from firing on a degenerate comparison.
    margin = top1.prob - ranked[1].prob if len(ranked) > 1 else top1.prob

    reasons: list[str] = []
    if top1.prob < thresholds.tau:
        reasons.append("below_tau")
    if margin < thresholds.margin_guard:
        reasons.append("margin_guard")
    if manifest.is_healthy(top1.code) and top1.prob < thresholds.tau_healthy:
        reasons.append("healthy_guard")

    uncertain = bool(reasons)
    return PolicyOutcome(
        disease_code=None if uncertain else top1.code,
        uncertain=uncertain,
        confidence=top1.prob,
        top3=ranked,
        crop_mismatch=False,
        reasons=tuple(reasons) if reasons else ("accepted",),
    )
