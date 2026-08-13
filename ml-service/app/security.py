"""Service-key authentication for /predict.

docs/security/ai-security.md: 256-bit key from env, constant-time compare,
forged key => 401. The backend is the only legitimate caller.
"""

from __future__ import annotations

import hashlib
import hmac

SERVICE_KEY_HEADER = "X-Service-Key"


def verify_service_key(presented: str | None, expected: str) -> bool:
    """Constant-time service-key check.

    hmac.compare_digest alone is constant-time *for equal-length inputs* but
    returns immediately on a length mismatch, which leaks the key length to an
    attacker who can time responses. Hashing both sides first makes every
    comparison run over exactly 32 bytes, so a wrong-length guess costs the same
    as a wrong-value guess. (SHA-256 here is a length equaliser, not a password
    hash — the secret is high-entropy random, so no KDF is warranted.)
    """
    if presented is None:
        # Nothing to compare. Still no early-exit signal worth protecting: the
        # absence of a header is visible to the caller anyway.
        return False

    presented_digest = hashlib.sha256(presented.encode("utf-8")).digest()
    expected_digest = hashlib.sha256(expected.encode("utf-8")).digest()
    return hmac.compare_digest(presented_digest, expected_digest)
