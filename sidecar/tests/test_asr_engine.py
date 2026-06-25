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
    def init(self, model_id=None, language="", sample_rate=24000,
             vad_threshold=None, vad_min_silence=None, vad_min_speech=None, device="auto"):
        self.sample_rate = sample_rate
        self.vad = (vad_threshold, vad_min_silence, vad_min_speech)
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


def test_asr_init_forwards_vad_params():
    st, conn = make()
    asyncio.run(server.handle_message(st, json.dumps({
        "type": "asr_init", "id": 1, "model": "sense-voice",
        "vadThreshold": 0.3, "vadMinSilenceDuration": 1.4, "vadMinSpeechDuration": 0.4,
    }), None, conn))
    assert st["asr_engine"].vad == (0.3, 1.4, 0.4)


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


def test_downsample_empty_bytes_returns_empty_float32():
    """Empty input must return an empty float32 array and must NOT raise."""
    from sokuji_sidecar.asr_engine import _downsample_int16_to_f32_16k
    out = _downsample_int16_to_f32_16k(b"")
    assert out.dtype == np.float32 and len(out) == 0


def test_downsample_empty_bytes_with_non_default_rate():
    from sokuji_sidecar.asr_engine import _downsample_int16_to_f32_16k
    out = _downsample_int16_to_f32_16k(b"", src_rate=48000)
    assert out.dtype == np.float32 and len(out) == 0


@pytest.mark.skipif(not os.environ.get("SOKUJI_RUN_ASR_MODEL"),
                    reason="set SOKUJI_RUN_ASR_MODEL=1 (downloads sherpa-onnx model + VAD)")
def test_real_engine_transcribes_test_wav():
    from huggingface_hub import snapshot_download
    d = snapshot_download("csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17")
    w = wave.open(f"{d}/test_wavs/en.wav", "rb")
    pcm16k = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16)
    # AsrEngine.feed expects Int16@24k; upsample the 16k test wav to 24k.
    ratio = 24000 / 16000
    n = round(len(pcm16k) * ratio)
    pos = np.arange(n) / ratio
    i0 = np.clip(np.floor(pos).astype(np.int64), 0, len(pcm16k) - 1)
    pcm24k = pcm16k[i0].astype(np.int16)

    eng = asr_engine.AsrEngine()
    eng.init()
    results = []
    for i in range(0, len(pcm24k), 4096):
        for m in eng.feed(pcm24k[i:i + 4096].tobytes()):
            if m["type"] == "result":
                results.append(m["text"])
    for m in eng.flush():
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
    # Stub VAD so no model/native lib is needed.
    monkeypatch.setattr(eng, "_init_vad", lambda *a, **k: None)
    fake_plan = accel.Plan("ctranslate2", "cpu", "cpu", "int8", "tiny", 1.0)
    monkeypatch.setattr(accel, "resolve", lambda model_id, override="auto": [fake_plan])
    monkeypatch.setattr(accel, "load_with_fallback", lambda plans: (_FakeBackend(), fake_plan, None))
    monkeypatch.setattr(accel, "measure_rtf", lambda *a, **k: None)
    ms = eng.init(model_id="whisper-tiny", language="en", device="auto")
    assert isinstance(ms, int)
    assert eng.resolved == {"backend": "ctranslate2", "device": "cpu", "computeType": "int8"}
    # _drain uses the resolved backend's transcribe().text
    assert eng._backend.transcribe(np.zeros(4, np.float32), "en").text == "resolved-text"


class _DrainBackend:
    def transcribe(self, samples, language):
        from sokuji_sidecar.backends import AsrResult
        return AsrResult("drained-text")


class _FakeVad:
    def __init__(self, seg):
        self._segs = [seg]

    def empty(self):
        return not self._segs

    @property
    def front(self):
        return self._segs[0]

    def pop(self):
        self._segs.pop(0)


def test_drain_routes_through_resolved_backend():
    import types
    from sokuji_sidecar import asr_engine as ae
    eng = ae.AsrEngine()
    eng._backend = _DrainBackend()
    eng._language = None
    seg = types.SimpleNamespace(samples=np.zeros(16000, np.float32), start=0)
    eng._vad = _FakeVad(seg)
    out = eng._drain()
    assert len(out) == 1
    assert out[0]["type"] == "result" and out[0]["text"] == "drained-text"
    assert out[0]["startSample"] == 0
    assert out[0]["durationMs"] == 1000  # 16000 samples / 16000 Hz * 1000ms


