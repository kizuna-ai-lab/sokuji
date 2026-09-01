"""NativeTtsBackend: sokuji_native's TtsModel faked at the module level (the venv
wheel is Vulkan-lane 0.4.0 and has no TtsModel yet — Task 3 lands the real 0.5.0
build). Mirrors test_translate_backend.py's native_env fixture shape."""
import asyncio
import os
import threading
import time
import types

import numpy as np
import pytest

from sokuji_sidecar import backends
from sokuji_sidecar import tts_backend
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


class _SlowOneShotModel(_FakeTtsModel):
    """A one-shot (no on_chunk) synth() that blocks until released, then returns
    normally -- used by the I3/I-1 unload-joins/waits-before-model-unload tests."""

    def __init__(self, *a, **kw):
        super().__init__(*a, **kw)
        self.started = threading.Event()
        self.release = threading.Event()

    def synth(self, text, language=None, speed=1.0, on_chunk=None):
        self._check_loaded("sk_tts_synth")
        self.started.set()
        self.release.wait(timeout=5)
        samples = np.concatenate(self.chunks) if self.chunks else np.empty(0, np.float32)
        return samples, self.capabilities.sample_rate


class _WedgedOneShotModel(_FakeTtsModel):
    """A one-shot synth() that blocks FOREVER and never returns -- models a
    native call that is truly wedged. Exists ONLY to prove unload()'s
    _UNLOAD_DEADLINE_S backstop actually bounds the wait for a one-shot
    generate() regardless -- see
    test_unload_waits_out_the_deadline_when_the_oneshot_native_call_never_finishes.
    The worker thread that calls into this is always started as a daemon (see
    that test) so the wedged call never prevents the test process from
    exiting."""

    def __init__(self, *a, **kw):
        super().__init__(*a, **kw)
        self.started = threading.Event()

    def synth(self, text, language=None, speed=1.0, on_chunk=None):
        self._check_loaded("sk_tts_synth")
        self.started.set()
        threading.Event().wait()   # never released
        return np.empty(0, np.float32), self.capabilities.sample_rate   # pragma: no cover


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


class _MultiStreamTrackingModel(_FakeTtsModel):
    """Tracks how many synth() calls are concurrently inside on_chunk-driven
    generation (active/max_active), and gates each call INDEPENDENTLY (one
    threading.Event pair per call, not shared) so a test can reproduce two
    overlapping streams -- an active one and a superseded orphan -- and
    control each one's progress deterministically. Reproduces review round
    2's regression: a single _cancel_event/_worker_thread slot lost track of
    a superseded stream's worker the moment a newer stream registered."""

    def __init__(self, *a, **kw):
        super().__init__(*a, **kw)
        self.active = 0
        self.max_active = 0
        self._count_lock = threading.Lock()
        self.calls: list[dict] = []   # one entry per synth() call, in order

    def synth(self, text, language=None, speed=1.0, on_chunk=None):
        if on_chunk is None:
            return super().synth(text, language, speed, on_chunk)
        self._check_loaded("sk_tts_synth")
        call = {"before_gate": threading.Event(), "gate": threading.Event(), "text": text}
        self.calls.append(call)
        with self._count_lock:
            self.active += 1
            self.max_active = max(self.max_active, self.active)
        try:
            if on_chunk(self.chunks[0], self.capabilities.sample_rate) is False:
                raise NativeError(-7, "sk_tts_synth: cancelled")
            call["before_gate"].set()
            call["gate"].wait(timeout=5)
            for chunk in self.chunks[1:]:
                if on_chunk(chunk, self.capabilities.sample_rate) is False:
                    raise NativeError(-7, "sk_tts_synth: cancelled")
            return np.concatenate(self.chunks), self.capabilities.sample_rate
        finally:
            with self._count_lock:
                self.active -= 1


class _PocketLikeModel(_FakeTtsModel):
    """R34 fix round 1: mirrors the REAL pocket_tts engine's session-prepare
    requirement -- live-verified by the reviewer against real ggufs, a bare
    synth() with no preset/voice set raises exactly this audio.cpp error
    ('PocketTTS session prepare() requires a session voice via --voice-id or
    --voice-ref'), NOT the generic R16 message qwen3_tts/omnivoice raise.
    Also overrides presets() to return pocket's real single-preset shape
    (['alba'], the embeddings/*.safetensors basename our card ships) instead
    of the generic two-preset default _FakeTtsModel.presets() returns."""

    def presets(self):
        self._check_loaded("sk_tts_presets")
        return ["alba"]

    def synth(self, text, language=None, speed=1.0, on_chunk=None):
        if self.preset is None and self.voice is None:
            raise NativeError(-8, "PocketTTS session prepare() requires a "
                               "session voice via --voice-id or --voice-ref")
        return super().synth(text, language, speed, on_chunk)


def _caps(streaming=False, clones=True, transcript_required=False, sample_rate=24000):
    return types.SimpleNamespace(streaming=streaming, clones=clones,
                                 transcript_required=transcript_required, sample_rate=sample_rate)


