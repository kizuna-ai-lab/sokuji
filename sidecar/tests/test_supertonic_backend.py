import numpy as np
from sokuji_sidecar.tts_backends import SupertonicBackend, SUPERTONIC_VOICE_NAMES
CHUNK = 512 * 6

class _FakeSession:
    def __init__(self, out): self._out = out
    def get_outputs(self): return [type("O", (), {"name": self._out})()]
    def run(self, names, feeds):
        if "style_dp" in feeds: return [np.array([0.2], np.float32)]      # duration
        if "style_ttl" in feeds and "text_ids" in feeds: return [np.zeros((1, 4, 256), np.float32)]  # text_enc
        if "noisy_latent" in feeds: return [feeds["noisy_latent"]]        # vector_estimator
        return [np.zeros((1, feeds["latent"].shape[2] * CHUNK), np.float32)]  # vocoder

def _install(b):
    b._sess = {"dp": _FakeSession("duration"), "tenc": _FakeSession("text_emb"),
               "vest": _FakeSession("denoised_latent"), "voc": _FakeSession("wav_tts")}
    b._cfg = {"ae": {"sample_rate": 44100, "base_chunk_size": 512},
              "ttl": {"latent_dim": 24, "chunk_compress_factor": 6}}
    b._indexer = [1] * 70000
    b._voice = (np.zeros((1, 50, 256), np.float32), np.zeros((1, 8, 16), np.float32))
    b.sample_rate = 44100; b._total_step = 2

def test_generate_returns_float32_44k():
    b = SupertonicBackend(); _install(b); b.set_language("en")
    samples, ms = b.generate("Hello world.", 1.0)
    assert samples.dtype == np.float32 and samples.ndim == 1 and samples.size > 0
    assert isinstance(ms, int)

def test_backend_flags():
    assert (SupertonicBackend.NAME, SupertonicBackend.STREAMING, SupertonicBackend.CLONES) == ("supertonic", False, False)

def test_set_speaker_and_builtin_select_presets():
    b = SupertonicBackend()
    b._presets = {i: (np.full((1,50,256), i, np.float32), np.full((1,8,16), i, np.float32)) for i in range(10)}
    b._default_sid = 7
    b.set_speaker(3); assert b._voice[0][0,0,0] == 3
    b.set_builtin_voice("Alex"); assert b._voice[0][0,0,0] == 5
    b.set_speaker(99); assert b._voice[0][0,0,0] == 7

def test_set_style_voice_applies_arrays():
    b = SupertonicBackend()
    b.set_style_voice(np.ones((1,50,256), np.float32), np.ones((1,8,16), np.float32))
    assert b._voice[0].shape == (1,50,256) and b._voice[1].shape == (1,8,16)

def test_list_builtin_voices():
    v = SupertonicBackend().list_builtin_voices()
    assert [x["voice"] for x in v] == SUPERTONIC_VOICE_NAMES
    assert [x["gender"] for x in v] == ["F"]*5 + ["M"]*5


import json as _json
import sys as _sys
import types as _types

import pytest as _pytest


@_pytest.mark.parametrize("device,expected", [
    ("cpu", ["CPUExecutionProvider"]),
    ("cuda", ["CUDAExecutionProvider", "CPUExecutionProvider"]),
    ("dml", ["DmlExecutionProvider", "CPUExecutionProvider"]),
])
def test_supertonic_load_selects_provider_list(monkeypatch, tmp_path, device, expected):
    """SupertonicBackend.load builds its 4 raw-ORT sessions with the device's
    provider list. onnxruntime + huggingface_hub are stubbed; the JSON/preset
    layout is a minimal on-disk fixture (no real 400MB model)."""
    from sokuji_sidecar import tts_backends as tb

    (tmp_path / "onnx").mkdir()
    (tmp_path / "onnx" / "tts.json").write_text(_json.dumps({"ae": {"sample_rate": 44100}}))
    (tmp_path / "onnx" / "unicode_indexer.json").write_text(_json.dumps({}))
    (tmp_path / "voice_styles").mkdir()
    style = {"style_ttl": {"data": [0.0], "dims": [1, 1]},
             "style_dp": {"data": [0.0], "dims": [1, 1]}}
    for code in tb._SUPERTONIC_PRESET_CODES:
        (tmp_path / "voice_styles" / f"{code}.json").write_text(_json.dumps(style))

    captured = []

    class _FakeSess:
        def __init__(self, path, sess_options=None, providers=None):
            captured.append(providers)

    class _Opts:
        pass

    fake_ort = _types.SimpleNamespace(
        InferenceSession=_FakeSess,
        SessionOptions=lambda: _Opts(),
        GraphOptimizationLevel=_types.SimpleNamespace(ORT_ENABLE_ALL=1),
    )
    monkeypatch.setitem(_sys.modules, "onnxruntime", fake_ort)
    monkeypatch.setitem(_sys.modules, "huggingface_hub", _types.SimpleNamespace(
        snapshot_download=lambda repo_id, local_files_only=True: str(tmp_path)))

    b = tb.SupertonicBackend()
    b.load("Supertone/supertonic-3", device, "fp32")
    assert b.is_loaded
    assert captured == [expected] * 4   # dp, tenc, vest, voc
