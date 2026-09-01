import asyncio
import json
import os
import threading
import time

import numpy as np
import pytest
import soxr
from sokuji_sidecar import accel, native, planner, server, tts_engine


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
        return np.ones(16000, np.float32), self.sample_rate, 50

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
        chunks = [c for c, _sr in self.generate_stream(text, speed)]
        return np.concatenate(chunks), self.sample_rate, 30

    def generate_stream(self, text, speed=1.0):
        for _ in range(3):
            yield np.ones(8000, np.float32), self.sample_rate   # 3 chunks @ 24k

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


def test_init_reports_family_from_plan_config(monkeypatch):
    # ready.family (Task 6): the engine exposes the resolved card's family
    # straight off Plan.config.tts_family -- the same value native_tts's
    # backend.load() reads (planner._plan_config, TtsModel.family).
    b = _FakeOneShot()
    plan = accel.Plan(b.NAME, "cpu", "cpu", "fp32", "repo", 1.0,
                       config=planner.PlanConfig(tts_family="moss_tts_nano"))
    monkeypatch.setattr(accel, "resolve_tts", lambda *a, **k: [plan])
    monkeypatch.setattr(accel, "load_measured", lambda plans, **kw: (b, plan, None, None))
    monkeypatch.setattr(accel, "measure_rtf_tts", lambda *a, **k: 0.1)
    eng = tts_engine.TtsEngine()
    eng.init("moss-tts-nano")
    assert eng.resolved["family"] == "moss_tts_nano"


def test_init_omits_family_when_plan_config_has_none(monkeypatch):
    # A bare PlanConfig() (tts_family == "") must not add a misleading empty
    # `family` key -- same pattern as rtf/memoryBytes/fallbackReason above.
    b = _FakeOneShot(); _patch(monkeypatch, b, "piper-en-amy")
    eng = tts_engine.TtsEngine()
    eng.init("piper-en-amy")
    assert "family" not in eng.resolved


def test_handler_tts_init_reply_includes_family(monkeypatch):
    b = _FakeOneShot()
    plan = accel.Plan(b.NAME, "cpu", "cpu", "fp32", "repo", 1.0,
                       config=planner.PlanConfig(tts_family="supertonic"))
    monkeypatch.setattr(accel, "resolve_tts", lambda *a, **k: [plan])
    monkeypatch.setattr(accel, "load_measured", lambda plans, **kw: (b, plan, None, None))
    monkeypatch.setattr(accel, "measure_rtf_tts", lambda *a, **k: 0.1)
    st = {"tts_engine": tts_engine.TtsEngine(), "handlers": {}}
    tts_engine.register(st)
    conn = _FakeConn()
    reply, _ = asyncio.run(st["handlers"]["tts_init"](
        st, {"type": "tts_init", "id": 1, "model": "supertonic-3"}, None, conn))
    assert reply["family"] == "supertonic"


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


def test_generate_resamples_using_the_actual_returned_rate_not_caps_default(monkeypatch):
    """I2: a backend whose per-call generate() returns a DIFFERENT rate than its own
    advertised caps.sample_rate must be resampled using that ACTUAL rate -- using the
    stale caps-table default here would have left the wrong-rate samples effectively
    unresampled (a no-op 24k->24k) and pitch-shifted on playback."""
    class _OddRateOneShot(_FakeOneShot):
        sample_rate = 24000   # advertised caps default

        def generate(self, text, speed=1.0):
            return np.ones(16000, np.float32), 16000, 50   # actual rate: 16000, not 24000

    b = _OddRateOneShot(); _patch(monkeypatch, b, "piper-en-amy")
    eng = tts_engine.TtsEngine(); eng.init("piper-en-amy")
    pcm, ms = eng.generate("hello")
    # 16000 samples @ 16000Hz resampled to 24000Hz -> ~1.0s -> ~24000 samples. Using
    # the stale caps default (24000, a no-op) would instead pass 16000 samples
    # through unresampled -- this assertion catches exactly that regression.
    assert abs(len(np.frombuffer(pcm, np.int16)) - 24000) <= 2


def test_generate_downmixes_2d_stereo_samples_end_to_end(monkeypatch):
    """Review round 1, CQ-7: MOSS-shaped backends return real 2-D (frames,
    channels) samples (native/python/sokuji_native's TtsModel.synth() reshapes
    to that shape for a multi-channel family) -- the ENGINE, not the backend,
    must downmix to mono before resampling/quantizing to the wire's Int16@24k
    contract. Distinct L/R values make a real mean-based downmix provably
    exercised, not an accidental no-op."""
    class _FakeStereoOneShot(_FakeOneShot):
        sample_rate = 24000

        def generate(self, text, speed=1.0):
            stereo = np.zeros((24000, 2), np.float32)
            stereo[:, 0] = 1.0
            stereo[:, 1] = -1.0
            return stereo, self.sample_rate, 42

    b = _FakeStereoOneShot(); _patch(monkeypatch, b, "moss-tts-nano")
    eng = tts_engine.TtsEngine(); eng.init("moss-tts-nano")
    pcm, ms = eng.generate("hello")
    samples = np.frombuffer(pcm, np.int16)
    assert ms == 42
    assert abs(len(samples) - 24000) <= 2
    assert samples.max() == 0 and samples.min() == 0   # mean(1.0, -1.0) == 0.0 exactly


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


