"""Tests for language threading and styleVoice decode in the TTS engine."""
import asyncio

import numpy as np

from sokuji_sidecar import tts_engine


class _Rec:
    def __init__(self):
        self.style = None

    def set_style_voice(self, ttl, dp):
        self.style = (ttl, dp)


def test_set_voice_style_variant_decodes():
    ttl = np.arange(50 * 256, dtype=np.float32)
    dp = np.arange(8 * 16, dtype=np.float32)
    rec = _Rec()
    state = {"tts_engine": rec}
    msg = {"type": "set_voice", "styleVoice": {"ttlDims": [1, 50, 256], "dpDims": [1, 8, 16]}}
    asyncio.run(tts_engine._h_set_voice(state, msg, ttl.tobytes() + dp.tobytes(), conn=None))
    assert rec.style[0].shape == (1, 50, 256) and rec.style[1].shape == (1, 8, 16)
    assert rec.style[1].flatten()[-1] == 8 * 16 - 1