class _ResolvedAsr(FakeAsr):
    def init(self, *a, **k):
        ms = super().init(*a, **k)
        self.resolved = {"backend": "ctranslate2", "device": "cuda", "computeType": "float16"}
        return ms


def test_ready_includes_resolved_plan_when_present():
    st = {"asr_engine": _ResolvedAsr(), "handlers": {}}
    asr_engine.register(st)
    conn = server.Conn(_FakeWS())
    reply, _ = asyncio.run(server.handle_message(
        st, json.dumps({"type": "asr_init", "id": 1}), None, conn))
    assert reply["backend"] == "ctranslate2"
    assert reply["device"] == "cuda" and reply["computeType"] == "float16"


def test_ready_unchanged_when_engine_has_no_resolved():
    # The plain FakeAsr (no `resolved`) must still get the minimal ready shape.
    st, conn = make()
    reply, _ = asyncio.run(server.handle_message(
        st, json.dumps({"type": "asr_init", "id": 2}), None, conn))
    assert reply == {"type": "ready", "id": 2, "loadTimeMs": 33}


def test_engine_init_measures_and_stores_rtf(monkeypatch):
    from sokuji_sidecar import asr_engine as ae, accel
    eng = ae.AsrEngine()
    monkeypatch.setattr(eng, "_init_vad", lambda *a, **k: None)
    fake_plan = accel.Plan("ctranslate2", "gpu-cuda", "cuda", "float16", "tiny", 1.0)
    monkeypatch.setattr(accel, "resolve", lambda model_id, override="auto": [fake_plan])
    monkeypatch.setattr(accel, "load_with_fallback", lambda plans: (_FakeBackend(), fake_plan, None))
    monkeypatch.setattr(accel, "measure_rtf", lambda *a, **k: 0.25)
    eng.init(model_id="whisper-tiny", language="en", device="auto")
    assert eng.resolved["device"] == "cuda"
    assert eng.resolved["rtf"] == 0.25


def test_engine_init_omits_rtf_when_benchmark_returns_none(monkeypatch):
    from sokuji_sidecar import asr_engine as ae, accel
    eng = ae.AsrEngine()
    monkeypatch.setattr(eng, "_init_vad", lambda *a, **k: None)
    fake_plan = accel.Plan("ctranslate2", "cpu", "cpu", "int8", "tiny", 1.0)
    monkeypatch.setattr(accel, "resolve", lambda model_id, override="auto": [fake_plan])
    monkeypatch.setattr(accel, "load_with_fallback", lambda plans: (_FakeBackend(), fake_plan, None))
    monkeypatch.setattr(accel, "measure_rtf", lambda *a, **k: None)  # benchmark failed
    eng.init(model_id="whisper-tiny", device="auto")
    assert "rtf" not in eng.resolved


@pytest.mark.skipif(not os.environ.get("SOKUJI_RUN_FW_MODEL"),
                    reason="set SOKUJI_RUN_FW_MODEL=1 (downloads faster-whisper model)")
def test_real_faster_whisper_transcribes():
    from huggingface_hub import snapshot_download
    d = snapshot_download("csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17")
    w = wave.open(f"{d}/test_wavs/en.wav", "rb")
    pcm16k = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16)
    ratio = 24000 / 16000
    n = round(len(pcm16k) * ratio)
    i0 = np.clip(np.floor(np.arange(n) / ratio).astype(np.int64), 0, len(pcm16k) - 1)
    pcm24k = pcm16k[i0].astype(np.int16)
    eng = asr_engine.AsrEngine()
    eng.init(model_id="whisper-tiny", language="en")
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
    monkeypatch.setattr(eng, "_init_vad", lambda *a, **k: None)
    fake_plan = accel.Plan("ctranslate2", "cpu", "cpu", "int8", "tiny", 1.0)
    backends = []

    def fake_load(plans):
        b = _UnloadBackend()
        backends.append(b)
        return b, fake_plan, None

    monkeypatch.setattr(accel, "resolve", lambda model_id, override="auto": [fake_plan])
    monkeypatch.setattr(accel, "load_with_fallback", fake_load)
    monkeypatch.setattr(accel, "measure_rtf", lambda *a, **k: None)

    eng.init(model_id="whisper-tiny")
    assert len(backends) == 1 and backends[0].unloaded is False
    eng.init(model_id="whisper-tiny")                 # re-init frees the first
    assert backends[0].unloaded is True
    assert len(backends) == 2 and backends[1].unloaded is False
    eng.close()                                       # close frees the current
    assert backends[1].unloaded is True
    assert eng._backend is None


