import asyncio
import json
import threading

import numpy as np
import pytest
from sokuji_sidecar import accel, server, tts_engine


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


def test_resample_44100_to_24000_sample_count():
    # Regression for defect 3: Supertonic's native rate (44100) downsampling
    # through the shared resample path, now via soxr instead of unantialiased
    # linear interpolation.
    x = np.zeros(44100, np.float32)                    # 1.0s @ 44100
    pcm = tts_engine._to_int16_24k_mono(x, 44100)
    assert abs(len(np.frombuffer(pcm, np.int16)) - 24000) <= 2


def test_resample_uses_soxr(monkeypatch):
    calls = []

    def spy(x, sr_in, sr_out):
        calls.append((sr_in, sr_out))
        return np.zeros(sr_out, np.float32)

    monkeypatch.setattr(tts_engine.soxr, "resample", spy)
    tts_engine._to_int16_24k_mono(np.zeros(44100, np.float32), 44100)
    assert calls == [(44100, 24000)]


class _FakeOneShot:
    """New native_tts-shaped one-shot backend: no set_speaker/set_style_voice
    (those methods and their wire dispatch die with the ONNX Supertonic/MOSS
    backends — spec §5.3/§5.5), set_voice always takes ref_text, cancel() exists
    but is meaningless for a one-shot family (never called by generate())."""
    NAME = "fake_oneshot"
    STREAMING = False
    CLONES = False
    sample_rate = 16000

    def __init__(self):
        self._loaded = True
        self.language = None
        self.builtin_voice = None

    def set_language(self, lang):
        self.language = lang

    def set_voice(self, a, sr, ref_text=""):
        raise AssertionError("one-shot has no set_voice")

    def set_builtin_voice(self, name):
        self.builtin_voice = name

    def list_builtin_voices(self):
        return ["Ava", "Bella"]

    def generate(self, text, speed=1.0):
        return np.ones(16000, np.float32), 50

    def cancel(self):
        raise AssertionError("one-shot generation is never cancelled")

    def unload(self):
        self._loaded = False

    @property
    def is_loaded(self):
        return self._loaded


class _FakeStream:
    NAME = "fake_stream"
    STREAMING = True
    CLONES = True
    sample_rate = 24000

    def __init__(self):
        self._loaded = True
        self.voice = None
        self.builtin_voice = None
        self.cancel_calls = 0

    def set_voice(self, a, sr, ref_text=""):
        self.voice = (len(a), sr, ref_text)

    def set_builtin_voice(self, name):
        self.builtin_voice = name

    def cancel(self):
        self.cancel_calls += 1

    def generate(self, text, speed=1.0):
        return np.concatenate(list(self.generate_stream(text, speed))), 30

    def generate_stream(self, text, speed=1.0):
        for _ in range(3):
            yield np.ones(8000, np.float32)            # 3 chunks @ 24k

    def unload(self):
        self._loaded = False

    @property
    def is_loaded(self):
        return self._loaded


def _patch(monkeypatch, backend, model_id):
    plan = accel.Plan(backend.NAME, "cpu", "cpu", "fp32", "repo", 1.0)
    monkeypatch.setattr(accel, "resolve_tts", lambda *a, **k: [plan])
    monkeypatch.setattr(accel, "load_measured", lambda plans, **kw: (backend, plan, None, None))
    monkeypatch.setattr(accel, "measure_rtf_tts", lambda *a, **k: 0.1)


def test_init_oneshot_reports_resolved_and_24k(monkeypatch):
    b = _FakeOneShot(); _patch(monkeypatch, b, "piper-en-amy")
    eng = tts_engine.TtsEngine()
    eng.init("piper-en-amy")
    assert eng.sample_rate == 24000 and eng.streaming is False and eng.clones is False
    assert eng.resolved["backend"] == "fake_oneshot"
    assert eng.model_id == "piper-en-amy"
    assert eng.is_loaded is True


def test_close_clears_model_id_and_loaded_state(monkeypatch):
    b = _FakeOneShot(); _patch(monkeypatch, b, "piper-en-amy")
    eng = tts_engine.TtsEngine(); eng.init("piper-en-amy")
    eng.close()
    assert eng.model_id is None and eng.is_loaded is False and b.is_loaded is False


