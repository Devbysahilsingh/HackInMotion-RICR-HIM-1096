"""Emit a tiny, deterministic .onnx file so the OnnxPredictor path is testable.

THIS IS NOT A MODEL. It is a three-node graph
(GlobalAveragePool -> Flatten -> MatMul) whose weights are a fixed pseudo-random
matrix. Its outputs carry no visual meaning at all. Its only job is to prove
that OnnxPredictor loads a real artefact, feeds it a real preprocessed tensor,
and gets back a correctly shaped logit vector — so that dropping in the trained
model later is a file swap and not a debugging session.

Why the protobuf is hand-serialised: the `onnx` package is on the *training*
dependency list, not the ml-service one (docs/security/dependency-security.md),
and the ml-service image must not grow a build-time dependency just to produce a
test fixture. The ONNX file format is protobuf, and a graph this small needs
only varint, length-delimited and fixed32 wire types — about eighty lines.

Output is .onnx, which .gitignore excludes, so the file is always generated,
never committed.

    python ml-service/scripts/make_stub_onnx.py [--out PATH] [--classes N]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import struct
from pathlib import Path

SERVICE_DIR = Path(__file__).resolve().parent.parent
DEFAULT_OUT = SERVICE_DIR / "model" / "model-stub.onnx"
MANIFEST = SERVICE_DIR / "model" / "model-manifest.json"

# ── Minimal protobuf writer ─────────────────────────────────────────────


def _varint(value: int) -> bytes:
    out = bytearray()
    while True:
        byte = value & 0x7F
        value >>= 7
        out.append(byte | (0x80 if value else 0))
        if not value:
            return bytes(out)


def _tag(field: int, wire_type: int) -> bytes:
    return _varint((field << 3) | wire_type)


def _bytes_field(field: int, payload: bytes) -> bytes:
    return _tag(field, 2) + _varint(len(payload)) + payload


def _string_field(field: int, value: str) -> bytes:
    return _bytes_field(field, value.encode("utf-8"))


def _varint_field(field: int, value: int) -> bytes:
    return _tag(field, 0) + _varint(value)


# ── ONNX message builders (field numbers from onnx.proto3) ──────────────


def _tensor_shape(dims: list[int]) -> bytes:
    # TensorShapeProto { repeated Dimension dim = 1 }
    # Dimension { int64 dim_value = 1 }
    return b"".join(_bytes_field(1, _varint_field(1, dim)) for dim in dims)


def _tensor_type(elem_type: int, dims: list[int]) -> bytes:
    # TypeProto { Tensor tensor_type = 1 }
    # Tensor { int32 elem_type = 1; TensorShapeProto shape = 2 }
    tensor = _varint_field(1, elem_type) + _bytes_field(2, _tensor_shape(dims))
    return _bytes_field(1, tensor)


def _value_info(name: str, dims: list[int]) -> bytes:
    # ValueInfoProto { string name = 1; TypeProto type = 2 }
    return _string_field(1, name) + _bytes_field(2, _tensor_type(1, dims))  # 1 = FLOAT


def _float_initializer(name: str, dims: list[int], values: list[float]) -> bytes:
    # TensorProto { repeated int64 dims = 1; int32 data_type = 2;
    #               string name = 8; bytes raw_data = 9 }
    body = b"".join(_varint_field(1, dim) for dim in dims)
    body += _varint_field(2, 1)  # FLOAT
    body += _string_field(8, name)
    body += _bytes_field(9, struct.pack(f"<{len(values)}f", *values))
    return body


def _node(op_type: str, inputs: list[str], outputs: list[str], name: str, attributes: bytes = b"") -> bytes:
    # NodeProto { repeated string input = 1; repeated string output = 2;
    #             string name = 3; string op_type = 4;
    #             repeated AttributeProto attribute = 5 }
    body = b"".join(_string_field(1, value) for value in inputs)
    body += b"".join(_string_field(2, value) for value in outputs)
    body += _string_field(3, name)
    body += _string_field(4, op_type)
    body += attributes
    return body


def _int_attribute(name: str, value: int) -> bytes:
    # AttributeProto { string name = 1; int64 i = 3; AttributeType type = 20 }
    body = _string_field(1, name) + _varint_field(3, value) + _varint_field(20, 2)  # 2 = INT
    return _bytes_field(5, body)


def build_stub_onnx(num_classes: int, *, seed: str = "him-1096-stub") -> bytes:
    """Graph: input[1,3,224,224] -> GAP -> Flatten -> MatMul(W[3,N]) -> logits[1,N]."""
    # Deterministic weights from a hash: reproducible on every machine, and
    # obviously not learned to anybody who opens the file.
    raw = hashlib.shake_256(seed.encode()).digest(3 * num_classes * 2)
    weights = [(int.from_bytes(raw[i * 2 : i * 2 + 2], "big") / 65535.0) * 4.0 - 2.0 for i in range(3 * num_classes)]

    nodes = (
        _bytes_field(1, _node("GlobalAveragePool", ["input"], ["pooled"], "gap"))
        + _bytes_field(1, _node("Flatten", ["pooled"], ["flat"], "flatten", _int_attribute("axis", 1)))
        + _bytes_field(1, _node("MatMul", ["flat", "W"], ["logits"], "matmul"))
    )

    graph = nodes
    graph += _string_field(2, "stub_graph")
    graph += _bytes_field(5, _float_initializer("W", [3, num_classes], weights))
    graph += _bytes_field(11, _value_info("input", [1, 3, 224, 224]))
    graph += _bytes_field(12, _value_info("logits", [1, num_classes]))

    model = _varint_field(1, 8)  # ir_version 8 (broadly compatible)
    model += _string_field(2, "ml-service/scripts/make_stub_onnx.py")
    model += _string_field(3, "0.0.0-stub")
    model += _bytes_field(7, graph)
    model += _bytes_field(8, _string_field(1, "") + _varint_field(2, 13))  # default domain, opset 13
    return model


def _num_classes_from_manifest() -> int:
    data = json.loads(MANIFEST.read_text(encoding="utf-8"))
    return len(data["classes"])


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument(
        "--classes",
        type=int,
        default=None,
        help="output width; defaults to the class count in model-manifest.json",
    )
    args = parser.parse_args()

    num_classes = args.classes or _num_classes_from_manifest()
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_bytes(build_stub_onnx(num_classes))
    print(f"wrote {args.out} ({args.out.stat().st_size} bytes, {num_classes} outputs) — NOT a trained model")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