@pytest.fixture
def native_env(monkeypatch, tmp_path):
    from sokuji_sidecar import native
    log = []
    # R18: load() hard-links the resolved file out of the snapshot before ever
    # calling tts_load() -- that needs a REAL file on disk, not a bare string.
    # Pre-create every path this test file's two fixed model_ref shapes (REF, and
    # the bare-filename artifact) ever resolve to, as a SYMLINK into a separate
    # blobs/ directory -- exactly the shape a real HF snapshot_download() produces
    # (a content-addressed blob store the snapshot symlinks into), not a plain
    # file. This is deliberate, not incidental: a plain file would have hidden the
    # platform-specific os.link()-vs-symlink bug _stage_for_native() now works
    # around (see its own docstring) -- these fixtures must keep exercising the
    # REAL shape, not a simplified stand-in for it.
    blobs_dir = tmp_path / "blobs"
    blobs_dir.mkdir()
    snap_dir = tmp_path / "snap"
    for i, rel in enumerate(("pocket_tts-en/model.gguf", "model.gguf")):
        blob = blobs_dir / f"blob{i}"
        blob.write_bytes(b"fake gguf bytes")
        link = snap_dir / rel
        link.parent.mkdir(parents=True, exist_ok=True)
        link.symlink_to(os.path.relpath(blob, link.parent))
    # R18: _stage_for_native()'s staging root lives under
    # huggingface_hub.constants.HF_HUB_CACHE (read at call time) -- point it
    # somewhere real and test-private too.
    import huggingface_hub.constants as _hfc
    monkeypatch.setattr(_hfc, "HF_HUB_CACHE", str(tmp_path / "hub"))

    created = {"model_factory": _FakeTtsModel, "caps": _caps(), "snap_dir": str(snap_dir)}

    def fake_snapshot_download(repo, allow_patterns=None, local_files_only=None):
        created["snapshot_call"] = (repo, allow_patterns, local_files_only)
        return str(snap_dir)

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


def test_load_resolves_scoped_snapshot_and_stages_gguf_before_loading(native_env):
    """R18: load() no longer passes the raw snapshot path straight through -- a real
    HF snapshot's file is a symlink into the content-addressed blob store, which
    breaks audio.cpp's own canonicalizing model loader (see tts_backend.py's module
    docstring). load() hard-links the resolved file into a staging tree first
    (_stage_for_native()) and passes THAT path to tts_load()."""
    created, _log = native_env
    b = backends.make_backend("native_tts")
    b.load(REF, "cpu", "q8_0", config=PlanConfig(tts_family="pocket_tts"))
    assert created["snapshot_call"] == ("acme/pocket-tts-en-gguf", ["pocket_tts-en/*"], True)
    staged_path = created["load_call"][0]
    source_path = f"{created['snap_dir']}/pocket_tts-en/model.gguf"
    assert staged_path != source_path
    assert staged_path.endswith("/pocket_tts-en/model.gguf")
    assert os.path.isfile(staged_path)
    assert os.path.samefile(staged_path, source_path)   # same inode -- a hard link, not a copy
    assert b.is_loaded


def test_load_falls_back_to_bare_filename_pattern_when_artifact_has_no_dir(native_env):
    created, _log = native_env
    b = backends.make_backend("native_tts")
    b.load("acme/flat-repo/model.gguf", "cpu", "q8_0", config=PlanConfig(tts_family="moss_tts_nano"))
    assert created["snapshot_call"] == ("acme/flat-repo", ["model.gguf"], True)
    staged_path = created["load_call"][0]
    assert staged_path != f"{created['snap_dir']}/model.gguf"
    assert staged_path.endswith("/model.gguf")
    assert os.path.isfile(staged_path)


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
    samples, rate, ms = b.generate("hello", speed=1.5)
    assert samples.dtype == np.float32 and samples.shape == (100,)
    assert rate == created["caps"].sample_rate   # I2: the actual per-synth rate
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
    b.set_voice(np.ones(10, np.float32), 24000, ref_text="hi")   # R16: omnivoice needs a voice first
    chunks = list(b.generate_stream("hello"))
    assert len(chunks) == 3
    # I2: each chunk is (pcm, actual_rate), not a bare array.
    assert all(isinstance(c, np.ndarray) and c.dtype == np.float32 and sr == created["caps"].sample_rate
               for c, sr in chunks)
    assert log[-1] == ("synth", "hello", None, 1.0, True)


def test_generate_stream_cancel_stops_before_the_next_chunk(native_env):
    created, log = native_env
    created["caps"] = _caps(streaming=True)
    created["model_factory"] = lambda *a: _GatedTtsModel(
        *a, chunks=[np.ones(10, np.float32), np.ones(10, np.float32), np.ones(10, np.float32)])
    b = backends.make_backend("native_tts")
    b.load(REF, "cpu", "q8_0", config=PlanConfig(tts_family="omnivoice"))
    b.set_voice(np.ones(10, np.float32), 24000, ref_text="hi")   # R16: omnivoice needs a voice first
    model = created["model"]

    gen = b.generate_stream("hello")
    first, _sr = next(gen)                   # chunk 0, produced before the gate
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
    b.set_voice(np.ones(10, np.float32), 24000, ref_text="hi")   # R16: omnivoice needs a voice first

    gen = b.generate_stream("hello")
    first, _sr = next(gen)                # the one chunk emitted before the boom
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
    b.set_voice(np.ones(10, np.float32), 24000, ref_text="hi")   # R16: omnivoice needs a voice first

    eng = tts_engine.TtsEngine()
    eng._backend = b
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
    b.set_voice(np.ones(10, np.float32), 24000, ref_text="hi")   # R16: omnivoice needs a voice first
    model = created["model"]

    gen = b.generate_stream("hello")
    first, _sr = next(gen)
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
    b.set_voice(np.ones(10, np.float32), 24000, ref_text="hi")   # R16: omnivoice needs a voice first
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
    b.set_voice(np.ones(10, np.float32), 24000, ref_text="hi")   # R16: omnivoice needs a voice first
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
    samples, _rate, _ms = b.generate("hello")
    assert samples.ndim == 2 and samples.shape == (5, 2)


def test_generate_stream_passes_through_2d_stereo_chunks_unchanged(native_env):
    created, log = native_env
    created["caps"] = _caps(streaming=True)
    stereo_chunks = [np.ones((5, 2), np.float32), np.full((5, 2), 2.0, np.float32)]
    created["model_factory"] = lambda *a: _FakeTtsModel(*a, chunks=stereo_chunks)
    b = backends.make_backend("native_tts")
    b.load(REF, "cpu", "q8_0", config=PlanConfig(tts_family="moss_tts_nano"))
    chunks = list(b.generate_stream("hello"))
    assert [c.shape for c, _sr in chunks] == [(5, 2), (5, 2)]


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


# ── review round 2: unload() must join EVERY outstanding worker ─────────────

