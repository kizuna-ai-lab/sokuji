"""Declarative model catalog: per model, which backends/hardware tiers run it
and what artifact each needs. Pure data — adding a model is adding a row.

ASR (2026-07-04 decision): EVERY ASR card runs on transcribe.cpp (ggml family,
official handy-computer GGUFs). One GGUF serves the gpu-vulkan / gpu-metal /
cpu tiers — Vulkan covers NVIDIA/AMD/Intel from the stock wheel, Metal covers
Apple Silicon (no CUDA runtime shipped; Vulkan measured 100x realtime on a
4070). Quants follow the author's WER-validated cards: Q4_K_M for the big
speech-LLMs, Q8_0 for whisper/SenseVoice, Q6_K for Fun-ASR-MLT (its card shows
q6_k beating bf16). Note: transcribe.cpp SenseVoice emits raw text (no ITN /
punctuation normalization) — accepted with the all-in decision."""
import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Deployment:
    backend: str        # backend NAME: "transcribe_cpp" | "sherpa_tts" | "moss_onnx" | "supertonic" | "qwen3tts_onnx" | "llamacpp_qwen" | "llamacpp_hunyuan" | "llamacpp_gemma" | "opus_onnx_translate"
    tier: str           # "cpu" | "gpu-vulkan" | "gpu-metal" | "gpu-cuda" | "gpu-dml"
    compute_type: str   # quant/dtype label ("q4_k_m", "q8_0", "int8", ...)
    artifact: str       # backend.load() model_ref (repo id or "org/repo/file.gguf")
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


_TC_TIERS = ("gpu-vulkan", "gpu-metal", "cpu")


def _tc_quant(fname):
    return fname.rsplit("-", 1)[1].removesuffix(".gguf").lower()


def _tc_row(mid, name, langs, repo, fname, order, size, recommended=False,
            backend="transcribe_cpp", alt_fname=None, alt_size=None):
    """One transcribe.cpp ASR card. The same GGUF file serves every tier; the
    quant label is derived from the filename suffix (…-Q4_K_M.gguf → q4_k_m).
    `backend` selects the streaming twin for realtime models. Cards ≥1GB carry
    an ALT quant rung (rank 1.0 behind the default's 2.0) — the resolver walks
    the ladder quality-first on GPU within the memory budget; deployments stay
    default-quant-first so downloads/size_bytes key off the default."""
    deps = []
    for f, sz, rank in ((fname, size, 2.0),) + (((alt_fname, alt_size, 1.0),) if alt_fname else ()):
        quant = _tc_quant(f)
        deps += [Deployment(backend, tier, quant, f"{repo}/{f}", rank, est_bytes=sz)
                 for tier in _TC_TIERS]
    return AsrModel(mid, name, langs, tuple(deps), recommended=recommended,
                    sort_order=order, size_bytes=size)


