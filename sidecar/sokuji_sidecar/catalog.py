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


@dataclass(frozen=True)
class Deployment:
    backend: str        # backend NAME: "native_asr" | "native_asr_stream" | "native_translate" | "native_tts"
    tier: str           # "cpu" | "gpu-vulkan" | "gpu-metal" (gpu-cuda/gpu-dml died with the ONNX TTS backends — slice 4)
    compute_type: str   # quant/dtype label ("q4_k_m", "q8_0", "bf16", ...)
    artifact: str       # backend.load() model_ref (repo id or "org/repo/file.gguf")
    rank: float         # tie-breaker within a tier (higher = preferred)
    est_bytes: int | None = None                     # footprint estimate; None → model_size(artifact)
    platforms: tuple[str, ...] = ("linux", "windows", "macos")  # OSes this deployment runs on (D9)


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


def _tc_row(mid, name, langs, repo, base, order, quants, default,
            recommended=False, backend="native_asr", tiers=_TC_TIERS):
    """One transcribe.cpp ASR card with its FULL quant ladder. `quants` maps
    QUANT (filename token, e.g. "Q8_0") -> size_bytes; `default` names the
    curated default. The same GGUF serves every tier. Deployments are ordered
    default-first so downloads/size_bytes key off the default; q6_k/q4_k_m/q8_0
    are curated recommendation candidates, f16/q5_k_m are listed-only."""
    curated = {"q8_0", "q6_k", "q4_k_m"}
    deps = []
    order_keys = [default] + [q for q in ("F16", "Q8_0", "Q6_K", "Q5_K_M", "Q4_K_M")
                              if q in quants and q != default]
    for q in order_keys:
        quant = q.lower()
        rank = 2.0 if q == default else (1.0 if quant in curated else 0.5)
        deps += [Deployment(backend, tier, quant, f"{repo}/{base}-{q}.gguf", rank,
                            est_bytes=quants[q]) for tier in tiers]
    return AsrModel(mid, name, langs, tuple(deps), recommended=recommended,
                    sort_order=order, size_bytes=quants[default])


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
            default="Q4_K_M", recommended=True),
    # Arabic specialist from the Cohere family — no librispeech figure (ar
    # model); slotted top of its language view beside the flagship.
    _tc_row("cohere-transcribe-arabic-07-2026", "Cohere Transcribe (Arabic)",
            ("ar", "en"),
            "handy-computer/cohere-transcribe-arabic-07-2026-gguf", "cohere-transcribe-arabic-07-2026",
            12, {"F16": 4106644896, "Q8_0": 2410655136, "Q6_K": 1972524448,
                 "Q5_K_M": 1770270112, "Q4_K_M": 1558162848}, default="Q4_K_M"),
    # Russian specialist (GigaAM v3, end-to-end w/ punctuation) — no librispeech
    # figure (ru model); slotted top of its language view.
    _tc_row("gigaam-v3-e2e-rnnt", "GigaAM v3 (Russian)", ("ru",),
            "handy-computer/gigaam-v3-e2e-rnnt-gguf", "gigaam-v3-e2e-rnnt",
            15, {"F16": 452381408, "Q8_0": 273724832, "Q6_K": 227953952,
                 "Q5_K_M": 206392736, "Q4_K_M": 183948704}, default="Q8_0"),
    # Russian second rung — plain RNNT variant (no e2e punctuation head).
    _tc_row("gigaam-v3-rnnt", "GigaAM v3 RNNT (Russian)", ("ru",),
            "handy-computer/gigaam-v3-rnnt-gguf", "gigaam-v3-rnnt",
            16, {"F16": 451084832, "Q8_0": 273022880, "Q6_K": 227252000,
                 "Q5_K_M": 205690784, "Q4_K_M": 183246752}, default="Q8_0"),
    # WER 1.29 / 1.46 — English/European quality alternates.
    _tc_row("granite-speech-4.1-2b", "Granite Speech 4.1 (2B)",
            ("en", "fr", "de", "es", "pt", "ja"),
            "handy-computer/granite-speech-4.1-2b-gguf", "granite-speech-4.1-2b",
            20, {"F16": 4632623104, "Q8_0": 2559878848, "Q6_K": 2024967936,
                 "Q5_K_M": 1829704544, "Q4_K_M": 1602904800}, default="Q4_K_M"),
    # WER 1.38 — the big English parakeet; second-best English figure in the roster.
    _tc_row("parakeet-tdt-1.1b", "Parakeet TDT 1.1B", ("en",),
            "handy-computer/parakeet-tdt-1.1b-gguf", "parakeet-tdt-1.1b",
            25, {"F16": 2145162976, "Q8_0": 1267288736, "Q6_K": 1042509472,
                 "Q5_K_M": 935758496, "Q4_K_M": 825248416}, default="Q8_0"),
    _tc_row("granite-speech-4.1-2b-plus", "Granite Speech 4.1 (2B+)",
            ("en", "fr", "de", "es", "pt"),
            "handy-computer/granite-speech-4.1-2b-plus-gguf", "granite-speech-4.1-2b-plus",
            30, {"F16": 4229971808, "Q8_0": 2345973152, "Q6_K": 1859821504,
                 "Q5_K_M": 1691297088, "Q4_K_M": 1489663424}, default="Q4_K_M"),
    # WER 1.59 (q4_k_m beats q8_0's 1.62 per the author's table) — en/de/es/fr.
    _tc_row("canary-1b-flash", "Canary 1B Flash", ("en", "de", "es", "fr"),
            "handy-computer/canary-1b-flash-gguf", "canary-1b-flash",
            35, {"F16": 1785657120, "Q8_0": 1048131360, "Q6_K": 857603872,
                 "Q5_K_M": 769563424, "Q4_K_M": 677141280}, default="Q4_K_M"),
    # WER 1.61 — CJK quality mainstay (verified all-5-langs correct on real clips).
    _tc_row("qwen3-asr-1.7b", "Qwen3-ASR 1.7B",
            ("zh", "en", "ja", "ko", "yue", "ar", "de", "es",
             "fr", "it", "pt", "ru", "th", "vi", "hi", "id"),
            "handy-computer/Qwen3-ASR-1.7B-gguf", "Qwen3-ASR-1.7B",
            40, {"F16": 4091390944, "Q8_0": 2185030624, "Q6_K": 1692554208,
                 "Q5_K_M": 1517290464, "Q4_K_M": 1319830496},
            default="Q4_K_M", recommended=True),
    # WER 1.69 (q6_k beats bf16 per the author's table) — 31-language coverage king.
    _tc_row("fun-asr-mlt-nano", "Fun-ASR MLT Nano",
            ("zh", "en", "yue", "ja", "ko", "vi", "id", "th", "ms", "fil", "ar",
             "hi", "bg", "hr", "cs", "da", "nl", "et", "fi", "el", "hu", "ga",
             "lv", "lt", "mt", "pl", "pt", "ro", "sk", "sl", "sv"),
            "handy-computer/Fun-ASR-MLT-Nano-2512-gguf", "Fun-ASR-MLT-Nano-2512",
            50, {"F16": 1667504192, "Q8_0": 891271232, "Q6_K": 690744384,
                 "Q5_K_M": 631129152, "Q4_K_M": 556975168},
            default="Q6_K", recommended=True),
    # WER 1.78 (q6_k ties bf16 — same quirk as the MLT sibling) — light zh/en/ja.
    _tc_row("fun-asr-nano", "Fun-ASR Nano", ("zh", "en", "ja"),
            "handy-computer/Fun-ASR-Nano-2512-gguf", "Fun-ASR-Nano-2512",
            55, {"F16": 1667503872, "Q8_0": 891270912, "Q6_K": 690744064,
                 "Q5_K_M": 631128832, "Q4_K_M": 556974848}, default="Q6_K"),
    # WER 1.81 — 99-language quality reference.
    _tc_row("whisper-large-v3", "Whisper large-v3", ("multi",),
            "handy-computer/whisper-large-v3-gguf", "whisper-large-v3",
            60, {"F16": 3107236640, "Q8_0": 1668741440, "Q6_K": 1297130208,
                 "Q5_K_M": 1161143008, "Q4_K_M": 997303008}, default="Q8_0"),
    # WER 1.90 (q5_k_m best rung; default q8_0 lands 1.93) — the tiny/fastest
    # canary rung (en/de/es/fr).
    _tc_row("canary-180m-flash", "Canary 180M Flash", ("en", "de", "es", "fr"),
            "handy-computer/canary-180m-flash-gguf", "canary-180m-flash",
            65, {"F16": 381632192, "Q8_0": 218447552, "Q6_K": 176291520,
                 "Q5_K_M": 158704320, "Q4_K_M": 139223744}, default="Q8_0"),
    # WER 1.91 — European quality tier (NVIDIA Canary, 25 langs).
    _tc_row("canary-1b-v2", "Canary 1B v2",
            ("bg", "hr", "cs", "da", "nl", "en", "et", "fi", "fr", "de", "el",
             "hu", "it", "lv", "lt", "mt", "pl", "pt", "ro", "sk", "sl", "es",
             "sv", "ru", "uk"),
            "handy-computer/canary-1b-v2-gguf", "canary-1b-v2",
            70, {"F16": 1966111456, "Q8_0": 1144290016, "Q6_K": 931986144,
                 "Q5_K_M": 836664032, "Q4_K_M": 735476448}, default="Q8_0"),
    # WER 1.92 at RTF 151 (metal) — the European SPEED tier (NVIDIA TDT).
    _tc_row("parakeet-tdt-0.6b-v3", "Parakeet TDT 0.6B v3",
            ("bg", "hr", "cs", "da", "nl", "en", "et", "fi", "fr", "de", "el",
             "hu", "it", "lv", "lt", "mt", "pl", "pt", "ro", "ru", "sk", "sl",
             "es", "sv", "uk"),
            "handy-computer/parakeet-tdt-0.6b-v3-gguf", "parakeet-tdt-0.6b-v3",
            80, {"F16": 1255869856, "Q8_0": 739508576, "Q6_K": 610342240,
                 "Q5_K_M": 548946272, "Q4_K_M": 485425504},
            default="Q8_0", recommended=True),
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
                 "Q5_K_M": 548946336, "Q4_K_M": 485425568}, default="Q8_0"),
    # WER 1.93 @ Q8_0 — en/zh audio-LLM (Whisper-medium encoder + Qwen3-0.6B;
    # Apache-2.0; transcribe.cpp >= 0.2.0). Batch-only upstream, and its
    # optional inline speaker markers stay OFF (session.run's diarize default),
    # so it transcribes like any other card. Q4_K_M degrades to 2.59 and the
    # author warns of edge-case failures below Q5_K_M — Q8_0 is the default.
    _tc_row("moss-transcribe-diarize", "MOSS Transcribe (0.9B)", ("en", "zh"),
            "handy-computer/moss-transcribe-diarize-gguf", "MOSS-Transcribe-Diarize",
            85, {"F16": 1833665696, "Q8_0": 986899616, "Q6_K": 768151712,
                 "Q5_K_M": 700313760, "Q4_K_M": 617345184}, default="Q8_0"),
    # WER 2.01 — 99-language mainstay: ~large-v3 quality at 4x the speed.
    # Sizes are the 2026-07-21 re-upload of the repo (quants 64 bytes shorter per
    # file; F16 was re-encoded, ~10.8 MB smaller) — all five match the live tree.
    _tc_row("whisper-large-v3-turbo", "Whisper large-v3 turbo", ("multi",),
            "handy-computer/whisper-large-v3-turbo-gguf", "whisper-large-v3-turbo",
            90, {"F16": 1625935520, "Q8_0": 886381760, "Q6_K": 692536928,
                 "Q5_K_M": 619628128, "Q4_K_M": 536069728},
            default="Q8_0", recommended=True),
    # WER 2.07 — heavy streaming flagship (committed/tentative partials).
    _tc_row("voxtral-mini-4b-realtime", "Voxtral Mini 4B Realtime",
            ("en", "fr", "es", "de", "ru", "zh", "ja", "it", "pt", "nl", "ar", "hi", "ko"),
            "handy-computer/Voxtral-Mini-4B-Realtime-2602-gguf", "Voxtral-Mini-4B-Realtime-2602",
            100, {"F16": 8879114528, "Q8_0": 4731791648, "Q6_K": 3661018912,
                  "Q5_K_M": 3281439008, "Q4_K_M": 2830493984},
            default="Q4_K_M", recommended=True, backend="native_asr_stream"),
    # WER 2.10 — light CJK quality rung.
    _tc_row("qwen3-asr-0.6b", "Qwen3-ASR 0.6B",
            ("zh", "en", "ja", "ko", "yue", "ar", "de", "es",
             "fr", "it", "pt", "ru", "th", "vi", "hi", "id"),
            "handy-computer/Qwen3-ASR-0.6B-gguf", "Qwen3-ASR-0.6B",
            110, {"F16": 1579793056, "Q8_0": 850423456, "Q6_K": 690417824,
                  "Q5_K_M": 645356192, "Q4_K_M": 589560480}, default="Q8_0"),
    # WER 2.16 — English STREAMING mid rung (MIT); upstream ships only
    # F16/Q8_0 rungs (plus an F32 we skip — the WER table is flat across all).
    _tc_row("moonshine-streaming-medium", "Moonshine Streaming Medium", ("en",),
            "handy-computer/moonshine-streaming-medium-gguf", "moonshine-streaming-medium",
            113, {"F16": 533781408, "Q8_0": 295793568},
            default="Q8_0", backend="native_asr_stream"),
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
            default="Q8_0", backend="native_asr_stream"),
    # WER 2.25 — Taiwanese Mandarin + zh/en code-switching (Whisper-large-v2
    # ft); the quant ladder is WER-flat so the smallest curated rung wins.
    _tc_row("breeze-asr-25", "Breeze ASR 25", ("zh", "en"),
            "handy-computer/Breeze-ASR-25-gguf", "Breeze-ASR-25",
            116, {"F16": 3106458208, "Q8_0": 1667964224, "Q6_K": 1296353280,
                 "Q5_K_M": 1160366080, "Q4_K_M": 996526080}, default="Q4_K_M"),
    # WER 3.03 — LIGHT streaming, 27 languages incl. zh/ja/ko (author-recommended).
    _tc_row("nemotron-3.5-asr-streaming", "Nemotron 3.5 ASR Streaming",
            ("en", "es", "fr", "it", "pt", "nl", "de", "tr", "ru", "ar", "hi",
             "ja", "ko", "vi", "uk", "pl", "sv", "cs", "nb", "da", "bg", "fi",
             "hr", "sk", "zh", "hu", "ro", "et"),
            "handy-computer/nemotron-3.5-asr-streaming-0.6b-gguf", "nemotron-3.5-asr-streaming-0.6b",
            128, {"F16": 1277750240, "Q8_0": 751094240, "Q6_K": 621356512,
                  "Q5_K_M": 559647200, "Q4_K_M": 495831520},
            default="Q8_0", recommended=True, backend="native_asr_stream"),
    # WER 3.13 at RTF 289 (metal) — fastest/lightest CJK+yue (no ITN/punct).
    _tc_row("sense-voice", "SenseVoice", ("zh", "en", "ja", "ko", "yue"),
            "handy-computer/SenseVoiceSmall-gguf", "SenseVoiceSmall",
            130, {"F16": 470412128, "Q8_0": 252684608, "Q6_K": 196438336,
                  "Q5_K_M": 172474880, "Q4_K_M": 145738304}, default="Q8_0"),
    # WER 5.1 — the minimal 99-language floor for long-tail source languages.
    _tc_row("whisper-base", "Whisper base", ("multi",),
            "handy-computer/whisper-base-gguf", "whisper-base",
            140, {"F16": 151145760, "Q8_0": 84962880, "Q6_K": 67865664,
                  "Q5_K_M": 63786048, "Q4_K_M": 58870848}, default="Q8_0"),
    # --- Expanded roster (2026-07-20): the rest of the transcribe.cpp
    # family. Excludes canary-1b (CC-BY-NC, non-commercial) and medasr
    # (gated). All recommended=False; ordered via asr_models() sort.
    # WER 1.25 (q5_k_m = best rung & default; q4_k_m 1.35 worst) — NAR editor, ASR-only
    _tc_row("granite-speech-4.1-2b-nar", "Granite Speech 4.1 (2B NAR)", ("en", "fr", "de", "es", "pt"),
            "handy-computer/granite-speech-4.1-2b-nar-gguf", "granite-speech-4.1-2b-nar",
            11, {"F16": 4515792768, "Q8_0": 2498105472, "Q6_K": 1977417568, "Q5_K_M": 1782089344, "Q4_K_M": 1560008832}, default="Q5_K_M"),
    # Russian (FLEURS-ru 5.50) — e2e w/ punct; slotted in RU view
    _tc_row("gigaam-v3-e2e-ctc", "GigaAM v3 E2E-CTC (Russian)", ("ru",),
            "handy-computer/gigaam-v3-e2e-ctc-gguf", "gigaam-v3-e2e-ctc",
            17, {"F16": 449098336, "Q8_0": 272151136, "Q6_K": 226439776, "Q5_K_M": 204911200, "Q4_K_M": 182497888}, default="Q8_0"),
    # Russian (FLEURS-ru 8.29) — plain CTC, lowercase/no-punct; RU view
    _tc_row("gigaam-v3-ctc", "GigaAM v3 CTC (Russian)", ("ru",),
            "handy-computer/gigaam-v3-ctc-gguf", "gigaam-v3-ctc",
            18, {"F16": 448750528, "Q8_0": 271803328, "Q6_K": 226091968, "Q5_K_M": 204563392, "Q4_K_M": 182150080}, default="Q8_0"),
    # WER 1.41 — en, lowercase/no-punct
    _tc_row("parakeet-rnnt-1.1b", "Parakeet RNNT 1.1B", ("en",),
            "handy-computer/parakeet-rnnt-1.1b-gguf", "parakeet-rnnt-1.1b",
            26, {"F16": 2145156480, "Q8_0": 1267285248, "Q6_K": 1042505984, "Q5_K_M": 935755008, "Q4_K_M": 825244928}, default="Q8_0"),
    # WER 1.41 — en+EU speech-LLM
    _tc_row("granite-4.0-1b-speech", "Granite Speech 4.0 (1B)", ("en", "fr", "de", "es", "pt", "ja"),
            "handy-computer/granite-4.0-1b-speech-gguf", "granite-4.0-1b-speech",
            27, {"F16": 4632623104, "Q8_0": 2559878848, "Q6_K": 2024967936, "Q5_K_M": 1829704544, "Q4_K_M": 1602904800}, default="Q4_K_M"),
    # WER 1.56 — GPU-class 24B (Q5_K_M 17GB+); q4_k_m dropped (2.11 cliff).
    # GPU-only tiers: hardware-gated off CPU-only machines (a 17GB CPU download
    # for a 24B is unusable); big-GPU machines still see it, small-GPU ones get
    # the "needs ~17GB" variant reason string.
    _tc_row("voxtral-small-24b", "Voxtral Small 24B", ("en", "fr", "de", "es", "it", "pt", "nl", "hi"),
            "handy-computer/Voxtral-Small-24B-2507-gguf", "Voxtral-Small-24B-2507",
            31, {"F16": 48548098528, "Q8_0": 25810383328, "Q6_K": 19936473568, "Q5_K_M": 17138659808},
            default="Q5_K_M", tiers=_TC_GPU_TIERS),
    # WER 1.58 offline — run batch (zero-lookahead streaming collapses to 5.76)
    _tc_row("parakeet-unified-en-0.6b", "Parakeet Unified 0.6B (en)", ("en",),
            "handy-computer/parakeet-unified-en-0.6b-gguf", "parakeet-unified-en-0.6b",
            32, {"F16": 1239114240, "Q8_0": 731357568, "Q6_K": 602191232, "Q5_K_M": 540795264, "Q4_K_M": 477274496}, default="Q8_0"),
    # WER 1.59 — en, lowercase/no-punct
    _tc_row("parakeet-rnnt-0.6b", "Parakeet RNNT 0.6B", ("en",),
            "handy-computer/parakeet-rnnt-0.6b-gguf", "parakeet-rnnt-0.6b",
            34, {"F16": 1235969568, "Q8_0": 729687456, "Q6_K": 600902048, "Q5_K_M": 539714976, "Q4_K_M": 476390816}, default="Q8_0"),
    # WER 1.63 — SALM audio-LLM, en-only (all quants 1.63)
    _tc_row("canary-qwen-2.5b", "Canary-Qwen 2.5B", ("en",),
            "handy-computer/canary-qwen-2.5b-gguf", "canary-qwen-2.5b",
            41, {"F16": 5076972928, "Q8_0": 2797548928, "Q6_K": 2208697728, "Q5_K_M": 1983729024, "Q4_K_M": 1737575808}, default="Q4_K_M"),
    # WER 1.68 — en, cased+punct+timestamps (v3 is multilingual)
    _tc_row("parakeet-tdt-0.6b-v2", "Parakeet TDT 0.6B v2", ("en",),
            "handy-computer/parakeet-tdt-0.6b-v2-gguf", "parakeet-tdt-0.6b-v2",
            42, {"F16": 1237334592, "Q8_0": 729574912, "Q6_K": 600408576, "Q5_K_M": 539012608, "Q4_K_M": 475491840}, default="Q8_0"),
    # WER 1.84 — en, fastest 0.6B head, lowercase/no-punct
    _tc_row("parakeet-ctc-0.6b", "Parakeet CTC 0.6B", ("en",),
            "handy-computer/parakeet-ctc-0.6b-gguf", "parakeet-ctc-0.6b",
            61, {"F16": 1220181184, "Q8_0": 722271424, "Q6_K": 593644736, "Q5_K_M": 532544704, "Q4_K_M": 469302464}, default="Q8_0"),
    # WER 1.84 — en, lowercase/no-punct
    _tc_row("parakeet-ctc-1.1b", "Parakeet CTC 1.1B", ("en",),
            "handy-computer/parakeet-ctc-1.1b-gguf", "parakeet-ctc-1.1b",
            62, {"F16": 2129368096, "Q8_0": 1259869216, "Q6_K": 1035248672, "Q5_K_M": 928584736, "Q4_K_M": 818156576}, default="Q8_0"),
    # WER 1.87 — en, hybrid TDT+CTC, cased+punct
    _tc_row("parakeet-tdt_ctc-1.1b", "Parakeet TDT-CTC 1.1B", ("en",),
            "handy-computer/parakeet-tdt_ctc-1.1b-gguf", "parakeet-tdt_ctc-1.1b",
            63, {"F16": 2145162560, "Q8_0": 1267288320, "Q6_K": 1042509056, "Q5_K_M": 935758080, "Q4_K_M": 825248000}, default="Q8_0"),
    # WER 1.87 — offline audio-LLM (q4_k_m 2.98GB)
    _tc_row("voxtral-mini-3b", "Voxtral Mini 3B", ("en", "fr", "de", "es", "it", "pt", "nl", "hi"),
            "handy-computer/Voxtral-Mini-3B-2507-gguf", "Voxtral-Mini-3B-2507",
            64, {"F16": 9376578208, "Q8_0": 5000084128, "Q6_K": 3869489824, "Q5_K_M": 3464182432, "Q4_K_M": 2984721056}, default="Q4_K_M"),
    # WER 2.29 — en-only cache-aware STREAMING (NVIDIA Open Model License)
    _tc_row("nemotron-speech-streaming-en", "Nemotron Speech Streaming (en)", ("en",),
            "handy-computer/nemotron-speech-streaming-en-0.6b-gguf", "nemotron-speech-streaming-en-0.6b",
            117, {"F16": 1237652608, "Q8_0": 729650176, "Q6_K": 600420352, "Q5_K_M": 538989568, "Q4_K_M": 475436032}, default="Q8_0", backend="native_asr_stream"),
    # WER 2.43 — en, small/fast, cased+punct
    _tc_row("parakeet-tdt_ctc-110m", "Parakeet TDT-CTC 110M", ("en",),
            "handy-computer/parakeet-tdt_ctc-110m-gguf", "parakeet-tdt_ctc-110m",
            118, {"F16": 229334560, "Q8_0": 135373280, "Q6_K": 112311264, "Q5_K_M": 101335520, "Q4_K_M": 89989600}, default="Q8_0"),
    # WER 2.46 — 99-lang 1.55B (pre-v3)
    _tc_row("whisper-large-v2", "Whisper large-v2", ("multi",),
            "handy-computer/whisper-large-v2-gguf", "whisper-large-v2",
            119, {"F16": 3106458208, "Q8_0": 1667964224, "Q6_K": 1296353280, "Q5_K_M": 1160366080, "Q4_K_M": 996526080}, default="Q8_0"),
    # WER 2.53 — en STREAMING 123M (F16/Q8_0 only)
    _tc_row("moonshine-streaming-small", "Moonshine Streaming Small", ("en",),
            "handy-computer/moonshine-streaming-small-gguf", "moonshine-streaming-small",
            121, {"F16": 282092128, "Q8_0": 198506848}, default="Q8_0", backend="native_asr_stream"),
    # WER 2.59 — 99-lang 769M
    _tc_row("whisper-medium", "Whisper medium", ("multi",),
            "handy-computer/whisper-medium-gguf", "whisper-medium",
            122, {"F16": 1541931424, "Q8_0": 831538144, "Q6_K": 648019904, "Q5_K_M": 582746048, "Q4_K_M": 504102848}, default="Q8_0"),
    # WER 2.62 — 99-lang 1.55B (v1)
    _tc_row("whisper-large", "Whisper large", ("multi",),
            "handy-computer/whisper-large-gguf", "whisper-large",
            123, {"F16": 3106458176, "Q8_0": 1667964192, "Q6_K": 1296353248, "Q5_K_M": 1160366048, "Q4_K_M": 996526048}, default="Q8_0"),
    # WER 2.72 — en-only 769M
    _tc_row("whisper-medium.en", "Whisper medium.en", ("en",),
            "handy-computer/whisper-medium.en-gguf", "whisper-medium.en",
            124, {"F16": 1541853248, "Q8_0": 831460928, "Q6_K": 647942912, "Q5_K_M": 582669056, "Q4_K_M": 504025856}, default="Q8_0"),
    # WER 2.97 — en-only 244M
    _tc_row("whisper-small.en", "Whisper small.en", ("en",),
            "handy-computer/whisper-small.en-gguf", "whisper-small.en",
            125, {"F16": 492810784, "Q8_0": 269674144, "Q6_K": 212030528, "Q5_K_M": 193672256, "Q4_K_M": 171553856}, default="Q8_0"),
    # WER 3.26 — en OFFLINE 61M (F16/Q8_0 only)
    _tc_row("moonshine-base", "Moonshine Base", ("en",),
            "handy-computer/moonshine-base-gguf", "moonshine-base",
            131, {"F16": 131789440, "Q8_0": 77476480}, default="Q8_0"),
    # WER 3.33 — 99-lang 244M
    _tc_row("whisper-small", "Whisper small", ("multi",),
            "handy-computer/whisper-small-gguf", "whisper-small",
            132, {"F16": 492888480, "Q8_0": 269751136, "Q6_K": 212107328, "Q5_K_M": 193749056, "Q4_K_M": 171630656}, default="Q8_0"),
    # WER 4.13 — en-only 74M
    _tc_row("whisper-base.en", "Whisper base.en", ("en",),
            "handy-computer/whisper-base.en-gguf", "whisper-base.en",
            133, {"F16": 151068608, "Q8_0": 84886208, "Q6_K": 67789088, "Q5_K_M": 63709472, "Q4_K_M": 58794272}, default="Q8_0"),
    # WER 4.52 — en STREAMING 34M (F16/Q8_0 only)
    _tc_row("moonshine-streaming-tiny", "Moonshine Streaming Tiny", ("en",),
            "handy-computer/moonshine-streaming-tiny-gguf", "moonshine-streaming-tiny",
            134, {"F16": 89784416, "Q8_0": 50462816}, default="Q8_0", backend="native_asr_stream"),
    # WER 4.58 — en OFFLINE 27M (F16/Q8_0 only)
    _tc_row("moonshine-tiny", "Moonshine Tiny", ("en",),
            "handy-computer/moonshine-tiny-gguf", "moonshine-tiny",
            135, {"F16": 59244192, "Q8_0": 35466912}, default="Q8_0"),
    # WER 5.72 — en-only 39M
    _tc_row("whisper-tiny.en", "Whisper tiny.en", ("en",),
            "handy-computer/whisper-tiny.en-gguf", "whisper-tiny.en",
            141, {"F16": 80058464, "Q8_0": 45904544, "Q6_K": 44761760, "Q5_K_M": 44135072, "Q4_K_M": 43545248}, default="Q8_0"),
    # WER 7.49 — 99-lang 39M (least accurate whisper)
    _tc_row("whisper-tiny", "Whisper tiny", ("multi",),
            "handy-computer/whisper-tiny-gguf", "whisper-tiny",
            142, {"F16": 80135360, "Q8_0": 45981088, "Q6_K": 44838304, "Q5_K_M": 44211616, "Q4_K_M": 43621792}, default="Q8_0"),
    # per-language fine-tune (ar); no upstream WER/doc
    _tc_row("moonshine-base-ar", "Moonshine Base (ar)", ("ar",),
            "handy-computer/moonshine-base-ar-gguf", "moonshine-base-ar",
            150, {"F16": 131789440, "Q8_0": 77476480}, default="Q8_0"),
    # per-language fine-tune (ja); no upstream WER/doc
    _tc_row("moonshine-base-ja", "Moonshine Base (ja)", ("ja",),
            "handy-computer/moonshine-base-ja-gguf", "moonshine-base-ja",
            151, {"F16": 131789440, "Q8_0": 77476480}, default="Q8_0"),
    # per-language fine-tune (ko); no upstream WER/doc
    _tc_row("moonshine-base-ko", "Moonshine Base (ko)", ("ko",),
            "handy-computer/moonshine-base-ko-gguf", "moonshine-base-ko",
            152, {"F16": 131789440, "Q8_0": 77476480}, default="Q8_0"),
    # per-language fine-tune (uk); no upstream WER/doc
    _tc_row("moonshine-base-uk", "Moonshine Base (uk)", ("uk",),
            "handy-computer/moonshine-base-uk-gguf", "moonshine-base-uk",
            153, {"F16": 131789472, "Q8_0": 77476512}, default="Q8_0"),
    # per-language fine-tune (vi); no upstream WER/doc
    _tc_row("moonshine-base-vi", "Moonshine Base (vi)", ("vi",),
            "handy-computer/moonshine-base-vi-gguf", "moonshine-base-vi",
            154, {"F16": 131789472, "Q8_0": 77476512}, default="Q8_0"),
    # per-language fine-tune (zh); no upstream WER/doc
    _tc_row("moonshine-base-zh", "Moonshine Base (zh)", ("zh",),
            "handy-computer/moonshine-base-zh-gguf", "moonshine-base-zh",
            155, {"F16": 131789440, "Q8_0": 77476480}, default="Q8_0"),
    # per-language fine-tune (ar); no upstream WER/doc
    _tc_row("moonshine-tiny-ar", "Moonshine Tiny (ar)", ("ar",),
            "handy-computer/moonshine-tiny-ar-gguf", "moonshine-tiny-ar",
            156, {"F16": 59244224, "Q8_0": 35466944}, default="Q8_0"),
    # per-language fine-tune (ja); no upstream WER/doc
    _tc_row("moonshine-tiny-ja", "Moonshine Tiny (ja)", ("ja",),
            "handy-computer/moonshine-tiny-ja-gguf", "moonshine-tiny-ja",
            157, {"F16": 59244224, "Q8_0": 35466944}, default="Q8_0"),
    # per-language fine-tune (ko); no upstream WER/doc
    _tc_row("moonshine-tiny-ko", "Moonshine Tiny (ko)", ("ko",),
            "handy-computer/moonshine-tiny-ko-gguf", "moonshine-tiny-ko",
            158, {"F16": 59244224, "Q8_0": 35466944}, default="Q8_0"),
    # per-language fine-tune (uk); no upstream WER/doc
    _tc_row("moonshine-tiny-uk", "Moonshine Tiny (uk)", ("uk",),
            "handy-computer/moonshine-tiny-uk-gguf", "moonshine-tiny-uk",
            159, {"F16": 59244224, "Q8_0": 35466944}, default="Q8_0"),
    # per-language fine-tune (vi); no upstream WER/doc
    _tc_row("moonshine-tiny-vi", "Moonshine Tiny (vi)", ("vi",),
            "handy-computer/moonshine-tiny-vi-gguf", "moonshine-tiny-vi",
            160, {"F16": 59244224, "Q8_0": 35466944}, default="Q8_0"),
    # per-language fine-tune (zh); no upstream WER/doc
    _tc_row("moonshine-tiny-zh", "Moonshine Tiny (zh)", ("zh",),
            "handy-computer/moonshine-tiny-zh-gguf", "moonshine-tiny-zh",
            161, {"F16": 59244224, "Q8_0": 35466944}, default="Q8_0"),
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


