import asyncio, json
import numpy as np
from sokuji_sidecar import server, asr_engine


class _FakeWS:
    def __init__(self):
        self.sent = []

    async def send(self, d):
        self.sent.append(d)


class FakeAsr:
    def init(self, model_id=None, language=""):
        return 33

    def feed(self, int16_bytes):
        n = len(np.frombuffer(int16_bytes, dtype=np.int16))
        if n >= 24000:
            return [{"type": "speech_start"},
                    {"type": "result", "text": "hello", "startSample": 0,
                     "durationMs": 1000, "recognitionTimeMs": 5}]
        return []

    def flush(self):
        return [{"type": "result", "text": "tail", "startSample": 0,
                 "durationMs": 100, "recognitionTimeMs": 1}]


def make():
    st = {"asr_engine": FakeAsr(), "handlers": {}}
    asr_engine.register(st)
    conn = server.Conn(_FakeWS())
    return st, conn


def test_asr_init_sets_binary_router_and_replies_ready():
    st, conn = make()
    reply, _ = asyncio.run(server.handle_message(
        st, json.dumps({"type": "asr_init", "id": 1, "language": "en"}), None, conn))
    assert reply == {"type": "ready", "id": 1, "loadTimeMs": 33}
    assert callable(conn.ctx.get("on_binary"))


def test_binary_router_emits_results():
    st, conn = make()
    asyncio.run(server.handle_message(st, json.dumps({"type": "asr_init", "id": 1}), None, conn))
    audio = np.zeros(24000, np.int16).tobytes()
    out = conn.ctx["on_binary"](audio)
    types = [m["type"] for m in out]
    assert types == ["speech_start", "result"] and out[1]["text"] == "hello"


def test_asr_flush_drains():
    st, conn = make()
    asyncio.run(server.handle_message(st, json.dumps({"type": "asr_init", "id": 1}), None, conn))
    reply, _ = asyncio.run(server.handle_message(
        st, json.dumps({"type": "asr_flush", "id": 2}), None, conn))
    assert reply == {"type": "ok", "id": 2}
    assert any('"tail"' in s for s in conn._ws.sent)
