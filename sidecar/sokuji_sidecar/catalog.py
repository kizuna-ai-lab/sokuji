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
from dataclasses import dataclass

from .gguf_header import GGML_TYPE_NAMES as _GGML_TYPE_NAMES


@dataclass(frozen=True)
class Deployment:
    backend: str        # backend NAME: "native_asr" | "native_asr_stream" | "native_translate" | "native_tts"
    tier: str           # "cpu" | "gpu-vulkan" | "gpu-metal" (gpu-cuda/gpu-dml died with the ONNX TTS backends — slice 4)
    compute_type: str   # quant/dtype label ("q4_k_m", "q8_0", "bf16", ...)
    artifact: str       # backend.load() model_ref (repo id or "org/repo/file.gguf")
    rank: float         # tie-breaker within a tier (higher = preferred)
    est_bytes: int | None = None                     # footprint estimate; None → model_size(artifact)
    platforms: tuple[str, ...] = ("linux", "windows", "macos")  # OSes this deployment runs on (D9)
    # Repo-relative (path, bytes) of the files this rung needs beside its main file (spec stage
    # 2.2): LFM2.5-Audio's mmproj/vocoder/tokenizer per quant, MioTTS's codec in another folder
    # of the same repo. Downloaded with the rung, counted in est_bytes, staged beside the main
    # file at their repo-relative paths.
    companions: tuple[tuple[str, int], ...] = ()


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
    download_ignore: tuple[str, ...] = ()  # fnmatch patterns skipped by the downloader
                                            # (mirrors native_models._base_specs' spec["ignore"])
    # The GRAPH this card runs — the key of its op recording (spec A §3.2): transcribe.cpp's
    # architecture for ASR (what sk_asr_caps.arch reports), llama.cpp's general.architecture
    # for translate, audio.cpp's family for TTS. Not a prompt strategy (that is
    # TranslateModel.prompt_family).
    graph_family: str = ""
    # How much system RAM a CPU load needs per byte of the rung's est_bytes: 1.0 unless a
    # measured CPU peak was above 1.2x or at most 0.9x its rung (_TTS_RAM_FACTORS, below).
    # accel.load_with_fallback refuses a cpu load whose rung x factor plus headroom exceeds free
    # memory, and a Metal load whose rung (factor 1.0) plus headroom does.
    ram_factor: float = 1.0


@dataclass(frozen=True)
class AsrModel(_ModelBase):
    pass


_TC_TIERS = ("gpu-vulkan", "gpu-metal", "cpu")
# GPU-only tier set for cards too large to run on CPU in practice (the 24B
# Voxtral). Dropping "cpu" makes the renderer hardware-gate the card off
# CPU-only machines (hardwareGated = no available non-cpu tier) instead of
# advertising an unusable multi-GB CPU download.
_TC_GPU_TIERS = ("gpu-vulkan", "gpu-metal")


def _tc_quant(fname):
    return fname.rsplit("-", 1)[1].removesuffix(".gguf").lower()


# Rank encodes the quant's ROLE, not just a tie-break:
#   2.0 = the curated default; 1.0 = curated alternative (recommendation
#   candidate); 0.5 = listed-only — shown in the variant list with a
#   supported flag, but never auto-recommended (e.g. f16: the author's WER
#   tables show no gain over q8_0, so recommending its 2x download would be
#   waste — power users can still pick it).
_TC_CURATED_MIN_RANK = 1.0


# Premise 7 (spec A): a rung is not one dtype. The dtype set a pre-download query expands
# WEIGHT over, when the file is not on disk yet; deliberately wide (a *_M file mixes K-quants,
# the q8_0 TTS files carry BF16 weights, everything carries F32). Once the file exists its
# header's real set — intersected with WEIGHT_CAPABLE_DTYPES — replaces this
# (accel.weight_dtypes). Spellings are ggml_type_name()'s.
# A GGUF also carries INTEGER tensors (i32/i64: omnivoice, index-tts2, voxcpm2, supertonic-3),
# but those are index/position tables — never the src0 of a MUL_MAT/MUL_MAT_ID/GET_ROWS, i.e.
# never a rung weight — and asking a backend to MUL_MAT an i64 is a question no real graph
# poses. Vulkan answers `false` to it (ggml-vulkan's supports_op has no integer MUL_MAT case),
# which would refuse every TTS family on every Vulkan device. Integer types are therefore
# filtered out before expansion, on both layers (accel.weight_dtypes and sk_ops.cpp), and
# these sets carry only weight-capable types.
# gen_ops_data.py's WIDEST_FALLBACK is len() of the q4_k_m set — keep them in step.
RUNG_FALLBACK_DTYPES: dict[str, frozenset[str]] = {
    "q4_k_m": frozenset({"q4_K", "q5_K", "q6_K", "q8_0", "bf16", "f16", "f32"}),
    "q5_k_m": frozenset({"q5_K", "q6_K", "q8_0", "bf16", "f16", "f32"}),
    "q6_k":   frozenset({"q6_K", "q8_0", "bf16", "f16", "f32"}),
    "q8_0":   frozenset({"q8_0", "bf16", "f16", "f32"}),
    "f16":    frozenset({"f16", "f32"}),
    "bf16":   frozenset({"bf16", "f16", "f32"}),
    # Rung labels audio.cpp's own conversions use (the cards added 2026-10-06). Each set covers
    # what the published files' headers held on 2026-10-06, widened to every float type a rung
    # of that label may carry: an `orig` file keeps the checkpoint's own float types (f32, or
    # f32+bf16 for NeuTTS-2E); `f32` is all f32 (CosyVoice3); KugelAudio's `q4_k` holds
    # q4_K+bf16+f16; Breeze-TTS-2's `q4_0` holds q4_0+bf16+f16+f32, and LFM2.5-Audio's Q4_0
    # keeps its token embedding at q6_K (its own documentation).
    "orig":   frozenset({"bf16", "f16", "f32"}),
    "f32":    frozenset({"f32"}),
    "q4_k":   frozenset({"q4_K", "bf16", "f16", "f32"}),
    "q4_0":   frozenset({"q4_0", "q6_K", "bf16", "f16", "f32"}),
}

# The ggml types a rung-bearing WEIGHT tensor can actually hold: the float types a graph
# computes in, plus every quantized type. Everything else in GGML_TYPE_NAMES (f64 and the
# i8/i16/i32/i64 index tables) is filtered out of a header set before it becomes an expansion
# set. Derived from gguf_header.GGML_TYPE_NAMES so a new quant spelling needs one edit there.
_NON_WEIGHT_DTYPES = frozenset({"f64", "i8", "i16", "i32", "i64"})
WEIGHT_CAPABLE_DTYPES: frozenset[str] = frozenset({"f32", "f16", "bf16"}) | frozenset(
    n for n in _GGML_TYPE_NAMES.values()
    if n not in _NON_WEIGHT_DTYPES and n not in {"f32", "f16", "bf16"}
)


def _tc_row(mid, name, langs, repo, base, order, quants, default,
            recommended=False, backend="native_asr", tiers=_TC_TIERS, arch=""):
    """One transcribe.cpp ASR card with its FULL quant ladder. `quants` maps
    QUANT (filename token, e.g. "Q8_0") -> size_bytes; `default` names the
    curated default. The same GGUF serves every tier. Deployments are ordered
    default-first so downloads/size_bytes key off the default; q6_k/q4_k_m/q8_0
    are curated recommendation candidates, f16/q5_k_m are listed-only.
    `arch` is the GGUF's `general.architecture` — transcribe.cpp's `Arch::name`, the
    string sk_asr_caps.arch reports at runtime and the op-recording key (graph_family).
    Read it with `gguf_header.read_header(path).architecture`; it is NOT always the
    `src/arch/<dir>` directory name (cohere -> "cohere_asr", granite -> "granite_speech",
    granite_nar -> "granite_speech_nar"). `quants` keys must be ladder tokens: anything
    else used to be dropped silently, which hid a mistyped rung until download time."""
    curated = {"q8_0", "q6_k", "q4_k_m"}
    ladder = ("F16", "Q8_0", "Q6_K", "Q5_K_M", "Q4_K_M")
    unknown = sorted(set(quants) - set(ladder))
    if unknown or default not in quants:
        raise ValueError(f"{mid}: quants keys must be in {ladder} and include default "
                         f"{default!r}; unknown={unknown}, keys={sorted(quants)}")
    deps = []
    order_keys = [default] + [q for q in ladder if q in quants and q != default]
    for q in order_keys:
        quant = q.lower()
        rank = 2.0 if q == default else (1.0 if quant in curated else 0.5)
        deps += [Deployment(backend, tier, quant, f"{repo}/{base}-{q}.gguf", rank,
                            est_bytes=quants[q]) for tier in tiers]
    return AsrModel(mid, name, langs, tuple(deps), recommended=recommended,
                    sort_order=order, size_bytes=quants[default], graph_family=arch)


