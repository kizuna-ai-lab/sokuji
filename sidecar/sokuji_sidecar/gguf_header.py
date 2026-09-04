"""Minimal GGUF header reader (spec A §3.3): `general.architecture` and the set of tensor
dtypes, without loading anything. Header-only: reads a few hundred KiB at most (the tokenizer
KVs are skipped, not decoded). GGUF v2/v3 little-endian.

Any truncated or malformed header — a `struct.unpack` short read, a length-prefixed string
claiming more bytes than the file has, or bytes that are not valid UTF-8 — raises GgufError,
never a raw struct.error/UnicodeDecodeError/OverflowError. Callers need only catch GgufError."""
from __future__ import annotations

import struct
from dataclasses import dataclass

# ggml_type ids -> ggml_type_name() spellings (ggml.h v0.22.0). Only what a reader may meet.
GGML_TYPE_NAMES = {
    0: "f32", 1: "f16", 2: "q4_0", 3: "q4_1", 6: "q5_0", 7: "q5_1", 8: "q8_0", 9: "q8_1",
    10: "q2_K", 11: "q3_K", 12: "q4_K", 13: "q5_K", 14: "q6_K", 15: "q8_K",
    16: "iq2_xxs", 17: "iq2_xs", 18: "iq3_xxs", 19: "iq1_s", 20: "iq4_nl", 21: "iq3_s", 22: "iq2_s",
    23: "iq4_xs", 24: "i8", 25: "i16", 26: "i32", 27: "i64", 28: "f64", 29: "iq1_m", 30: "bf16",
    34: "tq1_0", 35: "tq2_0", 39: "mxfp4",
}


class GgufError(ValueError):
    pass


@dataclass(frozen=True)
class GgufHeader:
    architecture: str
    tensor_types: frozenset[str]
    n_tensors: int


_KV_SIZES = {0: 1, 1: 1, 2: 2, 3: 2, 4: 4, 5: 4, 6: 4, 7: 1, 10: 8, 11: 8, 12: 8}   # fixed-size KV value types


class _R:
    def __init__(self, f):
        self.f = f

    def u32(self):
        return struct.unpack("<I", self.f.read(4))[0]

    def u64(self):
        return struct.unpack("<Q", self.f.read(8))[0]

    def s(self):
        n = self.u64()
        buf = self.f.read(n)
        if len(buf) != n:
            raise ValueError(f"string of length {n} truncated to {len(buf)} bytes")
        return buf.decode("utf-8", "strict")

    def skip_value(self, ty: int):
        if ty == 8:
            self.s()
            return
        if ty == 9:                                    # array: elem type, count, then elems
            et, n = self.u32(), self.u64()
            if et in _KV_SIZES:
                self.f.seek(_KV_SIZES[et] * n, 1)
            else:
                for _ in range(n):
                    self.skip_value(et)
            return
        if ty in _KV_SIZES:
            self.f.seek(_KV_SIZES[ty], 1)
            return
        raise GgufError(f"unknown KV value type {ty}")


def read_header(path: str) -> GgufHeader:
    with open(path, "rb") as f:
        if f.read(4) != b"GGUF":
            raise GgufError(f"{path}: not a GGUF file")
        r = _R(f)
        try:
            version = r.u32()
            if version not in (2, 3):
                raise GgufError(f"{path}: unsupported GGUF version {version}")
            n_tensors, n_kv = r.u64(), r.u64()
            arch = ""
            for _ in range(n_kv):
                key = r.s()
                ty = r.u32()
                if key == "general.architecture" and ty == 8:
                    arch = r.s()
                else:
                    r.skip_value(ty)
            types = set()
            for _ in range(n_tensors):
                r.s()                                      # name
                nd = r.u32()
                for _ in range(nd):
                    r.u64()                                # dims
                types.add(GGML_TYPE_NAMES.get(r.u32(), "unknown"))
                r.u64()                                    # offset
        except GgufError:
            raise                                          # already specific (version, unknown KV type, ...)
        except (struct.error, ValueError, OverflowError) as e:
            # Short reads (struct.error), a length-prefixed string running past EOF or past a
            # seek (ValueError from _R.s()), and non-UTF-8 string bytes (UnicodeDecodeError,
            # a ValueError subclass) all land here — a truncated or corrupted-but-magic-valid
            # file, not a programming error.
            raise GgufError(f"{path}: truncated or malformed GGUF header ({e})") from e
        return GgufHeader(arch, frozenset(types), n_tensors)
