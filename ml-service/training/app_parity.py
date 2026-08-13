"""Cheap check that training and serving agree on preprocessing constants.

This is NOT the parity gate. The real one (P4-6) pushes 100 golden images
through both PyTorch and onnxruntime and requires |Δprob| < 1e-3, and it can
only exist once a trained model does. What this does is catch the much dumber
failure that would otherwise survive until then: someone edits `config.yaml`'s
resize or normalisation values, training silently learns against one convention
and the service serves against another, and the only symptom is an accuracy drop
nobody can explain.

Comparing the numbers costs nothing and rules that out today.
"""

from __future__ import annotations

import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
MANIFEST = HERE.parent / "model" / "model-manifest.json"


def compare_with_service(image_cfg: dict) -> dict:
    """Compare `config.yaml`'s image block against the served model manifest.

    @returns {"status": "PASS"|"FAIL"|"INFO", "detail": str}
    """
    if not MANIFEST.exists():
        return {"status": "INFO", "detail": f"no model manifest at {MANIFEST} — nothing to compare"}

    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    served = manifest.get("preprocessing")
    if not served:
        return {"status": "INFO", "detail": "manifest carries no preprocessing block"}

    checks = [
        ("resizeShortestSide", served.get("resizeShortestSide"), image_cfg["resize_shortest_side"]),
        ("centerCrop", served.get("centerCrop"), image_cfg["size"]),
        ("mean", served.get("mean"), image_cfg["mean"]),
        ("std", served.get("std"), image_cfg["std"]),
    ]

    mismatches = [
        f"{name}: service={service_value!r} training={training_value!r}"
        for name, service_value, training_value in checks
        if service_value != training_value
    ]

    if mismatches:
        return {
            "status": "FAIL",
            "detail": "training and service disagree - " + "; ".join(mismatches),
        }

    return {
        "status": "PASS",
        "detail": (
            f"resize={served['resizeShortestSide']} crop={served['centerCrop']} "
            f"mean/std match | full pixel-level parity still pending P4-6"
        ),
    }
