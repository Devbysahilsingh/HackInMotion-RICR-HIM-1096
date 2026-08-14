"""Shared fixtures and image factories.

Every image used by the suite is synthesised in memory. Nothing here reads from
datasets/ and nothing writes to disk, so the suite runs on a machine that has
never downloaded a single training image.
"""

from __future__ import annotations

import io
import struct
import zlib
from pathlib import Path
from typing import Callable, Iterator

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.classes import load_manifest
from app.config import DEFAULT_MODEL_MANIFEST, Settings
from app.main import create_app
from app.predictor import Predictor
from app.preprocessing import Tensor

# 64 hex chars, the shape `openssl rand -hex 32` produces. Test-only value.
TEST_SERVICE_KEY = "0" * 32 + "f" * 32


@pytest.fixture(scope="session")
def manifest():
    return load_manifest(DEFAULT_MODEL_MANIFEST)


@pytest.fixture
def settings() -> Settings:
    return Settings(env="test", service_key=TEST_SERVICE_KEY)


@pytest.fixture
def make_app() -> Callable[..., object]:
    """Factory so individual tests can vary env, timeout or model path."""

    def _make(**overrides) -> object:
        base = {"env": "test", "service_key": TEST_SERVICE_KEY}
        base.update(overrides)
        return create_app(Settings(**base))

    return _make


@pytest.fixture
def client(make_app) -> Iterator[TestClient]:
    with TestClient(make_app()) as test_client:
        yield test_client


@pytest.fixture
def auth_headers() -> dict[str, str]:
    return {"X-Service-Key": TEST_SERVICE_KEY}


# ── Image factories ─────────────────────────────────────────────────────


def make_image_bytes(
    width: int = 320,
    height: int = 240,
    fmt: str = "JPEG",
    color: tuple[int, int, int] = (34, 139, 34),
) -> bytes:
    image = Image.new("RGB", (width, height), color)
    # A flat colour compresses to almost nothing and makes every pixel identical
    # after the crop, so a gradient is drawn to give preprocessing real work.
    for x in range(width):
        for y in range(0, height, 8):
            image.putpixel((x, y), ((x * 7) % 256, (y * 3) % 256, (x + y) % 256))
    buffer = io.BytesIO()
    image.save(buffer, format=fmt)
    return buffer.getvalue()


@pytest.fixture
def jpeg_bytes() -> bytes:
    return make_image_bytes()


@pytest.fixture
def png_bytes() -> bytes:
    return make_image_bytes(fmt="PNG")


def make_animated_gif() -> bytes:
    frames = [Image.new("RGB", (32, 32), (i * 40, 20, 20)) for i in range(3)]
    buffer = io.BytesIO()
    frames[0].save(buffer, format="GIF", save_all=True, append_images=frames[1:], duration=50)
    return buffer.getvalue()


def make_animated_png() -> bytes:
    """APNG: passes the PNG magic-byte sniff, so it must be caught after decode."""
    frames = [Image.new("RGB", (32, 32), (i * 40, 20, 20)) for i in range(3)]
    buffer = io.BytesIO()
    frames[0].save(buffer, format="PNG", save_all=True, append_images=frames[1:], duration=50)
    return buffer.getvalue()


def _png_chunk(kind: bytes, payload: bytes) -> bytes:
    return (
        struct.pack(">I", len(payload))
        + kind
        + payload
        + struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF)
    )


def make_pixel_bomb(width: int, height: int) -> bytes:
    """A PNG whose IHDR *claims* huge dimensions but carries no pixel data.

    Allocating a real 100000x100000 image to test the bomb guard would be the
    bomb. The guard reads dimensions from the header, so a header is all the
    test needs — and this also proves the check happens before any pixel data is
    materialised, which is the whole point of a bomb guard.
    """
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)  # 8-bit RGB
    return (
        b"\x89PNG\r\n\x1a\n"
        + _png_chunk(b"IHDR", ihdr)
        + _png_chunk(b"IDAT", zlib.compress(b"\x00" * 16))
        + _png_chunk(b"IEND", b"")
    )