def test_unload_joins_every_outstanding_worker_including_a_superseded_orphan(native_env):
    """Reproduces the round-2 regression: _cancel_event/_worker_thread were
    single slots, so a SUPERSEDED stream's worker (the "orphan") escaped
    unload()'s cancel+join entirely the moment a newer stream's
    generate_stream() overwrote those slots. The reviewer proved this
    reachable via tts_init -> tts_generate -> supersede tts_generate ->
    teardown: model.unload() fired while the orphan was still inside
    self._model.synth(...), with two synth() calls concurrently active on one
    backend. This reproduces that exact shape directly against the backend."""
    created, log = native_env
    created["caps"] = _caps(streaming=True)
    created["model_factory"] = lambda *a: _MultiStreamTrackingModel(
        *a, chunks=[np.ones(10, np.float32), np.ones(10, np.float32)])
    b = backends.make_backend("native_tts")
    b.load(REF, "cpu", "q8_0", config=PlanConfig(tts_family="omnivoice"))
    b.set_voice(np.ones(10, np.float32), 24000, ref_text="hi")   # R16: omnivoice needs a voice first
    model = created["model"]

    # Stream A: the one about to be superseded ("the orphan").
    gen_a = b.generate_stream("first")
    next(gen_a)
    call_a = model.calls[0]
    assert call_a["before_gate"].wait(timeout=5)

    # Supersede, exactly like _h_tts_generate's ordering: cancel the CURRENT
    # stream (A) BEFORE starting the new one (B).
    b.cancel()
    gen_b = b.generate_stream("second")
    next(gen_b)
    call_b = model.calls[1]
    assert call_b["before_gate"].wait(timeout=5)

    # A's cancel flag is set, but A is still gated -- it hasn't noticed the
    # cancellation yet. This IS the "orphan still inside synth()" window the
    # bug report describes: both calls are concurrently active right now.
    assert model.active == 2
    documented_max_concurrency = model.max_active   # reported below, not asserted tightly

    order = []
    orig_unload = model.unload

    def tracked_unload():
        order.append(("model.unload", model.active))
        orig_unload()

    model.unload = tracked_unload

    unload_thread = threading.Thread(target=b.unload)
    unload_thread.start()
    time.sleep(0.1)
    assert unload_thread.is_alive()       # blocked joining outstanding workers
    assert order == []                    # model.unload() not reached yet

    # Release BOTH gates: A observes its (already-set) cancel flag on its next
    # chunk and stops; B (the active stream) runs its own remaining chunk and
    # completes normally.
    call_a["gate"].set()
    call_b["gate"].set()
    unload_thread.join(timeout=5)

    assert not unload_thread.is_alive()
    # zero synth() calls active at the moment model.unload() actually fired --
    # both workers were fully joined first, regardless of which one started
    # first or which one was "current" when unload() was called.
    assert order == [("model.unload", 0)]
    assert documented_max_concurrency >= 2   # sanity: the race was genuinely exercised
    assert b.is_loaded is False


def test_registry_self_cleans_up_after_a_completed_stream(native_env):
    """After a stream drains to completion (no supersede, no crash), its
    (thread, event) entry must not linger in the registry -- otherwise
    unload() would keep joining already-finished threads forever (harmless
    but unbounded) and the registry would grow across the process lifetime."""
    created, log = native_env
    created["caps"] = _caps(streaming=True)
    created["model_factory"] = lambda *a: _FakeTtsModel(*a, chunks=[np.ones(10, np.float32)])
    b = backends.make_backend("native_tts")
    b.load(REF, "cpu", "q8_0", config=PlanConfig(tts_family="omnivoice"))
    b.set_voice(np.ones(10, np.float32), 24000, ref_text="hi")   # R16: omnivoice needs a voice first
    list(b.generate_stream("hello"))   # drain to completion
    assert b._workers == []


# ── fix wave (2026-09-01): R16 (clone-only families need a voice before synth),
# I2 (per-synth sample rate authoritative), I3 (one-shot generate() joined by unload) ──

def test_generate_raises_when_clone_only_family_has_no_voice_set(native_env):
    """R16: qwen3_tts's base checkpoint has no default built-in voice -- a plain
    generate() with no set_voice()/set_builtin_voice() called first must raise a
    clear, family-named error BEFORE ever reaching the native layer, not whatever
    audio.cpp happens to throw that day (live-verified: "Qwen3 base TTS requires
    voice clone reference audio", task-7-report.md §3)."""
    created, log = native_env
    b = backends.make_backend("native_tts")
    b.load(REF, "cpu", "q8_0", config=PlanConfig(tts_family="qwen3_tts"))
    with pytest.raises(backends.BackendLoadError, match="qwen3_tts"):
        b.generate("hello")
    assert log == []          # never reached the native synth() call
    assert b._workers == []   # and never registered a worker for it either


def test_generate_succeeds_after_set_voice_for_clone_only_family(native_env):
    created, log = native_env
    b = backends.make_backend("native_tts")
    b.load(REF, "cpu", "q8_0", config=PlanConfig(tts_family="qwen3_tts"))
    b.set_voice(np.ones(2400, np.float32), 24000, ref_text="hello there")
    samples, rate, ms = b.generate("hello")
    assert samples.dtype == np.float32
    assert rate == created["caps"].sample_rate
    assert ms >= 0


def test_generate_stream_raises_when_clone_only_family_has_no_voice_set(native_env):
    """Same as above for the streaming family (omnivoice) -- generate_stream() is a
    PLAIN function (not a generator, see the module docstring), so the check must
    fire on the CALL itself, not lazily on the caller's first iteration."""
    created, log = native_env
    created["caps"] = _caps(streaming=True)
    b = backends.make_backend("native_tts")
    b.load(REF, "cpu", "q8_0", config=PlanConfig(tts_family="omnivoice"))
    with pytest.raises(backends.BackendLoadError, match="omnivoice"):
        b.generate_stream("hello")
    assert log == []
    assert b._workers == []   # no worker thread was ever registered


