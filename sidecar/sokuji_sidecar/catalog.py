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
class _ModelBase:
    """Shared shape for AsrModel/TranslateModel/TtsModel rows. Every construction
    passes id/name/languages/deployments positionally and everything else by
    keyword, so adding fields here (size_bytes) is safe for all call sites."""
    id: str
    name: str
    languages: tuple[str, ...]   # ("multi",) means any language
    deployments: tuple[Deployment, ...]
    recommended: bool = False
    sort_order: int = 99
    size_bytes: int = 0          # total download size; 0 = unknown


@dataclass(frozen=True)
class AsrModel(_ModelBase):
    pass


ASR_MODELS: list[AsrModel] = [
    AsrModel("cohere-transcribe-03-2026", "Cohere Transcribe",
             ("en", "de", "fr", "it", "es", "pt", "el",
              "nl", "pl", "ar", "vi", "zh", "ja", "ko"),
             (Deployment("cohere_transformers", "gpu-cuda", "bfloat16",
                         "AEmotionStudio/cohere-transcribe-03-2026-models", 1.0),),
             recommended=True, sort_order=0, size_bytes=4134989472),
    AsrModel("sense-voice", "SenseVoice", ("zh", "en", "ja", "ko", "yue"),
             (Deployment("funasr_sensevoice", "gpu-cuda", "float32", SENSE_VOICE_REPO, 1.0),
              Deployment("funasr_sensevoice", "cpu", "float32", SENSE_VOICE_REPO, 1.0)),
             recommended=True, sort_order=1, size_bytes=944624033),
    AsrModel("whisper-tiny", "Whisper tiny", ("multi",),
             (Deployment("ctranslate2", "gpu-cuda", "float16", "tiny", 1.0),
              Deployment("ctranslate2", "cpu", "int8", "tiny", 1.0)), sort_order=2,
             size_bytes=78850941),
    AsrModel("whisper-base", "Whisper base", ("multi",),
             (Deployment("ctranslate2", "gpu-cuda", "float16", "base", 1.0),
              Deployment("ctranslate2", "cpu", "int8", "base", 1.0)), sort_order=3,
             size_bytes=148530263),
    AsrModel("whisper-small", "Whisper small", ("multi",),
             (Deployment("ctranslate2", "gpu-cuda", "float16", "small", 1.0),
              Deployment("ctranslate2", "cpu", "int8", "small", 1.0)), sort_order=4,
             size_bytes=486859701),
    AsrModel("whisper-medium", "Whisper medium", ("multi",),
             (Deployment("ctranslate2", "gpu-cuda", "float16", "medium", 1.0),
              Deployment("ctranslate2", "cpu", "int8", "medium", 1.0)), sort_order=5,
             size_bytes=1531219071),
    AsrModel("whisper-large-v3", "Whisper large-v3", ("multi",),
             (Deployment("ctranslate2", "gpu-cuda", "float16", "large-v3", 1.0),
              Deployment("ctranslate2", "cpu", "int8", "large-v3", 1.0)),
             recommended=True, sort_order=6, size_bytes=3091483127),
    AsrModel("granite-speech-4.1-2b", "Granite Speech 4.1 (2B)", ("en", "fr", "de", "es", "pt", "ja"),
             (Deployment("transformers", "gpu-cuda", "bfloat16", "ibm-granite/granite-speech-4.1-2b", 1.0),),
             sort_order=7, size_bytes=4871717336),
    AsrModel("granite-speech-4.1-2b-plus", "Granite Speech 4.1 (2B+)", ("en", "fr", "de", "es", "pt"),
             (Deployment("transformers", "gpu-cuda", "bfloat16", "ibm-granite/granite-speech-4.1-2b-plus", 1.0),),
             sort_order=8, size_bytes=4231794140),
    AsrModel("qwen3-asr-1.7b", "Qwen3-ASR 1.7B",
             ("zh", "en", "ja", "ko", "yue", "ar", "de", "es",
              "fr", "it", "pt", "ru", "th", "vi", "hi", "id"),
             (Deployment("qwen3asr", "gpu-cuda", "bfloat16", "bezzam/Qwen3-ASR-1.7B", 1.0),),
             recommended=True, sort_order=9, size_bytes=4088288055),
    AsrModel("voxtral-mini-4b-realtime", "Voxtral Mini 4B Realtime",
             ("en", "fr", "es", "de", "ru", "zh", "ja", "it", "pt", "nl", "ar", "hi", "ko"),
             (Deployment("voxtral_realtime", "gpu-cuda", "bfloat16",
                         "mistralai/Voxtral-Mini-4B-Realtime-2602", 1.0),),
             recommended=True, sort_order=10, size_bytes=8875021049),
    AsrModel("fun-asr-mlt-nano", "Fun-ASR MLT Nano",
             ("zh", "en", "yue", "ja", "ko", "vi", "id", "th", "ms", "fil", "ar",
              "hi", "bg", "hr", "cs", "da", "nl", "et", "fi", "el", "hu", "ga",
              "lv", "lt", "mt", "pl", "pt", "ro", "sk", "sl", "sv"),
             (Deployment("funasr_nano", "gpu-cuda", "float32", FUN_ASR_MLT_REPO, 1.0),
              Deployment("funasr_nano", "cpu", "float32", FUN_ASR_MLT_REPO, 1.0)),
             recommended=True, sort_order=11, size_bytes=1989762711),
]


