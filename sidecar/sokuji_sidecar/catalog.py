"""Declarative ASR model catalog: per model, which backends/hardware tiers run
it and what artifact each needs. Pure data — adding a model is adding a row.
Whisper rows carry a gpu-cuda (float16) deployment + a cpu (int8) floor; SenseVoice runs on FunASR with gpu-cuda (float16) + cpu (float32) tiers."""
import os
from dataclasses import dataclass

SENSE_VOICE_REPO = os.environ.get("SOKUJI_ASR_REPO", "FunAudioLLM/SenseVoiceSmall")
FUN_ASR_MLT_REPO = os.environ.get("SOKUJI_FUNASR_NANO_REPO", "FunAudioLLM/Fun-ASR-MLT-Nano-2512")


@dataclass(frozen=True)
class Deployment:
    backend: str        # backend NAME: "ctranslate2" | "sherpa" | "transformers" | "qwen3asr" | "cohere_transformers" | "voxtral_realtime" | "funasr_sensevoice"
    tier: str           # "cpu" (Phase 0); "gpu-cuda"/... later
    compute_type: str   # "int8" | ...
    artifact: str       # backend.load() model_ref: whisper size, or sherpa repo id
    rank: float         # tie-breaker within a tier (higher = preferred)


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
