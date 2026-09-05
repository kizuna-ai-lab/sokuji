"""TTS stage: resolve the native_tts backend via accel, synthesize, and normalize
output to the renderer's Int16@24k mono contract. Process singleton, reused across
sessions; close() frees VRAM.

Three defects fixed here (spec §5.3, inventory §3):
  1. Model load/measure_rtf_tts, set_voice/set_builtin_voice, and one-shot generate()
     all ran synchronously on the single asyncio event loop this process' whole
     connection dispatch shares — every one-shot synthesis or (re)load stalled ASR/
     translate traffic on every OTHER connection too. All three now run in the
     default executor, mirroring translate_engine._h_translate's existing shape.
  2. tts_cancel only ever flipped a dict flag the STREAMING worker polled; a
     superseding tts_generate cancelled the old asyncio Task but not the executor
     thread actually running the backend's generation, so the old synthesis kept
     consuming the GPU. Both tts_cancel and a superseding tts_generate now ALSO call
     eng.cancel_active() -> backend.cancel(), which reaches the native session itself
     (see tts_backend.NativeTtsBackend.cancel). One-shot generation has no such hook:
     an offline family cannot be interrupted mid-run, so tts_cancel is a documented
     no-op while a one-shot request is in flight.
  3. _to_int16_24k_mono resampled with unantialiased linear interpolation whenever
     src_sr != target_sr (e.g. Supertonic 44100->24000). Now uses soxr, already a
     pinned dependency.
"""
import asyncio
import inspect
import queue
import time

import numpy as np
import soxr

TARGET_RATE = 24000


def _to_int16_24k_mono(samples, src_sr, target_sr=TARGET_RATE) -> bytes:
    x = np.asarray(samples, dtype=np.float32)
    if x.ndim == 2:                       # (n, channels) -> mono, BEFORE resampling
        x = x.mean(axis=1)
    x = x.reshape(-1)
    if src_sr != target_sr and x.size:
        x = soxr.resample(x, src_sr, target_sr).astype(np.float32)
    x = np.clip(x, -1.0, 1.0)
    return (x * 32767.0).astype(np.int16).tobytes()


