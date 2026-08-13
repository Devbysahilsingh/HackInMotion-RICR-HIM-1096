
## run0 (WIRING SMOKE TEST, not a real run) — 2026-08-13 03:54 UTC — **FAILED_GATE**

- **Description:** ResNet18 sanity — pipeline validation, not a candidate model
- **Arch:** `resnet18` · freeze `backbone` (17,955 / 11,194,467 params trainable, 0.2%)
- **Config hash:** `c3b27f578ef5` · **dataset manifest hash:** `dc4e5e3dac5f`
- **Hardware:** NVIDIA GeForce RTX 2050 · torch 2.13.0+cu126 · CUDA 12.6 · 4096MB VRAM · Windows
- **Settings:** {"batch_size": 32, "grad_accum": 1, "image_size": 224}
- **Data:** train 27,009 · val 5,811
- **Duration:** 53.9s
- **Best val macro-F1:** 0.0000 (epoch 1)
- **NOT A REAL RUN:** truncated to 3 batches per epoch (`--limit-batches`) — a wiring smoke test. Metrics below are meaningless as quality.

| epoch | train loss | train acc | val loss | val acc | val macro-F1 | val top-3 | train s |
|---|---|---|---|---|---|---|---|
| 1 | 4.1011 | 0.0208 | 3.6913 | 0.0 | 0.0 | 0.0 | 20.4 |
| 2 | 3.7201 | 0.0521 | 3.587 | 0.0 | 0.0 | 0.0104 | 1.1 |
| 3 | 3.7832 | 0.0833 | 3.5809 | 0.0 | 0.0 | 0.0104 | 1.3 |

**Gates**

- FAIL — `min_val_accuracy`: val_acc=0.0 >= 0.2 (chance is 1/35 = 0.029)
- PASS — `max_val_accuracy`: val_acc=0.0 <= 0.995 (leakage smell test)

## run0 — 2026-08-13 04:04 UTC — **COMPLETED**

- **Description:** ResNet18 sanity — pipeline validation, not a candidate model
- **Arch:** `resnet18` · freeze `backbone` (17,955 / 11,194,467 params trainable, 0.2%)
- **Config hash:** `c3b27f578ef5` · **dataset manifest hash:** `dc4e5e3dac5f`
- **Hardware:** NVIDIA GeForce RTX 2050 · torch 2.13.0+cu126 · CUDA 12.6 · 4096MB VRAM · Windows
- **Settings:** {"batch_size": 32, "grad_accum": 1, "image_size": 224}
- **Data:** train 27,009 · val 5,811
- **Duration:** 567.1s
- **Best val macro-F1:** 0.7876 (epoch 3)

| epoch | train loss | train acc | val loss | val acc | val macro-F1 | val top-3 | train s |
|---|---|---|---|---|---|---|---|
| 1 | 1.438 | 0.7027 | 1.2443 | 0.7863 | 0.7377 | 0.9494 | 168.3 |
| 2 | 1.0178 | 0.8215 | 1.1672 | 0.8124 | 0.7751 | 0.9585 | 143.1 |
| 3 | 0.9581 | 0.8443 | 1.1362 | 0.8283 | 0.7876 | 0.9659 | 143.1 |

**Gates**

- PASS — `min_val_accuracy`: val_acc=0.8283 >= 0.2 (chance is 1/35 = 0.029)
- PASS — `max_val_accuracy`: val_acc=0.8283 <= 0.995 (leakage smell test)

## run1 — 2026-08-13 04:41 UTC — **COMPLETED**

- **Description:** EffNet-B0 head warmup
- **Arch:** `efficientnet_b0` · freeze `backbone` (44,835 / 4,052,383 params trainable, 1.1%)
- **Config hash:** `6aec1f62de32` · **dataset manifest hash:** `dc4e5e3dac5f`
- **Hardware:** NVIDIA GeForce RTX 2050 · torch 2.13.0+cu126 · CUDA 12.6 · 4096MB VRAM · Windows
- **Settings:** {"batch_size": 32, "grad_accum": 1, "image_size": 224}
- **Data:** train 27,009 · val 5,811
- **Initialised from:** ImageNet weights (fresh head)
- **Duration:** 575.9s
- **Best val macro-F1:** 0.8610 (epoch 3)

