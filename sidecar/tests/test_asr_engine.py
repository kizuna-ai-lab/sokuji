import asyncio, json, os, wave
import numpy as np
import pytest
from sokuji_sidecar import server, asr_engine


class _FakeWS:
    def __init__(self):
        self.sent = []

    async def send(self, d):
        self.sent.append(d)


class FakeAsr:
    def __init__(self):
        self.marks = []

    def init(self, model_id=None, language="", sample_rate=24000, device="auto", **kw):
        self.sample_rate = sample_rate
        return 33

    def feed(self, int16_bytes):
        return []

    def mark(self, event):
        self.marks.append(event)
        if event == "end":
            return [{"type": "result", "text": "hello", "startSample": 0,
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


def test_asr_init_ignores_stale_vad_params():
    """A stale client may still send the three vad* fields; init must not crash
    and must not try to forward them anywhere."""
    st, conn = make()
    reply, _ = asyncio.run(server.handle_message(st, json.dumps({
        "type": "asr_init", "id": 1, "model": "sense-voice",
        "vadThreshold": 0.3, "vadMinSilenceDuration": 1.4, "vadMinSpeechDuration": 0.4,
    }), None, conn))
    assert reply["type"] == "ready"


def test_vad_mark_routes_to_engine_and_pushes_results():
    st, conn = make()
    asyncio.run(server.handle_message(st, json.dumps({"type": "asr_init", "id": 1}), None, conn))
    reply, _ = asyncio.run(server.handle_message(
        st, json.dumps({"type": "vad_mark", "event": "start"}), None, conn))
    assert reply is None                       # fire-and-forget: no reply at all
    reply, _ = asyncio.run(server.handle_message(
        st, json.dumps({"type": "vad_mark", "event": "end"}), None, conn))
    assert reply is None
    assert st["asr_engine"].marks == ["start", "end"]
    assert any('"hello"' in s for s in conn._ws.sent)   # the end-mark's result was pushed


def test_asr_flush_drains():
    st, conn = make()
    asyncio.run(server.handle_message(st, json.dumps({"type": "asr_init", "id": 1}), None, conn))
    reply, _ = asyncio.run(server.handle_message(
        st, json.dumps({"type": "asr_flush", "id": 2}), None, conn))
    assert reply == {"type": "ok", "id": 2}
    assert any('"tail"' in s for s in conn._ws.sent)


def test_downsample_empty_bytes_returns_empty_float32():
    """Empty input must return an empty float32 array and must NOT raise."""
    from sokuji_sidecar.asr_engine import _downsample_int16_to_f32_16k
    out = _downsample_int16_to_f32_16k(b"")
    assert out.dtype == np.float32 and len(out) == 0


def test_downsample_empty_bytes_with_non_default_rate():
    from sokuji_sidecar.asr_engine import _downsample_int16_to_f32_16k
    out = _downsample_int16_to_f32_16k(b"", src_rate=48000)
    assert out.dtype == np.float32 and len(out) == 0


def _offline_engine():
    """An AsrEngine in offline mode with a fake backend — no native lib, no model."""
    eng = asr_engine.AsrEngine()
    eng._src_rate = 16000
    eng._backend = _EchoBackend()
    return eng


class _EchoBackend:
    def __init__(self):
        self.calls = []          # the sample arrays transcribe() saw

    def transcribe(self, samples, language):
        from sokuji_sidecar.backends import AsrResult
        self.calls.append(np.asarray(samples))
        return AsrResult("seg-text")


def test_offline_segment_buffered_between_marks_and_transcribed_on_end():
    eng = _offline_engine()
    assert eng.feed(np.zeros(1600, np.int16).tobytes()) == []   # silence: no events ever
    assert eng.mark("start") == []
    eng.feed((np.ones(1600, np.int16) * 1000).tobytes())
    out = eng.mark("end")
    assert [m["type"] for m in out] == ["result"]
    assert out[0]["text"] == "seg-text"
    # the segment contains the fed speech plus the pre-roll ring (the earlier silence)
    assert len(eng._backend.calls) == 1
    assert len(eng._backend.calls[0]) >= 1600


def test_offline_preroll_ring_seeds_the_segment_and_is_capped():
    eng = _offline_engine()
    # feed 2s of pre-speech audio; ring must cap at 0.7s (11200 samples @16k)
    for _ in range(20):
        eng.feed(np.ones(1600, np.int16).tobytes())
    eng.mark("start")
    eng.mark("end")
    (seg,) = eng._backend.calls
    # The ring pops whole chunks: after capping it holds >= RING_SAMPLES and
    # < RING_SAMPLES + one chunk (1600 here).
    assert asr_engine.RING_SAMPLES <= len(seg) <= asr_engine.RING_SAMPLES + 1600


def test_offline_cancel_drops_the_segment():
    eng = _offline_engine()
    eng.mark("start")
    eng.feed(np.ones(1600, np.int16).tobytes())
    assert eng.mark("cancel") == []
    assert eng.mark("end") == []                # nothing left to transcribe
    assert eng._backend.calls == []


def test_offline_end_without_start_is_a_noop():
    eng = _offline_engine()
    assert eng.mark("end") == []
    assert eng._backend.calls == []


def test_offline_flush_finalizes_open_segment():
    eng = _offline_engine()
    eng.mark("start")
    eng.feed(np.ones(1600, np.int16).tobytes())
    out = eng.flush()
    assert [m["type"] for m in out] == ["result"]
    assert eng.flush() == []                    # idempotent once closed


def test_offline_ring_cleared_after_end_no_tail_duplication():
    eng = _offline_engine()
    eng.mark("start")
    eng.feed(np.ones(1600, np.int16).tobytes())
    eng.mark("end")
    eng.mark("start")                           # immediate restart
    eng.mark("end")
    assert len(eng._backend.calls) == 1         # second segment was empty -> no transcribe


def test_offline_backstop_cuts_a_runaway_segment():
    eng = _offline_engine()
    eng.mark("start")
    out = []
    chunk = np.ones(16000, np.int16).tobytes()  # 1s @16k src rate
    for _ in range(31):
        out += eng.feed(chunk)
    assert [m["type"] for m in out] == ["result"]   # the 30s backstop fired once
    out2 = eng.mark("end")                          # remainder still transcribes
    assert [m["type"] for m in out2] == ["result"]


@pytest.mark.skipif(not os.environ.get("SOKUJI_RUN_ASR_MODEL"),
                    reason="set SOKUJI_RUN_ASR_MODEL=1 (downloads model + test wav)")
def test_real_engine_transcribes_test_wav():
    from huggingface_hub import snapshot_download
    d = snapshot_download("csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17")
    w = wave.open(f"{d}/test_wavs/en.wav", "rb")
    pcm16k = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16)
    ratio = 24000 / 16000
    n = round(len(pcm16k) * ratio)
    pos = np.arange(n) / ratio
    i0 = np.clip(np.floor(pos).astype(np.int64), 0, len(pcm16k) - 1)
    pcm24k = pcm16k[i0].astype(np.int16)

    eng = asr_engine.AsrEngine()
    eng.init()
    results = []
    results += [m["text"] for m in eng.mark("start") if m["type"] == "result"]
    for i in range(0, len(pcm24k), 4096):
        for m in eng.feed(pcm24k[i:i + 4096].tobytes()):
            if m["type"] == "result":
                results.append(m["text"])
    for m in eng.mark("end"):
        if m["type"] == "result":
            results.append(m["text"])
    text = " ".join(results).lower()
    assert "gold" in text or "tribal" in text, f"unexpected transcript: {results!r}"


class _FakeBackend:
    def transcribe(self, samples, language):
        from sokuji_sidecar.backends import AsrResult
        return AsrResult("resolved-text")


def test_engine_init_uses_resolver(monkeypatch):
    from sokuji_sidecar import asr_engine as ae, accel
    eng = ae.AsrEngine()
    fake_plan = accel.Plan("ctranslate2", "cpu", "cpu", "int8", "tiny", 1.0)
    monkeypatch.setattr(accel, "resolve", lambda model_id, override="auto", **kw: [fake_plan])
    monkeypatch.setattr(accel, "load_measured", lambda plans, **kw: (_FakeBackend(), fake_plan, None, None))
    monkeypatch.setattr(accel, "measure_rtf", lambda *a, **k: None)
    ms = eng.init(model_id="whisper-base", language="en", device="auto")
    assert isinstance(ms, int)
    assert eng.resolved == {"backend": "ctranslate2", "device": "cpu", "computeType": "int8"}
    # _cut uses the resolved backend's transcribe().text
    assert eng._backend.transcribe(np.zeros(4, np.float32), "en").text == "resolved-text"


class _ResolvedAsr(FakeAsr):
    def init(self, *a, **k):
        ms = super().init(*a, **k)
        self.resolved = {"backend": "ctranslate2", "device": "vulkan", "computeType": "float16"}
        return ms


def test_ready_includes_resolved_plan_when_present():
    st = {"asr_engine": _ResolvedAsr(), "handlers": {}}
    asr_engine.register(st)
    conn = server.Conn(_FakeWS())
    reply, _ = asyncio.run(server.handle_message(
        st, json.dumps({"type": "asr_init", "id": 1}), None, conn))
    assert reply["backend"] == "ctranslate2"
    assert reply["device"] == "vulkan" and reply["computeType"] == "float16"


def test_ready_unchanged_when_engine_has_no_resolved():
    # The plain FakeAsr (no `resolved`) must still get the minimal ready shape.
    st, conn = make()
    reply, _ = asyncio.run(server.handle_message(
        st, json.dumps({"type": "asr_init", "id": 2}), None, conn))
    assert reply == {"type": "ready", "id": 2, "loadTimeMs": 33}


def test_engine_init_measures_and_stores_rtf(monkeypatch):
    from sokuji_sidecar import asr_engine as ae, accel
    eng = ae.AsrEngine()
    fake_plan = accel.Plan("ctranslate2", "gpu-vulkan", "vulkan", "float16", "tiny", 1.0)
    monkeypatch.setattr(accel, "resolve", lambda model_id, override="auto", **kw: [fake_plan])
    monkeypatch.setattr(accel, "load_measured", lambda plans, **kw: (_FakeBackend(), fake_plan, None, None))
    monkeypatch.setattr(accel, "measure_rtf", lambda *a, **k: 0.25)
    eng.init(model_id="whisper-base", language="en", device="auto")
    assert eng.resolved["device"] == "vulkan"
    assert eng.resolved["rtf"] == 0.25


def test_engine_init_omits_rtf_when_benchmark_returns_none(monkeypatch):
    from sokuji_sidecar import asr_engine as ae, accel
    eng = ae.AsrEngine()
    fake_plan = accel.Plan("ctranslate2", "cpu", "cpu", "int8", "tiny", 1.0)
    monkeypatch.setattr(accel, "resolve", lambda model_id, override="auto", **kw: [fake_plan])
    monkeypatch.setattr(accel, "load_measured", lambda plans, **kw: (_FakeBackend(), fake_plan, None, None))
    monkeypatch.setattr(accel, "measure_rtf", lambda *a, **k: None)  # benchmark failed
    eng.init(model_id="whisper-base", device="auto")
    assert "rtf" not in eng.resolved


@pytest.mark.skipif(not os.environ.get("SOKUJI_RUN_FW_MODEL"),
                    reason="set SOKUJI_RUN_FW_MODEL=1 (downloads the whisper-base GGUF)")
def test_real_whisper_base_transcribes():
    from huggingface_hub import snapshot_download
    d = snapshot_download("csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17")
    w = wave.open(f"{d}/test_wavs/en.wav", "rb")
    pcm16k = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16)
    ratio = 24000 / 16000
    n = round(len(pcm16k) * ratio)
    i0 = np.clip(np.floor(np.arange(n) / ratio).astype(np.int64), 0, len(pcm16k) - 1)
    pcm24k = pcm16k[i0].astype(np.int16)
    eng = asr_engine.AsrEngine()
    eng.init(model_id="whisper-base", language="en")
    results = []
    for i in range(0, len(pcm24k), 4096):
        results += [m["text"] for m in eng.feed(pcm24k[i:i + 4096].tobytes()) if m["type"] == "result"]
    results += [m["text"] for m in eng.flush() if m["type"] == "result"]
    text = " ".join(results).lower()
    assert "gold" in text or "tribal" in text, f"unexpected transcript: {results!r}"