def asr_models() -> list[AsrModel]:
    return list(ASR_MODELS)


def asr_model(model_id: str) -> AsrModel | None:
    return next((m for m in ASR_MODELS if m.id == model_id), None)


@dataclass(frozen=True)
class TranslateModel(_ModelBase):
    pass


def _llm_translate_row(mid, name, repo, backend, sort_order, recommended=False, size_bytes=0):
    return TranslateModel(mid, name, ("multi",), (
        Deployment(backend, "gpu-cuda", "bfloat16", repo, 1.0),
        Deployment(backend, "cpu", "float32", repo, 1.0),
    ), recommended=recommended, sort_order=sort_order, size_bytes=size_bytes)


def _with_fp8(row, fp8_repo):
    """Return a copy of a TranslateModel row with a gpu-cuda fp8 variant appended.
    Preserves `row.size_bytes` (the base download size); the FP8 variant's own
    size is reported separately by `list_variants`."""
    fp8 = Deployment(row.deployments[0].backend, "gpu-cuda", "fp8", fp8_repo, 1.0,
                     min_capability=(8, 9))
    return TranslateModel(row.id, row.name, row.languages,
                          row.deployments + (fp8,),
                          recommended=row.recommended, sort_order=row.sort_order,
                          size_bytes=row.size_bytes)


# Opus-MT display: the en→ja repo keeps Helsinki's "jap" token, but the card
# should read "ja". Only this one code is remapped for the label.
_OPUS_DISP = {"jap": "ja"}


def _opus_disp(code):
    return _OPUS_DISP.get(code, code)


def _opus_row(src, tgt, sort_order, size_bytes=0):
    mid = f"opus-mt-{src}-{tgt}"
    repo = f"Helsinki-NLP/{mid}"
    name = f"Opus-MT ({_opus_disp(src)} → {_opus_disp(tgt)})"
    return TranslateModel(mid, name, (src, tgt), (
        Deployment("opus_translate", "gpu-cuda", "bfloat16", repo, 1.0),
        Deployment("opus_translate", "cpu", "float32", repo, 1.0),
    ), sort_order=sort_order, size_bytes=size_bytes)


