"""Datasets, transforms and loaders built from the P0-6 split manifests.

Two properties matter more than anything else in this file.

**The class order is fixed once, here, and never re-derived.** It comes from
`datasets/manifest.json` sorted by code, and every downstream artefact — the
checkpoint, the ONNX export, `model-manifest.json`, the backend's masking —
indexes into it. Deriving it from whatever classes happened to appear in a split
would silently renumber the whole model the first time a class was empty.

**The eval transform must match inference exactly.** `ml-service/app/preprocessing.py`
does Resize(shortest side -> 256, bilinear) -> CenterCrop(224) -> /255 ->
ImageNet normalize, in that order. The eval pipeline below is the same operation
expressed in torchvision. The golden-image parity test (P4-6) is what proves the
two agree; until it runs, this is a claim, not a fact.
"""

from __future__ import annotations

import json
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

import torch
from PIL import Image
from torch.utils.data import DataLoader, Dataset, WeightedRandomSampler
from torchvision.transforms import v2

# PlantVillage ships a handful of images large enough to trip Pillow's bomb
# guard. They are legitimate publisher data that the P0-5 audit already
# inspected, so the ceiling is raised rather than the images being dropped.
Image.MAX_IMAGE_PIXELS = 200_000_000


@dataclass(frozen=True)
class Sample:
    path: Path
    label: int
    source: str


class SplitDataset(Dataset):
    """One split TSV, resolved against `datasets/raw/`.

    Paths are read as-is from the TSV: several publisher directories contain
    spaces and non-ASCII characters, so they are never re-derived, globbed or
    normalised — the manifest is the authority on which file is which class.
    """

    def __init__(self, samples: list[Sample], transform) -> None:
        self.samples = samples
        self.transform = transform

    def __len__(self) -> int:
        return len(self.samples)

    def __getitem__(self, index: int):
        sample = self.samples[index]
        # `with` matters: without it Pillow keeps the file handle open until GC,
        # and 27k of them across four worker processes exhausts the descriptor
        # table on Windows long before the epoch ends.
        with Image.open(sample.path) as image:
            rgb = image.convert("RGB")
        return self.transform(rgb), sample.label


def load_class_order(manifest_path: Path) -> list[str]:
    """The authoritative 35-class contract, sorted by code.

    Sorted rather than left in file order so that regenerating the dataset
    manifest cannot renumber an already-trained model.
    """
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    return sorted(manifest["classes"].keys())


def read_split(
    splits_dir: Path,
    raw_dir: Path,
    split: str,
    class_to_index: dict[str, int],
) -> list[Sample]:
    """Parse one split TSV into resolved samples.

    A row naming a class outside the contract, or a file that is not on disk, is
    a real inconsistency between the manifest and the corpus — it raises rather
    than being skipped, because silently training on 26,000 of 27,009 images is
    the kind of thing that shows up months later as an unexplained metric.
    """
    tsv = splits_dir / f"{split}.tsv"
    samples: list[Sample] = []
    missing: list[str] = []

    for line_number, line in enumerate(tsv.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        parts = line.split("\t")
        if len(parts) != 3:
            raise ValueError(f"{tsv}:{line_number}: expected 3 tab-separated columns")

        relative, code, source = parts
        if code not in class_to_index:
            raise ValueError(f"{tsv}:{line_number}: class {code!r} is not in the manifest contract")

        path = raw_dir / relative
        if not path.exists():
            missing.append(relative)
            continue

        samples.append(Sample(path=path, label=class_to_index[code], source=source))

    if missing:
        raise FileNotFoundError(
            f"{len(missing)} file(s) named by {tsv.name} are absent from {raw_dir}. "
            f"First: {missing[0]}. The raw corpus and the split manifest disagree; "
            "re-run scripts/ml/prepare-datasets.py rather than training on a subset."
        )

    return samples


def build_transforms(image_cfg: dict, augment_cfg: dict, image_size: int):
    """(train, eval) transform pair.

    The eval branch is the one bound by the parity contract. The train branch is
    free to differ and does — augmentation exists precisely to show the model
    inputs that inference will never produce.
    """
    mean, std = image_cfg["mean"], image_cfg["std"]

    to_float = [
        v2.ToImage(),
        v2.ToDtype(torch.float32, scale=True),  # scale=True is the /255
        v2.Normalize(mean=mean, std=std),
    ]

    train = v2.Compose(
        [
            v2.RandomResizedCrop(
                image_size,
                scale=tuple(augment_cfg["random_resized_crop_scale"]),
                antialias=True,
            ),
            v2.RandomHorizontalFlip(p=augment_cfg["hflip_p"]),
            v2.RandomRotation(degrees=augment_cfg["rotation_degrees"]),
            v2.ColorJitter(**augment_cfg["color_jitter"]),
            v2.RandomApply(
                [v2.GaussianBlur(kernel_size=5)],
                p=augment_cfg["gaussian_blur_p"],
            ),
            *to_float,
            # After normalization on purpose: erasing to zero means erasing to
            # the dataset mean, which is a neutral patch rather than a black one
            # the model could learn to read as a feature.
            v2.RandomErasing(p=augment_cfg["random_erasing_p"]),
        ]
    )

    evaluate = v2.Compose(
        [
            v2.Resize(image_cfg["resize_shortest_side"], antialias=True),
            v2.CenterCrop(image_size),
            *to_float,
        ]
    )

    return train, evaluate


def class_weights(samples: list[Sample], num_classes: int, power: float) -> torch.Tensor:
    """Inverse-frequency weights, softened by `power`, normalised to mean 1.

    Normalising keeps the loss on roughly the same scale whatever the weighting,
    so the learning rate does not silently need retuning when `power` changes.
    A class absent from the split gets weight 1 rather than infinity.
    """
    counts = Counter(sample.label for sample in samples)
    frequencies = torch.tensor(
        [max(counts.get(index, 0), 1) for index in range(num_classes)],
        dtype=torch.float32,
    )
    weights = frequencies.pow(-power)
    return weights / weights.mean()


def sampler_for(samples: list[Sample], num_classes: int, power: float) -> WeightedRandomSampler:
    """Per-sample draw weights that flatten the class distribution.

    `replacement=True` is required: the rarest class has 79 images and the
    epoch draws `len(samples)`, so rare classes are necessarily revisited.
    """
    weights = class_weights(samples, num_classes, power)
    per_sample = torch.tensor([weights[sample.label] for sample in samples], dtype=torch.double)
    return WeightedRandomSampler(per_sample, num_samples=len(samples), replacement=True)


def build_loader(
    dataset: Dataset,
    batch_size: int,
    loader_cfg: dict,
    *,
    sampler=None,
    shuffle: bool = False,
) -> DataLoader:
    workers = loader_cfg["num_workers"]
    return DataLoader(
        dataset,
        batch_size=batch_size,
        sampler=sampler,
        shuffle=shuffle if sampler is None else False,
        num_workers=workers,
        pin_memory=loader_cfg["pin_memory"],
        # Both are invalid with 0 workers and torch raises rather than ignoring
        # them, so they are omitted instead of being passed as False/None.
        **(
            {
                "persistent_workers": loader_cfg["persistent_workers"],
                "prefetch_factor": loader_cfg["prefetch_factor"],
            }
            if workers > 0
            else {}
        ),
        drop_last=False,
    )