def _llm_translate_row(mid, name, family, sort_order, default_quant, default_bytes,
                       alt_quant, alt_bytes, recommended=False,
                       disable_thinking=False, append_no_think=False):
    """A GGUF LLM translate card: the native_translate backend (sokuji_native's
    in-process llama.cpp runtime, spec §4.3), two GGUF quant variants, three
    tiers each (gpu-metal / gpu-vulkan / cpu — no gpu-cuda: post-A1 no probe
    ever reports a "cuda" device kind, so that tier was unreachable). The same
    GGUF serves every tier; rank 2.0 marks the default quant. Plan ORDER across
    tiers is decided by accel.TIER_RANK (gpu-metal 3.0 > gpu-vulkan 2.5 >
    cpu 1.0), not by the order of this tuple. `family` selects the prompt
    strategy (translate_backend.STRATEGIES) via PlanConfig.prompt_family."""
    deps = []
    for quant, nbytes, rank in ((default_quant, default_bytes, 2.0),
                                (alt_quant, alt_bytes, 1.0)):
        artifact = _gguf_artifact(mid, quant)
        deps += [Deployment("native_translate", tier, quant, artifact, rank, est_bytes=nbytes)
                 for tier in ("gpu-metal", "gpu-vulkan", "cpu")]
    return TranslateModel(mid, name, ("multi",), tuple(deps),
                          recommended=recommended, sort_order=sort_order,
                          size_bytes=default_bytes, disable_thinking=disable_thinking,
                          append_no_think=append_no_think, prompt_family=family)


