import numpy as np
import pytest
from sokuji_sidecar import pocket_bundle as pb


def test_constants():
    assert pb.SAMPLE_RATE == 24000 and pb.LATENT_DIM == 32 and pb.DEFAULT_LSD_STEPS == 1
    assert set(pb.MODEL_STEMS) == {
        "mimiEncoder", "textConditioner", "flowLmMain", "flowLmFlow", "mimiDecoder"}


def test_parse_npy_float32(tmp_path):
    arr = np.arange(5, dtype=np.float32)
    p = tmp_path / "x.npy"
    np.save(p, arr)
    out = pb.parse_npy_float32(str(p))
    assert out.dtype == np.float32 and np.allclose(out, arr)


def _ptvb_bytes(voices: dict) -> bytes:
    """Mirror of the writer in the upstream Space's scripts/export_voice_bins.py."""
    import struct
    out = bytearray(b"PTVB1")
    out += struct.pack("<I", len(voices))
    for name, tensors in voices.items():
        nb = name.encode("utf-8")
        out += struct.pack("<H", len(nb)) + nb
        out += struct.pack("<H", len(tensors))
        for key, arr in tensors.items():
            kb = key.encode("utf-8")
            out += struct.pack("<H", len(kb)) + kb
            code = {"float32": 0, "int64": 1, "bool": 2}[str(arr.dtype)]
            out += struct.pack("<BB", code, arr.ndim)
            for dim in arr.shape:
                out += struct.pack("<I", dim)
            raw = arr.tobytes(order="C")
            out += struct.pack("<I", len(raw)) + raw
    return bytes(out)


def test_parse_voices_bin_roundtrip(tmp_path):
    voices = {
        "alba": {"layer.0/cache": np.arange(12, dtype=np.float32).reshape(2, 6),
                 "layer.0/offset": np.asarray([126], dtype=np.int64)},
        "javert": {"layer.0/flag": np.asarray([True, False], dtype=np.bool_)},
    }
    p = tmp_path / "voices.bin"
    p.write_bytes(_ptvb_bytes(voices))
    out = pb.parse_voices_bin(str(p))
    assert set(out) == {"alba", "javert"}
    assert np.array_equal(out["alba"]["layer.0/cache"], voices["alba"]["layer.0/cache"])
    assert out["alba"]["layer.0/cache"].dtype == np.float32
    assert out["alba"]["layer.0/offset"].dtype == np.int64
    assert out["alba"]["layer.0/offset"][0] == 126
    assert out["javert"]["layer.0/flag"].dtype == np.bool_
    assert out["javert"]["layer.0/flag"].tolist() == [True, False]


def test_parse_voices_bin_rejects_bad_magic(tmp_path):
    p = tmp_path / "voices.bin"
    p.write_bytes(b"NOPE1" + b"\x00" * 16)
    with pytest.raises(ValueError, match="PTVB1"):
        pb.parse_voices_bin(str(p))


def test_parse_voices_bin_rejects_unknown_dtype(tmp_path):
    import struct
    out = bytearray(b"PTVB1")
    out += struct.pack("<I", 1)
    out += struct.pack("<H", 4) + b"alba" + struct.pack("<H", 1)
    out += struct.pack("<H", 3) + b"a/b" + struct.pack("<BB", 9, 1)
    out += struct.pack("<I", 1) + struct.pack("<I", 4) + b"\x00\x00\x00\x00"
    p = tmp_path / "voices.bin"
    p.write_bytes(bytes(out))
    with pytest.raises(ValueError, match="dtype"):
        pb.parse_voices_bin(str(p))


def test_parse_voices_bin_rejects_payload_size_mismatch(tmp_path):
    import struct
    # One extra trailing byte inside the tensor payload: a floor-divided count
    # would still reshape cleanly and silently drop the junk byte.
    out = bytearray(b"PTVB1")
    out += struct.pack("<I", 1)
    out += struct.pack("<H", 4) + b"alba" + struct.pack("<H", 1)
    out += struct.pack("<H", 3) + b"a/b" + struct.pack("<BB", 0, 1)
    out += struct.pack("<I", 2) + struct.pack("<I", 9) + b"\x00" * 9   # shape (2,) f32 = 8 bytes, not 9
    p = tmp_path / "voices.bin"
    p.write_bytes(bytes(out))
    with pytest.raises(ValueError, match="size mismatch"):
        pb.parse_voices_bin(str(p))