TRANSLATE_MODELS: list[TranslateModel] = [
    _llm_translate_row("qwen2.5-0.5b", "Qwen 2.5 0.5B",
                       QWEN25_REPO, "qwen_translate", 1, recommended=True,
                       size_bytes=999604126),
    _llm_translate_row("qwen3-0.6b", "Qwen 3 0.6B",
                       "Qwen/Qwen3-0.6B", "qwen_translate", 2, recommended=True,
                       size_bytes=1519209243),
    _llm_translate_row("qwen3.5-0.8b", "Qwen 3.5 0.8B",
                       "Qwen/Qwen3.5-0.8B", "qwen35_translate", 3,
                       size_bytes=1769980465),
    _llm_translate_row("qwen3.5-2b", "Qwen 3.5 2B",
                       "Qwen/Qwen3.5-2B", "qwen35_translate", 4,
                       size_bytes=4571274023),
    _llm_translate_row("translategemma-4b", "TranslateGemma 4B",
                       "google/translategemma-4b-it", "gemma_translate", 5,
                       size_bytes=8639637704),
    _with_fp8(_llm_translate_row("hy-mt2-1.8b", "Hunyuan-MT2 1.8B",
                                 "tencent/Hy-MT2-1.8B", "hunyuan_translate", 6,
                                 size_bytes=4086810533),
              "tencent/Hy-MT2-1.8B-FP8"),
    _with_fp8(_llm_translate_row("hy-mt2-7b", "Hunyuan-MT2 7B",
                                 "tencent/Hy-MT2-7B", "hunyuan_translate", 7,
                                 size_bytes=16075624007),
              "tencent/Hy-MT2-7B-FP8"),
    _with_fp8(_llm_translate_row("hy-mt15-1.8b", "Hunyuan-MT1.5 1.8B",
                                 "tencent/HY-MT1.5-1.8B", "hunyuan_translate", 8,
                                 size_bytes=4086795383),
              "tencent/HY-MT1.5-1.8B-FP8"),
    _with_fp8(_llm_translate_row("hy-mt15-7b", "Hunyuan-MT1.5 7B",
                                 "tencent/HY-MT1.5-7B", "hunyuan_translate", 9,
                                 size_bytes=16075608305),
              "tencent/HY-MT1.5-7B-FP8"),
    _opus_row("ru", "en", 20, size_bytes=311481821),
    _opus_row("zh", "en", 21, size_bytes=315322845),
    _opus_row("en", "zh", 22, size_bytes=315322114),
    _opus_row("hu", "en", 23, size_bytes=310210981),
    _opus_row("en", "es", 24, size_bytes=315310815),
    _opus_row("en", "ar", 25, size_bytes=311416093),
    _opus_row("en", "ru", 26, size_bytes=311479785),
    _opus_row("es", "en", 27, size_bytes=315310760),
    _opus_row("en", "vi", 28, size_bytes=291629146),
    _opus_row("ar", "en", 29, size_bytes=311494073),
    _opus_row("ja", "en", 30, size_bytes=306382145),
    _opus_row("en", "jap", 31, size_bytes=276839172),
    _opus_row("ko", "en", 32, size_bytes=315467125),
]


def translate_models() -> list[TranslateModel]:
    return list(TRANSLATE_MODELS)


def translate_model(model_id: str) -> TranslateModel | None:
    return next((m for m in TRANSLATE_MODELS if m.id == model_id), None)


@dataclass(frozen=True)
class TtsModel(_ModelBase):
    repos: tuple[str, ...] = ()      # HF repos to download
    urls: tuple[str, ...] = ()       # extra files (e.g. a vocoder .onnx)
    clones: bool = False             # zero-shot voice cloning from a reference clip
    streaming: bool = False          # intra-utterance audio-delta streaming
    sample_rate: int = 24000         # native rate (engine resamples to 24k)
    num_speakers: int = 1            # 1 = single voice; >1 = a 0..N-1 speaker range
    named_voices: bool = False       # has named preset voices (dropdown), not a bare sid range
    style_voices: bool = False       # custom voices are uploaded style-vector JSONs (Supertonic)
    transcript_required: bool = False  # ICL voice cloning needs the reference clip's transcript


def _sherpa_tts_row(mid, name, langs, repo, sort_order, sr, urls=(), recommended=False,
                     num_speakers=1, size_bytes=0):
    return TtsModel(mid, name, langs, (
        Deployment("sherpa_tts", "gpu-cuda", "fp32", repo, 1.0),
        Deployment("sherpa_tts", "cpu", "fp32", repo, 1.0),
    ), repos=(repo,), urls=tuple(urls), sample_rate=sr,
       recommended=recommended, sort_order=sort_order, num_speakers=num_speakers,
       size_bytes=size_bytes)


def voice_capability(model: "TtsModel") -> dict:
    """Two-axis native voice capability derived from static catalog facts.
    builtin: named (preset dropdown) | range (sid slider) | none (single voice).
    custom:  clip (reference audio)  | style (uploaded JSON) | none."""
    custom = "clip" if model.clones else "style" if model.style_voices else "none"
    builtin = "named" if model.named_voices else "range" if model.num_speakers > 1 else "none"
    out = {"builtin": builtin, "custom": custom}
    if custom == "clip" and getattr(model, "transcript_required", False):
        out["transcriptRequired"] = True
    return out


_MOSS_NANO_LM_REPO = os.environ.get(
    "SOKUJI_MOSS_TTS_NANO_REPO", "OpenMOSS-Team/MOSS-TTS-Nano-100M-ONNX")
_MOSS_NANO_TOK_REPO = os.environ.get(
    "SOKUJI_MOSS_TTS_NANO_TOK_REPO", "OpenMOSS-Team/MOSS-Audio-Tokenizer-Nano-ONNX")

