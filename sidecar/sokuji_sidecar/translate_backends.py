"""Translation backend adapters (transformers, text-only). Mirror the ASR
backends' load()/unload() contract but expose translate() instead of
transcribe(). Registered into the shared backends registry on import.

  qwen_translate    — Qwen 2.5 / 3, AutoModelForCausalLM (/no_think for Qwen3).
  qwen35_translate  — Qwen 3.5, Qwen3_5ForConditionalGeneration (VLM class), text-only.

Both support CPU (float32) and GPU (bfloat16) via .to(device)."""
import re

from .backends import register_backend, BackendLoadError

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


@register_backend
class QwenTranslateBackend:
    NAME = "qwen_translate"

    def __init__(self):
        self._model = None
        self._tok = None
        self._device = "cpu"
        self._ref = ""

    def load(self, model_ref: str, device: str, compute_type: str) -> None:
        self._model = None
        self._tok = None
        try:
            import torch
            from transformers import AutoModelForCausalLM, AutoTokenizer
            dtype = torch.bfloat16 if compute_type == "bfloat16" else torch.float32
            self._tok = AutoTokenizer.from_pretrained(model_ref, local_files_only=True)
            self._model = AutoModelForCausalLM.from_pretrained(
                model_ref, dtype=dtype, local_files_only=True).to(device).eval()
            self._device = device
            self._ref = model_ref
        except Exception as e:  # missing torch/transformers, no CUDA, OOM → resolver falls back
            raise BackendLoadError(str(e))

    def translate(self, text: str, system_prompt: str, src: str, tgt: str, wrap: bool) -> tuple[str, int]:
        import torch
        sys_p = system_prompt or _default_prompt(src, tgt)
        if "qwen3" in self._ref.lower():        # Qwen3 thinking-mode off; Qwen2.5 ignores it
            sys_p = f"{sys_p} /no_think"
        user = f"<transcript>{text}</transcript>" if wrap else text
        messages = [{"role": "system", "content": sys_p},
                    {"role": "user", "content": user}]
        prompt = self._tok.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
        inputs = self._tok(prompt, return_tensors="pt").to(self._device)
        with torch.inference_mode():
            out = self._model.generate(**inputs, max_new_tokens=512, do_sample=False)
        gen = out[0][inputs["input_ids"].shape[1]:]
        # Return (text, generated-token count) — the count feeds the tokens/sec benchmark.
        return _clean_output(self._tok.decode(gen, skip_special_tokens=True)), int(gen.shape[0])

    def unload(self) -> None:
        self._model = None
        self._tok = None
        try:
            import torch
            torch.cuda.empty_cache()
        except Exception:
            pass

    @property
    def is_loaded(self) -> bool:
        return self._model is not None


@register_backend
class Qwen35TranslateBackend:
    NAME = "qwen35_translate"

    def __init__(self):
        self._model = None
        self._tok = None
        self._device = "cpu"

    def load(self, model_ref: str, device: str, compute_type: str) -> None:
        self._model = None
        self._tok = None
        try:
            import torch
            from transformers import Qwen3_5ForConditionalGeneration, AutoTokenizer
            dtype = torch.bfloat16 if compute_type == "bfloat16" else torch.float32
            # Text-only: drive a plain tokenizer, NOT AutoProcessor. Qwen3.5 is a VLM and
            # its AutoProcessor eagerly builds Qwen3VLVideoProcessor, which hard-requires
            # torchvision (no wheel for the sidecar's torch build). The tokenizer carries
            # the chat template and is all text-only generation needs.
            self._tok = AutoTokenizer.from_pretrained(model_ref, local_files_only=True)
            self._model = Qwen3_5ForConditionalGeneration.from_pretrained(
                model_ref, dtype=dtype, local_files_only=True).to(device).eval()
            self._device = device
        except Exception as e:  # missing qwen3_5 class, no CUDA, OOM → resolver falls back
            raise BackendLoadError(str(e))

    def translate(self, text: str, system_prompt: str, src: str, tgt: str, wrap: bool) -> tuple[str, int]:
        import torch
        sys_p = system_prompt or _default_prompt(src, tgt)   # Qwen3.5 is non-thinking by default
        user = f"<transcript>{text}</transcript>" if wrap else text
        messages = [{"role": "system", "content": sys_p},
                    {"role": "user", "content": user}]
        prompt = self._tok.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
        inputs = self._tok(prompt, return_tensors="pt").to(self._device)
        with torch.inference_mode():
            out = self._model.generate(**inputs, max_new_tokens=512, do_sample=False)
        gen = out[0][inputs["input_ids"].shape[1]:]
        # Return (text, generated-token count) — the count feeds the tokens/sec benchmark.
        return _clean_output(self._tok.decode(gen, skip_special_tokens=True)), int(gen.shape[0])

    def unload(self) -> None:
        self._model = None
        self._tok = None
        try:
            import torch
            torch.cuda.empty_cache()
        except Exception:
            pass

    @property
    def is_loaded(self) -> bool:
        return self._model is not None