def test_generate_stream_resamples_each_chunk_using_its_own_rate(monkeypatch):
    """I2, streaming leg: each chunk must be resampled with the rate THAT chunk
    carried, not the family's advertised caps default -- proven by a fake whose
    per-chunk rate differs from its own class-level sample_rate."""
    class _OddRateStream(_FakeStream):
        sample_rate = 24000   # advertised caps default

        def generate_stream(self, text, speed=1.0):
            yield np.ones(8000, np.float32), 16000   # actual rate: 16000, not 24000

    b = _OddRateStream(); _patch(monkeypatch, b, "moss-tts-nano")
    eng = tts_engine.TtsEngine(); eng.init("moss-tts-nano")
    sent = []
    async def send(obj=None, binary=None): sent.append((obj, binary))
    asyncio.run(eng.generate_stream("hi", 1.0, send, lambda: False, msg_id="m1"))
    chunk_msgs = [(o, pcm) for o, pcm in sent if o and o.get("type") == "tts_chunk"]
    assert len(chunk_msgs) == 1
    pcm = chunk_msgs[0][1]
    # 8000 samples @ 16000Hz -> 0.5s -> ~12000 samples @ 24000Hz. Using the stale
    # caps default (24000, a no-op) would instead leave ~8000 samples unresampled.
    assert abs(len(np.frombuffer(pcm, np.int16)) - 12000) <= 2


def test_generate_stream_honors_client_side_cancel(monkeypatch):
    b = _FakeStream(); _patch(monkeypatch, b, "moss-tts-nano")
    eng = tts_engine.TtsEngine(); eng.init("moss-tts-nano")
    sent = []
    async def send(obj=None, binary=None): sent.append((obj, binary))
    asyncio.run(eng.generate_stream("hi", 1.0, send, lambda: True, msg_id="m2"))
    chunks = [o for o, _ in sent if o and o.get("type") == "tts_chunk"]
    assert len(chunks) == 0  # cancelled before first emit


def test_generate_stream_backend_failure_emits_error_not_done(monkeypatch):
    """Review round 1, CQ-2: a real backend failure must surface as an "error"
    push, and must NOT also get a trailing tts_done -- that would misreport a
    failed request as a (merely short) success."""
    class _FakeBoomingStream(_FakeStream):
        def generate_stream(self, text, speed=1.0):
            yield np.ones(8000, np.float32), self.sample_rate
            raise RuntimeError("decoder blew up")

    b = _FakeBoomingStream(); _patch(monkeypatch, b, "moss-tts-nano")
    eng = tts_engine.TtsEngine(); eng.init("moss-tts-nano")
    sent = []
    async def send(obj=None, binary=None): sent.append((obj, binary))
    asyncio.run(eng.generate_stream("hi", 1.0, send, lambda: False, msg_id="m3"))
    kinds = [o.get("type") for o, _ in sent if o]
    assert kinds.count("tts_chunk") == 1
    assert kinds.count("error") == 1
    assert "tts_done" not in kinds


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


def test_h_set_voice_ignores_sid_and_style_fields_falls_to_clone_path():
    """The style-vector and numeric-speaker-id set_voice forms died with the
    ONNX Supertonic/sherpa backends (Task 5's catalog rewire) and their
    renderer senders (Task 6: NativeTtsClient.setSpeaker/setStyleVoice) --
    native_tts has no equivalent for either. A message carrying only a stale
    `sid`/`styleVoice` field (no `voice` name) is no longer special-cased and
    falls through to the clone-from-clip branch like any other name-less
    request."""
    called = {}
    class FakeEng:
        def set_builtin_voice(self, n): called["builtin"] = n
        def set_voice(self, a, sr, ref_text=None): called["clip"] = (len(a), sr, ref_text)
    state = {"tts_engine": FakeEng(), "handlers": {}}
    tts_engine.register(state)
    reply, _ = asyncio.run(state["handlers"]["set_voice"](
        state, {"id": 9, "type": "set_voice", "sid": 5}, None, None))
    assert reply == {"type": "ok", "id": 9}
    assert called == {"clip": (0, 24000, None)}


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


def test_handler_list_tts_voices_runs_off_the_event_loop(monkeypatch):
    # Review round 1, CQ-5: reaches TtsModel.presets(), which takes the same
    # native mutex a synth() in flight holds -- must not block the event loop.
    monkeypatch.setattr("sokuji_sidecar.tts_voices.list_builtin_voices",
                        lambda model=None, engine=None: ["Ava", "Bella"])
    calls = _spy_executor(monkeypatch)
    eng = tts_engine.TtsEngine()
    state = {"tts_engine": eng}; tts_engine.register(state)
    reply, _ = asyncio.run(state["handlers"]["list_tts_voices"](
        state, {"id": 1, "type": "list_tts_voices", "model": "moss-tts-nano"}, None, None))
    assert reply["voices"] == ["Ava", "Bella"]
    assert len(calls) == 1


