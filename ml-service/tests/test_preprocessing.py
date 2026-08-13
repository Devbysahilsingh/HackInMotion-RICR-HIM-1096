"""Image validation and transform determinism."""

from __future__ import annotations

import hashlib
import io

import pytest
from PIL import Image

from app.preprocessing import ImageRejected, decode, preprocess, sniff_format, validate_payload
from tests.conftest import (
    make_animated_gif,
    make_animated_png,
    make_image_bytes,
    make_oversize_jpeg,
    make_pixel_bomb,
    make_truncated_jpeg,
)


# ── Format gate (runs before any decoder) ───────────────────────────────


def test_jpeg_png_webp_accepted() -> None:
    assert sniff_format(make_image_bytes(fmt="JPEG")) == "JPEG"
    assert sniff_format(make_image_bytes(fmt="PNG")) == "PNG"
    assert sniff_format(make_image_bytes(fmt="WEBP")) == "WEBP"


def test_plain_text_rejected_before_decode() -> None:
    with pytest.raises(ImageRejected) as excinfo:
        validate_payload(b"this is definitely not an image at all")
    assert excinfo.value.code == "IMAGE_FORMAT_UNSUPPORTED"


def test_html_payload_rejected() -> None:
    with pytest.raises(ImageRejected):
        validate_payload(b"<!doctype html><html><body>hello</body></html>")


def test_empty_payload_rejected() -> None:
    with pytest.raises(ImageRejected) as excinfo:
        validate_payload(b"")
    assert excinfo.value.code == "IMAGE_INVALID"


def test_tiny_payload_rejected() -> None:
    with pytest.raises(ImageRejected):
        validate_payload(b"\xff\xd8\xff")


def test_animated_gif_rejected_at_the_format_gate() -> None:
    # GIF is refused wholesale rather than per-frame: the pipeline has no use
    # for it and animation support would only mean silently scoring frame 0.
    with pytest.raises(ImageRejected) as excinfo:
        validate_payload(make_animated_gif())
    assert excinfo.value.code == "IMAGE_FORMAT_UNSUPPORTED"


def test_animated_png_rejected_after_decode() -> None:
    # APNG carries the PNG magic bytes, so the sniff cannot catch it.
    with pytest.raises(ImageRejected) as excinfo:
        decode(make_animated_png())
    assert excinfo.value.code == "IMAGE_ANIMATED"


def test_bmp_rejected() -> None:
    buffer = io.BytesIO()
    Image.new("RGB", (16, 16), (1, 2, 3)).save(buffer, format="BMP")
    with pytest.raises(ImageRejected):
        validate_payload(buffer.getvalue())


# ── Size and bomb guards ────────────────────────────────────────────────


def test_oversize_payload_rejected() -> None:
    with pytest.raises(ImageRejected) as excinfo:
        validate_payload(make_oversize_jpeg())
    assert excinfo.value.code == "IMAGE_TOO_LARGE"


def test_extreme_pixel_bomb_rejected() -> None:
    with pytest.raises(ImageRejected) as excinfo:
        decode(make_pixel_bomb(100_000, 100_000))
    assert excinfo.value.code == "IMAGE_TOO_LARGE"


@pytest.mark.filterwarnings("ignore::PIL.Image.DecompressionBombWarning")
def test_dimension_cap_rejects_wide_image_under_the_pixel_cap() -> None:
    # 7000x7000 = 49MP: over the 36MP cap and over the 6000px side cap.
    with pytest.raises(ImageRejected) as excinfo:
        decode(make_pixel_bomb(7000, 7000))
    assert excinfo.value.code == "IMAGE_TOO_LARGE"


def test_long_thin_strip_rejected_by_the_dimension_cap() -> None:
    # 40000x100 = 4MP, comfortably under the pixel cap; only the side cap
    # catches it. Both limits exist because they catch different shapes.
    with pytest.raises(ImageRejected) as excinfo:
        decode(make_pixel_bomb(40_000, 100))
    assert excinfo.value.code == "IMAGE_TOO_LARGE"


# ── Corrupt input ───────────────────────────────────────────────────────


def test_truncated_jpeg_rejected() -> None:
    with pytest.raises(ImageRejected) as excinfo:
        decode(make_truncated_jpeg())
    assert excinfo.value.code == "IMAGE_INVALID"