# Curated ASR roster (2026-07-05 re-pick from the full transcribe.cpp family).
# sort_order = quality ranking, seeded from the author's UNIFORM benchmark
# (transcribe.cpp-measured librispeech test-clean WER, best rung per model;
# noted per row) — gaps of 10 leave room for hand-tuning; language-specialized
# cards (gigaam: ru) are slotted by their standing WITHIN their language, since
# the renderer's source-language filter means only those users see them.
ASR_MODELS: list[AsrModel] = [
    # WER 1.25 — best-in-benchmark all-rounder; historical usage #1.
    _tc_row("cohere-transcribe-03-2026", "Cohere Transcribe",
            ("en", "de", "fr", "it", "es", "pt", "el",
             "nl", "pl", "ar", "vi", "zh", "ja", "ko"),
            "handy-computer/cohere-transcribe-03-2026-gguf", "cohere-transcribe-03-2026",
            10, {"F16": 4106644992, "Q8_0": 2410655232, "Q6_K": 1972524544,
                 "Q5_K_M": 1770270208, "Q4_K_M": 1558162944},
            default="Q4_K_M", recommended=True, arch="cohere_asr"),
    # Russian specialist (GigaAM v3, end-to-end w/ punctuation) — no librispeech
    # figure (ru model); slotted top of its language view.
    _tc_row("gigaam-v3-e2e-rnnt", "GigaAM v3 (Russian)", ("ru",),
            "handy-computer/gigaam-v3-e2e-rnnt-gguf", "gigaam-v3-e2e-rnnt",
            15, {"F16": 452381408, "Q8_0": 273724832, "Q6_K": 227953952,
                 "Q5_K_M": 206392736, "Q4_K_M": 183948704}, default="Q8_0", arch="gigaam"),
    # Russian second rung — plain RNNT variant (no e2e punctuation head).
    _tc_row("gigaam-v3-rnnt", "GigaAM v3 RNNT (Russian)", ("ru",),
            "handy-computer/gigaam-v3-rnnt-gguf", "gigaam-v3-rnnt",
            16, {"F16": 451084832, "Q8_0": 273022880, "Q6_K": 227252000,
                 "Q5_K_M": 205690784, "Q4_K_M": 183246752}, default="Q8_0", arch="gigaam"),
    # WER 1.29 / 1.46 — English/European quality alternates.
    _tc_row("granite-speech-4.1-2b", "Granite Speech 4.1 (2B)",
            ("en", "fr", "de", "es", "pt", "ja"),
            "handy-computer/granite-speech-4.1-2b-gguf", "granite-speech-4.1-2b",
            20, {"F16": 4632623200, "Q8_0": 2559878944, "Q6_K": 2024968032,
                 "Q5_K_M": 1829704640, "Q4_K_M": 1602904896}, default="Q4_K_M", arch="granite_speech"),
    # WER 1.33 — Granite Speech 5.0 TurboCTC (transcribe.cpp 0.2.4, #159): English-only
    # CTC, sub-GB and CPU-fast (RTF 17 on a Ryzen 4750U). Arch::name granite_speech5_ctc
    # (directory granite5_ctc). The -nc sibling is CC-BY-NC-SA and not listed.
    _tc_row("granite-speech-5.0-470m-turboctc", "Granite Speech 5.0 TurboCTC (470M)", ("en",),
            "handy-computer/granite-speech-5.0-470m-turboctc-gguf", "granite-speech-5.0-470m-turboctc",
            22, {"F16": 947824480, "Q8_0": 505606496, "Q6_K": 391836000,
                 "Q5_K_M": 335737184, "Q4_K_M": 279114080}, default="Q8_0", arch="granite_speech5_ctc"),
    # WER 1.38 — the big English parakeet; second-best English figure in the roster.
    _tc_row("parakeet-tdt-1.1b", "Parakeet TDT 1.1B", ("en",),
            "handy-computer/parakeet-tdt-1.1b-gguf", "parakeet-tdt-1.1b",
            25, {"F16": 2145162976, "Q8_0": 1267288736, "Q6_K": 1042509472,
                 "Q5_K_M": 935758496, "Q4_K_M": 825248416}, default="Q8_0", arch="parakeet"),
    _tc_row("granite-speech-4.1-2b-plus", "Granite Speech 4.1 (2B+)",
            ("en", "fr", "de", "es", "pt"),
            "handy-computer/granite-speech-4.1-2b-plus-gguf", "granite-speech-4.1-2b-plus",
            30, {"F16": 4229971936, "Q8_0": 2345973280, "Q6_K": 1859821632,
                 "Q5_K_M": 1691297216, "Q4_K_M": 1489663552}, default="Q4_K_M", arch="granite_speech"),
    # WER 1.59 (q4_k_m beats q8_0's 1.62 per the author's table) — en/de/es/fr.
    _tc_row("canary-1b-flash", "Canary 1B Flash", ("en", "de", "es", "fr"),
            "handy-computer/canary-1b-flash-gguf", "canary-1b-flash",
            35, {"F16": 1785657184, "Q8_0": 1048131424, "Q6_K": 857603936,
                 "Q5_K_M": 769563488, "Q4_K_M": 677141344}, default="Q4_K_M", arch="canary"),
    # WER 1.61 — CJK quality mainstay (verified all-5-langs correct on real clips).
    _tc_row("qwen3-asr-1.7b", "Qwen3-ASR 1.7B",
            ("zh", "en", "ja", "ko", "yue", "ar", "de", "es",
             "fr", "it", "pt", "ru", "th", "vi", "hi", "id"),
            "handy-computer/Qwen3-ASR-1.7B-gguf", "Qwen3-ASR-1.7B",
            40, {"F16": 4091390944, "Q8_0": 2185030624, "Q6_K": 1692554208,
                 "Q5_K_M": 1517290464, "Q4_K_M": 1319830496},
            default="Q4_K_M", recommended=True, arch="qwen3_asr"),
    # WER 1.69 (q6_k beats bf16 per the author's table) — 31-language coverage king.
    _tc_row("fun-asr-mlt-nano", "Fun-ASR MLT Nano",
            ("zh", "en", "yue", "ja", "ko", "vi", "id", "th", "ms", "fil", "ar",
             "hi", "bg", "hr", "cs", "da", "nl", "et", "fi", "el", "hu", "ga",
             "lv", "lt", "mt", "pl", "pt", "ro", "sk", "sl", "sv"),
            "handy-computer/Fun-ASR-MLT-Nano-2512-gguf", "Fun-ASR-MLT-Nano-2512",
            50, {"F16": 1667504192, "Q8_0": 891271232, "Q6_K": 690744384,
                 "Q5_K_M": 631129152, "Q4_K_M": 556975168},
            default="Q6_K", recommended=True, arch="funasr_nano"),
    # WER 1.78 (q6_k ties bf16 — same quirk as the MLT sibling) — light zh/en/ja.
    _tc_row("fun-asr-nano", "Fun-ASR Nano", ("zh", "en", "ja"),
            "handy-computer/Fun-ASR-Nano-2512-gguf", "Fun-ASR-Nano-2512",
            55, {"F16": 1667503872, "Q8_0": 891270912, "Q6_K": 690744064,
                 "Q5_K_M": 631128832, "Q4_K_M": 556974848}, default="Q6_K", arch="funasr_nano"),
    # WER 1.81 — 99-language quality reference.
    _tc_row("whisper-large-v3", "Whisper large-v3", ("multi",),
            "handy-computer/whisper-large-v3-gguf", "whisper-large-v3",
            60, {"F16": 3107236640, "Q8_0": 1668741440, "Q6_K": 1297130208,
                 "Q5_K_M": 1161143008, "Q4_K_M": 997303008}, default="Q8_0", arch="whisper"),
    # WER 1.90 (q5_k_m best rung; default q8_0 lands 1.93) — the tiny/fastest
    # canary rung (en/de/es/fr).
    _tc_row("canary-180m-flash", "Canary 180M Flash", ("en", "de", "es", "fr"),
            "handy-computer/canary-180m-flash-gguf", "canary-180m-flash",
            65, {"F16": 381632288, "Q8_0": 218447648, "Q6_K": 176291616,
                 "Q5_K_M": 158704416, "Q4_K_M": 139223840}, default="Q8_0", arch="canary"),
    # WER 1.91 — European quality tier (NVIDIA Canary, 25 langs).
    _tc_row("canary-1b-v2", "Canary 1B v2",
            ("bg", "hr", "cs", "da", "nl", "en", "et", "fi", "fr", "de", "el",
             "hu", "it", "lv", "lt", "mt", "pl", "pt", "ro", "sk", "sl", "es",
             "sv", "ru", "uk"),
            "handy-computer/canary-1b-v2-gguf", "canary-1b-v2",
            70, {"F16": 1966111456, "Q8_0": 1144290016, "Q6_K": 931986144,
                 "Q5_K_M": 836664032, "Q4_K_M": 735476448}, default="Q8_0", arch="canary"),
    # WER 1.92 at RTF 151 (metal) — the European SPEED tier (NVIDIA TDT).
    _tc_row("parakeet-tdt-0.6b-v3", "Parakeet TDT 0.6B v3",
            ("bg", "hr", "cs", "da", "nl", "en", "et", "fi", "fr", "de", "el",
             "hu", "it", "lv", "lt", "mt", "pl", "pt", "ro", "ru", "sk", "sl",
             "es", "sv", "uk"),
            "handy-computer/parakeet-tdt-0.6b-v3-gguf", "parakeet-tdt-0.6b-v3",
            80, {"F16": 1255869856, "Q8_0": 739508576, "Q6_K": 610342240,
                 "Q5_K_M": 548946272, "Q4_K_M": 485425504},
            default="Q8_0", recommended=True, arch="parakeet"),
    # German fine-tune of v3 (primeline, CC-BY-4.0; transcribe.cpp >= 0.2.0):
    # FLEURS-de WER 6.00 vs NeMo's 5.98 — not a librispeech figure, so it sits
    # right behind its base rather than in the WER order. Keeps the other 24
    # v3 languages usable. Inherits v3's `ss`-for-`ß` orthography quirk.
    _tc_row("parakeet-primeline", "Parakeet Primeline (de)",
            ("bg", "hr", "cs", "da", "nl", "en", "et", "fi", "fr", "de", "el",
             "hu", "it", "lv", "lt", "mt", "pl", "pt", "ro", "ru", "sk", "sl",
             "es", "sv", "uk"),
            "handy-computer/parakeet-primeline-gguf", "parakeet-primeline",
            81, {"F16": 1255869920, "Q8_0": 739508640, "Q6_K": 610342304,
                 "Q5_K_M": 548946336, "Q4_K_M": 485425568}, default="Q8_0", arch="parakeet"),
    # WER 1.93 @ Q8_0 — en/zh audio-LLM (Whisper-medium encoder + Qwen3-0.6B;
    # Apache-2.0; transcribe.cpp >= 0.2.0). Batch-only upstream, and its
    # optional inline speaker markers stay OFF (session.run's diarize default),
    # so it transcribes like any other card. Q4_K_M degrades to 2.59 and the
    # author warns of edge-case failures below Q5_K_M — Q8_0 is the default.
    _tc_row("moss-transcribe-diarize", "MOSS Transcribe (0.9B)", ("en", "zh"),
            "handy-computer/moss-transcribe-diarize-gguf", "MOSS-Transcribe-Diarize",
            85, {"F16": 1833666240, "Q8_0": 986900160, "Q6_K": 768152256,
                 "Q5_K_M": 700314304, "Q4_K_M": 617345728}, default="Q8_0", arch="moss"),
    # WER 2.01 — 99-language mainstay: ~large-v3 quality at 4x the speed.
    # Sizes are the 2026-07-21 re-upload of the repo (quants 64 bytes shorter per
    # file; F16 was re-encoded, ~10.8 MB smaller) — all five match the live tree.
    _tc_row("whisper-large-v3-turbo", "Whisper large-v3 turbo", ("multi",),
            "handy-computer/whisper-large-v3-turbo-gguf", "whisper-large-v3-turbo",
            90, {"F16": 1625935520, "Q8_0": 886381760, "Q6_K": 692536928,
                 "Q5_K_M": 619628128, "Q4_K_M": 536069728},
            default="Q8_0", recommended=True, arch="whisper"),
    # WER 2.07 — heavy streaming flagship (committed/tentative partials).
    _tc_row("voxtral-mini-4b-realtime", "Voxtral Mini 4B Realtime",
            ("en", "fr", "es", "de", "ru", "zh", "ja", "it", "pt", "nl", "ar", "hi", "ko"),
            "handy-computer/Voxtral-Mini-4B-Realtime-2602-gguf", "Voxtral-Mini-4B-Realtime-2602",
            100, {"F16": 8879114528, "Q8_0": 4731791648, "Q6_K": 3661018912,
                  "Q5_K_M": 3281439008, "Q4_K_M": 2830493984},
            default="Q4_K_M", recommended=True, backend="native_asr_stream", arch="voxtral_realtime"),
    # WER 2.10 — light CJK quality rung.
    _tc_row("qwen3-asr-0.6b", "Qwen3-ASR 0.6B",
            ("zh", "en", "ja", "ko", "yue", "ar", "de", "es",
             "fr", "it", "pt", "ru", "th", "vi", "hi", "id"),
            "handy-computer/Qwen3-ASR-0.6B-gguf", "Qwen3-ASR-0.6B",
            110, {"F16": 1579793056, "Q8_0": 850423456, "Q6_K": 690417824,
                  "Q5_K_M": 645356192, "Q4_K_M": 589560480}, default="Q8_0", arch="qwen3_asr"),
    # WER 2.16 — English STREAMING mid rung (MIT); upstream ships only
    # F16/Q8_0 rungs (plus an F32 we skip — the WER table is flat across all).
    _tc_row("moonshine-streaming-medium", "Moonshine Streaming Medium", ("en",),
            "handy-computer/moonshine-streaming-medium-gguf", "moonshine-streaming-medium",
            113, {"F16": 533781408, "Q8_0": 295793568},
            default="Q8_0", backend="native_asr_stream", arch="moonshine_streaming"),
    # WER 2.18 @ Q8_0 — en-only cache-aware STREAMING, cased+punct (NVIDIA
    # Open Model License; transcribe.cpp >= 0.2.0). The ROOT GGUFs: the repo's
    # bundle/ twins embed a Sortformer diarizer whose multi-speaker output is
    # offline-API only upstream — the stream API is single-speaker either way.
    _tc_row("multitalker-parakeet-streaming-0.6b-v1",
            "Parakeet Multitalker Streaming 0.6B (en)", ("en",),
            "handy-computer/multitalker-parakeet-streaming-0.6b-v1-gguf",
            "multitalker-parakeet-streaming-0.6b-v1",
            114, {"F16": 1246058304, "Q8_0": 734123712, "Q6_K": 603878080,
                  "Q5_K_M": 541890240, "Q4_K_M": 477812416},
            default="Q8_0", backend="native_asr_stream", arch="parakeet"),
    # WER 2.25 — Taiwanese Mandarin + zh/en code-switching (Whisper-large-v2
    # ft); the quant ladder is WER-flat so the smallest curated rung wins.
    _tc_row("breeze-asr-25", "Breeze ASR 25", ("zh", "en"),
            "handy-computer/Breeze-ASR-25-gguf", "Breeze-ASR-25",
            116, {"F16": 3106458208, "Q8_0": 1667964224, "Q6_K": 1296353280,
                 "Q5_K_M": 1160366080, "Q4_K_M": 996526080}, default="Q4_K_M", arch="whisper"),
    # WER 3.03 — LIGHT streaming, 27 languages incl. zh/ja/ko (author-recommended).
    _tc_row("nemotron-3.5-asr-streaming", "Nemotron 3.5 ASR Streaming",
            ("en", "es", "fr", "it", "pt", "nl", "de", "tr", "ru", "ar", "hi",
             "ja", "ko", "vi", "uk", "pl", "sv", "cs", "nb", "da", "bg", "fi",
             "hr", "sk", "zh", "hu", "ro", "et"),
            "handy-computer/nemotron-3.5-asr-streaming-0.6b-gguf", "nemotron-3.5-asr-streaming-0.6b",
            128, {"F16": 1277750240, "Q8_0": 751094240, "Q6_K": 621356512,
                  "Q5_K_M": 559647200, "Q4_K_M": 495831520},
            default="Q8_0", recommended=True, backend="native_asr_stream", arch="parakeet"),
    # WER 3.13 at RTF 289 (metal) — fastest/lightest CJK+yue (cased, punctuated by
    # default since transcribe.cpp 0.2.4 — #157).
    _tc_row("sense-voice", "SenseVoice", ("zh", "en", "ja", "ko", "yue"),
            "handy-computer/SenseVoiceSmall-gguf", "SenseVoiceSmall",
            130, {"F16": 470412128, "Q8_0": 252684608, "Q6_K": 196438336,
                  "Q5_K_M": 172474880, "Q4_K_M": 145738304}, default="Q8_0", arch="sensevoice"),
    # WER 5.1 — the minimal 99-language floor for long-tail source languages.
    _tc_row("whisper-base", "Whisper base", ("multi",),
            "handy-computer/whisper-base-gguf", "whisper-base",
            140, {"F16": 151145760, "Q8_0": 84962880, "Q6_K": 67865664,
                  "Q5_K_M": 63786048, "Q4_K_M": 58870848}, default="Q8_0", arch="whisper"),
    # --- Expanded roster (2026-07-20): the rest of the transcribe.cpp
    # family. Excludes canary-1b (CC-BY-NC, non-commercial) and medasr
    # (gated). All recommended=False; ordered via asr_models() sort.
    # WER 1.25 (q5_k_m = best rung & default; q4_k_m 1.35 worst) — NAR editor, ASR-only
    _tc_row("granite-speech-4.1-2b-nar", "Granite Speech 4.1 (2B NAR)", ("en", "fr", "de", "es", "pt"),
            "handy-computer/granite-speech-4.1-2b-nar-gguf", "granite-speech-4.1-2b-nar",
            11, {"F16": 4515792768, "Q8_0": 2498105472, "Q6_K": 1977417568, "Q5_K_M": 1782089344, "Q4_K_M": 1560008832}, default="Q5_K_M", arch="granite_speech_nar"),
    # Russian (FLEURS-ru 5.50) — e2e w/ punct; slotted in RU view
    _tc_row("gigaam-v3-e2e-ctc", "GigaAM v3 E2E-CTC (Russian)", ("ru",),
            "handy-computer/gigaam-v3-e2e-ctc-gguf", "gigaam-v3-e2e-ctc",
            17, {"F16": 449098336, "Q8_0": 272151136, "Q6_K": 226439776, "Q5_K_M": 204911200, "Q4_K_M": 182497888}, default="Q8_0", arch="gigaam"),
    # Russian (FLEURS-ru 8.29) — plain CTC, lowercase/no-punct; RU view
    _tc_row("gigaam-v3-ctc", "GigaAM v3 CTC (Russian)", ("ru",),
            "handy-computer/gigaam-v3-ctc-gguf", "gigaam-v3-ctc",
            18, {"F16": 448750528, "Q8_0": 271803328, "Q6_K": 226091968, "Q5_K_M": 204563392, "Q4_K_M": 182150080}, default="Q8_0", arch="gigaam"),
    # WER 1.41 — en, lowercase/no-punct
    _tc_row("parakeet-rnnt-1.1b", "Parakeet RNNT 1.1B", ("en",),
            "handy-computer/parakeet-rnnt-1.1b-gguf", "parakeet-rnnt-1.1b",
            26, {"F16": 2145156480, "Q8_0": 1267285248, "Q6_K": 1042505984, "Q5_K_M": 935755008, "Q4_K_M": 825244928}, default="Q8_0", arch="parakeet"),
    # WER 1.41 — en+EU speech-LLM
    _tc_row("granite-4.0-1b-speech", "Granite Speech 4.0 (1B)", ("en", "fr", "de", "es", "pt", "ja"),
            "handy-computer/granite-4.0-1b-speech-gguf", "granite-4.0-1b-speech",
            27, {"F16": 4632623200, "Q8_0": 2559878944, "Q6_K": 2024968032, "Q5_K_M": 1829704640, "Q4_K_M": 1602904896}, default="Q4_K_M", arch="granite_speech"),
    # WER 1.56 — GPU-class 24B (Q5_K_M 17GB+); q4_k_m dropped (2.11 cliff).
    # GPU-only tiers: hardware-gated off CPU-only machines (a 17GB CPU download
    # for a 24B is unusable); big-GPU machines still see it, small-GPU ones get
    # the "needs ~17GB" variant reason string.
    _tc_row("voxtral-small-24b", "Voxtral Small 24B", ("en", "fr", "de", "es", "it", "pt", "nl", "hi"),
            "handy-computer/Voxtral-Small-24B-2507-gguf", "Voxtral-Small-24B-2507",
            31, {"F16": 48548098528, "Q8_0": 25810383328, "Q6_K": 19936473568, "Q5_K_M": 17138659808},
            default="Q5_K_M", tiers=_TC_GPU_TIERS, arch="voxtral"),
    # WER 1.58 offline — run batch (zero-lookahead streaming collapses to 5.76)
    _tc_row("parakeet-unified-en-0.6b", "Parakeet Unified 0.6B (en)", ("en",),
            "handy-computer/parakeet-unified-en-0.6b-gguf", "parakeet-unified-en-0.6b",
            32, {"F16": 1239114240, "Q8_0": 731357568, "Q6_K": 602191232, "Q5_K_M": 540795264, "Q4_K_M": 477274496}, default="Q8_0", arch="parakeet"),
    # WER 1.59 — en, lowercase/no-punct
    _tc_row("parakeet-rnnt-0.6b", "Parakeet RNNT 0.6B", ("en",),
            "handy-computer/parakeet-rnnt-0.6b-gguf", "parakeet-rnnt-0.6b",
            34, {"F16": 1235969568, "Q8_0": 729687456, "Q6_K": 600902048, "Q5_K_M": 539714976, "Q4_K_M": 476390816}, default="Q8_0", arch="parakeet"),
    # WER 1.63 — SALM audio-LLM, en-only (all quants 1.63)
    _tc_row("canary-qwen-2.5b", "Canary-Qwen 2.5B", ("en",),
            "handy-computer/canary-qwen-2.5b-gguf", "canary-qwen-2.5b",
            41, {"F16": 5076972928, "Q8_0": 2797548928, "Q6_K": 2208697728, "Q5_K_M": 1983729024, "Q4_K_M": 1737575808}, default="Q4_K_M", arch="canary_qwen"),
    # WER 1.68 — en, cased+punct+timestamps (v3 is multilingual)
    _tc_row("parakeet-tdt-0.6b-v2", "Parakeet TDT 0.6B v2", ("en",),
            "handy-computer/parakeet-tdt-0.6b-v2-gguf", "parakeet-tdt-0.6b-v2",
            42, {"F16": 1237334592, "Q8_0": 729574912, "Q6_K": 600408576, "Q5_K_M": 539012608, "Q4_K_M": 475491840}, default="Q8_0", arch="parakeet"),
    # WER 1.84 — en, fastest 0.6B head, lowercase/no-punct
    _tc_row("parakeet-ctc-0.6b", "Parakeet CTC 0.6B", ("en",),
            "handy-computer/parakeet-ctc-0.6b-gguf", "parakeet-ctc-0.6b",
            61, {"F16": 1220181184, "Q8_0": 722271424, "Q6_K": 593644736, "Q5_K_M": 532544704, "Q4_K_M": 469302464}, default="Q8_0", arch="parakeet"),
    # WER 1.84 — en, lowercase/no-punct
    _tc_row("parakeet-ctc-1.1b", "Parakeet CTC 1.1B", ("en",),
            "handy-computer/parakeet-ctc-1.1b-gguf", "parakeet-ctc-1.1b",
            62, {"F16": 2129368096, "Q8_0": 1259869216, "Q6_K": 1035248672, "Q5_K_M": 928584736, "Q4_K_M": 818156576}, default="Q8_0", arch="parakeet"),
    # WER 1.87 — en, hybrid TDT+CTC, cased+punct
    _tc_row("parakeet-tdt_ctc-1.1b", "Parakeet TDT-CTC 1.1B", ("en",),
            "handy-computer/parakeet-tdt_ctc-1.1b-gguf", "parakeet-tdt_ctc-1.1b",
            63, {"F16": 2145162560, "Q8_0": 1267288320, "Q6_K": 1042509056, "Q5_K_M": 935758080, "Q4_K_M": 825248000}, default="Q8_0", arch="parakeet"),
    # WER 1.87 — offline audio-LLM (q4_k_m 2.98GB)
    _tc_row("voxtral-mini-3b", "Voxtral Mini 3B", ("en", "fr", "de", "es", "it", "pt", "nl", "hi"),
            "handy-computer/Voxtral-Mini-3B-2507-gguf", "Voxtral-Mini-3B-2507",
            64, {"F16": 9376578208, "Q8_0": 5000084128, "Q6_K": 3869489824, "Q5_K_M": 3464182432, "Q4_K_M": 2984721056}, default="Q4_K_M", arch="voxtral"),
    # WER 2.29 — en-only cache-aware STREAMING (NVIDIA Open Model License)
    _tc_row("nemotron-speech-streaming-en", "Nemotron Speech Streaming (en)", ("en",),
            "handy-computer/nemotron-speech-streaming-en-0.6b-gguf", "nemotron-speech-streaming-en-0.6b",
            117, {"F16": 1237652608, "Q8_0": 729650176, "Q6_K": 600420352, "Q5_K_M": 538989568, "Q4_K_M": 475436032}, default="Q8_0", backend="native_asr_stream", arch="parakeet"),
    # WER 2.43 — en, small/fast, cased+punct
    _tc_row("parakeet-tdt_ctc-110m", "Parakeet TDT-CTC 110M", ("en",),
            "handy-computer/parakeet-tdt_ctc-110m-gguf", "parakeet-tdt_ctc-110m",
            118, {"F16": 229334560, "Q8_0": 135373280, "Q6_K": 112311264, "Q5_K_M": 101335520, "Q4_K_M": 89989600}, default="Q8_0", arch="parakeet"),
    # WER 2.46 — 99-lang 1.55B (pre-v3)
    _tc_row("whisper-large-v2", "Whisper large-v2", ("multi",),
            "handy-computer/whisper-large-v2-gguf", "whisper-large-v2",
            119, {"F16": 3106458208, "Q8_0": 1667964224, "Q6_K": 1296353280, "Q5_K_M": 1160366080, "Q4_K_M": 996526080}, default="Q8_0", arch="whisper"),
    # WER 2.53 — en STREAMING 123M (F16/Q8_0 only)
    _tc_row("moonshine-streaming-small", "Moonshine Streaming Small", ("en",),
            "handy-computer/moonshine-streaming-small-gguf", "moonshine-streaming-small",
            121, {"F16": 282092128, "Q8_0": 198506848}, default="Q8_0", backend="native_asr_stream", arch="moonshine_streaming"),
    # WER 2.59 — 99-lang 769M
    _tc_row("whisper-medium", "Whisper medium", ("multi",),
            "handy-computer/whisper-medium-gguf", "whisper-medium",
            122, {"F16": 1541931424, "Q8_0": 831538144, "Q6_K": 648019904, "Q5_K_M": 582746048, "Q4_K_M": 504102848}, default="Q8_0", arch="whisper"),
    # WER 2.62 — 99-lang 1.55B (v1)
    _tc_row("whisper-large", "Whisper large", ("multi",),
            "handy-computer/whisper-large-gguf", "whisper-large",
            123, {"F16": 3106458176, "Q8_0": 1667964192, "Q6_K": 1296353248, "Q5_K_M": 1160366048, "Q4_K_M": 996526048}, default="Q8_0", arch="whisper"),
    # WER 2.72 — en-only 769M
    _tc_row("whisper-medium.en", "Whisper medium.en", ("en",),
            "handy-computer/whisper-medium.en-gguf", "whisper-medium.en",
            124, {"F16": 1541853248, "Q8_0": 831460928, "Q6_K": 647942912, "Q5_K_M": 582669056, "Q4_K_M": 504025856}, default="Q8_0", arch="whisper"),
    # WER 2.97 — en-only 244M
    _tc_row("whisper-small.en", "Whisper small.en", ("en",),
            "handy-computer/whisper-small.en-gguf", "whisper-small.en",
            125, {"F16": 492810784, "Q8_0": 269674144, "Q6_K": 212030528, "Q5_K_M": 193672256, "Q4_K_M": 171553856}, default="Q8_0", arch="whisper"),
    # WER 3.26 — en OFFLINE 61M (F16/Q8_0 only)
    _tc_row("moonshine-base", "Moonshine Base", ("en",),
            "handy-computer/moonshine-base-gguf", "moonshine-base",
            131, {"F16": 131789440, "Q8_0": 77476480}, default="Q8_0", arch="moonshine"),
    # WER 3.33 — 99-lang 244M
    _tc_row("whisper-small", "Whisper small", ("multi",),
            "handy-computer/whisper-small-gguf", "whisper-small",
            132, {"F16": 492888480, "Q8_0": 269751136, "Q6_K": 212107328, "Q5_K_M": 193749056, "Q4_K_M": 171630656}, default="Q8_0", arch="whisper"),
    # WER 4.13 — en-only 74M
    _tc_row("whisper-base.en", "Whisper base.en", ("en",),
            "handy-computer/whisper-base.en-gguf", "whisper-base.en",
            133, {"F16": 151068608, "Q8_0": 84886208, "Q6_K": 67789088, "Q5_K_M": 63709472, "Q4_K_M": 58794272}, default="Q8_0", arch="whisper"),
    # WER 4.52 — en STREAMING 34M (F16/Q8_0 only)
    _tc_row("moonshine-streaming-tiny", "Moonshine Streaming Tiny", ("en",),
            "handy-computer/moonshine-streaming-tiny-gguf", "moonshine-streaming-tiny",
            134, {"F16": 89784416, "Q8_0": 50462816}, default="Q8_0", backend="native_asr_stream", arch="moonshine_streaming"),
    # WER 4.58 — en OFFLINE 27M (F16/Q8_0 only)
    _tc_row("moonshine-tiny", "Moonshine Tiny", ("en",),
            "handy-computer/moonshine-tiny-gguf", "moonshine-tiny",
            135, {"F16": 59244192, "Q8_0": 35466912}, default="Q8_0", arch="moonshine"),
    # WER 5.72 — en-only 39M
    _tc_row("whisper-tiny.en", "Whisper tiny.en", ("en",),
            "handy-computer/whisper-tiny.en-gguf", "whisper-tiny.en",
            141, {"F16": 80058464, "Q8_0": 45904544, "Q6_K": 44761760, "Q5_K_M": 44135072, "Q4_K_M": 43545248}, default="Q8_0", arch="whisper"),
    # WER 7.49 — 99-lang 39M (least accurate whisper)
    _tc_row("whisper-tiny", "Whisper tiny", ("multi",),
            "handy-computer/whisper-tiny-gguf", "whisper-tiny",
            142, {"F16": 80135360, "Q8_0": 45981088, "Q6_K": 44838304, "Q5_K_M": 44211616, "Q4_K_M": 43621792}, default="Q8_0", arch="whisper"),
    # per-language fine-tune (ar); no upstream WER/doc
    _tc_row("moonshine-base-ar", "Moonshine Base (ar)", ("ar",),
            "handy-computer/moonshine-base-ar-gguf", "moonshine-base-ar",
            150, {"F16": 131789440, "Q8_0": 77476480}, default="Q8_0", arch="moonshine"),
    # per-language fine-tune (ja); no upstream WER/doc
    _tc_row("moonshine-base-ja", "Moonshine Base (ja)", ("ja",),
            "handy-computer/moonshine-base-ja-gguf", "moonshine-base-ja",
            151, {"F16": 131789440, "Q8_0": 77476480}, default="Q8_0", arch="moonshine"),
    # per-language fine-tune (ko); no upstream WER/doc
    _tc_row("moonshine-base-ko", "Moonshine Base (ko)", ("ko",),
            "handy-computer/moonshine-base-ko-gguf", "moonshine-base-ko",
            152, {"F16": 131789440, "Q8_0": 77476480}, default="Q8_0", arch="moonshine"),
    # per-language fine-tune (uk); no upstream WER/doc
    _tc_row("moonshine-base-uk", "Moonshine Base (uk)", ("uk",),
            "handy-computer/moonshine-base-uk-gguf", "moonshine-base-uk",
            153, {"F16": 131789472, "Q8_0": 77476512}, default="Q8_0", arch="moonshine"),
    # per-language fine-tune (vi); no upstream WER/doc
    _tc_row("moonshine-base-vi", "Moonshine Base (vi)", ("vi",),
            "handy-computer/moonshine-base-vi-gguf", "moonshine-base-vi",
            154, {"F16": 131789472, "Q8_0": 77476512}, default="Q8_0", arch="moonshine"),
    # per-language fine-tune (zh); no upstream WER/doc
    _tc_row("moonshine-base-zh", "Moonshine Base (zh)", ("zh",),
            "handy-computer/moonshine-base-zh-gguf", "moonshine-base-zh",
            155, {"F16": 131789440, "Q8_0": 77476480}, default="Q8_0", arch="moonshine"),
    # per-language fine-tune (ar); no upstream WER/doc
    _tc_row("moonshine-tiny-ar", "Moonshine Tiny (ar)", ("ar",),
            "handy-computer/moonshine-tiny-ar-gguf", "moonshine-tiny-ar",
            156, {"F16": 59244224, "Q8_0": 35466944}, default="Q8_0", arch="moonshine"),
    # per-language fine-tune (ja); no upstream WER/doc
    _tc_row("moonshine-tiny-ja", "Moonshine Tiny (ja)", ("ja",),
            "handy-computer/moonshine-tiny-ja-gguf", "moonshine-tiny-ja",
            157, {"F16": 59244224, "Q8_0": 35466944}, default="Q8_0", arch="moonshine"),
    # per-language fine-tune (ko); no upstream WER/doc
    _tc_row("moonshine-tiny-ko", "Moonshine Tiny (ko)", ("ko",),
            "handy-computer/moonshine-tiny-ko-gguf", "moonshine-tiny-ko",
            158, {"F16": 59244224, "Q8_0": 35466944}, default="Q8_0", arch="moonshine"),
    # per-language fine-tune (uk); no upstream WER/doc
    _tc_row("moonshine-tiny-uk", "Moonshine Tiny (uk)", ("uk",),
            "handy-computer/moonshine-tiny-uk-gguf", "moonshine-tiny-uk",
            159, {"F16": 59244224, "Q8_0": 35466944}, default="Q8_0", arch="moonshine"),
    # per-language fine-tune (vi); no upstream WER/doc
    _tc_row("moonshine-tiny-vi", "Moonshine Tiny (vi)", ("vi",),
            "handy-computer/moonshine-tiny-vi-gguf", "moonshine-tiny-vi",
            160, {"F16": 59244224, "Q8_0": 35466944}, default="Q8_0", arch="moonshine"),
    # per-language fine-tune (zh); no upstream WER/doc
    _tc_row("moonshine-tiny-zh", "Moonshine Tiny (zh)", ("zh",),
            "handy-computer/moonshine-tiny-zh-gguf", "moonshine-tiny-zh",
            161, {"F16": 59244224, "Q8_0": 35466944}, default="Q8_0", arch="moonshine"),
]