class _UnloadBackend:
    def __init__(self):
        self.unloaded = False

    def transcribe(self, samples, language):
        from sokuji_sidecar.backends import AsrResult
        return AsrResult("x")

    def unload(self):
        self.unloaded = True


def test_engine_frees_old_model_on_reinit_and_close(monkeypatch):
    # VRAM-leak regression: the singleton engine must unload the previous backend before
    # loading the next (no pileup), and close() must free the current one.
    from sokuji_sidecar import asr_engine as ae, accel
    eng = ae.AsrEngine()
    fake_plan = accel.Plan("ctranslate2", "cpu", "cpu", "int8", "tiny", 1.0)
    backends = []

    def fake_load(plans, **kw):
        b = _UnloadBackend()
        backends.append(b)
        return b, fake_plan, None, None

    monkeypatch.setattr(accel, "resolve", lambda model_id, override="auto", **kw: [fake_plan])
    monkeypatch.setattr(accel, "load_measured", fake_load)
    monkeypatch.setattr(accel, "measure_rtf", lambda *a, **k: None)

    eng.init(model_id="whisper-base")
    assert len(backends) == 1 and backends[0].unloaded is False
    eng.init(model_id="whisper-base")                 # re-init frees the first
    assert backends[0].unloaded is True
    assert len(backends) == 2 and backends[1].unloaded is False
    eng.close()                                       # close frees the current
    assert backends[1].unloaded is True
    assert eng._backend is None


