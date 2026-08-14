"""P4-5 — the evaluation battery (docs/ml/evaluation-plan.md).

    ml-service/training/.venv/python.exe scripts/ml/evaluate.py

Runs the five-part battery the plan specifies and writes every number to
`docs/ml/evaluation-results/`:

  1. Held-out test set (in-domain) - accuracy, per-class P/R/F1, macro-F1
     (primary), confusion matrix PNG, top-3.
  2. Field test (PlantDoc) - the same metrics. "the honest number; expected
     materially lower for PV-trained crops; published, not hidden."
  3. Calibration - ECE pre/post, reliability diagram, confidence histograms
     split by correctness.
  4. Crop-masked evaluation - metrics recomputed under declared-crop masking,
     the production condition. Both reported.
  5. Slice checks - per-crop macro-F1 and healthy-class recall, so no crop hides
     behind the average.

Then the ship-gates table, PASS/FAIL per gate, nothing suppressed. Two
mandatory disclosures from datasets/manifest.json are emitted whether or not
they are convenient: the RICE_NORMAL <-> RICE_BROWN_SPOT confusion cell, and the
chilli source-confound statement attached to the four affected chilli classes.

Nothing here re-fits anything. Temperature and thresholds are read from
`calibration.json` (P4-4); this script only measures.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, UTC
from pathlib import Path

import matplotlib

matplotlib.use("Agg")  # headless: this runs in a terminal, never a GUI session
import matplotlib.pyplot as plt
import torch
from sklearn.metrics import confusion_matrix, f1_score, precision_recall_fscore_support

REPO = Path(__file__).resolve().parents[2]
TRAINING = REPO / "ml-service" / "training"
sys.path.insert(0, str(TRAINING))

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

from inference import compute_logits, crop_class_indices, crop_of, load_config  # noqa: E402

RESULTS = REPO / "docs" / "ml" / "evaluation-results"

# Ship gates, verbatim from docs/ml/evaluation-plan.md.
GATE_VAL_MACRO_F1 = 0.85
GATE_HEALTHY_RECALL = 0.90
GATE_ECE = 0.05
GATE_PER_CROP_MACRO_F1 = 0.75


def macro_f1(targets, predictions, num_classes: int) -> float:
    """Macro-F1 over the FULL class set.

    `labels=range(num_classes)` matters: without it a class absent from the
    split is dropped from the average rather than counted, which silently turns
    macro-F1 over 35 classes into macro-F1 over however many appeared.
    """
    return float(
        f1_score(
            targets,
            predictions,
            average="macro",
            labels=list(range(num_classes)),
            zero_division=0,
        )
    )


def top_k_accuracy(logits: torch.Tensor, targets: torch.Tensor, k: int = 3) -> float:
    k = min(k, logits.size(1))
    hits = (logits.topk(k, dim=1).indices == targets.unsqueeze(1)).any(dim=1)
    return float(hits.float().mean())


def per_class_table(targets, predictions, classes: list[str]) -> list[dict]:
    precision, recall, f1, support = precision_recall_fscore_support(
        targets, predictions, labels=list(range(len(classes))), zero_division=0
    )
    return [
        {
            "class": classes[index],
            "precision": round(float(precision[index]), 4),
            "recall": round(float(recall[index]), 4),
            "f1": round(float(f1[index]), 4),
            "support": int(support[index]),
        }
        for index in range(len(classes))
    ]


def crop_masked_predictions(logits: torch.Tensor, targets: torch.Tensor, classes: list[str]):
    """Argmax restricted to the declared crop's classes.

    Production masks logits to the crop the FARMER declared. In evaluation the
    declared crop is taken from the true label's prefix, which is the closest
    honest stand-in: it models a farmer who correctly names their own crop. It
    does not model a farmer who names the wrong one — that is the crop-mismatch
    branch, not this metric.
    """
    groups = crop_class_indices(classes)
    predictions = torch.empty_like(targets)

    for position, target in enumerate(targets):
        allowed = groups[crop_of(classes[int(target)])]
        # Renormalisation cannot change an argmax, so masking alone suffices
        # here; the service renormalises because it reports the probability.
        restricted = logits[position, allowed]
        predictions[position] = allowed[int(restricted.argmax())]

    return predictions


def evaluate_split(bundle: dict, temperature: float, classes: list[str], label: str) -> dict:
    """Metrics for one split, unmasked and crop-masked."""
    logits = bundle["logits"]
    targets = bundle["targets"]
    calibrated = logits / temperature

    predictions = calibrated.argmax(dim=1)
    masked = crop_masked_predictions(calibrated, targets, classes)

    present = sorted({int(value) for value in targets})

    # Two macro-F1s, because one number cannot honestly serve both purposes.
    #
    # `macro_f1` averages over all 35 classes, which is the figure comparable to
    # the in-domain splits — but on the field test only 13 classes have any
    # support, so the other 22 score 0 and cap the achievable value near 13/35.
    # Quoting that alone would overstate the collapse.
    #
    # `macro_f1_present_classes` averages over the classes the split actually
    # contains, which is the meaningful measure of field performance — and
    # quoting THAT alone would understate the gap, since it silently narrows the
    # label space. Both are published; the README quotes both.
    def present_macro(values) -> float:
        return float(
            f1_score(targets.numpy(), values.numpy(), average="macro", labels=present, zero_division=0)
        )

    return {
        "split": label,
        "samples": len(targets),
        "classes_present": len(present),
        "classes_total": len(classes),
        "unmasked": {
            "accuracy": round(float((predictions == targets).float().mean()), 4),
            "macro_f1": round(macro_f1(targets.numpy(), predictions.numpy(), len(classes)), 4),
            "macro_f1_present_classes": round(present_macro(predictions), 4),
            "top3_accuracy": round(top_k_accuracy(calibrated, targets), 4),
        },
        "crop_masked": {
            "accuracy": round(float((masked == targets).float().mean()), 4),
            "macro_f1": round(macro_f1(targets.numpy(), masked.numpy(), len(classes)), 4),
            "macro_f1_present_classes": round(present_macro(masked), 4),
        },
        "per_class": per_class_table(targets.numpy(), predictions.numpy(), classes),
        "per_class_masked": per_class_table(targets.numpy(), masked.numpy(), classes),
        "_predictions": predictions,
        "_masked": masked,
        "_targets": targets,
        "_calibrated": calibrated,
    }


def per_crop_slice(targets, predictions, classes: list[str]) -> list[dict]:
    """Macro-F1 within each crop. No crop hides behind the overall average."""
    groups = crop_class_indices(classes)
    rows = []

    for crop, indices in sorted(groups.items()):
        index_set = set(indices)
        mask = torch.tensor([int(value) in index_set for value in targets], dtype=torch.bool)
        if not bool(mask.any()):
            rows.append({"crop": crop, "samples": 0, "macro_f1": None, "accuracy": None})
            continue

        crop_targets = targets[mask].numpy()
        crop_predictions = predictions[mask].numpy()
        rows.append(
            {
                "crop": crop,
                "samples": int(mask.sum()),
                "macro_f1": round(
                    float(
                        f1_score(
                            crop_targets,
                            crop_predictions,
                            average="macro",
                            labels=indices,
                            zero_division=0,
                        )
                    ),
                    4,
                ),
                "accuracy": round(float((crop_targets == crop_predictions).mean()), 4),
            }
        )

    return rows


def healthy_recall_slice(
    calibrated: torch.Tensor,
    targets: torch.Tensor,
    predictions: torch.Tensor,
    classes: list[str],
    tau_healthy: float,
) -> dict:
    """Recall of each healthy class under the tau_healthy acceptance rule.

    The gate is "healthy-class recall >= 0.90 @tau_healthy", so acceptance is
    part of the metric: a healthy prediction the policy would reject is not a
    recovered healthy sample.
    """
    healthy = [index for index, code in enumerate(classes) if code.endswith("_HEALTHY") or code == "RICE_NORMAL"]
    probabilities = calibrated.softmax(dim=1)
    healthy_mass = probabilities[:, healthy].sum(dim=1)
    accepted = healthy_mass >= tau_healthy

    rows = []
    for index in healthy:
        is_true = targets == index
        support = int(is_true.sum())
        if support == 0:
            rows.append({"class": classes[index], "support": 0, "recall_at_tau_healthy": None})
            continue
        recovered = int(((predictions == index) & is_true & accepted).sum())
        rows.append(
            {
                "class": classes[index],
                "support": support,
                "recall_at_tau_healthy": round(recovered / support, 4),
            }
        )

    measured = [row["recall_at_tau_healthy"] for row in rows if row["recall_at_tau_healthy"] is not None]
    return {
        "tau_healthy": tau_healthy,
        "per_class": rows,
        "macro_recall": round(sum(measured) / len(measured), 4) if measured else None,
        "min_recall": round(min(measured), 4) if measured else None,
    }


def confusion_cell(targets, predictions, classes: list[str], a: str, b: str) -> dict:
    """One directed confusion pair, both directions, as counts and rates."""
    index_a, index_b = classes.index(a), classes.index(b)
    a_true = targets == index_a
    b_true = targets == index_b

    return {
        "pair": [a, b],
        f"{a}_support": int(a_true.sum()),
        f"{b}_support": int(b_true.sum()),
        f"{a}_predicted_as_{b}": int(((predictions == index_b) & a_true).sum()),
        f"{b}_predicted_as_{a}": int(((predictions == index_a) & b_true).sum()),
        f"{a}_recall": round(float(((predictions == index_a) & a_true).sum() / max(int(a_true.sum()), 1)), 4),
        f"{b}_recall": round(float(((predictions == index_b) & b_true).sum() / max(int(b_true.sum()), 1)), 4),
    }


def render_confusion(targets, predictions, classes: list[str], path: Path, title: str) -> None:
    matrix = confusion_matrix(targets, predictions, labels=list(range(len(classes))))
    normalised = matrix.astype(float) / matrix.sum(axis=1, keepdims=True).clip(min=1)

    figure, axes = plt.subplots(figsize=(14, 12))
    image = axes.imshow(normalised, cmap="viridis", vmin=0, vmax=1)
    axes.set_xticks(range(len(classes)))
    axes.set_yticks(range(len(classes)))
    axes.set_xticklabels(classes, rotation=90, fontsize=6)
    axes.set_yticklabels(classes, fontsize=6)
    axes.set_xlabel("predicted")
    axes.set_ylabel("true")
    axes.set_title(title)
    figure.colorbar(image, ax=axes, fraction=0.046, label="row-normalised rate")
    figure.tight_layout()
    figure.savefig(path, dpi=140)
    plt.close(figure)


def render_reliability(calibration: dict, path: Path) -> None:
    bins = calibration["reliabilityBins"]
    accuracies = [entry["accuracy"] for entry in bins]
    confidences = [entry["confidence"] for entry in bins]

    figure, axes = plt.subplots(figsize=(6, 6))
    axes.plot([0, 1], [0, 1], "--", color="grey", label="perfect calibration")
    axes.plot(confidences, accuracies, "o-", label="post-temperature")
    axes.set_xlabel("confidence")
    axes.set_ylabel("accuracy")
    axes.set_title(
        f"Reliability (val) - ECE {calibration['ece']['before']:.4f} -> {calibration['ece']['after']:.4f}"
    )
    axes.legend()
    axes.grid(alpha=0.3)
    figure.tight_layout()
    figure.savefig(path, dpi=140)
    plt.close(figure)


def render_confidence_histograms(calibrated: torch.Tensor, targets, predictions, path: Path) -> None:
    probabilities = calibrated.softmax(dim=1)
    confidence = probabilities.max(dim=1).values
    correct = predictions == targets

    figure, axes = plt.subplots(figsize=(7, 4.5))
    axes.hist(confidence[correct].numpy(), bins=40, alpha=0.65, label="correct")
    axes.hist(confidence[~correct].numpy(), bins=40, alpha=0.65, label="wrong")
    axes.set_xlabel("max calibrated probability")
    axes.set_ylabel("count")
    axes.set_yscale("log")
    axes.set_title("Confidence by correctness (test)")
    axes.legend()
    figure.tight_layout()
    figure.savefig(path, dpi=140)
    plt.close(figure)


def main() -> int:
    parser = argparse.ArgumentParser(description="P4-5 evaluation battery.")
    parser.add_argument("--checkpoint", default="ml-service/training/checkpoints/run2/best.pt")
    parser.add_argument("--calibration", default="ml-service/training/calibration.json")
    args = parser.parse_args()

    checkpoint = (REPO / args.checkpoint).resolve()
    calibration_path = (REPO / args.calibration).resolve()

    for path in (checkpoint, calibration_path):
        if not path.exists():
            print(f"missing required input: {path}", file=sys.stderr)
            return 2

    calibration = json.loads(calibration_path.read_text(encoding="utf-8"))
    temperature = calibration["temperature"]
    tau = calibration["thresholds"]["tau"]
    tau_healthy = calibration["thresholds"]["tauHealthy"]

    config = load_config(TRAINING / "config.yaml")
    RESULTS.mkdir(parents=True, exist_ok=True)

    print(f"== P4-5 evaluation battery | T={temperature:.4f} tau={tau} tau_healthy={tau_healthy}")

    manifest = json.loads((REPO / "datasets" / "manifest.json").read_text(encoding="utf-8"))

    splits = {}
    for split in ("val", "test", "fieldtest"):
        bundle = compute_logits(checkpoint, split, config=config, on_log=print)
        splits[split] = bundle
    classes = splits["val"]["classes"]

    # ── 1/2/4. Per-split metrics, unmasked and crop-masked ───────────────────
    results = {
        name: evaluate_split(bundle, temperature, classes, name) for name, bundle in splits.items()
    }

    for name, result in results.items():
        print(
            f"   {name:10s} n={result['samples']:>5} "
            f"acc={result['unmasked']['accuracy']:.4f} "
            f"macroF1={result['unmasked']['macro_f1']:.4f} "
            f"(present-classes {result['unmasked']['macro_f1_present_classes']:.4f}) "
            f"top3={result['unmasked']['top3_accuracy']:.4f} "
            f"| masked acc={result['crop_masked']['accuracy']:.4f} "
            f"macroF1={result['crop_masked']['macro_f1']:.4f}"
        )

    # ── 5. Slices ────────────────────────────────────────────────────────────
    test = results["test"]
    val = results["val"]

    per_crop_test = per_crop_slice(test["_targets"], test["_predictions"], classes)
    per_crop_field = per_crop_slice(
        results["fieldtest"]["_targets"], results["fieldtest"]["_predictions"], classes
    )
    healthy_val = healthy_recall_slice(
        val["_calibrated"], val["_targets"], val["_predictions"], classes, tau_healthy
    )
    healthy_test = healthy_recall_slice(
        test["_calibrated"], test["_targets"], test["_predictions"], classes, tau_healthy
    )

    # ── Mandatory confound disclosures ───────────────────────────────────────
    rice_cell_test = confusion_cell(
        test["_targets"], test["_predictions"], classes, "RICE_NORMAL", "RICE_BROWN_SPOT"
    )
    rice_cell_val = confusion_cell(
        val["_targets"], val["_predictions"], classes, "RICE_NORMAL", "RICE_BROWN_SPOT"
    )

    chilli_affected = [
        "CHILLI_ANTHRACNOSE",
        "CHILLI_BACTERIAL_SPOT",
        "CHILLI_NUTRIENT_DEFICIENCY",
        "CHILLI_POWDERY_MILDEW",
    ]
    chilli_rows = [row for row in test["per_class"] if row["class"] in chilli_affected]

    # ── Ship gates ───────────────────────────────────────────────────────────
    per_crop_failures = [
        row
        for row in per_crop_test
        if row["macro_f1"] is not None and row["macro_f1"] < GATE_PER_CROP_MACRO_F1
    ]

    gates = [
        {
            "gate": "val macro-F1 >= 0.85 (in-domain)",
            "measured": val["unmasked"]["macro_f1"],
            "threshold": GATE_VAL_MACRO_F1,
            "passed": val["unmasked"]["macro_f1"] >= GATE_VAL_MACRO_F1,
        },
        {
            "gate": "healthy-class recall >= 0.90 @tau_healthy (val)",
            "measured": healthy_val["min_recall"],
            "threshold": GATE_HEALTHY_RECALL,
            "passed": healthy_val["min_recall"] is not None
            and healthy_val["min_recall"] >= GATE_HEALTHY_RECALL,
            "note": "min across healthy classes - the weakest class is the gate, not the average",
        },
        {
            "gate": "calibration ECE <= 0.05 post-scaling (val)",
            "measured": calibration["ece"]["after"],
            "threshold": GATE_ECE,
            "passed": calibration["ece"]["after"] <= GATE_ECE,
        },
        {
            "gate": "per-crop macro-F1 >= 0.75 (test), else demote that crop to GENERAL",
            "measured": min(
                (row["macro_f1"] for row in per_crop_test if row["macro_f1"] is not None),
                default=None,
            ),
            "threshold": GATE_PER_CROP_MACRO_F1,
            "passed": not per_crop_failures,
            "note": (
                "crops below the gate: "
                + (", ".join(f"{row['crop']}={row['macro_f1']}" for row in per_crop_failures) or "none")
            ),
        },
        {
            "gate": "field-test macro-F1 reported (honesty gate - no numeric threshold)",
            "measured": results["fieldtest"]["unmasked"]["macro_f1"],
            "threshold": None,
            "passed": results["fieldtest"]["unmasked"]["macro_f1"] is not None,
            "measuredPresentClasses": results["fieldtest"]["unmasked"]["macro_f1_present_classes"],
            "measuredAccuracy": results["fieldtest"]["unmasked"]["accuracy"],
            "measuredCropMaskedAccuracy": results["fieldtest"]["crop_masked"]["accuracy"],
            "note": (
                "the number must appear in the README; it is not gated on a value. "
                "Reported over all 35 classes AND over the 13 with field-test support, "
                "because only 13 are represented in PlantDoc."
            ),
        },
    ]

    print()
    for gate in gates:
        print(f"   [{'PASS' if gate['passed'] else 'FAIL'}] {gate['gate']} -> {gate['measured']}")

    # ── Figures ──────────────────────────────────────────────────────────────
    render_confusion(
        test["_targets"].numpy(), test["_predictions"].numpy(), classes,
        RESULTS / "confusion-test.png", "Test confusion (row-normalised)",
    )
    render_confusion(
        results["fieldtest"]["_targets"].numpy(), results["fieldtest"]["_predictions"].numpy(), classes,
        RESULTS / "confusion-fieldtest.png", "Field-test (PlantDoc) confusion (row-normalised)",
    )
    render_reliability(calibration, RESULTS / "reliability-val.png")
    render_confidence_histograms(
        test["_calibrated"], test["_targets"], test["_predictions"],
        RESULTS / "confidence-histogram-test.png",
    )

    # ── Persist ──────────────────────────────────────────────────────────────
    payload = {
        "todo": "P4-5",
        "generatedAt": datetime.now(UTC).isoformat(timespec="seconds"),
        "checkpoint": str(checkpoint.relative_to(REPO)).replace("\\", "/"),
        "checkpointSha256_16": splits["val"]["checkpoint_sha256_16"],
        "datasetManifestClasses": len(classes),
        "calibration": {
            "temperature": temperature,
            "tau": tau,
            "tauHealthy": tau_healthy,
            "marginGuard": calibration["thresholds"]["marginGuard"],
            "ece": calibration["ece"],
            "criteriaBinding": calibration.get("criteriaBinding"),
        },
        "splits": {
            name: {key: value for key, value in result.items() if not key.startswith("_")}
            for name, result in results.items()
        },
        "perCrop": {"test": per_crop_test, "fieldtest": per_crop_field},
        "healthyRecall": {"val": healthy_val, "test": healthy_test},
        "shipGates": gates,
        "mandatoryDisclosures": {
            "riceNormalVsBrownSpot": {
                "requirement": next(
                    gate["evaluation_gate"]
                    for gate in manifest["known_confounds"]
                    if gate["id"] == "rice_healthy_brownspot_source_disjoint"
                ),
                "test": rice_cell_test,
                "val": rice_cell_val,
            },
            "chilliSourceConfound": {
                "requirement": next(
                    gate["evaluation_gate"]
                    for gate in manifest["known_confounds"]
                    if gate["id"] == "chilli_source_disjoint_classes"
                ),
                "affectedClasses": chilli_affected,
                "testMetrics": chilli_rows,
                "statement": (
                    "CHILLI_ANTHRACNOSE exists only in chilli_secondary; CHILLI_BACTERIAL_SPOT, "
                    "CHILLI_NUTRIENT_DEFICIENCY and CHILLI_POWDERY_MILDEW only in chilli_primary, "
                    "and the two sources are separable at 0.91 from a single background statistic. "
                    "These four numbers are therefore NOT evidence of disease-discrimination "
                    "ability. The Grad-CAM probe (P4-8) is required before any chilli accuracy "
                    "figure is published."
                ),
            },
        },
        "knownLimitations": manifest["known_limitations"],
    }

    output = RESULTS / "evaluation.json"
    output.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"\n   wrote {output.relative_to(REPO)} + 4 figures")

    return 0 if all(gate["passed"] for gate in gates) else 1


if __name__ == "__main__":
    sys.exit(main())
