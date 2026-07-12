import os, json
import numpy as np
import pytest
from sokuji_sidecar import pocket_inference as pi
from sokuji_sidecar import pocket_bundle as pb
from sokuji_sidecar.pocket_tokenizer import PocketTokenizer


def test_resample_empty_input_returns_empty_float32():
    """Empty array must return an empty float32 array and must NOT raise."""
    out = pi.resample_to_24k(np.zeros(0, dtype=np.float32), src_rate=16000)
    assert out.dtype == np.float32 and len(out) == 0


def test_resample_empty_input_passthrough_rate():
    out = pi.resample_to_24k(np.zeros(0, dtype=np.float32), src_rate=24000)
    assert out.dtype == np.float32 and len(out) == 0


def test_resample_passthrough_when_already_24k():
    x = np.arange(10, dtype=np.float32)
    assert np.array_equal(pi.resample_to_24k(x, 24000), x)


def test_resample_doubles_length_from_12k():
    x = np.zeros(100, dtype=np.float32)
    out = pi.resample_to_24k(x, 12000)
    assert abs(len(out) - 200) <= 1 and out.dtype == np.float32


def test_init_state_honors_fill_and_dtype():
    manifest = [
        {"input_name": "a", "output_name": "a_out", "dtype": "float32", "shape": [2], "fill": "nan"},
        {"input_name": "b", "output_name": "b_out", "dtype": "bool", "shape": [2]},
        {"input_name": "c", "output_name": "c_out", "dtype": "float32", "shape": [2], "fill": "ones"},
    ]
    st = pi.init_state_from_manifest(manifest)
    assert np.isnan(st["a"]).all()
    assert st["b"].dtype == np.bool_ and not st["b"].any()
    assert (st["c"] == 1).all()


@pytest.mark.skipif(not os.environ.get("POCKET_MODEL_DIR"), reason="set POCKET_MODEL_DIR to a local bundle")
def test_end_to_end_produces_audio():
    d = os.environ["POCKET_MODEL_DIR"]
    sessions = pi.load_sessions(d, threads=2)
    meta = json.load(open(f"{d}/{pb.METADATA_FILE}"))
    bos = pb.parse_npy_float32(f"{d}/{pb.BOS_FILE}") if meta.get("insert_bos_before_voice") else None
    ref = np.zeros(24000, np.float32)  # 1s silence reference is enough to exercise the graph
    flow = pi.build_voice_conditioned_state(sessions, meta, pi.encode_reference(sessions, ref), bos)
    tok = PocketTokenizer(f"{d}/{pb.TOKENIZER_FILE}")
    ids = np.array(tok.encode_ids("hello world"), dtype=np.int64).reshape(1, -1)
    tc = sessions["textConditioner"].run(None, {"token_ids": ids})[0]
    out = pi.generate(sessions, meta, tc, flow, lsd_steps=1, max_frames=500,
                      rng=np.random.default_rng(0))
    assert out.dtype == np.float32 and len(out) > 24000  # >1s of audio