def asr_models() -> list[AsrModel]:
    # Rank-ordered (sort_order asc) regardless of source arrangement, so the
    # 2026-07-20 expansion block can be appended to ASR_MODELS without
    # hand-positioning every row.
    return sorted(ASR_MODELS, key=lambda m: m.sort_order)


def asr_model(model_id: str) -> AsrModel | None:
    return next((m for m in ASR_MODELS if m.id == model_id), None)


@dataclass(frozen=True)
class TranslateModel(_ModelBase):
    # Qwen3/Qwen3.5 chat-template thinking-mode kill switch (mirrors
    # translate_backend.QwenStrategy.build): disable_thinking forces an empty
    # <think></think> block as the assistant's prefill, append_no_think
    # additionally appends the "/no_think" soft switch to the system prompt
    # (plain Qwen3 only, belt-and-braces per Qwen3's own docs).
    disable_thinking: bool = False
    append_no_think: bool = False
    # Which of translate_backend.STRATEGIES to build the prompt with
    # ("qwen" | "hunyuan" | "gemma"); read off the card by
    # planner._plan_config into PlanConfig.prompt_family.
    prompt_family: str = ""


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
    ("qwen3.5-4b", "q4_k_m"): ("unsloth/Qwen3.5-4B-GGUF", "Qwen3.5-4B-Q4_K_M.gguf"),
    ("qwen3.5-4b", "q8_0"): ("unsloth/Qwen3.5-4B-GGUF", "Qwen3.5-4B-Q8_0.gguf"),
    ("translategemma-4b", "q4_k_m"): ("mradermacher/translategemma-4b-it-GGUF", "translategemma-4b-it.Q4_K_M.gguf"),
    ("translategemma-4b", "q8_0"):   ("mradermacher/translategemma-4b-it-GGUF", "translategemma-4b-it.Q8_0.gguf"),
    # utter-project publishes no GGUFs of its own; mradermacher's are the same
    # community source the TranslateGemma rows already use.
    ("eurollm-1.7b", "q4_k_m"): ("mradermacher/EuroLLM-1.7B-Instruct-GGUF", "EuroLLM-1.7B-Instruct.Q4_K_M.gguf"),
    ("eurollm-1.7b", "q8_0"): ("mradermacher/EuroLLM-1.7B-Instruct-GGUF", "EuroLLM-1.7B-Instruct.Q8_0.gguf"),
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


def _llm_translate_row(mid, name, family, sort_order, default_quant, default_bytes,
                       alt_quant, alt_bytes, recommended=False,
                       disable_thinking=False, append_no_think=False, arch=""):
    """A GGUF LLM translate card: the native_translate backend (sokuji_native's
    in-process llama.cpp runtime, spec §4.3), two GGUF quant variants, three
    tiers each (gpu-metal / gpu-vulkan / cpu — no gpu-cuda: post-A1 no probe
    ever reports a "cuda" device kind, so that tier was unreachable). The same
    GGUF serves every tier; rank 2.0 marks the default quant. Plan ORDER across
    tiers is decided by accel.TIER_RANK (gpu-metal 3.0 > gpu-vulkan 2.5 >
    cpu 1.0), not by the order of this tuple. `family` selects the prompt
    strategy (translate_backend.STRATEGIES) via PlanConfig.prompt_family. `arch`
    is llama.cpp's `general.architecture` string for this GGUF (graph_family) —
    unrelated to `family`, which is a prompt strategy, not a graph."""
    deps = []
    for quant, nbytes, rank in ((default_quant, default_bytes, 2.0),
                                (alt_quant, alt_bytes, 1.0)):
        artifact = _gguf_artifact(mid, quant)
        deps += [Deployment("native_translate", tier, quant, artifact, rank, est_bytes=nbytes)
                 for tier in ("gpu-metal", "gpu-vulkan", "cpu")]
    return TranslateModel(mid, name, ("multi",), tuple(deps),
                          recommended=recommended, sort_order=sort_order,
                          size_bytes=default_bytes, disable_thinking=disable_thinking,
                          append_no_think=append_no_think, prompt_family=family,
                          graph_family=arch)


# Sizes are the exact upstream GGUF file byte counts (HF API size fetch,
# 2026-07-03 — see _GGUF_SOURCES). The 13 Opus-MT (CTranslate2) rows that used
# to live here were removed in slice 3 along with the ct2_opus_translate
# backend and the ctranslate2 dependency: translation now runs entirely
# through native_translate (sokuji_native's in-process llama.cpp runtime).
TRANSLATE_MODELS: list[TranslateModel] = [
    _llm_translate_row("qwen2.5-0.5b", "Qwen 2.5 0.5B", "qwen", 1,
                       "q8_0", 675710816, "q4_k_m", 491400032, recommended=True, arch="qwen2"),
    _llm_translate_row("qwen3-0.6b", "Qwen 3 0.6B", "qwen", 2,
                       "q8_0", 639446688, "q4_k_m", 396705472, recommended=True,
                       disable_thinking=True, append_no_think=True, arch="qwen3"),
    _llm_translate_row("qwen3.5-0.8b", "Qwen 3.5 0.8B", "qwen", 3,
                       "q4_k_m", 532517120, "q8_0", 811843840,
                       disable_thinking=True, arch="qwen35"),
    _llm_translate_row("qwen3.5-2b", "Qwen 3.5 2B", "qwen", 4,
                       "q4_k_m", 1280835840, "q8_0", 2012012800,
                       disable_thinking=True, arch="qwen35"),
    # Same family and thinking handling as the 0.8B / 2B rows: Qwen3.5 has
    # no /no_think soft switch, so only the empty-<think> prefill applies.
    # The GGUF's text tower loads without the vision mmproj (added 2026-09-03).
    _llm_translate_row("qwen3.5-4b", "Qwen 3.5 4B", "qwen", 5,
                       "q4_k_m", 2740937888, "q8_0", 4482403488,
                       disable_thinking=True, arch="qwen35"),
    _llm_translate_row("translategemma-4b", "TranslateGemma 4B", "gemma", 6,
                       "q4_k_m", 2489909760, "q8_0", 4130417920, arch="gemma3"),
    # EuroLLM-1.7B-Instruct (utter-project, Apache-2.0): a translation-tuned
    # Llama-architecture model covering 35 languages (the EU set plus zh, ja,
    # ko, ru, uk, ar, hi). Its chat template is ChatML, which is what the
    # "qwen" strategy renders; no thinking mode. 4096-token context
    # (added 2026-09-03).
    _llm_translate_row("eurollm-1.7b", "EuroLLM 1.7B", "qwen", 7,
                       "q4_k_m", 1045157088, "q8_0", 1763775712, arch="llama"),
    _llm_translate_row("hy-mt2-1.8b", "Hunyuan-MT2 1.8B", "hunyuan", 8,
                       "q4_k_m", 1133080448, "q8_0", 1908528192, arch="hunyuan-dense"),
    _llm_translate_row("hy-mt2-7b", "Hunyuan-MT2 7B", "hunyuan", 9,
                       "q4_k_m", 4624648896, "q8_0", 7981928896, arch="hunyuan-dense"),
    _llm_translate_row("hy-mt15-1.8b", "Hunyuan-MT1.5 1.8B", "hunyuan", 10,
                       "q4_k_m", 1133080512, "q8_0", 1908528288, arch="hunyuan-dense"),
    _llm_translate_row("hy-mt15-7b", "Hunyuan-MT1.5 7B", "hunyuan", 11,
                       "q4_k_m", 4624649312, "q8_0", 7981929344, arch="hunyuan-dense"),
]


def translate_models() -> list[TranslateModel]:
    return list(TRANSLATE_MODELS)


def translate_model(model_id: str) -> TranslateModel | None:
    return next((m for m in TRANSLATE_MODELS if m.id == model_id), None)


@dataclass(frozen=True)
class License:
    """Non-standard license terms attached to a model card (e.g. CC-BY-NC).
    Generic DATA, not hardcoded UI: most cards carry no restriction and leave
    TtsModel.license as None; only a card that needs it (OmniVoice, issue
    #351) sets one, and the download gate (Task 2) reads this rather than
    special-casing a model id."""
    spdx: str             # SPDX identifier ("CC-BY-NC-4.0"), or a LicenseRef-* for a
                          # vendor licence with no SPDX id of its own
    name: str             # human-readable license name
    url: str              # license text URL
    non_commercial: bool  # True gates commercial use
    source_repo: str      # upstream repo this license traces back to
    attribution: str      # required attribution string (author/project)
    # Whether the download gate must show an acknowledgement before this card is
    # fetched. Separate from `non_commercial` on purpose: a licence can be
    # restrictive enough to need acknowledging while still permitting commercial use
    # (IndexTTS 2.5's bilibili Model Use License allows it below a MAU/revenue
    # threshold), and calling that "non-commercial" in the UI would be a lie. The
    # renderer gates on THIS flag and picks its wording from `non_commercial`.
    requires_consent: bool = True


@dataclass(frozen=True)
class TtsModel(_ModelBase):
    family: str = ""                  # sk_tts_load's family_hint: a kFamilies[] name in
                                      # native/src/sk_tts.cpp (native/README.md lists them)
    load_language: str = ""           # pocket_tts: its load-time language package ("english", ...).
                                      # Any other family: a forced language sk_tts uses in place of
                                      # the caller's on every synth (VoiceTut: "arz"); "" = none.
    clones: bool = False              # zero-shot voice cloning from a reference clip (sk_tts_set_voice)
    streaming: bool = False           # intra-utterance audio-delta streaming (R5: MOSS is offline-only)
    sample_rate: int = 24000          # audio.cpp's native rate for this family
    named_voices: bool = False        # sk_tts_presets returns a non-empty, curated list (dropdown)
    transcript_required: bool = False  # sk_tts_set_voice's ref_text is mandatory for this card's clips
                                       # (omnivoice, qwen3_tts's Base cards -- R15(s4) -- and every
                                       # family whose kFamilies[] row sets it)
    license: License | None = None    # non-standard license terms; None = no restriction
    # (relative-to-artifact-dir filename, size_bytes) sidecar assets sk_tts_presets
    # discovers next to the loaded gguf (pocket-tts-en's embeddings/alba.safetensors);
    # () for every other card (single self-sufficient GGUF — see native/README.md's
    # "GGUF-embedded sidecars" note).
    extra_files: tuple[tuple[str, int], ...] = ()
    # Spec stage 2.3. Whether a clip or preset MUST be set before the card can speak: its
    # family's rule (VOICE_REQUIRED_FAMILIES, below) unless the card overrides it.
    voice_required: bool = False
    # Preset names the card offers when the native layer cannot enumerate them
    # (sk_tts_presets lists only supertonic's and pocket_tts's); () = ask the native layer.
    presets: tuple[str, ...] = ()
    # The preset the sidecar applies right after load, for a card whose family cannot
    # synthesise with nothing set; "" = none.
    default_preset: str = ""
    # (rung, dtypes) the pre-download op-coverage query expands WEIGHT over for that rung, read
    # from the matrix tensors of the published main GGUF and its companion GGUFs; a rung
    # without an entry asks RUNG_FALLBACK_DTYPES. () for the fourteen cards that predate the
    # 2026-10-06 roster (owner's ruling 2026-10-06, op-coverage precision).
    rung_dtypes: tuple[tuple[str, frozenset[str]], ...] = ()


