"""ml-service — internal disease-classification inference service.

Contract: docs/ml/inference-architecture.md
Threshold policy: docs/ml/confidence-strategy.md
Security: docs/security/ai-security.md
"""

__all__ = ["__version__"]

# Service (code) version. The MODEL version is a separate, independently
# bumped identifier that lives in model/model-manifest.json — conflating the
# two is how a rebuilt image silently claims a new model.
__version__ = "0.1.0"
