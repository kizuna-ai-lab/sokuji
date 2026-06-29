import asyncio
import numpy as np
import pytest
from sokuji_sidecar import tts_engine, accel, catalog


def test_resample_48k_stereo_to_24k_mono():
    stereo = np.ones((48000, 2), np.float32)          # 1.0s @ 48k stereo
    pcm = tts_engine._to_int16_24k_mono(stereo, 48000)
    samples = np.frombuffer(pcm, np.int16)
    assert abs(len(samples) - 24000) <= 2             # ~1.0s @ 24k mono
    assert samples.dtype == np.int16 and samples.max() > 30000  # ones -> ~32767


def test_resample_16k_mono_to_24k():
    mono = np.zeros(16000, np.float32)
    pcm = tts_engine._to_int16_24k_mono(mono, 16000)
    assert abs(len(np.frombuffer(pcm, np.int16)) - 24000) <= 2


class _FakeOneShot:
    NAME = "fake_oneshot"; STREAMING = False; CLONES = False; sample_rate = 16000
    def __init__(self): self._loaded = True
    def set_voice(self, a, sr): raise AssertionError("one-shot has no set_voice")
    def generate(self, text, speed=1.0): return np.ones(16000, np.float32), 50
    def unload(self): self._loaded = False
    @property
    def is_loaded(self): return self._loaded


class _FakeStream:
    NAME = "fake_stream"; STREAMING = True; CLONES = True; sample_rate = 24000
    def __init__(self): self._loaded = True; self.voice = None
    def set_voice(self, a, sr): self.voice = (len(a), sr)
    def generate(self, text, speed=1.0):
        return np.concatenate(list(self.generate_stream(text, speed))), 30
    def generate_stream(self, text, speed=1.0):
        for _ in range(3):
            yield np.ones(8000, np.float32)            # 3 chunks @ 24k
    def unload(self): self._loaded = False
    @property
    def is_loaded(self): return self._loaded


def _patch(monkeypatch, backend, model_id):
    plan = accel.Plan(backend.NAME, "cpu", "cpu", "fp32", "repo", 1.0)
    monkeypatch.setattr(accel, "resolve_tts", lambda *a, **k: [plan])
    monkeypatch.setattr(accel, "load_measured", lambda plans: (backend, plan, None, None))
    monkeypatch.setattr(accel, "measure_rtf_tts", lambda *a, **k: 0.1)


def test_init_oneshot_reports_resolved_and_24k(monkeypatch):
    b = _FakeOneShot(); _patch(monkeypatch, b, "piper-en-amy")
    eng = tts_engine.TtsEngine()
    eng.init("piper-en-amy")
    assert eng.sample_rate == 24000 and eng.streaming is False and eng.clones is False
    assert eng.resolved["backend"] == "fake_oneshot"


def test_generate_oneshot_returns_24k_pcm(monkeypatch):
    b = _FakeOneShot(); _patch(monkeypatch, b, "piper-en-amy")
    eng = tts_engine.TtsEngine(); eng.init("piper-en-amy")
    pcm, ms = eng.generate("hello")
    assert abs(len(np.frombuffer(pcm, np.int16)) - 24000) <= 2  # 16k->24k


def test_generate_stream_emits_chunks_then_done(monkeypatch):
    b = _FakeStream(); _patch(monkeypatch, b, "moss-tts-nano")
    eng = tts_engine.TtsEngine(); eng.init("moss-tts-nano")
    sent = []
    async def send(obj=None, binary=None): sent.append((obj, binary))
    asyncio.run(eng.generate_stream("hi", 1.0, send, lambda: False, msg_id="m1"))
    chunks = [o for o, _ in sent if o and o.get("type") == "tts_chunk"]
    done = [o for o, _ in sent if o and o.get("type") == "tts_done"]
    assert len(chunks) == 3 and len(done) == 1
    assert done[0]["id"] == "m1" and done[0]["totalSamples"] == 3 * 8000


def test_generate_stream_honors_cancel(monkeypatch):
    b = _FakeStream(); _patch(monkeypatch, b, "moss-tts-nano")
    eng = tts_engine.TtsEngine(); eng.init("moss-tts-nano")
    sent = []
    async def send(obj=None, binary=None): sent.append((obj, binary))
    asyncio.run(eng.generate_stream("hi", 1.0, send, lambda: True, msg_id="m2"))
    chunks = [o for o, _ in sent if o and o.get("type") == "tts_chunk"]
    assert len(chunks) == 0  # cancelled before first emit


class _FakeConn:
    def __init__(self): self.ctx = {}; self.sent = []
    async def send(self, obj=None, binary=None): self.sent.append((obj, binary))


def _state(backend, monkeypatch, model_id):
    _patch(monkeypatch, backend, model_id)
    st = {"tts_engine": tts_engine.TtsEngine(), "handlers": {}}
    tts_engine.register(st)
    return st


def test_handler_tts_init_ready_sets_ownership(monkeypatch):
    st = _state(_FakeStream(), monkeypatch, "moss-tts-nano")
    conn = _FakeConn()
    reply, _ = asyncio.run(st["handlers"]["tts_init"](
        st, {"type": "tts_init", "id": 1, "model": "moss-tts-nano"}, None, conn))
    assert reply["type"] == "ready" and reply["sampleRate"] == 24000
    assert reply["streaming"] is True and reply["clones"] is True
    assert conn.ctx.get("owns_tts") is True


def test_handler_set_voice_buffers_binary(monkeypatch):
    st = _state(_FakeStream(), monkeypatch, "moss-tts-nano")
    conn = _FakeConn()
    asyncio.run(st["handlers"]["tts_init"](st, {"type": "tts_init", "id": 1,
                "model": "moss-tts-nano"}, None, conn))
    ref = np.ones(2400, np.float32).tobytes()
    reply, _ = asyncio.run(st["handlers"]["set_voice"](
        st, {"type": "set_voice", "id": 2, "sampleRate": 24000}, ref, conn))
    assert reply["type"] == "ok"
    assert st["tts_engine"]._backend.voice == (2400, 24000)


def test_handler_tts_generate_streaming_pushes_chunks(monkeypatch):
    st = _state(_FakeStream(), monkeypatch, "moss-tts-nano")
    conn = _FakeConn()
    asyncio.run(st["handlers"]["tts_init"](st, {"type": "tts_init", "id": 1,
                "model": "moss-tts-nano"}, None, conn))
    reply, _ = asyncio.run(st["handlers"]["tts_generate"](
        st, {"type": "tts_generate", "id": "g1", "text": "hello"}, None, conn))
    assert reply is None  # streamed via conn.send, not returned
    kinds = [o.get("type") for o, _ in conn.sent if o]
    assert kinds.count("tts_chunk") == 3 and kinds.count("tts_done") == 1


def test_handler_tts_generate_oneshot_returns_result(monkeypatch):
    st = _state(_FakeOneShot(), monkeypatch, "piper-en-amy")
    conn = _FakeConn()
    asyncio.run(st["handlers"]["tts_init"](st, {"type": "tts_init", "id": 1,
                "model": "piper-en-amy"}, None, conn))
    reply, binary = asyncio.run(st["handlers"]["tts_generate"](
        st, {"type": "tts_generate", "id": "g2", "text": "hello"}, None, conn))
    assert reply["type"] == "result" and reply["id"] == "g2"
    assert reply["sampleRate"] == 24000 and binary is not None
    assert reply["samples"] == len(binary) // 2
