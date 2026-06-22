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
