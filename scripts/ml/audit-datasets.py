#!/usr/bin/env python3
"""
Dataset audit for the custom crop-health model (TODO P0-5).

Measures and reports. It does NOT modify, deduplicate, split, resize or move a
single source image, and it does not touch the crop registry or any training
code — acting on these findings is P0-6.

What it produces
----------------
* ``datasets/audit-report.json`` — machine-readable results (committed).
* ``datasets/audit/contact-sheets/`` — sampled grids for visual label review
  (gitignored: derived image data, not evidence we need in the repo).
* ``datasets/audit/cache/`` — per-dataset hash cache so re-runs are cheap.

Method
------
1. **Census** — every image enumerated under declared class containers, decoded
   once, and recorded (dimensions, format, byte size). Decode failures are
   reported, never dropped silently.
2. **Exact duplicates** — SHA-1 over file bytes, computed during the same read.
3. **Near duplicates** — 64-bit DCT perceptual hash (32x32 grayscale, top-left
   8x8 coefficients, DC excluded, median threshold). Pairs within Hamming
   ``--threshold`` (default 8, per docs/ml/dataset-audit.md) are found by exact
   chunked comparison over all pairs — no approximate index, so no missed pairs
   — and merged into clusters with union-find.
4. **Leakage signals** — clusters spanning datasets (PlantDoc/PlantVillage web
   overlap), spanning classes (label-noise signal), and cotton
   original-vs-augmented overlap.
5. **Cotton OD-1 gate** — the criteria pre-registered in dataset-audit.md are
   evaluated mechanically against post-dedup counts. The script reports the
   measurement; the verdict is a team decision.

Layouts are declared explicitly below rather than inferred, because the
extracted trees are irregular (doubled directory names, per-variant subtrees).
An absent container is a hard error, not a silent zero.

Usage
-----
    python scripts/ml/audit-datasets.py
    python scripts/ml/audit-datasets.py --only cotton_sarcld2024
    python scripts/ml/audit-datasets.py --workers 4 --no-contact-sheets
    python scripts/ml/audit-datasets.py --refresh-cache
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import random
import sys
from collections import Counter, defaultdict
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass
from datetime import datetime, UTC
from pathlib import Path

import numpy as np
from PIL import Image

REPO_ROOT = Path(__file__).resolve().parents[2]
DATASETS_DIR = REPO_ROOT / "datasets"
RAW_DIR = DATASETS_DIR / "raw"
AUDIT_DIR = DATASETS_DIR / "audit"
CACHE_DIR = AUDIT_DIR / "cache"
SHEET_DIR = AUDIT_DIR / "contact-sheets"
REPORT_PATH = DATASETS_DIR / "audit-report.json"
MANIFEST_PATH = DATASETS_DIR / "manifest-raw.json"

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"}
HASH_SIDE = 32  # DCT input size
HASH_KEEP = 8  # top-left coefficient block
THUMB_SIDE = 64  # verification thumbnail
DEFAULT_THRESHOLD = 8  # Hamming distance, per docs/ml/dataset-audit.md
# pHash alone over-merges this kind of data: a single leaf on a plain background
# has little high-frequency content, so unrelated crops land close together in
# hash space and union-find chains them into one huge cluster (measured: a
# 14,367-image cluster spanning all six datasets, linking chilli to soybean).
# Every candidate pair is therefore verified by normalised cross-correlation of
# grayscale thumbnails before it may form a cluster.
#
# 64px / 0.95 is calibrated, not guessed. Against known-different images that
# pHash proposed as candidates (different crops, different datasets), NCC tops
# out at 0.895 at this resolution; against the duplicate kinds that must be
# caught — JPEG re-encode, rescale, brightness shift — it stays above 0.979.
# Coarser thumbnails leave no margin (hard negatives reach 0.933 at 16px, where
# a chilli cut-out and an apple leaf correlate on silhouette alone). Copies
# cropped by more than ~5% are NOT detectable this way and are not claimed to
# be; pHash does not propose them as candidates either.
DEFAULT_NCC_MIN = 0.95
SAMPLE_PER_CLASS = 30  # contact-sheet sample size, per the audit plan
SHEET_COLS = 6
SHEET_THUMB = 160
SAMPLE_SEED = 20260812  # fixed so sheets and samples are reproducible
MAX_EXAMPLES = 8  # bounded evidence per finding; full pair lists are unbounded

# Cotton OD-1 gate, pre-registered in docs/ml/dataset-audit.md before any data
# was inspected. Evaluated here mechanically so the numbers cannot be tuned to
# the desired answer.
COTTON_GATE = {
    "min_images_per_class": 150,
    "min_classes_passing": 6,
    "max_near_dup_inflation_pct": 30.0,
    "max_label_error_pct": 10.0,  # human judgement, not measured by this script
}


# ---------------------------------------------------------------------------
# Layout registry — verified against the extracted trees on 2026-08-12.
# "container" paths are relative to datasets/raw and hold one directory per
# class; images are collected recursively beneath each class directory (some
# publishers nest a same-named folder inside the class folder).
# ---------------------------------------------------------------------------

LAYOUTS: dict[str, dict] = {
    "plantvillage": {
        "crops": ["tomato", "potato", "maize", "other"],
        "groups": {
            "all": "plantvillage/Plant_leave_diseases_dataset_without_augmentation",
        },
    },
    "plantdoc": {
        "crops": ["tomato", "potato", "maize", "other"],
        "groups": {
            "train": "plantdoc/PlantDoc-Dataset-master/train",
            "test": "plantdoc/PlantDoc-Dataset-master/test",
        },
        # A single loose image sits at the repository root (a README asset).
        "stray_roots": ["plantdoc/PlantDoc-Dataset-master"],
    },
    "chilli_primary": {
        "crops": ["chilli"],
        "groups": {
            "all": "chilli_primary/Chilli Leaf Disease Image Dataset for Classificati",
        },
    },
    "chilli_secondary": {
        "crops": ["chilli"],
        "groups": {
            "all": "chilli_secondary/Chili Leaf Disease Dataset Annotated Smartphone Im",
        },
    },
    "cotton_sarcld2024": {
        "crops": ["cotton"],
        "groups": {
            "original": (
                "cotton_sarcld2024/SAR-CLD-2024 A Comprehensive Dataset for Cotton "
                "Leaf Disease Detection/Original Dataset/Original Dataset"
            ),
            "augmented": (
                "cotton_sarcld2024/SAR-CLD-2024 A Comprehensive Dataset for Cotton "
                "Leaf Disease Detection/Augmented Dataset/Augmented Dataset"
            ),
        },
    },
    "rice_odisha": {
        "crops": ["rice"],
        "groups": {
            "all": "rice_odisha/Rice Leaf Disease Images/Rice Leaf Disease Images",
        },
    },
    # This publisher inverts the usual nesting: class directories come first and
    # each holds its own raw/augmented subfolders, so the group is selected
    # *inside* the class rather than above it. "orginal" is the publisher's
    # spelling and is reproduced verbatim; the healthy class uses "aug" where
    # every other class uses "augmented".
    "rice_healthy_diu": {
        "crops": ["rice"],
        "groups": {
            "original": "rice_healthy_diu",
            "augmented": "rice_healthy_diu",
        },
        "class_subdirs": {
            "original": ["orginal"],
            "augmented": ["augmented", "aug"],
        },
    },
}

# Raw class-directory name -> unified class code (docs/ml/crop-class-mapping.md).
# Only in-scope crops are mapped; everything else is reported as out-of-scope
# rather than quietly dropped, because PlantVillage's non-target crops are still
# useful as negative/background data and that is a P0-6 decision.
CLASS_MAP: dict[str, dict[str, str]] = {
    "plantvillage": {
        "Tomato___healthy": "TOMATO_HEALTHY",
        "Tomato___Bacterial_spot": "TOMATO_BACTERIAL_SPOT",
        "Tomato___Early_blight": "TOMATO_EARLY_BLIGHT",
        "Tomato___Late_blight": "TOMATO_LATE_BLIGHT",
        "Tomato___Leaf_Mold": "TOMATO_LEAF_MOLD",
        "Tomato___Septoria_leaf_spot": "TOMATO_SEPTORIA_LEAF_SPOT",
        "Tomato___Spider_mites Two-spotted_spider_mite": "TOMATO_SPIDER_MITES",
        "Tomato___Target_Spot": "TOMATO_TARGET_SPOT",
        "Tomato___Tomato_mosaic_virus": "TOMATO_MOSAIC_VIRUS",
        "Tomato___Tomato_Yellow_Leaf_Curl_Virus": "TOMATO_YELLOW_LEAF_CURL_VIRUS",
        "Potato___healthy": "POTATO_HEALTHY",
        "Potato___Early_blight": "POTATO_EARLY_BLIGHT",
        "Potato___Late_blight": "POTATO_LATE_BLIGHT",
        "Corn___healthy": "MAIZE_HEALTHY",
        "Corn___Common_rust": "MAIZE_COMMON_RUST",
        "Corn___Cercospora_leaf_spot Gray_leaf_spot": "MAIZE_GRAY_LEAF_SPOT",
        "Corn___Northern_Leaf_Blight": "MAIZE_NORTHERN_LEAF_BLIGHT",
        "Background_without_leaves": "BACKGROUND_NO_LEAF",
    },
    "plantdoc": {
        "Tomato leaf": "TOMATO_HEALTHY",
        "Tomato leaf bacterial spot": "TOMATO_BACTERIAL_SPOT",
        "Tomato Early blight leaf": "TOMATO_EARLY_BLIGHT",
        "Tomato leaf late blight": "TOMATO_LATE_BLIGHT",
        "Tomato mold leaf": "TOMATO_LEAF_MOLD",
        "Tomato Septoria leaf spot": "TOMATO_SEPTORIA_LEAF_SPOT",
        "Tomato two spotted spider mites leaf": "TOMATO_SPIDER_MITES",
        "Tomato leaf mosaic virus": "TOMATO_MOSAIC_VIRUS",
        "Tomato leaf yellow virus": "TOMATO_YELLOW_LEAF_CURL_VIRUS",
        "Potato leaf early blight": "POTATO_EARLY_BLIGHT",
        "Potato leaf late blight": "POTATO_LATE_BLIGHT",
        "Corn rust leaf": "MAIZE_COMMON_RUST",
        "Corn Gray leaf spot": "MAIZE_GRAY_LEAF_SPOT",
        "Corn leaf blight": "MAIZE_NORTHERN_LEAF_BLIGHT",
    },
    "chilli_primary": {
        "Healthy_Leaf": "CHILLI_HEALTHY",
        "Curl_Virus": "CHILLI_LEAF_CURL_VIRUS",
        "Cercospora_Leaf_Spot": "CHILLI_CERCOSPORA_LEAF_SPOT",
        "Bacterial_Spot": "CHILLI_BACTERIAL_SPOT",
        "Nutrition_Deficiency": "CHILLI_NUTRIENT_DEFICIENCY",
        "Powdery_Mildew": "CHILLI_POWDERY_MILDEW",
    },
    "chilli_secondary": {
        "Fresh Leaf": "CHILLI_HEALTHY",
        "Leaf Curl Disease": "CHILLI_LEAF_CURL_VIRUS",
        "Cercospora Leaf Spot": "CHILLI_CERCOSPORA_LEAF_SPOT",
        "Anthracnose": "CHILLI_ANTHRACNOSE",
    },
    "cotton_sarcld2024": {
        "Healthy Leaf": "COTTON_HEALTHY",
        "Bacterial Blight": "COTTON_BACTERIAL_BLIGHT",
        "Curl Virus": "COTTON_CURL_VIRUS",
        "Herbicide Growth Damage": "COTTON_HERBICIDE_DAMAGE",
        "Leaf Hopper Jassids": "COTTON_LEAF_HOPPER_JASSIDS",
        "Leaf Redding": "COTTON_LEAF_REDDENING",
        "Leaf Variegation": "COTTON_LEAF_VARIEGATION",
    },
    "rice_odisha": {
        "Bacterialblight": "RICE_BACTERIAL_LEAF_BLIGHT",
        "Blast": "RICE_BLAST",
        "Brownspot": "RICE_BROWN_SPOT",
        "Tungro": "RICE_TUNGRO",
    },
    "rice_healthy_diu": {
        # "Healthy _leaf" (publisher's spacing) is the class this dataset was
        # acquired for — ADR-021 decision 2. "Rice" is a general whole-plant
        # category, not a condition, so it is deliberately left unmapped rather
        # than guessed into a class code.
        "Healthy _leaf": "RICE_NORMAL",
        "Bacterial Leaf Blight": "RICE_BACTERIAL_LEAF_BLIGHT",
        "Rice Blast": "RICE_BLAST",
        "Tungro": "RICE_TUNGRO",
    },
}


# ---------------------------------------------------------------------------
# Hashing
# ---------------------------------------------------------------------------

_DCT = None


def dct_matrix(n: int) -> np.ndarray:
    """Orthonormal DCT-II matrix; ``D @ x @ D.T`` is the 2-D transform."""
    k = np.arange(n).reshape(-1, 1)
    i = np.arange(n).reshape(1, -1)
    m = np.cos(np.pi * (2 * i + 1) * k / (2 * n))
    m[0] *= 1.0 / np.sqrt(2)
    return m * np.sqrt(2.0 / n)


def phash(img: Image.Image) -> int:
    global _DCT
    if _DCT is None:
        _DCT = dct_matrix(HASH_SIDE)
    small = img.convert("L").resize((HASH_SIDE, HASH_SIDE), Image.Resampling.LANCZOS)
    arr = np.asarray(small, dtype=np.float64)
    coeff = _DCT @ arr @ _DCT.T
    block = coeff[:HASH_KEEP, :HASH_KEEP].flatten()
    # Exclude DC: it encodes mean brightness only and would swamp the median.
    rest = block[1:]
    median = np.median(rest)
    bits = rest > median
    value = 0
    for bit in bits:
        value = (value << 1) | int(bit)
    return value  # 63 significant bits, stored in a uint64


def probe(path_str: str) -> dict:
    """Read one image once: byte hash, dimensions, perceptual hash."""
    rec: dict = {"path": path_str}
    try:
        data = Path(path_str).read_bytes()
        rec["bytes"] = len(data)
        # `usedforsecurity=False` is the accurate declaration, not a suppression:
        # this is a content fingerprint used to spot byte-identical duplicates
        # across datasets. Nothing authenticates against it.
        rec["sha1"] = hashlib.sha1(data, usedforsecurity=False).hexdigest()
        with Image.open(io.BytesIO(data)) as img:
            rec["format"] = img.format
            rec["mode"] = img.mode
            rec["width"], rec["height"] = img.size
            # draft() lets JPEG decode at reduced scale in the DCT domain; a
            # large speedup that does not change the perceptual hash materially.
            try:
                img.draft("L", (HASH_SIDE * 2, HASH_SIDE * 2))
            except Exception:  # noqa: BLE001, S110 - not all formats support draft
                pass
            img.load()
            rec["phash"] = phash(img)
            thumb = img.convert("L").resize(
                (THUMB_SIDE, THUMB_SIDE), Image.Resampling.LANCZOS
            )
            rec["thumb_bytes"] = thumb.tobytes()
    except Exception as exc:  # noqa: BLE001 - any failure is a finding
        rec["error"] = f"{type(exc).__name__}: {exc}"
    return rec


# ---------------------------------------------------------------------------
# Enumeration
# ---------------------------------------------------------------------------


@dataclass
class Item:
    dataset: str
    group: str
    raw_class: str
    code: str | None
    relpath: str
    sha1: str = ""
    phash: int = 0
    width: int = 0
    height: int = 0
    bytes: int = 0
    fmt: str = ""


def is_image(name: str) -> bool:
    return Path(name).suffix.lower() in IMAGE_SUFFIXES and not name.startswith("._")


def enumerate_dataset(dataset: str) -> tuple[list[Item], dict]:
    layout = LAYOUTS[dataset]
    items: list[Item] = []
    notes: dict = {"stray_files": [], "skipped_metadata": 0}
    for group, rel_container in layout["groups"].items():
        container = RAW_DIR / rel_container
        if not container.is_dir():
            raise SystemExit(
                f"FATAL: declared container missing for {dataset}/{group}: {container}\n"
                "The extracted tree does not match the layout registry; refusing to "
                "report a partial census."
            )
        subdirs = layout.get("class_subdirs", {}).get(group)
        for class_dir in sorted(p for p in container.iterdir() if p.is_dir()):
            raw_class = class_dir.name
            code = CLASS_MAP.get(dataset, {}).get(raw_class)
            # Where the publisher nests raw/augmented inside each class, walk
            # only the subfolders this group names. A class missing them all is
            # a layout error, not an empty class.
            if subdirs is not None:
                roots = [class_dir / s for s in subdirs if (class_dir / s).is_dir()]
                if not roots:
                    raise SystemExit(
                        f"FATAL: {dataset}/{group}: class '{raw_class}' has none of "
                        f"the declared subdirectories {subdirs}"
                    )
            else:
                roots = [class_dir]
            for walk_root in roots:
                for dirpath, dirnames, filenames in os.walk(walk_root):
                    if "__MACOSX" in Path(dirpath).parts:
                        notes["skipped_metadata"] += len(filenames)
                        continue
                    dirnames[:] = [d for d in dirnames if d != "__MACOSX"]
                    for fn in filenames:
                        if not is_image(fn):
                            continue
                        rel = (Path(dirpath) / fn).relative_to(RAW_DIR).as_posix()
                        items.append(Item(dataset, group, raw_class, code, rel))
        for loose in sorted(p for p in container.iterdir() if p.is_file()):
            if is_image(loose.name):
                notes["stray_files"].append(loose.relative_to(RAW_DIR).as_posix())
    for rel_root in layout.get("stray_roots", []):
        root = RAW_DIR / rel_root
        for loose in sorted(p for p in root.iterdir() if p.is_file()):
            if is_image(loose.name):
                notes["stray_files"].append(loose.relative_to(RAW_DIR).as_posix())
    return items, notes


# ---------------------------------------------------------------------------
# Cache
# ---------------------------------------------------------------------------


def cache_paths(dataset: str) -> tuple[Path, Path]:
    return CACHE_DIR / f"{dataset}.json", CACHE_DIR / f"{dataset}-thumbs.npy"


def load_cache(dataset: str) -> tuple[dict[str, dict], np.ndarray | None]:
    """Metadata in JSON, verification thumbnails in a binary sidecar.

    64x64 thumbnails base64-encoded into JSON would be ~460 MB of text for this
    corpus; as a uint8 array they are ~340 MB and load by mmap.
    """
    meta_path, thumb_path = cache_paths(dataset)
    if not meta_path.is_file():
        return {}, None
    try:
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}, None
    thumbs = None
    if thumb_path.is_file():
        try:
            thumbs = np.load(thumb_path, mmap_mode="r")
            if thumbs.shape[1] != THUMB_SIDE * THUMB_SIDE:
                return {}, None  # thumbnail size changed: cache is stale
        except (OSError, ValueError):
            return {}, None
    return meta, thumbs


def save_cache(dataset: str, cache: dict[str, dict], thumbs: np.ndarray) -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    meta_path, thumb_path = cache_paths(dataset)
    np.save(thumb_path, thumbs)
    meta_path.write_text(json.dumps(cache), encoding="utf-8")


def probe_dataset(
    dataset: str, items: list[Item], workers: int, refresh: bool
) -> tuple[list[Item], list[dict], np.ndarray]:
    cache, thumbs = ({}, None) if refresh else load_cache(dataset)
    if thumbs is None:
        cache = {}  # metadata without its thumbnail sidecar is unusable
    # A cached record from an older schema (no thumbnail index) is stale, not a
    # failure — re-probe it rather than reporting a decode error.
    todo = [
        it
        for it in items
        if "thumb_index" not in cache.get(it.relpath, {})
        and "error" not in cache.get(it.relpath, {})
    ]
    print(
        f"  {dataset}: {len(items)} images ({len(items) - len(todo)} cached, "
        f"{len(todo)} to hash)",
        flush=True,
    )
    if todo:
        paths = [str(RAW_DIR / it.relpath) for it in todo]
        new_rows: list[np.ndarray] = []
        base = 0 if thumbs is None else len(thumbs)
        done = 0

        def absorb(rec: dict) -> None:
            nonlocal done
            raw = rec.pop("thumb_bytes", None)
            if raw is not None:
                rec["thumb_index"] = base + len(new_rows)
                new_rows.append(np.frombuffer(raw, dtype=np.uint8))
            cache[Path(rec["path"]).relative_to(RAW_DIR).as_posix()] = rec
            done += 1
            if done % 5000 == 0:
                print(f"    hashed {done}/{len(todo)}", flush=True)

        if workers > 1:
            with ProcessPoolExecutor(max_workers=workers) as pool:
                for rec in pool.map(probe, paths, chunksize=64):
                    absorb(rec)
        else:
            for p in paths:
                absorb(probe(p))
        stacked = (
            np.vstack(new_rows)
            if new_rows
            else np.empty((0, THUMB_SIDE * THUMB_SIDE), dtype=np.uint8)
        )
        thumbs = stacked if thumbs is None else np.vstack([np.asarray(thumbs), stacked])
        save_cache(dataset, cache, thumbs)

    failures: list[dict] = []
    ok: list[Item] = []
    rows: list[np.ndarray] = []
    for it in items:
        rec = cache.get(it.relpath, {})
        if "error" in rec or "phash" not in rec or "thumb_index" not in rec:
            failures.append(
                {
                    "dataset": dataset,
                    "path": it.relpath,
                    "error": rec.get("error", "no record produced"),
                }
            )
            continue
        it.sha1 = rec["sha1"]
        it.phash = int(rec["phash"])
        it.width = rec["width"]
        it.height = rec["height"]
        it.bytes = rec["bytes"]
        it.fmt = rec.get("format") or "UNKNOWN"
        rows.append(np.asarray(thumbs[rec["thumb_index"]]))
        ok.append(it)
    stack = (
        np.vstack(rows)
        if rows
        else np.empty((0, THUMB_SIDE * THUMB_SIDE), dtype=np.uint8)
    )
    return ok, failures, stack


# ---------------------------------------------------------------------------
# Duplicate analysis
# ---------------------------------------------------------------------------


class UnionFind:
    def __init__(self, n: int) -> None:
        self.parent = list(range(n))
        self.rank = [0] * n

    def find(self, a: int) -> int:
        while self.parent[a] != a:
            self.parent[a] = self.parent[self.parent[a]]
            a = self.parent[a]
        return a

    def union(self, a: int, b: int) -> None:
        ra, rb = self.find(a), self.find(b)
        if ra == rb:
            return
        if self.rank[ra] < self.rank[rb]:
            ra, rb = rb, ra
        self.parent[rb] = ra
        if self.rank[ra] == self.rank[rb]:
            self.rank[ra] += 1


def normalise_rows(raw: np.ndarray) -> np.ndarray:
    """Mean-centre and unit-normalise thumbnail rows.

    Doing this per image makes the correlation invariant to brightness and
    contrast shifts (re-encoding, exposure) while staying sensitive to content.
    Rows are normalised on demand rather than for the whole corpus at once: as
    float32 the full matrix would be 1.4 GB, while the uint8 source is ~340 MB.
    """
    mat = np.asarray(raw, dtype=np.float32)
    mat -= mat.mean(axis=1, keepdims=True)
    norm = np.sqrt((mat**2).sum(axis=1, keepdims=True))
    norm[norm == 0] = 1.0  # a perfectly flat image correlates with nothing
    return mat / norm


def candidate_pairs(items: list[Item], threshold: int, chunk: int = 1024):
    """Yield (i_array, j_array, distance_array) of pHash candidates per chunk.

    Exact all-pairs comparison, no approximate index, so no pair within
    ``threshold`` is missed. Hamming distance over 0/1 bit matrices is computed
    as ``A@(1-B).T + (1-A)@B.T`` so BLAS does the work; values are small
    integers exactly representable in float32.
    """
    hashes = np.array([it.phash for it in items], dtype=np.uint64)
    bits = np.unpackbits(hashes.view(np.uint8).reshape(-1, 8)[:, ::-1], axis=1)
    bits = bits.astype(np.float32)
    inv = 1.0 - bits
    n = len(items)
    for start in range(0, n, chunk):
        stop = min(start + chunk, n)
        dist = bits[start:stop] @ inv.T + inv[start:stop] @ bits.T
        rows, cols = np.nonzero(dist <= threshold)
        keep = cols > (rows + start)  # upper triangle only
        rows, cols = rows[keep], cols[keep]
        yield rows + start, cols, dist[rows, cols].astype(np.int16)
        if (start // chunk) % 20 == 0:
            print(f"    pair scan {stop}/{n}", flush=True)


def verified_pairs(items: list[Item], threshold: int, ncc_min: float, stats: dict):
    """Yield (i, j, hamming, ncc) for candidate pairs that survive verification."""
    thumbs = stats["thumbs"]
    for i_arr, j_arr, d_arr in candidate_pairs(items, threshold):
        if len(i_arr) == 0:
            continue
        ncc = np.einsum(
            "ij,ij->i",
            normalise_rows(thumbs[i_arr]),
            normalise_rows(thumbs[j_arr]),
        )
        stats["candidates"] += len(i_arr)
        for bucket in np.floor(np.clip(ncc, -1.0, 0.9999) * 10).astype(int):
            stats["ncc_hist"][f"{bucket / 10:.1f}"] += 1
        keep = ncc >= ncc_min
        stats["verified"] += int(keep.sum())
        # All four are the same `keep` mask applied to same-length arrays, so
        # `strict=True` costs nothing and turns a future indexing mistake into
        # an exception instead of a silently truncated duplicate list.
        yield from zip(
            i_arr[keep].tolist(),
            j_arr[keep].tolist(),
            d_arr[keep].tolist(),
            np.round(ncc[keep], 4).tolist(),
            strict=True,
        )


def calibrate(items: list[Item], thumbs: np.ndarray, exact_groups: list[list[int]]) -> dict:
    """Positive and negative controls for the verification cut.

    Positive control: byte-identical images must score ~1.0 — if they do not,
    the metric is broken. Negative control: random pairs show where unrelated
    images sit, i.e. how much headroom the cut has.
    """
    rng = np.random.default_rng(SAMPLE_SEED)
    pos = [(g[0], g[1]) for g in exact_groups[:2000]]
    pos_scores = (
        np.einsum(
            "ij,ij->i",
            normalise_rows(thumbs[[a for a, _ in pos]]),
            normalise_rows(thumbs[[b for _, b in pos]]),
        )
        if pos
        else np.array([])
    )
    n = len(items)
    ra = rng.integers(0, n, 20000)
    rb = rng.integers(0, n, 20000)
    mask = ra != rb
    neg_scores = np.einsum(
        "ij,ij->i",
        normalise_rows(thumbs[ra[mask]]),
        normalise_rows(thumbs[rb[mask]]),
    )
    return {
        "positive_control_byte_identical_pairs": len(pos),
        "positive_control_min_ncc": round(float(pos_scores.min()), 4) if len(pos_scores) else None,
        "positive_control_mean_ncc": round(float(pos_scores.mean()), 4) if len(pos_scores) else None,
        "negative_control_random_pairs": int(mask.sum()),
        "negative_control_mean_ncc": round(float(neg_scores.mean()), 4),
        "negative_control_p99_ncc": round(float(np.percentile(neg_scores, 99)), 4),
        "negative_control_max_ncc": round(float(neg_scores.max()), 4),
        "negative_control_fraction_above_cut": round(
            float((neg_scores >= DEFAULT_NCC_MIN).mean()), 6
        ),
        "negative_control_note": (
            "Random pairs are not guaranteed non-duplicates — these corpora contain "
            "genuine duplicates, so the maximum can legitimately reach 1.0. Read the "
            "mean and p99, not the max."
        ),
    }


# ---------------------------------------------------------------------------
# Contact sheets
# ---------------------------------------------------------------------------


def contact_sheet(items: list[Item], out_path: Path, sample: int) -> int:
    # Seeded and reproducible: this picks which images land on a contact sheet
    # for human review, so determinism is the requirement and cryptographic
    # strength is not.
    rng = random.Random(SAMPLE_SEED)  # noqa: S311
    picks = items if len(items) <= sample else rng.sample(items, sample)
    picks = sorted(picks, key=lambda it: it.relpath)
    cols = SHEET_COLS
    rows = (len(picks) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * SHEET_THUMB, rows * SHEET_THUMB), "black")
    for idx, it in enumerate(picks):
        try:
            with Image.open(RAW_DIR / it.relpath) as img:
                img = img.convert("RGB")
                img.thumbnail((SHEET_THUMB, SHEET_THUMB), Image.Resampling.LANCZOS)
                x = (idx % cols) * SHEET_THUMB + (SHEET_THUMB - img.width) // 2
                y = (idx // cols) * SHEET_THUMB + (SHEET_THUMB - img.height) // 2
                sheet.paste(img, (x, y))
        except Exception:  # noqa: BLE001, S112 - a broken image is already reported
            continue
    out_path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out_path, "JPEG", quality=82)
    return len(picks)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def safe_name(text: str) -> str:
    return "".join(c if c.isalnum() or c in "-_" else "_" for c in text)


def main() -> int:
    ap = argparse.ArgumentParser(description="P0-5 dataset audit (read-only).")
    ap.add_argument(
        "--only",
        nargs="*",
        help=(
            "restrict to these dataset ids. NOTE: the report is rewritten with "
            "only these datasets — finish with a full run before treating "
            "audit-report.json as complete."
        ),
    )
    ap.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 2) - 1))
    ap.add_argument("--threshold", type=int, default=DEFAULT_THRESHOLD)
    ap.add_argument(
        "--ncc-min",
        type=float,
        default=DEFAULT_NCC_MIN,
        help="pixel-verification cut applied to pHash candidates",
    )
    ap.add_argument("--no-contact-sheets", action="store_true")
    ap.add_argument("--refresh-cache", action="store_true")
    args = ap.parse_args()

    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # noqa: BLE001, S110 - older interpreters
        pass

    selected = list(LAYOUTS) if not args.only else args.only
    for ds in selected:
        if ds not in LAYOUTS:
            raise SystemExit(f"unknown dataset id: {ds}")

    print("== enumerate + hash ==", flush=True)
    all_items: list[Item] = []
    failures: list[dict] = []
    notes: dict[str, dict] = {}
    thumb_blocks: list[np.ndarray] = []
    for ds in selected:
        items, note = enumerate_dataset(ds)
        notes[ds] = note
        ok, fail, block = probe_dataset(ds, items, args.workers, args.refresh_cache)
        all_items.extend(ok)
        failures.extend(fail)
        thumb_blocks.append(block)
    thumbs = np.vstack(thumb_blocks)

    # ---- census -----------------------------------------------------------
    census: dict[str, dict] = {}
    for ds in selected:
        ds_items = [it for it in all_items if it.dataset == ds]
        groups: dict[str, dict] = {}
        for group in LAYOUTS[ds]["groups"]:
            g_items = [it for it in ds_items if it.group == group]
            classes = []
            by_class = defaultdict(list)
            for it in g_items:
                by_class[it.raw_class].append(it)
            for raw_class, cls_items in sorted(by_class.items()):
                widths = [it.width for it in cls_items]
                heights = [it.height for it in cls_items]
                classes.append(
                    {
                        "raw_class": raw_class,
                        "code": cls_items[0].code,
                        "in_scope": cls_items[0].code is not None,
                        "count": len(cls_items),
                        "formats": dict(Counter(it.fmt for it in cls_items)),
                        "median_width": int(np.median(widths)),
                        "median_height": int(np.median(heights)),
                        "min_side": int(min(min(widths), min(heights))),
                        "megabytes": round(
                            sum(it.bytes for it in cls_items) / 1024**2, 1
                        ),
                    }
                )
            counts = [c["count"] for c in classes]
            groups[group] = {
                "images": len(g_items),
                "classes": classes,
                "class_count": len(classes),
                "imbalance_ratio": (
                    round(max(counts) / min(counts), 1) if counts else None
                ),
            }
        census[ds] = {
            "crops": LAYOUTS[ds]["crops"],
            "images": len(ds_items),
            "groups": groups,
            "notes": notes[ds],
        }

    # ---- exact duplicates -------------------------------------------------
    by_sha: dict[str, list[int]] = defaultdict(list)
    for idx, it in enumerate(all_items):
        by_sha[it.sha1].append(idx)
    exact_groups = [g for g in by_sha.values() if len(g) > 1]
    exact_examples = []
    for g in exact_groups[:MAX_EXAMPLES]:
        exact_examples.append([all_items[i].relpath for i in g[:4]])
    # Redundant copies (group size minus one survivor), attributed per dataset,
    # and separately the ones that also cross a class boundary — a byte-identical
    # image filed under two labels is an outright labelling contradiction.
    exact_by_ds = Counter()
    exact_cross_class = []
    for g in exact_groups:
        for i in g[1:]:
            exact_by_ds[all_items[i].dataset] += 1
        codes = {all_items[i].code or all_items[i].raw_class for i in g}
        if len(codes) > 1 and len(exact_cross_class) < MAX_EXAMPLES:
            exact_cross_class.append(
                {"codes": sorted(codes), "paths": [all_items[i].relpath for i in g[:4]]}
            )
    exact_cross_class_total = sum(
        1
        for g in exact_groups
        if len({all_items[i].code or all_items[i].raw_class for i in g}) > 1
    )

    # ---- near duplicates --------------------------------------------------
    print("== near-duplicate scan ==", flush=True)
    calibration = calibrate(all_items, thumbs, exact_groups)
    print(f"  calibration: {calibration}", flush=True)
    pair_stats = {"candidates": 0, "verified": 0, "ncc_hist": Counter(), "thumbs": thumbs}
    uf = UnionFind(len(all_items))
    pair_ds = Counter()
    pair_class = Counter()
    cross_class_examples: list[dict] = []
    cross_ds_examples: list[dict] = []
    pair_total = 0
    pair_zero = 0
    for i, j, dist, ncc in verified_pairs(
        all_items, args.threshold, args.ncc_min, pair_stats
    ):
        pair_total += 1
        if dist == 0:
            pair_zero += 1
        a, b = all_items[i], all_items[j]
        uf.union(i, j)
        key_ds = tuple(sorted((a.dataset, b.dataset)))
        pair_ds[key_ds] += 1
        if a.dataset != b.dataset and len(cross_ds_examples) < MAX_EXAMPLES:
            cross_ds_examples.append(
                {"a": a.relpath, "b": b.relpath, "distance": dist, "ncc": ncc}
            )
        code_a = a.code or f"{a.dataset}:{a.raw_class}"
        code_b = b.code or f"{b.dataset}:{b.raw_class}"
        if code_a != code_b:
            pair_class[tuple(sorted((code_a, code_b)))] += 1
            if len(cross_class_examples) < MAX_EXAMPLES:
                cross_class_examples.append(
                    {
                        "a": a.relpath,
                        "a_code": code_a,
                        "b": b.relpath,
                        "b_code": code_b,
                        "distance": dist,
                        "ncc": ncc,
                    }
                )

    clusters: dict[int, list[int]] = defaultdict(list)
    for idx in range(len(all_items)):
        clusters[uf.find(idx)].append(idx)
    multi = [c for c in clusters.values() if len(c) > 1]
    images_in_clusters = sum(len(c) for c in multi)
    # Union-find is transitive: a chain of pairwise-similar images collapses
    # into one cluster even if its extremes are far apart. The size histogram
    # is reported so the reader can see whether collapse is driven by genuine
    # duplicates or by chaining.
    size_hist = Counter()
    for c in multi:
        n = len(c)
        bucket = (
            "2"
            if n == 2
            else "3-5"
            if n <= 5
            else "6-20"
            if n <= 20
            else "21-100"
            if n <= 100
            else ">100"
        )
        size_hist[bucket] += 1
    largest = sorted(multi, key=len, reverse=True)[:5]
    largest_desc = [
        {
            "size": len(c),
            "datasets": sorted({all_items[i].dataset for i in c}),
            "classes": sorted({all_items[i].code or all_items[i].raw_class for i in c}),
            "example": all_items[c[0]].relpath,
        }
        for c in largest
    ]
    cross_ds_clusters = sum(
        1 for c in multi if len({all_items[i].dataset for i in c}) > 1
    )

    # Per-dataset near-duplicate rate: images that would be lost if every
    # cluster collapsed to one representative.
    ds_redundant = Counter()
    for c in multi:
        for i in c[1:]:
            ds_redundant[all_items[i].dataset] += 1

    # Per class-code deduplicated counts (cluster-atomic: one survivor per
    # cluster, attributed to the class of its first member).
    dedup_by_code: Counter = Counter()
    seen_root: set[int] = set()
    for idx, it in enumerate(all_items):
        root = uf.find(idx)
        if root in seen_root:
            continue
        seen_root.add(root)
        dedup_by_code[(it.dataset, it.group, it.raw_class)] += 1

    # ---- publisher-split leakage -----------------------------------------
    # Where a publisher ships its own splits (PlantDoc train/test) or variants
    # (cotton original/augmented), duplicates that cross that boundary defeat
    # the split's purpose. Measured per dataset rather than assumed.
    split_leakage: dict[str, dict] = {}
    for ds in selected:
        groups = list(LAYOUTS[ds]["groups"])
        if len(groups) < 2:
            continue
        spanning = [
            c
            for c in multi
            if len({all_items[i].group for i in c if all_items[i].dataset == ds}) > 1
        ]
        exact_spanning = [
            g
            for g in exact_groups
            if len({all_items[i].group for i in g if all_items[i].dataset == ds}) > 1
        ]
        exact_conflicting = [
            g
            for g in exact_spanning
            if len({all_items[i].raw_class for i in g if all_items[i].dataset == ds}) > 1
        ]
        split_leakage[ds] = {
            "groups": groups,
            "near_dup_clusters_spanning_groups": len(spanning),
            "images_in_spanning_clusters": sum(
                sum(1 for i in c if all_items[i].dataset == ds) for c in spanning
            ),
            "byte_identical_groups_spanning_groups": len(exact_spanning),
            "byte_identical_spanning_with_conflicting_labels": len(exact_conflicting),
            "conflicting_examples": [
                {
                    "paths": [all_items[i].relpath for i in g[:3]],
                    "classes": sorted(
                        {all_items[i].raw_class for i in g if all_items[i].dataset == ds}
                    ),
                }
                for g in exact_conflicting[:MAX_EXAMPLES]
            ],
        }

    # ---- cotton OD-1 gate -------------------------------------------------
    cotton = None
    if "cotton_sarcld2024" in selected:
        orig = [
            it
            for it in all_items
            if it.dataset == "cotton_sarcld2024" and it.group == "original"
        ]
        raw_counts = Counter(it.raw_class for it in orig)
        dedup_counts = {
            k[2]: v for k, v in dedup_by_code.items() if k[0] == "cotton_sarcld2024" and k[1] == "original"
        }
        passing = [
            c
            for c, n in dedup_counts.items()
            if n >= COTTON_GATE["min_images_per_class"]
        ]
        inflation = (
            round(
                100.0
                * (sum(raw_counts.values()) - sum(dedup_counts.values()))
                / max(1, sum(raw_counts.values())),
                1,
            )
        )
        # Original-vs-augmented contamination: augmented images whose cluster
        # also contains an original image.
        aug_linked = 0
        for c in multi:
            groups_in = {
                all_items[i].group
                for i in c
                if all_items[i].dataset == "cotton_sarcld2024"
            }
            if {"original", "augmented"} <= groups_in:
                aug_linked += sum(
                    1
                    for i in c
                    if all_items[i].dataset == "cotton_sarcld2024"
                    and all_items[i].group == "augmented"
                )
        cotton = {
            "criteria": COTTON_GATE,
            "classes_found": len(raw_counts),
            "classes_expected_by_plan": 8,
            "raw_counts": dict(sorted(raw_counts.items())),
            "dedup_counts": dict(sorted(dedup_counts.items())),
            "classes_passing_min": sorted(passing),
            "classes_passing_count": len(passing),
            "near_dup_inflation_pct": inflation,
            "augmented_images_linked_to_originals": aug_linked,
            "mechanical_verdict": (
                "PASS"
                if len(passing) >= COTTON_GATE["min_classes_passing"]
                and inflation <= COTTON_GATE["max_near_dup_inflation_pct"]
                else "FAIL"
            ),
            "note": (
                "Label-error rate is a human judgement from the contact sheets and "
                "is NOT measured here. The mechanical verdict covers count and "
                "near-duplicate criteria only; the team owns the OD-1 decision."
            ),
        }

    # ---- contact sheets ---------------------------------------------------
    sheets: list[dict] = []
    if not args.no_contact_sheets:
        print("== contact sheets ==", flush=True)
        by_class: dict[tuple, list[Item]] = defaultdict(list)
        for it in all_items:
            by_class[(it.dataset, it.group, it.raw_class)].append(it)
        for (ds, group, raw_class), cls_items in sorted(by_class.items()):
            if cls_items[0].code is None:
                continue  # out-of-scope classes are censused, not sheeted
            out = SHEET_DIR / ds / f"{safe_name(group)}__{safe_name(raw_class)}.jpg"
            n = contact_sheet(cls_items, out, SAMPLE_PER_CLASS)
            sheets.append(
                {
                    "dataset": ds,
                    "group": group,
                    "raw_class": raw_class,
                    "code": cls_items[0].code,
                    "sampled": n,
                    "path": out.relative_to(REPO_ROOT).as_posix(),
                }
            )
        print(f"  {len(sheets)} sheets written under {SHEET_DIR}", flush=True)

    # ---- class-map reconciliation ----------------------------------------
    mapped_codes = Counter()
    for (ds, _g, raw_class), n in dedup_by_code.items():
        code = CLASS_MAP.get(ds, {}).get(raw_class)
        if code:
            mapped_codes[code] += n
    planned = {
        "rice": [
            "RICE_NORMAL",
            "RICE_BACTERIAL_LEAF_BLIGHT",
            "RICE_BACTERIAL_LEAF_STREAK",
            "RICE_BACTERIAL_PANICLE_BLIGHT",
            "RICE_BLAST",
            "RICE_BROWN_SPOT",
            "RICE_DEAD_HEART",
            "RICE_DOWNY_MILDEW",
            "RICE_HISPA",
            "RICE_TUNGRO",
        ],
    }
    rice_missing = [c for c in planned["rice"] if c not in mapped_codes]

    unmapped = sorted(
        {
            f"{it.dataset}:{it.raw_class}"
            for it in all_items
            if it.code is None
        }
    )

    report = {
        "schema_version": 1,
        "todo": "P0-5",
        "generated_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "method": {
            "phash": "DCT-II 32x32, top-left 8x8, DC excluded, median threshold, 63 bits",
            "near_dup_threshold_hamming": args.threshold,
            "pair_search": "exact all-pairs (no approximate index)",
            "verification": (
                f"16x16 grayscale z-normalised cross-correlation >= {args.ncc_min}; "
                "pHash supplies candidates only, because low-texture leaf images "
                "collide in hash space and union-find then chains unrelated crops "
                "into one cluster"
            ),
            "verification_calibration": calibration,
            "candidate_pairs": pair_stats["candidates"],
            "verified_pairs": pair_stats["verified"],
            "rejected_by_verification": pair_stats["candidates"] - pair_stats["verified"],
            "candidate_ncc_histogram": dict(sorted(pair_stats["ncc_hist"].items())),
            "known_limitation": (
                "Rotated/flipped/heavily-recoloured copies are not detected: pHash is "
                "not rotation-invariant, so augmented variants of an image may score as "
                "unrelated. Cotton's augmented split must therefore be excluded from "
                "val/test wholesale rather than relied on being caught here."
            ),
            "clustering": "union-find over verified pairs",
            "sample_seed": SAMPLE_SEED,
            "sample_per_class": SAMPLE_PER_CLASS,
        },
        "totals": {
            "images_audited": len(all_items),
            "decode_failures": len(failures),
            "datasets": len(selected),
        },
        "census": census,
        "duplicates": {
            "exact_byte_identical_groups": len(exact_groups),
            "exact_byte_identical_images": sum(len(g) for g in exact_groups),
            "exact_redundant_by_dataset": dict(sorted(exact_by_ds.items())),
            "exact_groups_spanning_two_classes": exact_cross_class_total,
            "exact_cross_class_examples": exact_cross_class,
            "exact_examples": exact_examples,
            "near_dup_pairs": pair_total,
            "near_dup_pairs_distance_zero": pair_zero,
            "near_dup_clusters": len(multi),
            "cluster_size_histogram": dict(size_hist),
            "largest_clusters": largest_desc,
            "images_in_near_dup_clusters": images_in_clusters,
            "redundant_images_if_collapsed": sum(ds_redundant.values()),
            "per_dataset_redundant": dict(sorted(ds_redundant.items())),
            "cross_dataset_clusters": cross_ds_clusters,
            "pairs_by_dataset_pair": {
                f"{a}|{b}": n for (a, b), n in sorted(pair_ds.items())
            },
            "cross_dataset_examples": cross_ds_examples,
        },
        "label_conflicts": {
            "explanation": (
                "Near-identical images carrying different class codes. Each pair is "
                "either a labelling error or a genuinely ambiguous case; both matter "
                "for the split strategy."
            ),
            "pairs_by_code_pair": {
                f"{a}|{b}": n for (a, b), n in pair_class.most_common(40)
            },
            "examples": cross_class_examples,
        },
        "dedup_counts_by_class": {
            f"{ds}|{group}|{raw}": n for (ds, group, raw), n in sorted(dedup_by_code.items())
        },
        "class_map_reconciliation": {
            "mapped_codes_dedup_counts": dict(sorted(mapped_codes.items())),
            "unmapped_raw_classes": unmapped,
            "rice_planned_codes_with_no_data": rice_missing,
        },
        "publisher_split_leakage": split_leakage,
        "cotton_od1_gate": cotton,
        "decode_failures": failures[:50],
        "contact_sheets": {
            "count": len(sheets),
            "directory": SHEET_DIR.relative_to(REPO_ROOT).as_posix(),
            "committed": False,
            "sheets": sheets,
        },
    }

    REPORT_PATH.write_text(
        json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    print(f"\nreport written: {REPORT_PATH.relative_to(REPO_ROOT)}", flush=True)
    if args.only:
        print(
            "WARNING: --only was used, so this report covers "
            f"{', '.join(selected)} and NOTHING ELSE. Cross-dataset duplicate "
            "analysis is meaningless in a partial run. Re-run without --only "
            "before relying on the report.",
            flush=True,
        )
    print(
        f"images={len(all_items)} decode_failures={len(failures)} "
        f"near_dup_clusters={len(multi)} redundant={sum(ds_redundant.values())} "
        f"cross_dataset_clusters={cross_ds_clusters}",
        flush=True,
    )
    if MANIFEST_PATH.is_file():
        manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
        print(f"manifest-raw.json present ({len(manifest.get('datasets', []))} entries)")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