# Ruling R16: families whose engine CANNOT synthesize until a voice is set --
# they ship no usable built-in voice at all, so a bare generate() can only ever
# fail. tts_backend._ensure_voice_ready() turns that into a clean, family-named
# BackendLoadError before the native layer is reached, and voice_capability()
# below puts the same fact on the wire as `required` so the renderer's own
# pre-init gate reads it instead of guessing.
#
# It lives HERE, not in tts_backend, because two consumers need it and this is
# the module both can import (tts_backend already imports from .catalog; the
# reverse would be a cycle). tts_backend re-exports it under its historical
# private name.
#
# Membership is by ENGINE BEHAVIOUR, live-verified per family, not by voice
# shape -- which is exactly the distinction the renderer used to get wrong:
#   qwen3_tts   base checkpoint has no default voice, and its ICL clone mode
#               additionally requires ref_text (R15(s4), task-7-report.md §3).
#   omnivoice   same, ref_text likewise mandatory.
#   index_tts2  (2026-09-03) request parser refuses outright -- "IndexTTS2
#               request requires --voice-ref or voice.speaker.audio" -- and
#               audio.cpp exposes no built-in voices for it. Needs the CLIP
#               only, not a transcript: transcript_required stays False.
# Deliberately NOT members, though all five report clones=True and expose no
# presets (i.e. they LOOK identical to the three above from the outside):
#   moss_tts_nano  ships a genuinely working built-in default (CPU-verified).
#   pocket_tts     does NOT -- but adding it here would only make the failure
#                  clean, not make a bare synth work; ruling R34 gives it a real
#                  default voice at load() instead (_DEFAULT_PRESET_FAMILIES).
#   voxcpm1, voxcpm2, irodori_tts  (2026-09-03) all synthesize with nothing set;
#                  their speaker reference is optional (irodori's own request
#                  default is no_ref=true). CPU-verified against the real GGUFs.
#
# Since spec stage 2.3 this set is each card's DEFAULT: TtsModel.voice_required is what the
# wire and the R16 gate read, and _tts_gguf_row sets it from this set unless the card overrides
# it (a CustomVoice checkpoint rides qwen3_tts and speaks a preset from load).
# Members added with the 2026-10-06 roster expansion (each refuses a bare synth itself):
#   cosyvoice3  "CosyVoice3 requires reference audio" (audio.cpp
#               src/models/cosyvoice3/session.cpp:170-174); no built-in voice. Needs
#               the clip only: with no transcript it clones cross-lingually.
#   fireredtts3 (2026-10-06) the Base checkpoint clones or does nothing: "FireRedTTS3 Base
#               voice clone requires reference audio" (audio.cpp
#               src/models/fireredtts3/session.cpp:78-83). Its transcript is required too
#               (transcript_required).
#   chatterbox  (2026-10-06) "Chatterbox prepare requires speaker reference audio" (audio.cpp
#               src/models/chatterbox/session.cpp:410-412); its session is VoiceCloning only.
#   confucius4_tts  (2026-10-06) "Confucius4-TTS voice cloning requires speaker reference audio
#               or cached_voice_id" (audio.cpp src/models/confucius4_tts/request.cpp:140-143); a
#               VoiceCloning session only, and no transcript option.
#   glm_tts     (2026-10-06) run() refuses without a clip ("GLM-TTS requires --voice-ref
#               reference audio") and without its transcript; no built-in voice.
#   echo_tts    (2026-10-06) its session is voice-cloning only and refuses without a clip
#               ("Echo-TTS requires speaker reference audio"). Needs the CLIP only.
#   miotts      (2026-10-06) run() refuses without a clip ("MioTTS run() requires voice
#               speaker audio"); no built-in voice. Needs the CLIP only.
# breeze_tts is not a member: its engine designs a voice when given no clip, so its card
# requires one instead (voice_required=True).
VOICE_REQUIRED_FAMILIES = frozenset({"qwen3_tts", "omnivoice", "index_tts2", "cosyvoice3", "fireredtts3",
                                     "chatterbox", "confucius4_tts", "glm_tts", "echo_tts", "miotts"})


def voice_capability(model: "TtsModel") -> dict:
    """Native voice capability derived from static catalog facts.
    builtin: named (sk_tts_presets dropdown) | none. custom: clip (reference
    audio, sk_tts_set_voice) | none. required: whether a clip/preset MUST be set
    before the model can speak at all. The old style/range axes (Supertonic's
    uploaded style-vector JSON, a sid-range slider) died with the ONNX
    backends that were their only consumers.

    `required` is its own axis and always present, because it is NOT derivable
    from the other two: moss_tts_nano, voxcpm1, voxcpm2 and irodori_tts all
    report builtin=none + custom=clip (they clone and expose no presets) and yet
    speak fine with nothing set, while qwen3_tts's Base cards, omnivoice, index_tts2
    and the other voice-required cards report the identical shape and cannot. The
    renderer's pre-init gate used to infer it
    from that shape and so refused to start TTS for the four ungated ones. It is
    emitted unconditionally (unlike transcriptRequired) so an absent field means
    "sidecar too old to say", not "false"."""
    custom = "clip" if model.clones else "none"
    builtin = "named" if model.named_voices else "none"
    out = {"builtin": builtin, "custom": custom,
           "required": model.voice_required}
    if custom == "clip" and model.transcript_required:
        out["transcriptRequired"] = True
    return out


def license_dict(model: "TtsModel") -> dict | None:
    """Wire-format (camelCase) serialization of TtsModel.license, or None when
    the card carries no non-standard license terms."""
    lic = model.license
    if lic is None:
        return None
    return {
        "spdx": lic.spdx,
        "name": lic.name,
        "url": lic.url,
        "nonCommercial": lic.non_commercial,
        "requiresConsent": lic.requires_consent,
        "sourceRepo": lic.source_repo,
        "attribution": lic.attribution,
    }


# The fourteen cards that predate the 2026-10-06 roster are single-file GGUFs from audio.cpp's
# official mirror, verified 2026-09-01 (the first ten) and 2026-09-03 (the four added then) via
# the HF tree API (`GET api/models/audio-cpp/audio.cpp-gguf/tree/main/<dir>`) — every (dir,
# file) pair below resolves to a real LFS object and the byte count shown is its exact `lfs.size`.
# Cross-checked against the repo's own `model_specs/<family>.json` package list (vendored at
# native/build/cpu/_deps/audiocpp-src/model_specs/) for the curated default per family and, for
# pocket_tts, exactly which languages ship a preset asset (see the pocket-tts-en row below).
# A card may instead come from a third-party repo pinned in PINNED_REVISIONS (`repo=`, ruling
# 4), sit at a repo's root (`dir_=""`), and give each rung the companion files it needs beside
# its main GGUF (`companions=`, spec stage 2.2).
_AUDIOCPP_GGUF_REPO = "audio-cpp/audio.cpp-gguf"

# Ruling 4 (2026-10-06): a GGUF hosted outside audio.cpp's official mirror is downloaded from
# its own repo, pinned to one commit, so the bytes a card names cannot change under it; an ASR
# or translation repo is pinned the same way when its head no longer holds a card's files.
# Every Hub call the sidecar makes for a native TTS, ASR or translation card -- download,
# status, size, delete, load, the load-free voice listing -- passes
# revision=hub_revision(repo): a download at a commit hash writes snapshots/<sha>/ and no
# refs/main, so a lookup of "main" would read it as absent forever. The official mirror is not
# pinned: hub_revision() returns None for it, the Hub's own default, so what users already
# downloaded keeps resolving through refs/main. Every byte count a card carries for one of
# these repos is read at its pinned commit
# (benchmark/qwen3-asr-webgpu/hub_sizes.py <repo> <out.json> <sha>).
PINNED_REVISIONS: dict[str, str] = {
    "js-byte/Audio8-TTS-Preview-0.6b-GGUF": "788f6fdb0bbdbbc407c63f3265cea9875b4a7c14",
    "WalkingCat/Soprano-1.1-80M-GGUF": "36c6f47cf91421b7f0cf3d862d28ae2e41aab3f2",
    "mirek190/audio.cpp": "94bbade143c5f62c0c842ef5b2119f7880fa9ee4",
    "dignome/Echo-TTS": "5a7c7c5f510410a8841ba7e46cf6bfd91ea25c21",
    "dignome/kitten_tts2": "73b762c95b07c4f0675c927c25d65741b8dab7da",
    "mohammedaly22/VoiceTut-TTS-GGUF": "615457bb2e9043f468e012c159146b28fa8f5959",
    "LiquidAI/LFM2.5-Audio-1.5B-GGUF": "7d525f883a077e20afb782f2ff618edcae0e39e4",
    "LiquidAI/LFM2.5-Audio-1.5B-JP-GGUF": "64b96718b341dbd5650f9e85627cecdcbd4ac61b",
    # The ASR card multitalker-parakeet-streaming-0.6b-v1: its repo removed the root-level
    # plain GGUFs on 2026-09-12 (bundle/ twins only, which embed a diarizer the stream API never
    # uses); 1a9defe9 is the last commit holding them, at exactly the card's byte counts.
    "handy-computer/multitalker-parakeet-streaming-0.6b-v1-gguf": "1a9defe9bb8f2a7ca2110454f6920f794e45df11",
}


def hub_revision(repo: str) -> str | None:
    """The commit every Hub call for `repo` passes as `revision=`, or None (the Hub's default
    branch) for a repo that is not pinned."""
    return PINNED_REVISIONS.get(repo)


# Ruling R18(s4): name of the sokuji-owned hard-link staging tree tts_backend.py's
# load() creates as a sibling of HF's own models--*/ directories, directly under the
# SAME cache root. Shared between tts_backend.py (creates/refreshes staged entries)
# and native_models.py (removes a deleted card's staged entries so a hard link never
# outlives the HF-cache-side file it was staged from) — defined here, the one module
# both already import from, so neither has to import the other just for this name.
TTS_STAGING_DIRNAME = "sokuji-tts-staging"

# R19 (2026-09-01): TTS is CPU-ONLY until GPU execution is validated per
# family per lane (a slice-5/6 task) — every native_tts card COULD ship the
# same tiers for every quant, since audio.cpp has no CUDA-only/DirectML-only
# TTS kernel path (unlike the deleted ONNX backends' per-platform/
# per-precision restrictions: bf16-CUDA-only, macOS-only MLX rows, ...), but
# the slice-4 CI dry run's mac-arm64 metal lane gave the FIRST-EVER real-GPU
# TTS contact and it aborted hard: the Python binding tests pass device=None
# (NULL -> engine auto, per A1), which picked Metal for supertonic, and that
# graph hit ggml_abort inside synthesize_supertonic_chunk ("unsupported op",
# ggml-metal-ops.cpp:204) in upstream ggml's Metal backend. The C tests never
# hit this because they load with an explicit CPU device (see
# native/python/tests/test_sokuji_native.py). ASR (_TC_TIERS) and translate
# (native_translate's own three-tier tuple in _llm_translate_row) are
# untouched by this ruling — Metal ran moonshine (ASR) clean on the same
# lane. (Retroactive correction, R36 below: that "first-ever real-GPU TTS
# contact" was never M1 evidence either — GitHub's macos-14 arm64 runner is
# the same paravirtual VM described there, and this abort is that VM's
# GGML_OP_NORM gate, not a real-hardware finding.)
#
# `_TTS_TIERS` below is the cpu-only default for any family not listed in
# `_TTS_TIER_OVERRIDES` — every new family starts cpu-only until it, too, earns
# a tier through real-GPU evidence (one fleet run per family per lane, R19). The
# nine families shipped before native 1.3.0 are all in that dict — the four added
# on 2026-09-03 (voxcpm1, voxcpm2, irodori_tts, index_tts2) arrived cpu-only and
# earned their rows the same evening (commit 2f2b28bc) once the native-1.0.2 wheels
# were validated per family on the fleet. Each family added with native 1.3.0
# arrived cpu-only too and joins that dict only through its own fleet run. A new card of
# a family already in that dict passes `tiers=_TTS_TIERS` to `_tts_gguf_row` and gains a
# GPU tier the same way, from a fleet run of that card. A family that fails every GPU lane
# loses its card rather than keeping a tier it cannot serve.
_TTS_TIERS = ("cpu",)