def test_generate_stream_succeeds_after_set_voice_for_clone_only_family(native_env):
    created, log = native_env
    created["caps"] = _caps(streaming=True)
    b = backends.make_backend("native_tts")
    b.load(REF, "cpu", "q8_0", config=PlanConfig(tts_family="omnivoice"))
    b.set_voice(np.ones(2400, np.float32), 24000, ref_text="hello there")
    chunks = list(b.generate_stream("hello"))
    assert len(chunks) == 1


def test_moss_is_not_gated_by_r16_and_ships_a_genuinely_working_default_voice(native_env):
    """moss_tts_nano also reports CLONES=True but ships a working built-in
    default voice -- R16 must NOT gate it (task-7-report.md §3: "a default
    built-in voice covers a plain synth call"), and (unlike pocket_tts below)
    it needs no help from R34 either: moss is not in _DEFAULT_PRESET_FAMILIES,
    and a bare synth() genuinely works with no preset ever applied."""
    b = backends.make_backend("native_tts")
    b.load(REF, "cpu", "q8_0", config=PlanConfig(tts_family="moss_tts_nano"))
    samples, _rate, _ms = b.generate("hello")   # must not raise
    assert samples.dtype == np.float32


def test_pocket_tts_is_not_gated_by_r16_and_generate_works_via_r34_default_preset(native_env):
    """R34 fix round 1: unlike moss above, pocket_tts's real engine does NOT
    ship a usable default voice -- live-verified: a bare synth() raises
    'PocketTTS session prepare() requires a session voice via --voice-id or
    --voice-ref' (see _PocketLikeModel). It is still not gated by R16 (that
    would only turn the failure into a clean error) -- instead load() applies
    pocket's first preset automatically (_DEFAULT_PRESET_FAMILIES), so a bare
    generate() genuinely succeeds. This test previously (before this fix)
    exercised ONLY moss in its body despite claiming to cover pocket too --
    it never actually loaded a pocket fake, so R34's own bug went uncaught."""
    created, _log = native_env
    created["caps"] = _caps(clones=True)
    created["model_factory"] = _PocketLikeModel
    b = backends.make_backend("native_tts")
    b.load(REF, "cpu", "q8_0", config=PlanConfig(tts_family="pocket_tts"))
    samples, _rate, _ms = b.generate("hello")   # must not raise (R34)
    assert samples.dtype == np.float32


def test_generate_returns_actual_synth_rate_not_caps_default(native_env):
    """I2: the per-synth returned rate must be authoritative -- a fake model
    returning a rate DIFFERENT from caps' advertised default must be forwarded
    unchanged, not silently replaced by the caps default."""
    created, log = native_env
    created["caps"] = _caps(sample_rate=24000)   # advertised default: 24000

    class _OddRateModel(_FakeTtsModel):
        def synth(self, text, language=None, speed=1.0, on_chunk=None):
            self._check_loaded("sk_tts_synth")
            self.log.append(("synth", text, language, speed, False))
            return np.concatenate(self.chunks), 16000   # actual rate differs from caps

    created["model_factory"] = _OddRateModel
    b = backends.make_backend("native_tts")
    b.load(REF, "cpu", "q8_0", config=PlanConfig(tts_family="moss_tts_nano"))
    _samples, rate, _ms = b.generate("hello")
    assert rate == 16000   # forwarded, not clobbered by caps' 24000


def test_generate_stream_yields_the_actual_per_chunk_rate(native_env):
    """I2, streaming leg: each chunk carries the rate audio.cpp handed to on_chunk
    for THAT chunk, not the family's advertised caps default."""
    created, log = native_env
    created["caps"] = _caps(streaming=True, sample_rate=24000)

    class _OddRateStreamModel(_FakeTtsModel):
        def synth(self, text, language=None, speed=1.0, on_chunk=None):
            self._check_loaded("sk_tts_synth")
            for chunk in self.chunks:
                on_chunk(chunk, 16000)   # actual rate differs from caps
            return np.concatenate(self.chunks), 16000

    created["model_factory"] = lambda *a: _OddRateStreamModel(*a, chunks=[np.ones(10, np.float32)])
    b = backends.make_backend("native_tts")
    b.load(REF, "cpu", "q8_0", config=PlanConfig(tts_family="omnivoice"))
    b.set_voice(np.ones(10, np.float32), 24000, ref_text="hi")   # R16
    chunks = list(b.generate_stream("hello"))
    assert len(chunks) == 1
    _pcm, sr = chunks[0]
    assert sr == 16000


def test_unload_during_inflight_oneshot_generate_joins_before_model_unload(native_env):
    """I3 / I-1 (final fix wave): the ORIGINAL version of this test ran generate()
    on a dedicated threading.Thread, which terminates on its own once its target
    function returns -- that MASKED the I-1 defect, because unload()'s old
    thread.join(timeout=...) genuinely worked correctly against that kind of
    thread. In production generate() always runs via tts_engine's real
    `loop.run_in_executor(None, ...)`, i.e. on a ThreadPoolExecutor worker that
    returns to the POOL, IDLE, once the callable returns -- it does NOT
    terminate, so joining THAT thread burns unload()'s full deadline every
    single time regardless of whether generate() had already finished (see
    tts_backend.py's module docstring, "Final fix wave" paragraph, for the full
    trace). Reproduce the real shape here: schedule generate() through
    asyncio's actual default executor, not a bare Thread, so this test would
    have caught the original regression."""
    created, log = native_env
    created["model_factory"] = _SlowOneShotModel
    b = backends.make_backend("native_tts")
    b.load(REF, "cpu", "q8_0", config=PlanConfig(tts_family="moss_tts_nano"))
    model = created["model"]

    order = []
    orig_unload = model.unload

    def tracked_unload():
        order.append("model.unload")
        orig_unload()

    model.unload = tracked_unload

    result = {}

    async def run_generate():
        loop = asyncio.get_running_loop()
        result["out"] = await loop.run_in_executor(None, b.generate, "hello")

    gen_thread = threading.Thread(target=lambda: asyncio.run(run_generate()))
    gen_thread.start()
    assert model.started.wait(timeout=5)     # generate() is now inside synth()

    unload_thread = threading.Thread(target=b.unload)
    unload_thread.start()
    time.sleep(0.1)                          # unload() should be blocked waiting on the in-flight call
    assert unload_thread.is_alive()
    assert order == []                       # model.unload() not reached yet

    model.release.set()                      # let the in-flight generate() finish
    unload_thread.join(timeout=5)
    gen_thread.join(timeout=5)

    assert not unload_thread.is_alive()      # I-1: returned promptly, not after the full deadline
    assert order == ["model.unload"]         # waited BEFORE calling model.unload
    assert b.is_loaded is False
    assert "out" in result                   # generate() itself completed normally


