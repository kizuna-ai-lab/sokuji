import asyncio
import sys
import time


def _translate_teardown(state, generation=None):
    """Free this connection's translate model when the connection closes.

    M5 twin (see tts_engine.py's _tts_teardown docstring for the full trace of
    the race this guards -- ledgered against this exact line, tts_engine.py's own
    _h_tts_init comment history, and .superpowers/slice5-surface-inventory.md
    §10(a)): TranslateEngine.init() below also calls close() on entry for VRAM
    hygiene; `generation` is the engine's generation token captured by
    _h_translate_init at the time IT finished loading, and a stale teardown from
    an earlier init (superseded by a fresher one since) no-ops instead of tearing
    down the newer, currently-live backend. generation=None (every pre-M5 direct
    call) disables the check, matching the old unconditional-close behavior.

    Disconnect-triggered cancel (slice-5 task 5; ground truth
    .superpowers/slice5-surface-inventory.md §10(b) -- the translate-side twin of
    tts_engine._tts_teardown's own CQ-4 fix): cancel the backend's own in-flight
    generation BEFORE closing the engine. close() -> backend.unload() cancels and
    joins every outstanding worker itself (translate_backend.py's I3 twin), but
    reaching into cancel_active() first signals it to stop as early as possible
    rather than relying solely on unload()'s own (also correct, but later)
    cancel+join. No new wire message this slice (ruling R20): a disconnected
    client's generation is what gets cancelled, never a client-sent
    translate_cancel.

    CORRECTION (ruling R26, fix round 1): this closure only runs from
    server._conn's on_close list, which fires once _conn's own
    `async for raw in ws:` loop returns -- i.e. AFTER whatever handler call
    was in flight when the connection closed already finished. Confirmed live
    by the round-1 reviewer: it does NOT fire mid-flight for a disconnect
    racing THIS connection's own currently-running translate(), because
    server.py's per-connection dispatch is serial (the handler is awaited
    inline, not scheduled as a background task). This function still matters
    -- a stale/superseded engine close, and a same-connection disconnect
    noticed at the next message -- but the mid-flight race is instead handled
    by _h_translate itself (see its docstring), which races the executor
    future against conn.wait_closed() directly and calls cancel_active() the
    moment the close-waiter wins, without ever needing this closure to run."""
    eng = state.get("translate_engine")
    if eng is not None:
        if generation is not None and getattr(eng, "generation", None) != generation:
            return
        try:
            eng.cancel_active()
        except Exception:
            pass
        try:
            eng.close()
        except Exception:
            pass


class TranslateEngine:
    def __init__(self):
        self._tok = None
        self._model = None
        self._backend = None
        self._src = ""
        self._tgt = ""
        self.resolved = None
        # M5 twin: see _translate_teardown()'s docstring.
        self._generation = 0

    @property
    def generation(self) -> int:
        return self._generation

    def init(self, model_id=None, source_lang="", target_lang="", device="auto",
             reserved_bytes=0, pin=None):
        t0 = time.time()
        self._generation += 1              # M5 twin: bump BEFORE close(), see docstring above
        self.close()                       # VRAM hygiene: free any prior model first
        self._src, self._tgt = source_lang, target_lang
        from . import accel
        plans = accel.resolve_translate(model_id or "qwen2.5-0.5b", override=device or "auto",
                                        reserved_bytes=reserved_bytes, pin=pin)
        self._backend, plan, notice, mem = accel.load_measured(plans, stage="translate")
        tps = accel.measure_tps(self._backend, plan, model_id or "qwen2.5-0.5b", accel.probe())
        self.resolved = {"backend": plan.backend, "device": plan.device,
                         "computeType": plan.compute_type}
        if tps is not None:
            self.resolved["tokensPerSec"] = round(tps, 1)
        if mem is not None:
            self.resolved["memoryBytes"] = mem
        if notice:
            self.resolved["fallbackReason"] = notice
        return int((time.time() - t0) * 1000)

    def cancel_active(self) -> None:
        """Reach through to the loaded backend's own cancel() (see
        NativeTranslateBackend.cancel's docstring) — mirrors
        TtsEngine.cancel_active() (tts_engine.py) for the translate side. Called
        by _translate_teardown BEFORE close()."""
        backend = self._backend
        if backend is not None and hasattr(backend, "cancel"):
            try:
                backend.cancel()
            except Exception:
                pass

    def translate(self, text, system_prompt="", wrap_transcript=False, on_partial=None):
        t0 = time.time()
        if not text.strip():
            return "", 0
        out, _n_tokens = self._backend.translate(text, system_prompt, self._src, self._tgt,
                                                 wrap_transcript, on_partial=on_partial)
        return out, int((time.time() - t0) * 1000)

    def close(self):
        from . import accel
        accel.ledger_release("translate")
        if self._backend is not None:
            try:
                self._backend.unload()
            except Exception:
                pass
            self._backend = None
        self._tok = None
        self._model = None


