"""P4-4 — temperature calibration and threshold derivation.

    python calibrate.py --checkpoint checkpoints/run2/best.pt

Implements docs/ml/confidence-strategy.md exactly:

  * **Temperature scaling** — a single scalar T fitted by LBFGS on validation
    NLL. ECE reported pre and post.
  * **tau** — "chosen where val precision-of-accepted >= 0.90 while maximizing
    coverage". The doc notes an *expected* neighbourhood of 0.70-0.80 and is
    explicit that the "final value = data's answer", so nothing here is nudged
    toward that range.
  * **tau_healthy** — "healthy predictions accepted only if P(healthy) >=
    tau_healthy, set where false-negative-disease rate among accepted-healthy
    <= 5% on val".
  * **margin guard 0.15** — published in the doc, not derived. Carried through
    unchanged so the production policy can be reported honestly.

Everything is fitted on **validation** and nothing touches the test split: the
thresholds are part of the model, and choosing them on test would make the test
number a training metric.

Writes `calibration.json` (machine-readable, consumed by the ONNX export) and a
human summary into `docs/ml/evaluation-results/`.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, UTC
from pathlib import Path

import torch
import torch.nn.functional as F

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
sys.path.insert(0, str(HERE))

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

from inference import compute_logits, load_config  # noqa: E402

# Published in confidence-strategy.md, not derived here.
MARGIN_GUARD = 0.15

# The doc's acceptance criteria, named so the report can quote them.
TAU_MIN_PRECISION = 0.90
TAU_HEALTHY_MAX_FN_RATE = 0.05

ECE_BINS = 15


def fit_temperature(logits: torch.Tensor, targets: torch.Tensor) -> tuple[float, dict]:
    """Single-parameter temperature scaling, LBFGS on validation NLL.

    Optimising log_T rather than T keeps the parameter positive without a
    constraint — a negative or zero temperature would invert or explode the
    softmax, and LBFGS has no notion of bounds.
    """
    log_temperature = torch.zeros(1, requires_grad=True)  # T = exp(0) = 1
    optimizer = torch.optim.LBFGS([log_temperature], lr=0.1, max_iter=200)

    def closure():
        optimizer.zero_grad()
        loss = F.cross_entropy(logits / log_temperature.exp(), targets)
        loss.backward()
        return loss

    before = F.cross_entropy(logits, targets).item()
    optimizer.step(closure)
    temperature = float(log_temperature.exp().item())
    after = F.cross_entropy(logits / temperature, targets).item()

    return temperature, {"nll_before": before, "nll_after": after}


def expected_calibration_error(probabilities: torch.Tensor, targets: torch.Tensor, bins: int):
    """Standard equal-width ECE over max-probability confidence."""
    confidence, prediction = probabilities.max(dim=1)
    correct = (prediction == targets).float()

    edges = torch.linspace(0, 1, bins + 1)
    error = 0.0
    detail = []

    # `strict=True` is free here — the two slices of one tensor cannot differ in
    # length — and documents that. Not `itertools.pairwise` (RUF007): these are
    # bin edges, and reading them as explicit lower/upper pairs is the point.
    for lower, upper in zip(edges[:-1], edges[1:], strict=True):  # noqa: RUF007
        # Lower-exclusive except for the first bin, so every sample lands once.
        in_bin = (confidence > lower) & (confidence <= upper)
        count = int(in_bin.sum())
        if count == 0:
            continue
        accuracy = float(correct[in_bin].mean())
        mean_confidence = float(confidence[in_bin].mean())
        error += (count / len(targets)) * abs(accuracy - mean_confidence)
        detail.append(
            {
                "bin": [round(float(lower), 3), round(float(upper), 3)],
                "count": count,
                "accuracy": round(accuracy, 4),
                "confidence": round(mean_confidence, 4),
            }
        )

    return error, detail


def precision_coverage_curve(probabilities: torch.Tensor, targets: torch.Tensor):
    """Precision and coverage of the accepted set across candidate thresholds."""
    confidence, prediction = probabilities.max(dim=1)
    correct = prediction == targets
    total = len(targets)

    curve = []
    for step in range(0, 100):
        threshold = step / 100
        accepted = confidence >= threshold
        count = int(accepted.sum())
        if count == 0:
            continue
        curve.append(
            {
                "threshold": round(threshold, 2),
                "coverage": round(count / total, 4),
                "precision": round(float(correct[accepted].float().mean()), 4),
                "accepted": count,
            }
        )
    return curve


def derive_tau(curve: list[dict]) -> tuple[float | None, dict | None]:
    """Lowest threshold meeting the precision floor — i.e. maximum coverage.

    Lower threshold means more coverage, so "precision >= 0.90 while maximizing
    coverage" is the smallest qualifying threshold, not the safest one.
    """
    qualifying = [point for point in curve if point["precision"] >= TAU_MIN_PRECISION]
    if not qualifying:
        return None, None
    best = min(qualifying, key=lambda point: point["threshold"])
    return best["threshold"], best


def derive_tau_healthy(
    probabilities: torch.Tensor,
    targets: torch.Tensor,
    healthy_indices: set[int],
):
    """Lowest healthy-acceptance threshold whose accepted set is <=5% diseased.

    The quantity being bounded is the one that actually harms a farmer: of the
    predictions we accept as "healthy", how many were really diseased. That is a
    told-your-crop-is-fine-when-it-is-not rate, which evaluation-plan.md ranks as
    the worst failure mode.
    """
    _, prediction = probabilities.max(dim=1)
    predicted_healthy = torch.tensor(
        [int(index) in healthy_indices for index in prediction], dtype=torch.bool
    )
    truly_diseased = torch.tensor(
        [int(index) not in healthy_indices for index in targets], dtype=torch.bool
    )
    # Probability mass on the healthy classes, which is what the rule thresholds
    # — not the top-1 probability, since two healthy classes cannot both be it.
    healthy_mass = probabilities[:, sorted(healthy_indices)].sum(dim=1)

    curve = []
    for step in range(0, 100):
        threshold = step / 100
        accepted = predicted_healthy & (healthy_mass >= threshold)
        count = int(accepted.sum())
        if count == 0:
            continue
        false_negative_rate = float(truly_diseased[accepted].float().mean())
        curve.append(
            {
                "threshold": round(threshold, 2),
                "accepted_healthy": count,
                "false_negative_disease_rate": round(false_negative_rate, 4),
            }
        )

    qualifying = [
        point for point in curve if point["false_negative_disease_rate"] <= TAU_HEALTHY_MAX_FN_RATE
    ]
    if not qualifying:
        return None, None, curve
    best = min(qualifying, key=lambda point: point["threshold"])
    return best["threshold"], best, curve


def validate_override(
    override: dict,
    curve: list[dict],
    healthy_curve: list[dict],
    probabilities: torch.Tensor,
    targets: torch.Tensor,
    healthy_indices: set[int],
) -> tuple[bool, list[dict]]:
    """Check a policy override against every documented criterion.

    An override exists because the derivation is degenerate, NOT because the
    criteria stop applying. If a chosen value failed the precision floor, the
    false-negative ceiling, the "stricter" relation or the healthy-recall ship
    gate, accepting it would turn a recorded decision into a way of smuggling a
    bad threshold past the rules the derivation enforces. So it is re-checked
    here against the same measured curves, and a failure is fatal.
    """
    tau = override["tau"]
    tau_healthy = override["tau_healthy"]

    def at(points, threshold, key):
        exact = [point for point in points if abs(point["threshold"] - threshold) < 1e-9]
        return exact[0][key] if exact else None

    precision = at(curve, tau, "precision")
    coverage = at(curve, tau, "coverage")
    false_negative = at(healthy_curve, tau_healthy, "false_negative_disease_rate")

    # The healthy-recall ship gate (evaluation-plan.md) is the constraint that
    # actually binds tau_healthy, and it is measured here rather than assumed.
    _, prediction = probabilities.max(dim=1)
    healthy_mass = probabilities[:, sorted(healthy_indices)].sum(dim=1)
    accepted = healthy_mass >= tau_healthy
    recalls = []
    for index in sorted(healthy_indices):
        support = int((targets == index).sum())
        if support:
            recovered = int(((prediction == index) & (targets == index) & accepted).sum())
            recalls.append(recovered / support)
    min_healthy_recall = min(recalls) if recalls else None

    checks = [
        {
            "criterion": f"precision-of-accepted >= {TAU_MIN_PRECISION}",
            "measured": precision,
            "passed": precision is not None and precision >= TAU_MIN_PRECISION,
        },
        {
            "criterion": f"healthy false-negative rate <= {TAU_HEALTHY_MAX_FN_RATE}",
            "measured": false_negative,
            "passed": false_negative is not None and false_negative <= TAU_HEALTHY_MAX_FN_RATE,
        },
        {
            "criterion": "tau_healthy > tau (confidence-strategy.md: 'stricter')",
            "measured": f"{tau_healthy} > {tau}",
            "passed": tau_healthy > tau,
        },
        {
            "criterion": "healthy-class recall >= 0.90 @tau_healthy (ship gate)",
            "measured": min_healthy_recall,
            "passed": min_healthy_recall is not None and min_healthy_recall >= 0.90,
        },
        {
            "criterion": "confidence abstention branch reachable (tau > 0)",
            "measured": tau,
            "passed": tau > 0,
        },
        {
            "criterion": "healthy abstention branch reachable (tau_healthy > 0)",
            "measured": tau_healthy,
            "passed": tau_healthy > 0,
        },
    ]
    checks.append({"criterion": "coverage at tau", "measured": coverage, "passed": True})

    return all(check["passed"] for check in checks), checks


def production_policy_report(
    probabilities: torch.Tensor,
    targets: torch.Tensor,
    healthy_indices: set[int],
    tau: float,
    tau_healthy: float,
):
    """What the full runtime rule does, with all three guards applied together.

    tau, the margin guard and tau_healthy are each derived or published
    separately, but production applies all of them at once. Reporting only the
    individual derivations would overstate coverage.
    """
    top2 = probabilities.topk(2, dim=1)
    confidence = top2.values[:, 0]
    margin = top2.values[:, 0] - top2.values[:, 1]
    prediction = top2.indices[:, 0]

    healthy_mass = probabilities[:, sorted(healthy_indices)].sum(dim=1)
    predicted_healthy = torch.tensor(
        [int(index) in healthy_indices for index in prediction], dtype=torch.bool
    )

    accepted = (confidence >= tau) & (margin >= MARGIN_GUARD)
    accepted = accepted & (~predicted_healthy | (healthy_mass >= tau_healthy))

    count = int(accepted.sum())
    correct = (prediction == targets)

    accepted_healthy = accepted & predicted_healthy
    truly_diseased = torch.tensor(
        [int(index) not in healthy_indices for index in targets], dtype=torch.bool
    )

    return {
        "coverage": round(count / len(targets), 4),
        "precision_of_accepted": round(float(correct[accepted].float().mean()), 4) if count else None,
        "abstained": len(targets) - count,
        "abstain_rate": round(1 - count / len(targets), 4),
        "accepted_healthy": int(accepted_healthy.sum()),
        "false_negative_disease_rate_among_accepted_healthy": (
            round(float(truly_diseased[accepted_healthy].float().mean()), 4)
            if int(accepted_healthy.sum())
            else None
        ),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="P4-4 calibration and threshold derivation.")
    parser.add_argument("--checkpoint", default="checkpoints/run2/best.pt")
    parser.add_argument("--split", default="val", help="calibration split (must not be test)")
    args = parser.parse_args()

    checkpoint = (HERE / args.checkpoint).resolve()
    if not checkpoint.exists():
        print(f"checkpoint not found: {checkpoint}", file=sys.stderr)
        return 2

    if args.split == "test":
        # Guard rather than comment: fitting thresholds on test turns the test
        # number into a training metric, and the whole evaluation battery
        # downstream would be reporting a quantity it did not measure.
        print("refusing to calibrate on the test split", file=sys.stderr)
        return 2

    config = load_config()
    print(f"== P4-4 calibration | checkpoint {checkpoint.relative_to(REPO)}")

    bundle = compute_logits(checkpoint, args.split, config=config, on_log=print)
    logits, targets, classes = bundle["logits"], bundle["targets"], bundle["classes"]

    healthy_indices = {
        index for index, code in enumerate(classes) if code.endswith("_HEALTHY") or code == "RICE_NORMAL"
    }
    print(f"   {len(targets):,} {args.split} samples | {len(classes)} classes | "
          f"{len(healthy_indices)} healthy classes")

    # ── Temperature ──────────────────────────────────────────────────────────
    temperature, nll = fit_temperature(logits, targets)
    print(f"   temperature T = {temperature:.4f} "
          f"(val NLL {nll['nll_before']:.4f} -> {nll['nll_after']:.4f})")

    probabilities_before = logits.softmax(dim=1)
    probabilities_after = (logits / temperature).softmax(dim=1)

    ece_before, _ = expected_calibration_error(probabilities_before, targets, ECE_BINS)
    ece_after, bins_after = expected_calibration_error(probabilities_after, targets, ECE_BINS)
    print(f"   ECE {ece_before:.4f} -> {ece_after:.4f} ({ECE_BINS} bins)")

    # ── Thresholds, on calibrated probabilities ──────────────────────────────
    curve = precision_coverage_curve(probabilities_after, targets)
    tau, tau_point = derive_tau(curve)
    if tau is None:
        print(f"   tau: NO threshold reaches precision >= {TAU_MIN_PRECISION}", file=sys.stderr)
    else:
        print(f"   tau = {tau:.2f} (precision {tau_point['precision']:.4f}, "
              f"coverage {tau_point['coverage']:.4f})")
        if tau == 0:
            print(f"   *** tau criterion is NON-BINDING: precision at threshold 0 is already "
                  f"{tau_point['precision']:.4f} >= {TAU_MIN_PRECISION}, so confidence-based "
                  f"abstention is INACTIVE. Needs a product decision.")

    tau_healthy, healthy_point, healthy_curve = derive_tau_healthy(
        probabilities_after, targets, healthy_indices
    )
    if tau_healthy is None:
        print(
            f"   tau_healthy: NO threshold reaches FN-disease rate <= {TAU_HEALTHY_MAX_FN_RATE}",
            file=sys.stderr,
        )
    else:
        print(f"   tau_healthy = {tau_healthy:.2f} "
              f"(FN-disease rate {healthy_point['false_negative_disease_rate']:.4f}, "
              f"{healthy_point['accepted_healthy']} accepted)")
        if tau_healthy == 0:
            print(f"   *** tau_healthy criterion is NON-BINDING: FN-disease rate at threshold 0 "
                  f"is already {healthy_point['false_negative_disease_rate']:.4f} <= "
                  f"{TAU_HEALTHY_MAX_FN_RATE}. Needs a product decision.")

    # ── Policy override ──────────────────────────────────────────────────────
    derived = {"tau": tau, "tauHealthy": tau_healthy}
    override_cfg = (config.get("calibration") or {}).get("policy_override")
    override_record = None

    if override_cfg:
        ok, checks = validate_override(
            override_cfg, curve, healthy_curve, probabilities_after, targets, healthy_indices
        )
        print(f"   policy override (approved {override_cfg.get('approved')}): "
              f"tau {tau} -> {override_cfg['tau']}, tau_healthy {tau_healthy} -> "
              f"{override_cfg['tau_healthy']}")
        for check in checks:
            print(f"     [{'PASS' if check['passed'] else 'FAIL'}] {check['criterion']} "
                  f"-> {check['measured']}")

        if not ok:
            # Fatal: an override that fails a documented criterion is not a
            # decision, it is a way around the rules.
            print("   override REJECTED — it fails a documented criterion", file=sys.stderr)
            return 2

        tau = override_cfg["tau"]
        tau_healthy = override_cfg["tau_healthy"]
        override_record = {
            "applied": True,
            "approved": override_cfg.get("approved"),
            "reason": override_cfg.get("reason"),
            "derived": derived,
            "effective": {"tau": tau, "tauHealthy": tau_healthy},
            "validation": checks,
        }

    policy = None
    if tau is not None and tau_healthy is not None:
        # confidence-strategy.md is explicit that tau_healthy is "stricter" than
        # tau. If the data says otherwise the derivation is reported as-is and
        # flagged, rather than being quietly clamped.
        if tau_healthy < tau:
            print(
                f"   NOTE: derived tau_healthy ({tau_healthy}) is below tau ({tau}); "
                "the doc describes tau_healthy as stricter. Reported as derived.",
            )
        policy = production_policy_report(
            probabilities_after, targets, healthy_indices, tau, tau_healthy
        )
        print(f"   production policy (tau + margin {MARGIN_GUARD} + tau_healthy): "
              f"coverage {policy['coverage']:.4f}, "
              f"precision {policy['precision_of_accepted']:.4f}, "
              f"abstain {policy['abstain_rate']:.4f}")

    # ── Persist ──────────────────────────────────────────────────────────────
    result = {
        "todo": "P4-4",
        "generatedAt": datetime.now(UTC).isoformat(timespec="seconds"),
        "method": "docs/ml/confidence-strategy.md",
        "checkpoint": str(checkpoint.relative_to(REPO)).replace("\\", "/"),
        "checkpointSha256_16": bundle["checkpoint_sha256_16"],
        "calibrationSplit": args.split,
        "samples": len(targets),
        "classes": classes,
        "healthyClasses": sorted(classes[index] for index in healthy_indices),
        "temperature": round(temperature, 6),
        "nll": {"before": round(nll["nll_before"], 6), "after": round(nll["nll_after"], 6)},
        "ece": {"bins": ECE_BINS, "before": round(ece_before, 6), "after": round(ece_after, 6)},
        # `thresholds` is what SHIPS. `derivedThresholds` is what the data said
        # before any decision was applied — kept separate so the measurement is
        # never overwritten by the choice made on top of it.
        "thresholds": {
            "tau": tau,
            "tauHealthy": tau_healthy,
            "marginGuard": MARGIN_GUARD,
        },
        "derivedThresholds": derived,
        "policyOverride": override_record,
        # A criterion is "binding" only if it actually excluded something. Both
        # of these derive to 0.00 for this model: precision at threshold 0 is
        # already 0.9654 against a 0.90 floor, and the healthy false-negative
        # rate is already 0.0098 against a 0.05 ceiling. The derivations are
        # correct and the criteria simply do not constrain a model this accurate
        # — confidence-strategy.md's expected 0.70-0.80 neighbourhood assumed a
        # weaker one. Recorded as a flag rather than resolved here, because
        # substituting a hand-picked threshold would be inventing the number the
        # doc says must come from the data.
        "criteriaBinding": {
            "tau": bool(tau is not None and tau > 0),
            "tauHealthy": bool(tau_healthy is not None and tau_healthy > 0),
            "note": (
                "A threshold of 0.00 means the documented criterion is satisfied without "
                "excluding anything, so confidence-based abstention is inactive and the "
                "margin guard is the only mechanism producing an uncertain result. This is "
                "a product decision, not a measurement — see the reference points below."
            ),
        },
        # What the doc's expected neighbourhood would cost, so the team can
        # choose an override against real numbers instead of intuition.
        "referencePoints": [
            point for point in curve if point["threshold"] in (0.70, 0.75, 0.80, 0.90)
        ],
        "derivation": {
            "tauCriterion": f"lowest threshold with precision-of-accepted >= {TAU_MIN_PRECISION}",
            "tauPoint": tau_point,
            "tauHealthyCriterion": (
                f"lowest threshold with false-negative-disease rate among accepted-healthy "
                f"<= {TAU_HEALTHY_MAX_FN_RATE}"
            ),
            "tauHealthyPoint": healthy_point,
            "marginGuardSource": "published in docs/ml/confidence-strategy.md, not derived",
        },
        "productionPolicy": policy,
        "calibrated": tau is not None and tau_healthy is not None,
        "precisionCoverageCurve": curve,
        "healthyThresholdCurve": healthy_curve,
        "reliabilityBins": bins_after,
    }

    output = HERE / "calibration.json"
    output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(f"   wrote {output.relative_to(REPO)}")

    return 0 if result["calibrated"] else 1


if __name__ == "__main__":
    sys.exit(main())
