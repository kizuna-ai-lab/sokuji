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
    translate_cancel."""
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
    # Off the event loop: a multi-second generation must not stall this connection's
    # ASR traffic (same defect class the spec fixes for TTS in slice 4).
    translated, ms = await loop.run_in_executor(
        None, lambda: state["translate_engine"].translate(
            text, msg.get("systemPrompt", ""), bool(msg.get("wrapTranscript", False)),
            on_partial=on_partial))
    return {"type": "translate_result", "id": msg.get("id"),
            "sourceText": text, "translatedText": translated, "inferenceTimeMs": ms}, None


def register(state: dict):
    state.setdefault("handlers", {}).update(
        {"translate_init": _h_translate_init, "translate": _h_translate})