def test_tts_cancel_matching_active_stream_sets_flag_and_calls_engine_cancel_active():
    """CQ-8: tts_cancel only reaches into the backend (via cancel_active()) when
    the cancelled id IS the connection's currently active stream (conn.ctx's
    'tts_stream_mid', set by _h_tts_generate's streaming branch) -- this is the
    matching case."""
    calls = []
    class FakeEng:
        def cancel_active(self): calls.append(1)
    state = {"tts_engine": FakeEng(), "tts_cancels": {"g4": False}, "handlers": {}}
    tts_engine.register(state)
    conn = _FakeConn()
    conn.ctx["tts_stream_mid"] = "g4"
    reply, _ = asyncio.run(state["handlers"]["tts_cancel"](
        state, {"type": "tts_cancel", "id": "g4"}, None, conn))
    assert reply == {"type": "ok", "id": "g4"}
    assert state["tts_cancels"]["g4"] is True
    assert calls == [1]


def test_tts_cancel_stale_id_sets_flag_but_does_not_call_engine_cancel_active():
    """CQ-8 (the bug this fixes): a cancel for an id that is NOT the
    connection's active stream -- e.g. it already completed, or a newer stream
    has since superseded it -- must not reach into the backend at all.
    Unconditionally calling cancel_active() would stop backend.cancel()'s
    target (tts_backend.py's self._workers[-1], the MOST RECENTLY STARTED
    stream), i.e. whatever IS currently active -- not the stale id the caller
    actually meant. The client-side cancels-dict flag (the relay's own
    should_cancel() poll) is still set unconditionally -- that part was never
    the bug."""
    calls = []
    class FakeEng:
        def cancel_active(self): calls.append(1)
    state = {"tts_engine": FakeEng(), "tts_cancels": {"stale-id": False}, "handlers": {}}
    tts_engine.register(state)
    conn = _FakeConn()
    conn.ctx["tts_stream_mid"] = "current-stream"
    reply, _ = asyncio.run(state["handlers"]["tts_cancel"](
        state, {"type": "tts_cancel", "id": "stale-id"}, None, conn))
    assert reply == {"type": "ok", "id": "stale-id"}
    assert state["tts_cancels"]["stale-id"] is True   # relay flag still set
    assert calls == []                                # backend NOT touched


def test_tts_cancel_without_conn_context_does_not_call_engine_cancel_active():
    """No conn (or no tracked active stream) means there is nothing to confirm
    a match against -- must not guess and reach into the backend."""
    calls = []
    class FakeEng:
        def cancel_active(self): calls.append(1)
    state = {"tts_engine": FakeEng(), "tts_cancels": {"g4": False}, "handlers": {}}
    tts_engine.register(state)
    reply, _ = asyncio.run(state["handlers"]["tts_cancel"](
        state, {"type": "tts_cancel", "id": "g4"}, None, None))
    assert reply == {"type": "ok", "id": "g4"}
    assert state["tts_cancels"]["g4"] is True
    assert calls == []


# ── M2: ownership token -- singleton engine, cross-connection crosstalk ──────

def test_m2_cross_connection_tts_generate_rejected_with_not_owner(monkeypatch):
    """state["tts_engine"] is a process singleton (module docstring) shared by
    every connection -- tts_generate from a connection OTHER than the one that
    called tts_init must be rejected outright, not silently dispatched against
    the owner's loaded model."""
    st = _state(_FakeStream(), monkeypatch, "moss-tts-nano")
    owner_conn = _FakeConn()
    other_conn = _FakeConn()

    async def run():
        await st["handlers"]["tts_init"](st, {"type": "tts_init", "id": 1,
                    "model": "moss-tts-nano"}, None, owner_conn)
        reply, binary = await st["handlers"]["tts_generate"](
            st, {"type": "tts_generate", "id": "intruder", "text": "hi"}, None, other_conn)
        assert binary is None
        assert reply["type"] == "error" and reply["id"] == "intruder"
        assert "not_owner" in reply["message"]
        assert other_conn.ctx == {}                       # nothing dispatched for the intruder
        assert "tts_stream_task" not in owner_conn.ctx     # owner's engine untouched

    asyncio.run(run())


def test_m2_cross_connection_tts_cancel_does_not_touch_owners_stream(monkeypatch):
    """A second connection's tts_cancel for a guessed/replayed id must not reach
    the owner's stream at all -- state["tts_cancels"] is a single dict shared by
    every connection, so even CQ-8's active_mid gate on its own isn't enough (it
    only stops cancel_active(), not the shared dict write the intruder's call
    would otherwise make)."""
    st = _state(_FakeStream(), monkeypatch, "moss-tts-nano")
    owner_conn = _FakeConn()
    other_conn = _FakeConn()

    async def run():
        await st["handlers"]["tts_init"](st, {"type": "tts_init", "id": 1,
                    "model": "moss-tts-nano"}, None, owner_conn)
        reply, _ = await st["handlers"]["tts_generate"](
            st, {"type": "tts_generate", "id": "owner-stream", "text": "hi"}, None, owner_conn)
        assert reply is None   # dispatched as a background task

        cancel_reply, _ = await st["handlers"]["tts_cancel"](
            st, {"type": "tts_cancel", "id": "owner-stream"}, None, other_conn)
        assert cancel_reply["type"] == "error" and "not_owner" in cancel_reply["message"]
        assert st["tts_cancels"]["owner-stream"] is False   # untouched by the intruder

        await owner_conn.ctx["tts_stream_task"]             # owner's stream finishes normally
        kinds = [o.get("type") for o, _ in owner_conn.sent if o]
        assert kinds.count("tts_chunk") == 3 and kinds.count("tts_done") == 1

    asyncio.run(run())


