"""Train and evaluate one epoch.

Kept apart from `train.py` so the loops are readable on their own: everything
about *scheduling* runs (which arch, which freeze policy, when to stop) lives in
the orchestrator, and everything about *executing* a pass over the data lives
here.
"""

from __future__ import annotations

import time

import torch
from sklearn.metrics import f1_score
from torch import nn

from models import freeze_batchnorm


def train_one_epoch(
    model: nn.Module,
    loader,
    criterion: nn.Module,
    optimizer,
    scaler,
    device: torch.device,
    *,
    grad_accum: int = 1,
    amp: bool = True,
    log_every: int = 50,
    on_log=print,
) -> dict:
    """One pass over the training split.

    Gradient accumulation is what makes the OOM fallback chain honest: halving
    the batch size and accumulating twice keeps the *effective* batch at 32, so a
    fallback changes memory use without silently changing the optimisation
    problem the run was configured to solve.
    """
    model.train()
    # Re-applied after `model.train()` on every epoch, because train() walks the
    # whole module tree and puts frozen BatchNorm back into training mode.
    freeze_batchnorm(model)

    running_loss = 0.0
    seen = 0
    correct = 0
    started = time.perf_counter()

    optimizer.zero_grad(set_to_none=True)

    for step, (images, targets) in enumerate(loader):
        images = images.to(device, non_blocking=True)
        targets = targets.to(device, non_blocking=True)

        with torch.amp.autocast("cuda", enabled=amp):
            logits = model(images)
            loss = criterion(logits, targets)
            # Scale so the accumulated gradient is the mean over the effective
            # batch rather than its sum.
            scaled = loss / grad_accum

        scaler.scale(scaled).backward()

        if (step + 1) % grad_accum == 0:
            scaler.step(optimizer)
            scaler.update()
            optimizer.zero_grad(set_to_none=True)

        batch = targets.size(0)
        running_loss += loss.item() * batch
        seen += batch
        correct += (logits.argmax(dim=1) == targets).sum().item()

        if log_every and step % log_every == 0:
            on_log(
                f"    step {step:>4}/{len(loader)}  "
                f"loss {running_loss / max(seen, 1):.4f}  "
                f"acc {correct / max(seen, 1):.4f}"
            )

    # A trailing partial accumulation group would otherwise be computed and
    # thrown away, losing the last few batches of every epoch.
    if len(loader) % grad_accum != 0:
        scaler.step(optimizer)
        scaler.update()
        optimizer.zero_grad(set_to_none=True)

    return {
        "loss": running_loss / max(seen, 1),
        "accuracy": correct / max(seen, 1),
        "seconds": round(time.perf_counter() - started, 1),
        "samples": seen,
    }


@torch.no_grad()
def evaluate(
    model: nn.Module,
    loader,
    criterion: nn.Module,
    device: torch.device,
    *,
    amp: bool = True,
    num_classes: int,
) -> dict:
    """One pass over a held-out split.

    Returns macro-F1 as the primary metric (evaluation-plan.md) alongside
    accuracy and per-class support, plus the raw logits so a caller can reuse
    the pass for calibration instead of running the set twice.
    """
    model.eval()

    running_loss = 0.0
    seen = 0
    all_logits: list[torch.Tensor] = []
    all_targets: list[torch.Tensor] = []
    started = time.perf_counter()

    for images, targets in loader:
        images = images.to(device, non_blocking=True)
        targets = targets.to(device, non_blocking=True)

        with torch.amp.autocast("cuda", enabled=amp):
            logits = model(images)
            loss = criterion(logits, targets)

        running_loss += loss.item() * targets.size(0)
        seen += targets.size(0)
        # float32 on CPU: AMP returns float16, and accumulating a whole split of
        # those loses precision that calibration later depends on.
        all_logits.append(logits.detach().float().cpu())
        all_targets.append(targets.detach().cpu())

    logits = torch.cat(all_logits)
    targets = torch.cat(all_targets)
    predictions = logits.argmax(dim=1)

    # `labels=range(num_classes)` so a class absent from this split still counts
    # as a zero rather than being dropped from the average — otherwise macro-F1
    # silently becomes an average over fewer classes than the model has.
    macro_f1 = f1_score(
        targets.numpy(),
        predictions.numpy(),
        average="macro",
        labels=list(range(num_classes)),
        zero_division=0,
    )

    top3 = _top_k_accuracy(logits, targets, k=3)

    return {
        "loss": running_loss / max(seen, 1),
        "accuracy": (predictions == targets).float().mean().item(),
        "macro_f1": float(macro_f1),
        "top3_accuracy": top3,
        "seconds": round(time.perf_counter() - started, 1),
        "samples": seen,
        "logits": logits,
        "targets": targets,
    }


def _top_k_accuracy(logits: torch.Tensor, targets: torch.Tensor, k: int) -> float:
    k = min(k, logits.size(1))
    top = logits.topk(k, dim=1).indices
    hits = (top == targets.unsqueeze(1)).any(dim=1)
    return hits.float().mean().item()
