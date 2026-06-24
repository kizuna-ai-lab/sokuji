"""ASR backend adapters: one class per inference framework, all sharing the
load()/transcribe()/unload() contract. The only code that touches a framework's
real API. Heavy frameworks are imported lazily inside load()."""
from dataclasses import dataclass


@dataclass
class AsrResult:
    text: str
    language: str | None = None


class BackendLoadError(Exception):
    """A backend could not honor (device, compute_type). Drives the resolver's
    fallback to the next plan."""
    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


_BACKENDS: dict[str, type] = {}


def register_backend(cls):
    """Class decorator: register a backend under its NAME for make_backend()."""
    _BACKENDS[cls.NAME] = cls
    return cls


def make_backend(name: str):
    """Instantiate the backend registered under `name`."""
    cls = _BACKENDS.get(name)
    if cls is None:
        raise BackendLoadError(f"unknown backend: {name}")
    return cls()


TARGET_RATE = 16000


@register_backend
class CTranslate2Backend:
    """faster-whisper (CTranslate2). model_ref is a Whisper size like 'tiny' or
    'large-v3'; faster-whisper resolves it to the matching Systran CT2 repo."""
    NAME = "ctranslate2"

    def __init__(self):
        self._m = None

    def load(self, model_ref: str, device: str, compute_type: str) -> None:
        self._m = None
        try:
            from faster_whisper import WhisperModel
            self._m = WhisperModel(model_ref, device=device, compute_type=compute_type)
        except Exception as e:  # missing package or bad device/compute → resolver falls back
            raise BackendLoadError(str(e))

    def transcribe(self, samples, language) -> AsrResult:
        segments, _info = self._m.transcribe(
            samples, language=language, beam_size=1, vad_filter=False)
        return AsrResult("".join(s.text for s in segments).strip(), language)

    def unload(self) -> None:
        self._m = None

    @property
    def is_loaded(self) -> bool:
        return self._m is not None


@register_backend
class SherpaBackend:
    """sherpa-onnx OfflineRecognizer. Phase 0 = SenseVoice (from_sense_voice).
    model_ref is the HF repo id. CPU-only (pip wheel has no GPU runtime)."""
    NAME = "sherpa"

    def __init__(self):
        self._rec = None

    def load(self, model_ref: str, device: str, compute_type: str) -> None:
        self._rec = None
        try:
            import sherpa_onnx
            from huggingface_hub import snapshot_download
            d = snapshot_download(repo_id=model_ref, local_files_only=True)
            self._rec = sherpa_onnx.OfflineRecognizer.from_sense_voice(
                model=f"{d}/model.int8.onnx", tokens=f"{d}/tokens.txt",
                use_itn=True, provider=device)
        except Exception as e:
            raise BackendLoadError(str(e))

    def transcribe(self, samples, language) -> AsrResult:
        s = self._rec.create_stream()
        s.accept_waveform(TARGET_RATE, samples)
        self._rec.decode_stream(s)
        return AsrResult(s.result.text.strip(), None)

    def unload(self) -> None:
        self._rec = None

    @property
    def is_loaded(self) -> bool:
        return self._rec is not None


_GRANITE_SYSTEM = ("Knowledge Cutoff Date: April 2024.\n"
                   "You are Granite, developed by IBM. You are a helpful AI assistant")
_GRANITE_ASR_PROMPT = "<|audio|> can you transcribe the speech into a written format?"


@register_backend
class TransformersBackend:
    """HuggingFace transformers speech-LLM (Granite Speech 4.1). model_ref is the
    HF repo id; GPU-tier (bf16). Loaded via .to(device) (no accelerate). The
    Granite chat template is encapsulated here; a future model would add its own."""
    NAME = "transformers"

    def __init__(self):
        self._model = None
        self._proc = None
        self._device = "cpu"

    def load(self, model_ref: str, device: str, compute_type: str) -> None:
        self._model = None
        self._proc = None
        try:
            import torch
            from transformers import AutoModelForSpeechSeq2Seq, AutoProcessor
            dtype = torch.bfloat16 if compute_type == "bfloat16" else torch.float16
            self._proc = AutoProcessor.from_pretrained(model_ref, local_files_only=True)
            self._model = AutoModelForSpeechSeq2Seq.from_pretrained(
                model_ref, dtype=dtype, local_files_only=True).to(device).eval()
            self._device = device
        except Exception as e:  # missing torch/transformers, no CUDA, OOM → resolver handles
            raise BackendLoadError(str(e))

    def transcribe(self, samples, language) -> AsrResult:
        import torch
        tok = self._proc.tokenizer
        chat = [{"role": "system", "content": _GRANITE_SYSTEM},
                {"role": "user", "content": _GRANITE_ASR_PROMPT}]
        ptext = tok.apply_chat_template(chat, tokenize=False, add_generation_prompt=True)
        inputs = self._proc(ptext, samples, device=self._device, return_tensors="pt").to(self._device)
        with torch.inference_mode():
            out = self._model.generate(**inputs, max_new_tokens=256, do_sample=False, num_beams=1)
        text = tok.decode(out[0, inputs["input_ids"].shape[-1]:], skip_special_tokens=True)
        return AsrResult(text.strip(), language)

    def unload(self) -> None:
        self._model = None
        self._proc = None
        try:
            import torch
            torch.cuda.empty_cache()
        except Exception:
            pass

    @property
    def is_loaded(self) -> bool:
        return self._model is not None