def test_m2_tts_init_from_another_connection_evicts_and_takes_ownership(monkeypatch):
    """tts_init still evicts unconditionally regardless of who calls it (today's
    behavior, unchanged) -- but it now also transfers ownership, so the FORMER
    owner's further tts_generate/tts_cancel calls are rejected while the NEW
    owner's go through normally."""
    b1 = _FakeOneShot()
    st = _state(b1, monkeypatch, "piper-en-amy")
    first_conn = _FakeConn()
    second_conn = _FakeConn()

    async def run():
        await st["handlers"]["tts_init"](st, {"type": "tts_init", "id": 1,
                    "model": "piper-en-amy"}, None, first_conn)

        b2 = _FakeOneShot()
        _patch(monkeypatch, b2, "piper-en-amy")
        await st["handlers"]["tts_init"](st, {"type": "tts_init", "id": 2,
                    "model": "piper-en-amy"}, None, second_conn)
        assert st["tts_engine"]._backend is b2   # evicted, exactly as before M2

        stale_reply, _ = await st["handlers"]["tts_generate"](
            st, {"type": "tts_generate", "id": "stale", "text": "hi"}, None, first_conn)
        assert stale_reply["type"] == "error" and "not_owner" in stale_reply["message"]

        fresh_reply, fresh_binary = await st["handlers"]["tts_generate"](
            st, {"type": "tts_generate", "id": "fresh", "text": "hi"}, None, second_conn)
        assert fresh_reply["type"] == "tts_generate_result"   # the new owner works fine
        assert fresh_binary is not None

    asyncio.run(run())


# ── defect 2: supersede stops the OLD generation, not just its asyncio Task ──

class _FakeTask:
    def __init__(self):
        self.cancel_called = False
        # M3: the supersede path now registers a done-callback on the prior task
        # (see _pop_stale_cancel_flag) -- recorded, not invoked, here; this fake
        # never actually "completes", and the M3 leak scenario itself is covered
        # by a real asyncio.Task below (test_m3_...), not this one.
        self.done_callbacks = []

    def done(self):
        return False

    def cancel(self):
        self.cancel_called = True

    def add_done_callback(self, cb):
        self.done_callbacks.append(cb)


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


def test_m3_supersede_never_scheduled_task_does_not_leak_stale_cancel_flag():
    """M3: a superseded task cancelled BEFORE the event loop ever ran its
    coroutine body closes WITHOUT ever entering _run_tts_stream()'s own
    `finally: cancels.pop(mid, None)` -- cancels[prior_mid] would otherwise
    survive forever (a per-stream dict entry never read again once that mid is
    dead, but never freed either). Reproduced for real, not simulated: two
    tts_generate calls processed back-to-back with NO intervening
    await-that-suspends between them (the streaming branch of _h_tts_generate
    itself never awaits) means asyncio.create_task() has only SCHEDULED the
    first task via call_soon -- the event loop hasn't stepped it even once -- by
    the time the second call's supersede path calls prior.cancel() on it."""
    class _NeverPreemptedEngine:
        streaming = True
        sample_rate = 24000

        def cancel_active(self):
            pass

        async def generate_stream(self, text, speed, send, should_cancel, msg_id):
            await send({"type": "tts_done", "id": msg_id, "totalSamples": 0, "generationTimeMs": 0})

    eng = _NeverPreemptedEngine()
    state = {"tts_engine": eng, "handlers": {}}
    tts_engine.register(state)
    conn = _FakeConn()

    async def run():
        await state["handlers"]["tts_generate"](
            state, {"type": "tts_generate", "id": "prior-id", "text": "a"}, None, conn)
        prior_task = conn.ctx["tts_stream_task"]
        assert not prior_task.done()   # merely scheduled -- never stepped

        await state["handlers"]["tts_generate"](
            state, {"type": "tts_generate", "id": "new-id", "text": "b"}, None, conn)
        new_task = conn.ctx["tts_stream_task"]
        assert new_task is not prior_task

        await new_task                          # let the surviving stream finish
        for _ in range(5):                      # let the cancelled task's own
            await asyncio.sleep(0)              # done-callback run to completion

        assert prior_task.cancelled()
        assert "prior-id" not in state["tts_cancels"]

    asyncio.run(run())


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
            yield np.ones(8000, np.float32), self.sample_rate   # chunk 0 — always produced
            self.before_gate.set()
            self.gate.wait()
            yield np.ones(8000, np.float32), self.sample_rate   # chunk 1 (skipped once cancelled)
            yield np.ones(8000, np.float32), self.sample_rate   # chunk 2 (skipped once cancelled)

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