class TtsEngine:
    def __init__(self):
        self._backend = None
        self.sample_rate = TARGET_RATE      # reported contract rate (always 24k)
        self.streaming = False
        self.clones = False
        self.model_id = None
        self.resolved = None
        # M2: the connection that currently owns the loaded model (set by
        # _h_tts_init, compared by identity -- never an id, which can be reused
        # after reconnection -- in _h_tts_generate/_h_tts_cancel). None means "no
        # owner recorded yet" (nothing has ever called tts_init through the
        # handler layer), which disables the check entirely -- matches every
        # pre-M2 test double that talks to this engine directly, bypassing
        # tts_init.
        self._owner_conn = None
        # M5: bumped at the START of every init() (before close()) -- a stale
        # teardown closure captured by an EARLIER tts_init compares the generation
        # it captured against this CURRENT value and no-ops if a fresher init has
        # since run. See _tts_teardown()'s own docstring for the race this guards.
        #
        # M5b (TOCTOU fix): the bump itself must happen on the asyncio LOOP
        # thread, synchronized with DISPATCHING init() to the executor, not
        # inside init() itself -- init() runs off-loop (see _h_tts_init), so two
        # concurrent tts_inits could otherwise interleave such that init N's
        # own bump-and-close-and-load body was still running (blocked deep in
        # model loading) when init N+1 ran to completion on a different
        # executor thread and bumped this same counter past N's. N's handler
        # would then read the ALREADY-BUMPED value belonging to N+1 -- it only
        # read `self.generation` AFTER its own executor call returned -- and
        # register a teardown carrying N+1's generation instead of its own; a
        # later disconnect on N's connection would then incorrectly pass
        # _tts_teardown's staleness guard and tear down N+1's still-live
        # engine (ledgered in slice 5's final review as the M5 TOCTOU window).
        # next_generation() is the fix: it is called synchronously by
        # _h_tts_init, on the loop thread, BEFORE dispatch, and contains no
        # `await` -- see its own docstring for why that makes the capture
        # atomic with dispatch order without needing a lock.
        self._generation = 0

    @property
    def is_loaded(self) -> bool:
        return self._backend is not None

    @property
    def generation(self) -> int:
        return self._generation

    def next_generation(self) -> int:
        """M5b: bump-and-return the generation token, meant to be called on the
        asyncio LOOP thread by _h_tts_init BEFORE it dispatches init() to the
        executor (see the TOCTOU trace in __init__'s docstring above). This
        needs no lock: asyncio's event loop is single-threaded and this method
        contains no `await`, so no other coroutine can ever run between two
        calls to it -- each call is a single, uninterruptible read-increment-
        write of a plain Python int. Once a generation number is reserved this
        way, the executor threads that later run init() for it never write
        `self._generation` themselves (see init()'s own comment) -- only this
        method ever does -- so there is no cross-thread race on the field
        either."""
        self._generation += 1
        return self._generation

    def init(self, model_id=None, device="auto", language="", pin=None, generation=None):
        from . import accel, catalog
        t0 = time.time()
        if generation is None:
            # Legacy self-bump path: every direct call that predates M5b (this
            # module's own test suite calls eng.init(...) this way throughout,
            # and any future in-process caller that bypasses _h_tts_init). Not
            # atomic against a concurrent init on another thread -- exactly the
            # pre-M5b behavior -- but nothing calls init() this way concurrently.
            self._generation += 1
        # else: _h_tts_init already reserved this exact generation number via
        # next_generation(), synchronously on the loop thread, before
        # dispatching this call to the executor -- see __init__'s docstring.
        # Deliberately NOT reassigning self._generation here: this method body
        # runs off-loop, potentially in a DIFFERENT executor thread than a
        # slower-or-faster sibling init() dispatched around the same time, and
        # writing here could clobber a generation number a fresher, already-
        # dispatched init() bumped past this one in the meantime with this
        # (older) call's own, now-stale number.
        self.close()                        # VRAM hygiene: free any prior model first
        mid = model_id or "moss-tts-nano"
        plans = accel.resolve_tts(mid, override=device or "auto", pin=pin)
        self._backend, plan, notice, mem = accel.load_measured(plans, stage="tts")
        if hasattr(self._backend, "set_language"):
            self._backend.set_language(language or "")
        # I2 (fix wave): the family's advertised caps.sample_rate is no longer read
        # here for resampling -- generate()/generate_stream() now resample with the
        # ACTUAL per-synth rate the backend itself returns, which can differ from
        # this default. Nothing else in this class needs the advertised default, so
        # it is no longer cached as an instance attribute.
        self.streaming = bool(getattr(self._backend, "STREAMING", False))
        self.clones = bool(getattr(self._backend, "CLONES", False))
        self.model_id = mid
        self.resolved = {"backend": plan.backend, "device": plan.device,
                         "computeType": plan.compute_type,
                         "streaming": self.streaming, "clones": self.clones}
        if plan.config.tts_family:
            self.resolved["family"] = plan.config.tts_family
        rtf = accel.measure_rtf_tts(self._backend, plan, mid, accel.probe())
        if rtf is not None:
            self.resolved["rtf"] = round(rtf, 3)
        if mem is not None:
            self.resolved["memoryBytes"] = mem
        if notice:
            self.resolved["fallbackReason"] = notice
        return int((time.time() - t0) * 1000)

    def set_voice(self, audio, sr, ref_text=None):
        # native_tts's set_voice always takes ref_text; the ONNX/sherpa/MLX backends
        # that used to disagree (MOSS/OmniVoice clip-only, no ref_text parameter at
        # all; Qwen3/CosyVoice3/GPT-SoVITS ICL cloning) are gone (slice 4's catalog
        # rewire). The signature-sniff below is now dead weight against native_tts
        # itself -- every one of its nine families accepts ref_text (native/src/
        # sk_tts.cpp's set_voice always takes one) -- and serves only the hand-rolled
        # test fakes in this module's own test suite that still model both shapes.
        wav = np.asarray(audio, dtype=np.float32)
        sr = int(sr)
        params = inspect.signature(self._backend.set_voice).parameters
        if "ref_text" in params:               # ICL cloning backend (e.g. Qwen3, native_tts)
            self._backend.set_voice(wav, sr, ref_text=ref_text or "")
        else:                                   # clip-only backend (e.g. MOSS) — no transcript arg
            self._backend.set_voice(wav, sr)

    def set_builtin_voice(self, name):
        self._backend.set_builtin_voice(name)

    def list_builtin_voices(self):
        """Delegate to the loaded backend's own list_builtin_voices() when it has
        one. native_tts always does (it's `.presets()`, present on every one of its
        nine families' backend instances) -- the ONNX/sherpa/MLX backends that used
        to disagree (MOSS with no such method at all; Qwen3/CosyVoice3/OmniVoice's
        stub always returning []) are gone (slice 4). The `hasattr` degrade-to-[]
        below is now dead weight against native_tts itself and serves only the
        hand-rolled test fakes in this module's own test suite that still model a
        backend without the method; tts_voices.py only reaches this once it already
        decided the loaded model is the one being asked about."""
        if hasattr(self._backend, "list_builtin_voices"):
            return self._backend.list_builtin_voices()
        return []

    def cancel_active(self) -> None:
        """Reach through to the loaded backend's own cancel() (see
        NativeTtsBackend.cancel's docstring) -- this is what actually stops native
        generation between chunks. state["tts_cancels"] (set by the callers of this
        method) is a separate, client-side flag: it only stops THIS process from
        relaying further chunks to the wire, and stays useful as a safety net
        independent of whatever the backend itself is doing."""
        backend = self._backend
        if backend is not None and hasattr(backend, "cancel"):
            try:
                backend.cancel()
            except Exception:
                pass

    def generate(self, text, speed=1.0):
        # I2: resample with the ACTUAL rate this synth returned, not self._native_sr
        # (the family's advertised caps default, set once at init() and never
        # updated) -- a family whose real output rate differs from its own
        # capabilities.sample_rate would otherwise be resampled from the WRONG
        # source rate and come out pitch-shifted.
        samples, rate, gen_ms = self._backend.generate(text, speed)
        return _to_int16_24k_mono(samples, rate), gen_ms

    async def generate_stream(self, text, speed, send, should_cancel, msg_id):
        """Drive the backend's frame generator in a worker thread; push tts_chunk
        deltas (Int16@24k) via `send`, then tts_done. Cancellation is checked
        per chunk via should_cancel() -- a client-side stop that complements, but
        does not replace, cancel_active() reaching into the backend itself."""
        loop = asyncio.get_running_loop()
        q: "queue.Queue" = queue.Queue()
        SENTINEL = object()

        def worker():
            try:
                for chunk, rate in self._backend.generate_stream(text, speed):
                    if should_cancel():
                        break
                    q.put(("chunk", (chunk, rate)))
            except Exception as e:            # surface, then terminate the stream
                q.put(("error", str(e)))
            finally:
                q.put((SENTINEL, None))

        fut = loop.run_in_executor(None, worker)
        t0 = time.time()
        seq = 0
        total = 0
        errored = False
        while True:
            kind, payload = await loop.run_in_executor(None, q.get)
            if kind is SENTINEL:
                break
            if kind == "error":
                await send({"type": "error", "id": msg_id, "message": payload})
                errored = True
                break
            # I2: resample each chunk with ITS OWN actual rate (see generate()'s
            # comment above) -- not self._native_sr.
            chunk, rate = payload
            pcm = _to_int16_24k_mono(chunk, rate)
            total += len(pcm) // 2
            await send({"type": "tts_chunk", "id": msg_id, "seq": seq}, binary=pcm)
            seq += 1
        await fut
        # A genuine failure already got its own "error" push (review round 1,
        # CQ-2) -- a tts_done on top of that would misreport the failed request
        # as a (merely short) success. should_cancel()-driven early stops are
        # NOT an error and still report tts_done as before.
        if not errored:
            await send({"type": "tts_done", "id": msg_id, "totalSamples": total,
                        "generationTimeMs": int((time.time() - t0) * 1000)})

    def close(self):
        from . import accel
        accel.ledger_release("tts")
        backend = self._backend
        self._backend = None
        self.model_id = None
        self._owner_conn = None   # T4-info: no backend left for _owner_conn to refer to
        if backend is not None:
            try:
                backend.unload()
            except Exception:
                pass