def test_conn_close_frees_asr_model():
    # A session connection (asr_init set on_binary) closing must trigger engine.close()
    # in _conn's finally, releasing the model from VRAM on stop.
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
    def feed(self, samples):
        self.fed += len(samples)
    def drain(self):
        out, self._pending = self._pending, []
        return out
    def end(self):
        self.ended = True
        return "hello world"


def _streaming_engine(monkeypatch, fake_stream, vad_segments):
    """Build an AsrEngine whose resolved backend is streaming and whose VAD is faked
    to yield a scripted speech_start then endpoint."""
    eng = AsrEngine()
    backend = type("B", (), {"STREAMING": True, "open_stream": lambda self: fake_stream,
                             "unload": lambda self: None})()
    # bypass real resolve/VAD: inject the backend + a fake VAD endpoint generator
    monkeypatch.setattr(eng, "_resolve_streaming_backend", lambda model, device: backend)
    monkeypatch.setattr(eng, "_vad_events", lambda samples: vad_segments)  # ['start'|'speech'|'end']
    return eng


def test_feed_stream_returns_iterable_for_conn_loop():
    import queue
    eng = AsrEngine()
    eng._audio_q = queue.Queue()
    out = eng.feed_stream(b"\x00\x00\x01\x00")
    assert list(out) == []                 # _conn's `for out in feeder(data)` is safe
    assert eng._audio_q.qsize() == 1       # audio was enqueued for the streaming task


def test_streaming_emits_speech_start_partials_result(monkeypatch):
    fs = _FakeStream()
    eng = _streaming_engine(monkeypatch, fs, vad_segments=["start", "speech", "end"])
    sent = []
    async def send(msg): sent.append(msg)
    eng.init_streaming(model_id="voxtral-mini-4b-realtime", language="en", device="cuda")
    eng._mode = "per_utterance"   # exercise the per-utterance fallback path explicitly
    # feed one buffer that the fake VAD turns into start→speech→end
    eng.feed_stream(np.zeros(16000, np.int16).tobytes())
    asyncio.run(eng._drive_once(send))   # one iteration of the streaming loop
    types_seen = [m["type"] for m in sent]
    assert types_seen[0] == "speech_start"
    assert "partial" in types_seen
    assert types_seen[-1] == "result"
    assert sent[-1]["text"] == "hello world"
    assert fs.ended is True


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
    eng._backend = type("B", (), {"open_stream": lambda self: (opened.__setitem__("n", opened["n"] + 1) or _FakeStream())})()
    eng._pending = "country can do for you."          # partial: the tail is MISSING here
    eng._sample_cursor = 0; eng._utt_start_sample = 0
    eng._fed_s = 0.0; eng._delta_count = 0; eng._speech_samples = 8000   # real utterance (speech seen)
    monkeypatch.setattr(eng, "_vad_state", lambda s: (False, False, True))   # endpoint this buffer

    sent = []
    async def send(m): sent.append(m)
    asyncio.run(eng._drive_always(send, b"\x00\x00" * 1600))
    results = [m for m in sent if m["type"] == "result"]
    assert results and "do for your country." in results[-1]["text"]   # the held tail is in the final
    assert opened["n"] == 1                                            # reopened
    assert eng._pending == "" and eng._fed_s == 0.0 and eng._delta_count == 0


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
    eng._backend = type("B", (), {"open_stream": lambda self: (opened.__setitem__("n", opened["n"] + 1) or _FakeStream())})()
    eng._pending = ""                                  # nothing transcribed
    eng._sample_cursor = 0; eng._utt_start_sample = 0
    eng._fed_s = 0.0; eng._delta_count = 0; eng._speech_samples = 0
    monkeypatch.setattr(eng, "_vad_state", lambda s: (False, False, True))   # endpoint, no speech

    sent = []
    async def send(m): sent.append(m)
    asyncio.run(eng._drive_always(send, b"\x00\x00" * 1600))
    assert not [m for m in sent if m["type"] == "result"]   # no speech this stream: no cut
    assert opened["n"] == 0