def test_generate_oneshot_returns_24k_pcm(monkeypatch):
    b = _FakeOneShot(); _patch(monkeypatch, b, "piper-en-amy")
    eng = tts_engine.TtsEngine(); eng.init("piper-en-amy")
    pcm, ms = eng.generate("hello")
    assert abs(len(np.frombuffer(pcm, np.int16)) - 24000) <= 2  # 16k->24k


def test_set_voice_defaults_ref_text_to_empty_string(monkeypatch):
    b = _FakeStream(); _patch(monkeypatch, b, "moss-tts-nano")
    eng = tts_engine.TtsEngine(); eng.init("moss-tts-nano")
    eng.set_voice(np.ones(2400, np.float32), 24000)
    assert b.voice == (2400, 24000, "")


def test_set_voice_passes_explicit_ref_text(monkeypatch):
    b = _FakeStream(); _patch(monkeypatch, b, "moss-tts-nano")
    eng = tts_engine.TtsEngine(); eng.init("moss-tts-nano")
    eng.set_voice(np.ones(2400, np.float32), 24000, ref_text="hello")
    assert b.voice == (2400, 24000, "hello")


def test_set_builtin_voice_and_list_builtin_voices_passthrough(monkeypatch):
    b = _FakeOneShot(); _patch(monkeypatch, b, "piper-en-amy")
    eng = tts_engine.TtsEngine(); eng.init("piper-en-amy")
    eng.set_builtin_voice("Ava")
    assert b.builtin_voice == "Ava"
    assert eng.list_builtin_voices() == ["Ava", "Bella"]


def test_list_builtin_voices_degrades_to_empty_when_backend_lacks_it(monkeypatch):
    # Pre-Task-5 regression guard: MOSS's ONNX backend (still resolvable via the
    # catalog until the native_tts rewire) has no list_builtin_voices() at all --
    # this must degrade to [], not raise AttributeError, when the engine happens
    # to have it loaded when list_tts_voices is asked about it.
    class _NoVoiceListing(_FakeStream):
        pass
    b = _NoVoiceListing(); assert not hasattr(b, "list_builtin_voices")
    _patch(monkeypatch, b, "moss-tts-nano")
    eng = tts_engine.TtsEngine(); eng.init("moss-tts-nano")
    assert eng.list_builtin_voices() == []


def test_cancel_active_reaches_backend_cancel(monkeypatch):
    b = _FakeStream(); _patch(monkeypatch, b, "moss-tts-nano")
    eng = tts_engine.TtsEngine(); eng.init("moss-tts-nano")
    eng.cancel_active()
    assert b.cancel_calls == 1


def test_cancel_active_is_noop_when_nothing_loaded():
    eng = tts_engine.TtsEngine()
    eng.cancel_active()  # must not raise


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


def test_generate_stream_honors_client_side_cancel(monkeypatch):
    b = _FakeStream(); _patch(monkeypatch, b, "moss-tts-nano")
    eng = tts_engine.TtsEngine(); eng.init("moss-tts-nano")
    sent = []
    async def send(obj=None, binary=None): sent.append((obj, binary))
    asyncio.run(eng.generate_stream("hi", 1.0, send, lambda: True, msg_id="m2"))
    chunks = [o for o, _ in sent if o and o.get("type") == "tts_chunk"]
    assert len(chunks) == 0  # cancelled before first emit


class _FakeConn:
    def __init__(self): self.ctx = {}; self.sent = []; self._on_close = []
    def on_close(self, cb): self._on_close.append(cb)
    async def send(self, obj=None, binary=None): self.sent.append((obj, binary))


def _state(backend, monkeypatch, model_id):
    _patch(monkeypatch, backend, model_id)
    st = {"tts_engine": tts_engine.TtsEngine(), "handlers": {}}
    tts_engine.register(st)
    return st


# ── defect 1: blocking calls move off the event loop ──────────────────────

