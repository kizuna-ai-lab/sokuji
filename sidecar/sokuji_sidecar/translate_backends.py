"""Translation backend adapters (transformers, text-only). Mirror the ASR
backends' load()/unload() contract but expose translate() instead of
transcribe(). Registered into the shared backends registry on import.

  qwen_translate     — Qwen 2.5 / 3, AutoModelForCausalLM (/no_think for Qwen3).
  qwen35_translate   — Qwen 3.5, Qwen3_5ForConditionalGeneration (VLM class), text-only.
  hunyuan_translate  — HY-MT2 1.8B / 7B, AutoModelForCausalLM (hunyuan_v1_dense, native).
  gemma_translate    — TranslateGemma 4B, Gemma3ForConditionalGeneration (VLM class), text-only.
  opus_translate     — MarianMT seq2seq, AutoModelForSeq2SeqLM (pair-baked direction).

All support CPU (float32) and GPU (bfloat16) via .to(device)."""
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


def _hunyuan_prompt(tgt: str) -> str:
    t = tgt or "the target language"
    # HY-MT2's documented English instruction; the model auto-detects the source.
    return (f"Translate the following text into {t}. Note that you should only "
            "output the translated result without any additional explanation: ")


@register_backend
class HunyuanTranslateBackend:
    NAME = "hunyuan_translate"

    def __init__(self):
        self._model = None
        self._tok = None
        self._device = "cpu"

    def load(self, model_ref: str, device: str, compute_type: str) -> None:
        self._model = None
        self._tok = None
        try:
            import torch
            # hunyuan_v1_dense is native to transformers 5.13 (no auto_map, no
            # modeling_*.py in the repo) → plain AutoModelForCausalLM, no trust_remote_code.
            from transformers import AutoModelForCausalLM, AutoTokenizer
            self._tok = AutoTokenizer.from_pretrained(model_ref, local_files_only=True)
            if compute_type == "fp8":
                # Pre-quantized compressed-tensors checkpoint: let its quantization_config
                # drive loading (dtype="auto"); forcing a dtype would fight the quant.
                model = AutoModelForCausalLM.from_pretrained(
                    model_ref, dtype="auto", local_files_only=True)
            else:
                dtype = torch.bfloat16 if compute_type == "bfloat16" else torch.float32
                model = AutoModelForCausalLM.from_pretrained(
                    model_ref, dtype=dtype, local_files_only=True)
            self._model = model.to(device).eval()
            self._device = device
        except Exception as e:
            raise BackendLoadError(str(e))

    def translate(self, text: str, system_prompt: str, src: str, tgt: str, wrap: bool) -> tuple[str, int]:
        import torch
        instr = system_prompt or _hunyuan_prompt(tgt)
        body = f"<transcript>{text}</transcript>" if wrap else text
        messages = [{"role": "user", "content": f"{instr}{body}"}]
        prompt = self._tok.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
        inputs = self._tok(prompt, return_tensors="pt").to(self._device)
        with torch.inference_mode():
            out = self._model.generate(**inputs, max_new_tokens=512, do_sample=False)
        gen = out[0][inputs["input_ids"].shape[1]:]
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
class GemmaTranslateBackend:
    NAME = "gemma_translate"

    def __init__(self):
        self._model = None
        self._tok = None
        self._device = "cpu"

    def load(self, model_ref: str, device: str, compute_type: str) -> None:
        self._model = None
        self._tok = None
        try:
            import torch
            # Text-only: drive AutoTokenizer + the text model class, NOT AutoProcessor.
            # TranslateGemma is a Gemma-3 VLM; AutoProcessor builds an image/video
            # processor that hard-requires torchvision (no wheel for this torch build).
            from transformers import Gemma3ForConditionalGeneration, AutoTokenizer
            dtype = torch.bfloat16 if compute_type == "bfloat16" else torch.float32
            self._tok = AutoTokenizer.from_pretrained(model_ref, local_files_only=True)
            self._model = Gemma3ForConditionalGeneration.from_pretrained(
                model_ref, dtype=dtype, local_files_only=True).to(device).eval()
            self._device = device
        except Exception as e:
            raise BackendLoadError(str(e))

    def translate(self, text: str, system_prompt: str, src: str, tgt: str, wrap: bool) -> tuple[str, int]:
        import torch
        # TranslateGemma is driven by per-message source/target language codes, not a
        # free-text instruction — system_prompt is not applicable to its template.
        body = f"<transcript>{text}</transcript>" if wrap else text
        messages = [{"role": "user", "content": [{
            "type": "text",
            "source_lang_code": _gemma_code(src),
            "target_lang_code": _gemma_code(tgt),
            "text": body,
        }]}]
        prompt = self._tok.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
        inputs = self._tok(prompt, return_tensors="pt").to(self._device)
        with torch.inference_mode():
            out = self._model.generate(**inputs, max_new_tokens=256, do_sample=False)
        gen = out[0][inputs["input_ids"].shape[1]:]
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
class OpusTranslateBackend:
    NAME = "opus_translate"

    def __init__(self):
        self._model = None
        self._tok = None
        self._device = "cpu"

    def load(self, model_ref: str, device: str, compute_type: str) -> None:
        self._model = None
        self._tok = None
        try:
            import torch
            # MarianMT is a small seq2seq model, core to transformers (no
            # trust_remote_code, no VLM processor). bf16 on GPU, float32 on CPU.
            from transformers import AutoModelForSeq2SeqLM, AutoTokenizer
            dtype = torch.bfloat16 if compute_type == "bfloat16" else torch.float32
            self._tok = AutoTokenizer.from_pretrained(model_ref, local_files_only=True)
            self._model = AutoModelForSeq2SeqLM.from_pretrained(
                model_ref, dtype=dtype, local_files_only=True).to(device).eval()
            self._device = device
        except Exception as e:  # missing torch/transformers, no CUDA, OOM → resolver falls back
            raise BackendLoadError(str(e))

    def translate(self, text: str, system_prompt: str, src: str, tgt: str, wrap: bool) -> tuple[str, int]:
        # The translation direction is baked into the model — system_prompt, src,
        # tgt and wrap are intentionally ignored. generate() emits only the
        # translation tokens (no input prefix to slice off).
        import torch
        inputs = self._tok(text, return_tensors="pt").to(self._device)
        with torch.inference_mode():
            out = self._model.generate(**inputs, max_new_tokens=512, do_sample=False)
        seq = out[0]
        return self._tok.decode(seq, skip_special_tokens=True).strip(), int(seq.shape[-1])

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
