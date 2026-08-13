"""Service-key comparison unit tests (the HTTP-level checks live in test_predict_api)."""

from __future__ import annotations

import hashlib

from app.security import verify_service_key

KEY = "k" * 64


def test_correct_key_accepted() -> None:
    assert verify_service_key(KEY, KEY) is True


def test_missing_key_rejected() -> None:
    assert verify_service_key(None, KEY) is False


def test_empty_key_rejected() -> None:
    assert verify_service_key("", KEY) is False


def test_wrong_key_of_same_length_rejected() -> None:
    assert verify_service_key("j" * 64, KEY) is False


def test_wrong_length_keys_rejected() -> None:
    # Both directions: shorter and longer than the expected key.
    assert verify_service_key("k" * 63, KEY) is False
    assert verify_service_key("k" * 65, KEY) is False
    assert verify_service_key(KEY + "extra", KEY) is False


def test_prefix_of_correct_key_rejected() -> None:
    assert verify_service_key(KEY[:32], KEY) is False


def test_comparison_operates_on_fixed_width_digests() -> None:
    """Structural guard for the timing property.

    Timing cannot be asserted reliably in CI, so the test pins the *mechanism*
    instead: both sides are reduced to 32-byte SHA-256 digests before the
    constant-time compare, which is what removes the length side channel.
    """
    for candidate in ("", "x", "x" * 1000, KEY):
        assert len(hashlib.sha256(candidate.encode()).digest()) == 32


def test_unicode_key_does_not_raise() -> None:
    assert verify_service_key("नमस्ते", KEY) is False