def _spy_executor(monkeypatch):
    """Record every loop.run_in_executor(None, func, ...) call while still
    running it for real, so a handler under test both proves it went through
    the executor AND keeps working end to end."""
    calls = []
    orig = asyncio.BaseEventLoop.run_in_executor

    def spy(self, executor, func, *args):
        calls.append(func)
        return orig(self, executor, func, *args)

    monkeypatch.setattr(asyncio.BaseEventLoop, "run_in_executor", spy)
    return calls


def test_handler_tts_init_runs_off_the_event_loop(monkeypatch):
    st = _state(_FakeOneShot(), monkeypatch, "piper-en-amy")
    calls = _spy_executor(monkeypatch)
    conn = _FakeConn()
    reply, _ = asyncio.run(st["handlers"]["tts_init"](
        st, {"type": "tts_init", "id": 1, "model": "piper-en-amy"}, None, conn))
    assert reply["type"] == "ready"
    assert len(calls) == 1  # eng.init(...) ran via run_in_executor


def test_handler_set_voice_builtin_name_runs_off_the_event_loop(monkeypatch):
    st = _state(_FakeOneShot(), monkeypatch, "piper-en-amy")
    conn = _FakeConn()
    asyncio.run(st["handlers"]["tts_init"](st, {"type": "tts_init", "id": 1,
                "model": "piper-en-amy"}, None, conn))
    calls = _spy_executor(monkeypatch)
    reply, _ = asyncio.run(st["handlers"]["set_voice"](
        st, {"type": "set_voice", "id": 2, "voice": "Ava"}, None, conn))
    assert reply == {"type": "ok", "id": 2}
    assert st["tts_engine"]._backend.builtin_voice == "Ava"
    assert len(calls) == 1


def test_handler_set_voice_clone_runs_off_the_event_loop(monkeypatch):
    st = _state(_FakeStream(), monkeypatch, "moss-tts-nano")
    conn = _FakeConn()
    asyncio.run(st["handlers"]["tts_init"](st, {"type": "tts_init", "id": 1,
                "model": "moss-tts-nano"}, None, conn))
    calls = _spy_executor(monkeypatch)
    ref = np.ones(2400, np.float32).tobytes()
    reply, _ = asyncio.run(st["handlers"]["set_voice"](
        st, {"type": "set_voice", "id": 2, "sampleRate": 24000, "refText": "hi"}, ref, conn))
    assert reply["type"] == "ok"
    assert st["tts_engine"]._backend.voice == (2400, 24000, "hi")
    assert len(calls) == 1


def test_handler_set_voice_sid_runs_off_the_event_loop(monkeypatch):
    class _FakeRangeBackend(_FakeOneShot):
        def __init__(self):
            super().__init__()
            self.sid = None

        def set_speaker(self, sid):
            self.sid = sid

    st = _state(_FakeRangeBackend(), monkeypatch, "piper-en-amy")
    conn = _FakeConn()
    asyncio.run(st["handlers"]["tts_init"](st, {"type": "tts_init", "id": 1,
                "model": "piper-en-amy"}, None, conn))
    calls = _spy_executor(monkeypatch)
    reply, _ = asyncio.run(st["handlers"]["set_voice"](
        st, {"type": "set_voice", "id": 3, "sid": 5}, None, conn))
    assert reply == {"type": "ok", "id": 3}
    assert st["tts_engine"]._backend.sid == 5
    assert len(calls) == 1


def test_handler_set_voice_style_variant_runs_off_the_event_loop(monkeypatch):
    class _FakeStyleBackend(_FakeOneShot):
        def __init__(self):
            super().__init__()
            self.style = None

        def set_style_voice(self, ttl, dp):
            self.style = (ttl, dp)

    st = _state(_FakeStyleBackend(), monkeypatch, "supertonic-3")
    conn = _FakeConn()
    asyncio.run(st["handlers"]["tts_init"](st, {"type": "tts_init", "id": 1,
                "model": "supertonic-3"}, None, conn))
    calls = _spy_executor(monkeypatch)
    ttl = np.arange(50 * 256, dtype=np.float32)
    dp = np.arange(8 * 16, dtype=np.float32)
    msg = {"type": "set_voice", "id": 4, "styleVoice": {"ttlDims": [1, 50, 256], "dpDims": [1, 8, 16]}}
    reply, _ = asyncio.run(st["handlers"]["set_voice"](st, msg, ttl.tobytes() + dp.tobytes(), conn))
    assert reply == {"type": "ok", "id": 4}
    style_ttl, style_dp = st["tts_engine"]._backend.style
    assert style_ttl.shape == (1, 50, 256) and style_dp.shape == (1, 8, 16)
    assert len(calls) == 1


