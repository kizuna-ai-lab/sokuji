"""A minimal GGUF v2/v3 header reader: architecture, the tensor dtype set and the matrix
dtype set. Tested on a file written here (no model download) and, when present, on the cached
whisper-tiny GGUF."""
import io
import os
import pathlib
import struct

import pytest

from sokuji_sidecar import gguf_header

GGUF_MAGIC = b"GGUF"


def _gguf_bytes(arch: str, tensors: list[tuple]) -> bytes:
    """tensors: (name, ggml_type id) for a 4x4 matrix, or (name, ggml_type id, dims). Header +
    tensor infos, no data."""
    def s(x: str) -> bytes:
        b = x.encode()
        return struct.pack("<Q", len(b)) + b
    out = bytearray(GGUF_MAGIC + struct.pack("<I", 3) + struct.pack("<Q", len(tensors)) + struct.pack("<Q", 2))
    out += s("general.architecture") + struct.pack("<I", 8) + s(arch)          # type 8 = string
    out += s("tokenizer.ggml.tokens") + struct.pack("<I", 9) + struct.pack("<I", 8) + struct.pack("<Q", 2) + s("a") + s("b")   # array of strings: must be skipped
    for name, ty, *rest in tensors:
        dims = rest[0] if rest else (4, 4)
        out += s(name) + struct.pack("<I", len(dims)) + struct.pack(f"<{len(dims)}Q", *dims)
        out += struct.pack("<I", ty) + struct.pack("<Q", 0)
    return bytes(out)


def _write_gguf(path, arch: str, tensors: list[tuple]):
    """Writes _gguf_bytes(arch, tensors) to `path`."""
    path.write_bytes(_gguf_bytes(arch, tensors))


def test_reads_architecture_and_dtype_set(tmp_path):
    p = tmp_path / "toy.gguf"
    _write_gguf(p, "qwen3", [("token_embd.weight", 8), ("blk.0.attn_q.weight", 12), ("blk.0.norm.weight", 0), ("output.weight", 30)])
    h = gguf_header.read_header(str(p))
    assert h.architecture == "qwen3"
    assert h.n_tensors == 4
    assert h.tensor_types == frozenset({"q8_0", "q4_K", "f32", "bf16"})   # ids 8, 12, 0, 30 as ggml names them


# CosyVoice 3's q8_0 file in miniature: a bf16 norm (1-D) beside a q8_0 matrix (2-D).
_NORM_AND_MATRIX = [("blk.0.norm.weight", 30, (896,)), ("output.weight", 8, (896, 6561))]


def test_matrix_types_leave_out_one_dimensional_tensors():
    """WEIGHT (the src0 of a MUL_MAT/MUL_MAT_ID/GET_ROWS) expands over the dtypes of the file's
    matrix tensors, those of two or more dimensions: a 1-D norm in bf16 must not put bf16 in
    the set while every matrix is q8_0. tensor_types still lists every tensor's dtype."""
    h = gguf_header.read_header(io.BytesIO(_gguf_bytes("cosyvoice3", _NORM_AND_MATRIX)))
    assert h.matrix_types == frozenset({"q8_0"})
    assert h.tensor_types == frozenset({"bf16", "q8_0"})
    assert h.architecture == "cosyvoice3" and h.n_tensors == 2


def test_a_path_and_a_stream_read_identically(tmp_path):
    """A path (str or os.PathLike) is opened and closed here; a binary file object is read as
    it is and left open, so a caller can hand in a remote file it owns."""
    data = _gguf_bytes("cosyvoice3", _NORM_AND_MATRIX)
    p = tmp_path / "toy.gguf"
    p.write_bytes(data)
    stream = io.BytesIO(data)
    from_stream = gguf_header.read_header(stream)
    assert not stream.closed
    assert gguf_header.read_header(str(p)) == from_stream
    assert gguf_header.read_header(pathlib.Path(p)) == from_stream


def test_a_stream_error_names_the_stream():
    with pytest.raises(gguf_header.GgufError, match="<stream>"):
        gguf_header.read_header(io.BytesIO(b"NOPE" + b"\0" * 64))
    with pytest.raises(gguf_header.GgufError, match="<stream>"):
        gguf_header.read_header(io.BytesIO(_gguf_bytes("cosyvoice3", _NORM_AND_MATRIX)[:40]))


def test_rejects_non_gguf(tmp_path):
    p = tmp_path / "x.bin"
    p.write_bytes(b"NOPE" + b"\0" * 64)
    with pytest.raises(gguf_header.GgufError):
        gguf_header.read_header(str(p))


def test_truncated_gguf_raises_gguf_error(tmp_path):
    """A magic-valid but truncated/corrupted file must raise GgufError, not a raw
    struct.error/ValueError — a caller catching only GgufError must never crash."""
    # Case 1: nothing past the magic bytes (fails on the version read).
    bare = tmp_path / "bare.gguf"
    bare.write_bytes(GGUF_MAGIC)
    with pytest.raises(gguf_header.GgufError):
        gguf_header.read_header(str(bare))

    # Case 2: a real header cut off partway through the first KV's key string.
    p = tmp_path / "toy.gguf"
    _write_gguf(p, "qwen3", [("token_embd.weight", 8), ("blk.0.attn_q.weight", 12), ("blk.0.norm.weight", 0), ("output.weight", 30)])
    cut = tmp_path / "cut.gguf"
    cut.write_bytes(p.read_bytes()[:40])
    with pytest.raises(gguf_header.GgufError):
        gguf_header.read_header(str(cut))

    # Case 3: a length-prefixed string field claiming more bytes than the file has.
    def s(x: str) -> bytes:
        b = x.encode()
        return struct.pack("<Q", len(b)) + b
    bad_len = tmp_path / "bad_len.gguf"
    out = bytearray(GGUF_MAGIC + struct.pack("<I", 3) + struct.pack("<Q", 0) + struct.pack("<Q", 1))
    out += s("general.architecture") + struct.pack("<I", 8)
    out += struct.pack("<Q", 10_000)          # claims a 10000-byte string
    out += b"short"                            # far fewer bytes actually follow
    bad_len.write_bytes(bytes(out))
    with pytest.raises(gguf_header.GgufError):
        gguf_header.read_header(str(bad_len))


_WHISPER = os.path.expanduser("~/.cache/sokuji-native-tests/whisper-tiny-Q8_0.gguf")


@pytest.mark.skipif(not os.path.exists(_WHISPER), reason="cached model absent")
def test_real_whisper_tiny():
    h = gguf_header.read_header(_WHISPER)
    assert h.architecture == "whisper"
    assert "q8_0" in h.tensor_types and "f32" in h.tensor_types
