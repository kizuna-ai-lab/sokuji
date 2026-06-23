import asyncio, json, os
import numpy as np
import pytest
from sokuji_sidecar import server, tts_engine


class _FakeWS:
    def __init__(self):
        self.sent = []

    async def send(self, d):
        self.sent.append(d)


def make():
    st = {"engine": tts_engine.TtsEngine(), "handlers": {}}
    tts_engine.register(st)
    return st


def test_dispatch_selects_piper_vs_pocket(monkeypatch):
    # stub both backends so no models/network are needed
    class FakePiper:
        sample_rate = 16000
        def init(self, model): self.model = model; return 1
        def generate(self, text, speed=1.0): return np.ones(16000, np.float32), 2
    class FakePocket:
        sample_rate = 24000
        def init(self): return 3
        def generate(self, text, speed=1.0): return np.ones(24000, np.float32), 4
    import sokuji_sidecar.sherpa_tts as st
    monkeypatch.setattr(st, "SherpaPiperTts", FakePiper)
    import sokuji_sidecar.pocket_engine as pe
    monkeypatch.setattr(pe, "PocketEngine", FakePocket)

    eng = tts_engine.TtsEngine()
    eng.init("piper-en-amy")
    assert eng.sample_rate == 16000
    eng2 = tts_engine.TtsEngine()
    eng2.init("pocket-en")
    assert eng2.sample_rate == 24000


def test_generate_handler_returns_binary(monkeypatch):
    class FakePiper:
        sample_rate = 16000
        def init(self, model): return 1
        def generate(self, text, speed=1.0): return np.ones(8000, np.float32), 5
    import sokuji_sidecar.sherpa_tts as st
    monkeypatch.setattr(st, "SherpaPiperTts", FakePiper)
    st_state = make()
    asyncio.run(server.handle_message(st_state, json.dumps({"type": "init", "id": 1, "model": "piper-en-amy"})))
    reply, binary = asyncio.run(server.handle_message(st_state, json.dumps({"type": "generate", "id": 2, "text": "hi"})))
    assert binary is not None and len(binary) == 8000 * 4
    assert reply["type"] == "result" and reply["sampleRate"] == 16000 and reply["samples"] == 8000


@pytest.mark.skipif(not os.environ.get("SOKUJI_RUN_PIPER_MODEL"),
                    reason="set SOKUJI_RUN_PIPER_MODEL=1 (downloads a sherpa piper model)")
def test_real_piper_generates_audio():
    eng = tts_engine.TtsEngine()
    eng.init("csukuangfj/vits-piper-en_US-amy-low")
    samples, ms = eng.generate("Hello from native piper.")
    assert samples.dtype == np.float32 and len(samples) > 8000 and ms >= 0
    assert eng.sample_rate == 16000