def test_teardown_cancels_active_generation_before_closing():
    """Review round 1, CQ-4: _tts_teardown must call eng.cancel_active() BEFORE
    eng.close(), so an in-flight generation is signalled to stop as early as
    possible rather than relying solely on close()->backend.unload()'s own
    (also correct, but later) cancel+join."""
    order = []
    class FakeEng:
        def cancel_active(self): order.append("cancel_active")
        def close(self): order.append("close")
    state = {"tts_engine": FakeEng()}
    class FakeConn:
        ctx = {}
    tts_engine._tts_teardown(state, FakeConn())
    assert order == ["cancel_active", "close"]


def test_teardown_close_still_runs_if_cancel_active_raises():
    order = []
    class FakeEng:
        def cancel_active(self): raise RuntimeError("boom")
        def close(self): order.append("close")
    state = {"tts_engine": FakeEng()}
    class FakeConn:
        ctx = {}
    tts_engine._tts_teardown(state, FakeConn())   # must not raise
    assert order == ["close"]


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


# ── M5: generation-token guard against a stale teardown racing a fresher init ─

def test_m5_stale_teardown_after_reinit_does_not_close_the_newer_engine(monkeypatch):
    """eng.init() bumps a generation token BEFORE its own close-on-entry;
    _h_tts_init captures the generation the engine had once ITS init finished
    and threads it into the teardown closure it registers. A teardown captured
    by an EARLIER tts_init, firing (e.g. on disconnect) AFTER a fresher tts_init
    has since re-loaded the engine, must no-op instead of tearing down the
    model the fresher init loaded."""
    b1 = _FakeOneShot()
    st = _state(b1, monkeypatch, "piper-en-amy")
    eng = st["tts_engine"]
    conn = _FakeConn()

    async def run():
        await st["handlers"]["tts_init"](st, {"type": "tts_init", "id": 1,
                    "model": "piper-en-amy"}, None, conn)
        assert len(conn._on_close) == 1
        stale_teardown = conn._on_close[0]        # captured generation 1

        b2 = _FakeOneShot()
        _patch(monkeypatch, b2, "piper-en-amy")
        await st["handlers"]["tts_init"](st, {"type": "tts_init", "id": 2,
                    "model": "piper-en-amy"}, None, conn)   # bumps to generation 2
        assert eng._backend is b2 and b1.is_loaded is False   # b1 evicted normally

        stale_teardown()          # the FIRST tts_init's now-stale close callback fires

        assert eng._backend is b2          # still the CURRENT (second) backend
        assert b2.is_loaded is True        # untouched -- not unloaded by the stale call

    asyncio.run(run())


def test_m5_teardown_without_generation_still_closes_unconditionally():
    """generation=None (every pre-M5 direct call to _tts_teardown, and every
    bare test double with no `.generation`) disables the staleness check
    entirely -- preserves the exact pre-M5 unconditional-close behavior."""
    order = []

    class FakeEng:
        def cancel_active(self): order.append("cancel_active")
        def close(self): order.append("close")

    state = {"tts_engine": FakeEng()}

    class FakeConn:
        ctx = {}

    tts_engine._tts_teardown(state, FakeConn())
    assert order == ["cancel_active", "close"]


# ---------------------------------------------------------------------------
# Live gate (spec rollout row 4, Task 7): TTS -> ASR loopback per audio.cpp
# family. Opt-in via SOKUJI_RUN_TTS_LOOPBACK=1 -- this loads real GGUF models
# (hundreds of MB to ~2GB each) through the installed sokuji_native wheel and
# runs real inference; it has no place in the default `pytest sidecar/tests`
# run. Each family additionally needs its own model directory
# (SK_TEST_TTS_<FAMILY>_DIR -- a directory holding just the family's .gguf;
# audio.cpp materializes everything else, except pocket_tts's embeddings/
# sidecar, from the GGUF's own embedded metadata, native/README.md) and is
# skipped ON ITS OWN, not as a whole-test skip, when that directory is absent
# -- the gate runs against however many of the five are locally downloaded.
#
# qwen3_tts is the ONLY family on the conv_1d_dw compat-shim path
# (native/src/audiocpp_compat.h, ruling R11(s4)); its transcript passing here
# is this repo's only end-to-end proof that shim is correct on a real
# checkpoint, not just exercised by native/tests/test_common's unit case.
_LOOPBACK_TEXT = "The quick brown fox jumps over the lazy dog."
_LOOPBACK_MARKERS = ("quick", "fox")
_LOOPBACK_ASR_GGUF = os.environ.get(
    "SK_TEST_ASR_GGUF", os.path.expanduser("~/.cache/sokuji-native-tests/whisper-tiny-Q8_0.gguf"))


def _loopback_mono(samples) -> np.ndarray:
    x = np.asarray(samples, dtype=np.float32)
    return x.mean(axis=1) if x.ndim == 2 else x.reshape(-1)


def _loopback_transcribe(asr, samples, native_rate: int) -> str:
    mono = _loopback_mono(samples)
    if not mono.size:
        return ""
    target = asr.capabilities.native_sample_rate
    pcm = soxr.resample(mono, native_rate, target).astype(np.float32) if native_rate != target else mono
    return asr.run(pcm)


