import sys
import types

import numpy as np
import pytest
from sokuji_sidecar import backends


def test_make_backend_unknown_raises():
    with pytest.raises(backends.BackendLoadError):
        backends.make_backend("nope")


def test_register_and_make_returns_instance():
    @backends.register_backend
    class _Dummy:
        NAME = "dummy_test"
        def __init__(self): self.loaded = False
        def load(self, model_ref, device, compute_type): self.loaded = True
        def transcribe(self, samples, language): return backends.AsrResult("x")
        def unload(self): self.loaded = False
        @property
        def is_loaded(self): return self.loaded

    b = backends.make_backend("dummy_test")
    assert b.NAME == "dummy_test"
    b.load("m", "cpu", "int8")
    assert b.is_loaded
    assert b.transcribe(np.zeros(4, np.float32), None).text == "x"


def test_asr_result_defaults():
    r = backends.AsrResult("hello")
    assert r.text == "hello" and r.language is None


def _install_fake_faster_whisper(monkeypatch, *, fail=False):
    seg = types.SimpleNamespace(text=" hello")
    captured = {}

    class FakeWhisperModel:
        def __init__(self, model_ref, device, compute_type):
            if fail:
                raise RuntimeError("CUDA driver missing")
            captured["args"] = (model_ref, device, compute_type)
        def transcribe(self, samples, language, beam_size, vad_filter):
            captured["transcribe"] = (len(samples), language, beam_size, vad_filter)
            return [seg], types.SimpleNamespace(language="en")

    mod = types.ModuleType("faster_whisper")
    mod.WhisperModel = FakeWhisperModel
    monkeypatch.setitem(sys.modules, "faster_whisper", mod)
    return captured


def test_ctranslate2_load_and_transcribe(monkeypatch):
    cap = _install_fake_faster_whisper(monkeypatch)
    b = backends.make_backend("ctranslate2")
    assert not b.is_loaded
    b.load("large-v3", "cpu", "int8")
    assert b.is_loaded and cap["args"] == ("large-v3", "cpu", "int8")
    out = b.transcribe(np.zeros(160, np.float32), "en")
    assert out.text == "hello"
    assert cap["transcribe"][1] == "en" and cap["transcribe"][3] is False


def test_ctranslate2_load_failure_raises_backendloaderror(monkeypatch):
    _install_fake_faster_whisper(monkeypatch, fail=True)
    b = backends.make_backend("ctranslate2")
    with pytest.raises(backends.BackendLoadError):
        b.load("large-v3", "cuda", "float16")