def test_unload_waits_out_the_deadline_when_the_oneshot_native_call_never_finishes(
        native_env, monkeypatch):
    """I-1: unload()'s wait is bounded by _UNLOAD_DEADLINE_S regardless of
    whether the in-flight one-shot native call ever actually stops -- the
    deadline is the UAF backstop of last resort (module docstring), not merely
    an optimization for the common case. Shrink the deadline so this test
    doesn't need a real 10s wait; _WedgedOneShotModel's synth() deliberately
    never returns, so `done` is never set. unload() must still return once ITS
    (shrunk) deadline elapses, and the handle must still be freed even though
    the worker never actually stopped."""
    monkeypatch.setattr(tts_backend, "_UNLOAD_DEADLINE_S", 0.3)
    created, log = native_env
    created["model_factory"] = _WedgedOneShotModel
    b = backends.make_backend("native_tts")
    b.load(REF, "cpu", "q8_0", config=PlanConfig(tts_family="moss_tts_nano"))
    model = created["model"]

    gen_thread = threading.Thread(target=b.generate, args=("hello",), daemon=True)
    gen_thread.start()
    assert model.started.wait(timeout=5)     # generate() is now inside synth(), wedged

    t0 = time.monotonic()
    b.unload()
    elapsed = time.monotonic() - t0

    assert elapsed >= 0.25          # waited out (approximately) the shrunk deadline
    assert elapsed < 3.0            # ... but did not hang indefinitely either
    assert model.unloaded is True   # backstop: freed regardless of the wedged worker
    assert b.is_loaded is False


def test_cancel_during_inflight_oneshot_is_a_harmless_noop(native_env):
    """A one-shot generate()'s registry entry has no cancel event (I3) -- cancel()
    must not crash when the most-recently-started entry is a one-shot."""
    created, log = native_env
    created["model_factory"] = _SlowOneShotModel
    b = backends.make_backend("native_tts")
    b.load(REF, "cpu", "q8_0", config=PlanConfig(tts_family="moss_tts_nano"))
    model = created["model"]

    gen_thread = threading.Thread(target=b.generate, args=("hello",))
    gen_thread.start()
    assert model.started.wait(timeout=5)
    b.cancel()          # must not raise
    model.release.set()
    gen_thread.join(timeout=5)


def test_oneshot_registry_self_cleans_up_after_completion(native_env):
    b = backends.make_backend("native_tts")
    b.load(REF, "cpu", "q8_0", config=PlanConfig(tts_family="moss_tts_nano"))
    b.generate("hello")
    assert b._workers == []


# ── Round 2 (2026-09-01): R18 -- hard-link staging for audio.cpp's canonicalizing
# loader ──────────────────────────────────────────────────────────────────────────

def test_stage_for_native_is_idempotent_and_replaces_a_stale_entry(tmp_path, monkeypatch):
    """Direct unit test of _stage_for_native()'s own documented contract, below the
    NativeTtsBackend.load() layer."""
    from sokuji_sidecar import tts_backend
    import huggingface_hub.constants as hfc
    monkeypatch.setattr(hfc, "HF_HUB_CACHE", str(tmp_path / "hub"))

    source = tmp_path / "snap" / "dir" / "model.gguf"
    source.parent.mkdir(parents=True)
    source.write_bytes(b"real content")

    staged1 = tts_backend._stage_for_native("acme/repo", "rev1", "dir/model.gguf", str(source))
    assert os.path.isfile(staged1)
    assert os.path.samefile(staged1, source)   # a hard link, not a copy
    ino1 = os.stat(staged1).st_ino

    # Idempotent: re-staging the SAME source is a no-op (same inode, not re-linked).
    staged2 = tts_backend._stage_for_native("acme/repo", "rev1", "dir/model.gguf", str(source))
    assert staged2 == staged1
    assert os.stat(staged2).st_ino == ino1

    # A stale/foreign entry at the same staged path (shouldn't happen in practice,
    # since (repo, rev, rel_path) keys the path deterministically -- but proves the
    # "clean replace" branch) is cleanly replaced back to point at `source`.
    other_source = tmp_path / "snap" / "dir2" / "other.gguf"
    other_source.parent.mkdir(parents=True)
    other_source.write_bytes(b"different content")
    os.remove(staged1)
    os.link(str(other_source), staged1)
    staged3 = tts_backend._stage_for_native("acme/repo", "rev1", "dir/model.gguf", str(source))
    assert os.path.samefile(staged3, source)


