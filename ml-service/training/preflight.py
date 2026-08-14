"""Preflight verification for the training environment.

    python preflight.py            # full check, a few hundred images
    python preflight.py --quick    # skip the throughput measurement

Answers one question - *is this environment actually ready to train?* - by
exercising every stage the real run uses and measuring the two throughputs that
matter. It trains nothing and writes nothing except a temporary checkpoint it
deletes.

It exists because the first Run 0 looked alarming from the outside: `nvidia-smi`
reported 0% GPU utilisation and 361MB of VRAM for minutes at a time. That is
either a starved GPU (fine, and expected with a frozen backbone) or silent CPU
execution (a serious bug that would waste an overnight run). Guessing between
them from a utilisation percentage is exactly the sort of assumption that should
not be made, so section 7 measures both halves separately and prints the ratio.
"""

from __future__ import annotations

import argparse
import importlib
import platform
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]

# Windows consoles default to cp1252, which cannot encode the box-drawing and
# em-dash characters this script and config.yaml both use - printing one raises
# UnicodeEncodeError and kills the run. Reconfiguring stdout to UTF-8 with
# replacement is the fix that works whatever code page the terminal is in.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

PASS = "PASS"  # noqa: S105 — a check-result label, not a credential
FAIL = "FAIL"
INFO = "INFO"

_results: list[tuple[str, str, str]] = []


def record(status: str, name: str, detail: str = "") -> None:
    _results.append((status, name, detail))
    marker = {PASS: "  ok  ", FAIL: " FAIL ", INFO: "  ..  "}[status]
    print(f"[{marker}] {name}" + (f" - {detail}" if detail else ""))


