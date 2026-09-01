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
directory, not the whole repo — via `allow_patterns=[f"{dir}/*"]`.

Ruling R18(s4) — SUPERSEDES the prior "no hard-links" ruling: the gguf (and, for
pocket_tts, its embeddings/*.safetensors sidecar) are hard-link-staged into a small
sokuji-owned tree under the SAME cache root before ever reaching the native layer (see
_stage_for_native()). The prior ruling's own reasoning — "HF's local cache already
links snapshot files back to the shared blob store, no additional staging is needed" —
is still correct about directory LAYOUT (pocket_tts's embeddings/ sits correctly next
to its gguf either way); it just never anticipated audio.cpp's own model loader
canonicalizing the path before sniffing its format by extension. HF's real
snapshot_download() snapshot entries are SYMLINKS into a content-addressed blob store
(no `.gguf`/`.safetensors` extension on the blob itself); audio.cpp's vendored
prepare_model_directory() (`_deps/audiocpp-src/src/framework/assets/tensor_source.cpp`)
calls `std::filesystem::weakly_canonical()` on that symlinked path before handing it to
open_tensor_source(), which dispatches purely on `path.extension()` — for a path that
exists in full, weakly_canonical() behaves like canonical() and fully resolves the
symlink down to the extensionless blob, so the extension check always fails
("unsupported tensor source format"). Live-verified against every native_tts family
this reaches (not just pocket-tts-en); ASR (transcribe.cpp) is unaffected by the
identical symlinked-cache shape, so this is specific to audio.cpp's own loader.
A HARD link is a second directory entry for the SAME inode, not a symlink, and is
therefore NOT resolved by weakly_canonical() — the staged path keeps its real
extension all the way through canonicalization, with no copy of the (up to several-GB)
weight data. See final-fixwave-report.md's "Round 2: R18" section for the full trace.

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
to completion unobserved (review round 1, CQ-3).

Fix wave (2026-09-01), three more defects:

I3 -- self._workers ALSO tracks a one-shot generate() while it is inside
self._model.synth(...), not just streaming workers: entry is (threading.current_thread(),
None) -- registered on entry, deregistered on exit via try/finally, no cancel Event
needed because an offline family cannot be interrupted mid-run anyway (tts_engine.py's
own comment on this). Before this fix, unload() only joined streaming workers, so a
one-shot generate() running on another executor thread could still be mid-sk_tts_synth
when unload() nulled the model handle and freed it underneath it -- a native
use-after-free. unload()'s existing cancel-then-join loop already tolerates a None
event (skips the .set()) and joins the thread like any other entry, so one-shot and
streaming workers share one registry and one shared deadline. cancel() also tolerates a
None event (a one-shot at self._workers[-1] makes cancel() a harmless no-op, matching
"one-shot generation is never cancelled").

Final fix wave (2026-09-01), ruling I-1 -- I3's fix above registered the one-shot
entry as (threading.current_thread(), None) and had unload() call
thread.join(timeout=...) on it, exactly the defect translate_backend.py's
translate() had (see that module's own "Final fix wave" paragraph for the full
trace, which applies identically here). In production generate() always runs
via tts_engine's `loop.run_in_executor(None, ...)` -- a ThreadPoolExecutor
worker that returns to the pool, IDLE, once generate() returns, rather than
terminating -- so thread.join() burned the FULL 10s deadline on every
unload(), whether or not generate() had already finished, stalling the event
loop and hollowing the very UAF backstop the deadline exists to enforce.
Fixed the same way as translate_backend.py: the one-shot entry now carries a
`done` Event (set in generate()'s own finally, once self._model.synth(...)
has actually returned) instead of a thread reference, and unload() waits on
that instead of joining. generate_stream()'s STREAMING entries are UNCHANGED
and still correct as-is -- `thread` there is a real, dedicated
threading.Thread this module itself creates and starts (see
generate_stream()'s own docstring below), which DOES terminate on its own
once its target function returns; joining it was never the bug.
self._workers now holds a 3-tuple, (thread, cancel, done), so unload()'s
single loop can tell the two shapes apart: a STREAMING entry has a real
thread (and no done Event) and gets joined; a ONE-SHOT entry has thread=None
(and no cancel Event) and gets waited on via its done Event instead.

R16 -- qwen3_tts and omnivoice have NO usable default voice: a synth() attempted with
neither set_voice() nor set_builtin_voice() called first fails deep inside audio.cpp
with a none-too-friendly, native-layer-specific message (live-verified,
task-7-report.md §3: "Qwen3 base TTS requires voice clone reference audio").
_ensure_voice_ready() raises a clear, family-named BackendLoadError here, BEFORE ever
reaching the native layer, so the wire error is deterministic and readable regardless
of what audio.cpp happens to throw that day. moss_tts_nano and pocket_tts also report
CLONES=True but are NOT gated -- both ship a working built-in default voice (moss:
native/tests/test_tts.cpp's own case synths before ever calling set_voice; pocket:
every package can run clone-free).

I2 -- the per-synth ACTUAL sample rate (audio.cpp's own returned rate, which can differ
from the family's advertised caps.sample_rate) is now forwarded end-to-end instead of
discarded: generate() returns it as its own return value, and generate_stream()'s
on_chunk callback forwards it into each queued/yielded chunk. tts_engine resamples with
whichever rate accompanies each result/chunk, not the caps-table default -- the default
stays valid for planning/UI (it's what the family's own capabilities/tts_init reply
report before any synth has actually run).

Task 4 (slice 5b, 2026-09-02), ruling R33 -- W-1 (windows-vulkan-validation.md):
the FIRST synth per family on a cold GPU pays a one-time pipeline-compile cost
(moss_tts_nano measured 16.52s on Vulkan before NVIDIA's on-disk shader cache
warmed up, vs 0.63-0.73s on every later process) that a plain load() + first
real synth would otherwise hand straight to the user as extra latency on their
first utterance. load() now runs one short, discarded synth ("Warm-up.")
through the EXACT one-shot path generate() itself uses -- same self._workers
registration, same `done` Event -- right after the model and its capability
attributes are set, but ONLY when BOTH hold: the resolved device is not CPU
(CPU pays nothing extra for a first synth per W-1's own measurements, so
warming it up there would only slow down every CPU load for no benefit), and
the family is not one of _VOICE_REQUIRED_FAMILIES (qwen3_tts/omnivoice have no
usable default voice at load() time -- see R16 above -- so warming them up
would immediately hit _ensure_voice_ready()'s own guard; their first REAL
synth, which always follows a client set_voice() call, still pays the
one-time compile once, exactly as it did before this change). "the resolved
device is not CPU" is read off the SAME `device` string already passed into
this call's own native.device_for(device) lookup a few lines above (not off
the returned Device object) -- device_for() only returns successfully when
`device` names an actual device of that kind in this process, so `device` and
the resolved Device's own `.kind` are guaranteed identical at this point;
comparing the string sidesteps needing every device_for() stand-in (including
tests') to return an object shaped like a real Device. A warm-up is purely an
optimization, never a correctness requirement: _warm_up() catches everything
generate() can raise, logs it to stderr, and returns -- load() must still
succeed and hand back a backend ready to serve a (merely slower) first real
synth even if the warm-up itself failed.

Round 2 (2026-09-01), ruling R18 -- see the module docstring's second paragraph above
for the full defect trace. _stage_for_native() hard-links the resolved gguf (+ any
PlanConfig.tts_extra_files sidecars) into a deterministic, idempotent staging path
under the same HF cache root, keyed by (repo, snapshot revision, file's path within the
repo): re-staging over an already-correct link (same inode, checked via
os.path.samefile) is a no-op; a stale/missing/foreign entry is removed and re-created.
`source` is resolved via os.path.realpath() before linking, not trusted to os.link()'s
own `follow_symlinks` handling (live-verified platform gap: see
_stage_for_native()'s own docstring). Falls back to a real copy if os.link() fails
(EXDEV -- a filesystem boundary between the staging tree and the cache blob it links
to -- or a filesystem without hard-link support). native_models.py's delete paths
must remove a card's staged entries too (a
hard link keeps the blob's inode alive even after the HF-cache-side symlink/blob is
deleted, so "delete" would otherwise silently free nothing) -- see that module's own
_prune_staged_files()/_prune_staged_repo()."""
import os
import queue
import shutil
import sys
import threading
import time

import numpy as np

from . import native
from .backends import BackendLoadError, register_backend
from .catalog import TTS_STAGING_DIRNAME, split_artifact
from .planner import PlanConfig

_SENTINEL = object()

# I-1: the single shared budget unload() gives EVERY outstanding generate()/
# generate_stream() worker, combined, to self-report done (or actually
# terminate, for a streaming Thread) before the model is freed regardless. A
# module constant (not inlined in unload()) so a test can shrink it to
# exercise the "still-blocked native call" path without a real 10s wait.
_UNLOAD_DEADLINE_S = 10.0

# R16: families whose native default voice raises when synth() is attempted with no
# clone/preset set first -- live-verified only for these two (task-7-report.md §3).
# moss_tts_nano/pocket_tts also report CLONES=True but are NOT included: both ship a
# working built-in default and must stay callable without a voice ever being set.
_VOICE_REQUIRED_FAMILIES = frozenset({"qwen3_tts", "omnivoice"})

# R33 / W-1: the fixed short phrase load() synthesizes once, on a non-CPU
# device, purely to pay the first-synth GPU pipeline-compile cost at load
# time instead of on the user's own first utterance. Its output is discarded.
_WARM_UP_TEXT = "Warm-up."


def _staging_root() -> str:
    """R18: catalog.TTS_STAGING_DIRNAME, a sibling of HF's own models--*/ directories
    directly under the SAME cache root -- guarantees os.link() below stays on one
    filesystem (a hard link cannot cross filesystem boundaries) without depending on
    any particular OS temp-dir/cache-dir relationship."""
    from huggingface_hub import constants
    return os.path.join(constants.HF_HUB_CACHE, TTS_STAGING_DIRNAME)


def _copy_atomic(source: str, dest: str) -> None:
    """T4iii: copy `source` to `dest` via a temp file in the SAME directory, then
    os.replace() -- never opens `dest` itself for writing. `dest` can already exist
    as a hard link a concurrent loader is actively reading through (F2's race: the
    "another loader won" branch below reaches here on a genuine content mismatch,
    not just "absent"), or as a stale entry left over from an interrupted run.
    shutil.copyfile(source, dest) opens `dest` IN PLACE and truncates it before
    writing -- if anything else on the system still holds that path open (mid
    sk_tts_load/synth on the same inode), it would observe a truncated/partially
    overwritten file mid-copy, not merely a delayed update. os.replace() instead
    swaps the directory entry in one atomic syscall: an existing reader keeps its
    own (now-unlinked) inode fully intact, and the path only ever resolves to a
    complete file, at every point in time."""
    tmp = f"{dest}.tmp{os.getpid()}.{threading.get_ident()}"
    try:
        shutil.copyfile(source, tmp)
        os.replace(tmp, dest)
    except BaseException:
        try:
            os.remove(tmp)
        except OSError:
            pass
        raise


def _stage_for_native(repo: str, rev: str, rel_path: str, source: str) -> str:
    """R18: hard-link (falling back to a copy) `source` -- a path inside HF's real
    snapshot cache, almost always a symlink into the content-addressed blob store --
    into the deterministic staged location for (repo, rev, rel_path), returning that
    staged path. `rel_path` is the file's path WITHIN the repo (e.g.
    "PocketTTS-GGUF/english/pocket-tts-english-q8_0.gguf") -- the same shape
    native_models.py's download_specs()/_delete_shared_repo_files() already use for
    this exact repo, so the two modules agree on identity without sharing code.

    `source` is resolved via os.path.realpath() BEFORE linking, ourselves, rather
    than trusting os.link()'s documented `follow_symlinks=True` default to do it:
    live-verified on this platform that os.link() given a symlink `source` instead
    created ANOTHER SYMLINK sharing the ORIGINAL symlink's inode (same nlink-counted
    directory-entry behavior as a hard link, but still `os.path.islink() == True`,
    with the ORIGINAL relative target string) -- which then resolved to the WRONG
    path once evaluated relative to the staging directory's different depth/nesting
    (a broken link, not merely "still symlinked"). Resolving ourselves and linking
    the REAL underlying file sidesteps this platform's `AT_SYMLINK_FOLLOW` gap
    entirely: the staged path is a genuine hard link to the blob's inode, with no
    symlink anywhere in it, so audio.cpp's weakly_canonical() has nothing left to
    resolve away regardless of what any particular OS/filesystem's linkat() does.

    Idempotent: if `staged` already exists and is the SAME file as `source` (compared
    by device+inode, not path string, via os.path.samefile -- which follows symlinks
    on both sides itself, so this check is correct whether or not `staged` happens to
    be a leftover symlink from a run predating this fix), this is a no-op --
    re-staging on every load() call never re-links/re-copies unnecessarily, and a
    wiped staging directory transparently re-stages on the next load() (the "already
    staged" check simply fails and falls through to (re-)creation)."""
    staged = os.path.join(_staging_root(), f"{repo.replace('/', '--')}__{rev}", rel_path)
    try:
        if os.path.exists(staged) and os.path.samefile(staged, source):
            return staged
    except OSError:
        pass
    os.makedirs(os.path.dirname(staged), exist_ok=True)
    try:
        os.remove(staged)
    except FileNotFoundError:
        pass
    real_source = os.path.realpath(source)
    try:
        os.link(real_source, staged)
    except FileExistsError:
        # F2: another loader won the same race -- two concurrent load() calls for
        # the SAME card (plausible precisely because the TTS engine is a process
        # singleton, see (c)/M2: two connections both loading the same model at
        # once) can both pass the exists+samefile check above (staged path absent
        # yet) and then both reach here; the loser's os.link() raises
        # FileExistsError once the winner's link has already landed. Re-run the
        # SAME idempotency check rather than falling straight to the (possibly
        # multi-GB) copy fallback below: if it's already the right file, we're
        # done. Only a genuine mismatch (or a samefile() failure) falls through.
        try:
            if os.path.samefile(staged, source):
                return staged
        except OSError:
            pass
        _copy_atomic(real_source, staged)   # T4iii: never truncate a live hard link in place
    except OSError:
        # EXDEV (staging ended up on a different filesystem than the blob it links
        # to -- should not happen given _staging_root()'s placement, but a hostile or
        # unusual HF_HUB_CACHE override could still trigger it) or a filesystem
        # without hard-link support: fall back to a real copy. Slower and spends real
        # disk space, but still correct.
        _copy_atomic(real_source, staged)   # T4iii: never truncate a live hard link in place
    return staged


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
        self._family = None
        self._voice_set = False   # R16: True once set_voice()/set_builtin_voice() lands
        # Every (thread, cancel, done) 3-tuple for a generate() or generate_stream()
        # call that hasn't finished self-cleanup yet, oldest first -- see the module
        # docstring's I3 and "Final fix wave" (I-1) paragraphs. Two distinct shapes:
        #   STREAMING (generate_stream()): (threading.Thread, threading.Event, None)
        #     -- `thread` is a real, dedicated worker Thread this module itself
        #     creates and starts, which DOES terminate on its own once its target
        #     function returns, so unload() JOINS it directly (that was never the
        #     I-1 bug). `cancel` is checked by on_chunk between pulled chunks.
        #   ONE-SHOT (generate()): (None, None, threading.Event) -- no thread
        #     reference at all (I-1: the calling thread is a ThreadPoolExecutor
        #     worker in production, which returns to the pool instead of
        #     terminating -- joining it would burn unload()'s full deadline every
        #     time regardless of whether generate() had already finished) and no
        #     cancel Event (an offline family cannot be interrupted mid-run) --
        #     only a `done` Event, set once self._model.synth(...) has actually
        #     returned. unload() waits on THAT instead of joining.
        # cancel()/unload() both tolerate a None cancel Event (skip the .set()) and
        # a None thread (wait on `done` instead of joining). Guarded by
        # _workers_lock since generate()/generate_stream() (append), _drain()'s
        # finally or generate()'s finally (remove, from whatever thread is running
        # it), cancel() (read the tail), and unload() (snapshot + clear) can all run
        # concurrently on different threads.
        self._workers: list[tuple[threading.Thread | None, threading.Event | None, threading.Event | None]] = []
        self._workers_lock = threading.Lock()

    def _ensure_voice_ready(self) -> None:
        """R16: raise BEFORE ever reaching the native layer when this family has no
        usable default voice and none has been set yet -- see _VOICE_REQUIRED_FAMILIES
        and the module docstring."""
        if self._family in _VOICE_REQUIRED_FAMILIES and not self._voice_set:
            raise BackendLoadError(f"{self._family} requires a voice clip before synthesis")

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
            # R18: stage the gguf (+ any sidecar, e.g. pocket_tts's
            # embeddings/*.safetensors) as HARD LINKS before ever handing a path to
            # the native layer -- see _stage_for_native()'s docstring and the module
            # docstring's second paragraph for why a real HF snapshot's symlinked
            # path breaks audio.cpp's own model loader.
            rev = os.path.basename(snap)
            path = _stage_for_native(repo, rev, fname, f"{snap}/{fname}")
            for extra_name, _size in cfg.tts_extra_files:
                extra_rel = f"{model_dir}/{extra_name}" if model_dir else extra_name
                _stage_for_native(repo, rev, extra_rel, f"{snap}/{extra_rel}")
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
            self._family = family              # R16: which _ensure_voice_ready() gates on
            self._voice_set = False             # a freshly loaded model has no voice yet
            # R33 / W-1: warm up ONLY on a non-CPU device, and never for a
            # clone-only family -- see the module docstring's "Task 4" paragraph.
            if device != "cpu" and family not in _VOICE_REQUIRED_FAMILIES:
                self._warm_up()
        except BackendLoadError:
            self.unload()
            raise
        except Exception as e:  # missing wheel/gguf, no vulkan/metal device, NativeError → resolver falls back
            self.unload()
            raise BackendLoadError(str(e))

    def _warm_up(self) -> None:
        """R33 / W-1: one short, discarded synth through the EXACT one-shot path
        generate() uses -- same self._workers registration, same `done` Event --
        so a concurrent unload() racing this call (e.g. a second connection
        tearing down the process-singleton engine while another connection's
        load() is still warming up) waits for it exactly like any other
        in-flight generate(), instead of freeing the handle out from under it.
        Purely an optimization: any failure (a family/device shape never
        live-verified, a transient native error, ...) is logged to stderr and
        swallowed here -- load() must still succeed regardless."""
        t0 = time.time()
        try:
            self.generate(_WARM_UP_TEXT)
        except Exception as exc:
            print(f"native_tts: warm-up synth failed for family={self._family!r}, "
                  f"continuing without it: {exc}", file=sys.stderr, flush=True)
            return
        print(f"native_tts: warm-up synth for family={self._family!r} took "
              f"{time.time() - t0:.2f}s (hides the first-synth GPU pipeline "
              "compile, see W-1 in windows-vulkan-validation.md)",
              file=sys.stderr, flush=True)

    def generate(self, text: str, speed: float = 1.0):
        if self._model is None:
            raise BackendLoadError("native_tts not loaded")
        self._ensure_voice_ready()   # R16
        # I3 / I-1: register THIS call in the same worker registry generate_stream()
        # uses, with no cancel event (an offline family cannot be interrupted
        # mid-run) and no thread reference (I-1: the calling thread is a
        # ThreadPoolExecutor worker in production, which returns to the pool
        # instead of terminating -- see the module docstring's "Final fix wave"
        # paragraph). `done` is set in the finally below once this call has
        # actually returned -- unload() waits on THAT, purely so it can never free
        # the handle out from under a still-running sk_tts_synth on another thread.
        done = threading.Event()
        entry = (None, None, done)
        with self._workers_lock:
            self._workers.append(entry)
        try:
            t0 = time.time()
            samples, rate = self._model.synth(text, language=self._language, speed=speed)
            return np.asarray(samples, dtype=np.float32), int(rate), int((time.time() - t0) * 1000)
        finally:
            done.set()
            with self._workers_lock:
                if entry in self._workers:
                    self._workers.remove(entry)

    def generate_stream(self, text: str, speed: float = 1.0):
        if self._model is None:
            raise BackendLoadError("native_tts not loaded")
        self._ensure_voice_ready()   # R16
        q: "queue.Queue" = queue.Queue()
        cancelled = threading.Event()

        def on_chunk(pcm, sr):
            # I2: forward the ACTUAL per-chunk rate (audio.cpp's own return value,
            # which can differ from the family's advertised caps.sample_rate) instead
            # of discarding it -- tts_engine resamples with this, not the caps default.
            q.put(("chunk", (np.asarray(pcm, dtype=np.float32), int(sr))))
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
        # STREAMING shape (module docstring / __init__ comment): a real, dedicated
        # Thread -- unload() JOINS this directly, no `done` Event needed (that's
        # what actually terminates it).
        entry = (thread, cancelled, None)
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
        stream being superseded, never the one about to replace it. A harmless
        no-op if that entry is a one-shot generate() (I3: its event is always
        None -- a one-shot cannot be interrupted mid-run anyway)."""
        with self._workers_lock:
            if self._workers:
                ev = self._workers[-1][1]
                if ev is not None:
                    ev.set()

    def set_voice(self, audio, sr, ref_text: str = "") -> None:
        if self._model is None:
            raise BackendLoadError("native_tts not loaded")
        pcm = np.ascontiguousarray(np.asarray(audio, dtype=np.float32).reshape(-1))
        self._model.set_voice(pcm, int(sr), ref_text=ref_text or None)
        self._voice_set = True   # R16

    def set_builtin_voice(self, name: str) -> None:
        if self._model is None:
            raise BackendLoadError("native_tts not loaded")
        self._model.set_preset(name)
        self._voice_set = True   # R16

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
        # Cancel every OUTSTANDING worker, then wait for each one BEFORE touching
        # the model at all -- not just the most recently started one: a superseded
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
        # I-1 (module docstring's "Final fix wave" paragraph): a STREAMING entry
        # (thread is not None) gets JOINED -- it's a real, dedicated Thread that
        # terminates on its own. A ONE-SHOT entry (thread is None) is instead
        # WAITED on via its own `done` Event -- joining the CALLING thread there
        # was the bug, since in production that thread is a ThreadPoolExecutor
        # worker that returns to the pool instead of terminating.
        #
        # Snapshot-then-clear under the lock so a concurrent generate()/
        # generate_stream() can't observe a half-cleared registry; cancel every
        # entry, then join/wait every entry against ONE shared deadline (not
        # _UNLOAD_DEADLINE_S each) so unload()'s total worst case doesn't grow
        # with the number of outstanding orphans.
        with self._workers_lock:
            workers = list(self._workers)
            self._workers.clear()
        for _thread, ev, _done in workers:
            if ev is not None:   # I3: a one-shot generate()'s entry has no cancel event
                ev.set()
        deadline = time.monotonic() + _UNLOAD_DEADLINE_S
        for thread, _ev, done in workers:
            remaining = max(0.0, deadline - time.monotonic())
            if thread is not None:
                thread.join(timeout=remaining)
            else:
                done.wait(timeout=remaining)
        model, self._model = self._model, None
        if model is not None:
            try:
                model.unload()
            except Exception:
                pass

    @property
    def is_loaded(self) -> bool:
        return self._model is not None
