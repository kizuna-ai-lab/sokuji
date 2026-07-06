import numpy as np
import pytest
import sys as _sys
import types as _types
from types import SimpleNamespace
from sokuji_sidecar.qwen3_tts import runtime

H, GROUPS, VOCAB, EOS = 8, 4, 32, 30

class _FakeIO:
    def __init__(self, name): self.name = name

class _FakeDecode:
    """Emits fixed logits; asserts past grows by 1 each call. First-code script: 5, 5, EOS."""
    def __init__(self): self.calls = 0
    def get_inputs(self):
        return [_FakeIO("inputs_embeds"), _FakeIO("attention_mask"),
                _FakeIO("past_key_0"), _FakeIO("past_value_0")]
    def get_outputs(self):
        return [_FakeIO("logits"), _FakeIO("last_hidden"), _FakeIO("present_key_0"), _FakeIO("present_value_0")]
    def run(self, names, feeds):
        t = feeds["inputs_embeds"].shape[1]
        past_len = feeds["past_key_0"].shape[2]
        if self.calls == 0:
            assert past_len == 0          # zero-past initial pass
        logits = np.full((1, t, VOCAB), -5.0, np.float32)
        script = [5, 5, EOS]
        logits[0, -1, script[min(self.calls, 2)]] = 5.0
        self.calls += 1
        present = np.zeros((1, 2, past_len + t, 4), np.float32)
        return [logits, np.zeros((1, 1, H), np.float32), present, present]

class _FakeCodePred:
    def get_outputs(self): return [_FakeIO("logits")]
    def run(self, names, feeds):
        out = np.full((1, VOCAB), -5.0, np.float32); out[0, 7] = 5.0
        return [out]

class _FakeEmbed:
    def __init__(self, outname): self.outname = outname
    def get_outputs(self): return [_FakeIO(self.outname)]
    def run(self, names, feeds):
        ids = feeds["input_ids"]
        return [np.zeros((ids.shape[0], ids.shape[1], H), np.float32)]

def _sessions():
    return {"talker_decode": _FakeDecode(), "code_predictor": _FakeCodePred(),
            "codec_embed": _FakeEmbed("e"), "code_predictor_embed": _FakeEmbed("e")}

def test_ar_loop_zero_past_eos_and_groups():
    cfg = SimpleNamespace(num_code_groups=GROUPS)
    codes, hidden = runtime.generate_codes(
        _sessions(), cfg,
        inputs_embeds=np.zeros((1, 3, H), np.float32),
        attention_mask=np.ones((1, 3), np.int64),
        trailing_text_hidden=np.zeros((1, 2, H), np.float32),
        tts_pad_embed=np.zeros((1, 1, H), np.float32),
        max_new_tokens=10, sampling_params=dict(
            do_sample=False, top_k=50, top_p=1.0, temperature=1.0, repetition_penalty=1.0,
            subtalker_dosample=False, subtalker_top_k=50, subtalker_top_p=1.0, subtalker_temperature=1.0),
        eos_token_id=EOS, suppress_tokens=None, rng=np.random.default_rng(0))
    assert len(codes) == 1
    assert codes[0].shape == (2, GROUPS)            # EOS at step 3 → 2 effective frames
    assert (codes[0][:, 0] == 5).all()              # scripted first codes
    assert (codes[0][:, 1:] == 7).all()             # 3 sub-codes per frame from code_predictor
    assert hidden[0].shape == (2, H)


def _fake_ort(providers):
    return _types.SimpleNamespace(get_available_providers=lambda: list(providers))


def test_default_providers_dml_returns_dml_list(monkeypatch):
    monkeypatch.setitem(_sys.modules, "onnxruntime",
                        _fake_ort(["DmlExecutionProvider", "CPUExecutionProvider"]))
    assert runtime.default_providers("dml") == ["DmlExecutionProvider", "CPUExecutionProvider"]


def test_default_providers_dml_absent_raises(monkeypatch):
    # Fail-fast (MOSS parity): a dml request on a build without the DML EP must
    # raise, not silently return CPU — so the gpu-dml load falls back to the
    # cpu plan instead of reporting gpu-dml while running on CPU.
    monkeypatch.setitem(_sys.modules, "onnxruntime", _fake_ort(["CPUExecutionProvider"]))
    with pytest.raises(RuntimeError):
        runtime.default_providers("dml")


def test_default_providers_dml_never_appends_cuda(monkeypatch):
    # A dml device must not pull CUDA even when the CUDA EP is also present.
    monkeypatch.setitem(_sys.modules, "onnxruntime",
                        _fake_ort(["CUDAExecutionProvider", "DmlExecutionProvider", "CPUExecutionProvider"]))
    assert runtime.default_providers("dml") == ["DmlExecutionProvider", "CPUExecutionProvider"]


def test_default_providers_cuda_and_none_unchanged(monkeypatch):
    monkeypatch.setitem(_sys.modules, "onnxruntime",
                        _fake_ort(["CUDAExecutionProvider", "CPUExecutionProvider"]))
    assert runtime.default_providers("cuda") == ["CUDAExecutionProvider", "CPUExecutionProvider"]
    assert runtime.default_providers(None) == ["CUDAExecutionProvider", "CPUExecutionProvider"]


def test_default_providers_cpu_unchanged(monkeypatch):
    monkeypatch.setitem(_sys.modules, "onnxruntime",
                        _fake_ort(["CUDAExecutionProvider", "CPUExecutionProvider"]))
    assert runtime.default_providers("cpu") == ["CPUExecutionProvider"]


def _fake_ort_sessions(available, get_providers_for):
    """Fake onnxruntime whose InferenceSession reports providers via get_providers_for."""
    class _Sess:
        def __init__(self, path, sess_options=None, providers=None):
            self._req = list(providers or [])
        def get_providers(self):
            return get_providers_for(self._req)

    class _Opts:
        graph_optimization_level = 0
        log_severity_level = 0
        intra_op_num_threads = 0

    return _types.SimpleNamespace(
        get_available_providers=lambda: list(available),
        InferenceSession=_Sess,
        SessionOptions=lambda: _Opts(),
        GraphOptimizationLevel=_types.SimpleNamespace(ORT_ENABLE_ALL=1))


def test_build_sessions_dml_raises_when_hot_graph_drops_dml(monkeypatch, tmp_path):
    # A HOT graph created without DirectML (silently on CPU) must raise so
    # load_with_fallback picks the cpu plan instead of running gpu-dml on CPU.
    fake = _fake_ort_sessions(["DmlExecutionProvider", "CPUExecutionProvider"],
                              lambda req: ["CPUExecutionProvider"])  # DML dropped
    monkeypatch.setitem(_sys.modules, "onnxruntime", fake)
    with pytest.raises(RuntimeError):
        runtime.build_sessions(tmp_path, "dml", 1)


def test_build_sessions_dml_ok_when_hot_graphs_retain_dml(monkeypatch, tmp_path):
    # HOT graphs keep DirectML, COLD graphs are CPU-only by design -> no raise.
    fake = _fake_ort_sessions(["DmlExecutionProvider", "CPUExecutionProvider"],
                              lambda req: req)  # session honors requested providers
    monkeypatch.setitem(_sys.modules, "onnxruntime", fake)
    sessions = runtime.build_sessions(tmp_path, "dml", 1)
    assert "DmlExecutionProvider" in sessions["talker_decode"].get_providers()      # HOT
    assert sessions["speaker_encoder"].get_providers() == ["CPUExecutionProvider"]  # COLD
