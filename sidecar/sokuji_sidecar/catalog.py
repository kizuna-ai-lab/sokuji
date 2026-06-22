"""Declarative ASR model catalog: per model, which backends/hardware tiers run
it and what artifact each needs. Pure data — adding a model is adding a row.
Phase 0 ships CPU deployments only; GPU tiers are added in Phase 1."""
import os
from dataclasses import dataclass

SENSE_VOICE_REPO = os.environ.get(
    "SOKUJI_ASR_REPO",
    "csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17")


@dataclass(frozen=True)
class Deployment:
    backend: str        # "ctranslate2" | "sherpa"
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


ASR_MODELS: list[AsrModel] = [
    AsrModel("sense-voice", "SenseVoice", ("zh", "en", "ja", "ko", "yue"),
             (Deployment("sherpa", "cpu", "int8", SENSE_VOICE_REPO, 1.0),),
             recommended=True, sort_order=0),
    AsrModel("whisper-large-v3", "Whisper large-v3", ("multi",),
             (Deployment("ctranslate2", "cpu", "int8", "large-v3", 1.0),),
             recommended=True, sort_order=1),
    AsrModel("whisper-base", "Whisper base", ("multi",),
             (Deployment("ctranslate2", "cpu", "int8", "base", 1.0),), sort_order=2),
    AsrModel("whisper-small", "Whisper small", ("multi",),
             (Deployment("ctranslate2", "cpu", "int8", "small", 1.0),), sort_order=3),
    AsrModel("whisper-tiny", "Whisper tiny", ("multi",),
             (Deployment("ctranslate2", "cpu", "int8", "tiny", 1.0),), sort_order=4),
]


def asr_models() -> list[AsrModel]:
    return list(ASR_MODELS)


def asr_model(model_id: str) -> AsrModel | None:
    return next((m for m in ASR_MODELS if m.id == model_id), None)
