# Model Selection

## Decision: EfficientNet-B0 (primary) + ResNet18 (pipeline baseline)
| Model | Params | ONNX size | VRAM @bs32/224/AMP | CPU inference | Verdict |
|---|---|---|---|---|---|
| MobileNetV2 | 3.5M | ~14MB | ~2GB | 20–40ms | superseded by V3 |
| MobileNetV3-Large | 5.4M | ~21MB | ~2GB | **15–30ms** | swap-in alternative if free-host CPU latency disappoints |
| **EfficientNet-B0** | 5.3M | ~20MB | ~2.5–3GB | 40–80ms | ✅ best accuracy at size; transfer-learning workhorse |
| EfficientNet-B1 | 7.8M | ~30MB | ~3.5GB @240px | 60–120ms | marginal gain, tighter VRAM — no |
| ResNet18 | 11.7M | ~45MB | ~2.5GB | 30–60ms | ✅ day-1 sanity baseline (fast convergence) |
All comfortably fit RTX 2050 4GB (verified: nvidia-smi shows 4096MiB, CUDA 13.1 driver).

## Architecture strategy: unified single-head + crop-aware inference (Option A+E from comparison)
One softmax over all classes; at inference, **mask logits to the declared crop's classes** (renormalize) — crop-conditional precision without multi-head training complexity. Rejected: per-crop models (6× training/serving), hierarchical crop-ID stage (redundant — farmer declares crop; retained residue: unmasked top-1 from a different crop with high prob ⇒ "photo may not match selected crop" warning), shared-backbone multi-head (equivalent benefit, more code).

## Calibration & confidence (details: confidence-strategy.md)
Temperature scaling on validation set post-training; thresholds derived from validation curves, not guessed.

## Export
Train PyTorch (torchvision weights IMAGENET1K) → ONNX opset 17 → onnxruntime CPU in FastAPI. Parity gate: 100 golden images, |Δprob| < 1e-3 PyTorch vs ONNX. TorchScript fallback if export misbehaves. Future path: ONNX→TFLite for on-device (documented, not built).