def section(title: str) -> None:
    print(f"\n-- {title} " + "-" * max(0, 68 - len(title)))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--quick", action="store_true", help="skip throughput measurement")
    args = parser.parse_args()

    # -- 1. Interpreter and packages ------------------------------------------
    section("1. environment")

    version = platform.python_version()
    record(
        PASS if version.startswith("3.12") else FAIL,
        "python 3.12",
        f"{version} ({sys.executable})",
    )

    required = [
        "torch",
        "torchvision",
        "PIL",
        "numpy",
        "sklearn",
        "matplotlib",
        "yaml",
        "onnx",
        "onnxruntime",
    ]
    modules = {}
    for name in required:
        try:
            module = importlib.import_module(name)
            modules[name] = module
            record(PASS, f"import {name}", getattr(module, "__version__", "?"))
        except Exception as error:  # noqa: BLE001
            record(FAIL, f"import {name}", repr(error))
            return summarise()

    torch = modules["torch"]
    Image = modules["PIL"].Image

    record(INFO, "torch build", f"{torch.__version__} | CUDA {torch.version.cuda}")

    # JPEG support is not a given - a Pillow built without libjpeg decodes
    # nothing in this corpus, and the failure surfaces as a confusing per-image
    # error deep inside a worker.
    try:
        from PIL import features

        record(
            PASS if features.check("jpg") else FAIL,
            "Pillow JPEG (libjpeg)",
            f"jpg={features.check('jpg')} zlib={features.check('zlib')} webp={features.check('webp')}",
        )
    except Exception as error:  # noqa: BLE001
        record(FAIL, "Pillow JPEG", repr(error))

    # -- 2. GPU ---------------------------------------------------------------
    section("2. GPU")

    available = torch.cuda.is_available()
    record(PASS if available else FAIL, "torch.cuda.is_available()", str(available))
    if not available:
        record(FAIL, "GPU required", "training on CPU would take days - stopping")
        return summarise()

    name = torch.cuda.get_device_name(0)
    free, total = torch.cuda.mem_get_info()
    capability = torch.cuda.get_device_capability(0)
    record(PASS, "GPU detected", name)
    record(
        PASS,
        "VRAM",
        f"{total / 1024**2:.0f}MB total | {free / 1024**2:.0f}MB free "
        f"| compute capability {capability[0]}.{capability[1]}",
    )

    # AMP needs fp16 tensor cores to be a speedup rather than a wash. Turing
    # (7.5) has them; the RTX 2050 is Ampere (8.6) and has them too.
    record(
        PASS if capability >= (7, 0) else INFO,
        "AMP-capable",
        f"sm_{capability[0]}{capability[1]} - fp16 autocast is beneficial",
    )

    if total / 1024**2 < 4500:
        record(
            INFO,
            "4GB-class GPU",
            "batch 32 @224 fits ResNet18/EffNet-B0 with AMP; the OOM fallback "
            "chain in config.yaml exists for the tighter EffNet-B0 fine-tune",
        )

    # -- 3. Dataset -----------------------------------------------------------
    section("3. dataset")

    import yaml

    config = yaml.safe_load((HERE / "config.yaml").read_text(encoding="utf-8"))
    data_cfg = config["data"]

    splits_dir = REPO / data_cfg["splits_dir"]
    raw_dir = REPO / data_cfg["raw_dir"]
    manifest_path = REPO / data_cfg["manifest"]

    for label, path in [
        ("splits dir", splits_dir),
        ("raw corpus", raw_dir),
        ("dataset manifest", manifest_path),
    ]:
        record(PASS if path.exists() else FAIL, f"{label} exists", str(path))

    sys.path.insert(0, str(HERE))
    from data import (
        SplitDataset,
        build_loader,
        build_transforms,
        class_weights,
        load_class_order,
        read_split,
        sampler_for,
    )

    classes = load_class_order(manifest_path)
    record(
        PASS if len(classes) == 35 else FAIL,
        "class contract",
        f"{len(classes)} classes, first={classes[0]} last={classes[-1]}",
    )
    class_to_index = {code: index for index, code in enumerate(classes)}

    # read_split raises on a missing file or an unknown class, so this both
    # parses the manifest and proves every referenced image is on disk.
    counts = {}
    for split in ("train", "val", "test", "fieldtest"):
        started = time.perf_counter()
        samples = read_split(splits_dir, raw_dir, split, class_to_index)
        counts[split] = samples
        record(
            PASS,
            f"split {split}",
            f"{len(samples):,} samples, all paths resolve ({time.perf_counter() - started:.1f}s)",
        )

    # -- 4. Decode + transforms -----------------------------------------------
    section("4. decode and transforms")

    train_transform, eval_transform = build_transforms(
        config["image"], config["augment"], config["image"]["size"]
    )

    sample = counts["train"][0]
    with Image.open(sample.path) as image:
        rgb = image.convert("RGB")
        record(PASS, "JPEG decode", f"{rgb.size} {rgb.mode} from {sample.path.name}")

    trained = train_transform(rgb)
    evaluated = eval_transform(rgb)
    size = config["image"]["size"]

    record(
        PASS if tuple(trained.shape) == (3, size, size) else FAIL,
        "train transform",
        f"shape {tuple(trained.shape)} dtype {trained.dtype}",
    )
    record(
        PASS if tuple(evaluated.shape) == (3, size, size) else FAIL,
        "eval transform",
        f"shape {tuple(evaluated.shape)} dtype {evaluated.dtype} "
        f"mean {evaluated.mean():.3f} std {evaluated.std():.3f}",
    )

    # The eval transform is contractually identical to ml-service preprocessing.
    # A full parity proof is P4-6's golden-image test; this is the cheap check
    # that the constants at least agree.
    from app_parity import compare_with_service

    parity = compare_with_service(config["image"])
    record(parity["status"], "eval/service constants agree", parity["detail"])

    # -- 5. DataLoader with workers -------------------------------------------
    section("5. DataLoader")

    subset = SplitDataset(counts["train"][:512], train_transform)
    sampler = sampler_for(counts["train"][:512], len(classes), config["optim"]["class_weight_power"])
    loader = build_loader(subset, config["loader"]["batch_size"], config["loader"], sampler=sampler)

    started = time.perf_counter()
    images, targets = next(iter(loader))
    first_batch = time.perf_counter() - started

    record(
        PASS,
        "worker startup + first batch",
        f"{first_batch:.1f}s with {config['loader']['num_workers']} workers "
        f"(spawn cost on Windows, paid once per epoch unless persistent)",
    )
    record(
        PASS if images.shape[0] == config["loader"]["batch_size"] else FAIL,
        "batch shape",
        f"images {tuple(images.shape)} {images.dtype} | targets {tuple(targets.shape)}",
    )

    weights = class_weights(counts["train"], len(classes), config["optim"]["class_weight_power"])
    record(
        PASS,
        "class weights",
        f"min {weights.min():.3f} max {weights.max():.3f} mean {weights.mean():.3f} "
        f"(imbalance {int(weights.max() / weights.min())}:1 after power "
        f"{config['optim']['class_weight_power']})",
    )

    # -- 6. Model, forward, loss, checkpoint ----------------------------------
    section("6. model / forward / loss / checkpoint")

    from models import apply_freeze, build_model, head_bias_init
    from torch import nn

    device = torch.device("cuda")
    model = build_model("resnet18", len(classes)).to(device)
    summary = apply_freeze(model, "resnet18", "backbone")

    # The question the diagnosis hinges on: are the weights actually resident on
    # the GPU, or did something silently keep them on the CPU?
    devices = {parameter.device.type for parameter in model.parameters()}
    record(
        PASS if devices == {"cuda"} else FAIL,
        "model parameters on CUDA",
        f"devices={sorted(devices)} | {summary['trainable_params']:,}/"
        f"{summary['total_params']:,} trainable ({summary['trainable_fraction']:.2%})",
    )

    gpu_images = images.to(device, non_blocking=True)
    gpu_targets = targets.to(device, non_blocking=True)
    record(
        PASS if gpu_images.is_cuda and gpu_targets.is_cuda else FAIL,
        "inputs moved to CUDA",
        f"images.device={gpu_images.device} targets.device={gpu_targets.device}",
    )

    criterion = nn.CrossEntropyLoss(label_smoothing=config["optim"]["label_smoothing"])
    scaler = torch.amp.GradScaler("cuda", enabled=True)

    model.train()
    with torch.amp.autocast("cuda", enabled=True):
        logits = model(gpu_images)
        loss = criterion(logits, gpu_targets)

    record(
        PASS if logits.is_cuda and tuple(logits.shape) == (images.shape[0], len(classes)) else FAIL,
        "forward pass",
        f"logits {tuple(logits.shape)} on {logits.device} dtype {logits.dtype}",
    )
    record(
        PASS if logits.dtype == torch.float16 else FAIL,
        "AMP autocast active",
        f"logits are {logits.dtype} inside autocast - fp16 means tensor cores are in use",
    )
    record(
        PASS if torch.isfinite(loss) else FAIL,
        "loss computed",
        f"{loss.item():.4f} (ln(35)={float(torch.log(torch.tensor(35.0))):.4f} at chance)",
    )

    scaler.scale(loss).backward()
    grads = [p for p in model.parameters() if p.requires_grad and p.grad is not None]
    record(
        PASS if grads else FAIL,
        "backward pass",
        f"{len(grads)} trainable tensors received gradients",
    )

    peak = torch.cuda.max_memory_allocated() / 1024**2
    record(INFO, "peak VRAM this step", f"{peak:.0f}MB allocated at batch {images.shape[0]}")

    head_bias_init(model, "resnet18", torch.ones(len(classes)))
    record(PASS, "head bias init", "log-prior initialisation applied without error")

    # Checkpoint round-trip, including the class order that export depends on.
    temp = HERE / ".preflight-checkpoint.pt"
    torch.save({"model": model.state_dict(), "classes": classes, "arch": "resnet18"}, temp)
    restored = torch.load(temp, map_location=device, weights_only=False)
    fresh = build_model("resnet18", len(classes)).to(device)
    fresh.load_state_dict(restored["model"])
    temp.unlink()
    record(
        PASS if restored["classes"] == classes else FAIL,
        "checkpoint save/load",
        "state_dict restored and class order round-tripped intact",
    )

    # -- 7. Inference path ----------------------------------------------------
    section("7. inference / evaluation path")

    from engine import evaluate

    eval_subset = SplitDataset(counts["val"][:256], eval_transform)
    eval_loader = build_loader(eval_subset, config["loader"]["batch_size"], config["loader"])
    metrics = evaluate(fresh, eval_loader, criterion, device, amp=True, num_classes=len(classes))

    record(
        PASS,
        "evaluate() path",
        f"macro_f1={metrics['macro_f1']:.4f} acc={metrics['accuracy']:.4f} "
        f"top3={metrics['top3_accuracy']:.4f} over {metrics['samples']} val images "
        "(an untrained head - these numbers only prove the path runs)",
    )
    record(
        PASS if metrics["logits"].dtype == torch.float32 else FAIL,
        "eval logits upcast to fp32",
        f"{metrics['logits'].dtype} - calibration later depends on this precision",
    )

    # -- 8. Throughput diagnosis ----------------------------------------------
    if not args.quick:
        section("8. throughput - is the GPU starved or idle-by-bug?")

        # (a) GPU-only: one batch, reused, no data loading at all.
        model.train()
        for _ in range(3):  # warm up cuDNN autotuning
            with torch.amp.autocast("cuda", enabled=True):
                loss = criterion(model(gpu_images), gpu_targets)
            scaler.scale(loss).backward()
            model.zero_grad(set_to_none=True)
        torch.cuda.synchronize()

        iterations = 20
        started = time.perf_counter()
        for _ in range(iterations):
            with torch.amp.autocast("cuda", enabled=True):
                loss = criterion(model(gpu_images), gpu_targets)
            scaler.scale(loss).backward()
            model.zero_grad(set_to_none=True)
        torch.cuda.synchronize()
        gpu_seconds = time.perf_counter() - started
        gpu_rate = iterations * images.shape[0] / gpu_seconds

        # (b) Data-only: pull batches through the loader, never touching the GPU.
        started = time.perf_counter()
        pulled = 0
        for index, (batch_images, _) in enumerate(loader):
            pulled += batch_images.shape[0]
            if index >= 9:
                break
        data_seconds = time.perf_counter() - started
        data_rate = pulled / data_seconds

        record(INFO, "GPU-only throughput", f"{gpu_rate:,.0f} images/s (forward+backward, head-only)")
        record(INFO, "data-only throughput", f"{data_rate:,.0f} images/s (decode+augment, 4 workers)")

        ratio = gpu_rate / max(data_rate, 1e-9)
        starved = ratio > 2
        record(
            PASS if starved else INFO,
            "verdict",
            (
                f"GPU is {ratio:.1f}x faster than the data pipeline - the pipeline is "
                "DATA-BOUND. Low nvidia-smi utilisation is expected and correct, not a "
                "CPU fallback."
                if starved
                else f"GPU only {ratio:.1f}x faster than data - compute-bound; low "
                "utilisation would NOT be expected here."
            ),
        )

    return summarise()


def summarise() -> int:
    failures = [row for row in _results if row[0] == FAIL]
    passes = [row for row in _results if row[0] == PASS]

    print("\n" + "=" * 72)
    print(f"  {len(passes)} passed | {len(failures)} failed")
    if failures:
        print("\n  FAILED:")
        for _, name, detail in failures:
            print(f"    - {name}: {detail}")
        print("\n  STATUS: NOT READY")
        return 1

    print("\n  STATUS: READY")
    return 0


if __name__ == "__main__":
    sys.exit(main())
