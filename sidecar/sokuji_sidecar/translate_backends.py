"""Translation backend adapters. Mirror the ASR backends' load()/unload()
contract but expose translate() instead of transcribe(). Registered into the
shared backends registry on import.

  llamacpp_qwen       — Qwen 2.5 / 3 / 3.5 GGUF served by a local llama-server
                        child. Qwen3 and Qwen3.5 both default to thinking mode
                        on; disabled via chat_template_kwargs.enable_thinking
                        (Qwen3.5 ignores the /no_think soft switch, still kept
                        for plain Qwen3 as belt-and-braces).
  llamacpp_hunyuan    — HY-MT2 / HY-MT1.5 1.8B / 7B GGUF served by a local
                        llama-server child (single-user-turn prompt template).
  llamacpp_gemma      — TranslateGemma 4B GGUF served by a local llama-server
                        child started with --no-jinja, driven via /completion
                        with a self-rendered prompt (its jinja chat template
                        crashes llama-server at load time otherwise).
  ct2_opus_translate  — Opus-MT via CTranslate2 int8, Ct2OpusSession
                        (pair-baked direction)."""
import os
import re

from .backends import register_backend, BackendLoadError
from .ct2_opus import Ct2OpusSession
from .planner import PlanConfig

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
    """Shared llama-server plumbing; subclasses provide NAME + _payload().

    EXTRA_ARGS lets a subclass pass extra CLI flags to the spawned
    llama-server (e.g. TranslateGemma's `--no-jinja`, see LlamaCppGemmaBackend).
    _post() is the overridable transport hook (default: /v1/chat/completions
    via LlamaServerProc.chat); _send() wraps it with the one-restart-retry so
    subclasses that swap transport (e.g. Gemma's /completion) don't have to
    duplicate that logic."""
    MAX_TOKENS = 512
    EXTRA_ARGS: list[str] = []

    def __init__(self):
        self._proc = None
        self._config = PlanConfig()  # inert default; load() overwrites it
        self._last_reply = None   # kept for tests/diagnostics
        self._dead_reason = None  # set when the server crashed twice in a row

    def load(self, model_ref: str, device: str, compute_type: str, config=None) -> None:
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
            proc = rt.LlamaServerProc(binary, gguf, fit_target_mib=fit,
                                       extra_args=self.EXTRA_ARGS)
            proc.start()
            self._proc = proc
            self._config = config or PlanConfig()
            self._dead_reason = None
        except BackendLoadError:
            raise
        except Exception as e:
            raise BackendLoadError(str(e))

    def _payload(self, text, system_prompt, src, tgt, wrap) -> dict:
        raise NotImplementedError

    def _post(self, payload: dict) -> dict:
        return self._proc.chat(payload)

    def _send(self, payload: dict) -> dict:
        if self._proc is None:
            raise BackendLoadError(self._dead_reason or "llama-server is not running")
        try:
            reply = self._post(payload)
        except Exception:
            # One in-place restart when the child died (GGUF already on disk,
            # restart is seconds); a second death right after a fresh start is
            # unrecoverable in-session (e.g. VRAM exhaustion crashing the CUDA
            # backend on the first request) — LATCH dead instead of restarting
            # on every utterance, which thrashed one model reload per ASR
            # result. Subsequent calls fail fast with the crash reason.
            if self._proc is not None and not self._proc.alive():
                self._proc.restart()
                try:
                    reply = self._post(payload)
                except Exception as e:
                    if not self._proc.alive():
                        tail = self._proc.stderr_tail()
                        self._proc.stop()
                        self._proc = None
                        self._dead_reason = (
                            f"llama-server crashed twice in a row; translation "
                            f"disabled for this session: {tail[-300:]}")
                        raise BackendLoadError(self._dead_reason) from e
                    raise
            else:
                raise
        self._last_reply = reply
        return reply

    def translate(self, text: str, system_prompt: str, src: str, tgt: str,
                  wrap: bool) -> tuple[str, int]:
        payload = self._payload(text, system_prompt, src, tgt, wrap)
        reply = self._send(payload)
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
        # Whole Qwen3 family (Qwen3 and Qwen3.5) ships a chat template with
        # thinking mode on by default. Verified live against the GGUFs: the
        # `/no_think` soft switch in the system prompt does NOT work on
        # Qwen3.5 — it still burns all 512 max_tokens on <think> reasoning
        # and returns empty content. The request-level
        # `chat_template_kwargs: {enable_thinking: false}` DOES work for both
        # Qwen3 and Qwen3.5 (verified: correct short output in a handful of
        # tokens), so it's the canonical kill-switch applied to both.
        # `/no_think` is kept for Qwen3 only as belt-and-braces per Qwen3's
        # own docs — it's a no-op string for templates that ignore it.
        # Which family a loaded model belongs to is a catalog-card fact
        # (Plan.config.disable_thinking / .append_no_think, populated by
        # planner._plan_config from the resolved TranslateModel), injected at
        # load() — not re-derived from the model path here.
        payload: dict = {}
        if self._config.disable_thinking:
            payload["chat_template_kwargs"] = {"enable_thinking": False}
        if self._config.append_no_think:
            sys_p = f"{sys_p} /no_think"
        user = f"<transcript>{text}</transcript>" if wrap else text
        payload.update({"messages": [{"role": "system", "content": sys_p},
                                      {"role": "user", "content": user}],
                        "temperature": 0, "max_tokens": self.MAX_TOKENS})
        return payload


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
    """TranslateGemma 4B GGUF (mradermacher quant). The upstream jinja chat
    template raises for plain-string user content, and llama-server b9835's
    load-time automatic-parser generation triggers that raise as an uncaught
    C++ exception (SIGABRT before /health ever returns) — so this backend
    starts the server with --no-jinja and drives it directly via the raw
    /completion endpoint with a self-rendered prompt, instead of
    /v1/chat/completions + chat_template_kwargs."""
    NAME = "llamacpp_gemma"
    MAX_TOKENS = 256
    EXTRA_ARGS = ["--no-jinja"]

    def _post(self, payload: dict) -> dict:
        return self._proc.completion(payload)

    def translate(self, text: str, system_prompt: str, src: str, tgt: str,
                  wrap: bool) -> tuple[str, int]:
        payload = {"prompt": self._render_prompt(text, src, tgt, wrap),
                   "temperature": 0, "n_predict": self.MAX_TOKENS}
        reply = self._send(payload)
        content = reply["content"]
        n = int(reply.get("tokens_predicted") or 0)
        return _clean_output(content), n

    def _render_prompt(self, text, src, tgt, wrap):
        body = f"<transcript>{text}</transcript>" if wrap else text
        s_name, s_code = src or "the source language", _gemma_code(src)
        t_name, t_code = tgt or "the target language", _gemma_code(tgt)
        # A falsy src/tgt has no real code — _gemma_code(name) on a falsy name
        # just passes that same falsy value straight through the dict .get()
        # fallback — so appending " (code)" unconditionally rendered a leaked
        # empty parenthetical: "the source language ()". Only append it when
        # there's both a real language name AND a real code for it.
        s_label = f"{s_name} ({s_code})" if src and s_code else s_name
        t_label = f"{t_name} ({t_code})" if tgt and t_code else t_name
        return (f"<start_of_turn>user\nYou are a professional {s_label} to {t_label} "
                f"translator. Your goal is to accurately convey the meaning and nuances of the original "
                f"{s_name} text while adhering to {t_name} grammar, vocabulary, and cultural sensitivities.\n"
                f"Produce only the {t_name} translation, without any additional explanations or commentary. "
                f"Please translate the following {s_name} text into {t_name}:\n\n\n"
                f"{body}<end_of_turn>\n<start_of_turn>model\n")


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
class Ct2OpusTranslateBackend:
    NAME = "ct2_opus_translate"

    def __init__(self):
        self._session = None

    def load(self, model_ref: str, device: str, compute_type: str, config=None) -> None:
        self._session = None
        try:
            path = model_ref
            if not os.path.isdir(path):
                from huggingface_hub import snapshot_download
                path = snapshot_download(model_ref, local_files_only=True)
            self._session = Ct2OpusSession(path)
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