def test_offline_init_stores_memory_and_fallback_reason(monkeypatch):
    from sokuji_sidecar import accel, asr_engine
    fake_plan = type("P", (), {"backend": "ctranslate2", "device": "cpu", "compute_type": "int8"})()
    monkeypatch.setattr(accel, "resolve", lambda mid, override=None, **kw: ["plan"])
    monkeypatch.setattr(accel, "load_measured",
                        lambda plans, **kw: (_FakeBackend(), fake_plan, "vulkan skipped; using CPU", 4_200_000_000))
    monkeypatch.setattr(accel, "measure_rtf", lambda *a, **k: None)
    eng = asr_engine.AsrEngine()
    eng.init("sense-voice", "en", 16000, "auto")
    assert eng.resolved["memoryBytes"] == 4_200_000_000
    assert "using CPU" in eng.resolved["fallbackReason"]


def test_streaming_init_sets_resolved_device_and_memory(monkeypatch):
    from sokuji_sidecar import asr_engine
    eng = asr_engine.AsrEngine()
    backend = type("B", (), {"STREAMING": True, "open_stream": lambda self, language=None: object(),
                             "unload": lambda self: None})()
    fake_plan = type("P", (), {"backend": "voxtral_realtime", "device": "vulkan", "compute_type": "bfloat16"})()
    monkeypatch.setattr(eng, "_resolve_streaming_backend",
                        lambda model, device, *a, **kw: (backend, fake_plan, None, 8_000_000_000))
    eng.init_streaming(model_id="voxtral-mini-4b-realtime", language="en", device="auto")
    assert eng.resolved["device"] == "vulkan"
    assert eng.resolved["memoryBytes"] == 8_000_000_000


def test_conn_close_frees_asr_model():
    # A session connection (asr_init registers its cleanup) closing must trigger
    # engine.close() in _conn's finally, releasing the model from VRAM on stop.
    closed = {"n": 0}

    class Eng:
        def init(self, *a, **k):
            return 1

        def feed(self, b):
            return []

        def close(self):
            closed["n"] += 1

    st = {"asr_engine": Eng(), "handlers": {}}
    asr_engine.register(st)

    class WS:
        def __init__(self):
            self._msgs = [json.dumps({"type": "asr_init", "id": 1, "model": "m"})]

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


def test_conn_close_frees_streaming_asr_model():
    # Same contract as test_conn_close_frees_asr_model above, but for the STREAMING
    # branch of _h_asr_init (asr_engine.py:565-572). That branch registers its own
    # on_close callback independently of the offline branch, so it needs its own net:
    # a fake with resolves_to_streaming() -> True drives _conn through the streaming
    # path, which is the only one that creates conn.ctx["stream_task"]. Losing the
    # registration there leaks both a live asyncio task (still running run_stream
    # against a dead connection) and the model's VRAM.
    closed = {"n": 0}
    task_holder = {}

    class Eng:
        def resolves_to_streaming(self, model_id, device, pin=None):
            return True

        def init_streaming(self, model_id=None, language="", sample_rate=None,
                           device="auto", pin=None):
            return 5

        def feed_stream(self, b):
            return []

        async def run_stream(self, send):
            task_holder["task"] = asyncio.current_task()
            await asyncio.sleep(3600)   # never returns on its own; must be cancelled by teardown

        def close(self):
            closed["n"] += 1

    st = {"asr_engine": Eng(), "handlers": {}}
    asr_engine.register(st)

    class WS:
        def __init__(self):
            self._msgs = [json.dumps({"type": "asr_init", "id": 1,
                                       "model": "voxtral-mini-4b-realtime", "device": "vulkan"})]

        def __aiter__(self):
            return self

        async def __anext__(self):
            if self._msgs:
                return self._msgs.pop(0)
            await asyncio.sleep(0)   # let the just-created stream_task start running
            raise StopAsyncIteration

        async def send(self, d):
            pass

    async def scenario():
        await server._conn(st, WS())
        await asyncio.sleep(0)   # let the cancelled task process its CancelledError

    asyncio.run(scenario())
    assert closed["n"] == 1
    assert task_holder["task"].cancelled() is True


def test_close_aborts_open_streaming_session():
    """A mid-utterance close() must end the open stream (not leak its threads)."""
    from sokuji_sidecar.asr_engine import AsrEngine
    import queue as _q
    eng = AsrEngine()
    aborted = {"called": False}
    class _S:
        def abort(self): aborted["called"] = True
        def end(self): return ""
    eng._stream = _S()
    eng._audio_q = _q.Queue()
    eng._backend = type("B", (), {"unload": lambda self: None})()
    eng.close()
    assert aborted["called"] is True          # the open stream was ended
    assert eng._stream is None
    assert eng._audio_q.get_nowait() is None   # run_stream gets the stop sentinel


from sokuji_sidecar.asr_engine import AsrEngine


class _FakeStream:
    """Scripted stream session: drain() returns queued deltas, end() returns the join."""
    def __init__(self):
        self.fed = 0
        self._pending = ["he", "llo "]
        self.ended = False
        self.aborted_called = False
    def feed(self, samples):
        self.fed += len(samples)
    def drain(self):
        out, self._pending = self._pending, []
        return out
    def end(self):
        self.ended = True
        return "hello world"
    def abort(self):
        self.aborted_called = True