# Sizes are the exact upstream GGUF file byte counts (HF API size fetch,
# 2026-07-03 — see _GGUF_SOURCES). The 13 Opus-MT (CTranslate2) rows that used
# to live here were removed in slice 3 along with the ct2_opus_translate
# backend and the ctranslate2 dependency: translation now runs entirely
# through native_translate (sokuji_native's in-process llama.cpp runtime).
TRANSLATE_MODELS: list[TranslateModel] = [
    _llm_translate_row("qwen2.5-0.5b", "Qwen 2.5 0.5B", "qwen", 1,
                       "q8_0", 675710816, "q4_k_m", 491400032, recommended=True),
    _llm_translate_row("qwen3-0.6b", "Qwen 3 0.6B", "qwen", 2,
                       "q8_0", 639446688, "q4_k_m", 396705472, recommended=True,
                       disable_thinking=True, append_no_think=True),
    _llm_translate_row("qwen3.5-0.8b", "Qwen 3.5 0.8B", "qwen", 3,
                       "q4_k_m", 532517120, "q8_0", 811843840,
                       disable_thinking=True),
    _llm_translate_row("qwen3.5-2b", "Qwen 3.5 2B", "qwen", 4,
                       "q4_k_m", 1280835840, "q8_0", 2012012800,
                       disable_thinking=True),
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
    spdx: str             # SPDX identifier ("CC-BY-NC-4.0")
    name: str             # human-readable license name
    url: str              # license text URL
    non_commercial: bool  # True gates commercial use
    source_repo: str      # upstream repo this license traces back to
    attribution: str      # required attribution string (author/project)


@dataclass(frozen=True)
class TtsModel(_ModelBase):
    family: str = ""                  # sk_tts_load's family_hint: moss_tts_nano | qwen3_tts | omnivoice | pocket_tts | supertonic
    load_language: str = ""           # pocket_tts's load-time language package ("english", ...); "" elsewhere
    clones: bool = False              # zero-shot voice cloning from a reference clip (sk_tts_set_voice)
    streaming: bool = False           # intra-utterance audio-delta streaming (R5: MOSS is offline-only)
    sample_rate: int = 24000          # audio.cpp's native rate for this family
    named_voices: bool = False        # sk_tts_presets returns a non-empty, curated list (dropdown)
    transcript_required: bool = False  # sk_tts_set_voice's ref_text is mandatory (omnivoice, qwen3_tts -- R15(s4))
    license: License | None = None    # non-standard license terms; None = no restriction
    # (relative-to-artifact-dir filename, size_bytes) sidecar assets sk_tts_presets
    # discovers next to the loaded gguf (pocket-tts-en's embeddings/alba.safetensors);
    # () for every other card (single self-sufficient GGUF — see native/README.md's
    # "GGUF-embedded sidecars" note).
    extra_files: tuple[tuple[str, int], ...] = ()


def voice_capability(model: "TtsModel") -> dict:
    """Two-axis native voice capability derived from static catalog facts.
    builtin: named (sk_tts_presets dropdown) | none. custom: clip (reference
    audio, sk_tts_set_voice) | none. The old style/range axes (Supertonic's
    uploaded style-vector JSON, a sid-range slider) died with the ONNX
    backends that were their only consumers."""
    custom = "clip" if model.clones else "none"
    builtin = "named" if model.named_voices else "none"
    out = {"builtin": builtin, "custom": custom}
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
        "sourceRepo": lic.source_repo,
        "attribution": lic.attribution,
    }


