"""Wire schemas. The response shape is fixed by docs/ml/inference-architecture.md.

    POST /predict -> {diseaseCode|null, uncertain, confidence, top3:[{code,prob}],
                      cropMismatch?, modelVersion, latencyMs}
    GET  /healthz -> {status, modelVersion, uptime}

No field is added beyond those. /healthz in particular exposes no internals —
no class list, no thresholds, no model path, no environment name — because it is
the only publicly reachable endpoint (docs/security/ai-security.md).
"""

from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

# Crop codes are SCREAMING_SNAKE identifiers (RICE, TOMATO, ...). Validating the
# shape here keeps junk out of logs and mask lookups; whether a *well-formed*
# code is actually covered by the model is the policy layer's business, not a
# 400 — see the crop-mismatch branch in policy.py.
CROP_CODE_PATTERN = re.compile(r"^[A-Z][A-Z0-9_]{1,31}$")


class ScoredClassOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str
    prob: float = Field(ge=0.0, le=1.0)


class PredictResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    diseaseCode: str | None = None
    uncertain: bool
    confidence: float = Field(ge=0.0, le=1.0)
    top3: list[ScoredClassOut]
    # Optional in the contract (`cropMismatch?`), so it is serialised only when
    # the branch actually fired; None is excluded at response time.
    cropMismatch: bool | None = None
    modelVersion: str
    latencyMs: float = Field(ge=0.0)


class HealthResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["ok", "degraded"]
    modelVersion: str
    uptime: float = Field(ge=0.0)


class ErrorBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str
    message: str


class ErrorResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    error: ErrorBody