def _loopback_hit(transcript: str) -> bool:
    low = transcript.lower()
    return any(m in low for m in _LOOPBACK_MARKERS)


def _run_pocket_production_chain(asr):
    """R17(s4) / I1 point 2: ONE full-production-chain leg, unlike the other four
    (direct sn.tts_load() calls straight into the native module -- cheap, and fine
    for gating the native layer, but they skip the ENTIRE download -> HF cache ->
    NativeTtsBackend chain production actually uses). This one goes through the
    real thing: native_models.download() -> model_status() ->
    NativeTtsBackend.load() -> .generate() -- the SAME methods tts_engine.py's
    init()/generate() delegate straight through to (LocalNativeClient.ts ->
    tts_engine.py -> tts_backend.py is the full production call chain). Floor
    chosen: backend-level (NativeTtsBackend.load()/.generate()), not the full
    async TtsEngine/wire event-loop layer on top -- that layer adds asyncio task
    dispatch and WS message framing, none of which touches download, cache
    resolution, or backend.load()/generate() themselves (this fix wave's I2 unit
    -tests the rate-handling piece separately, with fakes, exactly because it
    lives in that layer); wiring it here would add real complexity for no
    additional coverage of what this leg exists to prove.

    pocket-tts-en is the smallest card (122MB gguf + 5.9MB embeddings/
    alba.safetensors) and the ONLY one with extra_files (a same-directory sidecar
    asset sk_tts_presets discovers next to the loaded gguf), so this leg also
    exercises that path.

    Uses a SCRATCH HF cache under ~/.cache/sokuji-native-tests/ (not the shared
    ~/.cache/huggingface) so this gate's download is disposable and neither
    depends on nor pollutes a developer's real HF cache. Redirects
    huggingface_hub.constants.HF_HUB_CACHE directly rather than the HF_HOME env
    var: every download/status/load call in this chain resolves its cache
    directory by reading that module ATTRIBUTE at call time (verified by reading
    _snapshot_download.py's source: `if cache_dir is None: cache_dir =
    constants.HF_HUB_CACHE`), but HF_HUB_CACHE itself is computed from HF_HOME
    only ONCE, at huggingface_hub's own import time -- setting the env var this
    late (huggingface_hub is already imported well before this test runs) would
    silently do nothing.

    Round 2, ruling R18: this leg used to hit a genuine, previously-unknown open
    finding here -- NativeTtsBackend.load()'s snapshot_download() resolves to a
    SYMLINKED file (HF's default snapshot layout on Linux/macOS), which broke
    audio.cpp's own canonicalizing model loader (vendored
    prepare_model_directory()/open_tensor_source(),
    _deps/audiocpp-src/src/framework/assets/tensor_source.cpp -- see
    final-fixwave-report.md's "Round 2: R18" section for the full trace). Fixed by
    hard-link-staging the resolved gguf (+ extra_files) before ever calling
    tts_load() (tts_backend.py's _stage_for_native(), ruling R18); this leg is now
    hard-asserted like the other four, with no exemption."""
    import huggingface_hub.constants as _hfc
    from sokuji_sidecar import backends, catalog, native_models
    from sokuji_sidecar.planner import PlanConfig

    scratch = os.path.expanduser("~/.cache/sokuji-native-tests/hf-scratch-pocket-chain")
    os.makedirs(scratch, exist_ok=True)
    orig_home, orig_cache = _hfc.HF_HOME, _hfc.HF_HUB_CACHE
    _hfc.HF_HOME, _hfc.HF_HUB_CACHE = scratch, os.path.join(scratch, "hub")
    try:
        async def _noop_send(_msg):
            pass

        status = asyncio.run(native_models.download("pocket-tts-en", _noop_send))
        assert status == "ready", f"pocket-tts-en download did not complete: {status}"
        assert native_models.model_status("pocket-tts-en") == "ready", \
            "pocket-tts-en not 'ready' after a completed download"

        card = catalog.tts_model("pocket-tts-en")
        artifact = card.deployments[0].artifact
        b = backends.make_backend("native_tts")
        t0 = time.monotonic()
        # tts_extra_files straight off the catalog card, matching what
        # planner._plan_config() would build in production (this leg calls
        # NativeTtsBackend.load() directly, bypassing the planner, so it must
        # reconstruct the same PlanConfig by hand) -- without it, pocket-tts-en's
        # embeddings/alba.safetensors sidecar never gets staged and set_builtin_voice
        # below fails with "unknown preset 'alba'".
        b.load(artifact, "cpu", "q8_0",
               config=PlanConfig(tts_family="pocket_tts", tts_language="english",
                                 tts_extra_files=card.extra_files))
        try:
            b.set_builtin_voice("alba")
            samples, rate, _gen_ms = b.generate(_LOOPBACK_TEXT)
            elapsed = time.monotonic() - t0
        finally:
            b.unload()
    finally:
        _hfc.HF_HOME, _hfc.HF_HUB_CACHE = orig_home, orig_cache

    transcript = _loopback_transcribe(asr, samples, rate)
    ok = _loopback_hit(transcript)
    seconds = _loopback_mono(samples).shape[0] / rate if rate else 0.0
    return dict(family="pocket_tts (production chain)", seconds=round(seconds, 2),
                synth_s=round(elapsed, 2), transcript=transcript, ok=ok, note="")


