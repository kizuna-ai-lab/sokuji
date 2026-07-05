import asyncio, json
import numpy as np
from sokuji_sidecar import server, pocket_engine


class FakeEngine:
    sample_rate = 24000

    def init(self, model_dir=None, **kw):
        return 12

    def set_voice(self, audio, sr):
        self.ref_len = len(audio)

    def generate(self, text, speed=1.0):
        return np.ones(48000, np.float32), 99


def make_state():
    st = {"engine": FakeEngine(), "handlers": {}}
    pocket_engine.register(st)
    return st


def test_init():
    st = make_state()
    reply, _ = asyncio.run(server.handle_message(st, json.dumps({"type": "init", "id": 1})))
    assert reply == {"type": "ready", "id": 1, "sampleRate": 24000, "loadTimeMs": 12}


def test_set_voice_reads_binary():
    st = make_state()
    audio = np.zeros(16000, np.float32).tobytes()
    reply, _ = asyncio.run(server.handle_message(
        st, json.dumps({"type": "set_voice", "id": 2, "sampleRate": 16000}), binary_in=audio))
    assert reply == {"type": "ok", "id": 2} and st["engine"].ref_len == 16000


def test_generate_returns_binary_then_result():
    st = make_state()
    reply, binary = asyncio.run(server.handle_message(st, json.dumps({"type": "generate", "id": 3, "text": "hi"})))
    assert binary is not None and len(binary) == 48000 * 4   # float32
    assert reply["type"] == "result" and reply["id"] == 3 and reply["samples"] == 48000