def test_always_stream_endpoint_flushes_held_text_with_empty_pending(monkeypatch):
    # A short utterance whose text the model still HOLDS (so _pending is empty at the falling
    # edge) must still cut + end()-flush. Gating on speech, not on _pending text — otherwise
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
    eng._backend = type("B", (), {"open_stream": lambda self: (opened.__setitem__("n", opened["n"] + 1) or _FakeStream())})()
    eng._pending = ""                                    # held text not yet drained
    eng._sample_cursor = 0; eng._utt_start_sample = 0
    eng._fed_s = 0.0; eng._delta_count = 0
    eng._speech_samples = 8000                           # ~0.5s of speech happened in prior buffers
    monkeypatch.setattr(eng, "_vad_state", lambda s: (False, False, True))   # endpoint this buffer

    sent = []
    async def send(m): sent.append(m)
    asyncio.run(eng._drive_always(send, b"\x00\x00" * 1600))
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
    eng._backend = type("B", (), {"open_stream": lambda self: (opened.__setitem__("n", opened["n"] + 1) or _FakeStream())})()
    eng._pending = "a very long run on"
    eng._sample_cursor = 0; eng._utt_start_sample = 0
    eng._fed_s = 0.0; eng._delta_count = 0
    eng._speech_samples = 20 * 16000                   # already at the run-on cap
    monkeypatch.setattr(eng, "_vad_state", lambda s: (True, False, False))   # speaking, no endpoint

    sent = []
    async def send(m): sent.append(m)
    asyncio.run(eng._drive_always(send, b"\x00\x00" * 1600))
    assert opened["n"] == 1                            # cap forced an end()+reopen
    assert [m for m in sent if m["type"] == "result"]


def test_asr_init_starts_streaming_task_for_streaming_backend():
    started = {"task": False, "init_streaming": None}

    class FakeEng:
        resolved = {"backend": "voxtral_realtime", "device": "cuda", "computeType": "bfloat16"}

        def resolves_to_streaming(self, model_id, device):
            return True

        def init_streaming(self, model_id=None, language="", sample_rate=None,
                           vad_threshold=None, vad_min_silence=None, vad_min_speech=None, device="auto"):
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
                               "language": "en", "device": "cuda"}), None, conn)
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
    assert started["init_streaming"]["device"] == "cuda"


def test_asr_init_offline_path_unchanged():
    """An engine without resolves_to_streaming (or returning False) must use the
    old sync path: on_binary = eng.feed, eng.init() called once."""
    loaded = {"init_calls": 0}

    class OfflineEng:
        def resolves_to_streaming(self, model_id, device):
            return False

        def init(self, model_id=None, language="", sample_rate=None,
                 vad_threshold=None, vad_min_silence=None, vad_min_speech=None, device="auto"):
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
                    reason="set SOKUJI_RUN_GPU=1 (uses cached Voxtral-Mini-4B-Realtime; needs CUDA)")