# omnivoice's audio-tokenizer RVQ loop used to crash the WHOLE process
# (GGML_ASSERT nb00 == sizeof(src0_t), binary-ops.cpp:59, SIGABRT -- not a
# catchable NativeError) whenever its reference clip was real synthesized
# speech, live-verified independent of clip length (a ~3s and a ~9s clip
# both crashed). Root-caused: audio.cpp hands ggml_sub a non-row-contiguous
# src0 (a bare permute view) that upstream ggml correctly rejects -- the
# fork ggml this model was developed against silently accepted it and
# computed most output elements WRONG instead. Fixed by the ggml_sub
# compat shim in native/src/audiocpp_compat.h (ruling R13; see
# ../../.superpowers/sdd/2026-08-31-sidecar-ggml-only-slice4-tts/
# omnivoice-crash-investigation.md for the full proof). With the shim in
# place omnivoice runs inline below like every other family -- no
# subprocess isolation needed anymore.


@pytest.mark.skipif(
    os.environ.get("SOKUJI_RUN_TTS_LOOPBACK") != "1",
    reason="set SOKUJI_RUN_TTS_LOOPBACK=1 for the live TTS->ASR loopback gate "
           "(also needs SK_TEST_TTS_<FAMILY>_DIR per family and a whisper-tiny "
           "SK_TEST_ASR_GGUF, default ~/.cache/sokuji-native-tests/whisper-tiny-Q8_0.gguf)",
)
def test_tts_asr_loopback_per_family():
    if not os.path.exists(_LOOPBACK_ASR_GGUF):
        pytest.skip(f"no whisper ASR model at {_LOOPBACK_ASR_GGUF}")
    sn = native.module()
    asr = sn.asr_load(_LOOPBACK_ASR_GGUF)

    results = []      # attempted (model directory present) families
    skipped = []       # families with no local model
    supertonic_ref = None    # (pcm, rate, text) synthesized once, reused as qwen3_tts's/omnivoice's clone reference

    def family_dir(env_name):
        d = os.environ.get(env_name)
        return d if d and os.path.isdir(d) else None

    def attempt(family, model_dir, setup, note="", language="en"):
        t0 = time.monotonic()
        model = sn.tts_load(model_dir, family)
        try:
            setup(model)
            samples, rate = model.synth(_LOOPBACK_TEXT, language=language)
            elapsed = time.monotonic() - t0
            transcript = _loopback_transcribe(asr, samples, rate)
            ok = _loopback_hit(transcript)
            # moss_tts_nano used to need an 8s-retry fallback here: greedy decode
            # (ruling R10(s4)) never emitted end-of-content and ran to its
            # ~24s/300-frame cap with a degenerate tail after the real speech,
            # which diluted the full-buffer transcript enough to miss the marker
            # words. Ruling R23 (.superpowers/moss-eoc-verdict.md,
            # native/src/sk_tts.cpp's `sample_decode` family flag) switched
            # moss_tts_nano to sampled decode, which reaches real end-of-content
            # in a couple of seconds instead -- live-verified here across two
            # consecutive full loopback runs: both produced a 2.56s clip whose
            # FULL-BUFFER transcript already contains both marker words ("Quick
            # Brown Fox jumps over the lazy dog."), with the retry path never
            # triggering. The fallback is removed rather than kept dormant: a
            # model that still needed it would now fail this leg outright,
            # which is the correct signal (the loopback's job is to catch a
            # runaway, not paper over one).
            seconds = _loopback_mono(samples).shape[0] / rate if rate else 0.0
            results.append(dict(family=family, seconds=round(seconds, 2), synth_s=round(elapsed, 2),
                                 transcript=transcript, ok=ok, note=note))
            return samples, rate
        finally:
            model.unload()

    # moss_tts_nano: offline, clones (but a default built-in voice covers a
    # plain synth call -- native/tests/test_tts.cpp's own moss case synths
    # before ever calling set_voice), no presets.
    moss_dir = family_dir("SK_TEST_TTS_MOSS_DIR")
    if moss_dir:
        attempt("moss_tts_nano", moss_dir, lambda m: None)
    else:
        skipped.append("moss_tts_nano")

    # supertonic: streaming, named presets, no cloning.
    supertonic_dir = family_dir("SK_TEST_TTS_SUPERTONIC_DIR")
    if supertonic_dir:
        attempt("supertonic", supertonic_dir, lambda m: m.set_preset("M1"))
        # Also synthesize the reference clip qwen3_tts/omnivoice clone below.
        # Dedicated, longer sentence than _LOOPBACK_TEXT so the clone
        # reference encoders have a few real seconds of speech to copy.
        # (A previous revision of this comment blamed omnivoice's crash on
        # this clip being below the renderer's MIN_CLIP_SECONDS=3 -- that was
        # wrong; the crash was a graph-shape defect in audio.cpp's RVQ loop,
        # reproduced independent of clip length, and is fixed by the
        # ggml_sub compat shim -- see the header comment above.)
        ref_model = sn.tts_load(supertonic_dir, "supertonic")
        ref_model.set_preset("M1")
        ref_text = ("This short recording exists only to give the voice-cloning models a "
                    "few seconds of real speech to copy, so it needs to run long enough "
                    "for their reference encoders to work with.")
        try:
            ref_samples, ref_rate = ref_model.synth(ref_text, language="en")
            supertonic_ref = (ref_samples, ref_rate, ref_text)
        finally:
            ref_model.unload()
    else:
        skipped.append("supertonic")

    # qwen3_tts: offline, clones, no presets. UNLIKE moss/pocket, the base
    # checkpoint has NO default built-in voice -- a plain synth() fails
    # (live-verified: "Qwen3 base TTS requires voice clone reference audio"),
    # and its ICL clone mode separately requires ref_text one level deeper,
    # inside audio.cpp's own synth call (live-verified: "Qwen3 voice clone ICL
    # mode requires reference text") -- this is now ALSO enforced up front by
    # sk_tts_set_voice itself (ruling R15(s4): transcript_required=true for
    # this family). So it clones the same supertonic-synthesized reference
    # omnivoice uses below, WITH that reference's text -- the transcripted
    # clone is the documented production requirement, not a test-only
    # workaround. This is the conv_1d_dw compat-shim proof (see file header).
    #
    # language="en" (the SAME ISO code every other family gets, via attempt()'s
    # default) -- NOT the hand-picked "auto" this leg used before ruling R14(s4)
    # landed. Before R14, qwen3_tts's talker rejected ISO codes outright
    # ("Qwen3 talker unsupported language: en") because it resolves `language`
    # against a per-checkpoint codec_language_id table keyed by full language
    # NAMES baked into the GGUF's own metadata, not ISO codes -- "auto" is a
    # dedicated sentinel (qwen3_tts/talker.cpp) that skips that lookup entirely,
    # and production (LocalNativeClient.ts -> tts_engine.py -> tts_backend.py)
    # always sends an ISO code, never "auto" (C1's production-path mismatch).
    # R14 now maps ANY incoming language to "auto" internally, in
    # native/src/sk_tts.cpp's build_request(), so this leg passing "en" like
    # every other family IS what now reaches the talker as "auto" -- this is
    # C1's permanent regression gate: a real checkpoint, on real hardware,
    # synthesizing correctly from the SAME language argument production sends.
    qwen3_dir = family_dir("SK_TEST_TTS_QWEN3_DIR")
    if qwen3_dir and supertonic_ref:
        ref_samples, ref_rate, ref_text = supertonic_ref
        attempt("qwen3_tts", qwen3_dir, lambda m: m.set_voice(_loopback_mono(ref_samples), ref_rate, ref_text))
    else:
        skipped.append("qwen3_tts" if qwen3_dir else "qwen3_tts (needs supertonic for a reference clip)")

    # omnivoice: streaming, clone-only, transcript_required -- a sine wave is
    # not a usable speech reference here, so it clones the same longer
    # supertonic-synthesized reference qwen3_tts uses above (a real voice,
    # with its exact text as ref_text). Used to crash the whole process on
    # exactly this path (ggml_sub non-contiguous src0, see the header
    # comment above); fixed by the ggml_sub compat shim (ruling R13), so it
    # now runs inline like every other family, no subprocess isolation
    # needed.
    omnivoice_dir = family_dir("SK_TEST_TTS_OMNIVOICE_DIR")
    if omnivoice_dir and supertonic_ref:
        ref_samples, ref_rate, ref_text = supertonic_ref
        attempt("omnivoice", omnivoice_dir,
                lambda m: m.set_voice(_loopback_mono(ref_samples), ref_rate, ref_text))
    else:
        skipped.append("omnivoice" if omnivoice_dir else "omnivoice (needs supertonic for a reference clip)")

    # pocket_tts (English package): the ONE full-production-chain leg (ruling
    # R17(s4) / I1 point 2; the symlinked-snapshot loading defect it surfaced is
    # fixed by ruling R18's hard-link staging) -- see
    # _run_pocket_production_chain's docstring. Independent of the
    # SK_TEST_TTS_<FAMILY>_DIR env vars above: this leg downloads its own copy
    # into a dedicated scratch HF cache, so it always runs (given network
    # access) regardless of which of the other four are locally pre-downloaded.
    results.append(_run_pocket_production_chain(asr))

    print("\n--- TTS -> ASR loopback ---")
    for r in results:
        print(f"  {r['family']:16s} ok={r['ok']!s:5} {r['seconds']:6.2f}s audio  "
              f"{r['synth_s']:7.2f}s synth  transcript={r['transcript']!r}"
              + (f"  note={r['note']}" if r["note"] else ""))
    for s in skipped:
        print(f"  {s:16s} SKIPPED (no local model)")

    assert results, "no TTS family had a locally-downloaded model -- nothing to gate"
    # Every attempted family is hard-asserted here, no exemptions: omnivoice's
    # former crash (ggml_sub non-contiguous src0, ruling R13) and the
    # production-chain leg's former open finding (symlinked-snapshot loading,
    # ruling R18) are both fixed now.
    failures = [r for r in results if not r["ok"]]
    assert not failures, f"missed marker words for: {[r['family'] for r in failures]} -- {failures}"
