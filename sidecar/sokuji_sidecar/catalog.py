"""Declarative ASR model catalog: per model, which backends/hardware tiers run
it and what artifact each needs. Pure data — adding a model is adding a row.
Whisper rows carry a gpu-cuda (float16) deployment + a cpu (int8) floor; SenseVoice
and Fun-ASR-MLT-Nano run on FunASR with gpu-cuda + cpu tiers (both float32)."""
import os
from dataclasses import dataclass

SENSE_VOICE_REPO = os.environ.get("SOKUJI_ASR_REPO", "FunAudioLLM/SenseVoiceSmall")
FUN_ASR_MLT_REPO = os.environ.get("SOKUJI_FUNASR_NANO_REPO", "FunAudioLLM/Fun-ASR-MLT-Nano-2512")
# The default Qwen 2.5 translation repo honours SOKUJI_TRANSLATE_MODEL so the runtime
# loads the same repo the download/prefetch path fetched (keep these two in sync).
QWEN25_REPO = os.environ.get("SOKUJI_TRANSLATE_MODEL", "Qwen/Qwen2.5-0.5B-Instruct")


@dataclass(frozen=True)
class Deployment:
    backend: str        # backend NAME: "ctranslate2" | "sherpa" | "transformers" | "qwen3asr" | "cohere_transformers" | "voxtral_realtime" | "funasr_sensevoice" | "qwen_translate" | "qwen35_translate"
    tier: str           # "cpu" (Phase 0); "gpu-cuda"/... later
    compute_type: str   # "int8" | ...
    artifact: str       # backend.load() model_ref: whisper size, or sherpa repo id
    rank: float         # tie-breaker within a tier (higher = preferred)
    min_capability: tuple[int, int] | None = None   # min CUDA compute cap for a GPU variant
    est_bytes: int | None = None                     # footprint estimate; None → model_size(artifact)


@dataclass(frozen=True)
class AsrModel:
    id: str
    name: str
    languages: tuple[str, ...]   # ("multi",) means any language
    deployments: tuple[Deployment, ...]
    recommended: bool = False
    sort_order: int = 99


# NOTE: `sort_order` is advisory and NOT sent over the models_catalog wire
# (NativeModelInfo omits it); the renderer owns card ordering via nativeCatalog.ts.
# So renderer and sidecar sort_order values may differ harmlessly.
ASR_MODELS: list[AsrModel] = [
    AsrModel("cohere-transcribe-03-2026", "Cohere Transcribe",
             ("en", "de", "fr", "it", "es", "pt", "el",
              "nl", "pl", "ar", "vi", "zh", "ja", "ko"),
             (Deployment("cohere_transformers", "gpu-cuda", "bfloat16",
                         "AEmotionStudio/cohere-transcribe-03-2026-models", 1.0),),
             recommended=True, sort_order=0),
    AsrModel("sense-voice", "SenseVoice", ("zh", "en", "ja", "ko", "yue"),
             (Deployment("funasr_sensevoice", "gpu-cuda", "float32", SENSE_VOICE_REPO, 1.0),
              Deployment("funasr_sensevoice", "cpu", "float32", SENSE_VOICE_REPO, 1.0)),
             recommended=True, sort_order=1),
    AsrModel("whisper-tiny", "Whisper tiny", ("multi",),
             (Deployment("ctranslate2", "gpu-cuda", "float16", "tiny", 1.0),
              Deployment("ctranslate2", "cpu", "int8", "tiny", 1.0)), sort_order=2),
    AsrModel("whisper-base", "Whisper base", ("multi",),
             (Deployment("ctranslate2", "gpu-cuda", "float16", "base", 1.0),
              Deployment("ctranslate2", "cpu", "int8", "base", 1.0)), sort_order=3),
    AsrModel("whisper-small", "Whisper small", ("multi",),
             (Deployment("ctranslate2", "gpu-cuda", "float16", "small", 1.0),
              Deployment("ctranslate2", "cpu", "int8", "small", 1.0)), sort_order=4),
    AsrModel("whisper-medium", "Whisper medium", ("multi",),
             (Deployment("ctranslate2", "gpu-cuda", "float16", "medium", 1.0),
              Deployment("ctranslate2", "cpu", "int8", "medium", 1.0)), sort_order=5),
    AsrModel("whisper-large-v3", "Whisper large-v3", ("multi",),
             (Deployment("ctranslate2", "gpu-cuda", "float16", "large-v3", 1.0),
              Deployment("ctranslate2", "cpu", "int8", "large-v3", 1.0)),
             recommended=True, sort_order=6),
    AsrModel("granite-speech-4.1-2b", "Granite Speech 4.1 (2B)", ("en", "fr", "de", "es", "pt", "ja"),
             (Deployment("transformers", "gpu-cuda", "bfloat16", "ibm-granite/granite-speech-4.1-2b", 1.0),),
             sort_order=7),
    AsrModel("granite-speech-4.1-2b-plus", "Granite Speech 4.1 (2B+)", ("en", "fr", "de", "es", "pt"),
             (Deployment("transformers", "gpu-cuda", "bfloat16", "ibm-granite/granite-speech-4.1-2b-plus", 1.0),),
             sort_order=8),
    AsrModel("qwen3-asr-1.7b", "Qwen3-ASR 1.7B",
             ("zh", "en", "ja", "ko", "yue", "ar", "de", "es",
              "fr", "it", "pt", "ru", "th", "vi", "hi", "id"),
             (Deployment("qwen3asr", "gpu-cuda", "bfloat16", "bezzam/Qwen3-ASR-1.7B", 1.0),),
             recommended=True, sort_order=9),
    AsrModel("voxtral-mini-4b-realtime", "Voxtral Mini 4B Realtime",
             ("en", "fr", "es", "de", "ru", "zh", "ja", "it", "pt", "nl", "ar", "hi", "ko"),
             (Deployment("voxtral_realtime", "gpu-cuda", "bfloat16",
                         "mistralai/Voxtral-Mini-4B-Realtime-2602", 1.0),),
             recommended=True, sort_order=10),
    AsrModel("fun-asr-mlt-nano", "Fun-ASR MLT Nano",
             ("zh", "en", "yue", "ja", "ko", "vi", "id", "th", "ms", "fil", "ar",
              "hi", "bg", "hr", "cs", "da", "nl", "et", "fi", "el", "hu", "ga",
              "lv", "lt", "mt", "pl", "pt", "ro", "sk", "sl", "sv"),
             (Deployment("funasr_nano", "gpu-cuda", "float32", FUN_ASR_MLT_REPO, 1.0),
              Deployment("funasr_nano", "cpu", "float32", FUN_ASR_MLT_REPO, 1.0)),
             recommended=True, sort_order=11),
]