# All 10 cards are single-file GGUFs from audio.cpp's official mirror,
# verified 2026-09-01 via the HF tree API (`GET
# api/models/audio-cpp/audio.cpp-gguf/tree/main/<dir>`) — every (dir, file)
# pair below resolves to a real LFS object and the byte count shown is its
# exact `lfs.size`. Cross-checked against the repo's own `model_specs/
# <family>.json` package list (vendored at
# native/build/cpu/_deps/audiocpp-src/model_specs/) for the curated default
# per family and, for pocket_tts, exactly which languages ship a preset asset
# (see the pocket-tts-en row below).
_AUDIOCPP_GGUF_REPO = "audio-cpp/audio.cpp-gguf"

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
# `_TTS_TIER_OVERRIDES` — every one of the ten current cards IS listed there
# (see that dict, below the fleet table), so this default currently applies
# to no shipped card; it exists for the next new family, which starts
# cpu-only until it, too, earns a tier through real-GPU evidence.
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
# project does not build: 2 of those hits are its mnist/gpt-2 examples, the
# rest are ggml-backend.h/ggml-cpp.h declarations.) So a session holds exactly
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
#   mac-arm64    Apple M4, Metal                        5/5      unrecorded  0.83-3.9x
#
# The win-x64 row predates R32 entirely — it is the 0.5.0 CI wheel, whose
# sk_init logged "28 threads" (= hw), so its CPU numbers are the pessimistic
# oversubscribed ones and its ratios are, if anything, flattering to the GPU.
# The GB10 row is n_threads=8, the value that sweep found optimal on that
# 20-core big.LITTLE box before the knee was fixed at 12 fleet-wide. The M4
# probe did not record a thread count at all.
#
# The mac row holds only AFTER slice-5b task 1's two Metal kernel patches
# (before them moss/qwen3/omnivoice aborted): the resurrected
# GGML_OP_DIAG_MASK_INF/PAD kernels (ruling R30 — native/patches/ggml-metal-
# {diag-mask-inf,pad-leading}.json) plus audiocpp_compat.h's ggml_sub now
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
# real Metal hardware.
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
_TTS_TIER_OVERRIDES: dict[str, tuple[str, ...]] = {
    "moss_tts_nano": ("gpu-vulkan", "gpu-metal", "cpu"),
    "supertonic": ("gpu-vulkan", "gpu-metal", "cpu"),
    "qwen3_tts": ("gpu-vulkan", "gpu-metal", "cpu"),
    "omnivoice": ("gpu-vulkan", "gpu-metal", "cpu"),
    "pocket_tts": ("gpu-vulkan", "gpu-metal", "cpu"),   # ruling R29 (supersedes R28) -- see table above
}