ASR_MODELS: list[AsrModel] = [
    _tc_row("cohere-transcribe-03-2026", "Cohere Transcribe",
            ("en", "de", "fr", "it", "es", "pt", "el",
             "nl", "pl", "ar", "vi", "zh", "ja", "ko"),
            "handy-computer/cohere-transcribe-03-2026-gguf",
            "cohere-transcribe-03-2026-Q4_K_M.gguf",
            0, 1558162944, recommended=True,
            alt_fname="cohere-transcribe-03-2026-Q8_0.gguf", alt_size=2410655232),
    _tc_row("sense-voice", "SenseVoice", ("zh", "en", "ja", "ko", "yue"),
            "handy-computer/SenseVoiceSmall-gguf", "SenseVoiceSmall-Q8_0.gguf",
            1, 252684608, recommended=True),
    _tc_row("whisper-tiny", "Whisper tiny", ("multi",),
            "handy-computer/whisper-tiny-gguf", "whisper-tiny-Q8_0.gguf",
            2, 45981088),
    _tc_row("whisper-base", "Whisper base", ("multi",),
            "handy-computer/whisper-base-gguf", "whisper-base-Q8_0.gguf",
            3, 84962880),
    _tc_row("whisper-small", "Whisper small", ("multi",),
            "handy-computer/whisper-small-gguf", "whisper-small-Q8_0.gguf",
            4, 269751136),
    _tc_row("whisper-medium", "Whisper medium", ("multi",),
            "handy-computer/whisper-medium-gguf", "whisper-medium-Q8_0.gguf",
            5, 831538144),
    _tc_row("whisper-large-v3", "Whisper large-v3", ("multi",),
            "handy-computer/whisper-large-v3-gguf", "whisper-large-v3-Q8_0.gguf",
            6, 1668741440, recommended=True,
            alt_fname="whisper-large-v3-Q4_K_M.gguf", alt_size=997303008),
    _tc_row("granite-speech-4.1-2b", "Granite Speech 4.1 (2B)",
            ("en", "fr", "de", "es", "pt", "ja"),
            "handy-computer/granite-speech-4.1-2b-gguf",
            "granite-speech-4.1-2b-Q4_K_M.gguf",
            7, 1602904800,
            alt_fname="granite-speech-4.1-2b-Q8_0.gguf", alt_size=2559878848),
    _tc_row("granite-speech-4.1-2b-plus", "Granite Speech 4.1 (2B+)",
            ("en", "fr", "de", "es", "pt"),
            "handy-computer/granite-speech-4.1-2b-plus-gguf",
            "granite-speech-4.1-2b-plus-Q4_K_M.gguf",
            8, 1489663424,
            alt_fname="granite-speech-4.1-2b-plus-Q8_0.gguf", alt_size=2345973152),
    _tc_row("qwen3-asr-1.7b", "Qwen3-ASR 1.7B",
            ("zh", "en", "ja", "ko", "yue", "ar", "de", "es",
             "fr", "it", "pt", "ru", "th", "vi", "hi", "id"),
            "handy-computer/Qwen3-ASR-1.7B-gguf", "Qwen3-ASR-1.7B-Q4_K_M.gguf",
            9, 1319830496, recommended=True,
            alt_fname="Qwen3-ASR-1.7B-Q8_0.gguf", alt_size=2185030624),
    # Streaming: the transcribe_cpp_stream twin adapts session.stream()'s
    # committed/tentative view to the engine's feed/drain/end contract.
    _tc_row("voxtral-mini-4b-realtime", "Voxtral Mini 4B Realtime",
            ("en", "fr", "es", "de", "ru", "zh", "ja", "it", "pt", "nl", "ar", "hi", "ko"),
            "handy-computer/Voxtral-Mini-4B-Realtime-2602-gguf",
            "Voxtral-Mini-4B-Realtime-2602-Q4_K_M.gguf",
            10, 2830493984, recommended=True, backend="transcribe_cpp_stream",
            alt_fname="Voxtral-Mini-4B-Realtime-2602-Q8_0.gguf", alt_size=4731791648),
    _tc_row("fun-asr-mlt-nano", "Fun-ASR MLT Nano",
            ("zh", "en", "yue", "ja", "ko", "vi", "id", "th", "ms", "fil", "ar",
             "hi", "bg", "hr", "cs", "da", "nl", "et", "fi", "el", "hu", "ga",
             "lv", "lt", "mt", "pl", "pt", "ro", "sk", "sl", "sv"),
            "handy-computer/Fun-ASR-MLT-Nano-2512-gguf",
            "Fun-ASR-MLT-Nano-2512-Q6_K.gguf",
            11, 690744384, recommended=True),
]


def asr_models() -> list[AsrModel]:
    return list(ASR_MODELS)


def asr_model(model_id: str) -> AsrModel | None:
    return next((m for m in ASR_MODELS if m.id == model_id), None)


@dataclass(frozen=True)
class TranslateModel(_ModelBase):
    pass


def split_artifact(artifact: str) -> tuple[str, str | None]:
    """'org/repo/path/to/file' -> ('org/repo', 'path/to/file'); plain repo -> (repo, None)."""
    parts = artifact.split("/")
    if len(parts) > 2:
        return "/".join(parts[:2]), "/".join(parts[2:])
    return artifact, None


