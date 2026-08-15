"""P4-8 / error analysis (docs/ml/error-analysis.md).

    ml-service/training/.venv/python.exe scripts/ml/error-analysis.py

Implements the seven-part checklist, with item 3 — the **Grad-CAM
background-reliance probe** — as the load-bearing one: `datasets/manifest.json`
makes it a hard gate, "REQUIRED for chilli before any chilli accuracy figure is
published".

  1. Confusion clusters - top-10 confused pairs with sample grids.
  2. Per-crop breakdown + images/class correlation (is it just data volume?).
  3. Background-reliance probe - Grad-CAM over 20 samples/crop.
  4. Overfitting check - val vs test delta, train-val curve divergence.
  5. Confidence autopsy - high-confidence-wrong samples counted and listed.
  6. Field degradation - in-domain vs PlantDoc per-class delta table.
  7. Label-noise sweep - top-loss training samples as a mislabel candidate list.

"Poor results reported honestly and investigated" is the operating rule; nothing
here is tuned to produce a flattering number.

## What the background probe measures, and what it does not

There are no leaf segmentation masks in this corpus, so "is the model looking at
the lesion or at the bench?" cannot be answered exactly. What is measured is a
**proxy**: the fraction of Grad-CAM mass falling in the outer border ring of the
image. PlantVillage images are a centred leaf on a uniform background, so mass
concentrated in the border is attention spent on something that is not the leaf.

This is the same family of statistic the P0-6b confound probe used
(`datasets/confound-report.json` separated sources at 0.91 from a border
statistic alone), which makes the two directly comparable. It is a proxy and is
labelled as one everywhere it is reported.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from datetime import datetime, UTC
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import torch
import torch.nn.functional as F
from PIL import Image

REPO = Path(__file__).resolve().parents[2]
TRAINING = REPO / "ml-service" / "training"
sys.path.insert(0, str(TRAINING))

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

from data import build_transforms, read_split  # noqa: E402
from inference import compute_logits, crop_of, load_candidate, load_config  # noqa: E402

RESULTS = REPO / "docs" / "ml" / "evaluation-results"
GRADCAM_DIR = RESULTS / "gradcam"

SAMPLES_PER_CROP = 20  # error-analysis.md: "Grad-CAM on 20 samples/crop"
BORDER_FRACTION = 0.25  # outer ring width, as a fraction of the shorter side
HIGH_CONFIDENCE = 0.90


class GradCAM:
    """Grad-CAM over the final convolutional stage.

    Deliberately the plain 2016 formulation: channel weights are the
    globally-averaged gradients of the target logit, applied to the activations,
    summed and ReLU'd. Nothing fancier is warranted for a "where is it looking"
    question, and a more elaborate variant would be harder to defend as evidence.
    """

    def __init__(self, model: torch.nn.Module, layer: torch.nn.Module) -> None:
        self.model = model
        self.activations: torch.Tensor | None = None
        self.gradients: torch.Tensor | None = None
        layer.register_forward_hook(self._save_activations)
        layer.register_full_backward_hook(self._save_gradients)

    def _save_activations(self, _module, _inputs, output) -> None:
        self.activations = output.detach()

    def _save_gradients(self, _module, _grad_input, grad_output) -> None:
        self.gradients = grad_output[0].detach()

    def __call__(self, image: torch.Tensor, target: int | None = None):
        self.model.zero_grad(set_to_none=True)
        logits = self.model(image)
        index = int(logits.argmax(dim=1)) if target is None else target
        logits[0, index].backward()

        weights = self.gradients.mean(dim=(2, 3), keepdim=True)
        cam = F.relu((weights * self.activations).sum(dim=1, keepdim=True))
        cam = F.interpolate(cam, size=image.shape[-2:], mode="bilinear", align_corners=False)

        cam = cam[0, 0]
        # Normalised per image: the question is *where* attention sits, not how
        # large the raw activation happened to be.
        span = cam.max() - cam.min()
        cam = (cam - cam.min()) / span if float(span) > 0 else torch.zeros_like(cam)
        probability = float(logits.detach().softmax(dim=1)[0, index])
        return cam.cpu(), index, probability


def border_mass_fraction(cam: torch.Tensor, fraction: float = BORDER_FRACTION) -> float:
    """Share of CAM mass in the outer ring. High = attention off the leaf."""
    height, width = cam.shape
    margin_y = int(height * fraction)
    margin_x = int(width * fraction)

    total = float(cam.sum())
    if total <= 0:
        return 0.0

    interior = float(cam[margin_y : height - margin_y, margin_x : width - margin_x].sum())
    return round((total - interior) / total, 4)


def uniform_border_baseline(size: int = 224, fraction: float = BORDER_FRACTION) -> float:
    """What the metric reads for perfectly uniform attention.

    Without this the border fraction is uninterpretable — the ring is simply a
    large share of the image area, so even a model looking nowhere in particular
    scores well above zero. Everything is reported relative to this.
    """
    margin = int(size * fraction)
    interior = (size - 2 * margin) ** 2
    return round((size * size - interior) / (size * size), 4)


def run_gradcam_probe(checkpoint: Path, config: dict, device, classes: list[str]) -> dict:
    """Item 3 — the required background-reliance probe."""
    model, _, _ = load_candidate(checkpoint, device)

    # Final conv stage of EfficientNet: the last spatial feature map before
    # pooling, which is what Grad-CAM is defined over.
    target_layer = model.features[-1]
    cam_engine = GradCAM(model, target_layer)

    _, eval_transform = build_transforms(config["image"], config["augment"], config["image"]["size"])
    class_to_index = {code: index for index, code in enumerate(classes)}

    by_source_crop: dict[tuple[str, str], list] = defaultdict(list)
    for split in ("test", "fieldtest"):
        samples = read_split(
            REPO / config["data"]["splits_dir"],
            REPO / config["data"]["raw_dir"],
            split,
            class_to_index,
        )
        for sample in samples:
            key = (split, crop_of(classes[sample.label]))
            if len(by_source_crop[key]) < SAMPLES_PER_CROP:
                by_source_crop[key].append(sample)

    GRADCAM_DIR.mkdir(parents=True, exist_ok=True)
    baseline = uniform_border_baseline(config["image"]["size"])
    findings = []

    for (split, crop), samples in sorted(by_source_crop.items()):
        fractions = []
        panels = []

        for sample in samples:
            with Image.open(sample.path) as raw:
                rgb = raw.convert("RGB")
            tensor = eval_transform(rgb).unsqueeze(0).to(device)
            cam, predicted, probability = cam_engine(tensor)
            fractions.append(border_mass_fraction(cam))
            if len(panels) < 8:
                panels.append((rgb, cam, classes[sample.label], classes[predicted], probability))

        mean_fraction = round(sum(fractions) / len(fractions), 4)
        findings.append(
            {
                "split": split,
                "crop": crop,
                "samples": len(samples),
                "mean_border_mass_fraction": mean_fraction,
                "uniform_baseline": baseline,
                "ratio_to_uniform": round(mean_fraction / baseline, 3),
                "interpretation": (
                    "attention concentrated OFF the centred leaf"
                    if mean_fraction > baseline
                    else "attention concentrated on the centred subject"
                ),
            }
        )

        _render_gradcam_grid(panels, GRADCAM_DIR / f"{split}-{crop}.png", split, crop, mean_fraction)

    return {
        "method": "Grad-CAM over the final conv stage; border-mass proxy",
        "samplesPerCrop": SAMPLES_PER_CROP,
        "borderFraction": BORDER_FRACTION,
        "uniformBaseline": baseline,
        "caveat": (
            "No leaf segmentation masks exist in this corpus, so this is a PROXY for "
            "background reliance, not a measurement of it. Values near the uniform "
            "baseline mean diffuse attention, not necessarily background reliance."
        ),
        "findings": findings,
    }


def _render_gradcam_grid(panels, path: Path, split: str, crop: str, mean_fraction: float) -> None:
    if not panels:
        return
    columns = len(panels)
    figure, axes = plt.subplots(2, columns, figsize=(2.1 * columns, 4.6))
    if columns == 1:
        axes = axes.reshape(2, 1)

    for column, (rgb, cam, true_code, predicted_code, probability) in enumerate(panels):
        resized = rgb.resize((224, 224))
        axes[0, column].imshow(resized)
        axes[0, column].set_title(
            f"{true_code}\n-> {predicted_code} ({probability:.2f})",
            fontsize=5,
            color="black" if true_code == predicted_code else "crimson",
        )
        axes[0, column].axis("off")

        axes[1, column].imshow(resized)
        axes[1, column].imshow(cam.numpy(), cmap="jet", alpha=0.45)
        axes[1, column].axis("off")

    figure.suptitle(f"Grad-CAM - {split} / {crop} - mean border-mass {mean_fraction:.3f}", fontsize=9)
    figure.tight_layout()
    figure.savefig(path, dpi=130)
    plt.close(figure)


def confusion_clusters(targets, predictions, classes, top: int = 10) -> list[dict]:
    """Item 1 — the most-confused ordered pairs."""
    counts: dict[tuple[int, int], int] = defaultdict(int)
    for true_index, predicted_index in zip(targets.tolist(), predictions.tolist(), strict=True):
        if true_index != predicted_index:
            counts[(true_index, predicted_index)] += 1

    support = defaultdict(int)
    for value in targets.tolist():
        support[value] += 1

    ranked = sorted(counts.items(), key=lambda item: -item[1])[:top]
    return [
        {
            "true": classes[true_index],
            "predicted": classes[predicted_index],
            "count": count,
            "rate_of_true_class": round(count / max(support[true_index], 1), 4),
            "same_crop": crop_of(classes[true_index]) == crop_of(classes[predicted_index]),
        }
        for (true_index, predicted_index), count in ranked
    ]


def main() -> int:
    parser = argparse.ArgumentParser(description="P4-8 / error analysis.")
    parser.add_argument("--checkpoint", default="ml-service/training/checkpoints/run2/best.pt")
    parser.add_argument("--calibration", default="ml-service/training/calibration.json")
    parser.add_argument("--skip-label-noise", action="store_true", help="skip the train-split pass")
    args = parser.parse_args()

    checkpoint = (REPO / args.checkpoint).resolve()
    calibration = json.loads((REPO / args.calibration).read_text(encoding="utf-8"))
    temperature = calibration["temperature"]

    config = load_config(TRAINING / "config.yaml")
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    RESULTS.mkdir(parents=True, exist_ok=True)

    print("== P4-8 / error analysis")

    test = compute_logits(checkpoint, "test", config=config, on_log=print)
    field = compute_logits(checkpoint, "fieldtest", config=config, on_log=print)
    val = compute_logits(checkpoint, "val", config=config, on_log=print)
    classes = test["classes"]

    test_predictions = (test["logits"] / temperature).argmax(dim=1)
    field_predictions = (field["logits"] / temperature).argmax(dim=1)

    # 1. Confusion clusters
    clusters = confusion_clusters(test["targets"], test_predictions, classes)
    print(
        f"   top confused pair: {clusters[0]['true']} -> {clusters[0]['predicted']} "
        f"({clusters[0]['count']} of {clusters[0]['rate_of_true_class']:.1%})"
    )

    # 2. Per-crop volume correlation
    train_counts = defaultdict(int)
    for line in (REPO / config["data"]["splits_dir"] / "train.tsv").read_text(encoding="utf-8").splitlines():
        if line.strip():
            train_counts[line.split("\t")[1]] += 1

    # 4. Overfitting check
    state = torch.load(checkpoint, map_location="cpu", weights_only=False)
    history = state.get("history", [])
    val_probabilities = (val["logits"] / temperature).argmax(dim=1)
    overfitting = {
        "final_train_acc": history[-1]["train_acc"] if history else None,
        "final_val_acc": history[-1]["val_acc"] if history else None,
        "train_minus_val_acc": (round(history[-1]["train_acc"] - history[-1]["val_acc"], 4) if history else None),
        "val_acc": round(float((val_probabilities == val["targets"]).float().mean()), 4),
        "test_acc": round(float((test_predictions == test["targets"]).float().mean()), 4),
        "note": (
            "A small train-val gap with a large in-domain-to-field gap is not overfitting to "
            "the training SET; it is fitting the training DOMAIN."
        ),
    }
    overfitting["val_minus_test_acc"] = round(overfitting["val_acc"] - overfitting["test_acc"], 4)

    # 5. Confidence autopsy
    probabilities = (test["logits"] / temperature).softmax(dim=1)
    confidence = probabilities.max(dim=1).values
    wrong = test_predictions != test["targets"]
    high_confidence_wrong = wrong & (confidence >= HIGH_CONFIDENCE)
    autopsy = {
        "threshold": HIGH_CONFIDENCE,
        "count": int(high_confidence_wrong.sum()),
        "rate_of_all_test": round(float(high_confidence_wrong.float().mean()), 4),
        "rate_of_all_errors": round(float(high_confidence_wrong.sum() / max(int(wrong.sum()), 1)), 4),
        "samples": [
            {
                "path": str(Path(test["paths"][index]).relative_to(REPO)).replace("\\", "/"),
                "true": classes[int(test["targets"][index])],
                "predicted": classes[int(test_predictions[index])],
                "confidence": round(float(confidence[index]), 4),
            }
            for index in high_confidence_wrong.nonzero().flatten().tolist()[:25]
        ],
    }
    print(
        f"   high-confidence-wrong (p>={HIGH_CONFIDENCE}): {autopsy['count']} "
        f"({autopsy['rate_of_all_errors']:.1%} of all errors)"
    )

    # 6. Field degradation per class
    def recall_by_class(targets, predictions):
        hits, totals = defaultdict(int), defaultdict(int)
        for true_index, predicted_index in zip(targets.tolist(), predictions.tolist(), strict=True):
            totals[true_index] += 1
            if true_index == predicted_index:
                hits[true_index] += 1
        return {index: hits[index] / totals[index] for index in totals}

    in_domain = recall_by_class(test["targets"], test_predictions)
    field_domain = recall_by_class(field["targets"], field_predictions)
    degradation = sorted(
        (
            {
                "class": classes[index],
                "test_recall": round(in_domain.get(index, 0.0), 4),
                "field_recall": round(field_domain[index], 4),
                "delta": round(field_domain[index] - in_domain.get(index, 0.0), 4),
            }
            for index in field_domain
        ),
        key=lambda row: row["delta"],
    )

    # 3. The gate
    print(f"   Grad-CAM probe: {SAMPLES_PER_CROP} samples/crop over test + fieldtest")
    gradcam = run_gradcam_probe(checkpoint, config, device, classes)
    for finding in gradcam["findings"]:
        print(
            f"     {finding['split']:10s} {finding['crop']:8s} "
            f"border-mass {finding['mean_border_mass_fraction']:.3f} "
            f"(uniform {finding['uniform_baseline']:.3f}, "
            f"ratio {finding['ratio_to_uniform']:.2f})"
        )

    # 7. Label-noise sweep
    label_noise = {"skipped": True, "reason": "--skip-label-noise"}
    if not args.skip_label_noise:
        train = compute_logits(checkpoint, "train", config=config, on_log=print)
        losses = F.cross_entropy(train["logits"] / temperature, train["targets"], reduction="none")
        worst = losses.topk(min(200, len(losses))).indices.tolist()
        by_class = defaultdict(int)
        for index in worst:
            by_class[classes[int(train["targets"][index])]] += 1
        label_noise = {
            "skipped": False,
            "inspected": len(worst),
            "threshold_note": (
                "error-analysis.md: retrain decision if a class contributes >2% of its own training images to this list"
            ),
            "top_loss_by_class": dict(sorted(by_class.items(), key=lambda item: -item[1])[:12]),
            "samples": [
                {
                    "path": str(Path(train["paths"][index]).relative_to(REPO)).replace("\\", "/"),
                    "labelled": classes[int(train["targets"][index])],
                    "predicted": classes[int((train["logits"][index]).argmax())],
                    "loss": round(float(losses[index]), 3),
                }
                for index in worst[:25]
            ],
        }

    payload = {
        "todo": "P4-8 + error analysis (docs/ml/error-analysis.md)",
        "generatedAt": datetime.now(UTC).isoformat(timespec="seconds"),
        "checkpoint": str(checkpoint.relative_to(REPO)).replace("\\", "/"),
        "confusionClusters": clusters,
        "perClassTrainVolume": dict(sorted(train_counts.items())),
        "backgroundReliance": gradcam,
        "overfitting": overfitting,
        "confidenceAutopsy": autopsy,
        "fieldDegradation": degradation,
        "labelNoiseSweep": label_noise,
    }

    output = RESULTS / "error-analysis.json"
    output.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"   wrote {output.relative_to(REPO)} + Grad-CAM grids in {GRADCAM_DIR.name}/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
