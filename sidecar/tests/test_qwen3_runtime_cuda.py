"""CUDA fast-path (IOBinding) tests for the Qwen3-TTS AR loop.

No GPU needed: fakes model the io_binding()/run_with_iobinding()/OrtValue
surface, delegating to the same scripted compute as the numpy-path fakes so
the two paths can be compared value-for-value.
"""
import numpy as np
import pytest
from types import SimpleNamespace

from sokuji_sidecar.qwen3_tts import runtime

H, GROUPS, VOCAB, SUBVOCAB, EOS = 8, 4, 32, 16, 30


class _IO:
    def __init__(self, name):
        self.name = name


class _ScriptedDecode:
    """Value-bearing talker_decode fake. First-code script: 5, 9, EOS.
    last_hidden varies by call so downstream values depend on the step."""

    def __init__(self):
        self.calls = 0
        self.direct_run_calls = 0

    def get_inputs(self):
        return [_IO("inputs_embeds"), _IO("attention_mask"),
                _IO("past_key_0"), _IO("past_value_0")]

    def get_outputs(self):
        return [_IO("logits"), _IO("last_hidden"),
                _IO("present_key_0"), _IO("present_value_0")]

    def _compute(self, feeds):
        t = feeds["inputs_embeds"].shape[1]
        past_len = feeds["past_key_0"].shape[2]
        if self.calls == 0:
            assert past_len == 0            # zero-past initial pass
        assert feeds["attention_mask"].shape[1] == past_len + t
        logits = np.full((1, t, VOCAB), -5.0, np.float32)
        script = [5, 9, EOS]
        logits[0, -1, script[min(self.calls, 2)]] = 5.0
        last_hidden = np.full((1, 1, H), float(self.calls + 1), np.float32)
        present = np.full((1, 2, past_len + t, 4), float(self.calls), np.float32)
        self.calls += 1
        return [logits, last_hidden, present, present.copy()]

    def run(self, names, feeds):
        self.direct_run_calls += 1
        return self._compute(feeds)


class _FakeOrtValue:
    def __init__(self, arr):
        self.arr = arr
        self.numpy_calls = 0
        self.valid = True

    def numpy(self):
        assert self.valid, "use-after-free: OrtValue read after clear_binding_outputs"
        self.numpy_calls += 1
        return self.arr


class _FakeIoBinding:
    """Models the real pybind ownership rule observed on ORT 1.24: OrtValues
    returned by get_outputs() reference the binding's internal storage and are
    INVALIDATED by clear_binding_outputs() on the same binding object."""

    def __init__(self, sess):
        self._sess = sess
        self.cpu_inputs = {}
        self.ortvalue_inputs = {}
        self.bound_outputs = []
        self.outputs = None
        self._handed_out = []

    def bind_cpu_input(self, name, arr):
        self.cpu_inputs[name] = arr

    def bind_ortvalue_input(self, name, val):
        self.ortvalue_inputs[name] = val

    def bind_output(self, name, device_type="cpu", device_id=0):
        self.bound_outputs.append((name, device_type))

    def clear_binding_inputs(self):
        self.cpu_inputs = {}
        self.ortvalue_inputs = {}

    def clear_binding_outputs(self):
        self.bound_outputs = []
        for val in self._handed_out:
            val.valid = False

    def set_run_outputs(self, vals):
        # a new run also invalidates the previous run's output references
        for val in self._handed_out:
            val.valid = False
        self.outputs = vals
        self._handed_out = list(vals)

    def get_outputs(self):
        return self.outputs