def test_streaming_end_to_end_real_gpu():
    import wave, asyncio, glob
    from huggingface_hub import snapshot_download
    snapshot_download("mistralai/Voxtral-Mini-4B-Realtime-2602",
                      ignore_patterns=["consolidated.safetensors", "*.gitattributes"])
    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    wav = os.path.join(root, "benchmark", "test-speech-silence-speech.wav")
    if not os.path.exists(wav):
        wav = glob.glob(os.path.expanduser(
            "~/.cache/huggingface/hub/models--csukuangfj--sherpa-onnx-sense-voice*/snapshots/*/test_wavs/en.wav"))[0]
    w = wave.open(wav)
    sr = w.getframerate()
    pcm = w.readframes(w.getnframes())
    eng = AsrEngine()
    eng.init_streaming(model_id="voxtral-mini-4b-realtime", language="en", sample_rate=sr, device="cuda")
    opens = {"n": 0}
    _orig = eng._backend.open_stream
    eng._backend.open_stream = lambda: (opens.__setitem__("n", opens["n"] + 1) or _orig())
    sent = []
    async def send(m): sent.append(m)
    step = int(0.1 * sr) * 2     # 100ms of int16 bytes
    async def feeder():
        for i in range(0, len(pcm), step):
            eng.feed_stream(pcm[i:i + step])
            await asyncio.sleep(0.1)
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
    # endpoint segmentation: the mid-clip pause should cut at least one final mid-clip,
    # so >1 final (not one clump) and >1 stream opened (each utterance ended at its pause).
    print(f"pause-seg e2e: {len([m for m in sent if m['type']=='partial'])} partials, "
          f"{len(results)} finals, stream opens={opens['n']}, finals={results!r}")
    assert len(results) >= 2, f"expected the pause to segment into >=2 finals, got {results!r}"
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
    eng._backend = type("B", (), {"open_stream": lambda self: (opened.__setitem__("n", opened["n"] + 1) or _AbortedStream())})()
    eng._pending = "partial words"
    eng._sample_cursor = 0; eng._utt_start_sample = 0
    eng._fed_s = 0.0; eng._delta_count = 0
    eng._speech_samples = 0
    monkeypatch.setattr(eng, "_vad_state", lambda s: (True, False, False))

    sent = []
    async def send(m): sent.append(m)
    asyncio.run(eng._drive_always(send, b"\x00\x00" * 1600))
    results = [m for m in sent if m["type"] == "result"]
    assert results and results[-1]["text"] == "partial words"   # pending flushed on self-heal
    assert opened["n"] == 1                                      # stream restarted
    assert eng._pending == "" and eng._fed_s == 0.0 and eng._delta_count == 0 and eng._speech_samples == 0


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
    eng._backend = type("B", (), {"open_stream": lambda self: (opened.__setitem__("n", opened["n"] + 1) or _FakeStream())})()
    eng._pending = "some words"
    eng._sample_cursor = 0; eng._utt_start_sample = 0
    eng._fed_s = 0.0; eng._delta_count = 0; eng._speech_samples = 8000   # real utterance (speech seen)
    monkeypatch.setattr(eng, "_vad_state", lambda s: (False, False, True))   # endpoint this buffer

    sent = []
    async def send(m): sent.append(m)
    asyncio.run(eng._drive_always(send, b"\x00\x00" * 1600))
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
    eng._backend = type("B", (), {"open_stream": lambda self: _SlowStream()})()
    eng._pending = "held text"
    eng._sample_cursor = 0; eng._utt_start_sample = 0
    eng._fed_s = 0.0; eng._delta_count = 0
    eng._speech_samples = 0
    monkeypatch.setattr(eng, "_vad_state", lambda s: (True, False, False))

    sent = []
    async def send(m): sent.append(m)
    buf = b"\x00\x00" * 16000     # 1s of audio per call
    # feed ~4s of audio with no deltas -> lag exceeds 3.0 -> degrade
    for _ in range(4):
        asyncio.run(eng._drive_always(send, buf))
    assert eng._mode == "per_utterance"                     # degraded
    assert eng._stream is None                              # always-stream session dropped
    assert any(m["type"] == "result" and m["text"] == "held text" for m in sent)  # pending flushed


def test_vad_state_reports_rising_and_falling_edges():
    import numpy as np
    from sokuji_sidecar.asr_engine import AsrEngine

    class _FakeVad:
        """is_speech_detected() returns the current state; accept_waveform() advances it
        through `after` (the state AFTER each window)."""
        def __init__(self, start, after):
            self._cur = start
            self._after = list(after)
            self._k = 0
        def is_speech_detected(self):
            return self._cur
        def accept_waveform(self, w):
            self._cur = self._after[self._k]
            self._k += 1

    # falling: start speaking, one window flips to silence
    eng = AsrEngine()
    eng._vad = _FakeVad(start=True, after=[False])
    eng._window = 100
    eng._buf = np.zeros(0, np.float32)
    had, rising, falling = eng._vad_state(np.zeros(100, np.float32))
    assert (had, rising, falling) == (False, False, True)

    # rising: start silent, one window flips to speech
    eng2 = AsrEngine()
    eng2._vad = _FakeVad(start=False, after=[True])
    eng2._window = 100
    eng2._buf = np.zeros(0, np.float32)
    had2, rising2, falling2 = eng2._vad_state(np.zeros(100, np.float32))
    assert (had2, rising2, falling2) == (True, True, False)