def _streaming_engine(monkeypatch, fake_stream):
    """Build an AsrEngine whose resolved backend is streaming. Marks (start/end/cancel)
    are enqueued directly via mark()/feed_stream() and driven with _drive_once — no VAD
    to script, the client owns segmentation."""
    eng = AsrEngine()
    backend = type("B", (), {"STREAMING": True, "open_stream": lambda self, language=None: fake_stream,
                             "unload": lambda self: None})()
    # bypass real resolve: inject the backend
    fake_plan = type("P", (), {"backend": "voxtral_realtime",
                               "device": "vulkan", "compute_type": "bfloat16"})()
    monkeypatch.setattr(eng, "_resolve_streaming_backend",
                        lambda model, device, *a, **kw: (backend, fake_plan, None, None))
    return eng


def test_feed_stream_returns_iterable_for_conn_loop():
    import queue
    eng = AsrEngine()
    eng._audio_q = queue.Queue()
    out = eng.feed_stream(b"\x00\x00\x01\x00")
    assert list(out) == []                 # _conn's `for out in feeder(data)` is safe
    assert eng._audio_q.qsize() == 1       # audio was enqueued for the streaming task


def test_streaming_emits_partials_and_result_per_utterance(monkeypatch):
    fs = _FakeStream()
    eng = _streaming_engine(monkeypatch, fs)
    sent = []
    async def send(msg): sent.append(msg)
    eng.init_streaming(model_id="voxtral-mini-4b-realtime", language="en", device="vulkan")
    eng._mode = "per_utterance"
    eng.mark("start")
    eng.feed_stream(np.zeros(16000, np.int16).tobytes())
    eng.mark("end")
    asyncio.run(eng._drive_once(send))
    types_seen = [m["type"] for m in sent]
    assert "partial" in types_seen
    assert types_seen[-1] == "result"
    assert sent[-1]["text"] == "hello world"
    assert fs.ended is True
    assert "speech_start" not in types_seen     # the engine never sends speech_start


def test_gated_cancel_aborts_without_result(monkeypatch):
    fs = _FakeStream()
    eng = _streaming_engine(monkeypatch, fs)
    sent = []
    async def send(msg): sent.append(msg)
    eng.init_streaming(model_id="voxtral-mini-4b-realtime", language="en", device="vulkan")
    eng._mode = "per_utterance"
    eng.mark("start")
    eng.feed_stream(np.zeros(1600, np.int16).tobytes())
    eng.mark("cancel")
    asyncio.run(eng._drive_once(send))
    assert [m for m in sent if m["type"] == "result"] == []
    assert fs.aborted_called is True            # add a flag to _FakeStream if absent
    assert eng._stream is None


def test_always_stream_cancel_does_not_cut(monkeypatch):
    # cancel clears _in_speech but never end()s the stream
    import asyncio
    from sokuji_sidecar.asr_engine import AsrEngine
    opened = {"n": 0}

    class _FakeStream:
        def feed(self, s): pass
        def drain(self): return []
        def end(self): return "should not be called"
        def abort(self): pass

    eng = AsrEngine()
    eng._mode = "always_stream"; eng._src_rate = 16000
    eng._stream = _FakeStream()
    eng._backend = type("B", (), {"open_stream": lambda self, language=None: (opened.__setitem__("n", opened["n"] + 1) or _FakeStream())})()
    eng._pending = "some words"
    eng._sample_cursor = 0; eng._utt_start_sample = 0
    eng._streaming = True
    eng._in_speech = True
    import queue as _q; eng._audio_q = _q.Queue()
    eng._speech_samples = 8000
    eng.feed_stream(b"\x00\x00" * 1600)
    eng.mark("cancel")

    sent = []
    async def send(m): sent.append(m)
    asyncio.run(eng._drive_once(send))
    assert not [m for m in sent if m["type"] == "result"]   # no cut on cancel
    assert opened["n"] == 0                                  # stream NOT reopened
    assert eng._in_speech is False
    assert eng._speech_samples == 0   # cancelled stretch must not feed the run-on cap
                                       # or keep the shutdown flush condition alive


def test_always_stream_cuts_on_endpoint_with_complete_tail(monkeypatch):
    import asyncio
    from sokuji_sidecar.asr_engine import AsrEngine
    opened = {"n": 0}

    class _FakeStream:
        def feed(self, s): pass
        def drain(self): return []
        def end(self): return "country can do for you. do for your country."   # COMPLETE (tail incl.)
        def abort(self): pass

    eng = AsrEngine()
    eng._mode = "always_stream"; eng._src_rate = 16000
    eng._stream = _FakeStream()
    eng._backend = type("B", (), {"open_stream": lambda self, language=None: (opened.__setitem__("n", opened["n"] + 1) or _FakeStream())})()
    eng._pending = "country can do for you."          # partial: the tail is MISSING here
    eng._sample_cursor = 0; eng._utt_start_sample = 0
    eng._streaming = True
    eng._in_speech = True
    import queue as _q; eng._audio_q = _q.Queue()
    eng._speech_samples = 8000   # real utterance (speech seen)
    eng.feed_stream(b"\x00\x00" * 1600)
    eng.mark("end")

    sent = []
    async def send(m): sent.append(m)
    asyncio.run(eng._drive_once(send))
    results = [m for m in sent if m["type"] == "result"]
    assert results and "do for your country." in results[-1]["text"]   # the held tail is in the final
    assert opened["n"] == 1                                            # reopened
    assert eng._pending == ""


def test_always_stream_endpoint_with_no_text_does_not_cut(monkeypatch):
    import asyncio
    from sokuji_sidecar.asr_engine import AsrEngine
    opened = {"n": 0}

    class _FakeStream:
        def feed(self, s): pass
        def drain(self): return []
        def end(self): return ""
        def abort(self): pass

    eng = AsrEngine()
    eng._mode = "always_stream"; eng._src_rate = 16000
    eng._stream = _FakeStream()
    eng._backend = type("B", (), {"open_stream": lambda self, language=None: (opened.__setitem__("n", opened["n"] + 1) or _FakeStream())})()
    eng._pending = ""                                  # nothing transcribed
    eng._sample_cursor = 0; eng._utt_start_sample = 0
    eng._streaming = True
    eng._in_speech = False
    import queue as _q; eng._audio_q = _q.Queue()
    eng._speech_samples = 0
    eng.mark("end")

    sent = []
    async def send(m): sent.append(m)
    asyncio.run(eng._drive_once(send))
    assert not [m for m in sent if m["type"] == "result"]   # no speech this stream: no cut
    assert opened["n"] == 0


