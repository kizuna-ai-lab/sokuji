/**
 * The ASR cards (port of the ASR half of sidecar/sokuji_sidecar/catalog.py). Every ASR card runs on transcribe.cpp
 * (the ggml family, official handy-computer GGUFs): one GGUF serves the gpu-vulkan, gpu-metal and cpu tiers. Quants
 * follow the author's WER-validated cards: Q4_K_M for the big speech LLMs, Q8_0 for whisper/SenseVoice, Q6_K for
 * Fun-ASR-MLT. transcribe.cpp SenseVoice emits raw text (no ITN or punctuation normalisation), accepted with the
 * all-in decision. Pure data: adding a model is adding a row.
 */
import { GGML_TYPE_NAMES } from '../ggufHeader';
import { asrModelCard, deployment, pyRepr, type AsrModel, type Deployment } from './types';

export const TC_TIERS: readonly string[] = ['gpu-vulkan', 'gpu-metal', 'cpu'];
// GPU-only tier set for cards too large to run on CPU in practice (the 24B Voxtral). Dropping "cpu" makes the
// renderer hardware-gate the card off CPU-only machines instead of advertising an unusable multi-GB CPU download.
export const TC_GPU_TIERS: readonly string[] = ['gpu-vulkan', 'gpu-metal'];

/** "model-Q8_0.gguf" → "q8_0". */
export function tcQuant(fname: string): string {
  const tail = fname.slice(fname.lastIndexOf('-') + 1);
  return (tail.endsWith('.gguf') ? tail.slice(0, -'.gguf'.length) : tail).toLowerCase();
}

// Rank encodes the quant's ROLE, not just a tie-break:
//   2.0 = the curated default; 1.0 = curated alternative (recommendation candidate); 0.5 = listed-only — shown in
//   the variant list with a supported flag, but never auto-recommended (e.g. f16: the author's WER tables show no
//   gain over q8_0, so recommending its 2x download would be waste — power users can still pick it).
export const TC_CURATED_MIN_RANK = 1.0;

// Premise 7 (spec A): a rung is not one dtype. The dtype set a pre-download query expands WEIGHT over, when the file
// is not on disk yet; deliberately wide (a *_M file mixes K-quants, the q8_0 TTS files carry BF16 weights, everything
// carries F32). Once the file exists its header's real set — intersected with WEIGHT_CAPABLE_DTYPES — replaces this
// (accel weightDtypes). Spellings are ggml_type_name()'s.
// A GGUF also carries INTEGER tensors (i32/i64: omnivoice, index-tts2, voxcpm2, supertonic-3), but those are index or
// position tables — never the src0 of a MUL_MAT/MUL_MAT_ID/GET_ROWS, i.e. never a rung weight — and Vulkan answers
// `false` to MUL_MAT on an integer type, which would refuse every TTS family on every Vulkan device. Integer types are
// therefore filtered out before expansion, on both layers (accel weightDtypes and sk_ops.cpp), and these sets carry
// only weight-capable types. gen_ops_data.py's WIDEST_FALLBACK is the size of the q4_k_m set — keep them in step.
export const RUNG_FALLBACK_DTYPES: Readonly<Record<string, ReadonlySet<string>>> = {
  q4_k_m: new Set(['q4_K', 'q5_K', 'q6_K', 'q8_0', 'bf16', 'f16', 'f32']),
  q5_k_m: new Set(['q5_K', 'q6_K', 'q8_0', 'bf16', 'f16', 'f32']),
  q6_k: new Set(['q6_K', 'q8_0', 'bf16', 'f16', 'f32']),
  q8_0: new Set(['q8_0', 'bf16', 'f16', 'f32']),
  f16: new Set(['f16', 'f32']),
  bf16: new Set(['bf16', 'f16', 'f32']),
};

// The ggml types a rung-bearing WEIGHT tensor can actually hold: the float types a graph computes in, plus every
// quantized type. Everything else in GGML_TYPE_NAMES (f64 and the i8/i16/i32/i64 index tables) is filtered out of a
// header set before it becomes an expansion set. Derived from GGML_TYPE_NAMES so a new quant spelling needs one edit.
const NON_WEIGHT_DTYPES = new Set(['f64', 'i8', 'i16', 'i32', 'i64']);
export const WEIGHT_CAPABLE_DTYPES: ReadonlySet<string> = new Set([
  'f32', 'f16', 'bf16',
  ...Object.values(GGML_TYPE_NAMES).filter((n) => !NON_WEIGHT_DTYPES.has(n) && !['f32', 'f16', 'bf16'].includes(n)),
]);

const CURATED = new Set(['q8_0', 'q6_k', 'q4_k_m']);
const LADDER = ['F16', 'Q8_0', 'Q6_K', 'Q5_K_M', 'Q4_K_M'] as const;

/**
 * One transcribe.cpp ASR card with its FULL quant ladder. `quants` maps QUANT (filename token, e.g. "Q8_0") to
 * size_bytes; `default` names the curated default. The same GGUF serves every tier. Deployments are ordered
 * default-first so downloads and size_bytes key off the default; q6_k/q4_k_m/q8_0 are curated recommendation
 * candidates, f16/q5_k_m are listed-only. `arch` is the GGUF's `general.architecture` — transcribe.cpp's Arch::name,
 * the string sk_asr_caps.arch reports and the op-recording key (graphFamily). It is NOT always the src/arch/<dir>
 * name (cohere → "cohere_asr", granite → "granite_speech", granite_nar → "granite_speech_nar"). `quants` keys must be
 * ladder tokens: anything else used to be dropped silently, which hid a mistyped rung until download time.
 */