def test_handler_tts_generate_oneshot_runs_off_the_event_loop(monkeypatch):
    st = _state(_FakeOneShot(), monkeypatch, "piper-en-amy")
    conn = _FakeConn()
    asyncio.run(st["handlers"]["tts_init"](st, {"type": "tts_init", "id": 1,
                "model": "piper-en-amy"}, None, conn))
    calls = _spy_executor(monkeypatch)
    reply, binary = asyncio.run(st["handlers"]["tts_generate"](
        st, {"type": "tts_generate", "id": "g2", "text": "hello"}, None, conn))
    assert reply["type"] == "tts_generate_result" and reply["id"] == "g2"
    assert reply["sampleRate"] == 24000 and binary is not None
    assert reply["samples"] == len(binary) // 2
    assert len(calls) == 1


# ── handler behaviour (unchanged surface) ──────────────────────────────────

def test_handler_tts_init_ready_registers_teardown(monkeypatch):
    st = _state(_FakeStream(), monkeypatch, "moss-tts-nano")
    conn = _FakeConn()
    reply, _ = asyncio.run(st["handlers"]["tts_init"](
        st, {"type": "tts_init", "id": 1, "model": "moss-tts-nano"}, None, conn))
    assert reply["type"] == "ready" and reply["sampleRate"] == 24000
    assert reply["streaming"] is True and reply["clones"] is True
    assert len(conn._on_close) == 1        # tts_init registered this session's cleanup


def test_handler_tts_init_passes_variant_as_pin(monkeypatch):
    # tts_init's optional `variant` field (renderer's variant picker, same field
    # name as asr_init's — see asr_engine.py:558) must reach accel.resolve_tts
    # as the pin= kwarg, not get silently dropped.
    b = _FakeOneShot()
    plan = accel.Plan(b.NAME, "cpu", "cpu", "fp32", "repo", 1.0)
    seen = {}
    def fake_resolve_tts(mid, override="auto", pin=None):
        seen["pin"] = pin
        return [plan]
    monkeypatch.setattr(accel, "resolve_tts", fake_resolve_tts)
    monkeypatch.setattr(accel, "load_measured", lambda plans, **kw: (b, plan, None, None))
    monkeypatch.setattr(accel, "measure_rtf_tts", lambda *a, **k: 0.1)
    st = {"tts_engine": tts_engine.TtsEngine(), "handlers": {}}
    tts_engine.register(st)
    conn = _FakeConn()
    asyncio.run(st["handlers"]["tts_init"](st, {"type": "tts_init", "id": 1,
                "model": "piper-en-amy", "variant": "bf16"}, None, conn))
    assert seen["pin"] == "bf16"


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
        assert conn.ctx.get("tts_stream_mid") == "g3"
        # Await to completion and verify the task ran the full stream
        await task
        kinds = [o.get("type") for o, _ in conn.sent if o]
        assert kinds.count("tts_chunk") == 3
        assert kinds.count("tts_done") == 1

    asyncio.run(run())


def test_h_set_voice_builtin_name_path():
    called = {}
    class FakeEng:
        def set_builtin_voice(self, n): called["builtin"] = n
        def set_voice(self, a, sr, ref_text=""): called["clip"] = (len(a), sr, ref_text)
    state = {"tts_engine": FakeEng()}; tts_engine.register(state)
    reply, _ = asyncio.run(state["handlers"]["set_voice"](state, {"id": 1, "voice": "Ava"}, None, None))
    assert reply["type"] == "ok" and called == {"builtin": "Ava"}