def test_always_stream_endpoint_flushes_held_text_with_empty_pending(monkeypatch):
    # A short utterance whose text the model still HOLDS (so _pending is empty at the end
    # mark) must still cut + end()-flush. Gating on speech, not on _pending text — otherwise
    # short commands / slow-first-token utterances get dropped or merged into the next one.
    import asyncio
    from sokuji_sidecar.asr_engine import AsrEngine
    opened = {"n": 0}

    class _FakeStream:
        def feed(self, s): pass
        def drain(self): return []                       # nothing emitted yet (text held by the model)
        def end(self): return "ok"                       # end() flushes the held short utterance
        def abort(self): pass

    eng = AsrEngine()
    eng._mode = "always_stream"; eng._src_rate = 16000
    eng._stream = _FakeStream()
    eng._backend = type("B", (), {"open_stream": lambda self, language=None: (opened.__setitem__("n", opened["n"] + 1) or _FakeStream())})()
    eng._pending = ""                                    # held text not yet drained
    eng._sample_cursor = 0; eng._utt_start_sample = 0
    eng._streaming = True
    eng._in_speech = True
    import queue as _q; eng._audio_q = _q.Queue()
    eng._speech_samples = 8000                           # ~0.5s of speech happened in prior buffers
    eng.feed_stream(b"\x00\x00" * 1600)
    eng.mark("end")

    sent = []
    async def send(m): sent.append(m)
    asyncio.run(eng._drive_once(send))
    results = [m for m in sent if m["type"] == "result"]
    assert results and results[-1]["text"] == "ok"       # end() flushed the held utterance
    assert opened["n"] == 1                              # reopened


def test_always_stream_runon_cap_forces_cut(monkeypatch):
    import asyncio
    from sokuji_sidecar.asr_engine import AsrEngine
    opened = {"n": 0}

    class _FakeStream:
        def feed(self, s): pass
        def drain(self): return []
        def end(self): return "a very long run on utterance"
        def abort(self): pass

    eng = AsrEngine()
    eng._mode = "always_stream"; eng._src_rate = 16000
    eng._stream = _FakeStream()
    eng._backend = type("B", (), {"open_stream": lambda self, language=None: (opened.__setitem__("n", opened["n"] + 1) or _FakeStream())})()
    eng._pending = "a very long run on"
    eng._sample_cursor = 0; eng._utt_start_sample = 0
    import queue as _q; eng._audio_q = _q.Queue()
    eng._in_speech = True                              # speaking, no end mark yet
    eng._speech_samples = 20 * 16000                   # already at the run-on cap

    sent = []
    async def send(m): sent.append(m)
    asyncio.run(eng._drive_always(send, b"\x00\x00" * 1600))
    assert opened["n"] == 1                            # cap forced an end()+reopen
    assert [m for m in sent if m["type"] == "result"]


def test_engine_open_stream_forwards_language():
    """REGRESSION (PR #279 review): every stream (re)open must forward the
    user's source language to the backend — all call sites go through
    _open_stream so one check covers init, endpoint-reopen and salvage."""
    from sokuji_sidecar import asr_engine as ae
    eng = ae.AsrEngine()
    eng._language = "ja"
    seen = []
    eng._backend = type("B", (), {
        "open_stream": lambda self, language=None: (seen.append(language), "st")[1]})()
    assert eng._open_stream() == "st"
    assert seen == ["ja"]
    eng._language = None                       # autodetect when unset
    eng._open_stream()
    assert seen == ["ja", None]


def test_resolves_to_streaming_real_method_threads_pin(monkeypatch):
    """REGRESSION (PR #279 review): the real pre-check referenced an undefined
    `pin`; the swallowed NameError made EVERY streaming card silently take the
    offline path. The pin must reach accel.resolve so the pre-check resolves
    the same plan init_streaming will load."""
    from sokuji_sidecar import asr_engine as ae, accel

    seen = {}

    def fake_resolve(model_id, override="auto", machine=None, pin=None):
        seen["model"], seen["pin"] = model_id, pin
        return [type("P", (), {"backend": "native_asr_stream"})()]

    monkeypatch.setattr(accel, "resolve", fake_resolve)
    eng = ae.AsrEngine()
    assert eng.resolves_to_streaming("voxtral-mini-4b-realtime", "auto", pin="q8_0") is True
    assert seen == {"model": "voxtral-mini-4b-realtime", "pin": "q8_0"}
    # and without a pin it must not blow up either (the original regression)
    assert eng.resolves_to_streaming("voxtral-mini-4b-realtime", "auto") is True
    assert seen["pin"] is None


def test_asr_init_starts_streaming_task_for_streaming_backend():
    started = {"task": False, "init_streaming": None}

    class FakeEng:
        resolved = {"backend": "voxtral_realtime", "device": "vulkan", "computeType": "bfloat16"}

        def resolves_to_streaming(self, model_id, device, pin=None):
            started["precheck_pin"] = pin
            return True

        def init_streaming(self, model_id=None, language="", sample_rate=None,
                           device="auto", pin=None):
            started["init_streaming"] = {"model": model_id, "device": device}

        def init(self, *a, **k):
            started["offline"] = True
            return 0

        def is_streaming(self):
            return True

        def feed_stream(self, b):
            pass

        async def run_stream(self, send):
            started["task"] = True

    eng = FakeEng()

    async def scenario():
        state = {"asr_engine": eng, "handlers": {}}
        from sokuji_sidecar import asr_engine as ae
        ae.register(state)
        conn = server.Conn(type("WS", (), {"send": lambda self, d: None})())
        reply, _ = await server.handle_message(
            state, json.dumps({"type": "asr_init", "id": 1, "model": "voxtral-mini-4b-realtime",
                               "language": "en", "device": "vulkan", "variant": "q8_0"}), None, conn)
        await asyncio.sleep(0)            # let the created task run once
        return reply, conn

    reply, conn = asyncio.run(scenario())
    assert reply["type"] == "ready"
    assert reply["id"] == 1
    # streaming backend wires feed_stream, not feed
    assert conn.ctx["on_binary"] == eng.feed_stream
    # run_stream task was started and ran
    assert started["task"] is True
    # offline init was NOT called (no double-load)
    assert "offline" not in started
    # init_streaming was called with the right params
    assert started["init_streaming"]["model"] == "voxtral-mini-4b-realtime"
    assert started["init_streaming"]["device"] == "vulkan"
    # the pre-check received the user-pinned quant (must match what loads)
    assert started["precheck_pin"] == "q8_0"


