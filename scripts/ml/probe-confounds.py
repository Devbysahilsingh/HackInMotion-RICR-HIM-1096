#!/usr/bin/env python3
"""
Source/background confound probe (P0-6 follow-up).

Answers one question with evidence instead of intuition: **can a class be
identified from its capture style rather than from the disease?**

This trains nothing. Separability is measured with a fixed, hand-written
background statistic and an exhaustive threshold sweep — a deterministic
measurement, not a learned model. That is deliberate: a learned probe would
itself need training data and would invite the question of whether the probe
overfit. A single hand-picked feature that already separates two sources is a
*lower bound* on how easy the shortcut is; a model would only do better.

Method
------
1. Reuse the P0-5 audit's cached 64x64 grayscale thumbnails (no image re-reads).
2. For each image compute two background descriptors from the outer 8-pixel ring
   only — the region a leaf rarely occupies and a background always does:
     * ``border_mean``  — how bright the surround is (cut-outs on white ≈ 255)
     * ``border_std``   — how textured it is (paper/soil/foliage ≫ flat white)
3. For each crop, sweep every threshold on each descriptor and report the best
   achievable accuracy at telling one source dataset from another. High values
   mean the shortcut is available to any model.
4. Independently, flag every class PAIR whose images come from disjoint source
   sets — those are the pairs where the shortcut is also a perfect label.

Usage
-----
    python scripts/ml/probe-confounds.py
    python scripts/ml/probe-confounds.py --crop chilli
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import sys
from collections import defaultdict
from datetime import datetime, UTC
from itertools import combinations
from pathlib import Path

import numpy as np

REPO_ROOT = Path(__file__).resolve().parents[2]
DATASETS_DIR = REPO_ROOT / "datasets"
AUDIT_SCRIPT = Path(__file__).resolve().parent / "audit-datasets.py"
RULES_PATH = Path(__file__).resolve().parent / "curation-rules.json"
OUT_PATH = DATASETS_DIR / "confound-report.json"

BORDER = 8  # width of the ring treated as "background"
# A source that can be identified this reliably is a shortcut a model will find.
SEPARABLE_AT = 0.90


def load_audit():
    spec = importlib.util.spec_from_file_location("audit_datasets", AUDIT_SCRIPT)
    module = importlib.util.module_from_spec(spec)
    sys.modules["audit_datasets"] = module
    spec.loader.exec_module(module)
    return module


def border_stats(thumbs: np.ndarray, side: int) -> tuple[np.ndarray, np.ndarray]:
    """Mean and std of the outer ring of each thumbnail."""
    imgs = thumbs.reshape(-1, side, side).astype(np.float32)
    mask = np.zeros((side, side), dtype=bool)
    mask[:BORDER, :] = mask[-BORDER:, :] = True
    mask[:, :BORDER] = mask[:, -BORDER:] = True
    ring = imgs[:, mask]
    return ring.mean(axis=1), ring.std(axis=1)


def best_threshold_accuracy(a: np.ndarray, b: np.ndarray) -> dict:
    """Best accuracy separating two groups with one threshold on one feature.

    Exhaustive over every midpoint between observed values — no fitting, no
    randomness, no held-out set needed because there is nothing to overfit: the
    result is simply the best this fixed feature can possibly do.
    """
    if len(a) == 0 or len(b) == 0:
        return {"accuracy": None, "threshold": None}
    values = np.concatenate([a, b])
    labels = np.concatenate([np.zeros(len(a)), np.ones(len(b))])
    order = np.argsort(values, kind="stable")
    values, labels = values[order], labels[order]
    # Cumulative counts give every threshold's accuracy in one pass.
    ones_below = np.cumsum(labels)
    zeros_below = np.cumsum(1 - labels)
    total_ones, total_zeros = labels.sum(), len(labels) - labels.sum()
    # predict "a" below threshold, "b" above (and the mirrored rule)
    correct = zeros_below + (total_ones - ones_below)
    mirrored = ones_below + (total_zeros - zeros_below)
    acc = np.maximum(correct, mirrored) / len(labels)
    i = int(np.argmax(acc))
    return {
        "accuracy": round(float(acc[i]), 4),
        "threshold": round(float(values[i]), 2),
    }


def main() -> int:
    ap = argparse.ArgumentParser(description="Source/background confound probe.")
    ap.add_argument("--crop", help="restrict to one crop prefix, e.g. chilli")
    args = ap.parse_args()
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # noqa: BLE001, S110 - best-effort UTF-8 console
        pass

    audit = load_audit()
    rules = json.loads(RULES_PATH.read_text(encoding="utf-8"))
    excluded_groups = {(r["dataset"], r["group"]) for r in rules["excluded_groups"]}
    excluded_classes = {r["code"] for r in rules["excluded_classes"]}
    workers = max(1, (os.cpu_count() or 2) - 1)

    print("== load cached hashes/thumbnails ==", flush=True)
    items, blocks = [], []
    for ds in audit.LAYOUTS:
        ds_items, _ = audit.enumerate_dataset(ds)
        ok, _fail, block = audit.probe_dataset(ds, ds_items, workers, False)
        items.extend(ok)
        blocks.append(block)
    thumbs = np.vstack(blocks)

    keep = [
        i
        for i, it in enumerate(items)
        if it.code and it.code not in excluded_classes and (it.dataset, it.group) not in excluded_groups
    ]
    items = [items[i] for i in keep]
    thumbs = thumbs[keep]
    mean, std = border_stats(thumbs, audit.THUMB_SIDE)

    by_crop = defaultdict(list)
    for idx, it in enumerate(items):
        crop = it.code.split("_")[0]
        if args.crop and crop.lower() != args.crop.lower():
            continue
        by_crop[crop].append(idx)

    report = {
        "schema_version": 1,
        "generated_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "method": {
            "feature": f"mean and std of the outer {BORDER}px ring of the 64x64 grayscale thumbnail",
            "classifier": "exhaustive single-threshold sweep — deterministic measurement, no model is trained",
            "interpretation": "a LOWER BOUND on how easily a model can identify the "
            "source dataset; a learned model would do at least as well",
            "separable_at": SEPARABLE_AT,
        },
        "crops": {},
    }

    for crop, idxs in sorted(by_crop.items()):
        sources = defaultdict(list)
        for i in idxs:
            sources[items[i].dataset].append(i)
        class_sources = defaultdict(set)
        class_counts = defaultdict(lambda: defaultdict(int))
        for i in idxs:
            class_sources[items[i].code].add(items[i].dataset)
            class_counts[items[i].code][items[i].dataset] += 1

        entry = {
            "images": len(idxs),
            "sources": {k: len(v) for k, v in sorted(sources.items())},
            "class_source_composition": {c: dict(sorted(class_counts[c].items())) for c in sorted(class_counts)},
        }

        # How separable are the source datasets themselves?
        pairs = {}
        for a, b in combinations(sorted(sources), 2):
            ia, ib = sources[a], sources[b]
            m = best_threshold_accuracy(mean[ia], mean[ib])
            s = best_threshold_accuracy(std[ia], std[ib])
            best = max(m, s, key=lambda r: r["accuracy"] or 0)
            pairs[f"{a}|{b}"] = {
                "border_mean": m,
                "border_std": s,
                "best_accuracy": best["accuracy"],
                "verdict": (
                    "SEPARABLE — source is a usable shortcut"
                    if (best["accuracy"] or 0) >= SEPARABLE_AT
                    else "not trivially separable by this feature"
                ),
            }
        entry["source_separability"] = pairs

        # Which class pairs could be told apart by source alone?
        disjoint = []
        for c1, c2 in combinations(sorted(class_sources), 2):
            if not (class_sources[c1] & class_sources[c2]):
                disjoint.append(
                    {
                        "classes": [c1, c2],
                        "sources": [sorted(class_sources[c1]), sorted(class_sources[c2])],
                    }
                )
        entry["source_disjoint_class_pairs"] = disjoint
        entry["single_source_classes"] = sorted(c for c, s in class_sources.items() if len(s) == 1)
        worst = max((p["best_accuracy"] or 0) for p in pairs.values()) if pairs else 0.0
        entry["confounded"] = bool(disjoint) and worst >= SEPARABLE_AT
        report["crops"][crop] = entry

        print(f"\n-- {crop} ({len(idxs)} images, {len(sources)} sources)", flush=True)
        for name, p in pairs.items():
            print(f"   {name}: best={p['best_accuracy']}  {p['verdict']}")
        if disjoint:
            print(f"   source-disjoint class pairs: {len(disjoint)}")
            for d in disjoint[:6]:
                print(f"     {d['classes'][0]} vs {d['classes'][1]}")
        print(f"   CONFOUNDED: {entry['confounded']}")

    OUT_PATH.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nreport → {OUT_PATH.relative_to(REPO_ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
