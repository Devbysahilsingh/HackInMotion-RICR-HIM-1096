"""Startup configuration: fail fast, no keyless mode, docs off by default."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.config import ConfigError, Settings, load_settings

VALID_KEY = "a" * 64


def test_missing_service_key_refuses_to_start() -> None:
    with pytest.raises(ConfigError) as excinfo:
        load_settings({})
    assert "SERVICE_KEY" in str(excinfo.value)


def test_blank_service_key_refuses_to_start() -> None:
    with pytest.raises(ConfigError):
        load_settings({"SERVICE_KEY": "   "})


def test_missing_service_key_fails_in_production_too() -> None:
    with pytest.raises(ConfigError):
        load_settings({"ENV": "production"})


def test_short_service_key_rejected_in_every_environment() -> None:
    for env in ("development", "test", "production"):
        with pytest.raises(ConfigError) as excinfo:
            load_settings({"ENV": env, "SERVICE_KEY": "short"})
        assert "at least 32" in str(excinfo.value)


def test_env_defaults_to_production_when_unset() -> None:
    settings = load_settings({"SERVICE_KEY": VALID_KEY})
    assert settings.env == "production"
    assert settings.is_production is True
    assert settings.docs_enabled is False


def test_unknown_env_rejected() -> None:
    with pytest.raises(ConfigError):
        load_settings({"ENV": "staging", "SERVICE_KEY": VALID_KEY})


def test_docs_only_enabled_in_development() -> None:
    assert load_settings({"ENV": "development", "SERVICE_KEY": VALID_KEY}).docs_enabled is True
    assert load_settings({"ENV": "test", "SERVICE_KEY": VALID_KEY}).docs_enabled is False
    assert load_settings({"ENV": "production", "SERVICE_KEY": VALID_KEY}).docs_enabled is False


def test_settings_are_immutable() -> None:
    settings = Settings(env="test", service_key=VALID_KEY)
    # Narrowed from a bare `Exception`: `frozen=True` is what makes this fail,
    # and pydantic reports that as a ValidationError. Accepting any exception
    # would keep passing if the model stopped being frozen and started failing
    # for some unrelated reason.
    with pytest.raises(ValidationError):
        settings.service_key = "b" * 64  # type: ignore[misc]


def test_model_path_is_none_unless_configured() -> None:
    assert load_settings({"SERVICE_KEY": VALID_KEY}).model_path is None
    configured = load_settings({"SERVICE_KEY": VALID_KEY, "MODEL_PATH": "model/x.onnx"})
    assert configured.model_path is not None
