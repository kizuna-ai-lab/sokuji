"""Translation backend adapters. Mirror the ASR backends' load()/unload()
contract but expose translate() instead of transcribe(). Registered into the
shared backends registry on import.

  llamacpp_qwen       — Qwen 2.5 / 3 / 3.5 GGUF served by a local llama-server
                        child (/no_think for Qwen3, not Qwen3.5).
  llamacpp_hunyuan    — HY-MT2 / HY-MT1.5 1.8B / 7B GGUF served by a local
                        llama-server child (single-user-turn prompt template).
  llamacpp_gemma      — TranslateGemma 4B GGUF served by a local llama-server
                        child, steered via chat_template_kwargs language codes.
  opus_onnx_translate — MarianMT via ONNX Runtime, MarianOnnxSession
                        (pair-baked direction)."""
import os
import re

from .backends import register_backend, BackendLoadError
from .marian_onnx import MarianOnnxSession

_TRANSCRIPT_TAG = re.compile(r"</?transcript>", re.IGNORECASE)


def _default_prompt(src: str, tgt: str) -> str:
    s = src or "the source language"
    t = tgt or "the target language"
    return (f"You are a translator. Translate the text from {s} to {t}. "
            "Output only the translation, no explanations, no refusal.")


def _clean_output(text: str) -> str:
    """Clean a model's raw translation output: drop any <think>…</think> reasoning
    block, then strip stray <transcript>/</transcript> tags. Small Qwen models echo
    the wrapped input's framing (e.g. trailing '</transcript>') into the output."""
    if "</think>" in text:
        text = text.split("</think>", 1)[1]
    text = _TRANSCRIPT_TAG.sub("", text)
    return text.strip()


class _LlamaCppBase:
    """Shared llama-server plumbing; subclasses provide NAME + _payload()."""
    MAX_TOKENS = 512

    def __init__(self):
        self._proc = None
        self._ref = ""
        self._last_reply = None   # kept for tests/diagnostics

    def load(self, model_ref: str, device: str, compute_type: str) -> None:
        from . import llama_runtime as rt
        self.unload()
        try:
            flavor = rt.flavor_for_device(device)
            binary = rt.binary_path(flavor)
            if binary is None:
                raise BackendLoadError(
                    f"llama runtime ({flavor}) is not installed — download the model again")
            gguf = rt.gguf_path(model_ref)
            fit = None
            if device != "cpu":
                fit = 1024 + rt.get_reserved_bytes() // (1 << 20)
            proc = rt.LlamaServerProc(binary, gguf, fit_target_mib=fit)
            proc.start()
            self._proc = proc
            self._ref = model_ref
        except BackendLoadError:
            raise
        except Exception as e:
            raise BackendLoadError(str(e))

    def _payload(self, text, system_prompt, src, tgt, wrap) -> dict:
        raise NotImplementedError

    def translate(self, text: str, system_prompt: str, src: str, tgt: str,
                  wrap: bool) -> tuple[str, int]:
        payload = self._payload(text, system_prompt, src, tgt, wrap)
        try:
            reply = self._proc.chat(payload)
        except Exception:
            # One in-place restart when the child died (GGUF already on disk,
            # restart is seconds); a second failure propagates.
            if self._proc is not None and not self._proc.alive():
                self._proc.restart()
                reply = self._proc.chat(payload)
            else:
                raise
        self._last_reply = reply
        content = reply["choices"][0]["message"]["content"]
        n = int((reply.get("usage") or {}).get("completion_tokens") or 0)
        return _clean_output(content), n

    def unload(self) -> None:
        if self._proc is not None:
            self._proc.stop()
            self._proc = None

    @property
    def is_loaded(self) -> bool:
        return self._proc is not None


@register_backend
class LlamaCppQwenBackend(_LlamaCppBase):
    NAME = "llamacpp_qwen"

    def _payload(self, text, system_prompt, src, tgt, wrap):
        sys_p = system_prompt or _default_prompt(src, tgt)
        # Qwen3 (not 3.5) needs thinking mode off; card repos are named
        # sokuji-translate-qwen3-0.6b-* vs ...-qwen3.5-*, so match "qwen3-".
        if "qwen3-" in self._ref.lower():
            sys_p = f"{sys_p} /no_think"
        user = f"<transcript>{text}</transcript>" if wrap else text
        return {"messages": [{"role": "system", "content": sys_p},
                             {"role": "user", "content": user}],
                "temperature": 0, "max_tokens": self.MAX_TOKENS}


@register_backend
class LlamaCppHunyuanBackend(_LlamaCppBase):
    NAME = "llamacpp_hunyuan"

    def _payload(self, text, system_prompt, src, tgt, wrap):
        instr = system_prompt or _hunyuan_prompt(tgt)
        body = f"<transcript>{text}</transcript>" if wrap else text
        return {"messages": [{"role": "user", "content": f"{instr}{body}"}],
                "temperature": 0, "max_tokens": self.MAX_TOKENS}


@register_backend
class LlamaCppGemmaBackend(_LlamaCppBase):
    NAME = "llamacpp_gemma"
    MAX_TOKENS = 256

    def _payload(self, text, system_prompt, src, tgt, wrap):
        # TranslateGemma is steered by per-request language codes, not free-text
        # instructions — system_prompt is not applicable to its template.
        # llama-server injects the codes via chat_template_kwargs (PR #19052).
        body = f"<transcript>{text}</transcript>" if wrap else text
        return {"messages": [{"role": "user", "content": body}],
                "chat_template_kwargs": {"source_lang_code": _gemma_code(src),
                                         "target_lang_code": _gemma_code(tgt)},
                "temperature": 0, "max_tokens": self.MAX_TOKENS}


def _hunyuan_prompt(tgt: str) -> str:
    t = tgt or "the target language"
    # HY-MT2's documented English instruction; the model auto-detects the source.
    return (f"Translate the following text into {t}. Note that you should only "
            "output the translated result without any additional explanation: ")


# Full English language name -> BCP-47 code for TranslateGemma's chat-template
# source_lang_code/target_lang_code fields. The engine passes full names; unknown
# names (or values that are already codes) pass through unchanged.
_GEMMA_LANG_CODE = {
    "English": "en", "Chinese": "zh", "Japanese": "ja", "Korean": "ko",
    "French": "fr", "German": "de", "Spanish": "es", "Portuguese": "pt",
    "Italian": "it", "Russian": "ru", "Arabic": "ar", "Hindi": "hi",
    "Dutch": "nl", "Vietnamese": "vi", "Thai": "th", "Indonesian": "id",
    "Turkish": "tr", "Polish": "pl", "Ukrainian": "uk", "Greek": "el",
}


def _gemma_code(name: str) -> str:
    return _GEMMA_LANG_CODE.get(name, name)


@register_backend
class OpusOnnxTranslateBackend:
    NAME = "opus_onnx_translate"

    def __init__(self):
        self._session = None

    def load(self, model_ref: str, device: str, compute_type: str) -> None:
        self._session = None
        try:
            path = model_ref
            if not os.path.isdir(path):
                from huggingface_hub import snapshot_download
                path = snapshot_download(model_ref, local_files_only=True)
            self._session = MarianOnnxSession(path)
        except Exception as e:
            raise BackendLoadError(str(e))

    def translate(self, text: str, system_prompt: str, src: str, tgt: str,
                  wrap: bool) -> tuple[str, int]:
        # The translation direction is baked into the model — system_prompt,
        # src, tgt and wrap are intentionally ignored.
        return self._session.translate(text)

    def unload(self) -> None:
        self._session = None

    @property
    def is_loaded(self) -> bool:
        return self._session is not None
