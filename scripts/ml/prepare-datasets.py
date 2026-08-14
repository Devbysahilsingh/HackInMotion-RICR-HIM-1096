#!/usr/bin/env python3
"""
Dataset preparation for the custom crop-health model (TODO P0-6).

Turns the approved curation decisions (ADR-021, encoded in curation-rules.json)
into a reproducible split manifest. It does NOT train, does not preprocess
images, and does not modify or delete anything under datasets/raw/ — every
"exclusion" is a line in a manifest, reversible by editing a rule.

Design
------
* **Manifest over copying.** dataset-preparation.md originally called for copying
  images into ``datasets/prepared/<classCode>/``. That would duplicate several GB
  and add a silent way for the working copy to drift from the source. Instead the
  manifest references raw paths, so there is exactly one copy of every image and
  provenance is preserved by construction. Preprocessing stays where the plan puts
  it: in the train-time transform pipeline.
* **Cluster-atomic splits.** Near-duplicate clusters are computed by importing the
  P0-5 audit's own functions rather than reimplementing them, so the definition of
  "duplicate" cannot drift between the audit and the splits. Every member of a
  cluster lands in the same split; leakage is then asserted, not hoped for.
* **Allocation, not gate-lowering.** A class whose 15% test share falls below the
  50-image acceptance floor gets a larger test fraction (capped), per ADR-021
  decision 7. Classes that still cannot reach 50 are reported as gate failures.
* **Split lists are derived artifacts.** ``datasets/manifest.json`` (committed)
  carries counts, rules, seed and a SHA-256 over each split's file list. The lists
  themselves land in ``datasets/splits/`` (gitignored) because they are large and
  exactly regenerable. Same raw + same rules + same seed ⇒ identical hashes.

Usage
-----
    python scripts/ml/prepare-datasets.py
    python scripts/ml/prepare-datasets.py --dry-run     # report only, write nothing
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import random
import sys
from collections import Counter, defaultdict
from datetime import datetime, UTC
from pathlib import Path

import numpy as np

REPO_ROOT = Path(__file__).resolve().parents[2]
DATASETS_DIR = REPO_ROOT / "datasets"
RAW_DIR = DATASETS_DIR / "raw"
SPLIT_DIR = DATASETS_DIR / "splits"
MANIFEST_PATH = DATASETS_DIR / "manifest.json"
RULES_PATH = Path(__file__).resolve().parent / "curation-rules.json"
AUDIT_SCRIPT = Path(__file__).resolve().parent / "audit-datasets.py"
AUDIT_REPORT = DATASETS_DIR / "audit-report.json"

SPLITS = ("train", "val", "test")


def load_audit_module():
    """Import the audit script by path (its filename is not a valid module name).

    Reusing its enumeration, hashing and duplicate-detection code is deliberate:
    if the splits used a second implementation of "near-duplicate", the leakage
    guarantee would only hold for whichever definition happened to match.
    """
    spec = importlib.util.spec_from_file_location("audit_datasets", AUDIT_SCRIPT)
    if spec is None or spec.loader is None:
        raise SystemExit(f"FATAL: cannot load {AUDIT_SCRIPT}")
    module = importlib.util.module_from_spec(spec)
    sys.modules["audit_datasets"] = module
    spec.loader.exec_module(module)
    return module


def sha256_of_lines(lines: list[str]) -> str:
    h = hashlib.sha256()
    for line in lines:
        h.update(line.encode("utf-8"))
        h.update(b"\n")
    return h.hexdigest()


# ---------------------------------------------------------------------------
# Curation
# ---------------------------------------------------------------------------


def apply_curation(items, rules, audit) -> tuple[list, list[dict], dict]:
    """Split items into (kept, excluded-with-reason, stats)."""
    kept, excluded = [], []
    roles = rules["dataset_roles"]
    excluded_groups = {
        (r["dataset"], r["group"]): r for r in rules["excluded_groups"]
    }
    excluded_classes = {r["code"]: r for r in rules["excluded_classes"]}
    stock_patterns = [
        p.lower() for p in rules["quarantine"]["stock_provenance_filename_patterns"]
    ]
    manual_path = REPO_ROOT / rules["manual_quarantine_file"]
    manual, coverage = {}, None
    if manual_path.is_file():
        doc = json.loads(manual_path.read_text(encoding="utf-8"))
        coverage = doc.get("review_coverage_totals")
        for e in doc["entries"]:
            manual[e["path"]] = e

    # Byte-identical files filed under two different class codes: quarantine
    # every copy. Computed here rather than read from the report so it stays
    # correct if the corpus changes.
    by_sha = defaultdict(list)
    for it in items:
        by_sha[it.sha1].append(it)
    contradicted: set[str] = set()
    for group in by_sha.values():
        codes = {g.code for g in group if g.code}
        if len(codes) > 1:
            contradicted.update(g.relpath for g in group)

    stats = Counter()
    for it in items:
        reason = None
        rule = None
        if it.dataset not in roles:
            reason, rule = "dataset has no declared role", "dataset_roles"
        elif (it.dataset, it.group) in excluded_groups:
            r = excluded_groups[(it.dataset, it.group)]
            reason, rule = r["reason"], r["decision"]
        elif it.code is None:
            reason = rules["unmapped_class_policy"]["reason"]
            rule = "unmapped_class_policy"
        elif it.code in excluded_classes:
            r = excluded_classes[it.code]
            reason, rule = r["reason"], r["decision"]
        elif it.relpath in contradicted:
            reason = rules["quarantine"]["label_contradiction_rule"]["reason"]
            rule = "quarantine.label_contradiction"
        elif it.relpath in manual:
            e = manual[it.relpath]
            reason = f"[{e['category']}] {e['reason']} (reviewer: {e['reviewer']})"
            rule = "quarantine.manual_review"
        else:
            name = Path(it.relpath).name.lower()
            hit = next((p for p in stock_patterns if p in name), None)
            if hit:
                reason = (
                    f"filename carries stock-agency provenance ('{hit}'): "
                    + rules["quarantine"]["stock_provenance_reason"]
                )
                rule = "quarantine.stock_provenance"

        if reason is None:
            kept.append(it)
        else:
            stats[rule] += 1
            excluded.append(
                {
                    "path": it.relpath,
                    "dataset": it.dataset,
                    "group": it.group,
                    "raw_class": it.raw_class,
                    "code": it.code,
                    "rule": rule,
                    "reason": reason,
                }
            )
    return kept, excluded, dict(stats), coverage


# ---------------------------------------------------------------------------
# Splitting
# ---------------------------------------------------------------------------


def test_fraction_for(n_clusters_images: int, rules: dict) -> float:
    """Raise the test share when 15% would miss the >=50-image acceptance floor."""
    base = rules["split_fractions"]["test"]
    floor = rules["min_test_images_per_class"]
    cap = rules["max_test_fraction"]
    if n_clusters_images * base >= floor:
        return base
    return min(cap, floor / max(1, n_clusters_images))


def assign_clusters(clusters: list[list], targets: dict[str, float], rng) -> dict:
    """Greedy cluster-atomic assignment: biggest cluster to the neediest split.

    Deterministic given the seed. Clusters are never broken, which is what makes
    the leakage assertion hold rather than merely being likely.
    """
    order = sorted(clusters, key=lambda c: (-len(c), c[0].relpath))
    assigned = {s: [] for s in SPLITS}
    counts = {s: 0 for s in SPLITS}
    total = sum(len(c) for c in clusters)
    for cluster in order:
        deficits = {
            s: targets[s] * total - counts[s]
            for s in SPLITS
            if targets[s] > 0
        }
        pick = max(deficits, key=lambda s: (deficits[s], -SPLITS.index(s)))
        assigned[pick].extend(cluster)
        counts[pick] += len(cluster)
    for s in SPLITS:
        rng.shuffle(assigned[s])
    return assigned


def main() -> int:
    ap = argparse.ArgumentParser(description="P0-6 dataset preparation (no training).")
    ap.add_argument("--dry-run", action="store_true", help="report only; write nothing")
    ap.add_argument("--workers", type=int, default=None)
    args = ap.parse_args()

    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # noqa: BLE001, S110 - best-effort UTF-8 console
        pass

    rules = json.loads(RULES_PATH.read_text(encoding="utf-8"))
    audit = load_audit_module()
    workers = args.workers or max(1, (os.cpu_count() or 2) - 1)

    print("== enumerate + hash (reusing the P0-5 audit cache) ==", flush=True)
    items, thumb_blocks, failures = [], [], []
    for ds in audit.LAYOUTS:
        ds_items, _notes = audit.enumerate_dataset(ds)
        ok, fail, block = audit.probe_dataset(ds, ds_items, workers, False)
        items.extend(ok)
        thumb_blocks.append(block)
        failures.extend(fail)
    if failures:
        raise SystemExit(
            f"FATAL: {len(failures)} images failed to decode. Preparation refuses to "
            "build splits over a corpus it cannot fully read."
        )
    thumbs = np.vstack(thumb_blocks)
    print(f"  {len(items)} images", flush=True)

    print("== apply curation rules ==", flush=True)
    kept, excluded, exclusion_stats, manual_review_coverage = apply_curation(
        items, rules, audit
    )
    print(f"  kept {len(kept)}, excluded {len(excluded)}", flush=True)
    for rule, n in sorted(exclusion_stats.items(), key=lambda kv: -kv[1]):
        print(f"    {n:6d}  {rule}", flush=True)

    print("== near-duplicate clustering (audit definition) ==", flush=True)
    uf = audit.UnionFind(len(kept))
    # `thumbs` is aligned to `items`; curation removed rows, so realign to `kept`.
    item_pos = {it.relpath: i for i, it in enumerate(items)}
    stats = {
        "candidates": 0,
        "verified": 0,
        "ncc_hist": Counter(),
        "thumbs": thumbs[[item_pos[it.relpath] for it in kept]],
    }
    for i, j, _d, _n in audit.verified_pairs(
        kept, audit.DEFAULT_THRESHOLD, audit.DEFAULT_NCC_MIN, stats
    ):
        uf.union(i, j)
    cluster_of = {}
    for idx in range(len(kept)):
        cluster_of[kept[idx].relpath] = uf.find(idx)
    print(f"  {stats['verified']} verified duplicate pairs", flush=True)

    # ---- collapse duplicates to one representative ------------------------
    # Counting files instead of distinct images would up-weight whichever source
    # is most redundant and would score the same photograph repeatedly in test.
    members = defaultdict(list)
    for it in kept:
        members[cluster_of[it.relpath]].append(it)
    representatives = []
    for _cluster, group in members.items():
        group.sort(key=lambda it: it.relpath)
        representatives.append(group[0])
        for dup in group[1:]:
            excluded.append(
                {
                    "path": dup.relpath,
                    "dataset": dup.dataset,
                    "group": dup.group,
                    "raw_class": dup.raw_class,
                    "code": dup.code,
                    "rule": "duplicate_collapse",
                    "reason": rules["duplicate_collapse"]["reason"],
                    "representative": group[0].relpath,
                }
            )
    dropped = len(kept) - len(representatives)
    exclusion_stats["duplicate_collapse"] = dropped
    print(
        f"  collapsed {len(kept)} images → {len(representatives)} unique "
        f"({dropped} duplicate copies excluded)",
        flush=True,
    )
    kept = representatives

    # ---- role separation -------------------------------------------------
    roles = rules["dataset_roles"]
    trainval = [it for it in kept if roles[it.dataset] == "trainval"]
    fieldtest = [it for it in kept if roles[it.dataset] == "fieldtest"]

    # ---- per-class, cluster-atomic splits --------------------------------
    print("== split ==", flush=True)
    # Seeded from the rules file so a split is reproducible from the manifest.
    # Reproducibility is the whole requirement here; crypto strength is not.
    rng = random.Random(rules["seed"])  # noqa: S311
    assignment: dict[str, list] = {s: [] for s in SPLITS}
    class_report = {}
    gate_failures = []
    for code in sorted({it.code for it in trainval}):
        cls_items = [it for it in trainval if it.code == code]
        groups = defaultdict(list)
        for it in cls_items:
            groups[cluster_of[it.relpath]].append(it)
        clusters = list(groups.values())
        n = len(cls_items)
        t_frac = test_fraction_for(n, rules)
        v_frac = rules["split_fractions"]["val"]
        targets = {"test": t_frac, "val": v_frac, "train": 1.0 - t_frac - v_frac}

        # Stratify by SOURCE as well as class. The confound probe measured that
        # source datasets are separable from background alone (chilli 0.91,
        # rice 0.96), so a split that happened to align with source would let a
        # model score by recognising capture style. Splitting each source
        # independently makes every split carry the same source mix.
        by_source = defaultdict(list)
        for cluster in clusters:
            sources = {it.dataset for it in cluster}
            if len(sources) > 1:
                raise SystemExit(
                    f"FATAL: duplicate cluster spans sources {sorted(sources)} in "
                    f"{code}; source stratification would be ill-defined."
                )
            by_source[sources.pop()].append(cluster)
        got = {s: [] for s in SPLITS}
        for source in sorted(by_source):
            part = assign_clusters(by_source[source], targets, rng)
            for s in SPLITS:
                got[s].extend(part[s])
        for s in SPLITS:
            assignment[s].extend(got[s])
        sources_here = dict(Counter(it.dataset for it in cls_items))
        entry = {
            "images": n,
            "clusters": len(clusters),
            "sources": sources_here,
            "single_source": len(sources_here) == 1,
            "test_fraction": round(t_frac, 4),
            "test_fraction_raised": t_frac > rules["split_fractions"]["test"],
            "source_split_balance": {
                s: dict(Counter(it.dataset for it in got[s])) for s in SPLITS
            },
            **{s: len(got[s]) for s in SPLITS},
        }
        if len(got["test"]) < rules["min_test_images_per_class"]:
            entry["gate"] = "FAIL: fewer than min_test_images_per_class"
            gate_failures.append(code)
        class_report[code] = entry
        flag = " ⚠" if code in gate_failures else ""
        raised = " (test share raised)" if entry["test_fraction_raised"] else ""
        print(
            f"  {code:32s} n={n:6d} train={entry['train']:6d} "
            f"val={entry['val']:5d} test={entry['test']:5d}{raised}{flag}",
            flush=True,
        )

    # ---- assertions ------------------------------------------------------
    print("== leakage assertions ==", flush=True)
    where = {}
    for s in SPLITS:
        for it in assignment[s]:
            where[it.relpath] = s
    split_of_cluster = defaultdict(set)
    for path, s in where.items():
        split_of_cluster[cluster_of[path]].add(s)
    spanning = [c for c, ss in split_of_cluster.items() if len(ss) > 1]
    if spanning:
        raise SystemExit(
            f"FATAL: {len(spanning)} duplicate clusters span more than one split. "
            "Cluster-atomic assignment is broken; refusing to write a manifest."
        )
    # Collapse already guarantees this; the assertion stays so that re-enabling
    # duplicate retention later cannot silently reintroduce cross-split leakage.
    print(f"  ✔ 0 duplicate clusters span splits ({len(split_of_cluster)} clusters)")

    ft_clusters = {cluster_of[it.relpath] for it in fieldtest}
    tv_clusters = {cluster_of[it.relpath] for it in trainval}
    overlap = ft_clusters & tv_clusters
    if overlap:
        raise SystemExit(
            f"FATAL: {len(overlap)} clusters appear in both the field test set and "
            "the train/val pool. The field benchmark would be contaminated."
        )
    print("  ✔ 0 clusters shared between field test and train/val pool")

    ft_paths = {it.relpath for it in fieldtest}
    if ft_paths & set(where):
        raise SystemExit("FATAL: a field-test image was also assigned a train split.")
    print("  ✔ field test set is disjoint from every split")

    # ---- write -----------------------------------------------------------
    split_lists = {
        s: sorted(f"{it.relpath}\t{it.code}\t{it.dataset}" for it in assignment[s])
        for s in SPLITS
    }
    split_lists["fieldtest"] = sorted(
        f"{it.relpath}\t{it.code}\t{it.dataset}" for it in fieldtest
    )
    quarantine_lines = sorted(
        f"{e['path']}\t{e['rule']}" for e in excluded if e["rule"].startswith("quarantine")
    )

    manifest = {
        "schema_version": 1,
        "todo": "P0-6",
        "generated_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "rules": {
            "path": "scripts/ml/curation-rules.json",
            "version": rules["version"],
            "authority": rules["authority"],
            "sha256": hashlib.sha256(RULES_PATH.read_bytes()).hexdigest(),
        },
        "reproducibility": {
            "seed": rules["seed"],
            "contract": (
                "same raw corpus + same curation-rules.json + same script ⇒ identical "
                "split hashes below. Split member lists live in datasets/splits/ and "
                "are derived artifacts, regenerable and gitignored."
            ),
            "audit_report": {
                "path": "datasets/audit-report.json",
                "sha256": hashlib.sha256(AUDIT_REPORT.read_bytes()).hexdigest()
                if AUDIT_REPORT.is_file()
                else None,
            },
        },
        "totals": {
            "images_enumerated": len(items),
            "kept": len(kept),
            "excluded": len(excluded),
            "trainval_pool": len(trainval),
            "fieldtest": len(fieldtest),
            **{s: len(assignment[s]) for s in SPLITS},
        },
        "exclusions_by_rule": exclusion_stats,
        "splits": {
            name: {"images": len(lines), "sha256": sha256_of_lines(lines)}
            for name, lines in split_lists.items()
        },
        "classes": class_report,
        "acceptance_gates": {
            "no_cluster_spans_splits": "PASS",
            "fieldtest_disjoint_from_trainval": "PASS",
            "min_test_images_per_class": "FAIL" if gate_failures else "PASS",
            "classes_below_min_test": gate_failures,
        },
        "known_confounds": rules["known_confounds"],
        "source_stratified_splits": rules["source_stratified_splits"],
        "field_test_review": {
            "quarantined_after_visual_review": sum(
                1 for e in excluded if e["rule"] == "quarantine.manual_review"
            ),
            "coverage": manual_review_coverage,
            "outstanding": (
                "Images not yet reviewed may still contain pixel-burned watermarks, "
                "screenshots or composite figures — filename rules do not catch them. "
                "Any field-test number published before the remainder is reviewed must "
                "state this coverage."
            ),
        },
        "pre_training_checks_required": rules["pre_training_checks_required"],
        "support_tiers": rules["support_tiers"],
        "known_limitations": [
            "RICE_NORMAL is 100% studio imagery; healthy-rice field performance is "
            "UNVALIDATED and must not be claimed (ADR-021 decision 2, option c).",
            "Both chilli sources are studio imagery separable by capture style; the "
            "merged chilli label space is not trusted until the source-separability "
            "probe runs (ADR-021 decision 4).",
            "Stock-image quarantine is filename-evidence only. Pixel-burned watermarks "
            "with neutral filenames are NOT caught and need the human review queue.",
            "Rotated/mirrored publisher augmentations are undetectable by the duplicate "
            "method; augmented groups are excluded by construction, not by detection.",
        ],
    }

    if args.dry_run:
        print("\n-- dry run: nothing written --")
        print(json.dumps(manifest["totals"], indent=2))
        return 0

    SPLIT_DIR.mkdir(parents=True, exist_ok=True)
    for name, lines in split_lists.items():
        (SPLIT_DIR / f"{name}.tsv").write_text("\n".join(lines) + "\n", encoding="utf-8")
    (SPLIT_DIR / "quarantine.tsv").write_text(
        "\n".join(quarantine_lines) + "\n", encoding="utf-8"
    )
    (SPLIT_DIR / "exclusions.json").write_text(
        json.dumps(excluded, indent=1, ensure_ascii=False), encoding="utf-8"
    )
    MANIFEST_PATH.write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8"
    )

    print(f"\nmanifest → {MANIFEST_PATH.relative_to(REPO_ROOT)}")
    print(f"split lists → {SPLIT_DIR.relative_to(REPO_ROOT)}/ (gitignored, derived)")
    print(
        f"train={len(assignment['train'])} val={len(assignment['val'])} "
        f"test={len(assignment['test'])} fieldtest={len(fieldtest)} "
        f"excluded={len(excluded)}"
    )
    if gate_failures:
        print(f"⚠ acceptance gate: classes below min test size: {gate_failures}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