| epoch | train loss | train acc | val loss | val acc | val macro-F1 | val top-3 | train s |
|---|---|---|---|---|---|---|---|
| 1 | 1.2121 | 0.7757 | 1.0447 | 0.8604 | 0.8199 | 0.9752 | 161.3 |
| 2 | 0.8966 | 0.8608 | 0.9812 | 0.8819 | 0.8483 | 0.9788 | 141.4 |
| 3 | 0.8491 | 0.8806 | 0.9455 | 0.894 | 0.861 | 0.9831 | 164.5 |

## run2 — 2026-08-13 05:25 UTC — **COMPLETED**

- **Description:** EffNet-B0 fine-tune, last 2 blocks + head
- **Arch:** `efficientnet_b0` · freeze `partial` (1,174,227 / 4,052,383 params trainable, 29.0%)
- **Config hash:** `6aec1f62de32` · **dataset manifest hash:** `dc4e5e3dac5f`
- **Hardware:** NVIDIA GeForce RTX 2050 · torch 2.13.0+cu126 · CUDA 12.6 · 4096MB VRAM · Windows
- **Settings:** {"batch_size": 32, "grad_accum": 1, "image_size": 224}
- **Data:** train 27,009 · val 5,811
- **Initialised from:** run1/best.pt@epoch2
- **Duration:** 2608.4s
- **Best val macro-F1:** 0.9556 (epoch 12)

| epoch | train loss | train acc | val loss | val acc | val macro-F1 | val top-3 | train s |
|---|---|---|---|---|---|---|---|
| 1 | 0.8013 | 0.8986 | 0.8623 | 0.9146 | 0.8865 | 0.9895 | 186.7 |
| 2 | 0.6986 | 0.9296 | 0.8131 | 0.9301 | 0.9061 | 0.9911 | 141.9 |
| 3 | 0.671 | 0.9379 | 0.7742 | 0.9393 | 0.9144 | 0.9931 | 165.9 |
| 4 | 0.6459 | 0.9454 | 0.7485 | 0.9477 | 0.9257 | 0.996 | 140.8 |
| 5 | 0.6305 | 0.9501 | 0.733 | 0.9534 | 0.9373 | 0.9941 | 147.1 |
| 6 | 0.6129 | 0.9549 | 0.7266 | 0.9525 | 0.9331 | 0.995 | 143.7 |
| 7 | 0.5977 | 0.9601 | 0.7091 | 0.9584 | 0.9468 | 0.9967 | 146.1 |
| 8 | 0.5917 | 0.9626 | 0.7137 | 0.9546 | 0.9406 | 0.996 | 143.2 |
| 9 | 0.5792 | 0.966 | 0.6963 | 0.964 | 0.9518 | 0.9962 | 139.5 |
| 10 | 0.5788 | 0.9649 | 0.6929 | 0.9606 | 0.948 | 0.9964 | 135.6 |
| 11 | 0.5701 | 0.9691 | 0.6955 | 0.9623 | 0.9522 | 0.9964 | 139.9 |
| 12 | 0.5713 | 0.9684 | 0.6837 | 0.9654 | 0.9556 | 0.9962 | 137.8 |
| 13 | 0.5662 | 0.9698 | 0.6818 | 0.9661 | 0.9538 | 0.996 | 139.5 |
| 14 | 0.5611 | 0.9714 | 0.6843 | 0.9649 | 0.953 | 0.9967 | 135.8 |
| 15 | 0.5568 | 0.9723 | 0.6803 | 0.9627 | 0.9516 | 0.9972 | 138.8 |