# R19 follow-up / ruling R25 (2026-09-01, task 8): the first real Vulkan TTS
# contact — CI's Linux lanes are headless (no GPU), so accel auto-detection
# had only ever fallen back to CPU there; this is a GB10 (NVIDIA GB10,
# aarch64, manylinux_2_39_aarch64) dev box with a real Vulkan device. Built
# `native/ci/build.sh vulkan manylinux_2_39_aarch64` locally (ctest 4/4,
# native/python/tests + native/tests/parity: 23 passed/2 xfailed/4 failed at
# the time — since fixed by slice-5b task 2, which pinned the parity
# candidate to the CPU device (device=NULL was resolving to the GPU on a
# Vulkan stage) and keyed the nosve cache per source; the vulkan stage now
# runs 13 passed/3 skipped like the cpu one). Then, per family, in its OWN
# subprocess (a GGML abort is an uncatchable SIGABRT — isolating per family
# means one family's crash can't take down the others or the other four
# results, same precedent as test_tts_parity.py's `_run_candidate`
# subprocess isolation): loaded with the EXPLICIT Vulkan device
# (`sokuji_native.devices()`, kind == "vulkan" — "Vulkan0" / NVIDIA GB10),
# did the family's normal voice setup (supertonic/pocket: `set_preset`;
# qwen3_tts/omnivoice: `set_voice` cloning a reference clip synthesized by
# supertonic on the CPU device first, with that clip's own text as
# `ref_text`), synthesized "The quick brown fox jumps over the lazy dog.",
# and whisper-tiny (CPU device) transcribed the result. PASS bar: clean exit
# + transcript contains "quick"/"fox" + audio duration in [0.5s, 30s].
#
# All five families PASSED the crash/correctness bar — supertonic's Metal
# "unsupported op" abort above does NOT reproduce on Vulkan (ggml-vulkan's op
# coverage differs from ggml-metal's here). Per-family wall time is
# tts_load()+synth() together (same measurement the CPU-lane numbers below
# use, cited from task-7-report.md's loopback table, same box/build):
#   moss_tts_nano: 3.92s audio, 5.62s wall vulkan (cpu 15.03s) -> gpu-vulkan
#   supertonic:    3.10s audio, 14.45s wall vulkan (cpu 14.50s) -> gpu-vulkan.
#                  That ~1.0x is a MEASUREMENT ARTEFACT, not parity: 99% of
#                  the wall was model load, a device-independent CPU-side path
#                  (.superpowers/vulkan-perf-investigation.md, Q1). Split at
#                  n_threads=8: load 14.0s on BOTH devices, synth 0.097s
#                  vulkan vs 0.981s cpu = 10.1x on this short text and 19.0x
#                  on a 2-chunk 380-char one (each chunk 17-20x), with the GPU
#                  83% busy under vulkan synth and 2% under cpu synth
#   qwen3_tts:     3.04s audio, 7.19s wall vulkan (cpu 29.03s) -> gpu-vulkan
#   omnivoice:     2.48s audio, 6.69s wall vulkan (cpu 43.81s) -> gpu-vulkan
#   pocket_tts:    2.72s audio, 1.94s wall vulkan (cpu 1.31s production
#                  chain, task-7's number) -> gpu-vulkan (ruling R29,
#                  superseding R28). R28 briefly pinned this family
#                  cpu-only on that single, cross-session, not-apples-to-
#                  apples comparison (a raw vulkan probe vs. a different
#                  session's heavier production-chain cpu number). A
#                  controlled re-measurement (one warm-up call + 4 timed
#                  tts_load()+synth() runs, same call shape, both devices)
#                  showed a 5-9x GPU speedup instead: vulkan 0.42-0.46s
#                  (tight) vs cpu 2.46-4.22s (noisy) — and even the original,
#                  most favorable-to-cpu figure (1.31s) still loses to
#                  Vulkan's worst run by ~3x. The cpu-side run-to-run variance
#                  is now explained (vulkan-perf-investigation.md, Q2): it was
#                  thread OVERSUBSCRIPTION against ggml's spin-wait barrier at
#                  n_threads=nproc(=20). Held at n_threads=8 it is tight (cpu
#                  1.014s vs vulkan 0.234s synth = 4.3x). No measurement in
#                  either round has cpu winning, so R29 restores gpu-vulkan.
#
# The old caveat here — "ggml's scheduler may have silently fallen individual
# ops back to CPU, so a clean run is only a BEHAVIORAL pass" — is retracted:
# `ggml_backend_sched` has ZERO hits in native/src, native/include and
# audiocpp-src/{src,include,app,tools,tests}, i.e. in every line that is
# compiled into libsokuji_native. (It does appear under
# audiocpp-src/external/ggml — audio.cpp's own bundled ggml fork, which this
# project does not build. Those hits are ggml's OWN scheduler, in files this
# build never compiles: 3 example programs that drive it
# (examples/{gpt-2/main-sched.cpp, mnist/mnist-common.h,
# simple/simple-backend.cpp}) plus tests/test-opt.cpp, the
# include/ggml-{backend,cpp,opt}.h declarations, and the two IMPLEMENTATION
# files behind them, src/ggml-{backend,opt}.cpp — an earlier version of this
# footnote called that whole tail "declarations", which understated it.) So a
# session holds exactly
# ONE backend and an op Vulkan cannot service ABORTS ("Missing op" ->
# GGML_ABORT), exactly as Metal did. A clean run is therefore proof the graph
# ran on the GPU. Per-dispatch streaming overhead is ruled out too: the
# advantage WIDENS with more chunks.
#
# The 14s load was a real defect, and it is fixed (native 0.6.1): ggml 0.22.0
# read GGUF array KVs one element at a time — one locked fread each — and
# audio.cpp reopens a model GGUF 14 times per load, so supertonic's 57MB
# `audiocpp.embedded_files.data` sidecar KV cost ~800M freads. With
# native/patches/ggml-gguf-bulk-array-read.json: supertonic load 13.85s ->
# 1.50s, omnivoice 3.85 -> 1.42, qwen3 2.35 -> 1.21, moss 0.93 -> 0.19,
# pocket 0.16 -> 0.14 (GB10, cpu lane, n_threads=12; see native/README.md
# "GGUF array reads"). Every wall figure in the table above is PRE-fix.
#
# Fleet validation on real GPUs, 2026-09-02 — 5/5 families everywhere (clean
# exit, whisper-checked transcript, duration in bar). Long form in
# .superpowers/{vulkan-perf-investigation,windows-vulkan-validation,
# linux-x64-vulkan-validation,metal-fix-experiments}.md and the slice-5b
# task-1 report. Speedups are warm SYNTH, GPU vs cpu device on the same box.
# The CPU side of a ratio depends on the thread count, and these four runs did
# NOT share one, so each row carries its own — only linux-x64 ran at the
# measured knee (ruling R32: n_threads=0 -> min(hw, 12); the knee is 12 and
# only 12). Any cross-row comparison of the CPU columns is invalid:
#
#   lane         GPU                                    result  cpu threads  synth speedup
#   linux-arm64  NVIDIA GB10, Vulkan                    5/5      8           4.3-19x
#   win-x64      RTX 4070 SUPER, Vulkan (Win 11)        5/5     28 (hw)      14-56x
#   linux-x64    RTX 4070 SUPER, Vulkan (Ubuntu 22.04)  5/5     12 (knee)    7.5-65.8x
#   mac-arm64    Apple M4, Metal                        5/5      unrecorded  1.3-3.9x
#
# The win-x64 row predates R32 entirely — it is the 0.5.0 CI wheel, whose
# sk_init logged "28 threads" (= hw), so its CPU numbers are the pessimistic
# oversubscribed ones and its ratios are, if anything, flattering to the GPU.
# The GB10 row is n_threads=8, the value that sweep found optimal on that
# 20-core big.LITTLE box before the knee was fixed at 12 fleet-wide. The M4
# probe did not record a thread count at all. The mac row's lower bound was
# briefly written as 0.83x (i.e. "Metal loses to CPU on pocket_tts"); that
# came from a single-shot pocket measurement and was RETRACTED in task 1's
# fix round — the controlled rerun on the same box put pocket at 0.25s Metal
# vs 0.39s CPU, so 1.3x is the honest floor and no family is slower on Metal.
#
# The mac row holds only AFTER slice-5b task 1's two Metal kernel patches
# (before them moss/qwen3/omnivoice aborted): the resurrected
# GGML_OP_DIAG_MASK_INF/PAD kernels (ruling R30 — native/patches/ggml-metal-
# diag-mask-inf.json, and a leading-pad spec beside it until ggml 0.26.0 took that
# kernel upstream) plus audiocpp_compat.h's ggml_sub now
# ggml_cont-ing src1 too (Metal wants both operands row-contiguous) took the
# M4 from 2/5 aborting to 5/5 clean.
#
# Ruling R36 (2026-09-02, slice-5b task 10) supersedes R31's deferral above:
# gpu-metal is RESTORED for all five families on the strength of that M4
# (Apple9) evidence. R31 held tiers back pending a CI mac-arm64 run to
# confirm an M1; that run happened (native-build.yml dry run round 2) and
# could NOT confirm or deny an M1 either way, for a hardware reason, not a
# code reason: GitHub's macos-14 arm64 runner is a VM whose Metal device
# reports as "Apple Paravirtual device", which lacks has_simdgroup_reduction
# (ggml-metal-device.m:1044-1045 requires MTLGPUFamilyApple7 or Metal3).
# ggml gates GGML_OP_NORM/RMS_NORM/ARGMAX on that capability, so every
# family that normalizes (all five) aborts there ("unsupported op 'NORM'",
# run 33581291942) regardless of which macOS or Xcode version the runner
# carries. That paravirtual GPU is not evidence about real Apple silicon in
# either direction — it is a virtualization shim the CI vendor puts in front
# of every hosted macOS VM, not a downlevel real GPU, and (retroactive
# correction to R19 above) it is also almost certainly what produced R19's
# original "supertonic aborts on Metal" contact: the slice-4 dry run used
# the same runner class.
#
# The capability gates our Metal kernels/shims actually consult are Apple7
# (simdgroup reduction and simdgroup matrix-multiply — what the resurrected
# diag-mask-inf/pad kernels and the ops they unblock need) and Apple6
# (bfloat — three of the five checkpoints carry BF16 tensors). Every real
# Mac from the M1 onward satisfies both: the M1/M2/M3 GPU family is Apple7
# (M1 is also where Apple's Metal bfloat support began), and the M4 tested
# here is Apple9, a strict superset. Intel Macs are unaffected either way —
# they have no eligible Metal compute device at all and build the `none`
# lane (CPU only; no gpu-metal tier is ever reachable there, paravirtual or
# real).
#
# What this evidence does NOT include: no real M1, M2, or M3 has run this
# suite — the M4 is the only real-hardware data point, and CI's own Metal
# lane structurally cannot supply one (see above), so this gap cannot close
# via CI. R36 accepts it deliberately: the gates that matter are
# architectural (Apple7/Apple6), not M4-specific, so satisfying them is the
# bar this ruling relies on, not "measured on every generation". A future
# real M1/M2/M3 check is a slice-6 nice-to-have, not a blocker. If one ever
# aborts on a kernel here despite reporting Apple7, that is new information
# this ruling did not have, and the fix is cheap and scoped: drop that one
# family's gpu-metal row back out of `_TTS_TIER_OVERRIDES`.
#
# native/python/tests/test_sokuji_native.py::test_tts_synthesises_on_a_gpu_device
# skips outright when the resolved device's description matches
# /paravirtual/i, precisely so a future CI run reports "skipped" there
# instead of a green pass that would misrepresent a VM shim as validating
# real Metal hardware. The PLANNER refuses that device for real, too:
# `planner._tier_available("gpu-metal", ...)` drops the tier when every Metal
# device the probe reports has a /paravirtual/i description, so a virtualized
# Mac (CI, or a user in a VM) resolves these cards cpu-only instead of being
# handed a plan that aborts the process.
#
#   lane        macOS runner GPU               tier decision
#   mac-arm64   Apple Paravirtual device       gpu-metal restored anyway (R36,
#                                               on M4 real-hardware evidence —
#                                               this GPU cannot confirm OR
#                                               deny it; see above)
#
# First-ever synth on an NVIDIA box additionally pays a one-time, per-machine
# driver pipeline-cache compile of 2-14s (W-1, linux-x64-vulkan-validation.md);
# the load-time warm-up synth (R33) absorbs it.
#
# WHICH QUANT those fleet runs loaded, and the gap that closed on 2026-09-02:
# every row in the table above loaded the card's DEFAULT rung (q8_0; f16 for
# supertonic). That is not what a GPU machine actually resolves — `resolve_tts`
# auto runs `_llamacpp_variant_row`, which picks the LARGEST quant that fits the
# device budget, so on every GPU fixture in test_characterization.py
# (CUDA_12GB/CUDA_24GB/APPLE_SILICON) the recommended and resolved rung is
# **bf16** for the four families that ship one. BF16 is a distinct ggml tensor
# type with its own per-backend kernel coverage, so those green q8_0 runs said
# nothing about the rung users would actually get. The bf16 rungs are now
# validated directly, same bar as the table above (clean exit, non-silent audio
# of a sane duration), via the second `quant` dimension of
# test_tts_synthesises_on_a_gpu_device:
#
#   family          bf16 rung shipped   GB10/Vulkan   M4/Metal
#   moss_tts_nano   yes                 PASS          PASS
#   pocket_tts      yes                 PASS          PASS
#   qwen3_tts       yes (0.6b tested)   PASS          PASS
#   omnivoice       yes                 PASS          PASS
#   supertonic      NO (f16 only)       n/a           n/a
#
# 4/4 on both devices, so no family loses its bf16 GPU rung; the ladders below
# are unchanged. qwen3-tts-1.7b was not loaded — same family and graph as the
# 0.6b that was, though its rungs hold no f32 matrix where the 0.6b's do. Numbers:
# .superpowers/sdd/2026-09-02-sidecar-ggml-only-slice5b-debt/final-fixwave-report.md.
_TTS_TIER_OVERRIDES: dict[str, tuple[str, ...]] = {
    "moss_tts_nano": ("gpu-vulkan", "gpu-metal", "cpu"),
    "supertonic": ("gpu-vulkan", "gpu-metal", "cpu"),
    "qwen3_tts": ("gpu-vulkan", "gpu-metal", "cpu"),
    "omnivoice": ("gpu-vulkan", "gpu-metal", "cpu"),
    "pocket_tts": ("gpu-vulkan", "gpu-metal", "cpu"),   # ruling R29 (supersedes R28) -- see table above
    # The four added 2026-09-03. Measured per lane with the native-1.0.2 wheels
    # (the first build to compile these four -- AUDIOCPP_MODELS gained them there;
    # 1.0.1 cannot load them at all). requirements.txt pinned 1.0.1 when this was
    # measured and has since moved on (1.0.2 with sidecar-v0.2.1, 1.1.0 with
    # sidecar-v0.3.0) in the release order native/README.md sets out: tag, then pin.
    # Warm RTF = synth / audio, so <1 is faster than speech:
    #                GB10 Vulkan   M4 Metal   M4 CPU
    #   voxcpm1          0.47         0.91      1.55
    #   voxcpm2          0.63         1.42      3.27
    #   irodori_tts      0.28         0.97      2.32
    #   index_tts2       0.45         1.77      4.94
    # Vulkan clears real time for all four. Metal does not for voxcpm2 and
    # index_tts2 -- but it still beats the same machine's CPU by 1.7-2.8x, and a
    # tier list says what CAN run, not what is worth choosing. Keeping Metal shut
    # would only push a Mac onto the slower path. Which device and which quant a
    # machine SHOULD use is the planner's and the download recommendation's
    # decision (jiangzhuo's ruling, 2026-09-03).
    "voxcpm1": ("gpu-vulkan", "gpu-metal", "cpu"),
    "voxcpm2": ("gpu-vulkan", "gpu-metal", "cpu"),
    "irodori_tts": ("gpu-vulkan", "gpu-metal", "cpu"),
    "index_tts2": ("gpu-vulkan", "gpu-metal", "cpu"),
}

# RAM a CPU load needs per byte of the rung (ram_factor): the card's measured CPU peak RSS over its
# default rung's est_bytes, rounded UP to one decimal, where that is above 1.2x or at most 0.9x (a
# flat 1.0 would refuse a machine that could load a card needing less than its file). The peak is
# product-shaped (ruling 2026-10-09): `/usr/bin/time -v` on one process that synthesises a short
# warm-up sentence, then a 21-word sentence (Japanese cards: a 40-character one; VoiceTut: a
# 15-word Arabic one), bare, and in a second process with a 3.1 s reference clip for a card that
# clones; the larger of the two governs. A card with no measured peak, or one between 0.9x and
# 1.2x, keeps 1.0 and is not listed; another rung of a card uses the card's factor. These are CPU
# measurements: a Metal plan is judged at 1.0 whatever the card lists (accel.load_with_fallback;
# the M4 ran moss-tts-local bare on Metal at about 8.7 GiB, where a bare CPU synth peaked at
# 13,060,424 kB).
_TTS_RAM_FACTORS: dict[str, float] = {
    "cosyvoice3": 1.3,              # 2,652,720 kB, 21 words, 3.1 s clip, on 2,257,658,080 B (1.203x)
    "moss-tts-local-1.5": 2.6,      # 18,521,960 kB, 21 words, 3.1 s clip, on 7,512,220,768 B (2.52x)
    "vibevoice-1.5b": 1.3,          # 4,066,124 kB, 21 words, 3.1 s clip, on 3,224,701,538 B (1.29x)
    "chatterbox": 1.5,              # 2,914,832 kB, 21 words, 3.1 s clip, on 2,088,393,668 B (1.43x)
    "chatterbox-turbo": 6.4,        # 4,338,656 kB, 21 words, bare, on 699,101,408 B (6.35x)
    "confucius4": 0.9,              # 6,776,376 kB, 21 words, 3.1 s clip, on 8,192,757,760 B `orig` (0.85x)
    "magpie-357m": 0.9,             # 1,312,452 kB, 21 words, bare, on 1,562,142,912 B (0.86x)
    "neutts-2e": 0.9,               # 2,539,620 kB, 21 words, bare, on 3,016,181,288 B `orig` (0.86x)
    "qwen3-tts-1.7b-customvoice": 1.5,  # 4,074,512 kB, 21 words, preset Vivian, on 2,817,044,064 B (1.48x)
    "irodori-tts-500m-v3": 2.6,     # 2,720,656 kB, 40 characters, 3.1 s clip, on 1,093,739,584 B (2.55x)
    "irodori-tts-v4.1-anime": 2.7,  # 2,927,036 kB, 40 characters, 3.1 s clip, on 1,112,547,264 B (2.69x)
    "higgs-audio-v3-4b": 1.3,       # 6,369,076 kB, 21 words, 3.1 s clip, on 5,095,354,048 B (1.28x)
    "fish-audio-s2-pro": 1.5,       # 8,771,944 kB, 21 words, 3.1 s clip, on 6,317,911,232 B (1.42x)
    "audio8-tts-0.6b": 2.2,         # 2,948,800 kB, 21 words, bare, on 1,429,545,312 B (2.11x)
    "soprano-1.1-80m": 4.6,         # 544,772 kB, 21 words, bare, on 123,162,336 B (4.53x)
    "outetts-1.0-1b": 1.5,          # 4,216,684 kB, 21 words, 3.1 s clip, on 3,029,895,456 B (1.43x)
    "echo-tts": 2.1,                # 6,110,784 kB, 21 words, 3.1 s clip, on 3,028,207,456 B (2.07x)
    "kitten-tts2": 1.4,             # 4,353,760 kB, 21 words, 3.1 s clip, on 3,282,123,776 B (1.36x)
    "voicetut-tts": 1.4,            # 1,816,688 kB, 15 Arabic words, 3.1 s clip, on 1,350,264,224 B (1.38x)
    "miotts-1.7b": 2.0,             # 4,687,080 kB, 21 words, 3.1 s clip, on 2,496,393,216 B package (1.92x)
}


def _repo_path(path: str) -> bool:
    """A path inside a Hub repo: not empty, no leading, trailing or doubled slash, no '.' or
    '..' segment."""
    return bool(path) and all(seg not in ("", ".", "..") for seg in path.split("/"))


def _tts_gguf_row(mid, name, langs, family, dir_, quants, default_quant, *,
                  order, load_language="", clones=False, streaming=False,
                  sample_rate=24000, named_voices=False, transcript_required=False,
                  recommended=False, extra_files=(), license=None,
                  repo=_AUDIOCPP_GGUF_REPO, companions=None, voice_required=None, presets=(),
                  default_preset="", rung_dtypes=None, tiers=None):
    """One native_tts card. `quants` maps QUANT token (the filename's own
    suffix, e.g. "q8_0") -> (filename, bytes) under `dir_` in `repo`: audio.cpp's
    official mirror unless the card names a third-party repo, which must be pinned
    in PINNED_REVISIONS (ruling 4). `dir_=""` is the repo's root, so the artifact
    is "repo/file", never "repo//file". `default_quant` gets rank 2.0, any other
    listed quant gets rank 1.0 — exactly `_llm_translate_row`'s two-rung shape,
    INCLUDING that shape's quant-picking semantics (fix round 1: this is not
    simply "the curated default always wins"): `default_quant` is the RANK
    default — the pin-absent/no-budget-known/nothing-fits fallback
    (`planner._llamacpp_quant`) — while `resolve_tts`'s real auto path
    (`_llamacpp_variant_row`) picks the LARGEST quant that fits the machine's
    budget, which is routinely the bigger, rank-1.0 alt quant (e.g. bf16 over
    the "default" q8_0) once it fits.

    `companions` maps a QUANT token to the (repo-relative path, bytes) of the
    files that rung needs beside its main GGUF, in another folder of the repo
    (MioTTS's codec) or at its root (LFM2.5-Audio's mmproj/vocoder/tokenizer).
    They ride that rung's Deployment and count in its est_bytes, so the planner
    fits the whole package against device memory. `extra_files` are
    (relative-to-`dir_` filename, bytes) sidecar assets sk_tts_presets discovers
    next to the loaded gguf (only pocket-tts-en has one:
    embeddings/alba.safetensors) — downloaded alongside every quant and counted
    once in size_bytes, which is the default rung's package plus them.
    `voice_required` is None for the family's rule (VOICE_REQUIRED_FAMILIES) or the
    card's own; `presets` are the names the card offers when the native layer cannot
    list them (named_voices must be set; supertonic and pocket_tts, which it lists,
    carry none), and `default_preset`, one of them, is what the sidecar applies right
    after load (spec stage 2.3). Tiers come
    from `_TTS_TIER_OVERRIDES.get(family, _TTS_TIERS)` — cpu-only by default,
    gpu-vulkan and gpu-metal added back per family once GB10/M4-validated (see
    that dict's own comment, R19/R25/R36) — unless the card passes its own `tiers`:
    a new card of a family that already has GPU tiers starts on `_TTS_TIERS` and
    gains a GPU tier per lane only from a fleet run of that card (R19, per card). Its
    `ram_factor` is `_TTS_RAM_FACTORS.get(mid, 1.0)`.

    `rung_dtypes` maps a QUANT token to the ggml dtypes of the matrix tensors of
    that rung's published main GGUF and companion GGUFs together
    (benchmark/qwen3-asr-webgpu/hub_matrix_dtypes.py reads them without a
    download): the set its pre-download op-coverage query expands WEIGHT over, in
    place of the label's RUNG_FALLBACK_DTYPES entry."""
    # A rung without a RUNG_FALLBACK_DTYPES entry would query op coverage over {f32} alone
    # before its file is on disk (accel.weight_dtypes): loud at import, as _tc_row is.
    unknown_rungs = sorted(set(quants) - set(RUNG_FALLBACK_DTYPES))
    if unknown_rungs or default_quant not in quants:
        raise ValueError(f"{mid}: quants keys must have a RUNG_FALLBACK_DTYPES entry and include "
                         f"default {default_quant!r}; unknown={unknown_rungs}, keys={sorted(quants)}")
    companions = dict(companions or {})
    unknown = sorted(set(companions) - set(quants))
    if unknown:
        raise ValueError(f"{mid}: companions for quants the card does not ship: {unknown}")
    rung_dtypes = {q: frozenset(dts) for q, dts in (rung_dtypes or {}).items()}
    unknown = sorted(set(rung_dtypes) - set(quants))
    if unknown:
        raise ValueError(f"{mid}: rung_dtypes for quants the card does not ship: {unknown}")
    empty = sorted(q for q, dts in rung_dtypes.items() if not dts)
    if empty:
        raise ValueError(f"{mid}: rung_dtypes has an empty set for {empty}")
    not_weight = sorted({t for dts in rung_dtypes.values() for t in dts} - WEIGHT_CAPABLE_DTYPES)
    if not_weight:
        raise ValueError(f"{mid}: rung_dtypes holds types a WEIGHT tensor cannot: {not_weight}")
    # No wider than gen_ops_data.py's WIDEST_FALLBACK (== len(RUNG_FALLBACK_DTYPES["q4_k_m"]),
    # pinned by test_widest_fallback_matches_gen_ops_data), which sizes the build's
    # SK_OP_COVERAGE_MAX static_assert. Not bounded by the label's own fallback set: a rung's set
    # is the matrix dtypes of its main GGUF and its companion GGUFs together, as
    # accel.weight_dtypes reads them after the download.
    widest = len(RUNG_FALLBACK_DTYPES["q4_k_m"])
    for q, dts in rung_dtypes.items():
        if len(dts) > widest:
            raise ValueError(f"{mid}: rung_dtypes[{q!r}] holds {len(dts)} dtypes, wider than "
                             f"gen_ops_data.py's WIDEST_FALLBACK ({widest}): {sorted(dts)}")
    paths = ([dir_] if dir_ else []) + [fname for fname, _n in quants.values()]
    paths += [rel for comps in companions.values() for rel, _n in comps]
    bad = sorted(p for p in paths if not _repo_path(p))
    if bad:
        raise ValueError(f"{mid}: not a path inside {repo}: {bad}")
    presets = tuple(presets)
    if presets and not named_voices:
        raise ValueError(f"{mid}: a card with presets must set named_voices=True")
    if presets and family in ("supertonic", "pocket_tts"):
        # sk_tts_presets lists these two families' presets completely, and the native layer
        # refuses any other name for them: a card's own list would only drift from it.
        raise ValueError(f"{mid}: the native layer lists {family}'s presets itself; "
                         "a card of it must not carry presets")
    if default_preset and not presets:
        raise ValueError(f"{mid}: default_preset {default_preset!r} needs the card's own presets, "
                         "the names the backend checks it against")
    if default_preset and default_preset not in presets:
        raise ValueError(f"{mid}: default_preset {default_preset!r} is not one of its presets {presets}")
    required = (family in VOICE_REQUIRED_FAMILIES) if voice_required is None else bool(voice_required)
    if default_preset and required:
        raise ValueError(f"{mid}: a default preset makes the card speak from load; "
                         "voice_required must be False")
    deps = []
    tiers = _TTS_TIER_OVERRIDES.get(family, _TTS_TIERS) if tiers is None else tuple(tiers)
    prefix = f"{repo}/{dir_}/" if dir_ else f"{repo}/"
    order_keys = [default_quant] + [q for q in quants if q != default_quant]
    for i, q in enumerate(order_keys):
        fname, nbytes = quants[q]
        comps = tuple(companions.get(q, ()))
        est = nbytes + sum(sz for _p, sz in comps)
        rank = 2.0 if i == 0 else 1.0
        deps += [Deployment("native_tts", tier, q, prefix + fname, rank, est_bytes=est,
                            companions=comps)
                 for tier in tiers]
    total_bytes = deps[0].est_bytes + sum(sz for _n, sz in extra_files)
    return TtsModel(mid, name, langs, tuple(deps), family=family,
                    load_language=load_language, clones=clones, streaming=streaming,
                    sample_rate=sample_rate, named_voices=named_voices,
                    transcript_required=transcript_required, recommended=recommended,
                    sort_order=order, size_bytes=total_bytes, extra_files=extra_files,
                    license=license, graph_family=family, voice_required=required,
                    presets=presets, default_preset=default_preset,
                    rung_dtypes=tuple((q, rung_dtypes[q]) for q in order_keys if q in rung_dtypes),
                    ram_factor=_TTS_RAM_FACTORS.get(mid, 1.0))


