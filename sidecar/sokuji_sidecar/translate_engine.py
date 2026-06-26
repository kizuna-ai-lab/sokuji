import time
from . import translate_backends  # noqa: F401 — registers qwen_translate/qwen35_translate


class TranslateEngine:
    def __init__(self):
        self._tok = None
        self._model = None
        self._backend = None
        self._src = ""
        self._tgt = ""
        self.resolved = None

    def init(self, model_id=None, source_lang="", target_lang="", device="auto"):
        t0 = time.time()
        self.close()                       # VRAM hygiene: free any prior model first
        self._src, self._tgt = source_lang, target_lang
        from . import accel
        plans = accel.resolve_translate(model_id or "qwen2.5-0.5b", override=device or "auto")
        self._backend, plan, notice, mem = accel.load_measured(plans)
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
        if self._backend is not None:
            try:
                self._backend.unload()
            except Exception:
                pass
            self._backend = None
        self._tok = None
        self._model = None


async def _h_translate_init(state, msg, _b, conn=None):
    ms = state["translate_engine"].init(
        msg.get("model"), msg.get("sourceLang", ""), msg.get("targetLang", ""),
        msg.get("device", "auto"))
    # This connection owns the translate model: closing it frees the model from VRAM
    # (mirrors the ASR streaming connection's on_binary ownership in server._conn).
    if conn is not None:
        conn.ctx["owns_translate"] = True
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
