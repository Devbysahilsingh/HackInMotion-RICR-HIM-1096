#!/usr/bin/env python3
"""
Field-test review sheets (P0-6 follow-up).

The field test set is the only place we publish an honest lab-to-field number,
so junk in it corrupts the headline result. The P0-5 audit already found a
screenshot of a web factsheet and a photograph of chopped herbs filed as leaves,
plus burned-in stock watermarks whose filenames give nothing away — none of which
any filename rule can catch.

This renders every field-test image into numbered contact sheets **with an index**,
so a reviewer can name cell `train/Tomato leaf/03` and have it resolve to an exact
path. Findings go into ``manual-quarantine.json`` as data, with a reason and a
named reviewer per entry; nothing is deleted and no label is changed.

Usage
-----
    python scripts/ml/review-fieldtest.py
    python scripts/ml/review-fieldtest.py --per-sheet 24
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path

from PIL import Image, ImageDraw

REPO_ROOT = Path(__file__).resolve().parents[2]
DATASETS_DIR = REPO_ROOT / "datasets"
RAW_DIR = DATASETS_DIR / "raw"
FIELDTEST_TSV = DATASETS_DIR / "splits" / "fieldtest.tsv"
OUT_DIR = DATASETS_DIR / "audit" / "fieldtest-review"

THUMB = 200
COLS = 6
LABEL_H = 16


def safe(text: str) -> str:
    return "".join(c if c.isalnum() or c in "-_" else "_" for c in text)


def render(paths: list[str], out: Path, per_sheet: int) -> list[dict]:
    """Render numbered sheets; return the index rows for these images."""
    index = []
    for start in range(0, len(paths), per_sheet):
        chunk = paths[start : start + per_sheet]
        rows = (len(chunk) + COLS - 1) // COLS
        sheet = Image.new(
            "RGB", (COLS * THUMB, rows * (THUMB + LABEL_H)), "black"
        )
        draw = ImageDraw.Draw(sheet)
        for k, rel in enumerate(chunk):
            cell = start + k
            x0 = (k % COLS) * THUMB
            y0 = (k // COLS) * (THUMB + LABEL_H)
            try:
                with Image.open(RAW_DIR / rel) as img:
                    img = img.convert("RGB")
                    img.thumbnail((THUMB, THUMB), Image.Resampling.LANCZOS)
                    sheet.paste(
                        img,
                        (x0 + (THUMB - img.width) // 2, y0 + (THUMB - img.height) // 2),
                    )
            except Exception:  # noqa: BLE001 - a broken image is itself a finding
                draw.rectangle([x0, y0, x0 + THUMB, y0 + THUMB], outline="red")
            draw.text((x0 + 3, y0 + THUMB + 2), f"{cell:03d}", fill="white")
            index.append({"cell": f"{cell:03d}", "path": rel})
        sheet_path = out.with_name(f"{out.name}__{start // per_sheet:02d}.jpg")
        sheet_path.parent.mkdir(parents=True, exist_ok=True)
        sheet.save(sheet_path, "JPEG", quality=85)
    return index


def main() -> int:
    ap = argparse.ArgumentParser(description="Render field-test review sheets.")
    ap.add_argument("--per-sheet", type=int, default=30)
    args = ap.parse_args()
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # noqa: BLE001
        pass

    if not FIELDTEST_TSV.is_file():
        raise SystemExit(
            f"FATAL: {FIELDTEST_TSV} not found — run prepare-datasets.py first."
        )

    by_class: dict[str, list[str]] = defaultdict(list)
    for line in FIELDTEST_TSV.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        rel, code, _ds = line.split("\t")
        by_class[code].append(rel)

    index: dict[str, list[dict]] = {}
    total = 0
    for code, paths in sorted(by_class.items()):
        paths.sort()
        index[code] = render(paths, OUT_DIR / safe(code), args.per_sheet)
        total += len(paths)
        print(f"  {code:32s} {len(paths):5d} images", flush=True)

    (OUT_DIR / "index.json").write_text(
        json.dumps(index, indent=1, ensure_ascii=False), encoding="utf-8"
    )
    print(f"\n{total} images across {len(by_class)} classes → {OUT_DIR}")
    print("index.json maps every numbered cell to its path.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
