"""NativeTtsBackend: sokuji_native's TtsModel faked at the module level (the venv
wheel is Vulkan-lane 0.4.0 and has no TtsModel yet — Task 3 lands the real 0.5.0
build). Mirrors test_translate_backend.py's native_env fixture shape."""
import threading
import time
import types

import numpy as np
import pytest

from sokuji_sidecar import backends
from sokuji_sidecar.planner import PlanConfig

REF = "acme/pocket-tts-en-gguf/pocket_tts-en/model.gguf"


class NativeError(RuntimeError):
    """Local stand-in for sokuji_native.NativeError -- the fake must not import
    the real wheel (the venv has no TtsModel yet), but the exception TYPE
    tts_backend.py actually sees from a real unloaded handle matters: the real
    TtsModel raises exactly this (a RuntimeError subclass, per
    native/python/sokuji_native/__init__.py's `class NativeError(RuntimeError)`)
    when any method is called with `self._h is None`. tts_backend.py's `except
    Exception` clauses in load()/generate_stream()'s worker don't discriminate
    by type, so a plain RuntimeError would already be "caught the same way" --
    this class exists so a test can assert specifically "this was the
    unloaded-handle error", not just "some exception happened" (review round 1,
    CQ-7)."""

    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


class _FakeTtsModel:
    def __init__(self, path, family, device, language, log, caps, chunks=None):
        self.path, self.family, self.device, self.language = path, family, device, language
        self.log = log
        self.capabilities = caps
        self.chunks = chunks if chunks is not None else [np.ones(100, np.float32)]
        self.voice = None
        self.preset = None
        self.unloaded = False

    def _check_loaded(self, op):
        if self.unloaded:
            # Mirrors the real binding's own guard exactly (see NativeError's
            # docstring): a stray call reaching an already-unloaded handle must
            # look like what sokuji_native itself would raise, not a generic
            # fake-only error a real bug could hide behind.
            raise NativeError(-6, f"{op}: model is unloaded")

    def presets(self):
        self._check_loaded("sk_tts_presets")
        return ["Alba", "Bella"]

    def set_voice(self, pcm, sr, ref_text=None):
        self._check_loaded("sk_tts_set_voice")
        self.voice = (len(pcm), sr, ref_text)

    def set_preset(self, name):
        self._check_loaded("sk_tts_set_preset")
        self.preset = name

    def synth(self, text, language=None, speed=1.0, on_chunk=None):
        self._check_loaded("sk_tts_synth")
        self.log.append(("synth", text, language, speed, on_chunk is not None))
        if on_chunk is None:
            samples = np.concatenate(self.chunks) if self.chunks else np.empty(0, np.float32)
            return samples, self.capabilities.sample_rate
        for chunk in self.chunks:
            if on_chunk(chunk, self.capabilities.sample_rate) is False:
                raise NativeError(-7, "sk_tts_synth: cancelled")
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
        self.stop_seen = threading.Event()   # set right before the cancel-raise

    def synth(self, text, language=None, speed=1.0, on_chunk=None):
        if on_chunk is None:
            return super().synth(text, language, speed, on_chunk)
        self._check_loaded("sk_tts_synth")
        self.log.append(("synth", text, language, speed, True))
        if on_chunk(self.chunks[0], self.capabilities.sample_rate) is False:
            self.stop_seen.set()
            raise NativeError(-7, "sk_tts_synth: cancelled")
        self.before_gate.set()
        self.gate.wait(timeout=5)
        for chunk in self.chunks[1:]:
            if on_chunk(chunk, self.capabilities.sample_rate) is False:
                self.stop_seen.set()
                raise NativeError(-7, "sk_tts_synth: cancelled")
        return np.concatenate(self.chunks), self.capabilities.sample_rate


class _PreGatedTtsModel(_FakeTtsModel):
    """Blocks BEFORE producing any chunk at all -- lets a test call cancel()
    while certain the worker hasn't reached on_chunk yet, to prove a cancel()
    issued before the first pull still lands (CQ-6's eager-bind fix)."""

    def __init__(self, *a, **kw):
        super().__init__(*a, **kw)
        self.started = threading.Event()
        self.release = threading.Event()
        self.stop_seen = threading.Event()

    def synth(self, text, language=None, speed=1.0, on_chunk=None):
        if on_chunk is None:
            return super().synth(text, language, speed, on_chunk)
        self._check_loaded("sk_tts_synth")
        self.started.set()
        self.release.wait(timeout=5)
        for chunk in self.chunks:
            if on_chunk(chunk, self.capabilities.sample_rate) is False:
                self.stop_seen.set()
                raise NativeError(-7, "sk_tts_synth: cancelled")
        return np.concatenate(self.chunks), self.capabilities.sample_rate