def test_stage_for_native_resolves_a_real_symlinked_source_not_the_platforms_link_quirk(tmp_path, monkeypatch):
    """Regression: `source` shaped exactly like a REAL HF snapshot entry -- a symlink
    into a separate blobs/ directory, not a plain file -- must stage to a real,
    non-symlink file with the correct content. Live-verified gap this test exists to
    catch: on at least one platform, os.link(symlink_source, dest) (even with the
    documented follow_symlinks=True default) created ANOTHER SYMLINK sharing the
    ORIGINAL symlink's inode -- preserving its OLD relative target string -- instead
    of a hard link to the symlink's TARGET; that target string then resolved to the
    WRONG path once evaluated relative to the staging directory's different
    depth/nesting (a broken link). _stage_for_native() must not depend on
    os.link()'s own symlink-following behavior at all."""
    from sokuji_sidecar import tts_backend
    import huggingface_hub.constants as hfc
    monkeypatch.setattr(hfc, "HF_HUB_CACHE", str(tmp_path / "hub"))

    blob = tmp_path / "cache" / "blobs" / "abc123"
    blob.parent.mkdir(parents=True)
    blob.write_bytes(b"real blob content")

    snap_link = tmp_path / "cache" / "snapshots" / "rev1" / "dir" / "model.gguf"
    snap_link.parent.mkdir(parents=True)
    snap_link.symlink_to(os.path.relpath(blob, snap_link.parent))
    assert os.path.islink(snap_link)
    assert snap_link.read_bytes() == b"real blob content"   # sanity: the symlink itself resolves fine here

    staged = tts_backend._stage_for_native("acme/repo", "rev1", "dir/model.gguf", str(snap_link))

    assert not os.path.islink(staged)             # a real hard link, never a symlink
    assert staged.endswith("/dir/model.gguf")      # kept its real, extension-bearing name
    assert os.path.samefile(staged, blob)          # same inode as the underlying blob
    with open(staged, "rb") as f:
        assert f.read() == b"real blob content"


def test_f2_stage_for_native_race_recovers_from_file_exists_error_without_copy(tmp_path, monkeypatch):
    """F2: a concurrent load() for the SAME card -- plausible precisely because
    the TTS engine is a process singleton (see (c)/M2: two connections both
    loading the same model at once) -- can have both callers pass the initial
    exists+samefile check (staged path absent yet) and then race into
    os.link(): the loser gets FileExistsError (an OSError subclass) once the
    winner's link has already landed. Before this fix that fell into the SAME
    `except OSError` branch as 'no hard-link support', wastefully falling back
    to a full (possibly multi-GB) file copy of a file that's already correctly
    staged. The fix re-runs the idempotency check specifically on
    FileExistsError and returns without copying when it already matches."""
    import shutil
    from sokuji_sidecar import tts_backend
    import huggingface_hub.constants as hfc
    monkeypatch.setattr(hfc, "HF_HUB_CACHE", str(tmp_path / "hub"))

    source = tmp_path / "snap" / "dir" / "model.gguf"
    source.parent.mkdir(parents=True)
    source.write_bytes(b"real content")

    real_link = os.link

    def racing_link(src, dst, *a, **kw):
        # Simulate another loader's os.link() landing between our exists+
        # samefile check and this call: create the REAL correct link (as the
        # winner would have) and THEN raise, exactly what a real race's loser
        # observes.
        real_link(src, dst)
        raise FileExistsError(17, "File exists")

    monkeypatch.setattr(os, "link", racing_link)
    copy_calls = []
    monkeypatch.setattr(shutil, "copyfile", lambda *a, **k: copy_calls.append(a))

    staged = tts_backend._stage_for_native("acme/repo", "rev1", "dir/model.gguf", str(source))

    assert os.path.samefile(staged, source)
    assert copy_calls == []          # no copy performed -- the race was recovered from


def test_load_stages_pocket_extra_files_alongside_the_gguf(native_env):
    """R18: PlanConfig.tts_extra_files (planner._plan_config, straight off
    TtsModel.extra_files) carries pocket-tts-en's embeddings/alba.safetensors --
    load() must stage it as a SIBLING of the staged gguf, matching the relative
    layout native's own preset discovery expects (gguf_parent_dir / "embeddings",
    sk_tts.cpp's own comment)."""
    created, _log = native_env
    extra_rel = "pocket_tts-en/embeddings/alba.safetensors"
    extra_source = os.path.join(created["snap_dir"], extra_rel)
    os.makedirs(os.path.dirname(extra_source), exist_ok=True)
    with open(extra_source, "wb") as f:
        f.write(b"fake safetensors bytes")

    b = backends.make_backend("native_tts")
    b.load(REF, "cpu", "q8_0", config=PlanConfig(
        tts_family="pocket_tts", tts_language="english",
        tts_extra_files=(("embeddings/alba.safetensors", 999),)))

    staged_gguf = created["load_call"][0]
    staged_extra = os.path.join(os.path.dirname(staged_gguf), "embeddings", "alba.safetensors")
    assert os.path.isfile(staged_extra)
    assert os.path.samefile(staged_extra, extra_source)


def test_load_staging_is_idempotent_across_repeated_loads(native_env):
    """R18: re-staging over an already-correct hard link is a no-op -- proven by
    loading twice and checking the staged file's inode never changes (i.e. it was
    never removed and re-linked)."""
    created, _log = native_env
    b = backends.make_backend("native_tts")
    b.load(REF, "cpu", "q8_0", config=PlanConfig(tts_family="pocket_tts"))
    staged_path = created["load_call"][0]
    first_ino = os.stat(staged_path).st_ino

    b2 = backends.make_backend("native_tts")
    b2.load(REF, "cpu", "q8_0", config=PlanConfig(tts_family="pocket_tts"))
    staged_path2 = created["load_call"][0]

    assert staged_path2 == staged_path
    assert os.stat(staged_path2).st_ino == first_ino


def test_load_falls_back_to_copy_when_hardlink_unavailable(native_env, monkeypatch):
    """R18: a filesystem that rejects os.link() (EXDEV, or no hard-link support)
    must not break loading -- fall back to a real copy."""
    created, _log = native_env

    def boom_link(*a, **kw):
        raise OSError("simulated EXDEV")

    monkeypatch.setattr(os, "link", boom_link)
    b = backends.make_backend("native_tts")
    b.load(REF, "cpu", "q8_0", config=PlanConfig(tts_family="pocket_tts"))
    assert b.is_loaded
    staged_path = created["load_call"][0]
    assert os.path.isfile(staged_path)
    with open(staged_path, "rb") as f:
        assert f.read() == b"fake gguf bytes"


