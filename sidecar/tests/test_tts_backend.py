"""NativeTtsBackend: sokuji_native's TtsModel faked at the module level (the venv
wheel is Vulkan-lane 0.4.0 and has no TtsModel yet — Task 3 lands the real 0.5.0
build). Mirrors test_translate_backend.py's native_env fixture shape."""
import threading
import types

import numpy as np
import pytest

from sokuji_sidecar import backends
from sokuji_sidecar.planner import PlanConfig

REF = "acme/pocket-tts-en-gguf/pocket_tts-en/model.gguf"


class _FakeTtsModel:
    def __init__(self, path, family, device, language, log, caps, chunks=None):
        self.path, self.family, self.device, self.language = path, family, device, language
        self.log = log
        self.capabilities = caps
        self.chunks = chunks if chunks is not None else [np.ones(100, np.float32)]
        self.voice = None
        self.preset = None
        self.unloaded = False

    def presets(self):
        return ["Alba", "Bella"]

    def set_voice(self, pcm, sr, ref_text=None):
        self.voice = (len(pcm), sr, ref_text)

    def set_preset(self, name):
        self.preset = name

    def synth(self, text, language=None, speed=1.0, on_chunk=None):
        self.log.append(("synth", text, language, speed, on_chunk is not None))
        if on_chunk is None:
            samples = np.concatenate(self.chunks) if self.chunks else np.empty(0, np.float32)
            return samples, self.capabilities.sample_rate
        for chunk in self.chunks:
            if on_chunk(chunk, self.capabilities.sample_rate) is False:
                raise RuntimeError("CANCELLED")
        samples = np.concatenate(self.chunks)
        return samples, self.capabilities.sample_rate

    def unload(self):
        self.unloaded = True


class _GatedTtsModel(_FakeTtsModel):
    """Blocks between chunk 0 and chunk 1 so a test can inject cancel()
    deterministically — same shape as tts_engine tests' _FakePausedStream."""

    def __init__(self, *a, **kw):
        super().__init__(*a, **kw)
        self.before_gate = threading.Event()
        self.gate = threading.Event()

    def synth(self, text, language=None, speed=1.0, on_chunk=None):
        if on_chunk is None:
            return super().synth(text, language, speed, on_chunk)
        self.log.append(("synth", text, language, speed, True))
        if on_chunk(self.chunks[0], self.capabilities.sample_rate) is False:
            raise RuntimeError("CANCELLED")
        self.before_gate.set()
        self.gate.wait(timeout=5)
        for chunk in self.chunks[1:]:
            if on_chunk(chunk, self.capabilities.sample_rate) is False:
                raise RuntimeError("CANCELLED")
        return np.concatenate(self.chunks), self.capabilities.sample_rate


def _caps(streaming=False, clones=True, transcript_required=False, sample_rate=24000):
    return types.SimpleNamespace(streaming=streaming, clones=clones,
                                 transcript_required=transcript_required, sample_rate=sample_rate)


@pytest.fixture
def native_env(monkeypatch):
    from sokuji_sidecar import native
    log = []
    created = {"model_factory": _FakeTtsModel, "caps": _caps()}

    def fake_snapshot_download(repo, allow_patterns=None, local_files_only=None):
        created["snapshot_call"] = (repo, allow_patterns, local_files_only)
        return "/snap"

    import huggingface_hub
    monkeypatch.setattr(huggingface_hub, "snapshot_download", fake_snapshot_download)

    def fake_tts_load(path, family, device=None, language=None):
        created["load_call"] = (path, family, device, language)
        model = created["model_factory"](path, family, device, language, log, created["caps"])
        created["model"] = model
        return model

    mod = types.SimpleNamespace(tts_load=fake_tts_load)
    monkeypatch.setattr(native, "module", lambda: mod)
    monkeypatch.setattr(native, "device_for", lambda kind: f"dev:{kind}" if kind in ("cpu", "vulkan", "metal")
                        else (_ for _ in ()).throw(backends.BackendLoadError(f"no {kind} device")))
    return created, log


def test_registry_has_native_tts():
    b = backends.make_backend("native_tts")
    assert b.NAME == "native_tts"
    assert b.STREAMING is False and b.CLONES is False and b.sample_rate == 24000
    assert b.is_loaded is False