MULTIPART_BOUNDARY = "----mltest"
MULTIPART_CONTENT_TYPE = f"multipart/form-data; boundary={MULTIPART_BOUNDARY}"
# 256KB blocks: big enough that a 32MB body is ~128 reads, small enough that the
# cap lands mid-body rather than on a boundary.
MULTIPART_BLOCK = b"\xff\xd8\xff" + b"\x00" * (256 * 1024 - 3)


def multipart_prologue() -> bytes:
    """Everything up to the first byte of image data."""
    return (
        f"--{MULTIPART_BOUNDARY}\r\n"
        'Content-Disposition: form-data; name="cropCode"\r\n\r\nTOMATO\r\n'
        f"--{MULTIPART_BOUNDARY}\r\n"
        'Content-Disposition: form-data; name="image"; filename="leaf.jpg"\r\n'
        "Content-Type: image/jpeg\r\n\r\n"
    ).encode()


def chunked_multipart(total_bytes: int) -> Iterator[bytes]:
    """A multipart body yielded in pieces, so the client sends it chunked.

    A generator body makes httpx use `Transfer-Encoding: chunked`, which by
    definition carries no Content-Length — the exact shape that slips past a
    header-only size check. The image part opens with a real JPEG signature so
    that nothing can reject it on format grounds: size has to be the only thing
    wrong with it.
    """
    yield multipart_prologue()
    sent = 0
    while sent < total_bytes:
        sent += len(MULTIPART_BLOCK)
        yield MULTIPART_BLOCK
    yield f"\r\n--{MULTIPART_BOUNDARY}--\r\n".encode()


def make_truncated_jpeg() -> bytes:
    full = make_image_bytes(400, 400)
    return full[: len(full) // 2]


def make_oversize_jpeg() -> bytes:
    """A payload just over the 8MB image cap but under the request-size cap.

    Sized this way on purpose: it proves the *image* validator rejects it, not
    just the request-size middleware sitting in front of it.
    """
    base = make_image_bytes(64, 64)
    padding = (8 * 1024 * 1024) + 2048 - len(base)
    # Appended after EOI so the file stays a structurally valid JPEG; only its
    # length is out of bounds.
    return base + b"\x00" * padding


# ── Test doubles ────────────────────────────────────────────────────────


class FixedPredictor(Predictor):
    """Returns caller-chosen logits, so branch tests do not depend on hashes."""

    def __init__(self, logits: list[float], model_version: str = "fixed-test") -> None:
        self._logits = list(logits)
        self.num_classes = len(logits)
        self.model_version = model_version
        self.is_stub = True

    def infer(self, tensor: Tensor) -> list[float]:
        return list(self._logits)

    def warmup(self) -> None:  # no-op; nothing to warm
        return None


class SlowPredictor(Predictor):
    def __init__(self, num_classes: int, delay: float) -> None:
        self.num_classes = num_classes
        self.model_version = "slow-test"
        self.is_stub = True
        self._delay = delay

    def infer(self, tensor: Tensor) -> list[float]:
        import time

        time.sleep(self._delay)
        return [0.0] * self.num_classes

    def warmup(self) -> None:
        return None


class ExplodingPredictor(Predictor):
    def __init__(self, num_classes: int) -> None:
        self.num_classes = num_classes
        self.model_version = "exploding-test"
        self.is_stub = True

    def infer(self, tensor: Tensor) -> list[float]:
        from app.predictor import ModelUnavailable

        raise ModelUnavailable("session died")

    def warmup(self) -> None:
        return None


def logits_favouring(manifest, code: str, *, peak: float = 12.0, base: float = 0.0) -> list[float]:
    """Logit vector that puts almost all mass on one class."""
    return [peak if candidate == code else base for candidate in manifest.classes]


def logits_tied(manifest, first: str, second: str, *, peak: float = 8.0) -> list[float]:
    """Two near-equal leaders — the margin-guard scenario."""
    values = []
    for candidate in manifest.classes:
        if candidate == first:
            values.append(peak)
        elif candidate == second:
            values.append(peak - 0.01)
        else:
            values.append(-6.0)
    return values


REPO_ROOT = Path(__file__).resolve().parent.parent.parent
