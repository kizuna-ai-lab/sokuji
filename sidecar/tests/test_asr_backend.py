"""NativeAsrBackend / NativeAsrStreamBackend: sokuji_native faked at the module level;
real-model smoke behind SOKUJI_RUN_NATIVE_ASR=1 (cached SenseVoice Q8_0 GGUF)."""
import os
import sys
import types

import numpy as np
import pytest

from sokuji_sidecar import native
from sokuji_sidecar.backends import BackendLoadError, make_backend


class _FakeStreamText:
    def __init__(self, committed, tentative=""):
        self.committed, self.tentative = committed, tentative


class _FakeStream:
    """Scripted committed-text progression + finalize behaviour."""
    def __init__(self, log, language):
        self._log, self.language = log, language
        self._committed = ""
        self.closed = False
        self.finalized = False

    def feed(self, pcm):
        self._log.append(("feed", len(pcm)))
        return _FakeStreamText(self._committed)

    def set_committed(self, text):
        self._committed = text

    def finalize(self):
        self._log.append(("finalize",))
        self.finalized = True
        self.closed = True
        return self._committed + " FINAL"

    def close(self):
        self._log.append(("close",))
        self.closed = True


class _FakeModel:
    def __init__(self, path, device, languages=(), supports_streaming=False):
        self.path, self.device = path, device
        self.capabilities = types.SimpleNamespace(languages=languages, supports_streaming=supports_streaming,
                                                  supports_language_detect=True, native_sample_rate=16000, arch="fake")
        self.log = []
        self.streams = []
        self.unloaded = False

    def run(self, pcm, language=None, on_poll=None):
        self.log.append({"n": len(pcm), "language": language})
        return "  hello world  "

    def open_stream(self, language=None):
        st = _FakeStream(self.log, language)
        self.streams.append(st)
        return st

    def unload(self):
        self.unloaded = True


class _Dev:
    def __init__(self, index, kind):
        self.index, self.kind, self.name, self.description = index, kind, f"{kind}{index}", kind
        self.mem_total = self.mem_free = 0


@pytest.fixture
def fake_native(monkeypatch, tmp_path):
    """sys.modules['sokuji_native'] fake + hf_hub_download → a dummy gguf path."""
    created = {}
    opts = {"languages": (), "supports_streaming": False}
    mod = types.ModuleType("sokuji_native")
    mod.NativeError = type("NativeError", (RuntimeError,), {"status": -6})
    mod.init = lambda n_threads=0, log=None: None
    mod.devices = lambda: [_Dev(0, "vulkan"), _Dev(1, "cpu")]
    mod.device_free_mem = lambda i: 0

    def _load(path, device=None):
        m = _FakeModel(path, device, **opts)
        created["model"] = m
        return m
    mod.asr_load = _load
    monkeypatch.setitem(sys.modules, "sokuji_native", mod)
    native.reset_for_tests()
    gguf = tmp_path / "x.gguf"
    gguf.write_bytes(b"GGUF")
    import huggingface_hub
    monkeypatch.setattr(huggingface_hub, "hf_hub_download", lambda repo, fname, **kw: str(gguf))
    created["opts"] = opts
    created["mod"] = mod
    return created


REF = "handy-computer/SenseVoiceSmall-gguf/SenseVoiceSmall-Q8_0.gguf"


def test_load_maps_device_to_native_device(fake_native):
    b = make_backend("native_asr")
    b.load(REF, "vulkan", "q8_0")
    assert b.is_loaded
    assert fake_native["model"].device.kind == "vulkan"
    b.load(REF, "cpu", "q8_0")
    assert fake_native["model"].device.kind == "cpu"


def test_unknown_device_kind_is_backend_error(fake_native):
    b = make_backend("native_asr")
    with pytest.raises(BackendLoadError):
        b.load(REF, "metal", "q8_0")         # no metal device in this process


def test_transcribe_passes_language_and_strips(fake_native):
    b = make_backend("native_asr")
    b.load(REF, "cpu", "q8_0")
    r = b.transcribe(np.zeros(16000, np.float32), "zh")
    assert r.text == "hello world" and r.language == "zh"
    assert fake_native["model"].log[0]["language"] == "zh"
    b.transcribe(np.zeros(160, np.float32), "")
    assert fake_native["model"].log[1]["language"] is None      # empty → autodetect


def test_transcribe_before_load_raises_backend_error():
    b = make_backend("native_asr")
    with pytest.raises(BackendLoadError):
        b.transcribe(np.zeros(1600, np.float32), "en")


def test_empty_audio_short_circuits(fake_native):
    b = make_backend("native_asr")
    b.load(REF, "cpu", "q8_0")
    assert b.transcribe(np.zeros(0, np.float32), "en").text == ""
    assert fake_native["model"].log == []


def test_unload_unloads_model(fake_native):
    b = make_backend("native_asr")
    b.load(REF, "cpu", "q8_0")
    m = fake_native["model"]
    b.unload()
    assert not b.is_loaded and m.unloaded


def test_bad_artifact_raises(fake_native):
    b = make_backend("native_asr")
    with pytest.raises(BackendLoadError):
        b.load("just-a-repo-id", "cpu", "q8_0")


