"""Model construction and the freeze policy.

ADR-005 / docs/ml/model-selection.md: one backbone, one softmax head over all 35
classes, IMAGENET1K transfer weights. Crop masking happens at *inference* in
ml-service, never here — the model is trained to discriminate the whole label
space, and narrowing it per crop at serving time is what turns that into
crop-conditional precision without training six models.
"""

from __future__ import annotations

import torch
from torch import nn
from torchvision import models

# Only these two exist by decision, not by omission: EfficientNet-B0 is the
# chosen model and ResNet18 is the sanity baseline (model-selection.md). Adding
# a third is an architecture change, which the decision policy says goes to the
# team first.
_BUILDERS = {
    "resnet18": (models.resnet18, models.ResNet18_Weights.IMAGENET1K_V1),
    "efficientnet_b0": (models.efficientnet_b0, models.EfficientNet_B0_Weights.IMAGENET1K_V1),
}


def build_model(arch: str, num_classes: int) -> nn.Module:
    """Pretrained backbone with the classifier replaced.

    The new head is randomly initialised and is the only part that starts
    untrained, which is exactly what the head-only warmup runs exercise.
    """
    if arch not in _BUILDERS:
        raise ValueError(f"unknown arch {arch!r}; expected one of {sorted(_BUILDERS)}")

    builder, weights = _BUILDERS[arch]
    model = builder(weights=weights)

    if arch == "resnet18":
        model.fc = nn.Linear(model.fc.in_features, num_classes)
    else:
        # EfficientNet keeps dropout in `classifier[0]`; only the Linear is
        # swapped so the regularisation the architecture ships with survives.
        model.classifier[1] = nn.Linear(model.classifier[1].in_features, num_classes)

    return model


def _head_parameters(model: nn.Module, arch: str):
    return model.fc.parameters() if arch == "resnet18" else model.classifier.parameters()


def apply_freeze(model: nn.Module, arch: str, policy: str, unfreeze_last_blocks: int = 0) -> dict:
    """Set `requires_grad` per the run's policy.

    Returns a summary that the caller writes into the experiments log, so a run
    row records how much of the network was actually training rather than what
    the config asked for.
    """
    if policy == "none":
        for parameter in model.parameters():
            parameter.requires_grad = True

    elif policy == "backbone":
        # Head-only. Everything else is frozen, including BatchNorm affine
        # weights; the running statistics are handled separately by putting the
        # frozen modules in eval mode during training (see engine.py).
        for parameter in model.parameters():
            parameter.requires_grad = False
        for parameter in _head_parameters(model, arch):
            parameter.requires_grad = True

    elif policy == "partial":
        for parameter in model.parameters():
            parameter.requires_grad = False
        for parameter in _head_parameters(model, arch):
            parameter.requires_grad = True

        blocks = _late_blocks(model, arch, unfreeze_last_blocks)
        for block in blocks:
            for parameter in block.parameters():
                parameter.requires_grad = True

    else:
        raise ValueError(f"unknown freeze policy {policy!r}")

    trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
    total = sum(p.numel() for p in model.parameters())
    return {
        "policy": policy,
        "unfreeze_last_blocks": unfreeze_last_blocks if policy == "partial" else 0,
        "trainable_params": trainable,
        "total_params": total,
        "trainable_fraction": round(trainable / total, 4),
    }


def _late_blocks(model: nn.Module, arch: str, count: int) -> list[nn.Module]:
    """The last `count` backbone stages, for partial fine-tuning."""
    if count <= 0:
        return []

    if arch == "resnet18":
        stages = [model.layer1, model.layer2, model.layer3, model.layer4]
    else:
        # torchvision's EfficientNet exposes `features` as a Sequential of
        # stages; the last entry is the 1x1 conv head rather than an MBConv
        # stage, so it is included in the tail by construction.
        stages = list(model.features)

    return stages[-count:]


def freeze_batchnorm(model: nn.Module) -> None:
    """Hold BatchNorm running statistics still in frozen parts of the network.

    `requires_grad = False` stops BatchNorm's affine parameters being *learned*
    but does nothing about its running mean and variance, which keep updating on
    every forward pass in train mode. During a head-only warmup that quietly
    rewrites the pretrained statistics using our batch composition — which, with
    a class-balancing sampler, is not the natural distribution either. Putting
    frozen BatchNorm modules in eval mode is what actually freezes the backbone.
    """
    for module in model.modules():
        if isinstance(module, (nn.BatchNorm1d, nn.BatchNorm2d, nn.BatchNorm3d)):
            if not any(p.requires_grad for p in module.parameters(recurse=False)):
                module.eval()


def trainable_parameters(model: nn.Module):
    return (p for p in model.parameters() if p.requires_grad)


@torch.no_grad()
def head_bias_init(model: nn.Module, arch: str, class_counts: torch.Tensor) -> None:
    """Initialise the head bias to the log prior of each class.

    With a 47:1 imbalance a zero-initialised head spends its first hundred steps
    just learning the marginal distribution, and the loss spike that produces is
    easy to mistake for a bad learning rate. Starting at the log prior means the
    model begins at "predict the base rate" and the gradient carries information
    about the image from step one.
    """
    linear = model.fc if arch == "resnet18" else model.classifier[1]
    prior = class_counts / class_counts.sum()
    linear.bias.copy_(torch.log(prior.clamp_min(1e-8)))