class _CudaScriptedDecode(_ScriptedDecode):
    """Same scripted compute, exposed through the CUDA/IOBinding surface."""

    def __init__(self):
        super().__init__()
        self.presents = []          # every present OrtValue handed out
        self.past_ortvalues_seen = []  # per call: dict of bound past OrtValues
        self.first_call_cpu_past = None

    def get_providers(self):
        return ["CUDAExecutionProvider", "CPUExecutionProvider"]

    def io_binding(self):
        return _FakeIoBinding(self)

    def run_with_iobinding(self, iob, run_options=None):
        for name, val in iob.ortvalue_inputs.items():
            assert val.valid, f"use-after-free: {name} was invalidated before this run"
        feeds = dict(iob.cpu_inputs)
        for name, val in iob.ortvalue_inputs.items():
            feeds[name] = val.arr
        if self.calls == 0:
            self.first_call_cpu_past = {
                k: v for k, v in iob.cpu_inputs.items() if k.startswith("past_")}
        self.past_ortvalues_seen.append(dict(iob.ortvalue_inputs))
        outs = self._compute(feeds)
        vals = [_FakeOrtValue(o) for o in outs]
        self.presents.extend(vals[2:])
        iob.set_run_outputs(vals)


class _ValueCodecEmbed:
    """codec_embed fake whose row value equals the token id."""

    def __init__(self):
        self.calls = 0
        self.ids_seen = []

    def get_outputs(self):
        return [_IO("embeds")]

    def run(self, names, feeds):
        self.calls += 1
        ids = feeds["input_ids"]
        self.ids_seen.append(np.asarray(ids).copy())
        out = np.repeat(ids[..., None].astype(np.float32), H, axis=-1)
        return [out]


class _ValuePredEmbed:
    """code_predictor_embed fake: row value = id * 100 + generation_step."""

    def __init__(self):
        self.calls = 0

    def get_outputs(self):
        return [_IO("embeds")]

    def run(self, names, feeds):
        self.calls += 1
        ids = feeds["input_ids"]
        j = int(np.asarray(feeds["generation_step"]).reshape(-1)[0])
        out = ids[..., None].astype(np.float32) * 100.0 + float(j)
        out = np.repeat(out, H, axis=-1)
        return [out]


class _ValueCodePred:
    """code_predictor fake whose argmax depends on the embed values it sees,
    so embed-table gathers must match per-step embed session runs exactly."""

    def get_outputs(self):
        return [_IO("logits")]

    def run(self, names, feeds):
        s = float(np.abs(feeds["inputs_embeds"]).sum())
        j = int(np.asarray(feeds["generation_step"]).reshape(-1)[0])
        out = np.full((1, SUBVOCAB), -5.0, np.float32)
        out[0, (int(s) + j) % SUBVOCAB] = 5.0
        return [out]


def _cfg():
    return SimpleNamespace(num_code_groups=GROUPS, vocab_size=VOCAB,
                           code_predictor_config={"vocab_size": SUBVOCAB})


def _numpy_sessions():
    return {"talker_decode": _ScriptedDecode(), "code_predictor": _ValueCodePred(),
            "codec_embed": _ValueCodecEmbed(), "code_predictor_embed": _ValuePredEmbed()}


def _cuda_sessions():
    return {"talker_decode": _CudaScriptedDecode(), "code_predictor": _ValueCodePred(),
            "codec_embed": _ValueCodecEmbed(), "code_predictor_embed": _ValuePredEmbed()}


def _gen(sessions, *, do_sample=False, rng=None):
    return runtime.generate_codes(
        sessions, _cfg(),
        inputs_embeds=np.zeros((1, 3, H), np.float32),
        attention_mask=np.ones((1, 3), np.int64),
        trailing_text_hidden=np.full((1, 2, H), 0.5, np.float32),
        tts_pad_embed=np.full((1, 1, H), 0.25, np.float32),
        max_new_tokens=10, sampling_params=dict(
            do_sample=do_sample, top_k=3, top_p=1.0, temperature=1.0,
            repetition_penalty=1.05, subtalker_dosample=do_sample,
            subtalker_top_k=3, subtalker_top_p=1.0, subtalker_temperature=1.0),
        eos_token_id=EOS, suppress_tokens=None,
        rng=rng or np.random.default_rng(0))