_QWEN_PROMPT = "Transcribe the audio."


def _strip_qwen_prefix(text):
    """Qwen3-ASR emits a structured prefix like 'language Chinese<asr_text>...'."""
    return text.split("<asr_text>", 1)[1].strip() if "<asr_text>" in text else text.strip()


@register_backend
class Qwen3AsrBackend:
    """Qwen3-ASR speech-LLM via native transformers (Qwen3ASRForConditionalGeneration).
    model_ref is the HF repo; GPU-tier (bf16). Requires transformers with the qwen3_asr
    model (5.13.x+); on older transformers load() fails and the resolver excludes it."""
    NAME = "qwen3asr"

    def __init__(self):
        self._model = None
        self._proc = None
        self._device = "cpu"
        self._dtype = None

    def load(self, model_ref: str, device: str, compute_type: str) -> None:
        self._model = None
        self._proc = None
        if device == "cpu":
            raise BackendLoadError("qwen3asr is GPU-only")
        try:
            import torch
            from transformers import Qwen3ASRForConditionalGeneration, AutoProcessor
            self._dtype = torch.bfloat16 if compute_type in ("bfloat16", "auto") else torch.float16
            self._proc = AutoProcessor.from_pretrained(model_ref, local_files_only=True)
            self._model = Qwen3ASRForConditionalGeneration.from_pretrained(
                model_ref, dtype=self._dtype, local_files_only=True).to(device).eval()
            self._device = device
        except Exception as e:  # missing qwen3_asr model, no CUDA, OOM → resolver falls back
            raise BackendLoadError(str(e))

    def transcribe(self, samples, language) -> AsrResult:
        import torch
        conv = [{"role": "user", "content": [{"type": "audio"}, {"type": "text", "text": _QWEN_PROMPT}]}]
        text = self._proc.apply_chat_template(conv, tokenize=False, add_generation_prompt=True)
        inp = self._proc(text=text, audio=samples, sampling_rate=TARGET_RATE, return_tensors="pt").to(self._device)
        if "input_features" in inp:  # quirk: features are float32, model is bf16
            inp["input_features"] = inp["input_features"].to(self._dtype)
        with torch.inference_mode():
            out = self._model.generate(**inp, max_new_tokens=256, do_sample=False)
        decoded = self._proc.batch_decode(out[:, inp["input_ids"].shape[-1]:], skip_special_tokens=True)[0]
        return AsrResult(_strip_qwen_prefix(decoded), language)

    def unload(self) -> None:
        self._model = None
        self._proc = None
        try:
            import torch
            torch.cuda.empty_cache()
        except Exception:
            pass

    @property
    def is_loaded(self) -> bool:
        return self._model is not None