_QWEN3_TTS_06B_REPO = os.environ.get(
    "SOKUJI_QWEN3_TTS_06B_REPO", "jiangzhuo9357/qwen3-tts-0.6b-onnx")
_QWEN3_TTS_17B_REPO = os.environ.get(
    "SOKUJI_QWEN3_TTS_17B_REPO", "jiangzhuo9357/qwen3-tts-1.7b-onnx")

SUPERTONIC_LANGS = ("en", "ko", "ja", "ar", "bg", "cs", "da", "de", "el", "es", "et",
                    "fi", "fr", "hi", "hr", "hu", "id", "it", "lt", "lv", "nl", "pl",
                    "pt", "ro", "ru", "sk", "sl", "sv", "tr", "uk", "vi")

TTS_MODELS: list[TtsModel] = [
    TtsModel("moss-tts-nano", "MOSS-TTS-Nano (100M)",
             ("zh", "en", "ja", "ko", "de", "fr", "es", "pt", "it", "ru",
              "ar", "pl", "cs", "da", "sv", "el", "tr", "hu", "fa", "nl"),
             (Deployment("moss_onnx", "gpu-cuda", "fp32", _MOSS_NANO_LM_REPO, 1.0),
              Deployment("moss_onnx", "cpu", "fp32", _MOSS_NANO_LM_REPO, 1.0)),
             repos=(_MOSS_NANO_LM_REPO, _MOSS_NANO_TOK_REPO),
             clones=True, streaming=True, named_voices=True, sample_rate=48000,
             recommended=True, sort_order=0, size_bytes=763206064),
    TtsModel("supertonic-3", "Supertonic 3", SUPERTONIC_LANGS,
             (Deployment("supertonic", "gpu-cuda", "fp32", "Supertone/supertonic-3", 1.0),
              Deployment("supertonic", "cpu", "fp32", "Supertone/supertonic-3", 1.0)),
             repos=("Supertone/supertonic-3",), clones=False, streaming=False,
             named_voices=True, style_voices=True, sample_rate=44100, num_speakers=10,
             recommended=True, sort_order=1, size_bytes=400_600_000),
    TtsModel("qwen3-tts-0.6b", "Qwen3-TTS 0.6B",
             ("zh", "en", "ja", "ko", "de", "fr", "ru", "pt", "es", "it"),
             (Deployment("qwen3tts_onnx", "gpu-cuda", "fp32", _QWEN3_TTS_06B_REPO, 1.0),
              Deployment("qwen3tts_onnx", "cpu", "fp32", _QWEN3_TTS_06B_REPO, 1.0)),
             repos=(_QWEN3_TTS_06B_REPO,), clones=True, streaming=False,
             transcript_required=True, named_voices=True, sample_rate=24000,
             recommended=True, sort_order=2, size_bytes=4315672915),
    TtsModel("qwen3-tts-1.7b", "Qwen3-TTS 1.7B",
             ("zh", "en", "ja", "ko", "de", "fr", "ru", "pt", "es", "it"),
             (Deployment("qwen3tts_onnx", "gpu-cuda", "fp32", _QWEN3_TTS_17B_REPO, 1.0),
              Deployment("qwen3tts_onnx", "cpu", "fp32", _QWEN3_TTS_17B_REPO, 1.0)),
             repos=(_QWEN3_TTS_17B_REPO,), clones=True, streaming=False,
             transcript_required=True, named_voices=True, sample_rate=24000,
             recommended=False, sort_order=3, size_bytes=8372109691),
    # piper / vits single-voice models (one repo = one model = one voice).
    _sherpa_tts_row("csukuangfj/vits-piper-en_US-amy-low", "Amy (US)", ("en",),
                    "csukuangfj/vits-piper-en_US-amy-low", 10, 16000, recommended=True,
                    size_bytes=81105784),
    _sherpa_tts_row("csukuangfj/vits-piper-en_US-libritts_r-medium", "LibriTTS (US)", ("en",),
                    "csukuangfj/vits-piper-en_US-libritts_r-medium", 11, 22050, num_speakers=904,
                    size_bytes=96598330),
    _sherpa_tts_row("csukuangfj/vits-piper-en_US-ryan-low", "Ryan (US)", ("en",),
                    "csukuangfj/vits-piper-en_US-ryan-low", 12, 16000, size_bytes=81105775),
    _sherpa_tts_row("csukuangfj/vits-piper-en_US-lessac-medium", "Lessac (US)", ("en",),
                    "csukuangfj/vits-piper-en_US-lessac-medium", 13, 22050, size_bytes=81203669),
    _sherpa_tts_row("csukuangfj/vits-piper-en_GB-alan-low", "Alan (GB)", ("en",),
                    "csukuangfj/vits-piper-en_GB-alan-low", 14, 16000, size_bytes=81105800),
    _sherpa_tts_row("csukuangfj/vits-piper-de_DE-thorsten-low", "Thorsten", ("de",),
                    "csukuangfj/vits-piper-de_DE-thorsten-low", 15, 16000, size_bytes=81105739),
    _sherpa_tts_row("csukuangfj/vits-piper-de_DE-eva_k-x_low", "Eva K", ("de",),
                    "csukuangfj/vits-piper-de_DE-eva_k-x_low", 16, 16000, size_bytes=38629997),
    _sherpa_tts_row("csukuangfj/vits-piper-de_DE-kerstin-low", "Kerstin", ("de",),
                    "csukuangfj/vits-piper-de_DE-kerstin-low", 17, 16000, size_bytes=81105736),
    _sherpa_tts_row("csukuangfj/vits-piper-es_ES-davefx-medium", "DaveFX (ES)", ("es",),
                    "csukuangfj/vits-piper-es_ES-davefx-medium", 18, 22050, size_bytes=81203135),
    _sherpa_tts_row("csukuangfj/vits-piper-es_ES-carlfm-x_low", "CarlFM (ES)", ("es",),
                    "csukuangfj/vits-piper-es_ES-carlfm-x_low", 19, 16000, size_bytes=46131805),
    _sherpa_tts_row("csukuangfj/vits-piper-es_MX-ald-medium", "Ald (MX)", ("es",),
                    "csukuangfj/vits-piper-es_MX-ald-medium", 20, 22050, size_bytes=81203240),
    _sherpa_tts_row("csukuangfj/vits-piper-fr_FR-siwis-medium", "Siwis", ("fr",),
                    "csukuangfj/vits-piper-fr_FR-siwis-medium", 21, 22050, size_bytes=81204462),
    _sherpa_tts_row("csukuangfj/vits-piper-fr_FR-gilles-low", "Gilles", ("fr",),
                    "csukuangfj/vits-piper-fr_FR-gilles-low", 22, 16000, size_bytes=81106835),
    _sherpa_tts_row("csukuangfj/vits-piper-fr_FR-tom-medium", "Tom", ("fr",),
                    "csukuangfj/vits-piper-fr_FR-tom-medium", 23, 22050, size_bytes=81514557),
    _sherpa_tts_row("csukuangfj/vits-piper-it_IT-riccardo-x_low", "Riccardo", ("it",),
                    "csukuangfj/vits-piper-it_IT-riccardo-x_low", 24, 16000, size_bytes=46133363),
    _sherpa_tts_row("csukuangfj/vits-piper-it_IT-paola-medium", "Paola", ("it",),
                    "csukuangfj/vits-piper-it_IT-paola-medium", 25, 22050, size_bytes=81516749),
    _sherpa_tts_row("csukuangfj/vits-piper-ru_RU-denis-medium", "Denis", ("ru",),
                    "csukuangfj/vits-piper-ru_RU-denis-medium", 26, 22050, size_bytes=81203281),
    _sherpa_tts_row("csukuangfj/vits-piper-ru_RU-irina-medium", "Irina", ("ru",),
                    "csukuangfj/vits-piper-ru_RU-irina-medium", 27, 22050, size_bytes=81203392),
    _sherpa_tts_row("csukuangfj/vits-piper-ru_RU-dmitri-medium", "Dmitri", ("ru",),
                    "csukuangfj/vits-piper-ru_RU-dmitri-medium", 28, 22050, size_bytes=81203283),
    _sherpa_tts_row("csukuangfj/vits-piper-zh_CN-huayan-medium", "Huayan", ("zh",),
                    "csukuangfj/vits-piper-zh_CN-huayan-medium", 29, 22050, size_bytes=81204688),
    _sherpa_tts_row("csukuangfj/vits-icefall-zh-aishell3", "VITS (zh, aishell3)", ("zh",),
                    "csukuangfj/vits-icefall-zh-aishell3", 30, 16000, num_speakers=174),
]


def tts_models() -> list[TtsModel]:
    return list(TTS_MODELS)


def tts_model(model_id: str) -> TtsModel | None:
    return next((m for m in TTS_MODELS if m.id == model_id), None)