def test_load_transparently_restages_after_the_staging_dir_is_wiped(native_env):
    """R18 point 4: a wiped staging tree with an intact HF cache must be
    transparently re-staged at the next load() -- no user/operator action needed."""
    created, _log = native_env
    b = backends.make_backend("native_tts")
    b.load(REF, "cpu", "q8_0", config=PlanConfig(tts_family="pocket_tts"))
    staged_path = created["load_call"][0]
    assert os.path.isfile(staged_path)

    os.remove(staged_path)   # simulate an operator/OS wiping the staging tree
    assert not os.path.exists(staged_path)

    b2 = backends.make_backend("native_tts")
    b2.load(REF, "cpu", "q8_0", config=PlanConfig(tts_family="pocket_tts"))
    staged_path2 = created["load_call"][0]

    assert staged_path2 == staged_path
    assert os.path.isfile(staged_path2)


# ── Task 4 (slice 5b, 2026-09-02): GPU warm-up synth at load() time (W-1) ────
# windows-vulkan-validation.md's W-1: the FIRST synth per family on a cold GPU
# pays a one-time pipeline-compile cost (moss_tts_nano measured 16.52s on
# Vulkan, vs 0.63-0.73s on every later process once NVIDIA's on-disk shader
# cache is warm). Ruling R33: warm up ONLY when the resolved device is not
# CPU, and NEVER for a clone-only family (_VOICE_REQUIRED_FAMILIES) -- those
# have no usable voice yet at load() time.

def test_load_on_gpu_device_runs_one_warmup_synth_and_discards_result(native_env):
    """A GPU load performs exactly one short warm-up synth through generate()'s
    own one-shot path -- the fake records it with a fixed short phrase, and its
    result never reaches load()'s own caller (load() returns None either way).
    The registry entry self-cleans before load() returns (step e): a concurrent
    unload() racing the warm-up would join/wait on it via the shared registry
    (see test_load_racing_unload_joins_the_warmup_before_freeing_the_model),
    but nothing is left registered once load() itself has returned."""
    created, log = native_env
    b = backends.make_backend("native_tts")
    b.load(REF, "vulkan", "q8_0", config=PlanConfig(tts_family="moss_tts_nano"))
    assert b.is_loaded
    assert log == [("synth", "Warm-up.", None, 1.0, False)]
    assert b._workers == []


def test_load_on_metal_device_also_runs_the_warmup(native_env):
    """R33 gates on "not cpu", not on a specific GPU kind -- metal counts too."""
    created, log = native_env
    b = backends.make_backend("native_tts")
    b.load(REF, "metal", "q8_0", config=PlanConfig(tts_family="moss_tts_nano"))
    assert log == [("synth", "Warm-up.", None, 1.0, False)]


def test_load_on_cpu_device_skips_the_warmup(native_env):
    """CPU pays nothing extra for a first synth (W-1), so load() must not spend
    any extra time synthesizing on a CPU-resolved device."""
    created, log = native_env
    b = backends.make_backend("native_tts")
    b.load(REF, "cpu", "q8_0", config=PlanConfig(tts_family="moss_tts_nano"))
    assert b.is_loaded
    assert log == []


def test_load_on_gpu_skips_the_warmup_for_a_clone_only_family(native_env):
    """qwen3_tts/omnivoice (_VOICE_REQUIRED_FAMILIES) have no usable voice at
    load() time -- warming them up would immediately hit R16's own
    _ensure_voice_ready() guard, so the warm-up must be skipped outright, not
    attempted-and-swallowed. Also proves set_voice() state is untouched."""
    created, log = native_env
    b = backends.make_backend("native_tts")
    b.load(REF, "vulkan", "q8_0", config=PlanConfig(tts_family="qwen3_tts"))
    assert b.is_loaded
    assert log == []
    assert b._voice_set is False


def test_load_on_gpu_skips_the_warmup_for_the_other_clone_only_family(native_env):
    created, log = native_env
    b = backends.make_backend("native_tts")
    b.load(REF, "vulkan", "q8_0", config=PlanConfig(tts_family="omnivoice"))
    assert b.is_loaded
    assert log == []


def test_load_on_gpu_warmup_failure_does_not_fail_the_load(native_env, capsys):
    """A warm-up is an optimization, not a correctness requirement: a fake
    model that raises on synth() must not turn a successful load() into a
    BackendLoadError -- the failure is logged to stderr and swallowed."""
    created, log = native_env

    class _BoomOnSynth(_FakeTtsModel):
        def synth(self, *a, **kw):
            raise RuntimeError("gpu pipeline compile wedged")

    created["model_factory"] = _BoomOnSynth
    b = backends.make_backend("native_tts")
    b.load(REF, "vulkan", "q8_0", config=PlanConfig(tts_family="moss_tts_nano"))   # must not raise
    assert b.is_loaded
    assert b._workers == []
    err = capsys.readouterr().err
    assert "warm-up" in err.lower() and "gpu pipeline compile wedged" in err


def test_load_on_gpu_warmup_success_logs_duration_to_stderr(native_env, capsys):
    created, log = native_env
    b = backends.make_backend("native_tts")
    b.load(REF, "vulkan", "q8_0", config=PlanConfig(tts_family="moss_tts_nano"))
    err = capsys.readouterr().err
    assert "warm-up" in err.lower()
    assert "moss_tts_nano" in err