async def _h_translate_init(state, msg, _b, conn=None):
    from . import accel, native_models
    # Ledger-aware reserve: a stage that already LOADED reserves NOTHING (its
    # footprint is already out of every free-VRAM reading placement takes);
    # only not-yet-loaded stages reserve their download-size estimate.
    planned = {}
    for stage, k in (("asr", "asrModel"), ("tts", "ttsModel")):
        mid = msg.get(k)
        if mid:
            planned[stage] = native_models.model_size(mid) or 0
    reserve = accel.ledger_effective_reserve("translate", planned)
    ms = state["translate_engine"].init(
        msg.get("model"), msg.get("sourceLang", ""), msg.get("targetLang", ""),
        msg.get("device", "auto"), reserved_bytes=reserve, pin=msg.get("variant"))
    # M5 twin: capture the generation THIS init produced (getattr-guarded: a bare
    # test double has no `.generation`, and None disables _translate_teardown's
    # staleness check entirely -- see its docstring).
    generation = getattr(state["translate_engine"], "generation", None)
    # This connection owns the translate model: closing it frees the model from VRAM.
    if conn is not None:
        conn.on_close(lambda: _translate_teardown(state, generation))
    reply = {"type": "ready", "id": msg.get("id"), "loadTimeMs": ms}
    resolved = getattr(state["translate_engine"], "resolved", None)
    if resolved:
        reply.update(resolved)
    return reply, None