export function tcRow(
  mid: string, name: string, langs: readonly string[], repo: string, base: string, order: number,
  quants: Readonly<Record<string, number>>,
  opts: { default: string; recommended?: boolean; backend?: string; tiers?: readonly string[]; arch?: string },
): AsrModel {
  const { default: def, recommended = false, backend = 'native_asr', tiers = TC_TIERS, arch = '' } = opts;
  const keys = Object.keys(quants);
  const unknown = keys.filter((k) => !(LADDER as readonly string[]).includes(k)).sort();
  if (unknown.length > 0 || !(def in quants)) {
    throw new Error(`${mid}: quants keys must be in ${pyRepr(LADDER, true)} and include default ${pyRepr(def)}; unknown=${pyRepr(unknown)}, keys=${pyRepr([...keys].sort())}`);
  }
  const deps: Deployment[] = [];
  const orderKeys = [def, ...LADDER.filter((q) => q in quants && q !== def)];
  for (const q of orderKeys) {
    const quant = q.toLowerCase();
    const rank = q === def ? 2.0 : (CURATED.has(quant) ? 1.0 : 0.5);
    for (const tier of tiers) deps.push(deployment(backend, tier, quant, `${repo}/${base}-${q}.gguf`, rank, { estBytes: quants[q] }));
  }
  return asrModelCard(mid, name, langs, deps, { recommended, sortOrder: order, sizeBytes: quants[def], graphFamily: arch });
}

