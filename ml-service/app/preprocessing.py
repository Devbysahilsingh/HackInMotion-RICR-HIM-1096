"""Image validation and the training-parity preprocessing transform.

Request path (docs/ml/inference-architecture.md):
    bytes -> sniff -> PIL decode (bomb-guarded) -> EXIF-normalize -> RGB
          -> Resize(256, shortest side) -> CenterCrop(224) -> ImageNet normalize

The transform constants live in the model manifest, not here, because they must
match the training transform exactly and the manifest is the artefact that ships
next to the weights. This module never writes to disk and never logs pixels.
"""

from __future__ import annotations

import io
from array import array
from dataclasses import dataclass
from typing import Final

from PIL import Image, ImageOps, UnidentifiedImageError

from app.classes import Preprocessing
from app.config import MAX_IMAGE_BYTES, MAX_IMAGE_DIMENSION, MAX_IMAGE_PIXELS

# Belt and braces with the explicit size checks below: this makes Pillow itself
# refuse a bomb even on a code path that forgets to look at .size first.
Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS

# Formats accepted before any decoder touches the bytes. The backend re-encodes
# uploads before forwarding (docs/security/ai-security.md), so this list only
# has to cover what the backend emits, not what a phone can produce.
_MAGIC: Final[tuple[tuple[bytes, str], ...]] = (
    (b"\xff\xd8\xff", "JPEG"),
    (b"\x89PNG\r\n\x1a\n", "PNG"),
)
_RIFF: Final[bytes] = b"RIFF"
_WEBP: Final[bytes] = b"WEBP"