def _tts_teardown(state, conn, generation=None):
    """Free this connection's TTS model when the connection closes.

    Reads the stream task from conn.ctx at close time: tts_generate creates it after
    tts_init registered this cleanup.

    M5: `generation` is the engine's generation token AT THE TIME the tts_init that
    registered THIS closure finished loading (see _h_tts_init). eng.init() calls
    close() on entry for VRAM hygiene, and that now runs off the event loop, so a
    stale teardown from a PRIOR tts_init on this (or another) connection could
    otherwise still be in flight -- or fire later, e.g. on disconnect -- racing a
    fresher init's own close()+load() sequence and tearing down a model that
    fresher init has since loaded. Comparing the captured generation against the
    engine's CURRENT one (getattr-guarded so a caller/test double with no
    `.generation` at all -- i.e. every pre-M5 direct call -- behaves exactly as
    before, generation=None disabling the check) makes a superseded teardown a
    no-op: whichever tts_init is CURRENT owns cleanup, and its own teardown will
    run later.
    """
    task = conn.ctx.get("tts_stream_task")
    if task is not None:
        task.cancel()
    eng = state.get("tts_engine")
    if eng is not None:
        if generation is not None and getattr(eng, "generation", None) != generation:
            return
        # Cancel the backend's own in-flight generation BEFORE closing the
        # engine (review round 1, CQ-4): close() -> backend.unload() cancels and
        # joins the streaming worker itself, but reaching into cancel_active()
        # first signals it to stop as early as possible rather than relying on
        # unload()'s own (also correct, but later) cancel+join.
        try:
            eng.cancel_active()
        except Exception:
            pass
        try:
            eng.close()
        except Exception:
            pass