def _tts_gguf_row(mid, name, langs, family, dir_, quants, default_quant, *,
                  order, load_language="", clones=False, streaming=False,
                  sample_rate=24000, named_voices=False, transcript_required=False,
                  recommended=False, extra_files=(), license=None):
    """One native_tts card. `quants` maps QUANT token (the filename's own
    suffix, e.g. "q8_0") -> (filename, bytes) under `dir_` in
    `_AUDIOCPP_GGUF_REPO`; `default_quant` gets rank 2.0, any other listed
    quant gets rank 1.0 — exactly `_llm_translate_row`'s two-rung shape,
    INCLUDING that shape's quant-picking semantics (fix round 1: this is not
    simply "the curated default always wins"): `default_quant` is the RANK
    default — the pin-absent/no-budget-known/nothing-fits fallback
    (`planner._llamacpp_quant`) — while `resolve_tts`'s real auto path
    (`_llamacpp_variant_row`) picks the LARGEST quant that fits the machine's
    budget, which is routinely the bigger, rank-1.0 alt quant (e.g. bf16 over
    the "default" q8_0) once it fits. `extra_files` are (relative-to-`dir_`
    filename, bytes) sidecar assets sk_tts_presets discovers next to the
    loaded gguf (only pocket-tts-en has one: embeddings/alba.safetensors) —
    downloaded alongside every quant and counted once in size_bytes. Tiers come from
    `_TTS_TIER_OVERRIDES.get(family, _TTS_TIERS)` — cpu-only by default, gpu-vulkan and
    gpu-metal added back per family once GB10/M4-validated (see that dict's own
    comment, R19/R25/R36)."""
    deps = []
    tiers = _TTS_TIER_OVERRIDES.get(family, _TTS_TIERS)
    order_keys = [default_quant] + [q for q in quants if q != default_quant]
    for i, q in enumerate(order_keys):
        fname, nbytes = quants[q]
        artifact = f"{_AUDIOCPP_GGUF_REPO}/{dir_}/{fname}"
        rank = 2.0 if i == 0 else 1.0
        deps += [Deployment("native_tts", tier, q, artifact, rank, est_bytes=nbytes)
                 for tier in tiers]
    total_bytes = quants[default_quant][1] + sum(sz for _n, sz in extra_files)
    return TtsModel(mid, name, langs, tuple(deps), family=family,
                    load_language=load_language, clones=clones, streaming=streaming,
                    sample_rate=sample_rate, named_voices=named_voices,
                    transcript_required=transcript_required, recommended=recommended,
                    sort_order=order, size_bytes=total_bytes, extra_files=extra_files,
                    license=license)


SUPERTONIC_LANGS = ("en", "ko", "ja", "ar", "bg", "cs", "da", "de", "el", "es", "et",
                    "fi", "fr", "hi", "hr", "hu", "id", "it", "lt", "lv", "nl", "pl",
                    "pt", "ro", "ru", "sk", "sl", "sv", "tr", "uk", "vi")

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
    # Base checkpoint (audio.cpp's dedicated "...-Base-GGUF" repo — NOT
    # CustomVoice/VoiceDesign, which are separate GGUF repos/families as far
    # as sk_tts_load's family_hint is concerned): clones from a reference
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
