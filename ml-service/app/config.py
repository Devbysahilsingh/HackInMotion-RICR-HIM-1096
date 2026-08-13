"""Environment configuration, validated once at import time.

docs/deployment/environment.md promises "missing secret => refuse to start with
a clear message". That doc names pydantic-settings; this module uses plain
os.environ + a pydantic model instead, because pydantic-settings is not on the
locked ml dependency list in docs/security/dependency-security.md and reading
six variables does not earn a new dependency.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field, ValidationError, field_validator

Environment = Literal["development", "test", "production"]

SERVICE_DIR = Path(__file__).resolve().parent.parent
DEFAULT_MODEL_MANIFEST = SERVICE_DIR / "model" / "model-manifest.json"

# 256-bit key per docs/security/ai-security.md; `openssl rand -hex 32` is 64
# hex chars, so 32 is a floor that catches "changeme", not a target.
MIN_SERVICE_KEY_LENGTH = 32

# docs/ml/inference-architecture.md: image bytes <= 8MB.
MAX_IMAGE_BYTES = 8 * 1024 * 1024

# Decompression-bomb guards. Both are enforced: a 6000x6000 image is under the
# 36MP cap, and a 40000x100 strip is under 6000 on neither axis but would still
# be refused by the pixel cap — the two limits catch different shapes.
MAX_IMAGE_PIXELS = 36_000_000
MAX_IMAGE_DIMENSION = 6000


class Settings(BaseModel):
    """Validated runtime settings. Constructed once; never mutated."""

    model_config = {"frozen": True, "extra": "forbid"}

    env: Environment = "production"
    service_key: str = Field(min_length=1)
    model_manifest_path: Path = DEFAULT_MODEL_MANIFEST
    model_path: Path | None = None
    model_version_override: str | None = None
    port: int = Field(default=7860, ge=1, le=65535)
    log_level: str = "INFO"
    request_timeout_seconds: float = Field(default=10.0, gt=0)

    @field_validator("service_key")
    @classmethod
    def _key_must_be_long_enough(cls, value: str) -> str:
        # Enforced in every environment, not just production. A short key in dev
        # is a short key that gets copy-pasted into a Space secret on demo day.
        if len(value) < MIN_SERVICE_KEY_LENGTH:
            raise ValueError(
                f"SERVICE_KEY must be at least {MIN_SERVICE_KEY_LENGTH} characters "
                "(generate with `openssl rand -hex 32`)"
            )
        return value

    @property
    def is_production(self) -> bool:
        return self.env == "production"

    @property
    def docs_enabled(self) -> bool:
        # docs/security/ai-security.md: OpenAPI docs disabled outside development.
        return self.env == "development"


class ConfigError(RuntimeError):
    """Raised when the process cannot legitimately start."""


def load_settings(environ: dict[str, str] | None = None) -> Settings:
    """Build Settings from the environment, failing fast and loudly.

    Defaults to `production` when ENV is unset: an unlabelled deployment is far
    more likely to be a real one than a laptop, and the failure mode of guessing
    "development" (docs exposed, weak key tolerated) is the dangerous direction.
    """
    source = os.environ if environ is None else environ

    raw_env = (source.get("ENV") or "production").strip().lower()
    if raw_env not in ("development", "test", "production"):
        raise ConfigError(f"ENV must be one of development|test|production (got {raw_env!r})")

    service_key = source.get("SERVICE_KEY", "").strip()
    if not service_key:
        raise ConfigError(
            "SERVICE_KEY is not set. ml-service refuses to start without it — "
            "there is no keyless mode, in any environment."
        )

    model_path_raw = (source.get("MODEL_PATH") or "").strip()
    manifest_raw = (source.get("MODEL_MANIFEST_PATH") or "").strip()

    try:
        return Settings(
            env=raw_env,  # type: ignore[arg-type]
            service_key=service_key,
            model_manifest_path=Path(manifest_raw) if manifest_raw else DEFAULT_MODEL_MANIFEST,
            model_path=Path(model_path_raw) if model_path_raw else None,
            model_version_override=(source.get("MODEL_VERSION") or "").strip() or None,
            port=int(source.get("PORT") or 7860),
            log_level=(source.get("LOG_LEVEL") or "INFO").strip().upper(),
            request_timeout_seconds=float(source.get("REQUEST_TIMEOUT_SECONDS") or 10.0),
        )
    except (ValidationError, ValueError) as exc:
        raise ConfigError(f"invalid ml-service configuration: {exc}") from exc