def test_load_resolves_scoped_snapshot_and_passes_path_as_given(native_env):
    created, _log = native_env
    b = backends.make_backend("native_tts")
    b.load(REF, "cpu", "q8_0", config=PlanConfig(tts_family="pocket_tts"))
    assert created["snapshot_call"] == ("acme/pocket-tts-en-gguf", ["pocket_tts-en/*"], True)
    assert created["load_call"][0] == "/snap/pocket_tts-en/model.gguf"
    assert b.is_loaded


def test_load_falls_back_to_bare_filename_pattern_when_artifact_has_no_dir(native_env):
    created, _log = native_env
    b = backends.make_backend("native_tts")
    b.load("acme/flat-repo/model.gguf", "cpu", "q8_0", config=PlanConfig(tts_family="moss_tts_nano"))
    assert created["snapshot_call"] == ("acme/flat-repo", ["model.gguf"], True)
    assert created["load_call"][0] == "/snap/model.gguf"


def test_load_passes_family_and_explicit_device(native_env):
    created, _log = native_env
    b = backends.make_backend("native_tts")
    b.load(REF, "vulkan", "q8_0", config=PlanConfig(tts_family="pocket_tts", tts_language="english"))
    _path, family, device, language = created["load_call"]
    assert family == "pocket_tts"
    assert device == "dev:vulkan"
    assert language == "english"


def test_load_cpu_passes_explicit_cpu_device_not_null(native_env):
    """Regression (slice-3 F1 lesson, mirrored from translate_backend): a cpu plan
    must resolve and pass an explicit CPU device, never skip straight to None."""
    created, _log = native_env
    b = backends.make_backend("native_tts")
    b.load(REF, "cpu", "q8_0", config=PlanConfig(tts_family="pocket_tts"))
    assert created["load_call"][2] == "dev:cpu"


def test_load_requires_tts_family(native_env):
    b = backends.make_backend("native_tts")
    with pytest.raises(backends.BackendLoadError):
        b.load(REF, "cpu", "q8_0", config=PlanConfig())
    with pytest.raises(backends.BackendLoadError):
        b.load(REF, "cpu", "q8_0", config=None)


def test_load_requires_dir_plus_file_artifact(native_env):
    b = backends.make_backend("native_tts")
    with pytest.raises(backends.BackendLoadError):
        b.load("acme/bare-repo", "cpu", "q8_0", config=PlanConfig(tts_family="moss_tts_nano"))


def test_load_unknown_device_raises_backend_load_error(native_env):
    b = backends.make_backend("native_tts")
    with pytest.raises(backends.BackendLoadError):
        b.load(REF, "cuda", "q8_0", config=PlanConfig(tts_family="pocket_tts"))
    assert not b.is_loaded


def test_capabilities_become_instance_attrs_shadowing_class_defaults(native_env):
    created, _log = native_env
    created["caps"] = _caps(streaming=True, clones=True, sample_rate=44100)
    b = backends.make_backend("native_tts")
    b.load(REF, "cpu", "q8_0", config=PlanConfig(tts_family="supertonic"))
    assert b.STREAMING is True and b.CLONES is True and b.sample_rate == 44100
    # A second, unloaded instance is unaffected -- these are instance attrs.
    b2 = backends.make_backend("native_tts")
    assert b2.STREAMING is False and b2.CLONES is False and b2.sample_rate == 24000


def test_generate_oneshot_calls_synth_without_on_chunk(native_env):
    created, log = native_env
    created["model_factory"] = lambda *a: _FakeTtsModel(*a, chunks=[np.ones(50, np.float32), np.ones(50, np.float32)])
    b = backends.make_backend("native_tts")
    b.load(REF, "cpu", "q8_0", config=PlanConfig(tts_family="moss_tts_nano"))
    samples, ms = b.generate("hello", speed=1.5)
    assert samples.dtype == np.float32 and samples.shape == (100,)
    assert ms >= 0
    assert log[-1] == ("synth", "hello", None, 1.5, False)


def test_set_language_is_stored_and_passed_per_synth(native_env):
    created, log = native_env
    b = backends.make_backend("native_tts")
    b.load(REF, "cpu", "q8_0", config=PlanConfig(tts_family="moss_tts_nano"))
    b.set_language("ja")
    b.generate("hello")
    assert log[-1] == ("synth", "hello", "ja", 1.0, False)


def test_generate_stream_yields_all_chunks(native_env):
    created, log = native_env
    created["caps"] = _caps(streaming=True)
    created["model_factory"] = lambda *a: _FakeTtsModel(
        *a, chunks=[np.ones(10, np.float32), np.ones(10, np.float32), np.ones(10, np.float32)])
    b = backends.make_backend("native_tts")
    b.load(REF, "cpu", "q8_0", config=PlanConfig(tts_family="omnivoice"))
    chunks = list(b.generate_stream("hello"))
    assert len(chunks) == 3
    assert all(isinstance(c, np.ndarray) and c.dtype == np.float32 for c in chunks)
    assert log[-1] == ("synth", "hello", None, 1.0, True)


