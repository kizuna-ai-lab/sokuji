"""A minimal GGUF v2/v3 header reader: architecture + the tensor dtype set. Tested on a file
written here (no model download) and, when present, on the cached whisper-tiny GGUF."""
import os
import struct

import pytest

from sokuji_sidecar import gguf_header

GGUF_MAGIC = b"GGUF"


def _write_gguf(path, arch: str, tensors: list[tuple[str, int]]):
    """tensors: (name, ggml_type id). Writes header + tensor infos, no data."""
    def s(x: str) -> bytes:
        b = x.encode()
        return struct.pack("<Q", len(b)) + b
    out = bytearray(GGUF_MAGIC + struct.pack("<I", 3) + struct.pack("<Q", len(tensors)) + struct.pack("<Q", 2))
    out += s("general.architecture") + struct.pack("<I", 8) + s(arch)          # type 8 = string
    out += s("tokenizer.ggml.tokens") + struct.pack("<I", 9) + struct.pack("<I", 8) + struct.pack("<Q", 2) + s("a") + s("b")   # array of strings: must be skipped
    for name, ty in tensors:
        out += s(name) + struct.pack("<I", 2) + struct.pack("<QQ", 4, 4) + struct.pack("<I", ty) + struct.pack("<Q", 0)
    path.write_bytes(bytes(out))


def test_reads_architecture_and_dtype_set(tmp_path):
    p = tmp_path / "toy.gguf"
    _write_gguf(p, "qwen3", [("token_embd.weight", 8), ("blk.0.attn_q.weight", 12), ("blk.0.norm.weight", 0), ("output.weight", 30)])
    h = gguf_header.read_header(str(p))
    assert h.architecture == "qwen3"
    assert h.n_tensors == 4
    assert h.tensor_types == frozenset({"q8_0", "q4_K", "f32", "bf16"})   # ids 8, 12, 0, 30 as ggml names them


def test_rejects_non_gguf(tmp_path):
    p = tmp_path / "x.bin"
    p.write_bytes(b"NOPE" + b"\0" * 64)
    with pytest.raises(gguf_header.GgufError):
        gguf_header.read_header(str(p))


_WHISPER = os.path.expanduser("~/.cache/sokuji-native-tests/whisper-tiny-Q8_0.gguf")


@pytest.mark.skipif(not os.path.exists(_WHISPER), reason="cached model absent")
def test_real_whisper_tiny():
    h = gguf_header.read_header(_WHISPER)
    assert h.architecture == "whisper"
    assert "q8_0" in h.tensor_types and "f32" in h.tensor_types