class _BoomingStreamModel(_FakeTtsModel):
    """Streaming fake whose synth() raises a REAL (non-cancellation) failure
    partway through, unprompted by on_chunk's return value -- exercises CQ-2's
    fix: this must reach the caller as a raised exception, not vanish."""

    def synth(self, text, language=None, speed=1.0, on_chunk=None):
        if on_chunk is None:
            return super().synth(text, language, speed, on_chunk)
        self._check_loaded("sk_tts_synth")
        on_chunk(self.chunks[0], self.capabilities.sample_rate)
        raise RuntimeError("decoder blew up")


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


# ── review round 1 ──────────────────────────────────────────────────────────

def test_generate_stream_real_failure_raises_not_swallowed(native_env):
    """CQ-2: a genuine synth() failure (not our own cancellation) must reach the
    caller as a raised exception -- swallowing it would look like a successful,
    merely-truncated stream (a tts_done with fewer/zero samples) instead of the
    wire's error path firing."""
    created, log = native_env
    created["caps"] = _caps(streaming=True)
    created["model_factory"] = lambda *a: _BoomingStreamModel(*a, chunks=[np.ones(10, np.float32)])
    b = backends.make_backend("native_tts")
    b.load(REF, "cpu", "q8_0", config=PlanConfig(tts_family="omnivoice"))

    gen = b.generate_stream("hello")
    first = next(gen)                     # the one chunk emitted before the boom
    assert isinstance(first, np.ndarray)
    with pytest.raises(RuntimeError, match="decoder blew up"):
        next(gen)


def test_tts_engine_worker_turns_backend_raise_into_error_event(native_env):
    """End-to-end proof CQ-2 actually reaches the wire: tts_engine.generate_stream
    wraps `for chunk in backend.generate_stream(...)` in its own try/except, so a
    raised backend failure must become an "error" push, not a tts_done claiming
    success."""
    import asyncio
    from sokuji_sidecar import tts_engine

    created, log = native_env
    created["caps"] = _caps(streaming=True)
    created["model_factory"] = lambda *a: _BoomingStreamModel(*a, chunks=[np.ones(10, np.float32)])
    b = backends.make_backend("native_tts")
    b.load(REF, "cpu", "q8_0", config=PlanConfig(tts_family="omnivoice"))

    eng = tts_engine.TtsEngine()
    eng._backend = b
    eng._native_sr = b.sample_rate
    sent = []

    async def send(obj=None, binary=None):
        sent.append((obj, binary))

    asyncio.run(eng.generate_stream("hi", 1.0, send, lambda: False, msg_id="m1"))
    kinds = [o.get("type") for o, _ in sent if o]
    assert "error" in kinds
    assert "tts_done" not in kinds


def test_generate_stream_close_cancels_the_worker(native_env):
    """CQ-3: a consumer abandoning the generator (break/close/GC) must cancel the
    worker instead of leaving it to run the native call to completion unobserved."""
    created, log = native_env
    created["caps"] = _caps(streaming=True)
    created["model_factory"] = lambda *a: _GatedTtsModel(
        *a, chunks=[np.ones(10, np.float32), np.ones(10, np.float32)])
    b = backends.make_backend("native_tts")
    b.load(REF, "cpu", "q8_0", config=PlanConfig(tts_family="omnivoice"))
    model = created["model"]

    gen = b.generate_stream("hello")
    first = next(gen)
    assert isinstance(first, np.ndarray)
    assert model.before_gate.wait(timeout=5)

    gen.close()                 # consumer abandons the stream
    model.gate.set()            # let the worker attempt the next chunk

    assert model.stop_seen.wait(timeout=5)   # on_chunk saw cancelled -> worker stopped


def test_unload_during_active_stream_joins_worker_before_model_unload(native_env):
    """CQ-4: unload() must cancel AND join the streaming worker before calling
    model.unload() -- otherwise sk_tts_unload could block on the native mutex a
    synth() in flight is holding, or free the handle out from under it."""
    created, log = native_env
    created["caps"] = _caps(streaming=True)
    created["model_factory"] = lambda *a: _GatedTtsModel(
        *a, chunks=[np.ones(10, np.float32), np.ones(10, np.float32)])
    b = backends.make_backend("native_tts")
    b.load(REF, "cpu", "q8_0", config=PlanConfig(tts_family="omnivoice"))
    model = created["model"]

    order = []
    orig_unload = model.unload

    def tracked_unload():
        order.append("model.unload")
        orig_unload()

    model.unload = tracked_unload

    gen = b.generate_stream("hello")
    next(gen)                                     # chunk 0 delivered; worker now gated
    assert model.before_gate.wait(timeout=5)

    unload_thread = threading.Thread(target=b.unload)
    unload_thread.start()
    time.sleep(0.1)                                # unload() should be blocked in join()
    assert unload_thread.is_alive()                # proves unload() actually waits
    assert order == []                             # model.unload() not reached yet

    model.gate.set()                               # release the worker; it observes cancel
    unload_thread.join(timeout=5)
    assert not unload_thread.is_alive()
    assert order == ["model.unload"]               # joined BEFORE calling model.unload
    assert model.stop_seen.is_set()
    assert b.is_loaded is False