// Curated ASR roster (2026-07-05 re-pick from the full transcribe.cpp family).
// sort_order = quality ranking, seeded from the author's UNIFORM benchmark
// (transcribe.cpp-measured librispeech test-clean WER, best rung per model;
// noted per row) — gaps of 10 leave room for hand-tuning; language-specialized
// cards (gigaam: ru) are slotted by their standing WITHIN their language, since
// the renderer's source-language filter means only those users see them.
export const ASR_MODELS: readonly AsrModel[] = [
  // WER 1.25 — best-in-benchmark all-rounder; historical usage #1.
  tcRow(
    'cohere-transcribe-03-2026',
    'Cohere Transcribe',
    ['en', 'de', 'fr', 'it', 'es', 'pt', 'el', 'nl', 'pl', 'ar', 'vi', 'zh', 'ja', 'ko'],
    'handy-computer/cohere-transcribe-03-2026-gguf',
    'cohere-transcribe-03-2026',
    10,
    { F16: 4_106_644_992, Q8_0: 2_410_655_232, Q6_K: 1_972_524_544, Q5_K_M: 1_770_270_208, Q4_K_M: 1_558_162_944 },
    { default: 'Q4_K_M', recommended: true, arch: 'cohere_asr' },
  ),
  // Russian specialist (GigaAM v3, end-to-end w/ punctuation) — no librispeech
  // figure (ru model); slotted top of its language view.
  tcRow(
    'gigaam-v3-e2e-rnnt',
    'GigaAM v3 (Russian)',
    ['ru'],
    'handy-computer/gigaam-v3-e2e-rnnt-gguf',
    'gigaam-v3-e2e-rnnt',
    15,
    { F16: 452_381_408, Q8_0: 273_724_832, Q6_K: 227_953_952, Q5_K_M: 206_392_736, Q4_K_M: 183_948_704 },
    { default: 'Q8_0', arch: 'gigaam' },
  ),
  // Russian second rung — plain RNNT variant (no e2e punctuation head).
  tcRow(
    'gigaam-v3-rnnt',
    'GigaAM v3 RNNT (Russian)',
    ['ru'],
    'handy-computer/gigaam-v3-rnnt-gguf',
    'gigaam-v3-rnnt',
    16,
    { F16: 451_084_832, Q8_0: 273_022_880, Q6_K: 227_252_000, Q5_K_M: 205_690_784, Q4_K_M: 183_246_752 },
    { default: 'Q8_0', arch: 'gigaam' },
  ),
  // WER 1.29 / 1.46 — English/European quality alternates.
  tcRow(
    'granite-speech-4.1-2b',
    'Granite Speech 4.1 (2B)',
    ['en', 'fr', 'de', 'es', 'pt', 'ja'],
    'handy-computer/granite-speech-4.1-2b-gguf',
    'granite-speech-4.1-2b',
    20,
    { F16: 4_632_623_104, Q8_0: 2_559_878_848, Q6_K: 2_024_967_936, Q5_K_M: 1_829_704_544, Q4_K_M: 1_602_904_800 },
    { default: 'Q4_K_M', arch: 'granite_speech' },
  ),
  // WER 1.33 — Granite Speech 5.0 TurboCTC (transcribe.cpp 0.2.4, #159): English-only
  // CTC, sub-GB and CPU-fast (RTF 17 on a Ryzen 4750U). Arch::name granite_speech5_ctc
  // (directory granite5_ctc). The -nc sibling is CC-BY-NC-SA and not listed.
  tcRow(
    'granite-speech-5.0-470m-turboctc',
    'Granite Speech 5.0 TurboCTC (470M)',
    ['en'],
    'handy-computer/granite-speech-5.0-470m-turboctc-gguf',
    'granite-speech-5.0-470m-turboctc',
    22,
    { F16: 947_824_480, Q8_0: 505_606_496, Q6_K: 391_836_000, Q5_K_M: 335_737_184, Q4_K_M: 279_114_080 },
    { default: 'Q8_0', arch: 'granite_speech5_ctc' },
  ),
  // WER 1.38 — the big English parakeet; second-best English figure in the roster.
  tcRow(
    'parakeet-tdt-1.1b',
    'Parakeet TDT 1.1B',
    ['en'],
    'handy-computer/parakeet-tdt-1.1b-gguf',
    'parakeet-tdt-1.1b',
    25,
    { F16: 2_145_162_976, Q8_0: 1_267_288_736, Q6_K: 1_042_509_472, Q5_K_M: 935_758_496, Q4_K_M: 825_248_416 },
    { default: 'Q8_0', arch: 'parakeet' },
  ),
  tcRow(
    'granite-speech-4.1-2b-plus',
    'Granite Speech 4.1 (2B+)',
    ['en', 'fr', 'de', 'es', 'pt'],
    'handy-computer/granite-speech-4.1-2b-plus-gguf',
    'granite-speech-4.1-2b-plus',
    30,
    { F16: 4_229_971_808, Q8_0: 2_345_973_152, Q6_K: 1_859_821_504, Q5_K_M: 1_691_297_088, Q4_K_M: 1_489_663_424 },
    { default: 'Q4_K_M', arch: 'granite_speech' },
  ),
  // WER 1.59 (q4_k_m beats q8_0's 1.62 per the author's table) — en/de/es/fr.
  tcRow(
    'canary-1b-flash',
    'Canary 1B Flash',
    ['en', 'de', 'es', 'fr'],
    'handy-computer/canary-1b-flash-gguf',
    'canary-1b-flash',
    35,
    { F16: 1_785_657_120, Q8_0: 1_048_131_360, Q6_K: 857_603_872, Q5_K_M: 769_563_424, Q4_K_M: 677_141_280 },
    { default: 'Q4_K_M', arch: 'canary' },
  ),
  // WER 1.61 — CJK quality mainstay (verified all-5-langs correct on real clips).
  tcRow(
    'qwen3-asr-1.7b',
    'Qwen3-ASR 1.7B',
    ['zh', 'en', 'ja', 'ko', 'yue', 'ar', 'de', 'es', 'fr', 'it', 'pt', 'ru', 'th', 'vi', 'hi', 'id'],
    'handy-computer/Qwen3-ASR-1.7B-gguf',
    'Qwen3-ASR-1.7B',
    40,
    { F16: 4_091_390_944, Q8_0: 2_185_030_624, Q6_K: 1_692_554_208, Q5_K_M: 1_517_290_464, Q4_K_M: 1_319_830_496 },
    { default: 'Q4_K_M', recommended: true, arch: 'qwen3_asr' },
  ),
  // WER 1.69 (q6_k beats bf16 per the author's table) — 31-language coverage king.
  tcRow(
    'fun-asr-mlt-nano',
    'Fun-ASR MLT Nano',
    [
      'zh', 'en', 'yue', 'ja', 'ko', 'vi', 'id', 'th', 'ms', 'fil', 'ar', 'hi', 'bg', 'hr', 'cs', 'da', 'nl', 'et',
      'fi', 'el', 'hu', 'ga', 'lv', 'lt', 'mt', 'pl', 'pt', 'ro', 'sk', 'sl', 'sv',
    ],
    'handy-computer/Fun-ASR-MLT-Nano-2512-gguf',
    'Fun-ASR-MLT-Nano-2512',
    50,
    { F16: 1_667_504_192, Q8_0: 891_271_232, Q6_K: 690_744_384, Q5_K_M: 631_129_152, Q4_K_M: 556_975_168 },
    { default: 'Q6_K', recommended: true, arch: 'funasr_nano' },
  ),
  // WER 1.78 (q6_k ties bf16 — same quirk as the MLT sibling) — light zh/en/ja.
  tcRow(
    'fun-asr-nano',
    'Fun-ASR Nano',
    ['zh', 'en', 'ja'],
    'handy-computer/Fun-ASR-Nano-2512-gguf',
    'Fun-ASR-Nano-2512',
    55,
    { F16: 1_667_503_872, Q8_0: 891_270_912, Q6_K: 690_744_064, Q5_K_M: 631_128_832, Q4_K_M: 556_974_848 },
    { default: 'Q6_K', arch: 'funasr_nano' },
  ),
  // WER 1.81 — 99-language quality reference.
  tcRow(
    'whisper-large-v3',
    'Whisper large-v3',
    ['multi'],
    'handy-computer/whisper-large-v3-gguf',
    'whisper-large-v3',
    60,
    { F16: 3_107_236_640, Q8_0: 1_668_741_440, Q6_K: 1_297_130_208, Q5_K_M: 1_161_143_008, Q4_K_M: 997_303_008 },
    { default: 'Q8_0', arch: 'whisper' },
  ),
  // WER 1.90 (q5_k_m best rung; default q8_0 lands 1.93) — the tiny/fastest
  // canary rung (en/de/es/fr).
  tcRow(
    'canary-180m-flash',
    'Canary 180M Flash',
    ['en', 'de', 'es', 'fr'],
    'handy-computer/canary-180m-flash-gguf',
    'canary-180m-flash',
    65,
    { F16: 381_632_192, Q8_0: 218_447_552, Q6_K: 176_291_520, Q5_K_M: 158_704_320, Q4_K_M: 139_223_744 },
    { default: 'Q8_0', arch: 'canary' },
  ),
  // WER 1.91 — European quality tier (NVIDIA Canary, 25 langs).
  tcRow(
    'canary-1b-v2',
    'Canary 1B v2',
    [
      'bg', 'hr', 'cs', 'da', 'nl', 'en', 'et', 'fi', 'fr', 'de', 'el', 'hu', 'it', 'lv', 'lt', 'mt', 'pl', 'pt',
      'ro', 'sk', 'sl', 'es', 'sv', 'ru', 'uk',
    ],
    'handy-computer/canary-1b-v2-gguf',
    'canary-1b-v2',
    70,
    { F16: 1_966_111_456, Q8_0: 1_144_290_016, Q6_K: 931_986_144, Q5_K_M: 836_664_032, Q4_K_M: 735_476_448 },
    { default: 'Q8_0', arch: 'canary' },
  ),
  // WER 1.92 at RTF 151 (metal) — the European SPEED tier (NVIDIA TDT).
  tcRow(
    'parakeet-tdt-0.6b-v3',
    'Parakeet TDT 0.6B v3',
    [
      'bg', 'hr', 'cs', 'da', 'nl', 'en', 'et', 'fi', 'fr', 'de', 'el', 'hu', 'it', 'lv', 'lt', 'mt', 'pl', 'pt',
      'ro', 'ru', 'sk', 'sl', 'es', 'sv', 'uk',
    ],
    'handy-computer/parakeet-tdt-0.6b-v3-gguf',
    'parakeet-tdt-0.6b-v3',
    80,
    { F16: 1_255_869_856, Q8_0: 739_508_576, Q6_K: 610_342_240, Q5_K_M: 548_946_272, Q4_K_M: 485_425_504 },
    { default: 'Q8_0', recommended: true, arch: 'parakeet' },
  ),
  // German fine-tune of v3 (primeline, CC-BY-4.0; transcribe.cpp >= 0.2.0):
  // FLEURS-de WER 6.00 vs NeMo's 5.98 — not a librispeech figure, so it sits
  // right behind its base rather than in the WER order. Keeps the other 24
  // v3 languages usable. Inherits v3's `ss`-for-`ß` orthography quirk.
  tcRow(
    'parakeet-primeline',
    'Parakeet Primeline (de)',
    [
      'bg', 'hr', 'cs', 'da', 'nl', 'en', 'et', 'fi', 'fr', 'de', 'el', 'hu', 'it', 'lv', 'lt', 'mt', 'pl', 'pt',
      'ro', 'ru', 'sk', 'sl', 'es', 'sv', 'uk',
    ],
    'handy-computer/parakeet-primeline-gguf',
    'parakeet-primeline',
    81,
    { F16: 1_255_869_920, Q8_0: 739_508_640, Q6_K: 610_342_304, Q5_K_M: 548_946_336, Q4_K_M: 485_425_568 },
    { default: 'Q8_0', arch: 'parakeet' },
  ),
  // WER 1.93 @ Q8_0 — en/zh audio-LLM (Whisper-medium encoder + Qwen3-0.6B;
  // Apache-2.0; transcribe.cpp >= 0.2.0). Batch-only upstream, and its
  // optional inline speaker markers stay OFF (session.run's diarize default),
  // so it transcribes like any other card. Q4_K_M degrades to 2.59 and the
  // author warns of edge-case failures below Q5_K_M — Q8_0 is the default.
  tcRow(
    'moss-transcribe-diarize',
    'MOSS Transcribe (0.9B)',
    ['en', 'zh'],
    'handy-computer/moss-transcribe-diarize-gguf',
    'MOSS-Transcribe-Diarize',
    85,
    { F16: 1_833_665_696, Q8_0: 986_899_616, Q6_K: 768_151_712, Q5_K_M: 700_313_760, Q4_K_M: 617_345_184 },
    { default: 'Q8_0', arch: 'moss' },
  ),
  // WER 2.01 — 99-language mainstay: ~large-v3 quality at 4x the speed.
  // Sizes are the 2026-07-21 re-upload of the repo (quants 64 bytes shorter per
  // file; F16 was re-encoded, ~10.8 MB smaller) — all five match the live tree.
  tcRow(
    'whisper-large-v3-turbo',
    'Whisper large-v3 turbo',
    ['multi'],
    'handy-computer/whisper-large-v3-turbo-gguf',
    'whisper-large-v3-turbo',
    90,
    { F16: 1_625_935_520, Q8_0: 886_381_760, Q6_K: 692_536_928, Q5_K_M: 619_628_128, Q4_K_M: 536_069_728 },
    { default: 'Q8_0', recommended: true, arch: 'whisper' },
  ),
  // WER 2.07 — heavy streaming flagship (committed/tentative partials).
  tcRow(
    'voxtral-mini-4b-realtime',
    'Voxtral Mini 4B Realtime',
    ['en', 'fr', 'es', 'de', 'ru', 'zh', 'ja', 'it', 'pt', 'nl', 'ar', 'hi', 'ko'],
    'handy-computer/Voxtral-Mini-4B-Realtime-2602-gguf',
    'Voxtral-Mini-4B-Realtime-2602',
    100,
    { F16: 8_879_114_528, Q8_0: 4_731_791_648, Q6_K: 3_661_018_912, Q5_K_M: 3_281_439_008, Q4_K_M: 2_830_493_984 },
    { default: 'Q4_K_M', recommended: true, backend: 'native_asr_stream', arch: 'voxtral_realtime' },
  ),
  // WER 2.10 — light CJK quality rung.
  tcRow(
    'qwen3-asr-0.6b',
    'Qwen3-ASR 0.6B',
    ['zh', 'en', 'ja', 'ko', 'yue', 'ar', 'de', 'es', 'fr', 'it', 'pt', 'ru', 'th', 'vi', 'hi', 'id'],
    'handy-computer/Qwen3-ASR-0.6B-gguf',
    'Qwen3-ASR-0.6B',
    110,
    { F16: 1_579_793_056, Q8_0: 850_423_456, Q6_K: 690_417_824, Q5_K_M: 645_356_192, Q4_K_M: 589_560_480 },
    { default: 'Q8_0', arch: 'qwen3_asr' },
  ),
  // WER 2.16 — English STREAMING mid rung (MIT); upstream ships only
  // F16/Q8_0 rungs (plus an F32 we skip — the WER table is flat across all).
  tcRow(
    'moonshine-streaming-medium',
    'Moonshine Streaming Medium',
    ['en'],
    'handy-computer/moonshine-streaming-medium-gguf',
    'moonshine-streaming-medium',
    113,
    { F16: 533_781_408, Q8_0: 295_793_568 },
    { default: 'Q8_0', backend: 'native_asr_stream', arch: 'moonshine_streaming' },
  ),
  // WER 2.18 @ Q8_0 — en-only cache-aware STREAMING, cased+punct (NVIDIA
  // Open Model License; transcribe.cpp >= 0.2.0). The ROOT GGUFs: the repo's
  // bundle/ twins embed a Sortformer diarizer whose multi-speaker output is
  // offline-API only upstream — the stream API is single-speaker either way.
  tcRow(
    'multitalker-parakeet-streaming-0.6b-v1',
    'Parakeet Multitalker Streaming 0.6B (en)',
    ['en'],
    'handy-computer/multitalker-parakeet-streaming-0.6b-v1-gguf',
    'multitalker-parakeet-streaming-0.6b-v1',
    114,
    { F16: 1_246_058_304, Q8_0: 734_123_712, Q6_K: 603_878_080, Q5_K_M: 541_890_240, Q4_K_M: 477_812_416 },
    { default: 'Q8_0', backend: 'native_asr_stream', arch: 'parakeet' },
  ),
  // WER 2.25 — Taiwanese Mandarin + zh/en code-switching (Whisper-large-v2
  // ft); the quant ladder is WER-flat so the smallest curated rung wins.
  tcRow(
    'breeze-asr-25',
    'Breeze ASR 25',
    ['zh', 'en'],
    'handy-computer/Breeze-ASR-25-gguf',
    'Breeze-ASR-25',
    116,
    { F16: 3_106_458_208, Q8_0: 1_667_964_224, Q6_K: 1_296_353_280, Q5_K_M: 1_160_366_080, Q4_K_M: 996_526_080 },
    { default: 'Q4_K_M', arch: 'whisper' },
  ),
  // WER 3.03 — LIGHT streaming, 27 languages incl. zh/ja/ko (author-recommended).
  tcRow(
    'nemotron-3.5-asr-streaming',
    'Nemotron 3.5 ASR Streaming',
    [
      'en', 'es', 'fr', 'it', 'pt', 'nl', 'de', 'tr', 'ru', 'ar', 'hi', 'ja', 'ko', 'vi', 'uk', 'pl', 'sv', 'cs',
      'nb', 'da', 'bg', 'fi', 'hr', 'sk', 'zh', 'hu', 'ro', 'et',
    ],
    'handy-computer/nemotron-3.5-asr-streaming-0.6b-gguf',
    'nemotron-3.5-asr-streaming-0.6b',
    128,
    { F16: 1_277_750_240, Q8_0: 751_094_240, Q6_K: 621_356_512, Q5_K_M: 559_647_200, Q4_K_M: 495_831_520 },
    { default: 'Q8_0', recommended: true, backend: 'native_asr_stream', arch: 'parakeet' },
  ),
  // WER 3.13 at RTF 289 (metal) — fastest/lightest CJK+yue (cased, punctuated by
  // default since transcribe.cpp 0.2.4 — #157).
  tcRow(
    'sense-voice',
    'SenseVoice',
    ['zh', 'en', 'ja', 'ko', 'yue'],
    'handy-computer/SenseVoiceSmall-gguf',
    'SenseVoiceSmall',
    130,
    { F16: 470_412_128, Q8_0: 252_684_608, Q6_K: 196_438_336, Q5_K_M: 172_474_880, Q4_K_M: 145_738_304 },
    { default: 'Q8_0', arch: 'sensevoice' },
  ),
  // WER 5.1 — the minimal 99-language floor for long-tail source languages.
  tcRow(
    'whisper-base',
    'Whisper base',
    ['multi'],
    'handy-computer/whisper-base-gguf',
    'whisper-base',
    140,
    { F16: 151_145_760, Q8_0: 84_962_880, Q6_K: 67_865_664, Q5_K_M: 63_786_048, Q4_K_M: 58_870_848 },
    { default: 'Q8_0', arch: 'whisper' },
  ),
  // --- Expanded roster (2026-07-20): the rest of the transcribe.cpp
  // family. Excludes canary-1b (CC-BY-NC, non-commercial) and medasr
  // (gated). All recommended=False; ordered via asr_models() sort.
  // WER 1.25 (q5_k_m = best rung & default; q4_k_m 1.35 worst) — NAR editor, ASR-only
  tcRow(
    'granite-speech-4.1-2b-nar',
    'Granite Speech 4.1 (2B NAR)',
    ['en', 'fr', 'de', 'es', 'pt'],
    'handy-computer/granite-speech-4.1-2b-nar-gguf',
    'granite-speech-4.1-2b-nar',
    11,
    { F16: 4_515_792_768, Q8_0: 2_498_105_472, Q6_K: 1_977_417_568, Q5_K_M: 1_782_089_344, Q4_K_M: 1_560_008_832 },
    { default: 'Q5_K_M', arch: 'granite_speech_nar' },
  ),
  // Russian (FLEURS-ru 5.50) — e2e w/ punct; slotted in RU view
  tcRow(
    'gigaam-v3-e2e-ctc',
    'GigaAM v3 E2E-CTC (Russian)',
    ['ru'],
    'handy-computer/gigaam-v3-e2e-ctc-gguf',
    'gigaam-v3-e2e-ctc',
    17,
    { F16: 449_098_336, Q8_0: 272_151_136, Q6_K: 226_439_776, Q5_K_M: 204_911_200, Q4_K_M: 182_497_888 },
    { default: 'Q8_0', arch: 'gigaam' },
  ),
  // Russian (FLEURS-ru 8.29) — plain CTC, lowercase/no-punct; RU view
  tcRow(
    'gigaam-v3-ctc',
    'GigaAM v3 CTC (Russian)',
    ['ru'],
    'handy-computer/gigaam-v3-ctc-gguf',
    'gigaam-v3-ctc',
    18,
    { F16: 448_750_528, Q8_0: 271_803_328, Q6_K: 226_091_968, Q5_K_M: 204_563_392, Q4_K_M: 182_150_080 },
    { default: 'Q8_0', arch: 'gigaam' },
  ),
  // WER 1.41 — en, lowercase/no-punct
  tcRow(
    'parakeet-rnnt-1.1b',
    'Parakeet RNNT 1.1B',
    ['en'],
    'handy-computer/parakeet-rnnt-1.1b-gguf',
    'parakeet-rnnt-1.1b',
    26,
    { F16: 2_145_156_480, Q8_0: 1_267_285_248, Q6_K: 1_042_505_984, Q5_K_M: 935_755_008, Q4_K_M: 825_244_928 },
    { default: 'Q8_0', arch: 'parakeet' },
  ),
  // WER 1.41 — en+EU speech-LLM
  tcRow(
    'granite-4.0-1b-speech',
    'Granite Speech 4.0 (1B)',
    ['en', 'fr', 'de', 'es', 'pt', 'ja'],
    'handy-computer/granite-4.0-1b-speech-gguf',
    'granite-4.0-1b-speech',
    27,
    { F16: 4_632_623_104, Q8_0: 2_559_878_848, Q6_K: 2_024_967_936, Q5_K_M: 1_829_704_544, Q4_K_M: 1_602_904_800 },
    { default: 'Q4_K_M', arch: 'granite_speech' },
  ),
  // WER 1.56 — GPU-class 24B (Q5_K_M 17GB+); q4_k_m dropped (2.11 cliff).
  // GPU-only tiers: hardware-gated off CPU-only machines (a 17GB CPU download
  // for a 24B is unusable); big-GPU machines still see it, small-GPU ones get
  // the "needs ~17GB" variant reason string.
  tcRow(
    'voxtral-small-24b',
    'Voxtral Small 24B',
    ['en', 'fr', 'de', 'es', 'it', 'pt', 'nl', 'hi'],
    'handy-computer/Voxtral-Small-24B-2507-gguf',
    'Voxtral-Small-24B-2507',
    31,
    { F16: 48_548_098_528, Q8_0: 25_810_383_328, Q6_K: 19_936_473_568, Q5_K_M: 17_138_659_808 },
    { default: 'Q5_K_M', tiers: TC_GPU_TIERS, arch: 'voxtral' },
  ),
  // WER 1.58 offline — run batch (zero-lookahead streaming collapses to 5.76)
  tcRow(
    'parakeet-unified-en-0.6b',
    'Parakeet Unified 0.6B (en)',
    ['en'],
    'handy-computer/parakeet-unified-en-0.6b-gguf',
    'parakeet-unified-en-0.6b',
    32,
    { F16: 1_239_114_240, Q8_0: 731_357_568, Q6_K: 602_191_232, Q5_K_M: 540_795_264, Q4_K_M: 477_274_496 },
    { default: 'Q8_0', arch: 'parakeet' },
  ),
  // WER 1.59 — en, lowercase/no-punct
  tcRow(
    'parakeet-rnnt-0.6b',
    'Parakeet RNNT 0.6B',
    ['en'],
    'handy-computer/parakeet-rnnt-0.6b-gguf',
    'parakeet-rnnt-0.6b',
    34,
    { F16: 1_235_969_568, Q8_0: 729_687_456, Q6_K: 600_902_048, Q5_K_M: 539_714_976, Q4_K_M: 476_390_816 },
    { default: 'Q8_0', arch: 'parakeet' },
  ),
  // WER 1.63 — SALM audio-LLM, en-only (all quants 1.63)
  tcRow(
    'canary-qwen-2.5b',
    'Canary-Qwen 2.5B',
    ['en'],
    'handy-computer/canary-qwen-2.5b-gguf',
    'canary-qwen-2.5b',
    41,
    { F16: 5_076_972_928, Q8_0: 2_797_548_928, Q6_K: 2_208_697_728, Q5_K_M: 1_983_729_024, Q4_K_M: 1_737_575_808 },
    { default: 'Q4_K_M', arch: 'canary_qwen' },
  ),
  // WER 1.68 — en, cased+punct+timestamps (v3 is multilingual)
  tcRow(
    'parakeet-tdt-0.6b-v2',
    'Parakeet TDT 0.6B v2',
    ['en'],
    'handy-computer/parakeet-tdt-0.6b-v2-gguf',
    'parakeet-tdt-0.6b-v2',
    42,
    { F16: 1_237_334_592, Q8_0: 729_574_912, Q6_K: 600_408_576, Q5_K_M: 539_012_608, Q4_K_M: 475_491_840 },
    { default: 'Q8_0', arch: 'parakeet' },
  ),
  // WER 1.84 — en, fastest 0.6B head, lowercase/no-punct
  tcRow(
    'parakeet-ctc-0.6b',
    'Parakeet CTC 0.6B',
    ['en'],
    'handy-computer/parakeet-ctc-0.6b-gguf',
    'parakeet-ctc-0.6b',
    61,
    { F16: 1_220_181_184, Q8_0: 722_271_424, Q6_K: 593_644_736, Q5_K_M: 532_544_704, Q4_K_M: 469_302_464 },
    { default: 'Q8_0', arch: 'parakeet' },
  ),
  // WER 1.84 — en, lowercase/no-punct
  tcRow(
    'parakeet-ctc-1.1b',
    'Parakeet CTC 1.1B',
    ['en'],
    'handy-computer/parakeet-ctc-1.1b-gguf',
    'parakeet-ctc-1.1b',
    62,
    { F16: 2_129_368_096, Q8_0: 1_259_869_216, Q6_K: 1_035_248_672, Q5_K_M: 928_584_736, Q4_K_M: 818_156_576 },
    { default: 'Q8_0', arch: 'parakeet' },
  ),
  // WER 1.87 — en, hybrid TDT+CTC, cased+punct
  tcRow(
    'parakeet-tdt_ctc-1.1b',
    'Parakeet TDT-CTC 1.1B',
    ['en'],
    'handy-computer/parakeet-tdt_ctc-1.1b-gguf',
    'parakeet-tdt_ctc-1.1b',
    63,
    { F16: 2_145_162_560, Q8_0: 1_267_288_320, Q6_K: 1_042_509_056, Q5_K_M: 935_758_080, Q4_K_M: 825_248_000 },
    { default: 'Q8_0', arch: 'parakeet' },
  ),
  // WER 1.87 — offline audio-LLM (q4_k_m 2.98GB)
  tcRow(
    'voxtral-mini-3b',
    'Voxtral Mini 3B',
    ['en', 'fr', 'de', 'es', 'it', 'pt', 'nl', 'hi'],
    'handy-computer/Voxtral-Mini-3B-2507-gguf',
    'Voxtral-Mini-3B-2507',
    64,
    { F16: 9_376_578_208, Q8_0: 5_000_084_128, Q6_K: 3_869_489_824, Q5_K_M: 3_464_182_432, Q4_K_M: 2_984_721_056 },
    { default: 'Q4_K_M', arch: 'voxtral' },
  ),
  // WER 2.29 — en-only cache-aware STREAMING (NVIDIA Open Model License)
  tcRow(
    'nemotron-speech-streaming-en',
    'Nemotron Speech Streaming (en)',
    ['en'],
    'handy-computer/nemotron-speech-streaming-en-0.6b-gguf',
    'nemotron-speech-streaming-en-0.6b',
    117,
    { F16: 1_237_652_608, Q8_0: 729_650_176, Q6_K: 600_420_352, Q5_K_M: 538_989_568, Q4_K_M: 475_436_032 },
    { default: 'Q8_0', backend: 'native_asr_stream', arch: 'parakeet' },
  ),
  // WER 2.43 — en, small/fast, cased+punct
  tcRow(
    'parakeet-tdt_ctc-110m',
    'Parakeet TDT-CTC 110M',
    ['en'],
    'handy-computer/parakeet-tdt_ctc-110m-gguf',
    'parakeet-tdt_ctc-110m',
    118,
    { F16: 229_334_560, Q8_0: 135_373_280, Q6_K: 112_311_264, Q5_K_M: 101_335_520, Q4_K_M: 89_989_600 },
    { default: 'Q8_0', arch: 'parakeet' },
  ),
  // WER 2.46 — 99-lang 1.55B (pre-v3)
  tcRow(
    'whisper-large-v2',
    'Whisper large-v2',
    ['multi'],
    'handy-computer/whisper-large-v2-gguf',
    'whisper-large-v2',
    119,
    { F16: 3_106_458_208, Q8_0: 1_667_964_224, Q6_K: 1_296_353_280, Q5_K_M: 1_160_366_080, Q4_K_M: 996_526_080 },
    { default: 'Q8_0', arch: 'whisper' },
  ),
  // WER 2.53 — en STREAMING 123M (F16/Q8_0 only)
  tcRow(
    'moonshine-streaming-small',
    'Moonshine Streaming Small',
    ['en'],
    'handy-computer/moonshine-streaming-small-gguf',
    'moonshine-streaming-small',
    121,
    { F16: 282_092_128, Q8_0: 198_506_848 },
    { default: 'Q8_0', backend: 'native_asr_stream', arch: 'moonshine_streaming' },
  ),
  // WER 2.59 — 99-lang 769M
  tcRow(
    'whisper-medium',
    'Whisper medium',
    ['multi'],
    'handy-computer/whisper-medium-gguf',
    'whisper-medium',
    122,
    { F16: 1_541_931_424, Q8_0: 831_538_144, Q6_K: 648_019_904, Q5_K_M: 582_746_048, Q4_K_M: 504_102_848 },
    { default: 'Q8_0', arch: 'whisper' },
  ),
  // WER 2.62 — 99-lang 1.55B (v1)
  tcRow(
    'whisper-large',
    'Whisper large',
    ['multi'],
    'handy-computer/whisper-large-gguf',
    'whisper-large',
    123,
    { F16: 3_106_458_176, Q8_0: 1_667_964_192, Q6_K: 1_296_353_248, Q5_K_M: 1_160_366_048, Q4_K_M: 996_526_048 },
    { default: 'Q8_0', arch: 'whisper' },
  ),
  // WER 2.72 — en-only 769M
  tcRow(
    'whisper-medium.en',
    'Whisper medium.en',
    ['en'],
    'handy-computer/whisper-medium.en-gguf',
    'whisper-medium.en',
    124,
    { F16: 1_541_853_248, Q8_0: 831_460_928, Q6_K: 647_942_912, Q5_K_M: 582_669_056, Q4_K_M: 504_025_856 },
    { default: 'Q8_0', arch: 'whisper' },
  ),
  // WER 2.97 — en-only 244M
  tcRow(
    'whisper-small.en',
    'Whisper small.en',
    ['en'],
    'handy-computer/whisper-small.en-gguf',
    'whisper-small.en',
    125,
    { F16: 492_810_784, Q8_0: 269_674_144, Q6_K: 212_030_528, Q5_K_M: 193_672_256, Q4_K_M: 171_553_856 },
    { default: 'Q8_0', arch: 'whisper' },
  ),
  // WER 3.26 — en OFFLINE 61M (F16/Q8_0 only)
  tcRow(
    'moonshine-base',
    'Moonshine Base',
    ['en'],
    'handy-computer/moonshine-base-gguf',
    'moonshine-base',
    131,
    { F16: 131_789_440, Q8_0: 77_476_480 },
    { default: 'Q8_0', arch: 'moonshine' },
  ),
  // WER 3.33 — 99-lang 244M
  tcRow(
    'whisper-small',
    'Whisper small',
    ['multi'],
    'handy-computer/whisper-small-gguf',
    'whisper-small',
    132,
    { F16: 492_888_480, Q8_0: 269_751_136, Q6_K: 212_107_328, Q5_K_M: 193_749_056, Q4_K_M: 171_630_656 },
    { default: 'Q8_0', arch: 'whisper' },
  ),
  // WER 4.13 — en-only 74M
  tcRow(
    'whisper-base.en',
    'Whisper base.en',
    ['en'],
    'handy-computer/whisper-base.en-gguf',
    'whisper-base.en',
    133,
    { F16: 151_068_608, Q8_0: 84_886_208, Q6_K: 67_789_088, Q5_K_M: 63_709_472, Q4_K_M: 58_794_272 },
    { default: 'Q8_0', arch: 'whisper' },
  ),
  // WER 4.52 — en STREAMING 34M (F16/Q8_0 only)
  tcRow(
    'moonshine-streaming-tiny',
    'Moonshine Streaming Tiny',
    ['en'],
    'handy-computer/moonshine-streaming-tiny-gguf',
    'moonshine-streaming-tiny',
    134,
    { F16: 89_784_416, Q8_0: 50_462_816 },
    { default: 'Q8_0', backend: 'native_asr_stream', arch: 'moonshine_streaming' },
  ),
  // WER 4.58 — en OFFLINE 27M (F16/Q8_0 only)
  tcRow(
    'moonshine-tiny',
    'Moonshine Tiny',
    ['en'],
    'handy-computer/moonshine-tiny-gguf',
    'moonshine-tiny',
    135,
    { F16: 59_244_192, Q8_0: 35_466_912 },
    { default: 'Q8_0', arch: 'moonshine' },
  ),
  // WER 5.72 — en-only 39M
  tcRow(
    'whisper-tiny.en',
    'Whisper tiny.en',
    ['en'],
    'handy-computer/whisper-tiny.en-gguf',
    'whisper-tiny.en',
    141,
    { F16: 80_058_464, Q8_0: 45_904_544, Q6_K: 44_761_760, Q5_K_M: 44_135_072, Q4_K_M: 43_545_248 },
    { default: 'Q8_0', arch: 'whisper' },
  ),
  // WER 7.49 — 99-lang 39M (least accurate whisper)
  tcRow(
    'whisper-tiny',
    'Whisper tiny',
    ['multi'],
    'handy-computer/whisper-tiny-gguf',
    'whisper-tiny',
    142,
    { F16: 80_135_360, Q8_0: 45_981_088, Q6_K: 44_838_304, Q5_K_M: 44_211_616, Q4_K_M: 43_621_792 },
    { default: 'Q8_0', arch: 'whisper' },
  ),
  // per-language fine-tune (ar); no upstream WER/doc
  tcRow(
    'moonshine-base-ar',
    'Moonshine Base (ar)',
    ['ar'],
    'handy-computer/moonshine-base-ar-gguf',
    'moonshine-base-ar',
    150,
    { F16: 131_789_440, Q8_0: 77_476_480 },
    { default: 'Q8_0', arch: 'moonshine' },
  ),
  // per-language fine-tune (ja); no upstream WER/doc
  tcRow(
    'moonshine-base-ja',
    'Moonshine Base (ja)',
    ['ja'],
    'handy-computer/moonshine-base-ja-gguf',
    'moonshine-base-ja',
    151,
    { F16: 131_789_440, Q8_0: 77_476_480 },
    { default: 'Q8_0', arch: 'moonshine' },
  ),
  // per-language fine-tune (ko); no upstream WER/doc
  tcRow(
    'moonshine-base-ko',
    'Moonshine Base (ko)',
    ['ko'],
    'handy-computer/moonshine-base-ko-gguf',
    'moonshine-base-ko',
    152,
    { F16: 131_789_440, Q8_0: 77_476_480 },
    { default: 'Q8_0', arch: 'moonshine' },
  ),
  // per-language fine-tune (uk); no upstream WER/doc
  tcRow(
    'moonshine-base-uk',
    'Moonshine Base (uk)',
    ['uk'],
    'handy-computer/moonshine-base-uk-gguf',
    'moonshine-base-uk',
    153,
    { F16: 131_789_472, Q8_0: 77_476_512 },
    { default: 'Q8_0', arch: 'moonshine' },
  ),
  // per-language fine-tune (vi); no upstream WER/doc
  tcRow(
    'moonshine-base-vi',
    'Moonshine Base (vi)',
    ['vi'],
    'handy-computer/moonshine-base-vi-gguf',
    'moonshine-base-vi',
    154,
    { F16: 131_789_472, Q8_0: 77_476_512 },
    { default: 'Q8_0', arch: 'moonshine' },
  ),
  // per-language fine-tune (zh); no upstream WER/doc
  tcRow(
    'moonshine-base-zh',
    'Moonshine Base (zh)',
    ['zh'],
    'handy-computer/moonshine-base-zh-gguf',
    'moonshine-base-zh',
    155,
    { F16: 131_789_440, Q8_0: 77_476_480 },
    { default: 'Q8_0', arch: 'moonshine' },
  ),
  // per-language fine-tune (ar); no upstream WER/doc
  tcRow(
    'moonshine-tiny-ar',
    'Moonshine Tiny (ar)',
    ['ar'],
    'handy-computer/moonshine-tiny-ar-gguf',
    'moonshine-tiny-ar',
    156,
    { F16: 59_244_224, Q8_0: 35_466_944 },
    { default: 'Q8_0', arch: 'moonshine' },
  ),
  // per-language fine-tune (ja); no upstream WER/doc
  tcRow(
    'moonshine-tiny-ja',
    'Moonshine Tiny (ja)',
    ['ja'],
    'handy-computer/moonshine-tiny-ja-gguf',
    'moonshine-tiny-ja',
    157,
    { F16: 59_244_224, Q8_0: 35_466_944 },
    { default: 'Q8_0', arch: 'moonshine' },
  ),
  // per-language fine-tune (ko); no upstream WER/doc
  tcRow(
    'moonshine-tiny-ko',
    'Moonshine Tiny (ko)',
    ['ko'],
    'handy-computer/moonshine-tiny-ko-gguf',
    'moonshine-tiny-ko',
    158,
    { F16: 59_244_224, Q8_0: 35_466_944 },
    { default: 'Q8_0', arch: 'moonshine' },
  ),
  // per-language fine-tune (uk); no upstream WER/doc
  tcRow(
    'moonshine-tiny-uk',
    'Moonshine Tiny (uk)',
    ['uk'],
    'handy-computer/moonshine-tiny-uk-gguf',
    'moonshine-tiny-uk',
    159,
    { F16: 59_244_224, Q8_0: 35_466_944 },
    { default: 'Q8_0', arch: 'moonshine' },
  ),
  // per-language fine-tune (vi); no upstream WER/doc
  tcRow(
    'moonshine-tiny-vi',
    'Moonshine Tiny (vi)',
    ['vi'],
    'handy-computer/moonshine-tiny-vi-gguf',
    'moonshine-tiny-vi',
    160,
    { F16: 59_244_224, Q8_0: 35_466_944 },
    { default: 'Q8_0', arch: 'moonshine' },
  ),
  // per-language fine-tune (zh); no upstream WER/doc
  tcRow(
    'moonshine-tiny-zh',
    'Moonshine Tiny (zh)',
    ['zh'],
    'handy-computer/moonshine-tiny-zh-gguf',
    'moonshine-tiny-zh',
    161,
    { F16: 59_244_224, Q8_0: 35_466_944 },
    { default: 'Q8_0', arch: 'moonshine' },
  ),
];

/** Rank-ordered (sortOrder ascending) whatever the table's arrangement. */
export function asrModels(): AsrModel[] {
  return [...ASR_MODELS].sort((a, b) => a.sortOrder - b.sortOrder);
}

export function asrModel(modelId: string): AsrModel | null {
  return ASR_MODELS.find((m) => m.id === modelId) ?? null;
}
