"""Training entry point.

    python train.py --run run0            # ResNet18 sanity
    python train.py --run run1            # EffNet-B0 head warmup
    python train.py --run run2 --resume   # EffNet-B0 fine-tune, resume-safe

Every run is reproducible from `config.yaml` + `datasets/manifest.json`, and
records both of their hashes into `experiments.md`. Nothing in this file invents
a number: metrics are what the loops measured, and a run that fails its gate is
written down as failed (docs/ml/training-plan.md).

Run instructions (training-plan.md, "GPU memory guardrails"): plug the laptop
in and disable sleep before a long run. Thermal throttling on this chassis is
expected and the wall-clock estimates in the plan already allow for it.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import platform
import random
import sys
import time
from collections import Counter
from datetime import datetime, UTC
from pathlib import Path

import numpy as np
import torch
import yaml
from torch import nn

from data import (
    SplitDataset,
    build_loader,
    build_transforms,
    class_weights,
    load_class_order,
    read_split,
    sampler_for,
)
from engine import evaluate, train_one_epoch
from models import apply_freeze, build_model, head_bias_init, trainable_parameters

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]

# Windows consoles default to cp1252, which cannot encode the box-drawing and
# em-dash characters this script and config.yaml both use — printing one raises
# UnicodeEncodeError and kills the run. Reconfiguring stdout to UTF-8 with
# replacement is the fix that works whatever code page the terminal is in.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")


def sha256_of(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def set_seeds(seed: int, cudnn_benchmark: bool) -> None:
    """Seed every generator the run touches.

    `cudnn.benchmark` is left on per the plan, which means kernel selection —
    and therefore the last bits of floating point — can vary between machines.
    That is an accepted, documented non-determinism, not an oversight: the seeds
    below still make data order, augmentation and initialisation reproducible.
    """
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    torch.cuda.manual_seed_all(seed)
    torch.backends.cudnn.benchmark = cudnn_benchmark


def device_report() -> dict:
    """What the run actually executed on. Written into the log verbatim."""
    if not torch.cuda.is_available():
        return {"device": "cpu", "cuda": False, "torch": torch.__version__}

    free, total = torch.cuda.mem_get_info()
    return {
        "device": torch.cuda.get_device_name(0),
        "cuda": True,
        "cuda_version": torch.version.cuda,
        "torch": torch.__version__,
        "vram_total_mb": round(total / 1024**2),
        "vram_free_mb": round(free / 1024**2),
    }


def build_everything(config: dict, run: dict, batch_size: int, image_size: int, device):
    """Assemble datasets, loaders, model, loss and optimiser for one attempt.

    Returns a bundle rather than mutating shared state so the OOM fallback chain
    can simply build a fresh, smaller attempt and discard the previous one.
    """
    data_cfg = config["data"]
    splits_dir = REPO / data_cfg["splits_dir"]
    raw_dir = REPO / data_cfg["raw_dir"]
    manifest_path = REPO / data_cfg["manifest"]

    classes = load_class_order(manifest_path)
    class_to_index = {code: index for index, code in enumerate(classes)}

    train_transform, eval_transform = build_transforms(config["image"], config["augment"], image_size)

    train_samples = read_split(splits_dir, raw_dir, "train", class_to_index)
    val_samples = read_split(splits_dir, raw_dir, "val", class_to_index)

    train_set = SplitDataset(train_samples, train_transform)
    val_set = SplitDataset(val_samples, eval_transform)

    optim_cfg = config["optim"]
    power = optim_cfg["class_weight_power"]

    sampler = sampler_for(train_samples, len(classes), power) if optim_cfg["weighted_sampler"] else None

    train_loader = build_loader(
        train_set,
        batch_size,
        config["loader"],
        sampler=sampler,
        shuffle=sampler is None,
    )
    val_loader = build_loader(val_set, batch_size, config["loader"])

    model = build_model(run["arch"], len(classes)).to(device)
    freeze_summary = apply_freeze(model, run["arch"], run["freeze"], run.get("unfreeze_last_blocks", 0))

    counts = Counter(sample.label for sample in train_samples)
    class_counts = torch.tensor([counts.get(index, 0) for index in range(len(classes))], dtype=torch.float32)
    head_bias_init(model, run["arch"], class_counts)

    weight = class_weights(train_samples, len(classes), power).to(device) if optim_cfg["class_weighted_loss"] else None
    criterion = nn.CrossEntropyLoss(weight=weight, label_smoothing=optim_cfg["label_smoothing"])

    optimizer = torch.optim.AdamW(
        trainable_parameters(model),
        lr=run["lr"],
        weight_decay=optim_cfg["weight_decay"],
    )
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(
        optimizer,
        T_max=run["epochs"],
        eta_min=run.get("lr_min", 0.0),
    )

    return {
        "classes": classes,
        "train_loader": train_loader,
        "val_loader": val_loader,
        "model": model,
        "criterion": criterion,
        "optimizer": optimizer,
        "scheduler": scheduler,
        "freeze_summary": freeze_summary,
        "train_samples": len(train_samples),
        "val_samples": len(val_samples),
        "class_counts": class_counts,
    }


def is_oom(error: BaseException) -> bool:
    return isinstance(error, torch.cuda.OutOfMemoryError) or "out of memory" in str(error).lower()


def attempt_plan(config: dict) -> list[dict]:
    """The batch-size / image-size ladder, best first.

    The first entry is the configured setting; the rest are the plan's fallback
    chain. Every step down is logged when it is taken — "never silent".
    """
    base = {
        "batch_size": config["loader"]["batch_size"],
        "grad_accum": 1,
        "image_size": config["image"]["size"],
    }
    plan = [base]
    for fallback in config["loader"]["oom_fallback"]:
        plan.append({**base, **fallback})
    return plan


def main() -> int:
    parser = argparse.ArgumentParser(description="Train a crop-disease classifier.")
    parser.add_argument("--run", required=True, help="a key under `runs:` in config.yaml")
    parser.add_argument("--config", default=str(HERE / "config.yaml"))
    parser.add_argument("--resume", action="store_true", help="continue from the last checkpoint")
    parser.add_argument(
        "--limit-batches",
        type=int,
        default=0,
        help="stop each epoch after N batches — a smoke test of the wiring, not a run",
    )
    args = parser.parse_args()

    config_path = Path(args.config).resolve()
    config = yaml.safe_load(config_path.read_text(encoding="utf-8"))

    if args.run not in config["runs"]:
        print(f"unknown run {args.run!r}; available: {sorted(config['runs'])}", file=sys.stderr)
        return 2
    run = config["runs"][args.run]

    set_seeds(config["seed"], config["train"]["cudnn_benchmark"])
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    hardware = device_report()
    print(f"== {args.run}: {run['description']}")
    print(f"   device: {json.dumps(hardware)}")

    if not hardware["cuda"]:
        # Not fatal — the pipeline is testable on CPU — but a full run on CPU
        # would take days, so it must never happen by accident.
        print("   WARNING: CUDA is not available; this will be extremely slow.")

    manifest_path = REPO / config["data"]["manifest"]
    provenance = {
        "config_sha256": sha256_of(config_path)[:12],
        "dataset_manifest_sha256": sha256_of(manifest_path)[:12],
    }
    print(f"   provenance: {json.dumps(provenance)}")

    # ── Build, falling back on OOM ────────────────────────────────────────────
    bundle = None
    chosen = None
    fallbacks_taken: list[dict] = []

    for index, attempt in enumerate(attempt_plan(config)):
        try:
            if index > 0:
                print(f"   OOM fallback -> {json.dumps(attempt)}")
                fallbacks_taken.append(attempt)
                torch.cuda.empty_cache()

            bundle = build_everything(config, run, attempt["batch_size"], attempt["image_size"], device)
            # Building the model does not touch the GPU hard enough to prove the
            # setting fits. One real forward+backward does, and failing here is
            # far cheaper than failing forty minutes into epoch one.
            _probe_step(bundle, device, attempt, config["train"]["amp"])
            chosen = attempt
            break
        except Exception as error:
            if not is_oom(error):
                raise
            bundle = None
            torch.cuda.empty_cache()

    if bundle is None:
        print("   every fallback in the chain ran out of memory; nothing was trained.", file=sys.stderr)
        return 1

    print(f"   settings: {json.dumps(chosen)}")
    print(f"   freeze: {json.dumps(bundle['freeze_summary'])}")
    print(f"   data: train={bundle['train_samples']} val={bundle['val_samples']} classes={len(bundle['classes'])}")

    # ── Train ─────────────────────────────────────────────────────────────────
    checkpoint_dir = REPO / config["train"]["checkpoint_dir"] / args.run
    checkpoint_dir.mkdir(parents=True, exist_ok=True)

    scaler = torch.amp.GradScaler("cuda", enabled=config["train"]["amp"] and hardware["cuda"])
    best = {"macro_f1": -1.0, "epoch": -1}
    history: list[dict] = []
    start_epoch = 0
    patience = config["train"]["early_stop_patience"]
    since_improved = 0

    # Two different things that both look like "load a checkpoint", kept apart
    # because conflating them silently destroys a run:
    #
    #   RESUME      continue THIS run after an interruption — restores weights,
    #               optimizer, scheduler, scaler, epoch counter and history.
    #   INIT_FROM   start a NEW run from another run's weights. This is the
    #               plan's schedule: Run 1 warms the head, Run 2 fine-tunes from
    #               it. Weights only — a fresh optimizer and LR schedule, epoch 0.
    #
    # Resume wins when both apply: a half-finished Run 2 must continue from its
    # own last epoch, not restart from Run 1.
    initialised_from = None
    resume_requested = args.resume or run.get("resume")
    resume_path = checkpoint_dir / "last.pt"

    if resume_requested and resume_path.exists():
        state = _load_checkpoint(resume_path, bundle, scaler, device)
        start_epoch = state["epoch"] + 1
        best = state["best"]
        history = state["history"]
        initialised_from = f"resumed:{args.run}@epoch{state['epoch']}"
        print(f"   resumed from epoch {state['epoch']} (best macro-F1 {best['macro_f1']:.4f})")

        if start_epoch >= run["epochs"]:
            print(
                f"   nothing to do: {args.run} already completed {start_epoch} of "
                f"{run['epochs']} epochs. Delete {checkpoint_dir} to retrain."
            )
            return 0
    else:
        if resume_requested:
            # Said out loud rather than silently starting over. Previously this
            # branch was invisible, which is what made the bug below survivable.
            print(f"   no checkpoint at {resume_path} — starting this run from the beginning")

        source = run.get("init_from")
        if source:
            source_path = REPO / config["train"]["checkpoint_dir"] / source / "best.pt"
            if not source_path.exists():
                # A hard failure on purpose. The plan schedules Run 2 to start
                # from Run 1's warmed head; quietly training it from ImageNet
                # with a random head would send large early gradients into the
                # pretrained backbone — the exact damage the warmup exists to
                # prevent — and the only symptom would be a worse final number
                # nobody could explain.
                print(
                    f"   {args.run} is configured to initialise from '{source}', but {source_path} does not exist.",
                    file=sys.stderr,
                )
                print(
                    f"   Run '{source}' first:  python train.py --run {source}",
                    file=sys.stderr,
                )
                return 2

            initialised_from = _initialise_from(source_path, bundle, device, run["arch"])
            print(f"   initialised weights from {source}/best.pt ({initialised_from})")

    started = time.perf_counter()
    status = "completed"

    for epoch in range(start_epoch, run["epochs"]):
        print(f"  epoch {epoch + 1}/{run['epochs']}  lr={bundle['optimizer'].param_groups[0]['lr']:.2e}")

        train_metrics = train_one_epoch(
            bundle["model"],
            _maybe_limit(bundle["train_loader"], args.limit_batches),
            bundle["criterion"],
            bundle["optimizer"],
            scaler,
            device,
            grad_accum=chosen["grad_accum"],
            amp=config["train"]["amp"],
        )

        val_metrics = evaluate(
            bundle["model"],
            _maybe_limit(bundle["val_loader"], args.limit_batches),
            bundle["criterion"],
            device,
            amp=config["train"]["amp"],
            num_classes=len(bundle["classes"]),
        )

        bundle["scheduler"].step()

        record = {
            "epoch": epoch,
            "train_loss": round(train_metrics["loss"], 4),
            "train_acc": round(train_metrics["accuracy"], 4),
            "val_loss": round(val_metrics["loss"], 4),
            "val_acc": round(val_metrics["accuracy"], 4),
            "val_macro_f1": round(val_metrics["macro_f1"], 4),
            "val_top3": round(val_metrics["top3_accuracy"], 4),
            "train_seconds": train_metrics["seconds"],
            "val_seconds": val_metrics["seconds"],
        }
        history.append(record)
        print(f"    {json.dumps(record)}")

        improved = val_metrics["macro_f1"] > best["macro_f1"]
        if improved:
            best = {"macro_f1": val_metrics["macro_f1"], "epoch": epoch}
            since_improved = 0
            _save_checkpoint(checkpoint_dir / "best.pt", bundle, scaler, epoch, best, history, config, run, args.run)
        else:
            since_improved += 1

        _save_checkpoint(checkpoint_dir / "last.pt", bundle, scaler, epoch, best, history, config, run, args.run)

        if since_improved >= patience:
            print(f"    early stop: no val macro-F1 improvement in {patience} epochs")
            status = "early_stopped"
            break

    duration = round(time.perf_counter() - started, 1)

    # ── Gates ─────────────────────────────────────────────────────────────────
    gates = run.get("gates", {})
    final = history[-1] if history else {}
    gate_results = _check_gates(gates, final)
    if gate_results and not all(result["passed"] for result in gate_results):
        status = "failed_gate"

    for result in gate_results:
        mark = "PASS" if result["passed"] else "FAIL"
        print(f"   gate {result['name']}: {mark} ({result['detail']})")

    print(f"   status: {status}  duration: {duration}s  best val macro-F1: {best['macro_f1']:.4f}")

    _append_experiment(
        run_name=args.run,
        run_cfg=run,
        provenance=provenance,
        hardware=hardware,
        chosen=chosen,
        fallbacks=fallbacks_taken,
        freeze_summary=bundle["freeze_summary"],
        history=history,
        best=best,
        gates=gate_results,
        status=status,
        duration=duration,
        limited=args.limit_batches,
        initialised_from=initialised_from,
        counts={"train": bundle["train_samples"], "val": bundle["val_samples"]},
    )

    return 0 if status != "failed_gate" else 1


def _probe_step(bundle, device, attempt, amp: bool) -> None:
    """One real forward+backward, to find an OOM now rather than mid-epoch."""
    model, criterion = bundle["model"], bundle["criterion"]
    model.train()
    images = torch.zeros(attempt["batch_size"], 3, attempt["image_size"], attempt["image_size"], device=device)
    targets = torch.zeros(attempt["batch_size"], dtype=torch.long, device=device)

    with torch.amp.autocast("cuda", enabled=amp and device.type == "cuda"):
        loss = criterion(model(images), targets)
    loss.backward()

    model.zero_grad(set_to_none=True)
    del images, targets, loss
    if device.type == "cuda":
        torch.cuda.empty_cache()


def _maybe_limit(loader, limit: int):
    """Truncate a loader for a wiring smoke test. Zero means no limit."""
    if limit <= 0:
        return loader

    class _Limited:
        def __iter__(self):
            for index, batch in enumerate(loader):
                if index >= limit:
                    return
                yield batch

        def __len__(self):
            return min(limit, len(loader))

    return _Limited()


def _save_checkpoint(path, bundle, scaler, epoch, best, history, config, run_cfg, run_name) -> None:
    torch.save(
        {
            "epoch": epoch,
            "best": best,
            "history": history,
            "model": bundle["model"].state_dict(),
            "optimizer": bundle["optimizer"].state_dict(),
            "scheduler": bundle["scheduler"].state_dict(),
            "scaler": scaler.state_dict(),
            # The class order travels WITH the weights. An export that read it
            # from anywhere else could silently renumber the model's outputs.
            "classes": bundle["classes"],
            "arch": run_cfg["arch"],
            "run": run_name,
            "image_size": config["image"]["size"],
            "preprocessing": config["image"],
        },
        path,
    )


def _initialise_from(path: Path, bundle, device, expected_arch: str) -> str:
    """Load ONLY model weights from another run's checkpoint.

    Optimizer, scheduler and epoch counter are deliberately left fresh: Run 2 is
    a new optimisation problem (different LR, different trainable parameter set),
    so carrying Run 1's Adam moments or cosine position over would be wrong.

    Architecture and class order are checked rather than assumed — a mismatched
    `init_from` would otherwise load silently and train a model whose outputs
    mean something different from its labels.
    """
    state = torch.load(path, map_location=device, weights_only=False)

    if state.get("arch") != expected_arch:
        raise ValueError(f"{path} was trained with arch {state.get('arch')!r}, but this run uses {expected_arch!r}")
    if state.get("classes") != bundle["classes"]:
        raise ValueError(
            f"{path} carries a different class order than the current dataset manifest; "
            "initialising from it would misalign every output index"
        )

    bundle["model"].load_state_dict(state["model"])
    return f"{path.parent.name}/best.pt@epoch{state.get('epoch')}"


def _load_checkpoint(path: Path, bundle, scaler, device):
    if not path.exists():
        return None
    # weights_only=False: our own checkpoint carries the class list and config
    # dicts, not just tensors. The file is written by this script into a
    # gitignored directory, so it is not untrusted input.
    state = torch.load(path, map_location=device, weights_only=False)
    bundle["model"].load_state_dict(state["model"])
    bundle["optimizer"].load_state_dict(state["optimizer"])
    bundle["scheduler"].load_state_dict(state["scheduler"])
    scaler.load_state_dict(state["scaler"])
    return state


def _check_gates(gates: dict, final: dict) -> list[dict]:
    """Evaluate a run's sanity gates against its final epoch."""
    results = []
    accuracy = final.get("val_acc")

    if "min_val_accuracy" in gates:
        threshold = gates["min_val_accuracy"]
        results.append(
            {
                "name": "min_val_accuracy",
                "passed": accuracy is not None and accuracy >= threshold,
                "detail": f"val_acc={accuracy} >= {threshold} (chance is 1/35 = 0.029)",
            }
        )

    if "max_val_accuracy" in gates:
        threshold = gates["max_val_accuracy"]
        results.append(
            {
                "name": "max_val_accuracy",
                "passed": accuracy is not None and accuracy <= threshold,
                # The leakage smell test: a head-only run that nearly saturates
                # says the splits share images, not that the model is excellent.
                "detail": f"val_acc={accuracy} <= {threshold} (leakage smell test)",
            }
        )

    return results


