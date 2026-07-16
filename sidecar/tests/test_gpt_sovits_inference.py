import numpy as np
import pytest

from sokuji_sidecar.gpt_sovits import inference, reference


class _FakeHubert:
    def run(self, _out, feeds):
        (name, wav16), = feeds.items()
        # ssl frames scale with input length (hubert stride 320 @16k)
        frames = max(1, wav16.shape[-1] // 320)
        return [np.zeros((1, 768, frames), dtype=np.float32)]
    def get_inputs(self):
        class _I: name = "input"
        return [_I()]


def test_build_reference_resamples_and_pads():
    sr = 24000
    audio = np.random.default_rng(0).standard_normal(sr * 4).astype(np.float32) * 0.1
    ref = reference.build_reference(audio, sr, "test transcript", "english", _FakeHubert())
    assert ref.audio_32k.dtype == np.float32
    # 4s content + 0.3s appended silence at 32k
    assert abs(ref.audio_32k.shape[-1] - int(4.3 * 32000)) < 3200
    assert ref.ssl_content.shape[0] == 1
    assert ref.prompt_text == "test transcript"


class _StopImmediatelyDecoder:
    """Stage decoder whose stop condition fires on the very first step."""
    def __init__(self):
        self.calls = 0
    def get_inputs(self):
        class _I:
            def __init__(self, name): self.name = name
        return [_I("y"), _I("y_emb"), _I("kv")]
    def run(self, _out, feeds):
        self.calls += 1
        y = feeds["y"]
        return [y, feeds["y_emb"], np.array(True), feeds["kv"]]


def test_synthesize_returns_none_when_ar_stops_at_step_zero(monkeypatch):
    # Upstream hazard (Inference.py y[:, -idx:] with idx==0 slices the WHOLE
    # sequence incl. prompt tokens -> vocoder replays the reference). The port
    # must return None instead so the backend can surface a clean error.
    syn = inference.Synthesizer.__new__(inference.Synthesizer)
    out = syn._slice_generated(np.zeros((1, 17), dtype=np.int64), idx=0)
    assert out is None


def test_slice_generated_returns_tail_for_positive_idx():
    syn = inference.Synthesizer.__new__(inference.Synthesizer)
    y = np.arange(10, dtype=np.int64).reshape(1, 10)
    out = syn._slice_generated(y, idx=3)
    assert out is not None
    np.testing.assert_array_equal(out.reshape(-1), np.array([7, 8, 9]))


def test_trim_semantic_empty_returns_none():
    syn = inference.Synthesizer.__new__(inference.Synthesizer)
    # first token is already EOS (>=1024) -> empty semantic -> None, not ref echo
    tokens = np.array([[1024, 5, 6]], dtype=np.int64)
    assert syn._trim_at_eos(tokens) is None


def test_trim_semantic_cuts_at_first_eos():
    syn = inference.Synthesizer.__new__(inference.Synthesizer)
    tokens = np.array([[5, 6, 1024, 7]], dtype=np.int64)
    out = syn._trim_at_eos(tokens)
    np.testing.assert_array_equal(out.reshape(-1), np.array([5, 6]))
