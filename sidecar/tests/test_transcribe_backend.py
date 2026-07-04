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
