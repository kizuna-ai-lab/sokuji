"""Translation backend over sokuji_native's Translator (llama.cpp in-process, spec
§4.3/§5.3): one GGUF chat model per handle, three prompt-strategy classes selected by
the resolved catalog card's PlanConfig.prompt_family ("qwen" | "hunyuan" | "gemma").
Mirrors asr_backend's load()/unload() contract and native.module()/GGUF-resolution
pattern; exposes translate() (with an optional on_partial per-token callback) instead
of transcribe().

Historical note: the four llama-server/CTranslate2 backends this module replaces
(llamacpp_qwen/hunyuan/gemma, ct2_opus_translate) spawned an external process or a
separate CTranslate2 runtime; this backend runs in-process through sokuji_native, so
there is no child process, no --no-jinja/--completion transport split, and no
CTranslate2 Opus-MT pair-baked models (those 13 catalog rows are gone with the
runtime).

  QwenStrategy    — Qwen 2.5 / 3 / 3.5 chat template. Qwen3 and Qwen3.5 both default
                    to thinking mode on; disabled via an empty <think> block forced as
                    the assistant's prefill (config.disable_thinking) — the native
                    replacement for llama-server's chat_template_kwargs.enable_thinking
                    =false (the legacy formatter has no jinja kwargs, so killing
                    thinking at the token level is the only lever). /no_think is kept
                    appended to the system prompt for plain Qwen3 only
                    (config.append_no_think), belt-and-braces per Qwen3's own docs;
                    Qwen3.5 ignores it (verified live against llama-server).
  HunyuanStrategy — HY-MT2 / HY-MT1.5 1.8B / 7B: single-user-turn prompt, no prefill.
  GemmaStrategy   — TranslateGemma 4B: bypasses the chat template entirely (its jinja
                    template crashes the legacy chat-template formatter) via a
                    self-rendered prompt through sk_translate_complete — the same
                    prompt the old --no-jinja + /completion path used.
"""
import os
import re

from . import native
from .backends import BackendLoadError, register_backend
from .catalog import split_artifact
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


class QwenStrategy:
    max_tokens = 512

    def build(self, text, system_prompt, src, tgt, wrap, config):
        sys_p = system_prompt or _default_prompt(src, tgt)
        if config.append_no_think:
            sys_p = f"{sys_p} /no_think"
        user = f"<transcript>{text}</transcript>" if wrap else text
        messages = [{"role": "system", "content": sys_p}, {"role": "user", "content": user}]
        prefill = "<think>\n\n</think>\n\n" if config.disable_thinking else None
        return "chat", messages, prefill


class HunyuanStrategy:
    max_tokens = 512

    def build(self, text, system_prompt, src, tgt, wrap, config):
        instr = system_prompt or _hunyuan_prompt(tgt)
        body = f"<transcript>{text}</transcript>" if wrap else text
        messages = [{"role": "user", "content": f"{instr}{body}"}]
        return "chat", messages, None


class GemmaStrategy:
    max_tokens = 256

    def build(self, text, system_prompt, src, tgt, wrap, config):
        return "complete", self._render_prompt(text, src, tgt, wrap), None

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


STRATEGIES = {"qwen": QwenStrategy(), "hunyuan": HunyuanStrategy(), "gemma": GemmaStrategy()}


def _chatml_fallback(messages, prefill):
    """Minimal self-rendered chatml prompt for a GGUF whose template the legacy
    formatter doesn't know (sk_translate_chat's "chat template not supported"
    contract). Only ever used for the qwen/hunyuan strategies — gemma already
    bypasses the chat template via sk_translate_complete. Whether this path ever
    actually fires against a real GGUF is Task 5's live-run question."""
    rendered = "".join(f"<|im_start|>{m['role']}\n{m['content']}<|im_end|>\n" for m in messages)
    rendered += "<|im_start|>assistant\n"
    if prefill:
        rendered += prefill
    return rendered


@register_backend
class NativeTranslateBackend:
    NAME = "native_translate"

    def __init__(self):
        self._t = None
        self._config = PlanConfig()
        self._strategy = STRATEGIES["qwen"]

    def load(self, model_ref: str, device: str, compute_type: str, config=None) -> None:
        self.unload()
        try:
            if os.path.exists(model_ref):
                # A plain existing dir/file path passes through unchanged (used by
                # tests, and any future local-file catalog entry).
                path = model_ref
            else:
                from huggingface_hub import hf_hub_download
                repo, fname = split_artifact(model_ref)
                if not fname:
                    raise BackendLoadError(
                        f"native_translate needs an 'org/repo/file.gguf' artifact, got {model_ref!r}")
                path = hf_hub_download(repo, fname, local_files_only=True)
            dev = native.device_for(device) if device != "cpu" else None
            self._config = config or PlanConfig()
            # Unknown/missing prompt_family defaults to the qwen shape (plain
            # system+user messages) — the safest generic default among the three.
            self._strategy = STRATEGIES.get(self._config.prompt_family or "qwen", STRATEGIES["qwen"])
            self._t = native.module().translate_load(path, device=dev)
        except BackendLoadError:
            self.unload()
            raise
        except Exception as e:  # missing wheel/gguf, no vulkan/metal device, NativeError → resolver falls back
            self.unload()
            raise BackendLoadError(str(e))

    def translate(self, text: str, system_prompt: str, src: str, tgt: str,
                  wrap: bool, on_partial=None) -> tuple[str, int]:
        if self._t is None:
            raise BackendLoadError("native_translate not loaded")
        kind, payload, prefill = self._strategy.build(text, system_prompt, src, tgt, wrap, self._config)
        n = [0]
        acc = []

        def on_token(piece):
            acc.append(piece)
            n[0] += 1
            if on_partial is not None:
                on_partial(_clean_output("".join(acc)))
            return True

        # A generation failure here is not a load failure: it is not wrapped into
        # BackendLoadError — it propagates to the engine's caller, mirroring the
        # old backends' _send()/translate() raising straight through.
        if kind == "chat":
            try:
                full = self._t.chat(payload, max_tokens=self._strategy.max_tokens,
                                    assistant_prefill=prefill, on_token=on_token)
            except Exception as e:
                if "chat template not supported" not in str(e):
                    raise
                acc.clear()
                n[0] = 0
                prompt = _chatml_fallback(payload, prefill)
                full = self._t.complete(prompt, max_tokens=self._strategy.max_tokens, on_token=on_token)
        else:
            full = self._t.complete(payload, max_tokens=self._strategy.max_tokens, on_token=on_token)
        return _clean_output(full), n[0]

    def unload(self) -> None:
        t, self._t = self._t, None
        if t is not None:
            try:
                t.unload()
            except Exception:
                pass

    @property
    def is_loaded(self) -> bool:
        return self._t is not None