def test_missing_gguf_raises(fake_native, monkeypatch):
    import huggingface_hub
    monkeypatch.setattr(huggingface_hub, "hf_hub_download",
                        lambda *a, **k: (_ for _ in ()).throw(FileNotFoundError("not cached")))
    b = make_backend("native_asr")
    with pytest.raises(BackendLoadError):
        b.load(REF, "cpu", "q8_0")


def test_native_error_becomes_backend_error(fake_native):
    mod = fake_native["mod"]
    def _boom(path, device=None):
        raise mod.NativeError("sk_asr_load: out of memory")
    mod.asr_load = _boom
    b = make_backend("native_asr")
    with pytest.raises(BackendLoadError) as e:
        b.load(REF, "vulkan", "q8_0")
    assert "out of memory" in e.value.reason           # accel's OOM fallback keys on this substring


def test_missing_wheel_is_backend_error(monkeypatch, tmp_path):
    monkeypatch.setitem(sys.modules, "sokuji_native", None)
    native.reset_for_tests()
    b = make_backend("native_asr")
    with pytest.raises(BackendLoadError):
        b.load(REF, "cpu", "q8_0")


@pytest.mark.skipif(not os.environ.get("SOKUJI_RUN_NATIVE_ASR"),
                    reason="set SOKUJI_RUN_NATIVE_ASR=1 (needs the sokuji-native wheel + cached GGUF)")
def test_real_sensevoice_smoke():
    import wave
    from huggingface_hub import snapshot_download
    native.reset_for_tests()
    b = make_backend("native_asr")
    b.load(REF, "cpu", "q8_0")
    d = snapshot_download("csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17")
    w = wave.open(f"{d}/test_wavs/en.wav", "rb")
    audio = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
    r = b.transcribe(audio, "en")
    assert "tribal" in r.text.lower()
    b.unload()


# ── streaming variant (native_asr_stream) ───────────────────────────────────


def _load_stream_backend(fake):
    fake["opts"]["supports_streaming"] = True
    b = make_backend("native_asr_stream")
    b.load("handy-computer/Voxtral-Mini-4B-Realtime-2602-gguf/Voxtral-Mini-4B-Realtime-2602-Q4_K_M.gguf",
           "vulkan", "q4_k_m")
    return b


def test_stream_backend_flag_and_open(fake_native):
    b = _load_stream_backend(fake_native)
    assert b.STREAMING is True and b.is_loaded
    assert b.open_stream() is not None


def test_open_stream_passes_language(fake_native):
    b = _load_stream_backend(fake_native)
    model = fake_native["model"]
    b.open_stream("ja")
    assert model.streams[-1].language == "ja"
    b.open_stream("")
    assert model.streams[-1].language is None
    b.open_stream()
    assert model.streams[-1].language is None


def test_stream_language_mapped_to_model_tag_set(fake_native):
    fake_native["opts"]["languages"] = ("en-US", "zh-CN", "ja-JP")     # nemotron shape
    b = _load_stream_backend(fake_native)
    model = fake_native["model"]
    b.open_stream("zh")
    assert model.streams[-1].language == "zh-CN"
    b.open_stream("ko")
    assert model.streams[-1].language is None                          # unknown → autodetect
    model.capabilities.languages = ("en", "zh", "ja")                  # whisper/voxtral shape
    b.open_stream("zh")
    assert model.streams[-1].language == "zh"


def test_batch_language_mapped_to_model_tag_set(fake_native):
    fake_native["opts"]["languages"] = ("en-US", "zh-CN")
    b = _load_stream_backend(fake_native)
    b.transcribe(np.zeros(1600, np.float32), "zh")
    assert fake_native["model"].log[-1]["language"] == "zh-CN"


def test_stream_drain_emits_committed_deltas_only(fake_native):
    b = _load_stream_backend(fake_native)
    st = b.open_stream()
    raw = fake_native["model"].streams[-1]
    st.feed(np.zeros(1600, np.float32))
    assert st.drain() == []
    raw.set_committed("The tribal")
    st.feed(np.zeros(1600, np.float32))          # the view refreshes on feed
    assert st.drain() == ["The tribal"]
    raw.set_committed("The tribal chief called")
    st.feed(np.zeros(1600, np.float32))
    assert st.drain() == [" chief called"]
    assert st.drain() == []


def test_stream_end_finalizes_and_returns_full_text(fake_native):
    b = _load_stream_backend(fake_native)
    st = b.open_stream()
    raw = fake_native["model"].streams[-1]
    raw.set_committed("hello world")
    assert st.end() == "hello world FINAL"
    assert raw.closed


def test_stream_reopen_after_end_uses_same_model(fake_native):
    b = _load_stream_backend(fake_native)
    st = b.open_stream()
    st.end()
    assert b.open_stream() is not None
    assert len(fake_native["model"].streams) == 2


def test_stream_abort_closes_without_finalize(fake_native):
    b = _load_stream_backend(fake_native)
    st = b.open_stream()
    raw = fake_native["model"].streams[-1]
    st.abort()
    assert raw.closed and not raw.finalized


def test_stream_backend_rejects_non_streaming_model(fake_native):
    fake_native["opts"]["supports_streaming"] = False
    b = make_backend("native_asr_stream")
    with pytest.raises(BackendLoadError):
        b.load("handy-computer/x-gguf/x.gguf", "cpu", "q4_k_m")
    assert not b.is_loaded
