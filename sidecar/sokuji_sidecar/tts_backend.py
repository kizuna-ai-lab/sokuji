"""Native TTS backend (spec §5.3/§5.5): sokuji_native's TtsModel wraps audio.cpp's
five families in-process (moss_tts_nano, qwen3_tts, omnivoice, pocket_tts,
supertonic). One class covers every family: capability differences (streaming vs
offline, clones or not, native sample rate) are read off the loaded model's
`.capabilities` once, at load(), and stored as instance attributes that shadow the
class defaults — tts_engine reads STREAMING/CLONES/sample_rate per instance, exactly
so a single `native_tts` NAME can serve all five families. Which family loads is
picked by the catalog card via PlanConfig.tts_family (sk_tts_load's required
family_hint); PlanConfig.tts_language is pocket_tts's load-time language package
("english", ...), ignored by every other family.

model_ref is the artifact "org/repo/<dir>/<file>.gguf" the catalog resolves to. The
files a family ships besides the gguf (voice presets, embeddings, ...) live under the
SAME <dir> in its HF repo, so load() resolves a SCOPED local snapshot — only that one
directory, not the whole repo — via `allow_patterns=[f"{dir}/*"]`, and passes the
gguf's path inside that snapshot AS GIVEN. HF's local cache already links snapshot
files back to the shared blob store; no additional hard-link staging (the old MOSS
backend's `_link_tree` trick) is needed or wanted here (ruling: no hard-links).

generate_stream() bridges sokuji_native's synth() callback — invoked on the CALLING
thread, from C, once per pulled chunk — into a Python generator. A generator cannot
itself be resumed from inside a foreign callback, so a worker thread runs the
blocking synth() call and feeds a queue.Queue; the generator's own thread just drains
that queue. cancel() sets a threading.Event the callback checks before queuing each
chunk — that closes the loop all the way to the native session (sk_tts_synth's
on_audio returning false between chunks cancels there, per sk_tts.cpp), which is what
makes a superseding tts_generate or an explicit tts_cancel actually stop generation
instead of merely detaching the old asyncio Task (tts_engine.py defect 2).

generate_stream() itself is a PLAIN function, not a generator: it creates the queue,
the cancel Event, and the worker thread -- and assigns self._cancel_event/
self._worker_thread -- EAGERLY, before returning, then hands back a small inner
generator that only drains the queue. If generate_stream() were itself the generator
(the `yield` inside its own body), none of that setup would run until the caller's
first next()/iteration -- a cancel() called in the window between create_task() and
the first poll would target whatever self._cancel_event happened to hold from a
PRIOR stream (or None) and be silently lost (review round 1, CQ-6).

A real (non-cancelled) synth() failure is re-raised out of the drain generator, not
swallowed -- tts_engine's own `for chunk in generate_stream(...)` loop already wraps
that iteration in a try/except that turns any raised exception into an "error" push
on the wire; swallowing it here would instead surface as a truncated stream ending in
a normal tts_done (review round 1, CQ-2). A cancelled synth's own exception (raised
because on_chunk returned False) IS still swallowed -- that is our own cancellation
taking effect, not a failure.

The drain generator wraps its loop in try/finally: cancelled.set(), so a consumer
that abandons it early (break, .close(), garbage collection) raises GeneratorExit at
the suspended yield, which the finally block turns into the same cancellation any
other stop takes -- otherwise the worker thread and its native synth() call would run
to completion unobserved (review round 1, CQ-3)."""
import queue
import threading
import time

import numpy as np

from . import native
from .backends import BackendLoadError, register_backend
from .catalog import split_artifact
from .planner import PlanConfig

_SENTINEL = object()