# Upstream sources for the LLM translate cards' GGUF quants: (card_id, quant) ->
# (upstream repo, exact filename). Verified 2026-07-03 (Task-14 dry run + HF API
# size fetch). Upstream GGUF repos hold many quants each, so we must pin the
# exact filename per card-variant rather than snapshot-downloading the repo.
# NOTE the tencent filename case quirks are REAL upstream data (7B Q8 is
# `HY-MT2-...` while its siblings are `Hy-MT2-...`) — kept verbatim.
_GGUF_SOURCES = {
    ("qwen2.5-0.5b", "q8_0"):   ("Qwen/Qwen2.5-0.5B-Instruct-GGUF", "qwen2.5-0.5b-instruct-q8_0.gguf"),
    ("qwen2.5-0.5b", "q4_k_m"): ("Qwen/Qwen2.5-0.5B-Instruct-GGUF", "qwen2.5-0.5b-instruct-q4_k_m.gguf"),
    ("qwen3-0.6b", "q8_0"):     ("Qwen/Qwen3-0.6B-GGUF", "Qwen3-0.6B-Q8_0.gguf"),
    ("qwen3-0.6b", "q4_k_m"):   ("unsloth/Qwen3-0.6B-GGUF", "Qwen3-0.6B-Q4_K_M.gguf"),
    ("qwen3.5-0.8b", "q4_k_m"): ("unsloth/Qwen3.5-0.8B-GGUF", "Qwen3.5-0.8B-Q4_K_M.gguf"),
    ("qwen3.5-0.8b", "q8_0"):   ("unsloth/Qwen3.5-0.8B-GGUF", "Qwen3.5-0.8B-Q8_0.gguf"),
    ("qwen3.5-2b", "q4_k_m"):   ("unsloth/Qwen3.5-2B-GGUF", "Qwen3.5-2B-Q4_K_M.gguf"),
    ("qwen3.5-2b", "q8_0"):     ("unsloth/Qwen3.5-2B-GGUF", "Qwen3.5-2B-Q8_0.gguf"),
    ("translategemma-4b", "q4_k_m"): ("mradermacher/translategemma-4b-it-GGUF", "translategemma-4b-it.Q4_K_M.gguf"),
    ("translategemma-4b", "q8_0"):   ("mradermacher/translategemma-4b-it-GGUF", "translategemma-4b-it.Q8_0.gguf"),
    ("hy-mt2-1.8b", "q4_k_m"):  ("tencent/Hy-MT2-1.8B-GGUF", "Hy-MT2-1.8B-Q4_K_M.gguf"),
    ("hy-mt2-1.8b", "q8_0"):    ("tencent/Hy-MT2-1.8B-GGUF", "Hy-MT2-1.8B-Q8_0.gguf"),
    ("hy-mt2-7b", "q4_k_m"):    ("tencent/Hy-MT2-7B-GGUF", "Hy-MT2-7B-Q4_K_M.gguf"),
    ("hy-mt2-7b", "q8_0"):      ("tencent/Hy-MT2-7B-GGUF", "HY-MT2-7B-Q8_0.gguf"),
    ("hy-mt15-1.8b", "q4_k_m"): ("tencent/HY-MT1.5-1.8B-GGUF", "HY-MT1.5-1.8B-Q4_K_M.gguf"),
    ("hy-mt15-1.8b", "q8_0"):   ("tencent/HY-MT1.5-1.8B-GGUF", "HY-MT1.5-1.8B-Q8_0.gguf"),
    ("hy-mt15-7b", "q4_k_m"):   ("tencent/HY-MT1.5-7B-GGUF", "HY-MT1.5-7B-Q4_K_M.gguf"),
    ("hy-mt15-7b", "q8_0"):     ("tencent/HY-MT1.5-7B-GGUF", "HY-MT1.5-7B-Q8_0.gguf"),
}


def _gguf_artifact(mid: str, quant: str) -> str:
    repo, fname = _GGUF_SOURCES[(mid, quant)]
    return f"{repo}/{fname}"


def _opus_repo(mid: str) -> str:
    return f"Xenova/{mid}"


def _llm_translate_row(mid, name, family, sort_order, default_quant, default_bytes,
                       alt_quant, alt_bytes, recommended=False):
    """An LLM card: one llamacpp backend, two GGUF quant variants, three tiers
    each. The same GGUF serves every tier; rank 2.0 marks the default quant."""
    backend = f"llamacpp_{family}"
    deps = []
    for quant, nbytes, rank in ((default_quant, default_bytes, 2.0),
                                (alt_quant, alt_bytes, 1.0)):
        artifact = _gguf_artifact(mid, quant)
        deps += [Deployment(backend, tier, quant, artifact, rank, est_bytes=nbytes)
                 for tier in ("gpu-cuda", "gpu-metal", "cpu")]
    return TranslateModel(mid, name, ("multi",), tuple(deps),
                          recommended=recommended, sort_order=sort_order,
                          size_bytes=default_bytes)


