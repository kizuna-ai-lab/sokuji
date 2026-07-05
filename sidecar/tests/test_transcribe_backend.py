"""TranscribeCppBackend: transcribe.cpp seam faked; real-model smoke behind
SOKUJI_RUN_TRANSCRIBE_CPP=1 (uses the cached SenseVoice Q8_0 GGUF)."""
import os
import sys
import types

import numpy as np
import pytest

from sokuji_sidecar import transcribe_backend
from sokuji_sidecar.backends import BackendLoadError, make_backend


class _FakeResult:
    def __init__(self, text):
        self.text = text


class _FakeSession:
    def __init__(self, log):
        self._log = log
        self.closed = False

    def run(self, pcm, **kw):
        self._log.append({"n": len(pcm), **kw})
        return _FakeResult("  hello world  ")

    def close(self):
        self.closed = True


class _FakeModel:
    def __init__(self, path, backend="auto", **kw):
        self.path = path
        self.backend = backend
        self.closed = False
        self.log = []

    def session(self):
        self._session = _FakeSession(self.log)
        return self._session

    def close(self):
        self.closed = True


@pytest.fixture
def fake_tc(monkeypatch, tmp_path):
    created = {}
    mod = types.ModuleType("transcribe_cpp")

    def _model(path, backend="auto", **kw):
        m = _FakeModel(path, backend=backend, **kw)
        created["model"] = m
        return m
    mod.Model = _model
    monkeypatch.setitem(sys.modules, "transcribe_cpp", mod)
    gguf = tmp_path / "x.gguf"
    gguf.write_bytes(b"GGUF")
    monkeypatch.setattr(transcribe_backend, "hf_hub_download",
                        lambda repo, fname, **kw: str(gguf), raising=False)
    import huggingface_hub
    monkeypatch.setattr(huggingface_hub, "hf_hub_download",
                        lambda repo, fname, **kw: str(gguf))
    return created


def test_load_maps_device_to_backend_kind(fake_tc):
    b = make_backend("transcribe_cpp")
    b.load("handy-computer/SenseVoiceSmall-gguf/SenseVoiceSmall-Q8_0.gguf", "vulkan", "q8_0")
    assert b.is_loaded
    assert fake_tc["model"].backend == "vulkan"


def test_transcribe_passes_language_and_strips(fake_tc):
    b = make_backend("transcribe_cpp")
    b.load("handy-computer/SenseVoiceSmall-gguf/SenseVoiceSmall-Q8_0.gguf", "cpu", "q8_0")
    r = b.transcribe(np.zeros(16000, np.float32), "zh")
    assert r.text == "hello world" and r.language == "zh"
    assert fake_tc["model"].log[0]["language"] == "zh"
    # empty language → None hint (model auto-detects)
    b.transcribe(np.zeros(160, np.float32), "")
    assert fake_tc["model"].log[1]["language"] is None


def test_empty_audio_short_circuits(fake_tc):
    b = make_backend("transcribe_cpp")
    b.load("handy-computer/SenseVoiceSmall-gguf/SenseVoiceSmall-Q8_0.gguf", "cpu", "q8_0")
    assert b.transcribe(np.zeros(0, np.float32), "en").text == ""
    assert fake_tc["model"].log == []          # session never invoked


def test_unload_closes_session_and_model(fake_tc):
    b = make_backend("transcribe_cpp")
    b.load("handy-computer/SenseVoiceSmall-gguf/SenseVoiceSmall-Q8_0.gguf", "cpu", "q8_0")
    m = fake_tc["model"]
    b.unload()
    assert not b.is_loaded and m.closed and m._session.closed


def test_bad_artifact_raises(fake_tc):
    b = make_backend("transcribe_cpp")
    with pytest.raises(BackendLoadError):
        b.load("just-a-repo-id", "cpu", "q8_0")      # no file component


def test_missing_gguf_raises(monkeypatch):
    import huggingface_hub
    monkeypatch.setattr(huggingface_hub, "hf_hub_download",
                        lambda *a, **k: (_ for _ in ()).throw(FileNotFoundError("not cached")))
    b = make_backend("transcribe_cpp")
    with pytest.raises(BackendLoadError):
        b.load("handy-computer/SenseVoiceSmall-gguf/SenseVoiceSmall-Q8_0.gguf", "cpu", "q8_0")


@pytest.mark.skipif(not os.environ.get("SOKUJI_RUN_TRANSCRIBE_CPP"),
                    reason="set SOKUJI_RUN_TRANSCRIBE_CPP=1 (needs transcribe-cpp wheel + cached GGUF)")
def test_real_sensevoice_smoke():
    import wave
    from huggingface_hub import snapshot_download
    b = make_backend("transcribe_cpp")
    b.load("handy-computer/SenseVoiceSmall-gguf/SenseVoiceSmall-Q8_0.gguf", "cpu", "q8_0")
    d = snapshot_download("csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17")
    w = wave.open(f"{d}/test_wavs/en.wav", "rb")
    audio = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
    r = b.transcribe(audio, "en")
    assert "tribal" in r.text.lower()
    b.unload()


# ── streaming variant (transcribe_cpp_stream, Voxtral Realtime) ─────────────


