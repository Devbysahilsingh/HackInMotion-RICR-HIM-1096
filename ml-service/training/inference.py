"""Compute (and cache) model logits over a split.

P4-4 needs validation logits, P4-5 needs validation, test and field-test logits,
and P4-6 needs a golden subset. Recomputing each time costs a full GPU pass over
thousands of images for a result that cannot change — the checkpoint is frozen —
so the pass is done once per (checkpoint, split) and cached to disk.

The cache key includes the checkpoint's content hash, so swapping in a different
`best.pt` invalidates it automatically. That matters more than the speed: a
stale cache silently attributing one model's logits to another is exactly the
kind of error that produces an unreproducible metric.

Everything downstream reads **raw logits**. Temperature is applied by the
consumer, never here, so the same cache serves the pre- and post-calibration
numbers the plan requires side by side.
"""

from __future__ import annotations

import hashlib
import sys
from pathlib import Path

import torch
import yaml

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
sys.path.insert(0, str(HERE))

from data import (  # noqa: E402
    SplitDataset,
    build_loader,
    build_transforms,
    read_split,
)
from models import build_model  # noqa: E402

CACHE_DIR = HERE / ".logit-cache"


def load_config(path: Path | None = None) -> dict:
    return yaml.safe_load((path or HERE / "config.yaml").read_text(encoding="utf-8"))


def checkpoint_fingerprint(path: Path) -> str:
    """Content hash of the checkpoint, so the cache cannot outlive its model."""
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()[:16]


def load_candidate(checkpoint: Path, device: torch.device):
    """Restore a trained model from a checkpoint, with its class order.

    The class order travels in the checkpoint precisely so that nothing
    downstream has to re-derive it and risk a different ordering.
    """
    state = torch.load(checkpoint, map_location=device, weights_only=False)
    classes = state["classes"]
    model = build_model(state["arch"], len(classes)).to(device)
    model.load_state_dict(state["model"])
    model.eval()
    return model, classes, state


@torch.no_grad()
def compute_logits(
    checkpoint: Path,
    split: str,
    *,
    device: torch.device | None = None,
    config: dict | None = None,
    use_cache: bool = True,
    on_log=print,
) -> dict:
    """Raw logits for one split.

    @returns {"logits": (N,C) float32 cpu, "targets": (N,) int64,
              "sources": [str], "paths": [str], "classes": [str]}
    """
    config = config or load_config()
    device = device or torch.device("cuda" if torch.cuda.is_available() else "cpu")

    fingerprint = checkpoint_fingerprint(checkpoint)
    cache_path = CACHE_DIR / f"{fingerprint}-{split}-{config['image']['size']}.pt"

    if use_cache and cache_path.exists():
        on_log(f"    logits: cache hit {cache_path.name}")
        return torch.load(cache_path, map_location="cpu", weights_only=False)

    model, classes, _ = load_candidate(checkpoint, device)
    class_to_index = {code: index for index, code in enumerate(classes)}

    _, eval_transform = build_transforms(
        config["image"], config["augment"], config["image"]["size"]
    )
    samples = read_split(
        REPO / config["data"]["splits_dir"],
        REPO / config["data"]["raw_dir"],
        split,
        class_to_index,
    )
    loader = build_loader(
        SplitDataset(samples, eval_transform),
        config["loader"]["batch_size"],
        config["loader"],
    )

    on_log(f"    logits: computing {split} ({len(samples):,} images)")
    chunks: list[torch.Tensor] = []
    for images, _ in loader:
        with torch.amp.autocast("cuda", enabled=device.type == "cuda"):
            output = model(images.to(device, non_blocking=True))
        # float32 on CPU: autocast returns fp16, and calibration fits a
        # temperature against these values — fp16 rounding would move the fit.
        chunks.append(output.float().cpu())

    result = {
        "logits": torch.cat(chunks),
        "targets": torch.tensor([sample.label for sample in samples], dtype=torch.long),
        "sources": [sample.source for sample in samples],
        "paths": [str(sample.path) for sample in samples],
        "classes": classes,
        "split": split,
        "checkpoint": str(checkpoint),
        "checkpoint_sha256_16": fingerprint,
    }

    if use_cache:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        torch.save(result, cache_path)

    return result


def crop_of(code: str) -> str:
    """Crop half of a `CROP_CONDITION` class code.

    Split on the first underscore rather than matching a crop list: the class
    contract guarantees the prefix, and hardcoding crop names here would be the
    banned crop-conditional in a different costume.
    """
    return code.split("_", 1)[0]


def crop_class_indices(classes: list[str]) -> dict[str, list[int]]:
    """crop -> the indices of its classes, for declared-crop masking."""
    groups: dict[str, list[int]] = {}
    for index, code in enumerate(classes):
        groups.setdefault(crop_of(code), []).append(index)
    return groups
