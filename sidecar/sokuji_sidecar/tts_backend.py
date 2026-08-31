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
the cancel Event, and the worker thread -- and registers the (thread, event) pair in
self._workers -- EAGERLY, before returning, then hands back a small inner generator
that only drains the queue. If generate_stream() were itself the generator (the
`yield` inside its own body), none of that setup would run until the caller's first
next()/iteration -- a cancel() called in the window between create_task() and the
first poll would target whatever was registered from a PRIOR stream (or nothing) and
be silently lost (review round 1, CQ-6).

self._workers is a LIST of every (thread, event) pair whose stream hasn't finished
self-cleanup yet, not a single slot -- a single slot let a SUPERSEDED stream's worker
become an orphan invisible to unload(): tts_generate's supersede path cancels the
CURRENT stream and starts a new one without waiting for the old one to actually stop,
so the old worker can still be inside self._model.synth(...) when the new stream
overwrites what unload() would join. unload() must therefore join EVERY outstanding
worker, not just the most recent (review round 2). cancel() still only ever needs to
target the most recently started entry: tts_engine's supersede path always calls
cancel_active() BEFORE starting the new stream (never after), so at the moment
cancel() reads self._workers[-1] it can only be the stream actually being superseded
-- the new one hasn't registered yet.

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
        # Every (threading.Thread, threading.Event) pair for a stream that hasn't
        # finished self-cleanup yet, oldest first. Guarded by _workers_lock since
        # generate_stream() (append), _drain()'s finally (remove, from whatever
        # thread is draining it), cancel() (read the tail), and unload() (snapshot
        # + clear) can all run concurrently on different threads.
        self._workers: list[tuple[threading.Thread, threading.Event]] = []
        self._workers_lock = threading.Lock()

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
        entry = (thread, cancelled)
        # Register BEFORE starting the thread and BEFORE returning to the caller:
        # a cancel() arriving before the first pull must still land on THIS
        # stream's event, not be dropped (review round 1, CQ-6), and unload()
        # must be able to find this worker even if a later stream supersedes it
        # before this one has finished cleaning up after itself (review round 2).
        with self._workers_lock:
            self._workers.append(entry)
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
                with self._workers_lock:
                    if entry in self._workers:
                        self._workers.remove(entry)

        return _drain()

    def cancel(self) -> None:
        """Stop the MOST RECENTLY STARTED generate_stream() at its next chunk
        boundary -- the native session cannot be interrupted mid-chunk, only
        between sk_audio_cb calls (see the module docstring). Safe to call as
        the supersede step for a new stream: tts_engine always calls this
        BEFORE starting the new stream, so self._workers[-1] can only be the
        stream being superseded, never the one about to replace it."""
        with self._workers_lock:
            if self._workers:
                self._workers[-1][1].set()

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
        # Cancel and JOIN every OUTSTANDING streaming worker BEFORE touching the
        # model at all -- not just the most recently started one: a superseded
        # stream's worker can still be an "orphan" here, cancelled but not yet
        # actually stopped, and a single _cancel_event/_worker_thread slot would
        # lose track of it the moment a newer stream registered (review round 2
        # regression: unload() calling model.unload() while an orphan was still
        # inside self._model.synth(...), or two synth() calls concurrently
        # active on one backend). sk_tts_unload takes the same per-handle mutex
        # a synth() in flight is holding, so unloading before every worker has
        # actually stopped would either block this call on that mutex (an
        # event-loop stall when unload runs on a connection teardown) or --
        # worse -- free the handle out from under a still-live synth() call
        # (use-after-free).
        #
        # Snapshot-then-clear under the lock so a concurrent generate_stream()
        # can't observe a half-cleared registry; cancel every entry, then join
        # every thread against ONE shared deadline (not 10s each) so unload()'s
        # total worst case doesn't grow with the number of outstanding orphans.
        with self._workers_lock:
            workers = list(self._workers)
            self._workers.clear()
        for _thread, ev in workers:
            ev.set()
        deadline = time.monotonic() + 10.0
        for thread, _ev in workers:
            thread.join(timeout=max(0.0, deadline - time.monotonic()))
        model, self._model = self._model, None
        if model is not None:
            try:
                model.unload()
            except Exception:
                pass

    @property
    def is_loaded(self) -> bool:
        return self._model is not None
