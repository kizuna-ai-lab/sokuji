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
