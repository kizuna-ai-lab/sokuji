import numpy as np

from sokuji_sidecar.tts_engine import TtsEngine


class _FakeGptSovits:
    NAME = "gpt_sovits_onnx"
    STREAMING = False
    CLONES = True
    sample_rate = 32000

    def __init__(self):
        self.language = None
        self.voice_args = None

    def set_language(self, lang):
        self.language = lang

    def set_voice(self, audio, sr, ref_text=""):
        self.voice_args = (audio.shape, sr, ref_text)

    def generate(self, text, speed=1.0):
        return np.zeros(32000, dtype=np.float32), 7


def test_engine_threads_language_and_reftext():
    eng = TtsEngine.__new__(TtsEngine)
    eng._backend = _FakeGptSovits()
    eng._native_sr = 32000
    eng.set_voice(np.zeros(24000, dtype=np.float32), 24000, ref_text="hello ref")
    assert eng._backend.voice_args[2] == "hello ref"
    pcm, ms = eng.generate("hi there general kenobi", 1.0)
    assert ms == 7
    samples = np.frombuffer(pcm, dtype=np.int16)  # engine returns raw Int16@24k bytes
    assert samples.dtype == np.int16
    assert abs(len(samples) - 24000) <= 2  # 32k backend, 1s of zeros -> ~1s @ 24k