def test_set_voice_sid_form_routes_to_set_speaker():
    seen = {}
    class _Eng:
        def set_speaker(self, sid): seen["sid"] = sid
        def set_builtin_voice(self, name): seen["name"] = name
        def set_voice(self, audio, sr, ref_text=""): seen["clip"] = (len(audio), sr, ref_text)
    state = {"tts_engine": _Eng(), "handlers": {}}
    tts_engine.register(state)
    reply, _ = asyncio.run(state["handlers"]["set_voice"](
        state, {"id": 3, "type": "set_voice", "sid": 5}, None, None))
    assert seen == {"sid": 5}
    assert reply == {"type": "ok", "id": 3}


def test_h_set_voice_clone_path_defaults_missing_ref_text_to_none():
    called = {}
    class FakeEng:
        def set_builtin_voice(self, n): called["builtin"] = n
        def set_voice(self, a, sr, ref_text=""): called["clip"] = (len(a), sr, ref_text)
    state = {"tts_engine": FakeEng(), "handlers": {}}
    tts_engine.register(state)
    ref = np.ones(240, np.float32).tobytes()
    reply, _ = asyncio.run(state["handlers"]["set_voice"](
        state, {"id": 3, "type": "set_voice", "sampleRate": 24000}, ref, None))
    assert called["clip"] == (240, 24000, None)
    assert reply == {"type": "ok", "id": 3}


def test_list_tts_voices_passes_model_and_engine_through(monkeypatch):
    seen = {}
    def fake_list(model=None, engine=None):
        seen["model"] = model
        seen["engine"] = engine
        return ["Ava", "Bella"]
    monkeypatch.setattr("sokuji_sidecar.tts_voices.list_builtin_voices", fake_list)
    eng = tts_engine.TtsEngine()
    state = {"tts_engine": eng}; tts_engine.register(state)
    reply, _ = asyncio.run(state["handlers"]["list_tts_voices"](
        state, {"id": 1, "type": "list_tts_voices", "model": "moss-tts-nano"}, None, None))
    assert reply["voices"] == ["Ava", "Bella"]
    assert seen == {"model": "moss-tts-nano", "engine": eng}


def test_tts_cancel_sets_flag_and_calls_engine_cancel_active():
    calls = []
    class FakeEng:
        def cancel_active(self): calls.append(1)
    state = {"tts_engine": FakeEng(), "tts_cancels": {"g4": False}, "handlers": {}}
    tts_engine.register(state)
    reply, _ = asyncio.run(state["handlers"]["tts_cancel"](
        state, {"type": "tts_cancel", "id": "g4"}, None, None))
    assert reply == {"type": "ok", "id": "g4"}
    assert state["tts_cancels"]["g4"] is True
    assert calls == [1]


def test_tts_cancel_with_unknown_id_still_calls_engine_cancel_active():
    calls = []
    class FakeEng:
        def cancel_active(self): calls.append(1)
    state = {"tts_engine": FakeEng(), "handlers": {}}
    tts_engine.register(state)
    reply, _ = asyncio.run(state["handlers"]["tts_cancel"](
        state, {"type": "tts_cancel", "id": "unknown"}, None, None))
    assert reply == {"type": "ok", "id": "unknown"}
    assert calls == [1]


# ── defect 2: supersede stops the OLD generation, not just its asyncio Task ──

class _FakeTask:
    def __init__(self):
        self.cancel_called = False

    def done(self):
        return False

    def cancel(self):
        self.cancel_called = True


class _FakeEngineForSupersede:
    streaming = True
    sample_rate = 24000

    def __init__(self):
        self.cancel_active_calls = 0
        self.generate_stream_calls = []

    def cancel_active(self):
        self.cancel_active_calls += 1

    async def generate_stream(self, text, speed, send, should_cancel, msg_id):
        self.generate_stream_calls.append(msg_id)
        await send({"type": "tts_done", "id": msg_id, "totalSamples": 0, "generationTimeMs": 0})


