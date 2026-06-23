import time


class TranslateEngine:
    def __init__(self):
        self._tok = None
        self._model = None
        self._opus = None       # torch-free onnxruntime opus-mt path
        self._src = ""
        self._tgt = ""

    def init(self, model_id=None, source_lang="", target_lang=""):
        import os
        t0 = time.time()
        self._src, self._tgt = source_lang, target_lang
        if model_id and "opus-mt" in model_id:
            from .opus_mt import OpusMtTranslator
            onnx_repo = model_id if "/" in model_id else f"Xenova/{model_id}"
            self._opus = OpusMtTranslator(onnx_repo)
            return int((time.time() - t0) * 1000)
        # Not an Opus-MT model: clear any previously loaded Opus translator so
        # translate() doesn't keep taking the Opus branch on the next session.
        self._opus = None
        from transformers import AutoModelForCausalLM, AutoTokenizer  # lazy: torch pulled here
        mid = model_id or os.environ.get("SOKUJI_TRANSLATE_MODEL", "Qwen/Qwen2.5-0.5B-Instruct")
        self._tok = AutoTokenizer.from_pretrained(mid, local_files_only=True)
        self._model = AutoModelForCausalLM.from_pretrained(mid, torch_dtype="auto", local_files_only=True)
        return int((time.time() - t0) * 1000)

    def translate(self, text, system_prompt="", wrap_transcript=False):
        t0 = time.time()
        if self._opus is not None:
            return self._opus.translate(text), int((time.time() - t0) * 1000)
        sys_prompt = system_prompt or (
            f"Translate the following text from {self._src} to {self._tgt}. "
            "Output only the translation, no explanations.")
        user_content = f"<transcript>{text}</transcript>" if wrap_transcript else text
        messages = [{"role": "system", "content": sys_prompt},
                    {"role": "user", "content": user_content}]
        prompt = self._tok.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
        inputs = self._tok(prompt, return_tensors="pt")
        out = self._model.generate(**inputs, max_new_tokens=512, do_sample=False)
        gen = out[0][inputs["input_ids"].shape[1]:]
        translated = self._tok.decode(gen, skip_special_tokens=True).strip()
        return translated, int((time.time() - t0) * 1000)


async def _h_translate_init(state, msg, _b, conn=None):
    ms = state["translate_engine"].init(
        msg.get("model"), msg.get("sourceLang", ""), msg.get("targetLang", ""))
    return {"type": "ready", "id": msg.get("id"), "loadTimeMs": ms}, None


async def _h_translate(state, msg, _b, conn=None):
    text = msg.get("text", "")
    translated, ms = state["translate_engine"].translate(
        text, msg.get("systemPrompt", ""), bool(msg.get("wrapTranscript", False)))
    return {"type": "translation", "id": msg.get("id"),
            "sourceText": text, "translatedText": translated, "inferenceTimeMs": ms}, None


def register(state: dict):
    state.setdefault("handlers", {}).update(
        {"translate_init": _h_translate_init, "translate": _h_translate})