def test_binding_path_matches_numpy_path_greedy():
    codes_np, hidden_np = _gen(_numpy_sessions())
    codes_cu, hidden_cu = _gen(_cuda_sessions())
    assert np.array_equal(codes_np[0], codes_cu[0])
    assert np.array_equal(hidden_np[0], hidden_cu[0])
    assert codes_np[0].shape == (2, GROUPS)   # scripted EOS at step 3


def test_binding_path_matches_numpy_path_sampled():
    codes_np, _ = _gen(_numpy_sessions(), do_sample=True, rng=np.random.default_rng(42))
    codes_cu, _ = _gen(_cuda_sessions(), do_sample=True, rng=np.random.default_rng(42))
    assert np.array_equal(codes_np[0], codes_cu[0])


def test_binding_path_keeps_kv_on_device():
    sessions = _cuda_sessions()
    dec = sessions["talker_decode"]
    _gen(sessions)
    assert dec.direct_run_calls == 0            # decode went through iobinding only
    assert dec.calls >= 2
    for val in dec.presents:
        assert val.numpy_calls == 0             # present KV never pulled to host
    # step 2 got step 1's present OrtValues bound back as past, by identity
    step2_past = dec.past_ortvalues_seen[1]
    assert set(step2_past.keys()) == {"past_key_0", "past_value_0"}
    assert all(any(v is p for p in dec.presents) for v in step2_past.values())


def test_binding_path_zero_past_first_step_binds_cpu_zeros():
    sessions = _cuda_sessions()
    dec = sessions["talker_decode"]
    _gen(sessions)
    assert dec.past_ortvalues_seen[0] == {}     # no device past on the first call
    shapes = {k: v.shape for k, v in dec.first_call_cpu_past.items()}
    assert shapes == {"past_key_0": (1, 8, 0, 128), "past_value_0": (1, 8, 0, 128)}


def test_binding_path_extracts_embed_tables_once():
    sessions = _cuda_sessions()
    ce, pe = sessions["codec_embed"], sessions["code_predictor_embed"]
    _gen(sessions)
    assert ce.calls == 1                         # one arange sweep, not one per frame
    assert ce.ids_seen[0].shape == (1, VOCAB)
    assert pe.calls == GROUPS - 1                # one sweep per code group table
    _gen(sessions)                               # second utterance reuses the cache
    assert ce.calls == 1 and pe.calls == GROUPS - 1


def test_numpy_path_still_runs_embeds_per_step():
    sessions = _numpy_sessions()
    ce = sessions["codec_embed"]
    _gen(sessions)
    assert ce.calls >= 2                         # per-frame session runs preserved


def test_non_cuda_providers_stay_on_numpy_path():
    class _DmlDecode(_CudaScriptedDecode):
        def get_providers(self):
            return ["DmlExecutionProvider", "CPUExecutionProvider"]

    sessions = _cuda_sessions()
    sessions["talker_decode"] = _DmlDecode()
    dec = sessions["talker_decode"]
    _gen(sessions)
    assert dec.direct_run_calls >= 2             # plain session.run path


def test_binding_path_without_kv_outputs_raises():
    class _NoKvDecode(_CudaScriptedDecode):
        def get_inputs(self):
            return [_IO("inputs_embeds"), _IO("attention_mask")]

        def get_outputs(self):
            return [_IO("logits"), _IO("last_hidden")]

        def _compute(self, feeds):
            t = feeds["inputs_embeds"].shape[1]
            logits = np.full((1, t, VOCAB), -5.0, np.float32)
            logits[0, -1, 5] = 5.0               # never EOS → needs a second step
            self.calls += 1
            return [logits, np.zeros((1, 1, H), np.float32)]

    sessions = _cuda_sessions()
    sessions["talker_decode"] = _NoKvDecode()
    with pytest.raises(RuntimeError, match="no KV cache"):
        _gen(sessions)