class _FakeStreamText:
    def __init__(self, committed, tentative=""):
        self.committed = committed
        self.tentative = tentative
        self.full = committed + tentative


class _FakeStream:
    """Scripted committed-text progression + finalize behavior."""

    def __init__(self, log):
        self._log = log
        self._committed = ""
        self._reset = False

    def feed(self, pcm):
        self._log.append(("feed", len(pcm)))

    def set_committed(self, text):
        self._committed = text

    def text(self):
        return _FakeStreamText(self._committed)

    def finalize(self):
        self._log.append(("finalize",))
        self._committed = self._committed + " FINAL"

    def reset(self):
        self._log.append(("reset",))
        self._reset = True


class _FakeStreamSession(_FakeSession):
    def __init__(self, log):
        super().__init__(log)
        self.streams = []

    def stream(self, **kw):
        st = _FakeStream(self._log)
        self.streams.append(st)
        self.stream_kwargs = kw
        return st


class _FakeStreamModel(_FakeModel):
    supports_streaming = True

    @property
    def capabilities(self):
        return types.SimpleNamespace(supports_streaming=self.supports_streaming)

    def session(self):
        self._session = _FakeStreamSession(self.log)
        return self._session


@pytest.fixture
def fake_stream_tc(monkeypatch, tmp_path):
    created = {}
    mod = types.ModuleType("transcribe_cpp")

    def _model(path, backend="auto", **kw):
        m = _FakeStreamModel(path, backend=backend, **kw)
        created["model"] = m
        return m
    mod.Model = _model
    monkeypatch.setitem(sys.modules, "transcribe_cpp", mod)
    gguf = tmp_path / "x.gguf"
    gguf.write_bytes(b"GGUF")
    import huggingface_hub
    monkeypatch.setattr(huggingface_hub, "hf_hub_download",
                        lambda repo, fname, **kw: str(gguf))
    return created


def _load_stream_backend(fake):
    b = make_backend("transcribe_cpp_stream")
    b.load("handy-computer/Voxtral-Mini-4B-Realtime-2602-gguf/Voxtral-Mini-4B-Realtime-2602-Q4_K_M.gguf",
           "vulkan", "q4_k_m")
    return b


def test_stream_backend_flag_and_open(fake_stream_tc):
    b = _load_stream_backend(fake_stream_tc)
    assert b.STREAMING is True and b.is_loaded
    st = b.open_stream()
    assert st is not None


def test_open_stream_passes_language(fake_stream_tc):
    """REGRESSION (PR #279 review): the batch path passes the user's source
    language to session.run(); the streaming path must hand it to
    session.stream() too, or multilingual cards silently fall back to
    autodetect and can transcribe in the wrong language."""
    b = _load_stream_backend(fake_stream_tc)
    session = fake_stream_tc["model"]._session
    b.open_stream("ja")
    assert session.stream_kwargs == {"language": "ja"}
    b.open_stream("")           # empty selection → autodetect, same as batch
    assert session.stream_kwargs == {"language": None}
    b.open_stream()
    assert session.stream_kwargs == {"language": None}


def test_stream_drain_emits_committed_deltas_only(fake_stream_tc):
    b = _load_stream_backend(fake_stream_tc)
    st = b.open_stream()
    raw = fake_stream_tc["model"]._session.streams[-1]
    st.feed(np.zeros(1600, np.float32))
    assert st.drain() == []                      # nothing committed yet
    raw.set_committed("The tribal")
    assert st.drain() == ["The tribal"]
    raw.set_committed("The tribal chief called")  # grows → only the delta
    assert st.drain() == [" chief called"]
    assert st.drain() == []                      # unchanged → no delta


def test_stream_end_finalizes_and_returns_full_text(fake_stream_tc):
    b = _load_stream_backend(fake_stream_tc)
    st = b.open_stream()
    raw = fake_stream_tc["model"]._session.streams[-1]
    raw.set_committed("hello world")
    final = st.end()
    assert final == "hello world FINAL"          # finalize() ran, full committed returned
    assert raw._reset                            # session returned to idle


def test_stream_reopen_after_end_uses_same_session(fake_stream_tc):
    b = _load_stream_backend(fake_stream_tc)
    st = b.open_stream()
    st.end()
    st2 = b.open_stream()                        # engine reopens at next utterance
    assert st2 is not None
    assert len(fake_stream_tc["model"]._session.streams) == 2


def test_stream_abort_resets_without_finalize(fake_stream_tc):
    b = _load_stream_backend(fake_stream_tc)
    st = b.open_stream()
    raw = fake_stream_tc["model"]._session.streams[-1]
    st.abort()
    assert raw._reset and ("finalize",) not in fake_stream_tc["model"].log


def test_stream_backend_rejects_non_streaming_model(fake_stream_tc):
    fake_stream_tc_model_cls = fake_stream_tc  # fixture installed the module
    import transcribe_cpp as mod
    orig = mod.Model
    def _nostream(path, backend="auto", **kw):
        m = orig(path, backend=backend, **kw)
        m.supports_streaming = False
        return m
    mod.Model = _nostream
    b = make_backend("transcribe_cpp_stream")
    with pytest.raises(BackendLoadError):
        b.load("handy-computer/x-gguf/x.gguf", "cpu", "q4_k_m")