async def _h_translate(state, msg, _b, conn=None):
    """Ruling R26 (ground truth .superpowers/slice5-surface-inventory.md
    §10(b)): a disconnect must be able to cancel a generation THIS coroutine
    is still awaiting, not merely one server._conn notices at its next
    iteration. server._conn's `async for raw in ws:` loop awaits this handler
    call inline and serially -- it cannot notice `conn.on_close()`-registered
    cleanups (see _translate_teardown) until this coroutine RETURNS, by which
    point a plain `await loop.run_in_executor(...)` would already have let the
    generation run to completion for a client that is long gone.

    Fix: race the executor future against `conn.wait_closed()` (server.Conn;
    see its own docstring for why that resolves independent of _conn's
    recv() loop) via asyncio.wait(FIRST_COMPLETED). If the close-waiter wins,
    server._conn's per-connection serialization guarantees THIS CONNECTION has
    at most one translate() in flight at a time, so eng.cancel_active() targets
    an in-flight call that is either ours or -- see M-3 correction below --
    already finished/superseded; the cancelled (or already-done) call still
    has to be awaited to completion (its worker thread must actually exit --
    translate_backend.py's cb-False path makes that quick, within one token)
    before this coroutine returns, but the result is discarded and no reply is
    sent (`return None, None` -- server.Conn.send() is a no-op for that, and
    there is nothing left to reply to). If the executor future wins (the
    overwhelmingly common case), the close-waiter task is cancelled so it
    doesn't leak, and dispatch proceeds exactly as before this fix.

    CORRECTION (ruling M-3, final fix wave): the paragraph above used to claim
    "this connection is the ONLY caller that can be running a translate() on
    it right now" -- true PER-CONNECTION (server._conn's serial dispatch means
    THIS connection can never have two translate() calls in flight at once),
    but false PER-PROCESS. `state["translate_engine"]` is a process-wide
    singleton (`__main__.py`'s construction, shared by every connection the
    sidecar serves, exactly like `state["tts_engine"]` -- ground truth
    .superpowers/slice5-surface-inventory.md §10(c)/M2, "cross-conn cancel
    crosstalk -- singleton evicts"), so a SECOND connection can be concurrently
    running its own translate() against that same shared `self._backend`
    whenever both connections are using an already-loaded model without an
    intervening translate_init. `eng.cancel_active()` -> `backend.cancel()`
    targets `self._workers[-1]` -- the MOST RECENTLY STARTED call across every
    connection sharing that backend, not "our own" by identity -- so under
    that concurrent-connection condition this can cancel a DIFFERENT
    connection's in-flight generation instead of (or as well as) this one's
    own. This is the identical root cause and shape as M2, accepted there as
    a "larger design question" needing a per-connection engine or an explicit
    ownership token (ground truth, same section) rather than a one-liner fix;
    not fixed here for the same reason. unload()'s own cancel-everything
    backstop (translate_backend.py's I-1 fix) still guarantees no worker is
    ever freed out from under a live native call regardless of which
    connection's tail got mistargeted -- only the CHOICE of which in-flight
    call gets cancelled early is what this correction narrows."""
    text = msg.get("text", "")
    loop = asyncio.get_running_loop()
    on_partial = None
    if conn is not None:
        reported = [False]  # latch: only the FIRST partial-send failure logs per request

        def _report_partial_failure(fut):
            # run_coroutine_threadsafe's Future is otherwise never awaited or
            # inspected, so an exception raised inside conn.send (e.g. a
            # strict-mode wire-schema violation) would vanish with no log and
            # every remaining partial would silently stop arriving while the
            # final reply still shows up. Surface it once; never raise from here.
            if reported[0]:
                return
            try:
                e = fut.exception()
            except Exception:
                return
            if e is not None:
                reported[0] = True
                print(f"[sokuji-sidecar] translate_partial send failed: {e!r}",
                      file=sys.stderr, flush=True)

        def on_partial(acc):
            # Called from the executor thread below: hop back to the loop for the send.
            fut = asyncio.run_coroutine_threadsafe(
                conn.send({"type": "translate_partial", "text": acc}), loop)
            fut.add_done_callback(_report_partial_failure)

    eng = state["translate_engine"]
    # Off the event loop: a multi-second generation must not stall this connection's
    # ASR traffic (same defect class the spec fixes for TTS in slice 4).
    exec_future = loop.run_in_executor(
        None, lambda: eng.translate(
            text, msg.get("systemPrompt", ""), bool(msg.get("wrapTranscript", False)),
            on_partial=on_partial))

    close_task = None
    if conn is not None and hasattr(conn, "wait_closed"):
        try:
            close_task = asyncio.ensure_future(conn.wait_closed())
        except Exception:
            # T5a: `hasattr` only proves the attribute exists, not that calling
            # it succeeds -- a conn/transport that exposes wait_closed() but
            # raises the moment it's actually called (e.g. not really
            # implemented) must not propagate out of this handler, and must
            # not silently win the race below as a false "already closed"
            # either. Fall back to the no-race path exactly like a conn
            # without wait_closed() at all.
            close_task = None

    if close_task is None:
        # No connection to race a close signal against: every direct-call/
        # test-double path that predates R26 (conn=None), a conn without
        # wait_closed() (defensive -- treated as "never closes"), or one whose
        # wait_closed() itself failed synchronously (T5a).
        translated, ms = await exec_future
        return {"type": "translate_result", "id": msg.get("id"),
                "sourceText": text, "translatedText": translated, "inferenceTimeMs": ms}, None

    done, _pending = await asyncio.wait(
        {exec_future, close_task}, return_when=asyncio.FIRST_COMPLETED)

    if exec_future not in done:
        # R26: the connection closed WHILE this generation was still running.
        # cancel_active() reaches the backend's own tail worker -- per
        # server._conn's serial per-connection dispatch this connection itself
        # never has a second translate() in flight, but the backend can be
        # process-wide-shared with another connection (see the M-3 correction
        # above) -- and its on_token cb-False path (translate_backend.py)
        # turns that into a native-level cancel within one token. Await the
        # executor future to completion so the worker thread is actually
        # joined before this coroutine returns (translate_engine.translate()
        # -> NativeTranslateBackend.translate() never raises on a cancellation
        # it caused itself -- see that module's docstring -- but tolerate one
        # anyway rather than trust that invariant here).
        eng.cancel_active()
        try:
            await exec_future
        except Exception as e:
            # T5c: translate_backend.py's own docstring says a cancellation WE
            # triggered never raises past this point -- an exception surfacing
            # here anyway is UNEXPECTED, e.g. a genuine backend failure that
            # happened to land in the same window as the disconnect. There is
            # no client left to reply to either way, but silently swallowing a
            # real failure here would erase the only signal it ever happened.
            print(f"[sokuji-sidecar] translate cancel-on-disconnect: in-flight "
                  f"call raised {e!r}", file=sys.stderr, flush=True)
        return None, None

    # The generation finished first (the common case): stop racing the close
    # waiter so it doesn't leak a pending task per translate() call.
    close_task.cancel()
    try:
        await close_task
    except asyncio.CancelledError:
        pass
    except Exception as e:
        # T5b: a genuine failure inside conn.wait_closed() itself (not just our
        # own .cancel() landing) -- log rather than silently swallow so a
        # transport-level wait_closed() defect doesn't vanish with zero signal.
        print(f"[sokuji-sidecar] translate close-waiter failed: {e!r}",
              file=sys.stderr, flush=True)
    translated, ms = exec_future.result()
    return {"type": "translate_result", "id": msg.get("id"),
            "sourceText": text, "translatedText": translated, "inferenceTimeMs": ms}, None


def register(state: dict):
    state.setdefault("handlers", {}).update(
        {"translate_init": _h_translate_init, "translate": _h_translate})