def test_supersede_sets_prior_cancel_flag_and_calls_engine_cancel_active():
    eng = _FakeEngineForSupersede()
    state = {"tts_engine": eng, "handlers": {}, "tts_cancels": {"prior-id": False}}
    tts_engine.register(state)
    conn = _FakeConn()
    prior_task = _FakeTask()
    conn.ctx["tts_stream_task"] = prior_task
    conn.ctx["tts_stream_mid"] = "prior-id"

    async def run():
        reply, binary = await state["handlers"]["tts_generate"](
            state, {"type": "tts_generate", "id": "new-id", "text": "hi"}, None, conn)
        assert reply is None and binary is None
        new_task = conn.ctx.get("tts_stream_task")
        assert isinstance(new_task, asyncio.Task) and new_task is not prior_task
        await new_task

    asyncio.run(run())
    assert state["tts_cancels"]["prior-id"] is True     # client-side flag, still set
    assert eng.cancel_active_calls == 1                 # reaches the backend itself
    assert prior_task.cancel_called is True             # asyncio Task detached last
    assert eng.generate_stream_calls == ["new-id"]


def test_tts_cancel_stops_inflight_stream_end_to_end(monkeypatch):
    """tts_cancel flips the cancel flag AND calls eng.cancel_active() (which
    reaches backend.cancel()) while the stream task runs; the stream task
    respects should_cancel() and stops early, still emitting tts_done.

    The fake backend gates between chunk 0 and chunk 1 via a threading.Event so
    the cancel is injected deterministically: the test waits until chunk 0 is
    done (before_gate fires), then cancels and releases the gate. The worker
    thread sees should_cancel()=True before yielding chunk 1 and breaks.
    """
    class _FakePausedStream:
        NAME = "fake_paused_stream"
        STREAMING = True
        CLONES = True
        sample_rate = 24000

        def __init__(self):
            self._loaded = True
            self.cancel_calls = 0
            self.gate = threading.Event()
            self.before_gate = threading.Event()

        def generate_stream(self, text, speed=1.0):
            yield np.ones(8000, np.float32)   # chunk 0 — always produced
            self.before_gate.set()
            self.gate.wait()
            yield np.ones(8000, np.float32)   # chunk 1 (skipped once cancelled)
            yield np.ones(8000, np.float32)   # chunk 2 (skipped once cancelled)

        def cancel(self):
            self.cancel_calls += 1

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

        await loop.run_in_executor(None, b.before_gate.wait)

        await st["handlers"]["tts_cancel"](
            st, {"type": "tts_cancel", "id": "g4"}, None, conn)
        assert st.get("tts_cancels", {}).get("g4") is True
        assert b.cancel_calls == 1          # reached the backend, not just the flag

        b.gate.set()
        await asyncio.wait_for(task, timeout=5.0)

        kinds = [o.get("type") for o, _ in conn.sent if o]
        assert kinds.count("tts_chunk") < 3
        assert kinds.count("tts_done") == 1

    asyncio.run(run())


def test_conn_close_frees_tts_model():
    """A TTS session connection (tts_init) closing must trigger engine.close() in
    _conn's finally, releasing the model from VRAM on stop — the TTS analogue of
    test_conn_close_frees_asr_model.

    Uses a fake engine for the same reason that test does: the real TtsEngine.init()
    calls close() itself for VRAM hygiene, so a real engine would count two closes
    for one tts_init and could not show whether the DISCONNECT closed the model."""
    closed = {"n": 0}

    class Eng:
        sample_rate = 24000
        resolved = None

        def init(self, *a, **k):
            return 1

        def close(self):
            closed["n"] += 1

    st = {"tts_engine": Eng(), "handlers": {}}
    tts_engine.register(st)

    class WS:
        def __init__(self):
            self._msgs = [json.dumps({"type": "tts_init", "id": 1, "model": "moss-tts-nano"})]

        def __aiter__(self):
            return self

        async def __anext__(self):
            if self._msgs:
                return self._msgs.pop(0)
            raise StopAsyncIteration

        async def send(self, d):
            pass

    asyncio.run(server._conn(st, WS()))
    assert closed["n"] == 1
