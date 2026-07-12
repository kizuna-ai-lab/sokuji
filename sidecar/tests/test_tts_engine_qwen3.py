"""Tests for refText threading through TtsEngine.set_voice (Qwen3 ICL cloning)."""
import asyncio

import numpy as np

from sokuji_sidecar import tts_engine


class _RefTextBackend:
    def __init__(self):
        self.got = None

    def set_voice(self, audio, sr, ref_text=""):
        self.got = (len(audio), sr, ref_text)


class _PlainBackend:
    def __init__(self):
        self.got = None

    def set_voice(self, audio, sr):
        self.got = (len(audio), sr)


def test_engine_passes_ref_text_only_when_supported():
    eng = tts_engine.TtsEngine()
    eng._backend = _RefTextBackend()
    eng.set_voice(np.zeros(10, np.float32), 24000, ref_text="hi")
    assert eng._backend.got == (10, 24000, "hi")
    eng._backend = _PlainBackend()
    eng.set_voice(np.zeros(10, np.float32), 24000, ref_text="hi")   # must not raise
    assert eng._backend.got == (10, 24000)


def test_handler_threads_reftext():
    async def _run():
        rec = _RefTextBackend()
        eng = tts_engine.TtsEngine()
        eng._backend = rec
        msg = {"type": "set_voice", "sampleRate": 24000, "refText": "hello"}
        await tts_engine._h_set_voice({"tts_engine": eng}, msg, np.zeros(4, np.float32).tobytes(), conn=None)
        assert rec.got[2] == "hello"

    asyncio.run(_run())
