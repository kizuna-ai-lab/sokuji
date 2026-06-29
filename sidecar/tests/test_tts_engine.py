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


def test_importing_tts_engine_registers_tts_backends():
    # Production startup imports tts_engine (__main__.py:10) and never imports
    # tts_backends directly; that import must register sherpa_tts + moss_onnx so
    # make_backend() can find them at load time. Run in a subprocess so sibling
    # test modules that import tts_backends directly cannot mask the wiring.
    import subprocess, sys
    code = (
        "from sokuji_sidecar import tts_engine\n"
        "from sokuji_sidecar import backends\n"
        "names = set(backends._BACKENDS)\n"
        "assert 'sherpa_tts' in names, names\n"
        "assert 'moss_onnx' in names, names\n"
        "print('ok')\n"
    )
    r = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr


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
    """Handler dispatches a background task and pushes chunks via that task."""
    st = _state(_FakeStream(), monkeypatch, "moss-tts-nano")
    conn = _FakeConn()

    async def run():
        await st["handlers"]["tts_init"](st, {"type": "tts_init", "id": 1,
                    "model": "moss-tts-nano"}, None, conn)
        reply, _ = await st["handlers"]["tts_generate"](
            st, {"type": "tts_generate", "id": "g1", "text": "hello"}, None, conn)
        assert reply is None  # dispatched as background task
        await conn.ctx["tts_stream_task"]  # wait for completion

    asyncio.run(run())
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


def test_tts_generate_streaming_dispatches_task_and_returns_immediately(monkeypatch):
    """Streaming handler returns (None, None) immediately and stores an asyncio.Task
    in conn.ctx['tts_stream_task']; awaiting that task delivers all chunks + done."""
    st = _state(_FakeStream(), monkeypatch, "moss-tts-nano")
    conn = _FakeConn()

    async def run():
        await st["handlers"]["tts_init"](st, {"type": "tts_init", "id": 1,
                    "model": "moss-tts-nano"}, None, conn)
        reply, binary = await st["handlers"]["tts_generate"](
            st, {"type": "tts_generate", "id": "g3", "text": "hello"}, None, conn)
        # Must return immediately with (None, None) — read loop stays live
        assert reply is None and binary is None
        task = conn.ctx.get("tts_stream_task")
        assert task is not None and isinstance(task, asyncio.Task)
        # Await to completion and verify the task ran the full stream
        await task
        kinds = [o.get("type") for o, _ in conn.sent if o]
        assert kinds.count("tts_chunk") == 3
        assert kinds.count("tts_done") == 1

    asyncio.run(run())


def test_h_set_voice_builtin_name_path():
    import asyncio
    from sokuji_sidecar import tts_engine
    called = {}
    class FakeEng:
        def set_builtin_voice(self, n): called["builtin"] = n
        def set_voice(self, a, sr): called["clip"] = (len(a), sr)
    state = {"tts_engine": FakeEng()}; tts_engine.register(state)
    reply, _ = asyncio.run(state["handlers"]["set_voice"](state, {"id": 1, "voice": "Ava"}, None, None))
    assert reply["type"] == "ok" and called == {"builtin": "Ava"}


def test_tts_cancel_stops_inflight_stream(monkeypatch):
    """tts_cancel flips the cancel flag while the stream task runs; the stream task
    respects the flag and stops early, then still emits tts_done.

    The fake backend gates between chunk 0 and chunk 1 via a threading.Event so the
    cancel is injected deterministically: the test waits until chunk 0 is done
    (before_gate fires), then sets the cancel flag and releases the gate.  The worker
    thread sees should_cancel()=True before yielding chunk 1 and breaks.
    """
    import threading

    class _FakePausedStream:
        NAME = "fake_paused_stream"
        STREAMING = True
        CLONES = True
        sample_rate = 24000

        def __init__(self):
            self._loaded = True
            self.gate = threading.Event()         # released by test to allow chunk 1+
            self.before_gate = threading.Event()  # set just before gate.wait()

        def generate_stream(self, text, speed=1.0):
            yield np.ones(8000, np.float32)   # chunk 0 — always produced
            self.before_gate.set()             # signal: chunk 0 queued, about to block
            self.gate.wait()                   # block until test releases
            yield np.ones(8000, np.float32)   # chunk 1 (skipped when cancelled)
            yield np.ones(8000, np.float32)   # chunk 2 (skipped when cancelled)

        def unload(self):
            self._loaded = False

    b = _FakePausedStream()
    st = _state(b, monkeypatch, "moss-tts-nano")
    conn = _FakeConn()

    async def run():
        loop = asyncio.get_running_loop()
        await st["handlers"]["tts_init"](st, {"type": "tts_init", "id": 1,
                    "model": "moss-tts-nano"}, None, conn)
        reply, _ = await st["handlers"]["tts_generate"](
            st, {"type": "tts_generate", "id": "g4", "text": "hello"}, None, conn)
        assert reply is None
        task = conn.ctx.get("tts_stream_task")
        assert task is not None and isinstance(task, asyncio.Task)

        # Wait (off the event loop via executor) until chunk 0 is queued
        # and the fake is about to block on gate — cancel flag can now be set safely.
        await loop.run_in_executor(None, b.before_gate.wait)

        # Set the cancel flag via the handler (this is what the real client sends)
        await st["handlers"]["tts_cancel"](
            st, {"type": "tts_cancel", "id": "g4"}, None, conn)
        assert st.get("tts_cancels", {}).get("g4") is True

        # Release the gate: worker resumes, checks should_cancel()=True, breaks
        b.gate.set()

        await asyncio.wait_for(task, timeout=5.0)

        kinds = [o.get("type") for o, _ in conn.sent if o]
        # Fewer than 3 chunks (cancel stopped chunk 1 and 2); tts_done always fires
        assert kinds.count("tts_chunk") < 3
        assert kinds.count("tts_done") == 1

    asyncio.run(run())
