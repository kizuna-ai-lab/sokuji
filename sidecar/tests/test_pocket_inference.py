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
    with open(f"{d}/{pb.METADATA_FILE}", encoding="utf-8") as f:
        meta = json.load(f)
    bos = pb.parse_npy_float32(f"{d}/{pb.BOS_FILE}") if meta.get("insert_bos_before_voice") else None
    ref = np.zeros(24000, np.float32)  # 1s silence reference is enough to exercise the graph
    flow = pi.build_voice_conditioned_state(sessions, meta, pi.encode_reference(sessions, ref), bos)
    tok = PocketTokenizer(f"{d}/{pb.TOKENIZER_FILE}")
    ids = np.array(tok.encode_ids("hello world"), dtype=np.int64).reshape(1, -1)
    tc = sessions["textConditioner"].run(None, {"token_ids": ids})[0]
    out = pi.generate(sessions, meta, tc, flow, lsd_steps=1, max_frames=500,
                      rng=np.random.default_rng(0))
    assert out.dtype == np.float32 and len(out) > 24000  # >1s of audio


def test_group_voice_record_by_module_splits_on_first_slash():
    rec = {"a.b/cache": 1, "a.b/offset": 2, "c/x/y": 3, "noslash": 4}
    g = pi.group_voice_record_by_module(rec)
    assert set(g) == {"a.b", "c"}            # keys without a slash are dropped
    assert g["a.b"] == {"cache": 1, "offset": 2}
    assert g["c"] == {"x/y": 3}              # split on the FIRST slash only


def test_derive_step_prefers_explicit_step_and_respects_end_offset_guard():
    assert pi.derive_step({"step": np.asarray([7], np.int64)})[0] == 7
    assert pi.derive_step({"offset": np.asarray([126], np.int64)})[0] == 126
    # offset is trusted only when end_offset is absent (reference impl's guard)
    blocked = {"offset": np.asarray([126], np.int64),
               "end_offset": np.asarray([5], np.int64)}
    assert pi.derive_step(blocked)[0] == 0


def test_derive_step_falls_back_to_current_end_length_then_zero():
    assert pi.derive_step({"current_end": np.zeros(3, np.float32)})[0] == 3
    out = pi.derive_step({})
    assert out.dtype == np.int64 and out.shape == (1,) and out[0] == 0


def test_adapt_tensor_exact_shape_casts_dtype():
    entry = {"dtype": "float32", "shape": [2, 3], "fill": "nan"}
    src = np.arange(6, dtype=np.float64).reshape(2, 3)
    out = pi.adapt_tensor(src, entry)
    assert out.dtype == np.float32 and np.array_equal(out, src.astype(np.float32))


def test_adapt_tensor_same_size_reshapes_flat_data():
    entry = {"dtype": "int64", "shape": [2, 2], "fill": "zeros"}
    out = pi.adapt_tensor(np.arange(4, dtype=np.int64), entry)
    assert out.shape == (2, 2) and out[1, 1] == 3


def test_adapt_tensor_rank_mismatch_returns_manifest_fill():
    entry = {"dtype": "float32", "shape": [2, 2], "fill": "ones"}
    out = pi.adapt_tensor(np.zeros((2, 2, 2), np.float32), entry)  # 8 elems vs 4, rank 3 vs 2
    assert out.shape == (2, 2) and (out == 1).all()


def test_adapt_tensor_prefix_embeds_and_keeps_fill_in_the_tail():
    # The predefined-voice KV cache is a 126-frame prefix of the 1000-frame
    # manifest slot; this is the branch that carries voice identity.
    entry = {"dtype": "float32", "shape": [2, 1, 5], "fill": "nan"}
    src = np.arange(6, dtype=np.float32).reshape(2, 1, 3)
    out = pi.adapt_tensor(src, entry)
    assert np.array_equal(out[:, :, :3], src)
    assert np.isnan(out[:, :, 3:]).all()


def _mini_manifest():
    return [
        {"input_name": "state_0", "dtype": "float32", "shape": [2, 4], "fill": "nan",
         "module": "layer.0", "key": "cache"},
        {"input_name": "state_1", "dtype": "int64", "shape": [1], "fill": "zeros",
         "module": "layer.0", "key": "step"},
        {"input_name": "state_2", "dtype": "float32", "shape": [0], "fill": "empty",
         "module": "layer.0", "key": "current_end"},
    ]


def test_state_from_voice_record_synthetic_prefix_step_and_default():
    record = {"layer.0/cache": np.ones((2, 2), np.float32),
              "layer.0/offset": np.asarray([2], np.int64)}
    st = pi.state_from_voice_record({"flow_lm_state_manifest": _mini_manifest()}, record)
    assert np.array_equal(st["state_0"][:, :2], np.ones((2, 2), np.float32))
    assert np.isnan(st["state_0"][:, 2:]).all()   # untouched tail keeps the nan fill
    assert st["state_1"].dtype == np.int64 and st["state_1"][0] == 2  # step <- offset
    assert st["state_2"].shape == (0,)            # missing key -> manifest default kept


@pytest.mark.skipif(not os.environ.get("POCKET_MODEL_DIR"),
                    reason="set POCKET_MODEL_DIR to a local bundle")
def test_state_from_voice_record_real_alba_mapping():
    """Structural pin against the real voices.bin: the mapped state must carry
    alba's exact cache bytes as a prefix (nan elsewhere) and her offset as the
    step counter. This is the direct guard on the audible-but-wrong-timbre
    failure mode — a mapping that quietly falls back to manifest defaults
    passes every shape/finiteness check but fails this."""
    d = os.environ["POCKET_MODEL_DIR"]
    with open(f"{d}/{pb.METADATA_FILE}", encoding="utf-8") as f:
        meta = json.load(f)
    voices = pb.parse_voices_bin(f"{d}/{pb.VOICES_FILE}")
    rec = voices["alba"]
    st = pi.state_from_voice_record(meta, rec)
    entry = next(e for e in meta["flow_lm_state_manifest"]
                 if e["module"] == "transformer.layers.0.self_attn" and e["key"] == "cache")
    cache = rec["transformer.layers.0.self_attn/cache"]
    mapped = st[entry["input_name"]]
    assert mapped.shape == tuple(entry["shape"])
    n = cache.shape[2]
    assert n < entry["shape"][2]                  # it really is a strict prefix
    assert np.array_equal(mapped[:, :, :n], cache)
    assert np.isnan(mapped[:, :, n:]).all()
    step_entry = next(e for e in meta["flow_lm_state_manifest"]
                      if e["module"] == "transformer.layers.0.self_attn" and e["key"] == "step")
    offset = rec["transformer.layers.0.self_attn/offset"].reshape(-1)[0]
    assert st[step_entry["input_name"]].reshape(-1)[0] == offset