class ImageRejected(ValueError):
    """A caller-supplied image failed validation. Carries a stable error code."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True)
class Tensor:
    """A CHW float32 tensor held in stdlib storage.

    Deliberately not a numpy array: numpy is not on the locked ml dependency
    list (docs/security/dependency-security.md) — it arrives only as an
    onnxruntime transitive dep. Keeping the preprocessing output framework-free
    means the whole validate-and-transform path, and its tests, run without
    onnxruntime installed. OnnxPredictor does the zero-copy numpy view itself.
    """

    data: array
    shape: tuple[int, int, int, int]

    def tobytes(self) -> bytes:
        return self.data.tobytes()


def sniff_format(payload: bytes) -> str:
    """Identify the container from magic bytes, before invoking a decoder.

    Rejecting here rather than after Image.open is the point: an unknown or
    hostile container never reaches parsing code at all. GIF, BMP, TIFF and HEIC
    all fail this check — GIF because animation is unsupported, the rest because
    nothing in the pipeline produces them.
    """
    if len(payload) < 12:
        raise ImageRejected("IMAGE_INVALID", "payload is too short to be an image")

    for magic, name in _MAGIC:
        if payload.startswith(magic):
            return name

    if payload[:4] == _RIFF and payload[8:12] == _WEBP:
        return "WEBP"

    raise ImageRejected(
        "IMAGE_FORMAT_UNSUPPORTED",
        "unsupported image format (expected JPEG, PNG or WebP)",
    )


def validate_payload(payload: bytes) -> str:
    """Size + format gate. Returns the sniffed format name."""
    if not payload:
        raise ImageRejected("IMAGE_INVALID", "empty image payload")
    if len(payload) > MAX_IMAGE_BYTES:
        raise ImageRejected(
            "IMAGE_TOO_LARGE",
            f"image exceeds the {MAX_IMAGE_BYTES // (1024 * 1024)}MB limit",
        )
    return sniff_format(payload)


def decode(payload: bytes) -> Image.Image:
    """Decode to a fully-loaded RGB image with EXIF orientation applied."""
    validate_payload(payload)

    try:
        image = Image.open(io.BytesIO(payload))
    except UnidentifiedImageError as exc:
        raise ImageRejected("IMAGE_INVALID", "image could not be decoded") from exc
    except Image.DecompressionBombError as exc:
        raise ImageRejected("IMAGE_TOO_LARGE", "image dimensions exceed the pixel limit") from exc
    except OSError as exc:
        raise ImageRejected("IMAGE_INVALID", "image could not be decoded") from exc

    with image:
        # Dimension checks run against the header, before the pixel data is
        # materialised — that is the only point where refusing costs nothing.
        width, height = image.size
        if width <= 0 or height <= 0:
            raise ImageRejected("IMAGE_INVALID", "image has zero extent")
        if width > MAX_IMAGE_DIMENSION or height > MAX_IMAGE_DIMENSION:
            raise ImageRejected(
                "IMAGE_TOO_LARGE",
                f"image dimensions exceed {MAX_IMAGE_DIMENSION}px on a side",
            )
        if width * height > MAX_IMAGE_PIXELS:
            raise ImageRejected("IMAGE_TOO_LARGE", "image dimensions exceed the pixel limit")

        # Catches APNG and animated WebP, which pass the format sniff. Only the
        # first frame would ever be classified, so accepting them would mean
        # silently ignoring most of what the farmer sent.
        if getattr(image, "n_frames", 1) > 1 or getattr(image, "is_animated", False):
            raise ImageRejected("IMAGE_ANIMATED", "animated images are not supported")

        try:
            # exif_transpose loads the image; a truncated file fails here rather
            # than producing a half-grey tensor the model would happily score.
            oriented = ImageOps.exif_transpose(image)
        except Image.DecompressionBombError as exc:
            raise ImageRejected("IMAGE_TOO_LARGE", "image dimensions exceed the pixel limit") from exc
        except (OSError, SyntaxError, ValueError) as exc:
            raise ImageRejected("IMAGE_INVALID", "image data is corrupt or truncated") from exc

        if oriented is None:  # pragma: no cover - defensive; Pillow returns a copy
            raise ImageRejected("IMAGE_INVALID", "image could not be normalised")

        try:
            return oriented.convert("RGB")
        except (OSError, ValueError) as exc:
            raise ImageRejected("IMAGE_INVALID", "image data is corrupt or truncated") from exc


def _resize_shortest_side(image: Image.Image, target: int) -> Image.Image:
    """torchvision Resize(int) semantics: scale so the shorter side == target.

    PIL's BILINEAR resampling is support-scaled (antialiased) on downscale,
    which is what torchvision's antialias=True produces. The golden-image parity
    test is what will prove that claim once training code exists to compare to.
    """
    width, height = image.size
    if width == height:
        new_size = (target, target)
    elif width < height:
        new_size = (target, max(1, round(target * height / width)))
    else:
        new_size = (max(1, round(target * width / height)), target)
    if new_size == image.size:
        return image
    return image.resize(new_size, Image.Resampling.BILINEAR)


def _center_crop(image: Image.Image, size: int) -> Image.Image:
    width, height = image.size
    left = (width - size) // 2
    top = (height - size) // 2
    return image.crop((left, top, left + size, top + size))


def to_tensor(image: Image.Image, spec: Preprocessing) -> Tensor:
    """Resize -> center-crop -> scale to [0,1] -> ImageNet normalize -> NCHW."""
    resized = _resize_shortest_side(image, spec.resize_shortest_side)
    cropped = _center_crop(resized, spec.center_crop)

    size = spec.center_crop
    raw = cropped.tobytes()  # HWC, uint8, row-major
    expected = size * size * 3
    if len(raw) != expected:  # pragma: no cover - guards a Pillow behaviour change
        raise ImageRejected("IMAGE_INVALID", "unexpected pixel buffer shape")

    values = array("f")
    for channel in range(3):
        mean = spec.mean[channel]
        std = spec.std[channel]
        # Fold /255, -mean and /std into one multiply-add so the inner loop is a
        # single Python expression over 50k pixels rather than three.
        scale = 1.0 / (255.0 * std)
        offset = mean / std
        plane = raw[channel::3]
        values.extend(byte * scale - offset for byte in plane)

    return Tensor(data=values, shape=(1, 3, size, size))


def preprocess(payload: bytes, spec: Preprocessing) -> Tensor:
    """Full path from request bytes to model input."""
    return to_tensor(decode(payload), spec)