def _opus_row(src, tgt, sort_order, size_bytes=115_000_000):
    mid = f"opus-mt-{src}-{tgt}"
    name = f"Opus-MT ({_opus_disp(src)} → {_opus_disp(tgt)})"
    return TranslateModel(mid, name, (src, tgt), (
        Deployment("opus_onnx_translate", "cpu", "int8", _opus_repo(mid), 1.0),
    ), sort_order=sort_order, size_bytes=size_bytes)


# Opus-MT display: the en→ja repo keeps Helsinki's "jap" token, but the card
# should read "ja". Only this one code is remapped for the label.
_OPUS_DISP = {"jap": "ja"}


def _opus_disp(code):
    return _OPUS_DISP.get(code, code)


# Sizes are the exact upstream GGUF file byte counts (HF API size fetch,
# 2026-07-03 — see _GGUF_SOURCES). Opus size_bytes are 6-file sums from the
# same date (see OPUS_FILES in native_models.py for the file list).
TRANSLATE_MODELS: list[TranslateModel] = [
    _llm_translate_row("qwen2.5-0.5b", "Qwen 2.5 0.5B", "qwen", 1,
                       "q8_0", 675710816, "q4_k_m", 491400032, recommended=True),
    _llm_translate_row("qwen3-0.6b", "Qwen 3 0.6B", "qwen", 2,
                       "q8_0", 639446688, "q4_k_m", 396705472, recommended=True),
    _llm_translate_row("qwen3.5-0.8b", "Qwen 3.5 0.8B", "qwen", 3,
                       "q4_k_m", 532517120, "q8_0", 811843840),
    _llm_translate_row("qwen3.5-2b", "Qwen 3.5 2B", "qwen", 4,
                       "q4_k_m", 1280835840, "q8_0", 2012012800),
    _llm_translate_row("translategemma-4b", "TranslateGemma 4B", "gemma", 5,
                       "q4_k_m", 2489909760, "q8_0", 4130417920),
    _llm_translate_row("hy-mt2-1.8b", "Hunyuan-MT2 1.8B", "hunyuan", 6,
                       "q4_k_m", 1133080448, "q8_0", 1908528192),
    _llm_translate_row("hy-mt2-7b", "Hunyuan-MT2 7B", "hunyuan", 7,
                       "q4_k_m", 4624648896, "q8_0", 7981928896),
    _llm_translate_row("hy-mt15-1.8b", "Hunyuan-MT1.5 1.8B", "hunyuan", 8,
                       "q4_k_m", 1133080512, "q8_0", 1908528288),
    _llm_translate_row("hy-mt15-7b", "Hunyuan-MT1.5 7B", "hunyuan", 9,
                       "q4_k_m", 4624649312, "q8_0", 7981929344),
    _opus_row("ru", "en", 20, 117767359), _opus_row("zh", "en", 21, 119495849),
    _opus_row("en", "zh", 22, 119495576), _opus_row("hu", "en", 23, 116699316),
    _opus_row("en", "es", 24, 119377271), _opus_row("en", "ar", 25, 117602786),
    _opus_row("en", "ru", 26, 117767359), _opus_row("es", "en", 27, 119377236),
    _opus_row("en", "vi", 28, 106645206), _opus_row("ar", "en", 29, 117621466),
    _opus_row("ja", "en", 30, 114701000), _opus_row("en", "jap", 31, 98933769),
    _opus_row("ko", "en", 32, 119601552),
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
    # NOTE: the previous id (csukuangfj/vits-icefall-zh-aishell3) 404s on HF —
    # this row was never downloadable. csukuangfj/vits-zh-aishell3 is the live
    # repo with the sherpa-ready flat layout (onnx + tokens.txt + lexicon.txt);
    # size is the kept subset (download ignores the torch ckpt/rule.far/int8).
    _sherpa_tts_row("csukuangfj/vits-zh-aishell3", "VITS (zh, aishell3)", ("zh",),
                    "csukuangfj/vits-zh-aishell3", 30, 16000, num_speakers=174,
                    size_bytes=123663994),
]


def tts_models() -> list[TtsModel]:
    return list(TTS_MODELS)


def tts_model(model_id: str) -> TtsModel | None:
    return next((m for m in TTS_MODELS if m.id == model_id), None)