async def _h_tts_init(state, msg, _b, conn=None):
    eng = state["tts_engine"]
    loop = asyncio.get_running_loop()
    # M5b (TOCTOU fix): reserve this init's generation number on the LOOP
    # thread, BEFORE dispatching init() to the executor below -- see
    # TtsEngine.next_generation()'s docstring for why this is atomic without a
    # lock. getattr-guarded: a bare test double standing in for the engine
    # (every pre-M5 direct handler call in this module's test suite) has no
    # `.next_generation`, so `generation` stays None -- init()'s own legacy
    # self-bump kicks in instead, and _tts_teardown's staleness check is
    # disabled entirely, preserving pre-M5 behavior for it (see that
    # function's docstring).
    next_gen = getattr(eng, "next_generation", None)
    generation = next_gen() if next_gen is not None else None
    # Off the event loop: model load (and the full synthesis measure_rtf_tts runs
    # inside it) must not stall this connection's ASR/translate traffic while it's
    # happening -- defect 1.
    ms = await loop.run_in_executor(
        None, lambda: eng.init(msg.get("model"), msg.get("device", "auto"),
                               msg.get("language", ""), pin=msg.get("variant"),
                               generation=generation))
    # M2: this connection now owns the loaded model -- tts_generate/tts_cancel from
    # a DIFFERENT live connection are rejected (see the ownership check in both
    # handlers below). A later tts_init, from this connection or another, still
    # evicts unconditionally (eng.init()'s own close-on-entry, unchanged) and simply
    # records the new owner here.
    eng._owner_conn = conn
    # M5b: use the generation number reserved ABOVE, before dispatch -- not a
    # fresh read of eng.generation now that the executor call has returned.
    # Reading it now (the pre-M5b bug) would risk observing a LATER init's own
    # bump if one raced this one and finished first (see the TOCTOU trace in
    # TtsEngine.__init__'s docstring); the local `generation` variable captured
    # above cannot be affected by anything that happened after it was read.
    # This connection owns the TTS model: closing it frees the model from VRAM.
    if conn is not None:
        conn.on_close(lambda: _tts_teardown(state, conn, generation))
    reply = {"type": "ready", "id": msg.get("id"), "sampleRate": eng.sample_rate,
             "loadTimeMs": ms}
    if eng.resolved:
        reply.update(eng.resolved)
    return reply, None