SUPERTONIC_LANGS = ("en", "ko", "ja", "ar", "bg", "cs", "da", "de", "el", "es", "et",
                    "fi", "fr", "hi", "hr", "hu", "id", "it", "lt", "lv", "nl", "pl",
                    "pt", "ro", "ru", "sk", "sl", "sv", "tr", "uk", "vi")

# Higgs Audio v3: audio.cpp exposes "100+ languages" with no list (model_specs/
# higgs_audio_tts.json); the vendor's card names 102, in two tiers, all under 10% WER/CER.
# These are the ones the Local Native language picker can offer (getLocalInferenceLanguages,
# read 2026-10-06), as app codes: Tagalog is "fil". A language the picker cannot offer would
# be unreachable on this card anyway. The engine reads no language (its loader reports only
# "Auto"), so this tuple is the picker's gate and nothing more.
HIGGS_LANGS = ("af", "ar", "az", "bg", "bn", "bs", "ca", "cs", "cy", "da", "de", "el", "en",
               "es", "et", "fa", "fi", "fil", "fr", "gl", "gu", "he", "hi", "hr", "hu", "id",
               "is", "it", "ja", "jv", "ka", "kk", "kn", "ko", "lb", "lt", "lv", "mk", "ml",
               "mn", "mr", "ms", "mt", "ne", "nl", "no", "pl", "ps", "pt", "ro", "ru", "sk",
               "sl", "so", "sq", "sr", "sv", "sw", "ta", "te", "th", "tr", "uk", "ur", "uz",
               "vi", "zh")

# Fish Audio S2 Pro: audio.cpp exposes "80+ languages" with no list (model_specs/
# fish_audio.json); the vendor's card names 83. These are the ones the Local Native language
# picker can offer (getLocalInferenceLanguages, read 2026-10-06), as app codes: Tagalog is
# "fil" and the card's Javanese "jw" is "jv". The engine reads no language (its loader reports
# en/zh/auto), so this tuple is the picker's gate and nothing more.
# ml dropped (ruling 2026-10-06): 2026-10-08 loopback sweep, CER 1.00 / 1.16, no Malayalam heard.
# he dropped (ruling 2026-10-06): 2026-10-08 loopback sweep, CER 0.51 / 0.32 / 0.38, 1 pass in 3.
FISH_LANGS = ("af", "am", "ar", "az", "bg", "bn", "bs", "ca", "cs", "cy", "da", "de", "el",
              "en", "es", "et", "fa", "fi", "fil", "fr", "gl", "gu", "hi", "hr", "hu",
              "id", "is", "it", "ja", "jv", "ka", "kk", "km", "kn", "ko", "lt", "lv",
              "mn", "mr", "ms", "my", "ne", "nl", "no", "pl", "ps", "pt", "ro", "ru", "si",
              "sk", "sl", "sq", "sr", "sv", "sw", "ta", "te", "th", "tr", "uk", "ur", "vi",
              "zh")

# Kitten TTS 2's voices as its vendor card lists them (KittenML/kitten-tts-2, "Voices": 47).
# The GGUF's embedded voices.json holds a 48th, PreparedBruno, which the vendor does not list.
# audio.cpp exposes no enumerator for them, so the card carries the names (TtsModel.presets).
KITTEN_TTS2_VOICES = (
    "Bella", "Jasper", "Luna", "Bruno", "Rosie", "Hugo", "Kiki", "Leo", "Matthew", "Elliot",
    "Willow", "Dolores", "Victor", "Dante", "Alfred", "Saoirse", "Claire", "Raven", "Marcus",
    "Herbert", "Diana", "Laurence", "Maeve", "Walter", "Edith", "Miles", "Grace", "Reginald",
    "Iris", "Frank", "Serena", "Julian", "Eleanor", "Otis", "Vincent", "Martha", "Sable",
    "Victoria", "Arabic", "Hindi", "German", "Spanish", "Italian", "French", "Portuguese",
    "Russian", "Chinese")

# MioTTS's codec: a sibling folder of the same official repo. Every MioTTS rung pairs with this
# q8_0 file (audio.cpp's own default package), and native looks for it at this repo-relative path
# next to the model's folder (native/src/sk_tts_companions.h).
_MIOCODEC_Q8_0 = ("MioCodec-25Hz-44.1kHz-v2-GGUF/miocodec-25hz-44khz-v2-q8_0.gguf", 299066464)

# What both LFM2.5-Audio cards credit beside Liquid AI: its model cards license the audio
# encoder's canary-180m-flash checkpoint and the redistributed Mimi weights under CC-BY 4.0,
# which asks for attribution.
_LFM2_CC_BY_CREDIT = ("Audio encoder based on NVIDIA's canary-180m-flash checkpoint (CC-BY 4.0); "
                      "redistributes Kyutai's Mimi weights (CC-BY 4.0)")

