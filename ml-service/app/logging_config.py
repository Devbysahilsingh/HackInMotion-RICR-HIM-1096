"""Structured JSON logging to stdout.

docs/security/ai-security.md: "structured logs without image contents". The only
image-derived value any log line here carries is a byte count. There is no
formatter path that can serialise a payload, because no payload is ever passed
to the logger — the discipline is enforced at the call sites in main.py and
kept honest by tests/test_logging.py.
"""

from __future__ import annotations

import json
import logging
import sys
from typing import Any

# Attributes LogRecord always carries; anything else on the record is treated as
# caller-supplied structured context.
_RESERVED = frozenset(
    logging.LogRecord("", 0, "", 0, "", None, None).__dict__.keys()
) | {"message", "asctime", "taskName"}


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname,
            "service": "ml-service",
            "event": record.getMessage(),
        }
        for key, value in record.__dict__.items():
            if key not in _RESERVED and not key.startswith("_"):
                payload[key] = value
        if record.exc_info:
            # Type + message only. Tracebacks in a JSON log line are noise, and
            # exception text from a decoder can echo attacker-controlled bytes.
            exc_type = record.exc_info[0]
            payload["errorType"] = exc_type.__name__ if exc_type else "Unknown"
        return json.dumps(payload, default=str)


_OWNED = "_ml_service_handler"


def configure_logging(level: str = "INFO") -> logging.Logger:
    root = logging.getLogger()

    # Replace only the handler this function installed previously. Blanket-
    # clearing root.handlers would make create_app() a destructive call for any
    # host process that has its own logging set up — including the test runner's
    # capture handler, which is how log assertions stay possible at all.
    for existing in list(root.handlers):
        if getattr(existing, _OWNED, False):
            root.removeHandler(existing)

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    setattr(handler, _OWNED, True)
    root.addHandler(handler)
    root.setLevel(getattr(logging, level.upper(), logging.INFO))
    return logging.getLogger("ml-service")