def test_load_racing_unload_joins_the_warmup_before_freeing_the_model(native_env):
    """Step (e): the warm-up call registers in the SAME self._workers registry
    any other generate() uses -- a concurrent unload() (e.g. a second
    connection tearing down the process-singleton engine while this load() is
    still warming up) must wait for the warm-up's `done` Event before touching
    the model, exactly like any other in-flight one-shot generate() (mirrors
    test_unload_during_inflight_oneshot_generate_joins_before_model_unload)."""
    created, log = native_env
    created["model_factory"] = _SlowOneShotModel
    b = backends.make_backend("native_tts")

    def do_load():
        b.load(REF, "vulkan", "q8_0", config=PlanConfig(tts_family="moss_tts_nano"))

    load_thread = threading.Thread(target=do_load)
    load_thread.start()

    deadline = time.monotonic() + 5
    while created.get("model") is None and time.monotonic() < deadline:
        time.sleep(0.01)
    model = created.get("model")
    assert model is not None
    assert model.started.wait(timeout=5)   # warm-up now inside synth(), blocked

    order = []
    orig_unload = model.unload

    def tracked_unload():
        order.append("model.unload")
        orig_unload()

    model.unload = tracked_unload

    unload_thread = threading.Thread(target=b.unload)
    unload_thread.start()
    time.sleep(0.1)
    assert unload_thread.is_alive()   # blocked waiting on the warm-up's done Event
    assert order == []

    model.release.set()               # let the warm-up's synth() finish
    unload_thread.join(timeout=5)
    load_thread.join(timeout=5)

    assert not unload_thread.is_alive()
    assert not load_thread.is_alive()
    assert order == ["model.unload"]
    assert b.is_loaded is False


# ── Fix round 1 (2026-09-02), ruling R34 ─────────────────────────────────────
# Reviewer live-verification against real ggufs: pocket_tts's engine genuinely
# requires a session voice ("PocketTTS session prepare() requires a session
# voice via --voice-id or --voice-ref") -- Task 4's warm-up was therefore a
# SILENT NO-OP for pocket_tts (the native failure was caught and logged by
# _warm_up()'s own try/except, never actually exercising the GPU pipeline
# compile it exists to hide). moss_tts_nano and supertonic's bare synth() were
# separately live-verified to genuinely work with no preset. load() now
# applies _DEFAULT_PRESET_FAMILIES = {"pocket_tts"}'s first preset
# automatically, unconditionally (both devices), before the warm-up.

def test_load_pocket_tts_gpu_applies_default_preset_then_warms_up_for_real(native_env):
    """(a) pocket loaded on GPU: set_builtin_voice("alba") must land BEFORE the
    warm-up synth runs -- proven two ways: the model's preset state reflects
    it, AND the warm-up synth is present in the log at all (with the
    _PocketLikeModel fake, it would raise -- and be silently swallowed by
    _warm_up() -- if the preset had not already been applied by the time the
    warm-up's synth() call reached the fake)."""
    created, log = native_env
    created["caps"] = _caps(clones=True)
    created["model_factory"] = _PocketLikeModel
    b = backends.make_backend("native_tts")
    b.load(REF, "vulkan", "q8_0", config=PlanConfig(tts_family="pocket_tts"))
    model = created["model"]
    assert model.preset == "alba"
    assert b._voice_set is True
    # The warm-up genuinely ran (not swallowed): exactly the one synth call,
    # with no stderr failure line, proves the preset landed before it.
    assert log == [("synth", "Warm-up.", None, 1.0, False)]
    assert b._workers == []


def test_load_pocket_tts_gpu_warmup_not_silently_swallowed(native_env, capsys):
    """Direct regression check for the bug this fix round exists to close: with
    the fix, stderr must NOT carry a warm-up-failed line for pocket_tts on GPU
    -- before R34, _warm_up()'s own try/except caught the native
    session-prepare failure here and logged it, masking a warm-up that never
    actually happened."""
    created, log = native_env
    created["caps"] = _caps(clones=True)
    created["model_factory"] = _PocketLikeModel
    b = backends.make_backend("native_tts")
    b.load(REF, "vulkan", "q8_0", config=PlanConfig(tts_family="pocket_tts"))
    err = capsys.readouterr().err
    assert "warm-up synth failed" not in err
    assert "warm-up synth for family='pocket_tts'" in err


def test_load_pocket_tts_cpu_applies_default_preset_without_warmup(native_env):
    """(b) pocket loaded on CPU: the default preset is still applied (this is a
    correctness fix, not GPU-warm-up-only plumbing -- a bare CPU generate() was
    exactly as broken as a bare GPU one), but no warm-up runs on CPU."""
    created, log = native_env
    created["caps"] = _caps(clones=True)
    created["model_factory"] = _PocketLikeModel
    b = backends.make_backend("native_tts")
    b.load(REF, "cpu", "q8_0", config=PlanConfig(tts_family="pocket_tts"))
    model = created["model"]
    assert model.preset == "alba"
    assert b._voice_set is True
    assert log == []   # no warm-up on cpu
    # And the consequence R34 exists for: a bare generate() now genuinely
    # succeeds where it would previously have raised the native error.
    samples, _rate, _ms = b.generate("hello")
    assert samples.dtype == np.float32


# (c) "pocket with a voice already set before load" is not reachable through
# the public API and is therefore skipped, per the task brief's own escape
# hatch: set_voice()/set_builtin_voice() both raise BackendLoadError when
# self._model is None (i.e. before any load() has ever succeeded), and load()
# unconditionally resets self._voice_set = False on every successful load
# before the R34 preset step even runs -- there is no sequence of public calls
# that reaches the preset-application check with self._voice_set already True.


def test_load_supertonic_gpu_gets_no_default_preset_and_warms_up_bare(native_env):
    """(d) supertonic is deliberately excluded from _DEFAULT_PRESET_FAMILIES --
    its engine already has a working built-in default voice, and load() must
    not silently pick a preset on the caller's behalf. The warm-up still runs,
    bare, exactly as it did before this fix round."""
    created, log = native_env
    b = backends.make_backend("native_tts")
    b.load(REF, "vulkan", "q8_0", config=PlanConfig(tts_family="supertonic"))
    model = created["model"]
    assert model.preset is None
    assert b._voice_set is False
    assert log == [("synth", "Warm-up.", None, 1.0, False)]


def test_load_supertonic_cpu_gets_no_default_preset(native_env):
    created, log = native_env
    b = backends.make_backend("native_tts")
    b.load(REF, "cpu", "q8_0", config=PlanConfig(tts_family="supertonic"))
    model = created["model"]
    assert model.preset is None
    assert b._voice_set is False
    assert log == []
