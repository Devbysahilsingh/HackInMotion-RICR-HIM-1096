"""Regenerate ml-service/model/model-manifest.json from datasets/manifest.json.

Why this script exists: the class contract is the one thing that must never drift
between the dataset that trained the model and the service that serves it. Hand-
maintaining a 35-entry list in Python would guarantee it eventually diverges, so
the list is *derived* and the derivation is re-runnable and diffable in review.

Run from anywhere:  python ml-service/scripts/generate_model_manifest.py [--check]

--check exits non-zero if the committed manifest is stale (CI/pre-commit use).

IMPORTANT: every number under `inference` is a PLACEHOLDER. Temperature and the
acceptance thresholds come from validation curves that do not exist until the
training run happens (docs/ml/confidence-strategy.md). The only threshold here
that is actually specified by the docs is the 0.15 margin guard.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from datetime import datetime, UTC
from pathlib import Path
from typing import Any

# The service is the consumer, the dataset manifest is the source.
SERVICE_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = SERVICE_DIR.parent
DATASET_MANIFEST = REPO_ROOT / "datasets" / "manifest.json"
OUTPUT = SERVICE_DIR / "model" / "model-manifest.json"

# ImageNet statistics. These must be byte-identical to the training transform;
# the training config is the authority once it exists, and the golden-image
# parity test (docs/ml/inference-architecture.md) is what proves they match.
IMAGENET_MEAN = [0.485, 0.456, 0.406]
IMAGENET_STD = [0.229, 0.224, 0.225]

# Suffixes that mark a "nothing wrong with this plant" class. Derived from the
# class codes themselves, not from agronomic judgement: RICE_NORMAL is the one
# class that does not use the _HEALTHY suffix, which is exactly why a hardcoded
# endswith("_HEALTHY") check in application code would have been a latent bug.
HEALTHY_SUFFIXES = ("HEALTHY", "NORMAL")


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


def build_manifest(dataset: dict[str, Any], dataset_sha256: str) -> dict[str, Any]:
    classes = sorted(dataset["classes"].keys())
    if not classes:
        raise SystemExit("datasets/manifest.json has no classes — refusing to emit an empty contract")

    healthy = [code for code in classes if code.rsplit("_", 1)[-1] in HEALTHY_SUFFIXES]

    # Crop code = the first token of the class code. This is a structural fact
    # about the codes, not an agronomic mapping, so it cannot invent anything.
    crops: dict[str, list[str]] = {}
    for code in classes:
        crops.setdefault(code.split("_", 1)[0], []).append(code)

    return {
        "schemaVersion": 1,
        "generatedAt": datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "generatedBy": "ml-service/scripts/generate_model_manifest.py",
        # ── Model identity ────────────────────────────────────────────────
        # No model has been trained. This version string is what /healthz and
        # every prediction report until a real artifact replaces it, and it is
        # deliberately named so that a stub answer can never be mistaken for a
        # trained one in a log, a database row, or a demo.
        "modelVersion": "stub-0.0.0-untrained",
        "modelFile": None,
        "trained": False,
        "calibrated": False,
        "provisional": True,
        "datasetManifest": {
            "path": "datasets/manifest.json",
            "sha256": dataset_sha256,
            "schemaVersion": dataset.get("schema_version"),
            "generatedAt": dataset.get("generated_at"),
        },
        # ── Preprocessing contract ────────────────────────────────────────
        "preprocessing": {
            "resizeShortestSide": 256,
            "centerCrop": 224,
            "colorSpace": "RGB",
            "exifNormalize": True,
            "interpolation": "bilinear",
            "mean": IMAGENET_MEAN,
            "std": IMAGENET_STD,
            "note": (
                "Must be byte-identical to the training transform. Unverified "
                "until the golden-image parity test runs against real training code."
            ),
        },
        # ── Inference / threshold policy ──────────────────────────────────
        "inference": {
            "temperature": 1.0,
            "thresholds": {
                "tau": 0.75,
                "tauHealthy": 0.85,
                "marginGuard": 0.15,
                "cropMaskFloor": 0.01,
            },
        },
        "placeholders": {
            "temperature": (
                "PLACEHOLDER 1.0 = no calibration applied. Real T comes from LBFGS on "
                "validation NLL (docs/ml/confidence-strategy.md). 1.0 is the identity, "
                "chosen so the stub cannot pretend to be calibrated."
            ),
            "thresholds.tau": (
                "PLACEHOLDER. Real tau is the precision-coverage point where val "
                "precision-of-accepted >= 0.90. The docs note an EXPECTED neighborhood "
                "of 0.70-0.80; 0.75 is the midpoint of that expectation and is NOT a "
                "measured value."
            ),
            "thresholds.tauHealthy": (
                "PLACEHOLDER. Real tau_healthy is set where the false-negative-disease "
                "rate among accepted-healthy is <= 5% on val. 0.85 is only 'stricter "
                "than tau', which is the sole property the docs actually pin down."
            ),
            "thresholds.marginGuard": (
                "NOT a placeholder. 0.15 is specified verbatim in docs/ml/confidence-strategy.md."
            ),
            "thresholds.cropMaskFloor": (
                "PLACEHOLDER. The docs say 'a small floor' without a number. 0.01 is a "
                "provisional reading of 'small', constrained by one structural fact: it "
                "must sit BELOW the uniform probability 1/35 = 0.0286, otherwise a "
                "genuinely diffuse prediction would be reported as a wrong-crop photo "
                "instead of as low confidence. Must be set from the crop-mismatch "
                "evaluation fixtures once they exist."
            ),
            "classOrder": (
                "PLACEHOLDER ORDERING. Sorted ascending by class code. The trained "
                "model's output index order is authoritative and MUST overwrite this "
                "list at export time — a silent mismatch here mislabels every "
                "prediction while looking perfectly healthy."
            ),
        },
        # ── Class contract ────────────────────────────────────────────────
        "classOrder": "sorted-ascending-by-code",
        "classes": classes,
        "healthyClasses": healthy,
        "crops": crops,
        # ── Honesty payload, copied verbatim from the dataset manifest ────
        # Copied rather than summarised: a paraphrase of a limitation is how a
        # limitation quietly stops being one.
        "knownLimitations": dataset.get("known_limitations", []),
        "supportTiers": dataset.get("support_tiers", {}),
        "confoundEvaluationGates": [
            {
                "id": confound.get("id"),
                "crop": confound.get("crop"),
                "evaluationGate": confound.get("evaluation_gate"),
                "residualRisk": confound.get("residual_risk"),
            }
            for confound in dataset.get("known_confounds", [])
        ],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="exit 1 if the committed manifest differs from a fresh generation",
    )
    args = parser.parse_args()

    if not DATASET_MANIFEST.exists():
        print(f"error: {DATASET_MANIFEST} not found", file=sys.stderr)
        return 2

    dataset = json.loads(DATASET_MANIFEST.read_text(encoding="utf-8"))
    fresh = build_manifest(dataset, sha256_of(DATASET_MANIFEST))

    if args.check:
        if not OUTPUT.exists():
            print(f"error: {OUTPUT} is missing — run this script without --check", file=sys.stderr)
            return 1
        current = json.loads(OUTPUT.read_text(encoding="utf-8"))

        # Only the CLASS CONTRACT is compared, because that is the only thing
        # this generator owns and the only drift it exists to catch.
        #
        # Once a model is trained, `export_onnx.py` legitimately rewrites the
        # model-describing half of the same file — modelVersion, trained,
        # calibrated, the measured temperature and thresholds, the metrics
        # block. Comparing the whole document would then report "stale" forever
        # and the guard would be trained out of the build rather than fixed,
        # taking the real contract check with it.
        contract_keys = (
            "schemaVersion",
            "classes",
            "healthyClasses",
            "crops",
            "datasetManifest",
            "preprocessing",
            "supportTiers",
            "knownLimitations",
            "confoundEvaluationGates",
        )
        drifted = [key for key in contract_keys if current.get(key) != fresh.get(key)]
        if drifted:
            print(
                "error: model-manifest.json class contract is stale relative to "
                f"datasets/manifest.json (fields: {', '.join(drifted)})",
                file=sys.stderr,
            )
            return 1
        print("model-manifest.json is up to date")
        return 0

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(fresh, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {OUTPUT} ({len(fresh['classes'])} classes, {len(fresh['crops'])} crops)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
