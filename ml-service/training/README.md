# Training (P4) — RTX 2050 4GB

Development-only. Nothing here ships: the service image carries an ONNX graph
and `onnxruntime`, never torch (`docs/security/dependency-security.md` keeps the
"ml" and "training" dependency lists apart deliberately).

Authority for every decision in here: `docs/ml/training-plan.md`,
`docs/ml/model-selection.md`, `docs/ml/dataset-preparation.md`,
`docs/ml/confidence-strategy.md`, `docs/ml/evaluation-plan.md`.

## Setup

```bash
conda create -p ml-service/training/.venv python=3.12 -y

# CUDA build — must come from the cu126 index. Installing torch from PyPI gets
# the CPU wheel and the GPU sits idle through an overnight run.
ml-service/training/.venv/python.exe -m pip install \
    torch torchvision --index-url https://download.pytorch.org/whl/cu126

ml-service/training/.venv/python.exe -m pip install -r requirements-train.txt
```

Verify the gate before anything else:

```bash
ml-service/training/.venv/python.exe -c "import torch; print(torch.cuda.is_available())"
# must print True
```

**Verified 2026-08-13:** Python 3.12.13 · torch 2.13.0+cu126 · torchvision
0.28.0+cu126 · CUDA available on an RTX 2050 (4096MB total, ~3300MB free — the
display already holds the rest, which is why the OOM fallback chain matters).

## Running

```bash
cd ml-service/training

.venv/python.exe train.py --run run0                 # ResNet18 sanity
.venv/python.exe train.py --run run1                 # EffNet-B0 head warmup
.venv/python.exe train.py --run run2 --resume        # EffNet-B0 fine-tune

.venv/python.exe train.py --run run0 --limit-batches 3   # wiring smoke test only
```

`--limit-batches` truncates each epoch. It exists to prove the wiring in under a
minute and its numbers are meaningless as quality — every run it produces is
stamped **NOT A REAL RUN** in the experiment log so it can never be misread as
a result.

### Before a long run

`docs/ml/training-plan.md` asks for this explicitly, and it is not ceremony on a
laptop GPU:

- plug the machine in and disable sleep;
- expect thermal throttling — the plan's wall-clock estimates already allow for
  it, and an epoch that slows down mid-run is the chassis, not a bug;
- runs checkpoint every epoch to `checkpoints/<run>/{best,last}.pt`, so a
  killed run resumes with `--resume` rather than starting over.

## What the pipeline does

| Concern | Where | Note |
|---|---|---|
| Class contract | `data.load_class_order` | 35 codes from `datasets/manifest.json`, **sorted**, so regenerating the dataset manifest cannot renumber a trained model |
| Splits | `data.read_split` | reads the P0-6 TSVs; a missing file or unknown class **raises** rather than training on a silent subset |
| Eval transform | `data.build_transforms` | Resize(256) → CenterCrop(224) → /255 → ImageNet normalize — must stay byte-identical to `ml-service/app/preprocessing.py` |
| Imbalance | `data.sampler_for`, `data.class_weights` | 47:1 (3750 vs 79). Sampler **and** weighted loss, both switchable — see the warning below |
| Freeze policy | `models.apply_freeze` | plus `freeze_batchnorm`, because `requires_grad=False` does **not** stop BatchNorm running statistics drifting |
| Head init | `models.head_bias_init` | bias starts at the log prior so the first steps carry image information rather than re-learning the base rate |
| OOM | `train.attempt_plan` | bs32 → bs16+accum2 → 192px → bs8+accum4; each step logged, never silent |
| Provenance | `train.main` | config hash + dataset manifest hash into every log row |

### The double-correction warning

`config.yaml` enables both `weighted_sampler` and `class_weighted_loss` because
the plan specifies both. Together they correct the imbalance **twice** — the
sampler changes what the model sees, the loss weights change what each sample
costs. `class_weight_power: 0.5` softens it, but if evaluation shows the model
over-predicting rare classes, turning one of them off is the first lever, and
the change belongs in `experiments.md` with its reasoning.

## Outputs

- `experiments.md` — appended, never rewritten. Every run including the failures.
  "No fabricated numbers; failed runs recorded as failed" is the plan's rule and
  the writer enforces it structurally: metrics come from the loops.
- `checkpoints/<run>/best.pt`, `last.pt` — gitignored (`*.pt`). Each carries the
  class order with the weights, so an export cannot renumber the outputs.

## Not built yet

P4-3 onward: calibration and τ derivation, the evaluation battery, ONNX export
and the golden-image parity gate, artifact integration, and the Grad-CAM
background-reliance probe that `docs/ml/error-analysis.md` marks **required for
chilli before any chilli accuracy figure is published**.