def test_generate_stream_eagerly_binds_cancel_event_before_first_next(native_env):
    """CQ-6: generate_stream() must bind self._cancel_event (and start the
    worker) BEFORE returning, not lazily on the caller's first next() -- else a
    cancel() issued in the window before the first pull targets nothing (or a
    stale prior stream's event) and is silently lost."""
    created, log = native_env
    created["caps"] = _caps(streaming=True)
    created["model_factory"] = lambda *a: _PreGatedTtsModel(
        *a, chunks=[np.ones(10, np.float32), np.ones(10, np.float32)])
    b = backends.make_backend("native_tts")
    b.load(REF, "cpu", "q8_0", config=PlanConfig(tts_family="omnivoice"))
    model = created["model"]

    gen = b.generate_stream("hello")     # NOT iterated yet
    assert model.started.wait(timeout=5)  # worker running, blocked before any chunk
    b.cancel()                            # must bind to THIS stream's event
    model.release.set()                   # let synth proceed now that cancel is armed

    chunks = list(gen)                    # drains to completion
    # Put-then-check: the chunk in flight when on_chunk observes the cancel is
    # still delivered, but the SECOND chunk is never produced -- so exactly one
    # chunk comes through. Without the eager-bind fix, cancel() would have
    # targeted a stale/absent event and BOTH chunks would have come through.
    assert len(chunks) == 1
    assert model.stop_seen.wait(timeout=5)


def test_generate_passes_through_2d_stereo_samples_unchanged(native_env):
    """CQ-7: MOSS-shaped fakes emit real 2-D (frames, channels) chunks -- generate()
    must pass that shape through unchanged (the engine, not the backend, downmixes)."""
    created, log = native_env
    stereo = np.ones((5, 2), np.float32)
    created["model_factory"] = lambda *a: _FakeTtsModel(*a, chunks=[stereo])
    b = backends.make_backend("native_tts")
    b.load(REF, "cpu", "q8_0", config=PlanConfig(tts_family="moss_tts_nano"))
    samples, _ms = b.generate("hello")
    assert samples.ndim == 2 and samples.shape == (5, 2)


def test_generate_stream_passes_through_2d_stereo_chunks_unchanged(native_env):
    created, log = native_env
    created["caps"] = _caps(streaming=True)
    stereo_chunks = [np.ones((5, 2), np.float32), np.full((5, 2), 2.0, np.float32)]
    created["model_factory"] = lambda *a: _FakeTtsModel(*a, chunks=stereo_chunks)
    b = backends.make_backend("native_tts")
    b.load(REF, "cpu", "q8_0", config=PlanConfig(tts_family="moss_tts_nano"))
    chunks = list(b.generate_stream("hello"))
    assert [c.shape for c in chunks] == [(5, 2), (5, 2)]


def test_fake_model_raises_native_error_after_unload():
    """CQ-7: the fake's own honesty check -- a stray call reaching an
    already-unloaded handle raises the same exception TYPE the real binding
    would (NativeError), not a generic stand-in that could mask a real bug in
    the backend's use-after-unload handling."""
    log = []
    model = _FakeTtsModel("path", "moss_tts_nano", "dev:cpu", None, log, _caps())
    model.unload()
    with pytest.raises(NativeError):
        model.synth("hi")
    with pytest.raises(NativeError):
        model.set_voice(np.zeros(10, np.float32), 24000)
    with pytest.raises(NativeError):
        model.set_preset("x")
    with pytest.raises(NativeError):
        model.presets()


def test_load_error_wraps_native_error_from_the_binding(native_env, monkeypatch):
    """tts_backend.py's load() catches whatever the binding raises (including a
    real NativeError, e.g. no matching device or an unknown family) and turns
    it into BackendLoadError so the resolver can fall back -- exercised here
    with the same exception type load()/generate_stream() actually see."""
    from sokuji_sidecar import native

    def boom(path, family, device=None, language=None):
        raise NativeError(-3, "sk_tts_load: unknown family")

    monkeypatch.setattr(native, "module", lambda: types.SimpleNamespace(tts_load=boom))
    b = backends.make_backend("native_tts")
    with pytest.raises(backends.BackendLoadError, match="unknown family"):
        b.load(REF, "cpu", "q8_0", config=PlanConfig(tts_family="bogus_family"))
