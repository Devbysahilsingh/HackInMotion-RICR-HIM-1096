# Training Plan (RTX 2050 4GB · executes after START IMPLEMENTATION + audit approval)

Env: dedicated venv Python 3.12, torch 2.x cu12x wheel, torchvision, albumentations, onnx, onnxruntime; deterministic seeds (torch/np/random=42, cudnn.benchmark=True accepted non-determinism documented).

## Config (single YAML `ml-service/training/config.yaml` — all runs reproducible from config + manifest)
batch 32 (fallback 16 + grad-accum 2 if OOM) · img 224 · AMP on · AdamW · label smoothing 0.05 · class-weighted CE + WeightedRandomSampler · early stop patience 4 (val macro-F1) · checkpoint best+last · pin_memory, workers 4.

## Schedule
1. **Run 0 — ResNet18 sanity** (head-only 3 epochs): pipeline validation, ~20–30min. Gate: val acc ≫ chance, loss curves sane, no leakage smell (val acc not absurdly ≈100%).
2. **Run 1 — EffNet-B0 head warmup:** freeze backbone, train head 3 epochs, LR 1e-3 cosine.
3. **Run 2 — fine-tune:** unfreeze last 2 blocks + head, LR 1e-4→1e-5 cosine, ≤15 epochs, early stop. Est. 4–6 min/epoch on ~45–55k images → **1.5–3h wall-clock**; runs overnight Day 1→2 with checkpointing (resume-safe).
4. **Optional Run 3:** full unfreeze @LR 1e-5 3 epochs if val plateau suggests headroom AND time exists.
5. Post: temperature calibration + threshold derivation (confidence-strategy.md) → evaluation battery (evaluation-plan.md) → export+parity → integration.

Experiment log: `ml-service/training/experiments.md` — every run: config hash, dataset manifest hash, duration, metrics, decision. **No fabricated numbers; failed runs recorded as failed.** Major strategy changes (arch swap, class restructuring) → summarized to team before proceeding (decision policy).

## GPU memory guardrails
Pre-flight `torch.cuda.mem_get_info` check; OOM → automatic fallback chain (bs16+accum → img 192 → freeze more) with config recorded; never silent — every fallback logged. Laptop thermals: expect throttling; wall-clock estimates padded; power plugged, sleep disabled during runs (run instructions in doc header).