def asr_models() -> list[AsrModel]:
    return list(ASR_MODELS)


def asr_model(model_id: str) -> AsrModel | None:
    return next((m for m in ASR_MODELS if m.id == model_id), None)


@dataclass(frozen=True)
class TranslateModel:
    id: str
    name: str
    languages: tuple[str, ...]   # ("multi",) means any language
    deployments: tuple[Deployment, ...]
    recommended: bool = False
    sort_order: int = 99


def _llm_translate_row(mid, name, repo, backend, sort_order, recommended=False):
    return TranslateModel(mid, name, ("multi",), (
        Deployment(backend, "gpu-cuda", "bfloat16", repo, 1.0),
        Deployment(backend, "cpu", "float32", repo, 1.0),
    ), recommended=recommended, sort_order=sort_order)


def _with_fp8(row, fp8_repo):
    """Return a copy of a TranslateModel row with a gpu-cuda fp8 variant appended."""
    fp8 = Deployment(row.deployments[0].backend, "gpu-cuda", "fp8", fp8_repo, 1.0,
                     min_capability=(8, 9))
    return TranslateModel(row.id, row.name, row.languages,
                          row.deployments + (fp8,),
                          recommended=row.recommended, sort_order=row.sort_order)


# Opus-MT display: the en→ja repo keeps Helsinki's "jap" token, but the card
# should read "ja". Only this one code is remapped for the label.
_OPUS_DISP = {"jap": "ja"}


def _opus_disp(code):
    return _OPUS_DISP.get(code, code)


def _opus_row(src, tgt, sort_order):
    mid = f"opus-mt-{src}-{tgt}"
    repo = f"Helsinki-NLP/{mid}"
    name = f"Opus-MT ({_opus_disp(src)} → {_opus_disp(tgt)})"
    return TranslateModel(mid, name, (src, tgt), (
        Deployment("opus_translate", "gpu-cuda", "bfloat16", repo, 1.0),
        Deployment("opus_translate", "cpu", "float32", repo, 1.0),
    ), sort_order=sort_order)


TRANSLATE_MODELS: list[TranslateModel] = [
    _llm_translate_row("qwen2.5-0.5b", "Qwen 2.5 0.5B",
                       QWEN25_REPO, "qwen_translate", 1, recommended=True),
    _llm_translate_row("qwen3-0.6b", "Qwen 3 0.6B",
                       "Qwen/Qwen3-0.6B", "qwen_translate", 2, recommended=True),
    _llm_translate_row("qwen3.5-0.8b", "Qwen 3.5 0.8B",
                       "Qwen/Qwen3.5-0.8B", "qwen35_translate", 3),
    _llm_translate_row("qwen3.5-2b", "Qwen 3.5 2B",
                       "Qwen/Qwen3.5-2B", "qwen35_translate", 4),
    _llm_translate_row("translategemma-4b", "TranslateGemma 4B",
                       "google/translategemma-4b-it", "gemma_translate", 5),
    _with_fp8(_llm_translate_row("hy-mt2-1.8b", "Hunyuan-MT2 1.8B",
                                 "tencent/Hy-MT2-1.8B", "hunyuan_translate", 6),
              "tencent/Hy-MT2-1.8B-FP8"),
    _with_fp8(_llm_translate_row("hy-mt2-7b", "Hunyuan-MT2 7B",
                                 "tencent/Hy-MT2-7B", "hunyuan_translate", 7),
              "tencent/Hy-MT2-7B-FP8"),
    _opus_row("ru", "en", 20),
    _opus_row("zh", "en", 21),
    _opus_row("en", "zh", 22),
    _opus_row("hu", "en", 23),
    _opus_row("en", "es", 24),
    _opus_row("en", "ar", 25),
    _opus_row("en", "ru", 26),
    _opus_row("es", "en", 27),
    _opus_row("en", "vi", 28),
    _opus_row("ar", "en", 29),
    _opus_row("ja", "en", 30),
    _opus_row("en", "jap", 31),
    _opus_row("ko", "en", 32),
]


def translate_models() -> list[TranslateModel]:
    return list(TRANSLATE_MODELS)


def translate_model(model_id: str) -> TranslateModel | None:
    return next((m for m in TRANSLATE_MODELS if m.id == model_id), None)
