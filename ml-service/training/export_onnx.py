"""P4-6 — ONNX export, golden-image parity gate, and the real model manifest.

    python export_onnx.py --checkpoint checkpoints/run2/best.pt --version 1.0

Three things, in order, and the export is only published if the middle one
passes:

  1. **Export** the trained candidate to ONNX **opset 17**
     (docs/ml/model-selection.md), with a dynamic batch axis so the service can
     batch later without re-exporting.
  2. **Golden parity** — 100 fixed images through PyTorch and onnxruntime;
     `max |Δprob|` must be **< 1e-3**. The gate is the point of the step, so a
     failure writes no manifest and returns non-zero. Parity is never claimed
     without the number.
  3. **Manifest** — the existing `model/model-manifest.json` is *mutated*, not
     regenerated: it carries the class contract, crop grouping, confound gates
     and known limitations that `scripts/generate_model_manifest.py` derived from
     `datasets/manifest.json`, and rewriting it from scratch here would risk
     dropping one. Only the measured fields change.

Version naming follows docs/ml/model-versioning.md: `model-v{major}.{minor}`,
major = class-set change, minor = retrain on the same classes. The first real
model is v1.0 — the stub was `stub-0.0.0-untrained` precisely so it could never
be mistaken for one.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from collections import defaultdict
from datetime import datetime, UTC
from pathlib import Path

import torch

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
sys.path.insert(0, str(HERE))

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

from data import build_transforms, read_split  # noqa: E402
from inference import load_candidate, load_config  # noqa: E402

MODEL_DIR = REPO / "ml-service" / "model"
RESULTS = REPO / "docs" / "ml" / "evaluation-results"

OPSET = 17  # docs/ml/model-selection.md
GOLDEN_IMAGES = 100  # docs/ml/model-selection.md: "100 golden images"
PARITY_TOLERANCE = 1e-3  # "|Δprob| < 1e-3"


def golden_samples(config: dict, classes: list[str], count: int) -> list:
    """A fixed, reproducible set spanning as many classes as possible.

    Deterministic by construction rather than by seed: samples are sorted by
    path and drawn round-robin across classes, so the same corpus always yields
    the same golden set and the parity number is comparable between runs.
    """
    class_to_index = {code: index for index, code in enumerate(classes)}
    samples = read_split(
        REPO / config["data"]["splits_dir"],
        REPO / config["data"]["raw_dir"],
        "test",
        class_to_index,
    )

    by_class: dict[int, list] = defaultdict(list)
    for sample in sorted(samples, key=lambda item: str(item.path)):
        by_class[sample.label].append(sample)

    selected: list = []
    position = 0
    while len(selected) < count:
        added = False
        for label in sorted(by_class):
            bucket = by_class[label]
            if position < len(bucket):
                selected.append(bucket[position])
                added = True
                if len(selected) == count:
                    break
        if not added:  # exhausted every class
            break
        position += 1

    return selected


def main() -> int:
    parser = argparse.ArgumentParser(description="P4-6 ONNX export + parity gate.")
    parser.add_argument("--checkpoint", default="checkpoints/run2/best.pt")
    parser.add_argument("--calibration", default="calibration.json")
    parser.add_argument("--evaluation", default="../../docs/ml/evaluation-results/evaluation.json")
    parser.add_argument("--version", default="1.0", help="model-v<major>.<minor>")
    args = parser.parse_args()

    checkpoint = (HERE / args.checkpoint).resolve()
    calibration_path = (HERE / args.calibration).resolve()
    evaluation_path = (HERE / args.evaluation).resolve()

    for path in (checkpoint, calibration_path, evaluation_path):
        if not path.exists():
            print(f"missing required input: {path}", file=sys.stderr)
            return 2

    calibration = json.loads(calibration_path.read_text(encoding="utf-8"))
    evaluation = json.loads(evaluation_path.read_text(encoding="utf-8"))
    config = load_config()

    model_version = f"model-v{args.version}"
    artifact = MODEL_DIR / f"{model_version}.onnx"
    device = torch.device("cpu")  # export and parity both run on CPU, as the service does

    print(f"== P4-6 export | {model_version}")

    model, classes, state = load_candidate(checkpoint, device)
    size = config["image"]["size"]

    # ── 1. Export ────────────────────────────────────────────────────────────
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    example = torch.zeros(1, 3, size, size)

    torch.onnx.export(
        model,
        (example,),
        str(artifact),
        input_names=["input"],
        output_names=["logits"],
        # Batch is dynamic so the service can batch without a re-export; the
        # spatial dims are fixed because the preprocessing contract fixes them.
        dynamic_axes={"input": {0: "batch"}, "logits": {0: "batch"}},
        opset_version=OPSET,
        do_constant_folding=True,
        dynamo=False,
    )
    print(f"   exported {artifact.relative_to(REPO)} ({artifact.stat().st_size / 1024**2:.1f}MB, opset {OPSET})")

    # ── 2. Golden parity ─────────────────────────────────────────────────────
    import onnxruntime

    session = onnxruntime.InferenceSession(str(artifact), providers=["CPUExecutionProvider"])
    _, eval_transform = build_transforms(config["image"], config["augment"], size)
    from PIL import Image

    samples = golden_samples(config, classes, GOLDEN_IMAGES)
    print(f"   golden set: {len(samples)} images spanning {len({sample.label for sample in samples})} classes")

    model.eval()
    deltas: list[float] = []
    argmax_mismatches = 0

    with torch.no_grad():
        for sample in samples:
            with Image.open(sample.path) as raw:
                tensor = eval_transform(raw.convert("RGB")).unsqueeze(0)

            torch_probabilities = model(tensor).softmax(dim=1)[0]
            onnx_logits = session.run(["logits"], {"input": tensor.numpy()})[0]
            onnx_probabilities = torch.from_numpy(onnx_logits).softmax(dim=1)[0]

            deltas.append(float((torch_probabilities - onnx_probabilities).abs().max()))
            if int(torch_probabilities.argmax()) != int(onnx_probabilities.argmax()):
                argmax_mismatches += 1

    max_delta = max(deltas)
    mean_delta = sum(deltas) / len(deltas)
    parity_passed = max_delta < PARITY_TOLERANCE and argmax_mismatches == 0

    print(
        f"   parity: max|dprob| {max_delta:.3e} (tolerance {PARITY_TOLERANCE:.0e}), "
        f"mean {mean_delta:.3e}, argmax mismatches {argmax_mismatches}"
    )
    print(f"   parity gate: {'PASS' if parity_passed else 'FAIL'}")

    parity_record = {
        "todo": "P4-6",
        "generatedAt": datetime.now(UTC).isoformat(timespec="seconds"),
        "modelVersion": model_version,
        "artifact": str(artifact.relative_to(REPO)).replace("\\", "/"),
        "opset": OPSET,
        "goldenImages": len(samples),
        "classesSpanned": len({sample.label for sample in samples}),
        "maxAbsProbDelta": max_delta,
        "meanAbsProbDelta": mean_delta,
        "argmaxMismatches": argmax_mismatches,
        "tolerance": PARITY_TOLERANCE,
        "passed": parity_passed,
        "runtime": f"onnxruntime {onnxruntime.__version__} CPUExecutionProvider",
    }
    RESULTS.mkdir(parents=True, exist_ok=True)
    (RESULTS / "onnx-parity.json").write_text(json.dumps(parity_record, indent=2) + "\n", encoding="utf-8")

    if not parity_passed:
        # No manifest, and the artifact is left in place for inspection but is
        # not wired in. Claiming parity that was not measured would be the exact
        # fabricated-verification CLAUDE.md rule 7 forbids.
        print("   parity FAILED — manifest not written, artifact not published", file=sys.stderr)
        return 1

    # ── 3. Manifest ──────────────────────────────────────────────────────────
    manifest_path = MODEL_DIR / "model-manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    if list(manifest["classes"]) != list(classes):
        print(
            "   class order in the manifest differs from the checkpoint — refusing to write",
            file=sys.stderr,
        )
        return 1

    config_hash = hashlib.sha256((HERE / "config.yaml").read_bytes()).hexdigest()
    dataset_hash = hashlib.sha256((REPO / config["data"]["manifest"]).read_bytes()).hexdigest()

    val = evaluation["splits"]["val"]
    test = evaluation["splits"]["test"]
    field = evaluation["splits"]["fieldtest"]

    manifest.update(
        {
            "modelVersion": model_version,
            "modelFile": artifact.name,
            "trained": True,
            "calibrated": bool(calibration["calibrated"]),
            "provisional": False,
            "generatedAt": datetime.now(UTC).isoformat(timespec="seconds"),
            "generatedBy": "ml-service/training/export_onnx.py (P4-6)",
            "classOrder": "sorted-ascending-by-code (authoritative: this list)",
            "architecture": state["arch"],
            "opset": OPSET,
            "trainingConfigSha256": config_hash,
            "datasetManifestSha256": dataset_hash,
            "checkpointSha256_16": hashlib.sha256(checkpoint.read_bytes()).hexdigest()[:16],
            "inference": {
                "temperature": calibration["temperature"],
                "thresholds": {
                    "tau": calibration["thresholds"]["tau"],
                    "tauHealthy": calibration["thresholds"]["tauHealthy"],
                    "marginGuard": calibration["thresholds"]["marginGuard"],
                    # Not derived by P4-4 — it belongs to the crop-mismatch
                    # branch, not the acceptance policy, and no doc publishes a
                    # derivation for it. Carried forward unchanged and still
                    # marked as the structural choice it was.
                    "cropMaskFloor": manifest["inference"]["thresholds"]["cropMaskFloor"],
                },
            },
            "metrics": {
                "val": {
                    "macroF1": val["unmasked"]["macro_f1"],
                    "accuracy": val["unmasked"]["accuracy"],
                    "macroF1CropMasked": val["crop_masked"]["macro_f1"],
                    "eceAfterScaling": calibration["ece"]["after"],
                },
                "test": {
                    "macroF1": test["unmasked"]["macro_f1"],
                    "accuracy": test["unmasked"]["accuracy"],
                    "macroF1CropMasked": test["crop_masked"]["macro_f1"],
                    "top3Accuracy": test["unmasked"]["top3_accuracy"],
                },
                "field": {
                    "source": "PlantDoc (held out entirely from training)",
                    "macroF1AllClasses": field["unmasked"]["macro_f1"],
                    "macroF1PresentClasses": field["unmasked"]["macro_f1_present_classes"],
                    "accuracy": field["unmasked"]["accuracy"],
                    "accuracyCropMasked": field["crop_masked"]["accuracy"],
                    "classesPresent": field["classes_present"],
                    "classesTotal": field["classes_total"],
                    "honestyNote": (
                        "Field performance is far below in-domain performance. This number is "
                        "published, not hidden (docs/ml/evaluation-plan.md)."
                    ),
                },
            },
            "calibrationNote": calibration.get("criteriaBinding", {}).get("note"),
        }
    )

    # The placeholder block described values that no longer exist. Leaving it
    # would leave the artefact describing itself as provisional after it stopped
    # being provisional.
    manifest.pop("placeholders", None)

    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"   wrote {manifest_path.relative_to(REPO)} ({model_version}, calibrated={manifest['calibrated']})")
    print(f"   wrote {(RESULTS / 'onnx-parity.json').relative_to(REPO)}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
