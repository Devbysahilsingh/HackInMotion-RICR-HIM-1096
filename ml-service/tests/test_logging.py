"""Logs must be structured, and must never contain image bytes or the key.

docs/security/ai-security.md: "structured logs without image contents".
"""

from __future__ import annotations

import json
import logging

from tests.conftest import TEST_SERVICE_KEY, make_image_bytes


def _captured(caplog) -> list[logging.LogRecord]:
    return list(caplog.records)


def test_prediction_log_carries_context_but_no_pixels(client, auth_headers, caplog) -> None:
    # A recognisable marker appended to the payload; if any log line echoed the
    # image, this byte pattern would show up in it.
    marker = b"\xde\xad\xbe\xef" * 8
    payload = make_image_bytes(120, 90) + marker

    with caplog.at_level(logging.INFO):
        response = client.post(
            "/predict",
            files={"image": ("leaf.jpg", payload, "image/jpeg")},
            data={"cropCode": "TOMATO"},
            headers=auth_headers,
        )
    assert response.status_code == 200

    records = _captured(caplog)
    predict_records = [record for record in records if record.getMessage() == "predict"]
    assert predict_records, "no predict log line emitted"

    record = predict_records[-1]
    assert record.cropCode == "TOMATO"
    assert record.bytes == len(payload)
    assert isinstance(record.reasons, list)

    blob = " ".join(str(record.__dict__) for record in records)
    assert "deadbeef" not in blob.lower()
    assert repr(marker)[2:10] not in blob


def test_no_log_line_contains_the_service_key(client, auth_headers, jpeg_bytes, caplog) -> None:
    with caplog.at_level(logging.DEBUG):
        client.post(
            "/predict",
            files={"image": ("leaf.jpg", jpeg_bytes, "image/jpeg")},
            data={"cropCode": "TOMATO"},
            headers={"X-Service-Key": "b" * 64},
        )
        client.post(
            "/predict",
            files={"image": ("leaf.jpg", jpeg_bytes, "image/jpeg")},
            data={"cropCode": "TOMATO"},
            headers=auth_headers,
        )
    blob = " ".join(str(record.__dict__) for record in _captured(caplog))
    assert TEST_SERVICE_KEY not in blob
    assert "b" * 64 not in blob


def test_rejected_image_is_logged_by_code_only(client, auth_headers, caplog) -> None:
    with caplog.at_level(logging.INFO):
        client.post(
            "/predict",
            files={"image": ("x.txt", b"definitely not an image payload", "image/jpeg")},
            data={"cropCode": "TOMATO"},
            headers=auth_headers,
        )
    records = [r for r in _captured(caplog) if r.getMessage() == "image_rejected"]
    assert records
    assert records[-1].code == "IMAGE_FORMAT_UNSUPPORTED"
    blob = str(records[-1].__dict__)
    assert "definitely not an image" not in blob


def test_json_formatter_emits_parseable_lines() -> None:
    from app.logging_config import JsonFormatter

    record = logging.LogRecord("ml-service", logging.INFO, __file__, 1, "predict", None, None)
    record.cropCode = "TOMATO"
    line = json.loads(JsonFormatter().format(record))
    assert line["event"] == "predict"
    assert line["level"] == "INFO"
    assert line["service"] == "ml-service"
    assert line["cropCode"] == "TOMATO"


def test_startup_announces_provisional_configuration_iff_it_is_provisional(make_app, caplog, manifest) -> None:
    """An operator must never have to guess whether answers are real.

    Tied to the manifest rather than asserted unconditionally: warning about a
    provisional model that is no longer provisional is its own kind of dishonest,
    and would train operators to ignore the line.
    """
    from fastapi.testclient import TestClient

    with caplog.at_level(logging.WARNING):
        with TestClient(make_app()):
            pass
    warnings = [r for r in _captured(caplog) if r.getMessage() == "provisional_model_configuration"]

    assert bool(warnings) is bool(manifest.provisional)
