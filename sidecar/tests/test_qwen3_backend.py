import numpy as np
from sokuji_sidecar.tts_backends import Qwen3TtsOnnxBackend


def test_flags():
    assert (Qwen3TtsOnnxBackend.NAME, Qwen3TtsOnnxBackend.STREAMING, Qwen3TtsOnnxBackend.CLONES) \
        == ("qwen3tts_onnx", False, True)


def test_set_voice_requires_loaded_and_builds_icl(monkeypatch):
    b = Qwen3TtsOnnxBackend()
    calls = {}
    b._codec = type("C", (), {"encode": staticmethod(lambda wav: np.ones((4, 16), np.int64))})()
    b._spk_embed = lambda wav: np.zeros(8, np.float32)
    b._tokenize = lambda text: np.arange(6, dtype=np.int64)[None, :]
    b.set_voice(np.zeros(24000, np.float32), 24000, ref_text="hello there")
    vcp = b._voice_prompt
    assert vcp["icl_mode"] == [True] and vcp["ref_code"][0].shape == (4, 16)
    b.set_voice(np.zeros(24000, np.float32), 24000, ref_text="")
    assert b._voice_prompt["x_vector_only_mode"] == [True]   # empty transcript → x-vector fallback


def test_list_builtin_voices_empty():
    assert Qwen3TtsOnnxBackend.list_builtin_voices() == []