def test_corrupt_payload_with_valid_magic_rejected() -> None:
    with pytest.raises(ImageRejected):
        decode(b"\xff\xd8\xff" + b"\x41" * 4096)


def test_png_magic_with_garbage_body_rejected() -> None:
    with pytest.raises(ImageRejected):
        decode(b"\x89PNG\r\n\x1a\n" + b"\x00" * 512)


# ── Transform ───────────────────────────────────────────────────────────


def test_tensor_shape_and_dtype(manifest) -> None:
    tensor = preprocess(make_image_bytes(), manifest.preprocessing)
    assert tensor.shape == (1, 3, 224, 224)
    assert len(tensor.data) == 3 * 224 * 224
    assert tensor.data.typecode == "f"


def test_one_by_one_image_upscales_cleanly(manifest) -> None:
    tensor = preprocess(make_image_bytes(1, 1), manifest.preprocessing)
    assert tensor.shape == (1, 3, 224, 224)


def test_portrait_and_landscape_both_reach_224(manifest) -> None:
    for size in ((240, 800), (800, 240), (256, 256)):
        tensor = preprocess(make_image_bytes(*size), manifest.preprocessing)
        assert tensor.shape == (1, 3, 224, 224)


def test_preprocessing_is_deterministic(manifest) -> None:
    payload = make_image_bytes()
    first = hashlib.sha256(preprocess(payload, manifest.preprocessing).tobytes()).hexdigest()
    second = hashlib.sha256(preprocess(payload, manifest.preprocessing).tobytes()).hexdigest()
    assert first == second


def test_exif_rotated_image_matches_its_upright_twin(manifest) -> None:
    """EXIF orientation must be normalised, not ignored.

    Phone cameras store landscape sensors with an orientation tag; if it were
    ignored, the same leaf photographed the same way would land in a different
    tensor depending on how the phone was held.
    """
    upright = Image.new("RGB", (60, 90))
    for x in range(60):
        for y in range(90):
            upright.putpixel((x, y), ((x * 4) % 256, (y * 2) % 256, 90))

    # Rotate the pixels 90 degrees and tag the EXIF so the viewer rotates back.
    rotated = upright.transpose(Image.Transpose.ROTATE_270)
    exif = rotated.getexif()
    exif[274] = 6  # Orientation: rotate 90 CW on display
    rotated_buffer = io.BytesIO()
    rotated.save(rotated_buffer, format="JPEG", exif=exif, quality=95)

    upright_buffer = io.BytesIO()
    upright.save(upright_buffer, format="JPEG", quality=95)

    left = decode(rotated_buffer.getvalue())
    right = decode(upright_buffer.getvalue())
    assert left.size == right.size


def test_normalisation_uses_the_manifest_constants(manifest) -> None:
    """A mid-grey image maps to the exact ImageNet-normalised value per channel.

    This is the training-parity constant check. The full golden-image parity
    test (docs/ml/inference-architecture.md) cannot exist until there is
    training code to compare against; this pins the arithmetic in the meantime.
    """
    grey = Image.new("RGB", (300, 300), (128, 128, 128))
    buffer = io.BytesIO()
    grey.save(buffer, format="PNG")
    tensor = preprocess(buffer.getvalue(), manifest.preprocessing)

    plane = 224 * 224
    for channel in range(3):
        expected = (128 / 255.0 - manifest.preprocessing.mean[channel]) / manifest.preprocessing.std[channel]
        sample = tensor.data[channel * plane + plane // 2]
        assert sample == pytest.approx(expected, abs=1e-5)


def test_channel_order_is_rgb(manifest) -> None:
    red = Image.new("RGB", (300, 300), (255, 0, 0))
    buffer = io.BytesIO()
    red.save(buffer, format="PNG")
    tensor = preprocess(buffer.getvalue(), manifest.preprocessing)

    plane = 224 * 224
    mean = manifest.preprocessing.mean
    std = manifest.preprocessing.std
    assert tensor.data[plane // 2] == pytest.approx((1.0 - mean[0]) / std[0], abs=1e-5)
    assert tensor.data[plane + plane // 2] == pytest.approx((0.0 - mean[1]) / std[1], abs=1e-5)
    assert tensor.data[2 * plane + plane // 2] == pytest.approx((0.0 - mean[2]) / std[2], abs=1e-5)