async def _h_set_voice(state, msg, binary_in, conn=None):
    """Two forms: a built-in preset by name, or a custom clone from a reference
    clip (raw Float32 PCM in `binary_in`, optional refText). The style-vector
    (Supertonic) and numeric-speaker-id (range models) forms native_tts has no
    equivalent for (spec §5.3/§5.5) died with the ONNX Supertonic/sherpa/MOSS
    backends in Task 5's catalog rewire and the renderer's setStyleVoice/
    setSpeaker senders in Task 6 -- a stray `styleVoice`/`sid` field on an
    incoming message is simply not looked at anymore; a message with no `voice`
    name falls through to the clone-from-clip branch, same as before."""
    eng = state["tts_engine"]
    loop = asyncio.get_running_loop()
    name = msg.get("voice")
    if name:                                  # built-in by name (no binary frame)
        await loop.run_in_executor(None, eng.set_builtin_voice, str(name))
    else:                                      # custom clone from clip
        audio = np.frombuffer(binary_in, dtype=np.float32) if binary_in else np.zeros(0, np.float32)
        sr = int(msg.get("sampleRate", 24000))
        ref_text = msg.get("refText")
        await loop.run_in_executor(None, lambda: eng.set_voice(audio, sr, ref_text=ref_text))
    return {"type": "ok", "id": msg.get("id")}, None


def _not_owner_error(mid, msg_type):
    # M2: stable, greppable marker embedded in the message text -- wire_schema.json's
    # "error" shape only carries {message, id, model} (no `code` field), so there is
    # nowhere else to put a distinct code string.
    return {"type": "error", "id": mid,
            "message": f"not_owner: {msg_type} from a connection that does not "
                       "own the loaded TTS model"}