TTS_MODELS: list[TtsModel] = [
    # Offline, clones from a reference clip, no presets (sk_tts_presets() ==
    # []). audio.cpp ships Q8_0 (default) and BF16; languages per
    # model_specs/moss_tts_nano.json (19 — the old catalog's "nl" entry was
    # never in audio.cpp's own list).
    _tts_gguf_row(
        "moss-tts-nano", "MOSS-TTS-Nano (100M)",
        ("ar", "cs", "da", "de", "el", "en", "es", "fa", "fr", "hu", "it",
         "ja", "ko", "pl", "pt", "ru", "sv", "tr", "zh"),
        "moss_tts_nano", "MOSS-TTS-Nano-100M-GGUF",
        {"q8_0": ("moss-tts-nano-100m-q8_0.gguf", 193337984),
         "bf16": ("moss-tts-nano-100m-bf16.gguf", 332423040)},
        default_quant="q8_0", order=0, clones=True, streaming=False,
        sample_rate=48000, recommended=True),
    # Streaming, no cloning, 10 named presets (F1-F5/M1-M5, sk_tts_presets()).
    # audio.cpp's own Q8_0 conversion hits unresolved CUDA copy/layout
    # blockers (docs/gguf.md: "Q8 blockers unresolved") — the repo's
    # "supertonic-3-q8_0.gguf" is in fact a byte-for-byte copy of "-orig.gguf"
    # (same LFS oid), not a real quant. F16 is the smallest WORKING rung, so
    # it is the only quant offered (no ladder) — matches Task 1's CTest model.
    _tts_gguf_row(
        "supertonic-3", "Supertonic 3", SUPERTONIC_LANGS,
        "supertonic", "Supertonic-3-GGUF",
        {"f16": ("supertonic-3-f16.gguf", 312784196)},
        default_quant="f16", order=1, clones=False, streaming=True,
        sample_rate=44100, named_voices=True, recommended=True),
    # Base checkpoint (audio.cpp's dedicated "...-Base-GGUF" folder; the
    # CustomVoice checkpoint, a card of its own below, loads under the same
    # qwen3_tts family_hint): clones from a reference
    # clip, no discoverable presets. ref_text IS mandatory (R15(s4)) — the
    # base checkpoint has no default built-in voice at all (it must always
    # clone) and its ICL clone mode separately requires ref_text one level
    # deeper inside synth() itself, live-verified in task-7-report.md §3; the
    # old comment here ("ref_text optional, unlike the old ONNX qwen3tts_onnx
    # backend") was wrong for this GGUF-native family.
    _tts_gguf_row(
        "qwen3-tts-0.6b", "Qwen3-TTS 0.6B",
        ("zh", "en", "ja", "ko", "de", "fr", "ru", "pt", "es", "it"),
        "qwen3_tts", "Qwen3-TTS-12Hz-0.6B-Base-GGUF",
        {"q8_0": ("qwen3-tts-12hz-0.6b-base-q8_0.gguf", 1991211136),
         "bf16": ("qwen3-tts-12hz-0.6b-base-bf16.gguf", 2516154496)},
        default_quant="q8_0", order=2, clones=True, streaming=False,
        sample_rate=24000, transcript_required=True),
    # Same family, larger checkpoint. audio.cpp's Q8_0 file for this size is
    # named "...q8_0_v2.gguf" (a real, distinct LFS object from a v1 the repo
    # no longer ships) — kept verbatim.
    _tts_gguf_row(
        "qwen3-tts-1.7b", "Qwen3-TTS 1.7B",
        ("zh", "en", "ja", "ko", "de", "fr", "ru", "pt", "es", "it"),
        "qwen3_tts", "Qwen3-TTS-12Hz-1.7B-Base-GGUF",
        {"q8_0": ("qwen3-tts-12hz-1.7b-base-q8_0_v2.gguf", 2695175104),
         "bf16": ("qwen3-tts-12hz-1.7b-base-bf16.gguf", 4203158464)},
        default_quant="q8_0", order=3, clones=True, streaming=False,
        sample_rate=24000, transcript_required=True),
    # Streaming, 600+-language zero-shot cloning; ref_text is mandatory
    # (sk_tts_set_voice), same as qwen3_tts above (R15(s4) made qwen3_tts join
    # this group — omnivoice is no longer the only one).
    # k2-fsa/OmniVoice ships under CC-BY-NC-4.0 — non-commercial only. This
    # descriptor is DATA the download gate reads generically; it isn't a
    # Sokuji-specific restriction.
    _tts_gguf_row(
        "omnivoice-0.6b", "OmniVoice 0.6B", ("multi",),
        "omnivoice", "OmniVoice-GGUF",
        {"q8_0": ("omnivoice-q8_0.gguf", 1350288416),
         "bf16": ("omnivoice-bf16.gguf", 1639548640)},
        default_quant="q8_0", order=4, clones=True, streaming=True,
        sample_rate=24000, transcript_required=True,
        license=License(
            spdx="CC-BY-NC-4.0",
            name="Creative Commons Attribution-NonCommercial 4.0 International",
            url="https://creativecommons.org/licenses/by-nc/4.0/",
            non_commercial=True,
            source_repo=_AUDIOCPP_GGUF_REPO,
            attribution="k2-fsa/OmniVoice")),
    # Pocket TTS (Kyutai CALM): offline, clones from a reference clip, one
    # bundle per load-time language package. Per model_specs/pocket_tts.json's
    # own `packages[]`, only the "english" package's files[] lists a preset
    # asset (embeddings/alba.safetensors, ships "alba" as sk_tts_presets()'
    # one name) — german/italian/portuguese/spanish package specs list ONLY
    # their gguf, even though the audio-cpp/audio.cpp-gguf mirror happens to
    # also host (materially DIFFERENT, verified by LFS content hash — not a
    # copy-paste) embeddings/*.safetensors files under those language
    # directories too; audio.cpp's own package spec is the authority for what
    # ships, so only English gets extra_files/named_voices here — the other
    # four are clone-only BY DESIGN (R9).
    _tts_gguf_row(
        "pocket-tts-en", "Pocket TTS (English)", ("en",),
        "pocket_tts", "PocketTTS-GGUF/english",
        {"q8_0": ("pocket-tts-english-q8_0.gguf", 127856704),
         "bf16": ("pocket-tts-english-bf16.gguf", 219096064)},
        default_quant="q8_0", order=5, load_language="english",
        clones=True, streaming=False, sample_rate=24000, named_voices=True,
        extra_files=(("embeddings/alba.safetensors", 6194424),)),
    _tts_gguf_row(
        "pocket-tts-de", "Pocket TTS (German)", ("de",),
        "pocket_tts", "PocketTTS-GGUF/german",
        {"q8_0": ("pocket-tts-german-q8_0.gguf", 127857184),
         "bf16": ("pocket-tts-german-bf16.gguf", 219096544)},
        default_quant="q8_0", order=6, load_language="german",
        clones=True, streaming=False, sample_rate=24000),
    _tts_gguf_row(
        "pocket-tts-es", "Pocket TTS (Spanish)", ("es",),
        "pocket_tts", "PocketTTS-GGUF/spanish",
        {"q8_0": ("pocket-tts-spanish-q8_0.gguf", 127858240),
         "bf16": ("pocket-tts-spanish-bf16.gguf", 219097600)},
        default_quant="q8_0", order=7, load_language="spanish",
        clones=True, streaming=False, sample_rate=24000),
    _tts_gguf_row(
        "pocket-tts-it", "Pocket TTS (Italian)", ("it",),
        "pocket_tts", "PocketTTS-GGUF/italian",
        {"q8_0": ("pocket-tts-italian-q8_0.gguf", 127857440),
         "bf16": ("pocket-tts-italian-bf16.gguf", 219096800)},
        default_quant="q8_0", order=8, load_language="italian",
        clones=True, streaming=False, sample_rate=24000),
    _tts_gguf_row(
        "pocket-tts-pt", "Pocket TTS (Portuguese)", ("pt",),
        "pocket_tts", "PocketTTS-GGUF/portuguese",
        {"q8_0": ("pocket-tts-portuguese-q8_0.gguf", 127858368),
         "bf16": ("pocket-tts-portuguese-bf16.gguf", 219097728)},
        default_quant="q8_0", order=9, load_language="portuguese",
        clones=True, streaming=False, sample_rate=24000),
    # ---- 2026-09-03 batch ----------------------------------------------------
    # Four more audio.cpp families. They arrived CPU-ONLY (no _TTS_TIER_OVERRIDES
    # entry, so `_tts_gguf_row` gave each the default `_TTS_TIERS = ("cpu",)`) and
    # earned their gpu-vulkan/gpu-metal rows the same evening (commit 2f2b28bc) the
    # way the first five did -- one fleet run per family per lane (R19), not by analogy with a
    # sibling family. Every byte count below is the exact `lfs.size`
    # from `GET api/models/audio-cpp/audio.cpp-gguf/tree/main/<dir>`, read
    # 2026-09-03, and every family was loaded and synthesized on this repo's CPU
    # lane (linux-arm64) before the row was written.
    #
    # VoxCPM 0.5B (community model in audio.cpp: src/community_models/voxcpm1).
    # Streaming, optional reference clip (continuation-mode cloning), no presets.
    # The repo ships exactly ONE file for it, so there is no quant ladder. 16 kHz
    # is genuinely this family's native rate, not a typo -- it is the lowest of
    # any card here.
    _tts_gguf_row(
        "voxcpm1-0.5b", "VoxCPM 0.5B", ("zh", "en", "ja", "ko"),
        "voxcpm1", "VoxCPM1-GGUF",
        {"q8_0": ("voxcpm-0.5b-q8_0-audiovae-f16.gguf", 847888032)},
        default_quant="q8_0", order=10, clones=True, streaming=True,
        sample_rate=16000),
    # VoxCPM2: the same lineage at 48 kHz across 30 languages
    # (model_specs/voxcpm2.json lists 31 entries; the non-code "zh dialects" one
    # is dropped here because these tuples are BCP-47-ish codes the renderer
    # matches against, not prose). Tagalog is the app's "fil" (the spec's "tl").
    _tts_gguf_row(
        "voxcpm2", "VoxCPM2",
        ("ar", "my", "zh", "da", "nl", "en", "fi", "fr", "de", "el", "he", "hi",
         "id", "it", "ja", "km", "ko", "lo", "ms", "no", "pl", "pt", "ru", "es",
         "sw", "sv", "fil", "th", "tr", "vi"),
        "voxcpm2", "VoxCPM2-GGUF",
        {"q8_0": ("voxcpm2-q8_0.gguf", 2955000480),
         "bf16": ("voxcpm2-bf16.gguf", 4772288288)},
        default_quant="q8_0", order=11, clones=True, streaming=True,
        sample_rate=48000),
    # Irodori-TTS v4 Small: Japanese only (audio.cpp throws "Irodori-TTS language
    # must be ja" for anything else), offline, 48 kHz. Its reference clip is
    # optional -- the request default is no_ref=true, so a bare synth works.
    _tts_gguf_row(
        "irodori-tts-v4-small", "Irodori TTS v4 Small", ("ja",),
        "irodori_tts", "Irodori-TTS-v4-Small-GGUF",
        {"q8_0": ("irodori-tts-v4-small-q8_0.gguf", 1368991360),
         "f16": ("irodori-tts-v4-small-f16.gguf", 1762148352)},
        default_quant="q8_0", order=12, clones=True, streaming=False,
        sample_rate=48000),
    # IndexTTS 2.5: offline, 22.05 kHz, and the first card here whose reference
    # clip is MANDATORY without a transcript -- audio.cpp exposes no built-in voices for it and its
    # request parser refuses without one, so the card's voice_required (its family's rule)
    # makes tts_backend raise a clean error before the native layer. `clones=True` with
    # `transcript_required=False`: it needs the clip, not a transcript of it.
    #
    # bilibili's Model Use License is NOT an OSI licence and is not in the SPDX
    # list, hence the LicenseRef- id. It DOES permit commercial use and
    # redistribution below 100M MAU / RMB 1B revenue, so `non_commercial` is
    # False and the consent modal must not call it non-commercial;
    # `requires_consent` is what actually raises the gate (see License's own
    # comment). Terms worth the acknowledgement: the MAU/revenue ceiling, the
    # prohibition on high-risk uses, and the ban on using outputs to train other
    # models.
    _tts_gguf_row(
        "index-tts2.5", "IndexTTS 2.5", ("zh", "en", "ja", "es", "ar"),
        "index_tts2", "IndexTTS2.5-GGUF",
        {"q8_0": ("index-tts2_5-q8_0.gguf", 3502955328),
         "f16": ("index-tts2_5-f16.gguf", 4547355072)},
        default_quant="q8_0", order=13, clones=True, streaming=False,
        sample_rate=22050,
        license=License(
            spdx="LicenseRef-bilibili-Model-Use-License",
            name="bilibili Model Use License",
            url="https://huggingface.co/IndexTeam/IndexTTS-2/blob/main/LICENSE",
            non_commercial=False,
            source_repo=_AUDIOCPP_GGUF_REPO,
            attribution="bilibili IndexTeam")),
    # ---- 2026-10-06 roster expansion -----------------------------------------
    # New audio.cpp families, and new cards on families already compiled in. A new family
    # arrives cpu-only (no _TTS_TIER_OVERRIDES entry, so `_tts_gguf_row` gives it the default
    # `_TTS_TIERS = ("cpu",)`) and earns its GPU tiers from one fleet run per lane (ruling 8);
    # a new card on an already-tiered family (qwen3_tts, irodori_tts) carries that family's
    # tiers. None is recommended until measured (ruling 7). Byte counts are the exact
    # `lfs.size` from `GET api/models/audio-cpp/audio.cpp-gguf/tree/main/<dir>`, read
    # 2026-10-06. A rung above 10 GB is left out, as ruling 2 leaves out families above it.
    #
    # CosyVoice 3 (Fun-CosyVoice3-0.5B-2512): clone-only; the transcript is optional
    # (zero_shot with one, cross_lingual without, native/src/sk_tts.cpp). The vendor's "18+
    # Chinese dialects" are reached through its instruct template, which Sokuji does not
    # send, so the tuple holds its nine languages less ja.
    _tts_gguf_row(
        "cosyvoice3", "CosyVoice 3 (0.5B)",
        # ja dropped (ruling 2026-10-06): 2026-10-08 loopback sweep, CER 0.345 / 0.48, kanji misread.
        ("zh", "en", "ko", "de", "es", "fr", "it", "ru"),
        "cosyvoice3", "CosyVoice3-GGUF",
        {"q8_0": ("cosyvoice3-q8_0.gguf", 2257658080),
         "f32": ("cosyvoice3-f32.gguf", 6995036608)},
        default_quant="q8_0", order=14, clones=True, streaming=False,
        sample_rate=24000,
        rung_dtypes={"q8_0": {"f16", "f32", "q8_0"}, "f32": {"f32"}}),
    # FireRedTTS-3 Base: clone-only, and its continuation prompt needs the clip's transcript.
    # Languages: the vendor's 24, as codes (sk_tts.cpp hands the engine the vendor's tag for
    # each); its 21 Chinese dialect tags have no language code. orig (12.3 GB) is left out.
    _tts_gguf_row(
        "fireredtts3-base", "FireRedTTS-3 Base",
        ("zh", "en", "yue", "ja", "ko", "es", "fr", "ru", "ar", "tr", "id", "pt",
         "it", "nl", "vi", "de", "uk", "th", "pl", "ro", "el", "cs", "fi", "hi"),
        "fireredtts3", "FireRedTTS3-Base-GGUF",
        {"q8_0": ("fireredtts3-base-q8_0.gguf", 4180334848)},
        default_quant="q8_0", order=15, clones=True, streaming=False,
        sample_rate=24000, transcript_required=True,
        rung_dtypes={"q8_0": {"f16", "f32", "q8_0"}}),
    # MOSS-TTS-Local v1.5: speaks with nothing set; a clip is optional and needs no
    # transcript; 48 kHz stereo. Its 31 languages are the vendor's table, with Tagalog as the
    # app's "fil" (audio.cpp's spec calls it "tl"). bf16 (13.4 GB) is left out.
    _tts_gguf_row(
        "moss-tts-local-1.5", "MOSS-TTS-Local v1.5",
        ("zh", "yue", "en", "ar", "cs", "da", "nl", "fi", "fr", "de", "el", "he", "hi", "hu",
         "it", "ja", "ko", "mk", "ms", "fa", "pl", "pt", "ro", "ru", "es", "sw", "sv", "fil",
         "th", "tr", "vi"),
        "moss_tts_local", "MOSS-TTS-Local-v1.5-GGUF",
        {"q8_0": ("moss-tts-local-v1.5-q8_0.gguf", 7512220768)},
        default_quant="q8_0", order=16, clones=True, streaming=False,
        sample_rate=48000,
        rung_dtypes={"q8_0": {"f16", "f32", "q8_0"}}),
    # VibeVoice 1.5B: an optional clip conditions its one speaker (sk_tts.cpp wraps the text
    # as a "Speaker 1:" script); English and Chinese only, per its model card. Microsoft's
    # model card limits it to research use and advises against commercial or real-world use
    # without further testing, so it goes behind the consent gate with the conditional
    # wording, named after those terms rather than the weights' MIT tag so the modal does
    # not call MIT "not an open-source license" (owner's rulings, 2026-10-06). The official
    # pipeline's audible disclaimer and watermark are not part of the audio.cpp port.
    _tts_gguf_row(
        "vibevoice-1.5b", "VibeVoice 1.5B", ("en", "zh"),
        "vibevoice", "VibeVoice-1.5B-GGUF",
        {"q8_0": ("vibevoice-1.5b-q8_0.gguf", 3224701538),
         "bf16": ("vibevoice-1.5b-bf16.gguf", 5420021858)},
        default_quant="q8_0", order=17, clones=True, streaming=False,
        sample_rate=24000,
        rung_dtypes={"q8_0": {"bf16", "f16", "q8_0"}, "bf16": {"bf16"}},
        license=License(
            spdx="LicenseRef-VibeVoice-Model-Card-Terms",
            name="VibeVoice model card terms of use (research use only)",
            url="https://huggingface.co/microsoft/VibeVoice-1.5B",
            non_commercial=False,
            requires_consent=True,
            source_repo=_AUDIOCPP_GGUF_REPO,
            attribution="Microsoft (microsoft/VibeVoice-1.5B)")),
    # Chatterbox (Resemble AI): clone-only, a VoiceCloning session. The vendor lists 23
    # languages; audio.cpp exposes 19 and refuses he/ja/ru/zh, so the card has the 19
    # (ruling 9). English runs its English T3, the rest its multilingual T3.
    _tts_gguf_row(
        "chatterbox", "Chatterbox",
        ("ar", "da", "de", "el", "en", "es", "fi", "fr", "hi", "it", "ko", "ms", "nl", "no",
         "pl", "pt", "sv", "sw", "tr"),
        "chatterbox", "Chatterbox-GGUF",
        {"q8_0": ("chatterbox-q8_0.gguf", 2088393668),
         "f16": ("chatterbox-f16.gguf", 3744360386)},
        default_quant="q8_0", order=18, clones=True, streaming=False,
        sample_rate=24000,
        rung_dtypes={"q8_0": {"f16", "f32", "q8_0"}, "f16": {"f16"}}),
    # Chatterbox Turbo: a community model in audio.cpp (src/community_models/chatterbox_turbo,
    # spec status "testing"), English, one built-in voice; it refuses a clip, so it does not
    # clone. audio.cpp's spec names an f16 package the Hub folder does not hold: q8_0 only.
    _tts_gguf_row(
        "chatterbox-turbo", "Chatterbox Turbo", ("en",),
        "chatterbox_turbo", "Chatterbox-Turbo-GGUF",
        {"q8_0": ("chatterbox-turbo-q8_0.gguf", 699101408)},
        default_quant="q8_0", order=19, clones=False, streaming=False,
        sample_rate=24000,
        rung_dtypes={"q8_0": {"f16", "f32", "q8_0"}}),
    # Confucius4-TTS (NetEase Youdao): clone-only (a VoiceCloning session), no transcript; the
    # vendor's 14 languages less ja, of which en and zh get audio.cpp's dedicated text
    # normalisation and the rest its generic path. Published as one F32 file ("orig").
    _tts_gguf_row(
        "confucius4", "Confucius4-TTS",
        # ja dropped (ruling 2026-10-06): 2026-10-08 loopback sweep, CER 0.39 / 0.45, kanji misread.
        ("zh", "en", "ko", "de", "fr", "es", "id", "it", "th", "pt", "ru", "ms", "vi"),
        "confucius4_tts", "Confucius4-TTS-GGUF",
        {"orig": ("confucius4-tts-orig.gguf", 8192757760)},
        default_quant="orig", order=20, clones=True, streaming=False,
        sample_rate=22050,
        rung_dtypes={"orig": {"f32"}}),
    # Magpie TTS Multilingual 357M (NVIDIA): five baked speakers (named in the vendor card and in
    # the GGUF's speakers.json), chosen through the voice_id option; no cloning in this release.
    # The vendor lists 12 languages and audio.cpp has not ported Japanese, so 11, as the app's
    # codes (audio.cpp's ar-AE/ar-SA/ar-MSA are "ar", its pt-BR is "pt"). The NVIDIA Open Model
    # License permits commercial use under its own terms: the conditional consent wording.
    # No orig rung: its GGUF embeds a spec declaring `speaker`; the engine reads `voice_id` (magpie_tts/request.cpp:34).
    _tts_gguf_row(
        "magpie-357m", "Magpie TTS Multilingual (357M)",
        ("ar", "de", "en", "es", "fr", "hi", "it", "ko", "pt", "vi", "zh"),
        "magpie_tts", "MagpieTTS-Multilingual-357M-GGUF",
        {"q8_0": ("magpie-tts-multilingual-357m-q8_0.gguf", 1562142912)},
        default_quant="q8_0", order=21, clones=False, streaming=False,
        sample_rate=22050, named_voices=True,
        presets=("Aria", "Jason", "John", "Leo", "Sofia"),
        rung_dtypes={"q8_0": {"f16", "f32", "q8_0"}},
        license=License(
            spdx="LicenseRef-NVIDIA-Open-Model-License",
            name="NVIDIA Open Model License",
            url="https://www.nvidia.com/en-us/agreements/enterprise-software/nvidia-open-model-license/",
            non_commercial=False,
            requires_consent=True,
            source_repo=_AUDIOCPP_GGUF_REPO,
            attribution="NVIDIA")),
    # NeuTTS 2E (Neuphonic): English, built-in speakers chosen through the voice_id option, no
    # cloning. The GGUF carries nine speaker prompts; Neuphonic's model card documents four
    # fixed speakers for 2E, and the card offers those four (ruling 9, applied to voices). The
    # NeuTTS Open License allows commercial use below a revenue threshold: the conditional
    # consent wording. One unquantised ("orig") file.
    _tts_gguf_row(
        "neutts-2e", "NeuTTS 2E", ("en",),
        "neutts", "NeuTTS-2E-GGUF",
        {"orig": ("neutts-2e-orig.gguf", 3016181288)},
        default_quant="orig", order=22, clones=False, streaming=False,
        sample_rate=24000, named_voices=True,
        presets=("emily", "paul", "sophie", "steven"),
        rung_dtypes={"orig": {"bf16", "f32"}},
        license=License(
            spdx="LicenseRef-NeuTTS-Open-License-1.0",
            name="NeuTTS Open License v1.0",
            url="https://huggingface.co/neuphonic/neutts-2e/blob/main/LICENSE",
            non_commercial=False,
            requires_consent=True,
            source_repo=_AUDIOCPP_GGUF_REPO,
            attribution="Neuphonic")),
    # KugelAudio 0 Open: four preset voices (default and clear are German, english_female and
    # english_male British English, per its card), no cloning; the vendor's 23 European
    # languages, strongest in es/fr/en/de. The engine reads no language, so the tuple is the
    # picker's gate only. q8_0 is audio.cpp's default package; q4_k is the smaller rung; bf16
    # (17.3 GB) is left out.
    _tts_gguf_row(
        "kugelaudio-0", "KugelAudio 0 Open",
        ("en", "de", "fr", "es", "it", "pt", "nl", "pl", "ru", "uk", "cs", "ro", "hu", "sv",
         "da", "fi", "no", "el", "bg", "sk", "hr", "sr", "tr"),
        "kugelaudio", "KugelAudio-0-Open-GGUF",
        {"q8_0": ("kugelaudio-0-open-q8_0.gguf", 9752398658),
         "q4_k": ("kugelaudio-0-open-q4_k.gguf", 5732997442)},
        default_quant="q8_0", order=23, clones=False, streaming=False,
        sample_rate=24000, named_voices=True,
        presets=("default", "clear", "english_female", "english_male"),
        rung_dtypes={"q8_0": {"bf16", "f16", "q8_0"}, "q4_k": {"bf16", "f16", "q4_K"}}),
    # Qwen3-TTS 1.7B CustomVoice: the qwen3_tts family's CustomVoice checkpoint. Nine built-in
    # speakers (its vendor card's order), no clone path (native/src/sk_tts.cpp reports
    # clones=false for it), so the card needs no voice although qwen3_tts is in
    # VOICE_REQUIRED_FAMILIES: the speaker is mandatory, and default_preset gives it the
    # vendor's first-listed one at load. Every speaker speaks every one of the ten languages.
    # CPU tier only until the fleet runs this card (R19, per card): the qwen3_tts recording is
    # the Base checkpoint's clip synth, not this card's preset graph.
    _tts_gguf_row(
        "qwen3-tts-1.7b-customvoice", "Qwen3-TTS 1.7B CustomVoice",
        ("zh", "en", "ja", "ko", "de", "fr", "ru", "pt", "es", "it"),
        "qwen3_tts", "Qwen3-TTS-12Hz-1.7B-CustomVoice-GGUF",
        {"q8_0": ("qwen3-tts-12hz-1.7b-customvoice-q8_0.gguf", 2817044064),
         "bf16": ("qwen3-tts-12hz-1.7b-customvoice-bf16.gguf", 4179144352)},
        default_quant="q8_0", order=24, clones=False, streaming=False,
        sample_rate=24000, named_voices=True, voice_required=False,
        presets=("Vivian", "Serena", "Uncle_Fu", "Dylan", "Eric", "Ryan", "Aiden",
                 "Ono_Anna", "Sohee"),
        default_preset="Vivian",
        rung_dtypes={"q8_0": {"f16", "f32", "q8_0"}, "bf16": {"bf16"}},
        tiers=_TTS_TIERS),
    # Irodori TTS 500M v3: an older irodori_tts checkpoint (its embedded request contract
    # declares `caption`, not `instruction`; Sokuji sends neither). Japanese only, clip
    # optional, 48 kHz. CPU tier only until the fleet runs this card (R19, per card).
    _tts_gguf_row(
        "irodori-tts-500m-v3", "Irodori TTS 500M v3", ("ja",),
        "irodori_tts", "Irodori-TTS-500M-v3-GGUF",
        {"q8_0": ("irodori-tts-500m-v3-q8_0.gguf", 1093739584),
         "f16": ("irodori-tts-500m-v3-f16.gguf", 1254813120)},
        default_quant="q8_0", order=25, clones=True, streaming=False,
        sample_rate=48000,
        rung_dtypes={"q8_0": {"f16", "f32", "q8_0"}, "f16": {"f16"}},
        tiers=_TTS_TIERS),
    # Irodori TTS v4.1 Anime: v4 Small's architecture and request contract, hosted in the same
    # Hub folder. Japanese only, clip optional, 48 kHz, one q8_0 file, CPU tier only until the
    # fleet runs this card (R19, per card). Carded as MIT by the owner's ruling (2026-10-06):
    # the weights' own repository was unreachable, and the GGUF embeds the MIT v4.1-Small card.
    _tts_gguf_row(
        "irodori-tts-v4.1-anime", "Irodori TTS v4.1 Anime", ("ja",),
        "irodori_tts", "Irodori-TTS-v4-Small-GGUF",
        {"q8_0": ("irodori-tts-v4.1-anime-q8_0.gguf", 1112547264)},
        default_quant="q8_0", order=26, clones=True, streaming=False,
        sample_rate=48000,
        rung_dtypes={"q8_0": {"bf16", "f16", "q8_0"}},
        tiers=_TTS_TIERS),
    # Higgs Audio v3 TTS 4B (Boson AI): an optional clip, its transcript optional too. Boson's
    # Research and Non-Commercial License forbids hosted, SaaS, plug-in, end-user-application
    # and production use without a separate licence, and using it to train other models: the
    # non-commercial consent gate.
    _tts_gguf_row(
        "higgs-audio-v3-4b", "Higgs Audio v3 TTS (4B)", HIGGS_LANGS,
        "higgs_audio_tts", "Higgs-Audio-v3-TTS-4B-GGUF",
        {"q8_0": ("higgs-audio-v3-tts-4b-q8_0.gguf", 5095354048),
         "bf16": ("higgs-audio-v3-tts-4b-bf16.gguf", 8501587648)},
        default_quant="q8_0", order=27, clones=True, streaming=False,
        sample_rate=24000,
        rung_dtypes={"q8_0": {"f16", "q8_0"}, "bf16": {"bf16"}},
        license=License(
            spdx="LicenseRef-Boson-Higgs-TTS-3-Research-Non-Commercial",
            name="Boson Higgs TTS 3 Research and Non-Commercial License",
            url="https://huggingface.co/bosonai/higgs-tts-3-4b/blob/main/LICENSE",
            non_commercial=True,
            requires_consent=True,
            source_repo=_AUDIOCPP_GGUF_REPO,
            attribution="Boson AI (bosonai)")),
    # Fish Audio S2 Pro: an optional clip, which then needs its transcript; 44.1 kHz. The Fish
    # Audio Research License allows research and non-commercial use only (commercial use is a
    # separate licence): the non-commercial consent gate. bf16 (10.2 GB) is left out.
    _tts_gguf_row(
        "fish-audio-s2-pro", "Fish Audio S2 Pro", FISH_LANGS,
        "fish_audio", "Fish-Audio-S2-Pro-GGUF",
        {"q8_0": ("fish-audio-s2-pro-q8_0.gguf", 6317911232)},
        default_quant="q8_0", order=28, clones=True, streaming=False,
        sample_rate=44100, transcript_required=True,
        rung_dtypes={"q8_0": {"bf16", "f16", "f32", "q8_0"}},
        license=License(
            spdx="LicenseRef-Fish-Audio-Research-License",
            name="Fish Audio Research License",
            url="https://huggingface.co/fishaudio/s2-pro/blob/main/LICENSE.md",
            non_commercial=True,
            requires_consent=True,
            source_repo=_AUDIOCPP_GGUF_REPO,
            attribution="Fish Audio (fishaudio)")),
    # Breeze-TTS 2 (BreezeBlue), clone mode only: with a clip it clones and needs the clip's
    # transcript; with none it designs a voice from an instruction, which the app does not offer,
    # so the card itself requires a clip (the engine would not refuse a bare synth, so the
    # family is not in VOICE_REQUIRED_FAMILIES). The two packages audio.cpp's pinned spec
    # lists; the Hub folder's newer q4_0 file is not one of them. The BreezeBlue Research and
    # Non-Commercial License: the non-commercial consent gate.
    _tts_gguf_row(
        "breeze-tts-2", "Breeze-TTS 2", ("zh", "en"),
        "breeze_tts", "Breeze-TTS-2-GGUF",
        {"q8_0": ("breeze-tts-2-q8_0.gguf", 5079668352),
         "bf16": ("breeze-tts-2-bf16.gguf", 7342916800)},
        default_quant="q8_0", order=29, clones=True, streaming=False,
        sample_rate=24000, transcript_required=True, voice_required=True,
        rung_dtypes={"q8_0": {"bf16", "f16", "f32", "q8_0"}, "bf16": {"bf16", "f16"}},
        license=License(
            spdx="LicenseRef-BreezeBlue-Research-Non-Commercial",
            name="BreezeBlue Research and Non-Commercial License",
            url="https://huggingface.co/BreezeBlue/Breeze-TTS-2/blob/main/LICENSE",
            non_commercial=True,
            requires_consent=True,
            source_repo=_AUDIOCPP_GGUF_REPO,
            attribution="BreezeBlue")),

    # ---- 2026-10-06 roster expansion, third-party repos -----------------------
    # Third-party GGUFs come from their own repos, each pinned to one commit in
    # PINNED_REVISIONS (ruling 4); every byte count is the exact Hub size AT that commit.
    # A new family starts CPU-only (no _TTS_TIER_OVERRIDES entry) until the fleet has run it
    # per lane (ruling 8), and no new card is recommended (ruling 7).
    #
    # Audio8 TTS Preview (0.6B), community model, Apache-2.0: offline, 44.1 kHz, a bare synth
    # or an optional clone from a clip plus its exact transcript. Languages: the vendor's
    # eleven recommended ones ("auto" in audio.cpp's spec is not a language).
    _tts_gguf_row(
        "audio8-tts-0.6b", "Audio8 TTS Preview (0.6B)",
        ("yue", "zh", "nl", "en", "fr", "de", "it", "ja", "ko", "pl", "es"),
        "audio8_tts", "",
        {"q8_0": ("audio8-tts-preview-0.6b-q8_0.gguf", 1429545312)},
        default_quant="q8_0", order=30, clones=True, streaming=False,
        sample_rate=44100, transcript_required=True,
        rung_dtypes={"q8_0": {"f16", "f32", "q8_0"}},
        repo="js-byte/Audio8-TTS-Preview-0.6b-GGUF"),
    # Soprano 1.1 (80M), community model, Apache-2.0: English only, offline, 32 kHz, and no voice
    # input of any kind (no clip, no presets). Its spec validates every request option, so
    # sk_tts sends it only the seed.
    _tts_gguf_row(
        "soprano-1.1-80m", "Soprano 1.1 (80M)", ("en",),
        "soprano_tts", "Soprano-1.1-80M-GGUF",
        {"q8_0": ("soprano-1.1-80m-q8_0.gguf", 123162336),
         "bf16": ("soprano-1.1-80m-bf16.gguf", 221809792)},
        default_quant="q8_0", order=31, clones=False, streaming=False,
        sample_rate=32000,
        rung_dtypes={"q8_0": {"f16", "f32", "q8_0"}, "bf16": {"bf16"}},
        repo="WalkingCat/Soprano-1.1-80M-GGUF"),
    # GLM-TTS, community model, MIT (zai-org/GLM-TTS; the hosting repo's apache-2.0 tag is the
    # host's own): Chinese and English, offline, 24 kHz. It cannot speak without a clip AND its
    # exact transcript, so the family is in VOICE_REQUIRED_FAMILIES. mirek190/audio.cpp moves
    # often and hosts GLM-TTS and OuteTTS under one pin; the file mixes Q8_0 and F16 tensors.
    _tts_gguf_row(
        "glm-tts", "GLM-TTS", ("zh", "en"),
        "glm_tts", "Text to audio (TTS)",
        {"q8_0": ("GLM-TTS_Q8.gguf", 5143764640)},
        default_quant="q8_0", order=32, clones=True, streaming=False,
        sample_rate=24000, transcript_required=True,
        rung_dtypes={"q8_0": {"f16", "f32", "q8_0"}},
        repo="mirek190/audio.cpp"),
    # OuteTTS 1.0 (1B), community model: 23 languages (the vendor card's list, which audio.cpp's
    # spec repeats), offline, 24 kHz; a bare synth speaks with a random voice, and a clip clones
    # with its transcript. Licence: CC-BY-NC-SA-4.0 for the fine-tune plus the Llama 3.2
    # Community License for the initial Llama components (OuteAI/Llama-OuteTTS-1.0-1B,
    # "License Information") -- non-commercial, so the download asks for consent.
    _tts_gguf_row(
        "outetts-1.0-1b", "OuteTTS 1.0 (1B)",
        ("ar", "be", "bn", "de", "en", "es", "fa", "fr", "hu", "it", "ja", "ka",
         "ko", "lt", "lv", "nl", "pl", "pt", "ru", "sw", "ta", "uk", "zh"),
        "outetts", "Text to audio (TTS)",
        {"q8_0": ("Llama-OuteTTS-1.0-1B_Q8.gguf", 3029895456)},
        default_quant="q8_0", order=33, clones=True, streaming=False,
        sample_rate=24000, transcript_required=True,
        rung_dtypes={"q8_0": {"bf16", "f16", "f32", "q8_0"}},
        repo="mirek190/audio.cpp",
        license=License(
            spdx="CC-BY-NC-SA-4.0",
            name="Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International "
                 "(the initial Llama components: Llama 3.2 Community License)",
            url="https://creativecommons.org/licenses/by-nc-sa/4.0/",
            non_commercial=True,
            source_repo="mirek190/audio.cpp",
            attribution="OuteAI, Llama-OuteTTS-1.0-1B. Built with Llama")),
    # Echo-TTS (2.8B), community model: English, offline, 44.1 kHz, clone-only -- its engine runs
    # a voice-cloning session and refuses without a clip, but needs no transcript. CC-BY-NC-SA-4.0
    # (jordand/echo-tts-base; the GGUF's general.license agrees) -- non-commercial, consent gate.
    # The vendor's README also asks not to use it to impersonate or deceive.
    _tts_gguf_row(
        "echo-tts", "Echo-TTS (2.8B)", ("en",),
        "echo_tts", "",
        {"q8_0": ("echo-tts-q8_0.gguf", 3028207456),
         "f16": ("echo-tts-f16.gguf", 5546617696)},
        default_quant="q8_0", order=34, clones=True, streaming=False,
        sample_rate=44100,
        rung_dtypes={"q8_0": {"f16", "f32", "q8_0"}, "f16": {"f16", "f32"}},
        repo="dignome/Echo-TTS",
        license=License(
            spdx="CC-BY-NC-SA-4.0",
            name="Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International",
            url="https://creativecommons.org/licenses/by-nc-sa/4.0/",
            non_commercial=True,
            source_repo="dignome/Echo-TTS",
            attribution="Jordan Darefsky, Echo-TTS (jordand/echo-tts-base)")),
    # Kitten TTS 2 (1.7B), community model: offline, 24 kHz. No language switch -- the voice
    # carries the accent: English uses the 38 named English voices, and nine voices named after
    # a language (Arabic, Chinese, French, German, Hindi, Italian, Portuguese, Russian, Spanish)
    # reach the other nine; native picks that voice for a request in its language when the user
    # chose neither a preset nor a clip. Its text normaliser is English-tuned (vendor card), so
    # numbers in other languages may be read oddly. A clip clones with its exact transcript.
    # Stellon Labs Community License: free for research and non-commercial use; commercial use
    # only below USD 1M annual revenue and USD 1M total funding; "Powered by Stellon Labs" must
    # be displayed; outputs may not train other models -- conditional, so consent is asked.
    _tts_gguf_row(
        "kitten-tts2", "Kitten TTS 2 (1.7B)",
        ("en", "ar", "zh", "fr", "de", "hi", "it", "pt", "ru", "es"),
        "kitten_tts2", "",
        {"q8_0": ("kitten-tts2-native-q8-multilingual.gguf", 3282123776)},
        default_quant="q8_0", order=35, clones=True, streaming=False,
        sample_rate=24000, named_voices=True, transcript_required=True,
        rung_dtypes={"q8_0": {"bf16", "f16", "f32", "q8_0"}},
        repo="dignome/kitten_tts2", presets=KITTEN_TTS2_VOICES,
        license=License(
            spdx="LicenseRef-Stellon-Labs-Community-License",
            name="Stellon Labs Community License",
            url="https://huggingface.co/dignome/kitten_tts2/blob/73b762c95b07c4f0675c927c25d65741b8dab7da/LICENSE",
            non_commercial=False,
            source_repo="dignome/kitten_tts2",
            attribution="Stellon Labs Kitten TTS 2. Powered by Stellon Labs")),
    # VoiceTut TTS: an Egyptian Arabic fine-tune of OmniVoice, run by the omnivoice family that is
    # already compiled in, so it shares OmniVoice's op recording; CPU tier only until the fleet
    # runs this card (R19, per card). Its card says "Always pass --language arz" while the
    # app's picker offers "ar", so the load language forces "arz" on every synth. A clip and
    # its transcript are required, as for OmniVoice.
    # Licence (ruling 2026-10-06): OmniVoice's own terms -- the repo declares Apache-2.0, but the
    # weights fine-tune OmniVoice (CC-BY-NC-4.0) -- naming the repo the file downloads from.
    _tts_gguf_row(
        "voicetut-tts", "VoiceTut TTS (Egyptian Arabic)", ("ar",),
        "omnivoice", "",
        {"q8_0": ("voicetut-tts-q8_0.gguf", 1350264224),
         "f16": ("voicetut-tts-f16.gguf", 1639524576)},
        default_quant="q8_0", order=36, load_language="arz",
        clones=True, streaming=True, sample_rate=24000, transcript_required=True,
        rung_dtypes={"q8_0": {"f16", "f32", "q8_0"}, "f16": {"f16"}},
        tiers=_TTS_TIERS,
        repo="mohammedaly22/VoiceTut-TTS-GGUF",
        license=License(
            spdx="CC-BY-NC-4.0",
            name="Creative Commons Attribution-NonCommercial 4.0 International",
            url="https://creativecommons.org/licenses/by-nc/4.0/",
            non_commercial=True,
            source_repo="mohammedaly22/VoiceTut-TTS-GGUF",
            attribution="k2-fsa/OmniVoice")),
    # ---- 2026-10-06 roster expansion, multi-file rungs ------------------------
    # MioTTS 1.7B (Apache-2.0) with MioCodec 25 Hz 44.1 kHz v2 (MIT), from audio.cpp's official
    # mirror (unpinned, like every card from it): English and Japanese, offline, 44.1 kHz,
    # clone-only from a clip with no transcript (VOICE_REQUIRED_FAMILIES). The codec rides along
    # with every rung as a companion file.
    _tts_gguf_row(
        "miotts-1.7b", "MioTTS 1.7B", ("en", "ja"),
        "miotts", "MioTTS-1.7B-GGUF",
        {"q8_0": ("miotts-1.7b-q8_0.gguf", 2197326752),
         "bf16": ("miotts-1.7b-bf16.gguf", 3518532512)},
        default_quant="q8_0", order=37, clones=True, streaming=False, sample_rate=44100,
        companions={"q8_0": (_MIOCODEC_Q8_0,), "bf16": (_MIOCODEC_Q8_0,)},
        rung_dtypes={"q8_0": {"f16", "f32", "q8_0"}, "bf16": {"bf16", "f16", "f32", "q8_0"}}),
    # LFM2.5-Audio 1.5B, English checkpoint, from Liquid AI's own repo at the commit audio.cpp's
    # spec pins: offline, 24 kHz, no cloning; four voices (us_male, which a bare synth speaks,
    # us_female, uk_male, uk_female). Every rung is four files at the repo root -- the backbone
    # (the main file) and its mmproj-, vocoder- and tokenizer- companions -- staged together;
    # native loads their directory (sk_tts.cpp family_load). The checkpoint accepts only "",
    # "auto" or its own language, never an app code like en-US, so the load language forces
    # "auto". LFM Open License v1.0: commercial use only below USD 10M annual revenue, notices
    # on redistribution -- conditional, so consent is asked.
    _tts_gguf_row(
        "lfm2.5-audio-en", "LFM2.5-Audio 1.5B (English)", ("en",),
        "lfm2_audio", "",
        {"q8_0": ("LFM2.5-Audio-1.5B-Q8_0.gguf", 1246253280),
         "f16": ("LFM2.5-Audio-1.5B-F16.gguf", 2343325920),
         "q4_0": ("LFM2.5-Audio-1.5B-Q4_0.gguf", 695750880)},
        default_quant="q8_0", order=38, load_language="auto",
        clones=False, streaming=False, sample_rate=24000, named_voices=True,
        presets=("us_male", "us_female", "uk_male", "uk_female"),
        rung_dtypes={"q8_0": {"f32", "q8_0"}, "f16": {"f16", "f32"}, "q4_0": {"f32", "q4_0", "q6_K"}},
        repo="LiquidAI/LFM2.5-Audio-1.5B-GGUF",
        companions={
            "q8_0": (("mmproj-LFM2.5-Audio-1.5B-Q8_0.gguf", 293443936),
                     ("vocoder-LFM2.5-Audio-1.5B-Q8_0.gguf", 205742272),
                     ("tokenizer-LFM2.5-Audio-1.5B-Q8_0.gguf", 76957632)),
            "f16": (("mmproj-LFM2.5-Audio-1.5B-F16.gguf", 458806624),
                    ("vocoder-LFM2.5-Audio-1.5B-F16.gguf", 387159232),
                    ("tokenizer-LFM2.5-Audio-1.5B-F16.gguf", 142699392)),
            "q4_0": (("mmproj-LFM2.5-Audio-1.5B-Q4_0.gguf", 219511136),
                     ("vocoder-LFM2.5-Audio-1.5B-Q4_0.gguf", 108986560),
                     ("tokenizer-LFM2.5-Audio-1.5B-Q4_0.gguf", 50546112))},
        license=License(
            spdx="LicenseRef-LFM-Open-License-1.0",
            name="LFM Open License v1.0",
            url="https://huggingface.co/LiquidAI/LFM2.5-Audio-1.5B-GGUF/blob/7d525f883a077e20afb782f2ff618edcae0e39e4/LICENSE",
            non_commercial=False,
            source_repo="LiquidAI/LFM2.5-Audio-1.5B-GGUF",
            attribution=f"Liquid AI, LFM2.5-Audio-1.5B. {_LFM2_CC_BY_CREDIT}")),
    # LFM2.5-Audio 1.5B, Japanese checkpoint: the same family and package layout as the English
    # card, at the commit audio.cpp's spec pins. It has ONE voice -- any voice set throws
    # (community_models/lfm2_audio/tts.cpp:64-69) -- so the card offers none. The load language
    # forces "auto", as for the English card. The repo's F32 package is left out: it doubles
    # F16's download for no quality gain, and the planner would pick it on any GPU box with the
    # memory. LFM Open License v1.0, conditional, so consent is asked.
    _tts_gguf_row(
        "lfm2.5-audio-ja", "LFM2.5-Audio 1.5B (Japanese)", ("ja",),
        "lfm2_audio", "",
        {"q8_0": ("LFM2.5-Audio-1.5B-JP-Q8_0.gguf", 1246253248),
         "f16": ("LFM2.5-Audio-1.5B-JP-F16.gguf", 2343325888),
         "q4_0": ("LFM2.5-Audio-1.5B-JP-Q4_0.gguf", 695750848)},
        default_quant="q8_0", order=39, load_language="auto",
        clones=False, streaming=False, sample_rate=24000,
        rung_dtypes={"q8_0": {"f32", "q8_0"}, "f16": {"f16", "f32"}, "q4_0": {"f32", "q4_0", "q6_K"}},
        repo="LiquidAI/LFM2.5-Audio-1.5B-JP-GGUF",
        companions={
            "q8_0": (("mmproj-LFM2.5-Audio-1.5B-JP-Q8_0.gguf", 293443840),
                     ("vocoder-LFM2.5-Audio-1.5B-JP-Q8_0.gguf", 205742368),
                     ("tokenizer-LFM2.5-Audio-1.5B-JP-Q8_0.gguf", 74584224)),
            "f16": (("mmproj-LFM2.5-Audio-1.5B-JP-F16.gguf", 432067840),
                    ("vocoder-LFM2.5-Audio-1.5B-JP-F16.gguf", 387159328),
                    ("tokenizer-LFM2.5-Audio-1.5B-JP-F16.gguf", 140325984)),
            "q4_0": (("mmproj-LFM2.5-Audio-1.5B-JP-Q4_0.gguf", 219511040),
                     ("vocoder-LFM2.5-Audio-1.5B-JP-Q4_0.gguf", 108986656),
                     ("tokenizer-LFM2.5-Audio-1.5B-JP-Q4_0.gguf", 48172704))},
        license=License(
            spdx="LicenseRef-LFM-Open-License-1.0",
            name="LFM Open License v1.0",
            url="https://huggingface.co/LiquidAI/LFM2.5-Audio-1.5B-JP-GGUF/blob/64b96718b341dbd5650f9e85627cecdcbd4ac61b/LICENSE",
            non_commercial=False,
            source_repo="LiquidAI/LFM2.5-Audio-1.5B-JP-GGUF",
            attribution=f"Liquid AI, LFM2.5-Audio-1.5B-JP. {_LFM2_CC_BY_CREDIT}")),
]


def tts_models() -> list[TtsModel]:
    return list(TTS_MODELS)


def tts_model(model_id: str) -> TtsModel | None:
    return next((m for m in TTS_MODELS if m.id == model_id), None)


def resolve_tts_card(model_id: str) -> "TtsModel | None":
    """The static TTS card for `model_id`, or None for an unknown id. The
    sherpa-onnx ad-hoc community-voice fallback (piper/vits/matcha/kokoro/
    icefall) died with the sherpa_tts backend — every TTS id is now a
    catalog row or unknown."""
    return tts_model(model_id)