@register_backend
class CohereTransformersBackend:
    """Cohere Transcribe (Fast-Conformer ASR) via native transformers
    (CohereAsrForConditionalGeneration). model_ref is the HF repo; GPU-tier (bf16),
    loaded with .to(device) (no accelerate). A Conformer encoder-decoder, NOT a
    chat-template speech-LLM: the source language is passed through the processor and
    generate() returns only the transcription (no input-prompt slicing). Cohere has no
    auto-detect, so a missing/'auto' language defaults to English."""
    NAME = "cohere_transformers"

    def __init__(self):
        self._model = None
        self._proc = None
        self._device = "cpu"
        self._dtype = None

    def load(self, model_ref: str, device: str, compute_type: str) -> None:
        self._model = None
        self._proc = None
        if device == "cpu":
            raise BackendLoadError("cohere_transformers is GPU-only")
        try:
            import torch
            from transformers import CohereAsrForConditionalGeneration, AutoProcessor
            self._dtype = torch.bfloat16 if compute_type in ("bfloat16", "auto") else torch.float16
            self._proc = AutoProcessor.from_pretrained(model_ref, local_files_only=True)
            self._model = CohereAsrForConditionalGeneration.from_pretrained(
                model_ref, dtype=self._dtype, local_files_only=True).to(device).eval()
            self._device = device
        except Exception as e:  # missing cohere_asr module, no CUDA, OOM → resolver falls back
            raise BackendLoadError(str(e))

    def transcribe(self, samples, language) -> AsrResult:
        import torch
        lang = language if language and language != "auto" else "en"  # no auto-detect
        inp = self._proc(samples, sampling_rate=TARGET_RATE, return_tensors="pt",
                         language=lang).to(self._device)
        if "input_features" in inp:  # features are float32, model is bf16
            inp["input_features"] = inp["input_features"].to(self._dtype)
        with torch.inference_mode():
            out = self._model.generate(**inp, max_new_tokens=256, do_sample=False)
        text = self._proc.batch_decode(out, skip_special_tokens=True)[0]
        return AsrResult(text.strip(), language)

    def unload(self) -> None:
        self._model = None
        self._proc = None
        try:
            import torch
            torch.cuda.empty_cache()
        except Exception:
            pass

    @property
    def is_loaded(self) -> bool:
        return self._model is not None


@register_backend
class VoxtralRealtimeBackend:
    """Voxtral Mini 4B Realtime via native transformers
    (VoxtralRealtimeForConditionalGeneration). model_ref is the HF repo; GPU-tier (bf16),
    loaded with .to(device) (no accelerate). Phase 1 runs the STREAMING model OFFLINE: one
    whole VAD segment per generate() — audio-only input, transcript-only output (no chat
    template, no prompt slice). Multilingual auto-detect, so the language arg is recorded,
    not passed. The processor's tokenizer is mistral_common's, which ignores
    local_files_only; so load() resolves the snapshot DIR and loads the processor from it."""
    NAME = "voxtral_realtime"
    STREAMING = True

    def __init__(self):
        self._model = None
        self._proc = None
        self._device = "cpu"
        self._dtype = None

    def load(self, model_ref: str, device: str, compute_type: str) -> None:
        self._model = None
        self._proc = None
        if device == "cpu":
            raise BackendLoadError("voxtral_realtime is GPU-only")
        try:
            import torch
            from huggingface_hub import snapshot_download
            from transformers import VoxtralRealtimeForConditionalGeneration, AutoProcessor
            self._dtype = torch.bfloat16 if compute_type in ("bfloat16", "auto") else torch.float16
            # mistral_common's tokenizer loader ignores local_files_only / HF_HUB_OFFLINE and
            # tries to hit the hub; loading from the resolved snapshot DIR makes it read the
            # cached tekken.json locally. SherpaBackend uses the same dir-resolve idiom.
            d = snapshot_download(model_ref, local_files_only=True)
            self._proc = AutoProcessor.from_pretrained(d)
            self._model = VoxtralRealtimeForConditionalGeneration.from_pretrained(
                d, dtype=self._dtype, local_files_only=True).to(device).eval()
            self._device = device
        except Exception as e:  # missing voxtral_realtime module, no CUDA, OOM → resolver falls back
            raise BackendLoadError(str(e))

    def transcribe(self, samples, language) -> AsrResult:
        import torch
        inp = self._proc(samples, sampling_rate=TARGET_RATE, return_tensors="pt").to(self._device)
        if "input_features" in inp:  # features are float32, model is bf16
            inp["input_features"] = inp["input_features"].to(self._dtype)
        with torch.inference_mode():
            out = self._model.generate(**inp, do_sample=False)  # audio-derived auto-length
        text = self._proc.batch_decode(out, skip_special_tokens=True)[0]
        return AsrResult(text.strip(), language)

    def unload(self) -> None:
        self._model = None
        self._proc = None
        try:
            import torch
            torch.cuda.empty_cache()
        except Exception:
            pass

    def open_stream(self):
        if self._model is None:
            raise BackendLoadError("voxtral_realtime not loaded")
        from .voxtral_stream import VoxtralRealtimeStream
        return VoxtralRealtimeStream(self._model, self._proc, self._device, self._dtype)

    @property
    def is_loaded(self) -> bool:
        return self._model is not None