def _append_experiment(**fields) -> None:
    """Append one run to experiments.md.

    Appended, never rewritten: the log is the record of what happened, including
    the runs that failed. `training-plan.md` is explicit — "No fabricated
    numbers; failed runs recorded as failed."
    """
    log = HERE / "experiments.md"
    stamp = datetime.now(UTC).strftime("%Y-%m-%d %H:%M UTC")
    history = fields["history"]

    lines = [
        "",
        f"## {fields['run_name']} — {stamp} — **{fields['status'].upper()}**",
        "",
        f"- **Description:** {fields['run_cfg']['description']}",
        f"- **Arch:** `{fields['run_cfg']['arch']}` · freeze `{fields['freeze_summary']['policy']}` "
        f"({fields['freeze_summary']['trainable_params']:,} / "
        f"{fields['freeze_summary']['total_params']:,} params trainable, "
        f"{fields['freeze_summary']['trainable_fraction']:.1%})",
        f"- **Config hash:** `{fields['provenance']['config_sha256']}` · "
        f"**dataset manifest hash:** `{fields['provenance']['dataset_manifest_sha256']}`",
        f"- **Hardware:** {fields['hardware'].get('device')} · torch {fields['hardware'].get('torch')} "
        f"· CUDA {fields['hardware'].get('cuda_version', 'n/a')} · "
        f"{fields['hardware'].get('vram_total_mb', '?')}MB VRAM · {platform.system()}",
        f"- **Settings:** {json.dumps(fields['chosen'])}"
        + (f" · **OOM fallbacks taken:** {json.dumps(fields['fallbacks'])}" if fields["fallbacks"] else ""),
        f"- **Data:** train {fields['counts']['train']:,} · val {fields['counts']['val']:,}",
        f"- **Initialised from:** {fields.get('initialised_from') or 'ImageNet weights (fresh head)'}",
        f"- **Duration:** {fields['duration']}s",
        f"- **Best val macro-F1:** {fields['best']['macro_f1']:.4f} (epoch {fields['best']['epoch'] + 1})",
    ]

    if fields["limited"]:
        lines.append(
            f"- **NOT A REAL RUN:** truncated to {fields['limited']} batches per epoch "
            "(`--limit-batches`) — a wiring smoke test. Metrics below are meaningless as quality."
        )

    if history:
        lines += [
            "",
            "| epoch | train loss | train acc | val loss | val acc | val macro-F1 | val top-3 | train s |",
            "|---|---|---|---|---|---|---|---|",
        ]
        for row in history:
            lines.append(
                f"| {row['epoch'] + 1} | {row['train_loss']} | {row['train_acc']} | "
                f"{row['val_loss']} | {row['val_acc']} | {row['val_macro_f1']} | "
                f"{row['val_top3']} | {row['train_seconds']} |"
            )

    if fields["gates"]:
        lines += ["", "**Gates**", ""]
        for gate in fields["gates"]:
            lines.append(f"- {'PASS' if gate['passed'] else 'FAIL'} — `{gate['name']}`: {gate['detail']}")

    lines.append("")
    with log.open("a", encoding="utf-8") as handle:
        handle.write("\n".join(lines))


if __name__ == "__main__":
    # Required on Windows: DataLoader workers are spawned, so each one re-imports
    # this module. Without the guard every worker would re-enter main().
    sys.exit(main())