def test_generate_stream_cancel_stops_before_the_next_chunk(native_env):
    created, log = native_env
    created["caps"] = _caps(streaming=True)
    created["model_factory"] = lambda *a: _GatedTtsModel(
        *a, chunks=[np.ones(10, np.float32), np.ones(10, np.float32), np.ones(10, np.float32)])
    b = backends.make_backend("native_tts")
    b.load(REF, "cpu", "q8_0", config=PlanConfig(tts_family="omnivoice"))
    model = created["model"]

    gen = b.generate_stream("hello")
    first = next(gen)                        # chunk 0, produced before the gate
    assert isinstance(first, np.ndarray)
    assert model.before_gate.wait(timeout=5)

    b.cancel()                               # set the cancel event before releasing
    model.gate.set()                         # worker resumes, computes chunk 1

    remaining = list(gen)                    # drains to the sentinel
    # Chunk 1 is still delivered (already computed when on_chunk observed the
    # cancel flag -- put-then-check, per the contract); chunk 2 is never reached.
    assert len(remaining) == 1
    assert 1 + len(remaining) < len(model.chunks)


def test_cancel_without_active_stream_is_a_noop(native_env):
    b = backends.make_backend("native_tts")
    b.load(REF, "cpu", "q8_0", config=PlanConfig(tts_family="moss_tts_nano"))
    b.cancel()  # must not raise


def test_set_voice_plumbs_pcm_len_sample_rate_and_ref_text(native_env):
    native_env_data, _log = native_env
    b = backends.make_backend("native_tts")
    b.load(REF, "cpu", "q8_0", config=PlanConfig(tts_family="qwen3_tts"))
    b.set_voice(np.ones(2400, np.float32), 24000, ref_text="hello there")
    assert native_env_data["model"].voice == (2400, 24000, "hello there")


def test_set_voice_empty_ref_text_normalizes_to_none(native_env):
    created, _log = native_env
    b = backends.make_backend("native_tts")
    b.load(REF, "cpu", "q8_0", config=PlanConfig(tts_family="moss_tts_nano"))
    b.set_voice(np.ones(2400, np.float32), 24000)
    assert created["model"].voice == (2400, 24000, None)


def test_set_builtin_voice_calls_set_preset(native_env):
    created, _log = native_env
    b = backends.make_backend("native_tts")
    b.load(REF, "cpu", "q8_0", config=PlanConfig(tts_family="supertonic"))
    b.set_builtin_voice("Robert")
    assert created["model"].preset == "Robert"


def test_list_builtin_voices_calls_presets(native_env):
    b = backends.make_backend("native_tts")
    b.load(REF, "cpu", "q8_0", config=PlanConfig(tts_family="supertonic"))
    assert b.list_builtin_voices() == ["Alba", "Bella"]


def test_methods_raise_backend_load_error_when_not_loaded():
    b = backends.make_backend("native_tts")
    with pytest.raises(backends.BackendLoadError):
        b.generate("hi")
    with pytest.raises(backends.BackendLoadError):
        list(b.generate_stream("hi"))
    with pytest.raises(backends.BackendLoadError):
        b.set_voice(np.zeros(10, np.float32), 24000)
    with pytest.raises(backends.BackendLoadError):
        b.set_builtin_voice("x")
    with pytest.raises(backends.BackendLoadError):
        b.list_builtin_voices()


def test_unload_calls_model_unload_and_clears_state(native_env):
    created, _log = native_env
    b = backends.make_backend("native_tts")
    b.load(REF, "cpu", "q8_0", config=PlanConfig(tts_family="moss_tts_nano"))
    model = created["model"]
    b.unload()
    assert model.unloaded is True
    assert b.is_loaded is False


def test_load_unloads_prior_model_first(native_env):
    created, _log = native_env
    b = backends.make_backend("native_tts")
    b.load(REF, "cpu", "q8_0", config=PlanConfig(tts_family="moss_tts_nano"))
    first_model = created["model"]
    b.load(REF, "cpu", "q8_0", config=PlanConfig(tts_family="moss_tts_nano"))
    assert first_model.unloaded is True
    assert created["model"] is not first_model
