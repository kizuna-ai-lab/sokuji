import time
from . import translate_backends  # noqa: F401 — registers the llamacpp_*/ct2_opus_translate backends


def _translate_teardown(state):
    """Free this connection's translate model when the connection closes."""
    eng = state.get("translate_engine")
    if eng is not None:
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

    def init(self, model_id=None, source_lang="", target_lang="", device="auto",
             reserved_bytes=0, pin=None):
        t0 = time.time()
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

    def translate(self, text, system_prompt="", wrap_transcript=False):
        t0 = time.time()
        if not text.strip():
            return "", 0
        out, _n_tokens = self._backend.translate(text, system_prompt, self._src, self._tgt, wrap_transcript)
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
    # footprint is already out of the free-VRAM reading --fit takes); only
    # not-yet-loaded stages reserve their download-size estimate.
    planned = {}
    for stage, k in (("asr", "asrModel"), ("tts", "ttsModel")):
        mid = msg.get(k)
        if mid:
            planned[stage] = native_models.model_size(mid) or 0
    reserve = accel.ledger_effective_reserve("translate", planned)
    ms = state["translate_engine"].init(
        msg.get("model"), msg.get("sourceLang", ""), msg.get("targetLang", ""),
        msg.get("device", "auto"), reserved_bytes=reserve, pin=msg.get("variant"))
    # This connection owns the translate model: closing it frees the model from VRAM.
    if conn is not None:
        conn.on_close(lambda: _translate_teardown(state))
    reply = {"type": "ready", "id": msg.get("id"), "loadTimeMs": ms}
    resolved = getattr(state["translate_engine"], "resolved", None)
    if resolved:
        reply.update(resolved)
    return reply, None


async def _h_translate(state, msg, _b, conn=None):
    text = msg.get("text", "")
    translated, ms = state["translate_engine"].translate(
        text, msg.get("systemPrompt", ""), bool(msg.get("wrapTranscript", False)))
    return {"type": "translation", "id": msg.get("id"),
            "sourceText": text, "translatedText": translated, "inferenceTimeMs": ms}, None


def register(state: dict):
    state.setdefault("handlers", {}).update(
        {"translate_init": _h_translate_init, "translate": _h_translate})