async def _h_tts_generate(state, msg, _b, conn=None):
    eng = state["tts_engine"]
    loop = asyncio.get_running_loop()
    text = msg.get("text", "")
    speed = float(msg.get("speed", 1.0))
    mid = msg.get("id")
    # M2: cross-connection crosstalk guard. `state["tts_engine"]` is a PROCESS
    # SINGLETON (module docstring), so without this check a second connection's
    # tts_generate could poison the first connection's `state["tts_cancels"]` entry
    # (keyed globally by mid, not per-connection) or, in the one-shot branch below,
    # just run a completely different connection's request against the model the
    # OWNER loaded. getattr-guarded: a bare test double with no `._owner_conn` (every
    # pre-M2 direct handler call) reads None, which -- same as "no owner recorded
    # yet" -- disables the check.
    owner = getattr(eng, "_owner_conn", None)
    if owner is not None and conn is not None and conn is not owner:
        return _not_owner_error(mid, "tts_generate"), None
    if eng.streaming and conn is not None:
        cancels = state.setdefault("tts_cancels", {})
        # Cancel any prior in-flight stream on this connection (one active stream per
        # conn): flip its cancel flag AND reach into the backend's own cancel()
        # BEFORE detaching the asyncio Task -- cancelling only the Task stops it at
        # its next await, but the actual generation runs in a separate executor
        # thread that otherwise keeps consuming the GPU until the backend notices
        # (defect 2).
        prior = conn.ctx.get("tts_stream_task")
        if prior is not None and not prior.done():
            prior_mid = conn.ctx.get("tts_stream_mid")
            if prior_mid is not None:
                cancels[prior_mid] = True

                def _pop_stale_cancel_flag(task, _mid=prior_mid):
                    # M3: a task cancelled via .cancel() BEFORE the event loop ever
                    # scheduled its coroutine body (e.g. two tts_generate calls
                    # processed back-to-back with no intervening await-that-
                    # suspends) closes WITHOUT ever entering _run_tts_stream(), so
                    # that coroutine's own `finally: cancels.pop(mid, None)` never
                    # runs -- cancels[_mid] would otherwise leak for the rest of
                    # the process (dead but bounded: _mid is never read again once
                    # the stream it named is gone). done_callback fires once the
                    # task is fully finished, whether or not its body ever ran;
                    # task.cancelled() is True in the already-running case too
                    # (CancelledError propagates out uncaught), where the
                    # coroutine's own finally already popped it -- this is then
                    # just a harmless, idempotent no-op second pop.
                    if task.cancelled():
                        cancels.pop(_mid, None)

                prior.add_done_callback(_pop_stale_cancel_flag)
            eng.cancel_active()
            prior.cancel()

        cancels[mid] = False

        async def _run_tts_stream():
            try:
                await eng.generate_stream(text, speed, conn.send,
                                          lambda: cancels.get(mid, False), mid)
            finally:
                cancels.pop(mid, None)
                if conn.ctx.get("tts_stream_task") is asyncio.current_task():
                    conn.ctx.pop("tts_stream_task", None)
                    conn.ctx.pop("tts_stream_mid", None)

        conn.ctx["tts_stream_task"] = asyncio.create_task(_run_tts_stream())
        conn.ctx["tts_stream_mid"] = mid
        return None, None                  # dispatched; read loop stays live for tts_cancel
    # One-shot generation cannot be interrupted mid-run (offline families run to
    # completion once started) -- off the event loop for the same reason init is
    # (defect 1); tts_cancel against it is a no-op by design (defect 2).
    pcm, gen_ms = await loop.run_in_executor(None, lambda: eng.generate(text, speed))
    reply = {"type": "tts_generate_result", "id": mid, "sampleRate": eng.sample_rate,
             "generationTimeMs": gen_ms, "samples": len(pcm) // 2}
    return reply, pcm


async def _h_tts_cancel(state, msg, _b, conn=None):
    """Review CQ-8: reaching into the backend (cancel_active() -> backend.cancel())
    must be gated on `mid` naming the connection's CURRENTLY active stream
    (conn.ctx['tts_stream_mid'], set/cleared by _h_tts_generate's streaming
    branch) -- backend.cancel() always targets whatever stream is most recently
    started (tts_backend.py's self._workers[-1]), so calling it unconditionally
    for a stale/already-completed/superseded id would stop a DIFFERENT, still-
    wanted stream instead of doing nothing. The client-side relay flag
    (state["tts_cancels"], polled by generate_stream's should_cancel()) has no
    such ambiguity -- it is keyed by id and stays set unconditionally.

    M2: a cancel from a connection other than the one that owns the loaded model is
    rejected outright (not_owner error) rather than merely gated on active_mid below
    -- state["tts_cancels"] is a single dict shared by every connection (the engine
    is a process singleton), so a foreign connection guessing/replaying an id could
    otherwise still flip the OWNER's cancel flag even though CQ-8's active_mid check
    already stops it from reaching cancel_active()."""
    mid = msg.get("id")
    eng = state.get("tts_engine")
    owner = getattr(eng, "_owner_conn", None) if eng is not None else None
    if owner is not None and conn is not None and conn is not owner:
        return _not_owner_error(mid, "tts_cancel"), None
    cancels = state.get("tts_cancels") or {}
    if mid in cancels:
        cancels[mid] = True
    active_mid = conn.ctx.get("tts_stream_mid") if conn is not None else None
    if eng is not None and mid is not None and mid == active_mid:
        eng.cancel_active()
    return {"type": "ok", "id": mid}, None


async def _h_list_tts_voices(state, msg, _b, conn=None):
    from . import tts_voices
    loop = asyncio.get_running_loop()
    # Off the event loop (review round 1, CQ-5): when the requested model is the
    # one currently loaded, this reaches TtsModel.presets(), which takes the
    # same per-handle native mutex a synth() in flight holds -- blocking here
    # would stall this connection's ASR/translate traffic exactly like the
    # other one-shot calls defect 1 already fixed.
    voices = await loop.run_in_executor(
        None, lambda: tts_voices.list_builtin_voices(msg.get("model"), state.get("tts_engine")))
    return {"type": "list_tts_voices_result", "id": msg.get("id"), "voices": voices}, None


def register(state: dict):
    state.setdefault("handlers", {}).update(
        {"tts_init": _h_tts_init, "set_voice": _h_set_voice,
         "tts_generate": _h_tts_generate, "tts_cancel": _h_tts_cancel,
         "list_tts_voices": _h_list_tts_voices})