def test_asr_init_offline_path_unchanged():
    """An engine without resolves_to_streaming (or returning False) must use the
    old sync path: on_binary = eng.feed, eng.init() called once."""
    loaded = {"init_calls": 0}

    class OfflineEng:
        def resolves_to_streaming(self, model_id, device, pin=None):
            return False

        def init(self, model_id=None, language="", sample_rate=None, device="auto", pin=None):
            loaded["init_calls"] += 1
            return 42

        def feed(self, b):
            return []

    eng = OfflineEng()

    async def scenario():
        state = {"asr_engine": eng, "handlers": {}}
        from sokuji_sidecar import asr_engine as ae
        ae.register(state)
        conn = server.Conn(type("WS", (), {"send": lambda self, d: None})())
        reply, _ = await server.handle_message(
            state, json.dumps({"type": "asr_init", "id": 2, "model": "sense-voice",
                               "language": "ja", "device": "auto"}), None, conn)
        return reply, conn

    reply, conn = asyncio.run(scenario())
    assert reply == {"type": "ready", "id": 2, "loadTimeMs": 42}
    # offline: on_binary = eng.feed
    assert conn.ctx["on_binary"] == eng.feed
    # init called exactly once (no double-load)
    assert loaded["init_calls"] == 1
    # no stream_task created
    assert conn.ctx.get("stream_task") is None


@pytest.mark.skipif(not os.environ.get("SOKUJI_RUN_GPU"),
                    reason="set SOKUJI_RUN_GPU=1 (uses cached Voxtral-Mini-4B-Realtime; needs a GPU lane)")
def test_streaming_end_to_end_real_gpu():
    import wave, asyncio, glob
    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    wav = os.path.join(root, "benchmark", "test-speech-silence-speech.wav")
    if not os.path.exists(wav):
        wav = glob.glob(os.path.expanduser(
            "~/.cache/huggingface/hub/models--csukuangfj--sherpa-onnx-sense-voice*/snapshots/*/test_wavs/en.wav"))[0]
    w = wave.open(wav)
    sr = w.getframerate()
    pcm = w.readframes(w.getnframes())
    eng = AsrEngine()
    eng.init_streaming(model_id="voxtral-mini-4b-realtime", language="en", sample_rate=sr, device="auto")
    opens = {"n": 0}
    _orig = eng._backend.open_stream
    eng._backend.open_stream = lambda language=None: (opens.__setitem__("n", opens["n"] + 1) or _orig(language))
    sent = []
    async def send(m): sent.append(m)
    step = int(0.1 * sr) * 2     # 100ms of int16 bytes
    # Client vad-web mark schedule tuned to benchmark/test-speech-silence-speech.wav's
    # known layout (speech ~0-3.75s, silence ~3.75-5.9s, speech ~5.9-9.69s): open before
    # the first speech region, close mid-pause, reopen before the second speech region,
    # close at EOF. Segmentation is entirely mark-driven now — there is no VAD left in
    # the sidecar to do this on its own.
    mark_schedule = [(0.0, "start"), (4.5, "end"), (5.6, "start")]
    mark_bytes = [(int(t * sr) * 2, ev) for t, ev in mark_schedule]
    async def feeder():
        mi = 0
        for i in range(0, len(pcm), step):
            while mi < len(mark_bytes) and i >= mark_bytes[mi][0]:
                eng.mark(mark_bytes[mi][1])
                mi += 1
            eng.feed_stream(pcm[i:i + step])
            await asyncio.sleep(0.1)
        while mi < len(mark_bytes):          # flush any marks scheduled past the last chunk
            eng.mark(mark_bytes[mi][1])
            mi += 1
        eng.mark("end")                      # EOF: close the second utterance
        eng.feed_stream(None)
    async def drive():
        await asyncio.gather(feeder(), eng.run_stream(send))
    asyncio.run(drive())
    results = [m["text"] for m in sent if m["type"] == "result"]
    full = " ".join(results).lower()
    assert results, "no finals produced"
    # tail-hold fix: the first sentence ends with "country" and it must be IN a final,
    # not dropped/leaked onto the next utterance.
    assert "ask" in full and "country" in full, f"unexpected: {results!r}"
    # mark-driven segmentation: the mid-clip end/start pair should cut at least one final
    # mid-clip, so >1 final (not one clump) and >1 stream opened (each utterance ended at
    # its mark).
    print(f"pause-seg e2e: {len([m for m in sent if m['type']=='partial'])} partials, "
          f"{len(results)} finals, stream opens={opens['n']}, finals={results!r}")
    assert len(results) >= 2, f"expected the marks to segment into >=2 finals, got {results!r}"
    eng.close()


def test_always_stream_aborted_self_heals(monkeypatch):
    import asyncio
    from sokuji_sidecar.asr_engine import AsrEngine
    opened = {"n": 0}

    class _AbortedStream:
        aborted = True                     # generate died
        def feed(self, samples): pass
        def drain(self): return []
        def abort(self): pass
        def end(self): return ""

    eng = AsrEngine()
    eng._mode = "always_stream"; eng._src_rate = 16000
    eng._stream = _AbortedStream()
    eng._backend = type("B", (), {"open_stream": lambda self, language=None: (opened.__setitem__("n", opened["n"] + 1) or _AbortedStream())})()
    eng._pending = "partial words"
    eng._sample_cursor = 0; eng._utt_start_sample = 0
    import queue as _q; eng._audio_q = _q.Queue()
    eng._in_speech = True
    eng._speech_samples = 0

    sent = []
    async def send(m): sent.append(m)
    asyncio.run(eng._drive_always(send, b"\x00\x00" * 1600))
    results = [m for m in sent if m["type"] == "result"]
    assert results and results[-1]["text"] == "partial words"   # pending flushed on self-heal
    assert opened["n"] == 1                                      # stream restarted
    assert eng._pending == "" and eng._speech_samples == 0


def test_always_stream_endpoint_end_failure_still_reopens(monkeypatch):
    import asyncio
    from sokuji_sidecar.asr_engine import AsrEngine
    opened = {"n": 0}

    class _FakeStream:
        def feed(self, s): pass
        def drain(self): return []
        def end(self): raise RuntimeError("generate crashed during flush")
        def abort(self): pass

    eng = AsrEngine()
    eng._mode = "always_stream"; eng._src_rate = 16000
    eng._stream = _FakeStream()
    eng._backend = type("B", (), {"open_stream": lambda self, language=None: (opened.__setitem__("n", opened["n"] + 1) or _FakeStream())})()
    eng._pending = "some words"
    eng._sample_cursor = 0; eng._utt_start_sample = 0
    eng._streaming = True
    eng._in_speech = True
    import queue as _q; eng._audio_q = _q.Queue()
    eng._speech_samples = 8000   # real utterance (speech seen)
    eng.feed_stream(b"\x00\x00" * 1600)
    eng.mark("end")

    sent = []
    async def send(m): sent.append(m)
    asyncio.run(eng._drive_once(send))
    assert opened["n"] == 1                                   # reopened despite end() raising
    assert not [m for m in sent if m["type"] == "result"]     # no final emitted on failure
    assert eng._pending == ""                                 # state reset (self-heal)


