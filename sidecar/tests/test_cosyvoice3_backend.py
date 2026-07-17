import ast
import inspect
import pathlib

import numpy as np
import pytest

from sokuji_sidecar import tts_backends
from sokuji_sidecar.backends import make_backend, BackendLoadError


def test_flags():
    b = make_backend("cosyvoice3_onnx")
    assert (b.NAME, b.STREAMING, b.CLONES) == ("cosyvoice3_onnx", False, True)
    assert b.sample_rate == 24000
    assert not b.is_loaded


def test_set_voice_requires_transcript():
    b = make_backend("cosyvoice3_onnx")
    b._sessions = {}  # pretend loaded
    b._tok = object()
    with pytest.raises(BackendLoadError):
        b.set_voice(np.zeros(16000, np.float32), 16000, ref_text="")


def test_voice_cache_hits(monkeypatch):
    b = make_backend("cosyvoice3_onnx")
    b._sessions, b._tok = {}, object()
    calls = []
    monkeypatch.setattr(tts_backends._cv3_pipeline, "process_prompt",
                        lambda *a, **k: calls.append(1) or "PROMPT")
    audio = np.zeros(16000, np.float32)
    b.set_voice(audio, 16000, ref_text="hello")
    b.set_voice(audio, 16000, ref_text="hello")
    assert len(calls) == 1 and b._prompt == "PROMPT"


def test_generate_threads_speed_and_rate(monkeypatch):
    b = make_backend("cosyvoice3_onnx")
    b._sessions, b._tok, b._prompt = {}, object(), "PROMPT"
    seen = {}
    def fake_syn(sessions, tok, text, prompt, rng, speed=1.0):
        seen.update(text=text, speed=speed)
        return np.zeros(2400, np.float32)
    monkeypatch.setattr(tts_backends._cv3_pipeline, "synthesize", fake_syn)
    audio, ms = b.generate("hello", speed=1.5)
    assert seen == {"text": "hello", "speed": 1.5}
    assert audio.dtype == np.float32 and isinstance(ms, int)


def test_module_has_no_librosa_or_transformers_import():
    pkg = pathlib.Path(tts_backends.__file__).parent / "cosyvoice3"
    for py in pkg.glob("*.py"):
        tree = ast.parse(py.read_text())
        for node in ast.walk(tree):
            names = []
            if isinstance(node, ast.Import):
                names = [a.name for a in node.names]
            elif isinstance(node, ast.ImportFrom) and node.module:
                names = [node.module]
            for n in names:
                assert not n.startswith(("librosa", "transformers", "torch")), \
                    f"{py.name} imports {n}"


def test_engine_threads_ref_text():
    # the engine passes ref_text only to backends whose set_voice accepts it
    sig = inspect.signature(make_backend("cosyvoice3_onnx").set_voice)
    assert "ref_text" in sig.parameters