@register_backend
class NativeTtsBackend:
    NAME = "native_tts"
    # Class-level fallbacks; load() overwrites all three with instance attributes
    # read from the loaded model's capabilities. tts_engine reads these off the
    # BACKEND INSTANCE, not the class, precisely so this per-model override works.
    STREAMING = False
    CLONES = False
    sample_rate = 24000

    def __init__(self):
        self._model = None
        self._language = None
        self._cancel_event = None
        self._worker_thread = None

    def load(self, model_ref: str, device: str, compute_type: str, config=None) -> None:
        self.unload()
        try:
            cfg = config or PlanConfig()
            family = cfg.tts_family or None
            if not family:
                raise BackendLoadError(
                    f"native_tts needs config.tts_family, got {cfg!r}")
            repo, fname = split_artifact(model_ref)
            if not fname:
                raise BackendLoadError(
                    f"native_tts needs an 'org/repo/dir/file.gguf' artifact, got {model_ref!r}")
            model_dir = fname.rsplit("/", 1)[0] if "/" in fname else ""
            allow = [f"{model_dir}/*"] if model_dir else [fname]
            from huggingface_hub import snapshot_download
            snap = snapshot_download(repo, allow_patterns=allow, local_files_only=True)
            path = f"{snap}/{fname}"
            # Always resolve an explicit device — including "cpu" (the slice-3 F1
            # lesson, translate_backend.load carries the same comment): passing
            # NULL leaves the native default in place, which can silently place a
            # cpu-resolved plan on the GPU and corrupt the VRAM ledger.
            dev = native.device_for(device)
            self._model = native.module().tts_load(
                path, family=family, device=dev, language=cfg.tts_language or None)
            caps = self._model.capabilities
            self.STREAMING = bool(caps.streaming)
            self.CLONES = bool(caps.clones)
            self.sample_rate = int(caps.sample_rate)
        except BackendLoadError:
            self.unload()
            raise
        except Exception as e:  # missing wheel/gguf, no vulkan/metal device, NativeError → resolver falls back
            self.unload()
            raise BackendLoadError(str(e))

    def generate(self, text: str, speed: float = 1.0):
        if self._model is None:
            raise BackendLoadError("native_tts not loaded")
        t0 = time.time()
        samples, _rate = self._model.synth(text, language=self._language, speed=speed)
        return np.asarray(samples, dtype=np.float32), int((time.time() - t0) * 1000)

    def generate_stream(self, text: str, speed: float = 1.0):
        if self._model is None:
            raise BackendLoadError("native_tts not loaded")
        q: "queue.Queue" = queue.Queue()
        cancelled = threading.Event()
        # Bind BEFORE starting the thread and BEFORE returning to the caller: a
        # cancel() arriving before the first pull must still land on THIS stream's
        # event, not be dropped (see the module docstring, CQ-6).
        self._cancel_event = cancelled

        def on_chunk(pcm, _sr):
            q.put(("chunk", np.asarray(pcm, dtype=np.float32)))
            return not cancelled.is_set()

        def worker():
            try:
                self._model.synth(text, language=self._language, speed=speed, on_chunk=on_chunk)
            except Exception as exc:
                if not cancelled.is_set():
                    # A REAL failure, not our own cancellation: must reach the
                    # caller as a raised exception (see the drain generator
                    # below), not vanish into a silently-truncated stream.
                    q.put(("error", exc))
                # else: a cancelled synth raises NativeError(CANCELLED) from the
                # binding (on_chunk returned False) -- that IS this cancellation
                # taking effect, not a failure; swallow it.
            finally:
                q.put(_SENTINEL)

        thread = threading.Thread(target=worker, daemon=True)
        self._worker_thread = thread
        thread.start()

        def _drain():
            try:
                while True:
                    item = q.get()
                    if item is _SENTINEL:
                        break
                    kind, payload = item
                    if kind == "error":
                        raise payload
                    yield payload
            finally:
                # Covers a consumer abandoning the stream early (break, .close(),
                # GC) as well as normal/error completion: either way, nothing
                # after this point should keep the native session running.
                cancelled.set()

        return _drain()

    def cancel(self) -> None:
        """Stop the in-flight generate_stream() at its next chunk boundary — the
        native session cannot be interrupted mid-chunk, only between sk_audio_cb
        calls (see the module docstring)."""
        ev = self._cancel_event
        if ev is not None:
            ev.set()

    def set_voice(self, audio, sr, ref_text: str = "") -> None:
        if self._model is None:
            raise BackendLoadError("native_tts not loaded")
        pcm = np.ascontiguousarray(np.asarray(audio, dtype=np.float32).reshape(-1))
        self._model.set_voice(pcm, int(sr), ref_text=ref_text or None)

    def set_builtin_voice(self, name: str) -> None:
        if self._model is None:
            raise BackendLoadError("native_tts not loaded")
        self._model.set_preset(name)

    def set_language(self, lang: str) -> None:
        """Store the per-synth language hint (sk_tts_synth's own `language`
        argument) — passed on every subsequent generate()/generate_stream() call,
        not load-time state on the handle. Distinct from PlanConfig.tts_language,
        pocket_tts's LOAD-time package choice already consumed by load()."""
        self._language = lang or None

    def list_builtin_voices(self) -> list:
        if self._model is None:
            raise BackendLoadError("native_tts not loaded")
        return self._model.presets()

    def unload(self) -> None:
        # Cancel and JOIN the streaming worker BEFORE touching the model at all:
        # sk_tts_unload takes the same per-handle mutex a synth() in flight is
        # holding, so unloading first would either block this call on that mutex
        # (an event-loop stall when unload runs on a connection teardown) or --
        # worse -- free the handle out from under the worker thread's still-live
        # `self._model.synth(...)` call (use-after-free). Cancel signals the
        # worker to stop between chunks; join waits for it to actually have
        # stopped, bounded so a wedged native call can't hang teardown forever
        # (review round 1, CQ-4).
        ev = self._cancel_event
        if ev is not None:
            ev.set()
        thread = self._worker_thread
        if thread is not None:
            thread.join(timeout=10.0)
        self._cancel_event = None
        self._worker_thread = None
        model, self._model = self._model, None
        if model is not None:
            try:
                model.unload()
            except Exception:
                pass

    @property
    def is_loaded(self) -> bool:
        return self._model is not None