def test_backpressure_degrades_to_per_utterance(monkeypatch):
    import asyncio
    from sokuji_sidecar.asr_engine import AsrEngine

    class _SlowStream:      # never emits deltas -> processed audio stays 0 -> lag grows
        def feed(self, samples): pass
        def drain(self): return []
        def abort(self): pass

    eng = AsrEngine()
    eng._mode = "always_stream"; eng._src_rate = 16000
    eng._stream = _SlowStream()
    eng._backend = type("B", (), {"open_stream": lambda self, language=None: _SlowStream()})()
    eng._pending = "held text"
    eng._sample_cursor = 0; eng._utt_start_sample = 0
    import queue as _q; eng._audio_q = _q.Queue()
    eng._in_speech = True
    eng._speech_samples = 0

    sent = []
    async def send(m): sent.append(m)
    buf = b"\x00\x00" * 16000     # 1s of audio per call
    # >3s of un-processed audio backed up in the queue = the model can't keep up
    for _ in range(4):
        eng._audio_q.put_nowait(buf)
    asyncio.run(eng._drive_always(send, buf))
    assert eng._mode == "per_utterance"                     # degraded
    assert any(m["type"] == "result" and m["text"] == "held text" for m in sent)  # pending flushed
    # mid-speech degrade: a gated CONTINUATION stream opens immediately (the
    # client hasn't sent an end mark yet, so no new "start" mark would ever
    # arrive) so the engine must keep the utterance alive on its own.
    assert eng._stream is not None


def test_degrade_continuation_resets_utt_fed():
    """REGRESSION: the backpressure-degrade branch opens a gated continuation stream
    without resetting _utt_fed, and _utt_fed is never initialized elsewhere on this
    path — since the engine is a process singleton reused across sessions, a stale
    _utt_fed (e.g. left over from an earlier gated utterance) survives the degrade and
    can trip the 20s backstop on the very first post-degrade buffer, emitting a
    spurious final."""
    import asyncio
    from sokuji_sidecar.asr_engine import AsrEngine

    class _SlowStream:      # never emits deltas -> processed audio stays 0 -> lag grows
        def feed(self, samples): pass
        def drain(self): return []
        def abort(self): pass
        def end(self): return "should not fire"

    eng = AsrEngine()
    eng._mode = "always_stream"; eng._src_rate = 16000
    eng._stream = _SlowStream()
    eng._backend = type("B", (), {"open_stream": lambda self, language=None: _SlowStream()})()
    eng._pending = ""
    eng._sample_cursor = 0; eng._utt_start_sample = 0
    import queue as _q; eng._audio_q = _q.Queue()
    eng._in_speech = True
    eng._speech_samples = 0
    eng._utt_fed = 19 * 16000   # stale carryover from a PRIOR gated utterance/session

    sent = []
    async def send(m): sent.append(m)
    buf = b"\x00\x00" * 16000     # 1s of audio per call
    for _ in range(4):            # >3s backlog forces the backpressure degrade
        eng._audio_q.put_nowait(buf)
    asyncio.run(eng._drive_always(send, buf))   # degrades: always_stream -> per_utterance,
                                                 # a gated continuation stream opens
    assert eng._mode == "per_utterance"
    assert eng._stream is not None
    assert eng._utt_fed == 0   # must be reset by the degrade branch itself

    # drain the backlog the lag computation above needed; isolate the next assertion
    # to exactly one fresh 1s buffer fed through the reopened gated stream.
    while not eng._audio_q.empty():
        eng._audio_q.get_nowait()
    eng._audio_q.put_nowait(buf)
    asyncio.run(eng._drive_once(send))
    assert not [m for m in sent if m["type"] == "result"]   # no spurious cut from stale _utt_fed


def test_silence_never_degrades_always_stream(monkeypatch):
    """REGRESSION (onset-loss bug, 2026-07-05): the old lag formula counted
    fed seconds against drained deltas, so a quiet room (model rightly emits
    nothing) crossed the threshold within the first 3 silent seconds of EVERY
    session and permanently degraded to the lossy client-gated mode — clipping
    the first ~2-3 characters of every utterance. The queue-depth signal is
    naturally immune: silence drains instantly, so no backlog ever forms."""
    import asyncio
    from sokuji_sidecar.asr_engine import AsrEngine

    class _IdleStream:
        def feed(self, samples): pass
        def drain(self): return []

    eng = AsrEngine()
    eng._mode = "always_stream"; eng._src_rate = 16000
    eng._stream = _IdleStream()
    eng._backend = type("B", (), {"open_stream": lambda self, language=None: _IdleStream()})()
    eng._pending = ""
    eng._sample_cursor = 0; eng._utt_start_sample = 0
    import queue as _q; eng._audio_q = _q.Queue()
    eng._in_speech = False   # silence
    eng._speech_samples = 0

    sent = []
    async def send(m): sent.append(m)
    buf = b"\x00\x00" * 16000
    for _ in range(8):                       # 8s of quiet room
        asyncio.run(eng._drive_always(send, buf))
    assert eng._mode == "always_stream"      # still in the lossless mode
    assert eng._stream is not None


def test_gated_mode_replays_preroll_on_start():
    """REGRESSION (onset-loss bug): the pre-roll ring must replay the audio that
    arrived before the client's "start" mark, so utterances don't lose their
    first words while the client-side VAD confirms speech."""
    import asyncio
    import numpy as np
    from sokuji_sidecar.asr_engine import AsrEngine

    feeds = []

    class _RecStream:
        def feed(self, s): feeds.append(np.asarray(s))
        def drain(self): return []
        def end(self): return "x"
        def abort(self): pass

    eng = AsrEngine()
    eng._mode = "per_utterance"; eng._src_rate = 16000
    eng._stream = None; eng._sample_cursor = 0; eng._utt_start_sample = 0; eng._partial_acc = []
    eng._in_speech = False
    eng._preroll = []; eng._preroll_len = 0
    eng._streaming = True
    import queue as _q; eng._audio_q = _q.Queue()
    eng._backend = type("B", (), {"open_stream": lambda self, language=None: _RecStream()})()

    async def send(m): pass
    mk = lambda v: (np.full(8000, v, np.int16)).tobytes()    # 0.5s buffers
    eng.feed_stream(mk(1000))          # pre-start silence, fills the ring
    eng.feed_stream(mk(2000))          # pre-start silence, fills the ring
    eng.mark("start")
    eng.feed_stream(mk(3000))          # the "start" buffer
    eng.feed_stream(mk(4000))          # the following speech buffer
    asyncio.run(eng._drive_once(send))

    # First thing fed = the pre-roll (the two pre-start buffers, within the cap),
    # then the start buffer itself, then the following speech buffer.
    assert len(feeds) == 3
    assert len(feeds[0]) == 16000                            # both 0.5s pre-start buffers
    assert feeds[0][0] > 0.02 and feeds[0][-1] > 0.05        # b1 then b2 content
    assert abs(feeds[1][0] - 3000 / 32768.0) < 1e-4          # start buffer not duplicated
    assert abs(feeds[2][0] - 4000 / 32768.0) < 1e-4


def test_preroll_ring_is_capped():
    import asyncio
    import numpy as np
    from sokuji_sidecar.asr_engine import AsrEngine

    feeds = []

    class _RecStream:
        def feed(self, s): feeds.append(np.asarray(s))
        def drain(self): return []

    eng = AsrEngine()
    eng._mode = "per_utterance"; eng._src_rate = 16000
    eng._stream = None; eng._sample_cursor = 0; eng._utt_start_sample = 0; eng._partial_acc = []
    eng._in_speech = False
    eng._preroll = []; eng._preroll_len = 0
    eng._streaming = True
    import queue as _q; eng._audio_q = _q.Queue()
    eng._backend = type("B", (), {"open_stream": lambda self, language=None: _RecStream()})()

    async def send(m): pass
    buf = np.zeros(8000, np.int16).tobytes()                 # 0.5s each, 5s total silence
    for _ in range(10):
        eng.feed_stream(buf)
    eng.mark("start")
    asyncio.run(eng._drive_once(send))
    # pre-roll bounded: >= the 0.7s cap, < cap + one buffer
    assert 11200 <= len(feeds[0]) < 11200 + 8000


def test_preroll_cleared_after_finalize():
    """The ring restarts after each utterance — mark("end") must clear it so the
    next utterance's pre-roll never replays the previous one's tail."""
    import asyncio
    import numpy as np
    from sokuji_sidecar.asr_engine import AsrEngine

    class _RecStream:
        def feed(self, s): pass
        def drain(self): return []
        def end(self): return "first"
        def abort(self): pass

    eng = AsrEngine()
    eng._mode = "per_utterance"; eng._src_rate = 16000
    eng._stream = None; eng._sample_cursor = 0; eng._utt_start_sample = 0; eng._partial_acc = []
    eng._in_speech = False
    eng._preroll = []; eng._preroll_len = 0
    eng._streaming = True
    import queue as _q; eng._audio_q = _q.Queue()
    eng._backend = type("B", (), {"open_stream": lambda self, language=None: _RecStream()})()

    sent = []
    async def send(m): sent.append(m)
    mk = lambda v: (np.full(8000, v, np.int16)).tobytes()
    eng.feed_stream(mk(1000))          # pre-start silence
    eng.mark("start")
    eng.feed_stream(mk(2000))          # speech
    eng.mark("end")
    asyncio.run(eng._drive_once(send))

    assert eng._preroll == []


def test_gated_fast_utterance_recovers_to_always():
    """A degrade is no longer a one-way door: when a gated utterance's
    recognition ran faster than realtime, the engine returns to the lossless
    always-stream mode."""
    import asyncio
    import numpy as np
    from sokuji_sidecar.asr_engine import AsrEngine

    class _FastStream:
        def feed(self, s): pass
        def drain(self): return []
        def end(self): return "quick"
        def abort(self): pass

    eng = AsrEngine()
    eng._mode = "per_utterance"; eng._src_rate = 16000
    eng._stream = None; eng._sample_cursor = 0; eng._utt_start_sample = 0; eng._partial_acc = []
    eng._in_speech = False
    eng._preroll = []; eng._preroll_len = 0
    eng._streaming = True
    import queue as _q; eng._audio_q = _q.Queue()
    eng._backend = type("B", (), {"open_stream": lambda self, language=None: _FastStream()})()

    sent = []
    async def send(m): sent.append(m)
    buf = np.zeros(16000, np.int16).tobytes()                # 1s buffers → dur >> rec
    eng.mark("start")
    eng.feed_stream(buf)
    eng.feed_stream(buf)
    eng.mark("end")
    asyncio.run(eng._drive_once(send))
    assert any(m["type"] == "result" and m["text"] == "quick" for m in sent)
    assert eng._mode == "always_stream"                      # recovered
    assert eng._stream is not None                           # lossless session reopened


def test_gated_backstop_cuts_and_reopens_in_place():
    """A 20s per-utterance backstop (the client's end mark is lost): _drive_utterance
    must finalize + reopen IN PLACE — the utterance continues gated, mid-utterance —
    resetting _utt_fed and advancing _utt_start_sample so the next segment's duration
    doesn't double-count the portion the backstop already finalized."""
    import asyncio
    import numpy as np
    from sokuji_sidecar.asr_engine import AsrEngine

    class _RecStream:
        def feed(self, s): pass
        def drain(self): return []
        def end(self): return "backstop cut"
        def abort(self): pass

    eng = AsrEngine()
    eng._mode = "per_utterance"; eng._src_rate = 16000
    eng._stream = None; eng._sample_cursor = 0; eng._utt_start_sample = 0; eng._partial_acc = []
    eng._in_speech = False
    eng._preroll = []; eng._preroll_len = 0
    eng._streaming = True
    import queue as _q; eng._audio_q = _q.Queue()
    eng._backend = type("B", (), {"open_stream": lambda self, language=None: _RecStream()})()

    sent = []
    async def send(m): sent.append(m)
    eng.mark("start")
    buf = np.zeros(16000, np.int16).tobytes()   # 1s buffers
    for _ in range(21):                          # >20s fed, no end mark: trips the backstop
        eng.feed_stream(buf)
    asyncio.run(eng._drive_once(send))

    results = [m for m in sent if m["type"] == "result"]
    assert len(results) == 1                      # exactly one mid-utterance cut
    assert results[0]["text"] == "backstop cut"
    assert eng._stream is not None                 # reopened in place, utterance continues
    assert eng._utt_fed == 16000                   # reset at the cut, then fed one more buffer
    assert eng._utt_start_sample == 19 * 16000     # advanced past the finalized portion
