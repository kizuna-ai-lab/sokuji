/**
 * Model Manifest — Single source of truth for all local inference models.
 *
 * All model metadata (identity, languages, download info, file lists) lives here.
 * Engines, stores, and UI all read from this manifest.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ModelFileEntry {
  /** Filename within the model directory (e.g. 'sherpa-onnx-wasm-main-vad-asr.wasm') */
  filename: string;
  /** File size in bytes */
  sizeBytes: number;
}

export type ModelType = 'asr' | 'asr-stream' | 'tts' | 'translation';
export type ModelStatus = 'not_downloaded' | 'downloading' | 'downloaded' | 'error';
export type TtsEngineType = 'piper' | 'coqui' | 'mimic3' | 'mms' | 'matcha' | 'kokoro' | 'vits';

/** Offline ASR engine types — determines which config builder the worker uses. */
export type AsrEngineType =
  | 'sensevoice' | 'whisper' | 'transducer' | 'nemo-transducer'
  | 'paraformer' | 'telespeech' | 'moonshine' | 'moonshine-v2'
  | 'dolphin' | 'zipformer-ctc' | 'nemo-ctc' | 'canary'
  | 'wenet-ctc' | 'omnilingual';

/** Streaming ASR engine types — for future use when streaming gets explicit config. */
export type StreamAsrEngineType =
  | 'stream-transducer' | 'stream-nemo-ctc';

/** Engine-specific config fields for TTS models (matcha, kokoro, vits special). */
export interface TtsModelConfig {
  acousticModel?: string;  // matcha: e.g. './model-steps-3.onnx'
  vocoder?: string;        // matcha: e.g. './vocos-22khz-univ.onnx'
  lexicon?: string;        // matcha/kokoro/vits: e.g. './lexicon.txt'
  dataDir?: string;        // override engine default: './espeak-ng-data' or ''
  dictDir?: string;        // vits: e.g. './dict'
  ruleFsts?: string;       // comma-separated FST paths
  ruleFars?: string;       // comma-separated FAR paths
}

export interface ModelManifestEntry {
  // ─── Identity ──────────────────────────────────────────────────────────
  /** Unique model identifier (e.g. 'sensevoice', 'piper-en', 'opus-mt-ja-en') */
  id: string;
  type: ModelType;
  /** Human-readable name */
  name: string;
  /** Languages supported by this model */
  languages: string[];
  /** True for models supporting any pair of their listed languages */
  multilingual?: boolean;

  // ─── Download & hosting ────────────────────────────────────────────────
  // Models are hosted in two ways:
  //   1. Self-hosted HF datasets: cdnPath → {type-specific-base}/{cdnPath}/{file}
  //      Used by: sherpa-onnx ASR, streaming ASR, TTS
  //   2. Third-party HF Hub repos: hfModelId → {hf-hub-base}/{hfModelId}/resolve/main/{file}
  //      Used by: Whisper WebGPU ASR, Opus-MT translation, Qwen translation
  /** List of files that must be downloaded */
  files?: ModelFileEntry[];
  /** Self-hosted HF dataset path segment (e.g. 'wasm-sensevoice-int8') */
  cdnPath?: string;
  /** Third-party HuggingFace Hub model ID (e.g. 'onnx-community/whisper-tiny.en', 'Xenova/opus-mt-ja-en') */
  hfModelId?: string;

  // ─── Hardware requirements ─────────────────────────────────────────────
  /** Hardware requirement — model filtered out if device unavailable */
  requiredDevice?: 'webgpu';
  /** ONNX dtype for WebGPU models. String for single-file, Record for multi-component models. */
  dtype?: string | Record<string, string>;

  // ─── ASR configuration ─────────────────────────────────────────────────
  /** ASR engine type — determines which config builder the worker uses */
  asrEngine?: AsrEngineType | StreamAsrEngineType;
  /** Which ASR worker to use. Defaults to 'sherpa-onnx' if omitted. */
  asrWorkerType?: 'sherpa-onnx' | 'whisper-webgpu';

  // ─── TTS configuration ─────────────────────────────────────────────────
  /** TTS .onnx model filename */
  modelFile?: string;
  /** TTS engine type — determines how the worker builds the sherpa-onnx config */
  engine?: TtsEngineType;
  /** Engine-specific config for matcha/kokoro/vits models */
  ttsConfig?: TtsModelConfig;
  /** Number of speaker voices available (1 = single-speaker) */
  numSpeakers?: number;

  // ─── Translation configuration ─────────────────────────────────────────
  sourceLang?: string;
  targetLang?: string;
  /** Which translation worker to use. Defaults to 'opus-mt' if omitted. */
  translationWorkerType?: 'opus-mt' | 'qwen' | 'qwen35';
}

// ─── Download URL Configuration ─────────────────────────────────────────────

/**
 * Two hosting patterns for model files:
 *
 * 1. Self-hosted HF datasets: Files hosted in our own HuggingFace dataset repos.
 *    URL pattern: {BASE}/{cdnPath}/{filename}
 *    Used by: sherpa-onnx ASR, streaming ASR, TTS models
 *
 * 2. Third-party HF Hub: Files hosted in public HF model repos by other organizations.
 *    URL pattern: {BASE}/{hfModelId}/resolve/main/{filename}
 *    Used by: Whisper WebGPU ASR, Opus-MT translation, Qwen translation models
 */
const SELF_HOSTED_ASR_BASE = 'https://huggingface.co/datasets/jiangzhuo9357/sherpa-onnx-asr-models/resolve/main';
const SELF_HOSTED_TTS_BASE = 'https://huggingface.co/datasets/jiangzhuo9357/sherpa-onnx-tts-models/resolve/main';
const HF_HUB_BASE = 'https://huggingface.co';

/**
 * CDN base URLs. Override defaults with env vars for self-hosted CDN mirrors.
 *
 * - VITE_ASR_CDN_BASE: Self-hosted ASR models (default: HF dataset repo)
 * - VITE_TTS_CDN_BASE: Self-hosted TTS models (default: HF dataset repo)
 * - VITE_HF_HUB_BASE:  Third-party HF Hub models (default: huggingface.co)
 *   (VITE_TRANSLATION_CDN_BASE also accepted for backward compatibility)
 */
function getSelfHostedAsrBase(): string {
  return (import.meta as any).env?.VITE_ASR_CDN_BASE || SELF_HOSTED_ASR_BASE;
}
function getSelfHostedTtsBase(): string {
  return (import.meta as any).env?.VITE_TTS_CDN_BASE || SELF_HOSTED_TTS_BASE;
}
function getHfHubBase(): string {
  return (import.meta as any).env?.VITE_HF_HUB_BASE
    || (import.meta as any).env?.VITE_TRANSLATION_CDN_BASE
    || HF_HUB_BASE;
}

/**
 * Download URL for a model file. Dispatches by hosting source:
 *
 * - hfModelId set → third-party HF Hub: {HF_HUB_BASE}/{hfModelId}/resolve/main/{filename}
 * - cdnPath set   → self-hosted dataset: {TYPE_BASE}/{cdnPath}/{filename}
 *
 * Exactly one of hfModelId or cdnPath should be set on each manifest entry.
 */
export function getModelDownloadUrl(
  entry: { type: ModelType; cdnPath?: string; hfModelId?: string },
  filename: string,
): string {
  // Third-party HF Hub models (Whisper WebGPU, Opus-MT, Qwen)
  if (entry.hfModelId) {
    return `${getHfHubBase()}/${entry.hfModelId}/resolve/main/${filename}`;
  }

  // Self-hosted HF dataset models (sherpa-onnx ASR, streaming ASR, TTS)
  if (entry.cdnPath) {
    return entry.type === 'tts'
      ? `${getSelfHostedTtsBase()}/${entry.cdnPath}/${filename}`
      : `${getSelfHostedAsrBase()}/${entry.cdnPath}/${filename}`;
  }

  throw new Error(`Model has no download path: neither cdnPath nor hfModelId is set`);
}

/**
 * Base path for bundled TTS runtime files (JS/WASM shared across all models).
 * These are shipped with the app at build time to avoid Chrome extension
 * restrictions on downloading and executing JS/WASM at runtime.
 */
export const TTS_BUNDLED_RUNTIME_PATH = './wasm/sherpa-onnx-tts';

/**
 * Base path for bundled ASR runtime files (JS/WASM shared across all offline models).
 * Offline ASR includes VAD + OfflineRecognizer.
 */
export const ASR_BUNDLED_RUNTIME_PATH = './wasm/sherpa-onnx-asr';

/**
 * Base path for bundled streaming ASR runtime files (JS/WASM shared across all streaming models).
 * Streaming ASR uses OnlineRecognizer (no VAD).
 */
export const ASR_STREAM_BUNDLED_RUNTIME_PATH = './wasm/sherpa-onnx-asr-stream';

// ─── Shared File Lists ───────────────────────────────────────────────────────
// ASR runtime JS/WASM are bundled with the app (identical across all models).
// Only model-specific .data + package-metadata.json need downloading.

/** Build per-model offline ASR file list with accurate sizes. */
function asrFiles(dataSize: number, metadataSize: number): ModelFileEntry[] {
  return [
    { filename: 'sherpa-onnx-wasm-main-vad-asr.data', sizeBytes: dataSize },
    { filename: 'package-metadata.json', sizeBytes: metadataSize },
  ];
}

/** Build per-model streaming ASR file list with accurate sizes. */
function streamAsrFiles(dataSize: number, metadataSize: number): ModelFileEntry[] {
  return [
    { filename: 'sherpa-onnx-wasm-main-asr.data', sizeBytes: dataSize },
    { filename: 'package-metadata.json', sizeBytes: metadataSize },
  ];
}

// TTS runtime JS/WASM are bundled with the app at /wasm/sherpa-onnx-tts/
// (identical across all models). Only model-specific files need downloading.
/** Build per-model TTS file list with accurate sizes from HuggingFace. */
function ttsFiles(dataSize: number, metadataSize: number): ModelFileEntry[] {
  return [
    { filename: 'sherpa-onnx-wasm-main-tts.data', sizeBytes: dataSize },
    { filename: 'package-metadata.json', sizeBytes: metadataSize },
  ];
}

// Translation models (Opus-MT via Transformers.js) have per-model file sizes
// fetched from HuggingFace API. Downloaded directly from HuggingFace Hub.
/** Build per-model translation file list with accurate sizes from HuggingFace. */
function translationFiles(
  config: number, genConfig: number, tokenizer: number,
  tokenizerConfig: number, encoder: number, decoder: number,
): ModelFileEntry[] {
  return [
    { filename: 'config.json', sizeBytes: config },
    { filename: 'generation_config.json', sizeBytes: genConfig },
    { filename: 'tokenizer.json', sizeBytes: tokenizer },
    { filename: 'tokenizer_config.json', sizeBytes: tokenizerConfig },
    { filename: 'onnx/encoder_model_quantized.onnx', sizeBytes: encoder },
    { filename: 'onnx/decoder_model_merged_quantized.onnx', sizeBytes: decoder },
  ];
}

/** Qwen2.5-0.5B-Instruct file list (q4 ONNX via WebGPU). */
function qwenTranslationFiles(): ModelFileEntry[] {
  return [
    { filename: 'config.json', sizeBytes: 678 },
    { filename: 'generation_config.json', sizeBytes: 242 },
    { filename: 'tokenizer.json', sizeBytes: 7_031_673 },
    { filename: 'tokenizer_config.json', sizeBytes: 7_306 },
    { filename: 'onnx/model_q4.onnx', sizeBytes: 786_156_820 },
  ];
}

/** Qwen3-0.6B-ONNX file list (q4 ONNX via WebGPU). Using q4 instead of q4f16 for wider GPU compatibility (q4f16 requires shader-f16). */
function qwen3TranslationFiles(): ModelFileEntry[] {
  return [
    { filename: 'config.json', sizeBytes: 912 },
    { filename: 'generation_config.json', sizeBytes: 219 },
    { filename: 'tokenizer.json', sizeBytes: 9_117_040 },
    { filename: 'tokenizer_config.json', sizeBytes: 9_705 },
    { filename: 'onnx/model_q4.onnx', sizeBytes: 919_096_585 },
  ];
}

/** Qwen3.5-0.8B-ONNX file list (q4 mixed dtype via WebGPU, VLM architecture). */
function qwen35_08bTranslationFiles(): ModelFileEntry[] {
  return [
    { filename: 'config.json', sizeBytes: 2_849 },
    { filename: 'generation_config.json', sizeBytes: 248 },
    { filename: 'preprocessor_config.json', sizeBytes: 336 },
    { filename: 'processor_config.json', sizeBytes: 1_300 },
    { filename: 'tokenizer.json', sizeBytes: 19_226_111 },
    { filename: 'tokenizer_config.json', sizeBytes: 9_161 },
    { filename: 'onnx/embed_tokens_q4.onnx', sizeBytes: 857 },
    { filename: 'onnx/embed_tokens_q4.onnx_data', sizeBytes: 162_897_920 },
    { filename: 'onnx/vision_encoder_q4.onnx', sizeBytes: 184_854 },
    { filename: 'onnx/vision_encoder_q4.onnx_data', sizeBytes: 68_267_008 },
    { filename: 'onnx/decoder_model_merged_q4.onnx', sizeBytes: 881_569 },
    { filename: 'onnx/decoder_model_merged_q4.onnx_data', sizeBytes: 485_425_152 },
  ];
}

/** Qwen3.5-2B-ONNX file list (q4 mixed dtype via WebGPU, VLM architecture). */
function qwen35_2bTranslationFiles(): ModelFileEntry[] {
  return [
    { filename: 'config.json', sizeBytes: 2_993 },
    { filename: 'generation_config.json', sizeBytes: 248 },
    { filename: 'preprocessor_config.json', sizeBytes: 336 },
    { filename: 'processor_config.json', sizeBytes: 1_300 },
    { filename: 'tokenizer.json', sizeBytes: 19_226_111 },
    { filename: 'tokenizer_config.json', sizeBytes: 9_161 },
    { filename: 'onnx/embed_tokens_q4.onnx', sizeBytes: 857 },
    { filename: 'onnx/embed_tokens_q4.onnx_data', sizeBytes: 325_795_840 },
    { filename: 'onnx/vision_encoder_q4.onnx', sizeBytes: 338_758 },
    { filename: 'onnx/vision_encoder_q4.onnx_data', sizeBytes: 217_952_256 },
    { filename: 'onnx/decoder_model_merged_q4.onnx', sizeBytes: 885_982 },
    { filename: 'onnx/decoder_model_merged_q4.onnx_data', sizeBytes: 1_209_126_912 },
  ];
}

/**
 * Whisper WebGPU ASR models (via @huggingface/transformers).
 * Files downloaded directly from HuggingFace Hub. Sizes from HF API.
 * dtype: encoder_model=fp32, decoder_model_merged=q4 for WebGPU.
 */
function whisperFiles(
  config: number, genConfig: number, preprocessor: number,
  tokenizer: number, tokenizerConfig: number,
  encoder: number, decoder: number,
  extra?: { normalizer?: number; addedTokens?: number; specialTokensMap?: number;
            vocab?: number; merges?: number },
  /** Encoder quantization suffix, e.g. '_q4', '_fp16'. Default '' = fp32 */
  encoderQuant?: string,
): ModelFileEntry[] {
  const files: ModelFileEntry[] = [
    { filename: 'config.json', sizeBytes: config },
    { filename: 'generation_config.json', sizeBytes: genConfig },
    { filename: 'preprocessor_config.json', sizeBytes: preprocessor },
    { filename: 'tokenizer.json', sizeBytes: tokenizer },
    { filename: 'tokenizer_config.json', sizeBytes: tokenizerConfig },
    { filename: `onnx/encoder_model${encoderQuant ?? ''}.onnx`, sizeBytes: encoder },
    { filename: 'onnx/decoder_model_merged_q4.onnx', sizeBytes: decoder },
  ];
  if (extra?.normalizer) files.push({ filename: 'normalizer.json', sizeBytes: extra.normalizer });
  if (extra?.addedTokens) files.push({ filename: 'added_tokens.json', sizeBytes: extra.addedTokens });
  if (extra?.specialTokensMap) files.push({ filename: 'special_tokens_map.json', sizeBytes: extra.specialTokensMap });
  if (extra?.vocab) files.push({ filename: 'vocab.json', sizeBytes: extra.vocab });
  if (extra?.merges) files.push({ filename: 'merges.txt', sizeBytes: extra.merges });
  return files;
}

// ─── Model Manifest ──────────────────────────────────────────────────────────

export const MODEL_MANIFEST: ModelManifestEntry[] = [

  // ── Offline VAD+ASR Models — self-hosted (22) ───────────────────────────
  // Downloaded from jiangzhuo9357/sherpa-onnx-asr-models dataset. Uses cdnPath.
  // SenseVoice
  {
    id: 'sensevoice-int8',
    type: 'asr',
    name: 'SenseVoice (int8)',
    languages: ['zh', 'en', 'ja', 'ko', 'cantonese'],
    cdnPath: 'wasm-sensevoice-int8',
    files: asrFiles(238_075_295, 229),
    asrEngine: 'sensevoice',
  },
  {
    id: 'sensevoice-nano-int8',
    type: 'asr',
    name: 'SenseVoice Nano (int8)',
    languages: ['zh', 'en', 'ja', 'ko', 'cantonese'],
    cdnPath: 'wasm-sensevoice-nano-int8',
    files: asrFiles(265_115_571, 229),
    asrEngine: 'sensevoice',
  },
  // Moonshine
  {
    id: 'moonshine-tiny-en-quant',
    type: 'asr',
    name: 'Moonshine Tiny EN (quantized)',
    languages: ['en'],
    cdnPath: 'wasm-moonshine-tiny-en-quant',
    files: asrFiles(44_900_404, 355),
    asrEngine: 'moonshine-v2',
  },
  {
    id: 'moonshine-tiny-ja-quant',
    type: 'asr',
    name: 'Moonshine Tiny JA (quantized)',
    languages: ['ja'],
    cdnPath: 'wasm-moonshine-tiny-ja-quant',
    files: asrFiles(72_772_004, 355),
    asrEngine: 'moonshine-v2',
  },
  {
    id: 'moonshine-tiny-ko-quant',
    type: 'asr',
    name: 'Moonshine Tiny KO (quantized)',
    languages: ['ko'],
    cdnPath: 'wasm-moonshine-tiny-ko-quant',
    files: asrFiles(72_772_060, 355),
    asrEngine: 'moonshine-v2',
  },
  {
    id: 'moonshine-base-zh-quant',
    type: 'asr',
    name: 'Moonshine Base ZH (quantized)',
    languages: ['zh'],
    cdnPath: 'wasm-moonshine-base-zh-quant',
    files: asrFiles(141_957_884, 363),
    asrEngine: 'moonshine-v2',
  },
  {
    id: 'moonshine-base-ja-quant',
    type: 'asr',
    name: 'Moonshine Base JA (quantized)',
    languages: ['ja'],
    cdnPath: 'wasm-moonshine-base-ja-quant',
    files: asrFiles(141_957_788, 363),
    asrEngine: 'moonshine-v2',
  },
  {
    id: 'moonshine-base-es-quant',
    type: 'asr',
    name: 'Moonshine Base ES (quantized)',
    languages: ['es'],
    cdnPath: 'wasm-moonshine-base-es-quant',
    files: asrFiles(65_765_808, 355),
    asrEngine: 'moonshine-v2',
  },
  {
    id: 'moonshine-base-ar-quant',
    type: 'asr',
    name: 'Moonshine Base AR (quantized)',
    languages: ['ar'],
    cdnPath: 'wasm-moonshine-base-ar-quant',
    files: asrFiles(141_957_924, 363),
    asrEngine: 'moonshine-v2',
  },
  {
    id: 'moonshine-base-uk-quant',
    type: 'asr',
    name: 'Moonshine Base UK (quantized)',
    languages: ['uk'],
    cdnPath: 'wasm-moonshine-base-uk-quant',
    files: asrFiles(141_957_788, 363),
    asrEngine: 'moonshine-v2',
  },
  {
    id: 'moonshine-base-vi-quant',
    type: 'asr',
    name: 'Moonshine Base VI (quantized)',
    languages: ['vi'],
    cdnPath: 'wasm-moonshine-base-vi-quant',
    files: asrFiles(141_957_884, 363),
    asrEngine: 'moonshine-v2',
  },
  // NeMo
  {
    id: 'nemo-canary-int8',
    type: 'asr',
    name: 'NeMo Canary (int8)',
    languages: ['en', 'es', 'de', 'fr'],
    cdnPath: 'wasm-nemo-canary-int8',
    files: asrFiles(207_813_900, 300),
    asrEngine: 'canary',
  },
  {
    id: 'nemo-fastconf-multi-int8',
    type: 'asr',
    name: 'NeMo FastConformer Multi (int8)',
    languages: ['be', 'de', 'en', 'es', 'fr', 'hr', 'it', 'pl', 'ru', 'uk'],
    cdnPath: 'wasm-nemo-fastconf-multi-int8',
    files: asrFiles(133_113_045, 226),
    asrEngine: 'nemo-ctc',
  },
  {
    id: 'nemo-fastconf-de-int8',
    type: 'asr',
    name: 'NeMo FastConformer DE (int8)',
    languages: ['de'],
    cdnPath: 'wasm-nemo-fastconf-de-int8',
    files: asrFiles(132_307_485, 226),
    asrEngine: 'nemo-ctc',
  },
  {
    id: 'nemo-fastconf-es-int8',
    type: 'asr',
    name: 'NeMo FastConformer ES (int8)',
    languages: ['es'],
    cdnPath: 'wasm-nemo-fastconf-es-int8',
    files: asrFiles(132_307_170, 226),
    asrEngine: 'nemo-ctc',
  },
  {
    id: 'nemo-fastconf-pt-int8',
    type: 'asr',
    name: 'NeMo FastConformer PT (int8)',
    languages: ['pt'],
    cdnPath: 'wasm-nemo-fastconf-pt-int8',
    files: asrFiles(131_924_353, 226),
    asrEngine: 'nemo-ctc',
  },
  {
    id: 'nemo-parakeet-tdt-int8',
    type: 'asr',
    name: 'NeMo Parakeet TDT 0.6B (int8, 25 EU langs)',
    languages: [
      'bg', 'hr', 'cs', 'da', 'nl', 'en', 'et', 'fi', 'fr', 'de',
      'el', 'hu', 'it', 'lv', 'lt', 'mt', 'pl', 'pt', 'ro', 'ru',
      'sk', 'sl', 'es', 'sv', 'uk',
    ],
    cdnPath: 'wasm-nemo-parakeet-tdt-int8',
    files: asrFiles(671_122_626, 396),
    asrEngine: 'nemo-transducer',
  },
  // Dolphin
  {
    id: 'dolphin-base-int8',
    type: 'asr',
    name: 'Dolphin Base CTC Multi (int8)',
    languages: ['zh', 'ja', 'ko', 'th', 'vi', 'ar', 'hi', 'bn', 'ru'],
    cdnPath: 'wasm-dolphin-base-int8',
    files: asrFiles(104_878_318, 225),
    asrEngine: 'dolphin',
  },
  // Whisper
  {
    id: 'whisper-tiny',
    type: 'asr',
    name: 'Whisper Tiny (99+ languages)',
    languages: ['multilingual'],
    multilingual: true,
    cdnPath: 'wasm-whisper-tiny',
    files: asrFiles(153_613_465, 304),
    asrEngine: 'whisper',
  },
  // WenetSpeech
  {
    id: 'wenetspeech-yue-int8',
    type: 'asr',
    name: 'WenetSpeech Yue U2++ (int8)',
    languages: ['zh', 'cantonese', 'en'],
    cdnPath: 'wasm-wenetspeech-yue-int8',
    files: asrFiles(135_427_715, 227),
    asrEngine: 'wenet-ctc',
  },
  // Omnilingual
  {
    id: 'omnilingual-300m-int8-v2',
    type: 'asr',
    name: 'Omnilingual 300M v2 (int8, 1147 languages)',
    languages: ['multilingual'],
    multilingual: true,
    cdnPath: 'wasm-omnilingual-300m-int8-v2',
    files: asrFiles(366_576_518, 275),
    asrEngine: 'omnilingual',
  },
  // Zipformer
  {
    id: 'zipformer-ru-int8',
    type: 'asr',
    name: 'Zipformer RU (int8)',
    languages: ['ru'],
    cdnPath: 'wasm-zipformer-ru-int8',
    files: asrFiles(74_125_561, 425),
    asrEngine: 'transducer',
  },
  {
    id: 'zipformer-vi-30m-int8',
    type: 'asr',
    name: 'Zipformer VI 30M (int8)',
    languages: ['vi'],
    cdnPath: 'wasm-zipformer-vi-30m-int8',
    files: asrFiles(34_832_762, 425),
    asrEngine: 'transducer',
  },

  // ── Streaming ASR Models — self-hosted (10) ─────────────────────────────
  // Downloaded from jiangzhuo9357/sherpa-onnx-asr-models dataset. Uses cdnPath.
  // These use a different WASM binary (no VAD) and require a streaming engine.
  {
    id: 'stream-en-kroko',
    type: 'asr-stream',
    name: 'Streaming Zipformer EN Kroko',
    languages: ['en'],
    cdnPath: 'wasm-stream-en-kroko',
    files: streamAsrFiles(71_053_214, 272),
    asrEngine: 'stream-transducer',
  },
  {
    id: 'stream-fr-kroko',
    type: 'asr-stream',
    name: 'Streaming Zipformer FR Kroko',
    languages: ['fr'],
    cdnPath: 'wasm-stream-fr-kroko',
    files: streamAsrFiles(71_052_319, 272),
    asrEngine: 'stream-transducer',
  },
  {
    id: 'stream-de-kroko',
    type: 'asr-stream',
    name: 'Streaming Zipformer DE Kroko',
    languages: ['de'],
    cdnPath: 'wasm-stream-de-kroko',
    files: streamAsrFiles(71_051_469, 272),
    asrEngine: 'stream-transducer',
  },
  {
    id: 'stream-es-kroko',
    type: 'asr-stream',
    name: 'Streaming Zipformer ES Kroko',
    languages: ['es'],
    cdnPath: 'wasm-stream-es-kroko',
    files: streamAsrFiles(155_838_792, 278),
    asrEngine: 'stream-transducer',
  },
  {
    id: 'stream-zh-int8',
    type: 'asr-stream',
    name: 'Streaming Zipformer ZH (int8)',
    languages: ['zh'],
    cdnPath: 'wasm-stream-zh-int8',
    files: streamAsrFiles(76_585_296, 328),
    asrEngine: 'stream-transducer',
  },
  {
    id: 'stream-zh-2025-int8',
    type: 'asr-stream',
    name: 'Streaming Zipformer ZH 2025 (int8)',
    languages: ['zh'],
    cdnPath: 'wasm-stream-zh-2025-int8',
    files: streamAsrFiles(167_360_920, 280),
    asrEngine: 'stream-transducer',
  },
  {
    id: 'stream-ru-vosk-int8',
    type: 'asr-stream',
    name: 'Streaming Zipformer RU Vosk (int8)',
    languages: ['ru'],
    cdnPath: 'wasm-stream-ru-vosk-int8',
    files: streamAsrFiles(28_819_129, 328),
    asrEngine: 'stream-transducer',
  },
  {
    id: 'stream-multi-8lang',
    type: 'asr-stream',
    name: 'Streaming Zipformer Multi (8-lang)',
    languages: ['ar', 'en', 'id', 'ja', 'ru', 'th', 'vi', 'zh'],
    cdnPath: 'wasm-stream-multi-8lang',
    files: streamAsrFiles(339_349_396, 336),
    asrEngine: 'stream-transducer',
  },
  {
    id: 'stream-bn-vosk',
    type: 'asr-stream',
    name: 'Streaming Zipformer BN Vosk',
    languages: ['bn'],
    cdnPath: 'wasm-stream-bn-vosk',
    files: streamAsrFiles(94_137_204, 390),
    asrEngine: 'stream-transducer',
  },
  {
    id: 'stream-nemo-ctc-en-80ms-int8',
    type: 'asr-stream',
    name: 'NeMo Streaming FastConformer CTC EN 80ms (int8)',
    languages: ['en'],
    cdnPath: 'wasm-stream-nemo-ctc-en-80ms-int8',
    files: streamAsrFiles(132_060_302, 160),
    asrEngine: 'stream-nemo-ctc',
  },

  // ── Whisper WebGPU ASR Models — third-party HF Hub ──────────────────────
  // Downloaded from onnx-community repos on HuggingFace Hub. Uses hfModelId.
  // Whisper via @huggingface/transformers with built-in Silero VAD.
  // dtype: encoder_model=fp32, decoder_model_merged=q4 for WebGPU.
  // Shared extra files for multilingual models
  {
    id: 'whisper-tiny-en-webgpu',
    type: 'asr',
    name: 'Whisper Tiny EN (WebGPU)',
    languages: ['en'],
    hfModelId: 'onnx-community/whisper-tiny.en',
    requiredDevice: 'webgpu',
    asrWorkerType: 'whisper-webgpu',
    dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' },
    files: whisperFiles(
      2_197, 1_646, 339,   // config, genConfig, preprocessor
      2_405_679, 282_662,  // tokenizer, tokenizerConfig
      32_904_992,          // encoder_model.onnx (fp32)
      86_712_166,          // decoder_model_merged_q4.onnx
      { normalizer: 52_666, addedTokens: 34_604, specialTokensMap: 2_173,
        vocab: 999_186, merges: 456_318 },
    ),
  },
  {
    id: 'whisper-tiny-webgpu',
    type: 'asr',
    name: 'Whisper Tiny (WebGPU, 99+ languages)',
    languages: ['multilingual'],
    multilingual: true,
    hfModelId: 'onnx-community/whisper-tiny',
    requiredDevice: 'webgpu',
    asrWorkerType: 'whisper-webgpu',
    dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' },
    files: whisperFiles(
      2_243, 3_772, 339,   // config, genConfig, preprocessor
      2_480_466, 282_683,  // tokenizer, tokenizerConfig
      32_904_992,          // encoder_model.onnx (fp32)
      86_713_702,          // decoder_model_merged_q4.onnx
      { normalizer: 52_666, addedTokens: 34_604, specialTokensMap: 2_194,
        vocab: 1_036_584, merges: 493_869 },
    ),
  },
  {
    id: 'whisper-base-webgpu',
    type: 'asr',
    name: 'Whisper Base (WebGPU, 99+ languages)',
    languages: ['multilingual'],
    multilingual: true,
    hfModelId: 'onnx-community/whisper-base',
    requiredDevice: 'webgpu',
    asrWorkerType: 'whisper-webgpu',
    dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' },
    files: whisperFiles(
      2_243, 3_832, 339,   // config, genConfig, preprocessor
      2_480_466, 282_682,  // tokenizer, tokenizerConfig
      82_468_078,          // encoder_model.onnx (fp32)
      123_602_419,         // decoder_model_merged_q4.onnx
      { normalizer: 52_666, addedTokens: 34_604, specialTokensMap: 2_194,
        vocab: 1_036_584, merges: 493_869 },
    ),
  },
  {
    id: 'whisper-small-webgpu',
    type: 'asr',
    name: 'Whisper Small (WebGPU, 99+ languages)',
    languages: ['multilingual'],
    multilingual: true,
    hfModelId: 'onnx-community/whisper-small',
    requiredDevice: 'webgpu',
    asrWorkerType: 'whisper-webgpu',
    dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' },
    files: whisperFiles(
      2_227, 3_893, 339,   // config, genConfig, preprocessor
      2_480_466, 282_683,  // tokenizer, tokenizerConfig
      352_825_870,         // encoder_model.onnx (fp32)
      233_149_327,         // decoder_model_merged_q4.onnx
      { normalizer: 52_666, addedTokens: 34_604, specialTokensMap: 2_194,
        vocab: 1_036_584, merges: 493_869 },
    ),
  },
  {
    id: 'whisper-medium-webgpu',
    type: 'asr',
    name: 'Whisper Medium (WebGPU, 99+ languages)',
    languages: ['multilingual'],
    multilingual: true,
    hfModelId: 'onnx-community/whisper-medium-ONNX',
    requiredDevice: 'webgpu',
    asrWorkerType: 'whisper-webgpu',
    dtype: { encoder_model: 'q4', decoder_model_merged: 'q4' },
    files: whisperFiles(
      1_389, 3_780, 339,       // config, genConfig, preprocessor
      3_930_494, 282_713,      // tokenizer, tokenizerConfig
      209_954_580,             // encoder_model_q4.onnx
      469_353_892,             // decoder_model_merged_q4.onnx
      { normalizer: 52_666, addedTokens: 34_604, specialTokensMap: 2_194,
        vocab: 1_036_584, merges: 493_869 },
      '_q4',
    ),
  },
  {
    id: 'whisper-large-v3-turbo-webgpu',
    type: 'asr',
    name: 'Whisper Large V3 Turbo (WebGPU, 99+ languages)',
    languages: ['multilingual'],
    multilingual: true,
    hfModelId: 'onnx-community/whisper-large-v3-turbo',
    requiredDevice: 'webgpu',
    asrWorkerType: 'whisper-webgpu',
    dtype: { encoder_model: 'q4', decoder_model_merged: 'q4' },
    files: whisperFiles(
      1_332, 3_897, 340,       // config, genConfig, preprocessor
      2_480_617, 282_843,      // tokenizer, tokenizerConfig
      424_942_775,             // encoder_model_q4.onnx
      334_147_222,             // decoder_model_merged_q4.onnx
      { normalizer: 52_666, addedTokens: 34_648, specialTokensMap: 2_186,
        vocab: 1_036_558, merges: 493_869 },
      '_q4',
    ),
  },
  // NOTE: lite-whisper-large-v3-turbo-fast-ONNX removed — custom architecture
  // (LiteWhisperForConditionalGeneration + low_rank_config) is incompatible with
  // Transformers.js WhisperForConditionalGeneration pipeline. Produces garbage output.

  // ── TTS Models — self-hosted (136) ──────────────────────────────────────
  // Downloaded from jiangzhuo9357/sherpa-onnx-tts-models dataset. Uses cdnPath.
  // 136 models across 53 languages, selected by speed benchmark.
  // Per language+gender: top 2 fastest, plus similar-speed Piper speakers.
  {
    id: 'mimic3-af-google_nwu-low',
    type: 'tts',
    name: 'Mimic3 (Afrikaans)',
    languages: ['af'],
    cdnPath: 'wasm-mimic3-af-google_nwu-low',
    modelFile: 'af_ZA-google-nwu_low.onnx',
    engine: 'mimic3',
    files: ttsFiles(94_350_372, 27_242),
    numSpeakers: 1,
  },
  {
    id: 'piper-ar-kareem-low',
    type: 'tts',
    name: 'Piper Kareem Low (Arabic, male)',
    languages: ['ar'],
    cdnPath: 'wasm-piper-ar-kareem-low',
    modelFile: 'ar_JO-kareem-low.onnx',
    engine: 'piper',
    files: ttsFiles(81_147_091, 27_109),
    numSpeakers: 1,
  },
  {
    id: 'piper-ar-kareem-medium',
    type: 'tts',
    name: 'Piper Kareem Medium (Arabic, male)',
    languages: ['ar'],
    cdnPath: 'wasm-piper-ar-kareem-medium',
    modelFile: 'ar_JO-kareem-medium.onnx',
    engine: 'piper',
    files: ttsFiles(81_147_102, 27_115),
    numSpeakers: 1,
  },
  {
    id: 'coqui-bg-cv',
    type: 'tts',
    name: 'Coqui (Bulgarian)',
    languages: ['bg'],
    cdnPath: 'wasm-coqui-bg-cv',
    engine: 'coqui',
    files: ttsFiles(71_061_552, 452),
    numSpeakers: 1,
  },
  {
    id: 'mimic3-bn-multi-low',
    type: 'tts',
    name: 'Mimic3 (Bengali, multi-speaker)',
    languages: ['bn'],
    cdnPath: 'wasm-mimic3-bn-multi-low',
    modelFile: 'bn-multi_low.onnx',
    engine: 'mimic3',
    files: ttsFiles(94_362_149, 27_226),
    numSpeakers: 1,
  },
  {
    id: 'coqui-bn-custom_female',
    type: 'tts',
    name: 'Coqui (Bengali, female)',
    languages: ['bn'],
    cdnPath: 'wasm-coqui-bn-custom_female',
    engine: 'coqui',
    files: ttsFiles(114_323_070, 337),
    numSpeakers: 1,
  },
  {
    id: 'piper-ca-upc_pau-x_low',
    type: 'tts',
    name: 'Piper Upc pau X low (Catalan, male)',
    languages: ['ca'],
    cdnPath: 'wasm-piper-ca-upc_pau-x_low',
    modelFile: 'ca_ES-upc_pau-x_low.onnx',
    engine: 'piper',
    files: ttsFiles(38_575_551, 27_115),
    numSpeakers: 1,
  },
  {
    id: 'piper-ca-upc_ona-x_low',
    type: 'tts',
    name: 'Piper Upc ona X low (Catalan, female)',
    languages: ['ca'],
    cdnPath: 'wasm-piper-ca-upc_ona-x_low',
    modelFile: 'ca_ES-upc_ona-x_low.onnx',
    engine: 'piper',
    files: ttsFiles(38_573_100, 27_115),
    numSpeakers: 1,
  },
  {
    id: 'piper-ca-upc_ona-medium',
    type: 'tts',
    name: 'Piper Upc ona Medium (Catalan, female)',
    languages: ['ca'],
    cdnPath: 'wasm-piper-ca-upc_ona-medium',
    modelFile: 'ca_ES-upc_ona-medium.onnx',
    engine: 'piper',
    files: ttsFiles(81_146_935, 27_117),
    numSpeakers: 1,
  },
  {
    id: 'piper-cs-jirka-low',
    type: 'tts',
    name: 'Piper Jirka Low (Czech, male)',
    languages: ['cs'],
    cdnPath: 'wasm-piper-cs-jirka-low',
    modelFile: 'cs_CZ-jirka-low.onnx',
    engine: 'piper',
    files: ttsFiles(81_147_090, 27_107),
    numSpeakers: 1,
  },
  {
    id: 'piper-cs-jirka-medium',
    type: 'tts',
    name: 'Piper Jirka Medium (Czech, male)',
    languages: ['cs'],
    cdnPath: 'wasm-piper-cs-jirka-medium',
    modelFile: 'cs_CZ-jirka-medium.onnx',
    engine: 'piper',
    files: ttsFiles(81_147_099, 27_113),
    numSpeakers: 1,
  },
  {
    id: 'piper-cy-gwryw_gogleddol-medium',
    type: 'tts',
    name: 'Piper Gwryw gogleddol Medium (Welsh, male)',
    languages: ['cy'],
    cdnPath: 'wasm-piper-cy-gwryw_gogleddol-medium',
    modelFile: 'cy_GB-gwryw_gogleddol-medium.onnx',
    engine: 'piper',
    files: ttsFiles(81_151_674, 27_133),
    numSpeakers: 1,
  },
  {
    id: 'piper-cy-bu_tts-medium',
    type: 'tts',
    name: 'Piper Bu tts Medium (Welsh, multi-speaker)',
    languages: ['cy'],
    cdnPath: 'wasm-piper-cy-bu_tts-medium',
    modelFile: 'cy_GB-bu_tts-medium.onnx',
    engine: 'piper',
    files: ttsFiles(94_697_365, 27_115),
    numSpeakers: 7,
  },
  {
    id: 'piper-da-talesyntese-medium',
    type: 'tts',
    name: 'Piper Talesyntese Medium (Danish, female)',
    languages: ['da'],
    cdnPath: 'wasm-piper-da-talesyntese-medium',
    modelFile: 'da_DK-talesyntese-medium.onnx',
    engine: 'piper',
    files: ttsFiles(81_146_948, 27_125),
    numSpeakers: 1,
  },
  {
    id: 'piper-de-eva_k-x_low',
    type: 'tts',
    name: 'Piper Eva k X low (German, female)',
    languages: ['de'],
    cdnPath: 'wasm-piper-de-eva_k-x_low',
    modelFile: 'de_DE-eva_k-x_low.onnx',
    engine: 'piper',
    files: ttsFiles(38_573_085, 27_111),
    numSpeakers: 1,
  },
  {
    id: 'piper-de-glados-low',
    type: 'tts',
    name: 'Piper Glados Low (German, female)',
    languages: ['de'],
    cdnPath: 'wasm-piper-de-glados-low',
    modelFile: 'de_DE-glados-low.onnx',
    engine: 'piper',
    files: ttsFiles(81_153_811, 27_157),
    numSpeakers: 1,
  },
  {
    id: 'piper-de-glados_turret-low',
    type: 'tts',
    name: 'Piper Glados turret Low (German, female)',
    languages: ['de'],
    cdnPath: 'wasm-piper-de-glados_turret-low',
    modelFile: 'de_DE-glados_turret-low.onnx',
    engine: 'piper',
    files: ttsFiles(81_153_827, 27_171),
    numSpeakers: 1,
  },
  {
    id: 'piper-de-ramona-low',
    type: 'tts',
    name: 'Piper Ramona Low (German, female)',
    languages: ['de'],
    cdnPath: 'wasm-piper-de-ramona-low',
    modelFile: 'de_DE-ramona-low.onnx',
    engine: 'piper',
    files: ttsFiles(81_049_248, 27_109),
    numSpeakers: 1,
  },
  {
    id: 'piper-de-thorsten-low',
    type: 'tts',
    name: 'Piper Thorsten Low (German, male)',
    languages: ['de'],
    cdnPath: 'wasm-piper-de-thorsten-low',
    modelFile: 'de_DE-thorsten-low.onnx',
    engine: 'piper',
    files: ttsFiles(81_049_269, 27_113),
    numSpeakers: 1,
  },
  {
    id: 'piper-de-pavoque-low',
    type: 'tts',
    name: 'Piper Pavoque Low (German, male)',
    languages: ['de'],
    cdnPath: 'wasm-piper-de-pavoque-low',
    modelFile: 'de_DE-pavoque-low.onnx',
    engine: 'piper',
    files: ttsFiles(81_049_303, 27_111),
    numSpeakers: 1,
  },
  {
    id: 'piper-de-kerstin-low',
    type: 'tts',
    name: 'Piper Kerstin Low (German, female)',
    languages: ['de'],
    cdnPath: 'wasm-piper-de-kerstin-low',
    modelFile: 'de_DE-kerstin-low.onnx',
    engine: 'piper',
    files: ttsFiles(81_049_266, 27_111),
    numSpeakers: 1,
  },
  {
    id: 'piper-de-karlsson-low',
    type: 'tts',
    name: 'Piper Karlsson Low (German, male)',
    languages: ['de'],
    cdnPath: 'wasm-piper-de-karlsson-low',
    modelFile: 'de_DE-karlsson-low.onnx',
    engine: 'piper',
    files: ttsFiles(81_049_284, 27_113),
    numSpeakers: 1,
  },
  {
    id: 'piper-el-rapunzelina-low',
    type: 'tts',
    name: 'Piper Rapunzelina Low (Greek, female)',
    languages: ['el'],
    cdnPath: 'wasm-piper-el-rapunzelina-low',
    modelFile: 'el_GR-rapunzelina-low.onnx',
    engine: 'piper',
    files: ttsFiles(81_049_365, 27_119),
    numSpeakers: 1,
  },
  {
    id: 'mimic3-el-rapunzelina-low',
    type: 'tts',
    name: 'Mimic3 (Greek, female)',
    languages: ['el'],
    cdnPath: 'wasm-mimic3-el-rapunzelina-low',
    modelFile: 'el_GR-rapunzelina_low.onnx',
    engine: 'mimic3',
    files: ttsFiles(80_786_071, 27_244),
    numSpeakers: 1,
  },
  {
    id: 'piper-en-amy-low',
    type: 'tts',
    name: 'Piper Amy Low (English, female)',
    languages: ['en'],
    cdnPath: 'wasm-piper-en-amy-low',
    modelFile: 'en_US-amy-low.onnx',
    engine: 'piper',
    files: ttsFiles(81_101_508, 27_103),
    numSpeakers: 1,
  },
  {
    id: 'piper-en-gb-alan-low',
    type: 'tts',
    name: 'Piper Alan Low (English, male)',
    languages: ['en'],
    cdnPath: 'wasm-piper-en-gb-alan-low',
    modelFile: 'en_GB-alan-low.onnx',
    engine: 'piper',
    files: ttsFiles(81_101_555, 27_105),
    numSpeakers: 1,
  },
  {
    id: 'piper-en-gb-south-female-low',
    type: 'tts',
    name: 'Piper South Female Low (English, female)',
    languages: ['en'],
    cdnPath: 'wasm-piper-en-gb-south-female-low',
    modelFile: 'en_GB-southern_english_female-low.onnx',
    engine: 'piper',
    files: ttsFiles(81_101_561, 27_143),
    numSpeakers: 1,
  },
  {
    id: 'piper-en-kathleen-low',
    type: 'tts',
    name: 'Piper Kathleen Low (English, female)',
    languages: ['en'],
    cdnPath: 'wasm-piper-en-kathleen-low',
    modelFile: 'en_US-kathleen-low.onnx',
    engine: 'piper',
    files: ttsFiles(81_049_294, 27_113),
    numSpeakers: 1,
  },
  {
    id: 'piper-en-lessac-low',
    type: 'tts',
    name: 'Piper Lessac Low (English, male)',
    languages: ['en'],
    cdnPath: 'wasm-piper-en-lessac-low',
    modelFile: 'en_US-lessac-low.onnx',
    engine: 'piper',
    files: ttsFiles(81_146_997, 27_109),
    numSpeakers: 1,
  },
  {
    id: 'piper-en-ryan-low',
    type: 'tts',
    name: 'Piper Ryan Low (English, male)',
    languages: ['en'],
    cdnPath: 'wasm-piper-en-ryan-low',
    modelFile: 'en_US-ryan-low.onnx',
    engine: 'piper',
    files: ttsFiles(81_049_272, 27_105),
    numSpeakers: 1,
  },
  {
    id: 'piper-en-danny-low',
    type: 'tts',
    name: 'Piper Danny Low (English, male)',
    languages: ['en'],
    cdnPath: 'wasm-piper-en-danny-low',
    modelFile: 'en_US-danny-low.onnx',
    engine: 'piper',
    files: ttsFiles(81_049_285, 27_107),
    numSpeakers: 1,
  },
  {
    id: 'piper-en-arctic-medium',
    type: 'tts',
    name: 'Piper Arctic Medium (English, multi-speaker)',
    languages: ['en'],
    cdnPath: 'wasm-piper-en-arctic-medium',
    modelFile: 'en_US-arctic-medium.onnx',
    engine: 'piper',
    files: ttsFiles(94_713_318, 27_115),
    numSpeakers: 18,
  },
  {
    id: 'piper-en-libritts_r-medium',
    type: 'tts',
    name: 'Piper Libritts r Medium (English, multi-speaker)',
    languages: ['en'],
    cdnPath: 'wasm-piper-en-libritts_r-medium',
    modelFile: 'en_US-libritts_r-medium.onnx',
    engine: 'piper',
    files: ttsFiles(96_542_847, 27_123),
    numSpeakers: 904,
  },
  {
    id: 'piper-en-gb-vctk-medium',
    type: 'tts',
    name: 'Piper Vctk Medium (English, multi-speaker)',
    languages: ['en'],
    cdnPath: 'wasm-piper-en-gb-vctk-medium',
    modelFile: 'en_GB-vctk-medium.onnx',
    engine: 'piper',
    files: ttsFiles(94_952_426, 27_111),
    numSpeakers: 109,
  },
  {
    id: 'piper-en-gb-semaine-medium',
    type: 'tts',
    name: 'Piper Semaine Medium (English, multi-speaker)',
    languages: ['en'],
    cdnPath: 'wasm-piper-en-gb-semaine-medium',
    modelFile: 'en_GB-semaine-medium.onnx',
    engine: 'piper',
    files: ttsFiles(94_735_846, 27_117),
    numSpeakers: 4,
  },
  {
    id: 'piper-en-l2arctic-medium',
    type: 'tts',
    name: 'Piper L2arctic Medium (English, multi-speaker)',
    languages: ['en'],
    cdnPath: 'wasm-piper-en-l2arctic-medium',
    modelFile: 'en_US-l2arctic-medium.onnx',
    engine: 'piper',
    files: ttsFiles(94_776_994, 27_119),
    numSpeakers: 24,
  },
  {
    id: 'piper-en-gb-aru-medium',
    type: 'tts',
    name: 'Piper Aru Medium (English, multi-speaker)',
    languages: ['en'],
    cdnPath: 'wasm-piper-en-gb-aru-medium',
    modelFile: 'en_GB-aru-medium.onnx',
    engine: 'piper',
    files: ttsFiles(94_752_222, 27_109),
    numSpeakers: 12,
  },
  {
    id: 'piper-es-carlfm-x_low',
    type: 'tts',
    name: 'Piper Carlfm X low (Spanish, male)',
    languages: ['es'],
    cdnPath: 'wasm-piper-es-carlfm-x_low',
    modelFile: 'es_ES-carlfm-x_low.onnx',
    engine: 'piper',
    files: ttsFiles(38_575_543, 27_113),
    numSpeakers: 1,
  },
  {
    id: 'piper-es-glados-medium',
    type: 'tts',
    name: 'Piper Glados Medium (Spanish, female)',
    languages: ['es'],
    cdnPath: 'wasm-piper-es-glados-medium',
    modelFile: 'es_ES-glados-medium.onnx',
    engine: 'piper',
    files: ttsFiles(80_949_089, 27_114),
    numSpeakers: 1,
  },
  {
    id: 'piper-es-mx-claude-high',
    type: 'tts',
    name: 'Piper Claude High (Spanish, male)',
    languages: ['es'],
    cdnPath: 'wasm-piper-es-mx-claude-high',
    modelFile: 'es_MX-claude-high.onnx',
    engine: 'piper',
    files: ttsFiles(80_947_123, 27_111),
    numSpeakers: 1,
  },
  {
    id: 'piper-es-mx-ald-medium',
    type: 'tts',
    name: 'Piper Ald Medium (Spanish, female)',
    languages: ['es'],
    cdnPath: 'wasm-piper-es-mx-ald-medium',
    modelFile: 'es_MX-ald-medium.onnx',
    engine: 'piper',
    files: ttsFiles(81_146_970, 27_109),
    numSpeakers: 1,
  },
  {
    id: 'piper-es-sharvard-medium',
    type: 'tts',
    name: 'Piper Sharvard Medium (Spanish, multi-speaker)',
    languages: ['es'],
    cdnPath: 'wasm-piper-es-sharvard-medium',
    modelFile: 'es_ES-sharvard-medium.onnx',
    engine: 'piper',
    files: ttsFiles(94_680_398, 27_119),
    numSpeakers: 2,
  },
  {
    id: 'piper-es-davefx-medium',
    type: 'tts',
    name: 'Piper Davefx Medium (Spanish, male)',
    languages: ['es'],
    cdnPath: 'wasm-piper-es-davefx-medium',
    modelFile: 'es_ES-davefx-medium.onnx',
    engine: 'piper',
    files: ttsFiles(81_146_842, 27_115),
    numSpeakers: 1,
  },
  {
    id: 'coqui-et-cv',
    type: 'tts',
    name: 'Coqui (Estonian)',
    languages: ['et'],
    cdnPath: 'wasm-coqui-et-cv',
    engine: 'coqui',
    files: ttsFiles(71_067_536, 452),
    numSpeakers: 1,
  },
  {
    id: 'piper-fa-reza-medium',
    type: 'tts',
    name: 'Piper Reza Medium (Farsi, male)',
    languages: ['fa'],
    cdnPath: 'wasm-piper-fa-reza-medium',
    modelFile: 'fa_IR-reza_ibrahim-medium.onnx',
    engine: 'piper',
    files: ttsFiles(81_151_968, 26_649),
    numSpeakers: 1,
  },
  {
    id: 'mimic3-fa-haaniye-low',
    type: 'tts',
    name: 'Mimic3 (Farsi, female)',
    languages: ['fa'],
    cdnPath: 'wasm-mimic3-fa-haaniye-low',
    modelFile: 'fa-haaniye_low.onnx',
    engine: 'mimic3',
    files: ttsFiles(80_782_423, 26_752),
    numSpeakers: 1,
  },
  {
    id: 'piper-fa-en-rezahedayatfar-ibrahimwalk-medium',
    type: 'tts',
    name: 'Piper Rezahedayatfar Ibrahimwalk Medium (Farsi, male)',
    languages: ['fa', 'en'],
    cdnPath: 'wasm-piper-fa-en-rezahedayatfar-ibrahimwalk-medium',
    modelFile: 'fa_en-rezahedayatfar-ibrahimwalk-medium.onnx',
    engine: 'piper',
    files: ttsFiles(81_515_497, 26_801),
    numSpeakers: 1,
  },
  {
    id: 'piper-fa-ganji_adabi-medium',
    type: 'tts',
    name: 'Piper Ganji adabi Medium (Farsi, male)',
    languages: ['fa'],
    cdnPath: 'wasm-piper-fa-ganji_adabi-medium',
    modelFile: 'fa_IR-ganji_adabi-medium.onnx',
    engine: 'piper',
    files: ttsFiles(81_142_990, 26_647),
    numSpeakers: 1,
  },
  {
    id: 'piper-fa-amir-medium',
    type: 'tts',
    name: 'Piper Amir Medium (Farsi, male)',
    languages: ['fa'],
    cdnPath: 'wasm-piper-fa-amir-medium',
    modelFile: 'fa_IR-amir-medium.onnx',
    engine: 'piper',
    files: ttsFiles(81_150_783, 26_633),
    numSpeakers: 1,
  },
  {
    id: 'piper-fa-gyro-medium',
    type: 'tts',
    name: 'Piper Gyro Medium (Farsi, male)',
    languages: ['fa'],
    cdnPath: 'wasm-piper-fa-gyro-medium',
    modelFile: 'fa_IR-gyro-medium.onnx',
    engine: 'piper',
    files: ttsFiles(80_949_377, 26_633),
    numSpeakers: 1,
  },
  {
    id: 'piper-fa-ganji-medium',
    type: 'tts',
    name: 'Piper Ganji Medium (Farsi, male)',
    languages: ['fa'],
    cdnPath: 'wasm-piper-fa-ganji-medium',
    modelFile: 'fa_IR-ganji-medium.onnx',
    engine: 'piper',
    files: ttsFiles(81_142_978, 26_635),
    numSpeakers: 1,
  },
  {
    id: 'matcha-fa-en-khadijah',
    type: 'tts',
    name: 'Matcha (Farsi, female)',
    languages: ['fa', 'en'],
    cdnPath: 'wasm-matcha-fa-en-khadijah',
    engine: 'matcha',
    ttsConfig: {
      acousticModel: './model.onnx',
      vocoder: './vocos-22khz-univ.onnx',
      dataDir: './espeak-ng-data',
    },
    files: ttsFiles(146_151_530, 26_614),
    numSpeakers: 1,
  },
  {
    id: 'piper-fi-harri-low',
    type: 'tts',
    name: 'Piper Harri Low (Finnish, male)',
    languages: ['fi'],
    cdnPath: 'wasm-piper-fi-harri-low',
    modelFile: 'fi_FI-harri-low.onnx',
    engine: 'piper',
    files: ttsFiles(81_049_277, 26_629),
    numSpeakers: 1,
  },
  {
    id: 'piper-fi-harri-medium',
    type: 'tts',
    name: 'Piper Harri Medium (Finnish, male)',
    languages: ['fi'],
    cdnPath: 'wasm-piper-fi-harri-medium',
    modelFile: 'fi_FI-harri-medium.onnx',
    engine: 'piper',
    files: ttsFiles(81_146_941, 26_635),
    numSpeakers: 1,
  },
  {
    id: 'piper-fr-siwis-low',
    type: 'tts',
    name: 'Piper Siwis Low (French, female)',
    languages: ['fr'],
    cdnPath: 'wasm-piper-fr-siwis-low',
    modelFile: 'fr_FR-siwis-low.onnx',
    engine: 'piper',
    files: ttsFiles(38_575_563, 26_629),
    numSpeakers: 1,
  },
  {
    id: 'piper-fr-gilles-low',
    type: 'tts',
    name: 'Piper Gilles Low (French, male)',
    languages: ['fr'],
    cdnPath: 'wasm-piper-fr-gilles-low',
    modelFile: 'fr_FR-gilles-low.onnx',
    engine: 'piper',
    files: ttsFiles(81_049_294, 26_631),
    numSpeakers: 1,
  },
  {
    id: 'piper-fr-siwis-medium',
    type: 'tts',
    name: 'Piper Siwis Medium (French, female)',
    languages: ['fr'],
    cdnPath: 'wasm-piper-fr-siwis-medium',
    modelFile: 'fr_FR-siwis-medium.onnx',
    engine: 'piper',
    files: ttsFiles(81_146_921, 26_635),
    numSpeakers: 1,
  },
  {
    id: 'piper-fr-upmc-medium',
    type: 'tts',
    name: 'Piper Upmc Medium (French, multi-speaker)',
    languages: ['fr'],
    cdnPath: 'wasm-piper-fr-upmc-medium',
    modelFile: 'fr_FR-upmc-medium.onnx',
    engine: 'piper',
    files: ttsFiles(94_680_432, 26_633),
    numSpeakers: 2,
  },
  {
    id: 'piper-fr-tjiho3-medium',
    type: 'tts',
    name: 'Piper Tjiho3 Medium (French, male)',
    languages: ['fr'],
    cdnPath: 'wasm-piper-fr-tjiho3-medium',
    modelFile: 'fr_FR-tjiho-model3.onnx',
    engine: 'piper',
    files: ttsFiles(81_187_463, 26_695),
    numSpeakers: 1,
  },
  {
    id: 'piper-fr-tom-medium',
    type: 'tts',
    name: 'Piper Tom Medium (French, male)',
    languages: ['fr'],
    cdnPath: 'wasm-piper-fr-tom-medium',
    modelFile: 'fr_FR-tom-medium.onnx',
    engine: 'piper',
    files: ttsFiles(81_151_556, 26_631),
    numSpeakers: 1,
  },
  {
    id: 'piper-fr-tjiho1-medium',
    type: 'tts',
    name: 'Piper Tjiho1 Medium (French, male)',
    languages: ['fr'],
    cdnPath: 'wasm-piper-fr-tjiho1-medium',
    modelFile: 'fr_FR-tjiho-model1.onnx',
    engine: 'piper',
    files: ttsFiles(81_187_463, 26_695),
    numSpeakers: 1,
  },
  {
    id: 'piper-fr-tjiho2-medium',
    type: 'tts',
    name: 'Piper Tjiho2 Medium (French, male)',
    languages: ['fr'],
    cdnPath: 'wasm-piper-fr-tjiho2-medium',
    modelFile: 'fr_FR-tjiho-model2.onnx',
    engine: 'piper',
    files: ttsFiles(81_187_463, 26_695),
    numSpeakers: 1,
  },
  {
    id: 'coqui-ga-cv',
    type: 'tts',
    name: 'Coqui (Irish)',
    languages: ['ga'],
    cdnPath: 'wasm-coqui-ga-cv',
    engine: 'coqui',
    files: ttsFiles(71_060_990, 452),
    numSpeakers: 1,
  },
  {
    id: 'mimic3-gu-cmu_indic-low',
    type: 'tts',
    name: 'Mimic3 (Gujarati, multi-speaker)',
    languages: ['gu'],
    cdnPath: 'wasm-mimic3-gu-cmu_indic-low',
    modelFile: 'gu_IN-cmu-indic_low.onnx',
    engine: 'mimic3',
    files: ttsFiles(94_333_214, 26_762),
    numSpeakers: 1,
  },
  {
    id: 'piper-hi-priyamvada-medium',
    type: 'tts',
    name: 'Piper Priyamvada Medium (Hindi, female)',
    languages: ['hi'],
    cdnPath: 'wasm-piper-hi-priyamvada-medium',
    modelFile: 'hi_IN-priyamvada-medium.onnx',
    engine: 'piper',
    files: ttsFiles(81_143_049, 26_645),
    numSpeakers: 1,
  },
  {
    id: 'piper-hi-pratham-medium',
    type: 'tts',
    name: 'Piper Pratham Medium (Hindi, male)',
    languages: ['hi'],
    cdnPath: 'wasm-piper-hi-pratham-medium',
    modelFile: 'hi_IN-pratham-medium.onnx',
    engine: 'piper',
    files: ttsFiles(81_143_043, 26_639),
    numSpeakers: 1,
  },
  {
    id: 'piper-hi-rohan-medium',
    type: 'tts',
    name: 'Piper Rohan Medium (Hindi, male)',
    languages: ['hi'],
    cdnPath: 'wasm-piper-hi-rohan-medium',
    modelFile: 'hi_IN-rohan-medium.onnx',
    engine: 'piper',
    files: ttsFiles(80_944_447, 26_635),
    numSpeakers: 1,
  },
  {
    id: 'coqui-hr-cv',
    type: 'tts',
    name: 'Coqui (Croatian)',
    languages: ['hr'],
    cdnPath: 'wasm-coqui-hr-cv',
    engine: 'coqui',
    files: ttsFiles(71_081_001, 452),
    numSpeakers: 1,
  },
  {
    id: 'piper-hu-imre-medium',
    type: 'tts',
    name: 'Piper Imre Medium (Hungarian, male)',
    languages: ['hu'],
    cdnPath: 'wasm-piper-hu-imre-medium',
    modelFile: 'hu_HU-imre-medium.onnx',
    engine: 'piper',
    files: ttsFiles(81_147_097, 26_633),
    numSpeakers: 1,
  },
  {
    id: 'piper-hu-berta-medium',
    type: 'tts',
    name: 'Piper Berta Medium (Hungarian, female)',
    languages: ['hu'],
    cdnPath: 'wasm-piper-hu-berta-medium',
    modelFile: 'hu_HU-berta-medium.onnx',
    engine: 'piper',
    files: ttsFiles(81_147_026, 26_635),
    numSpeakers: 1,
  },
  {
    id: 'piper-hu-anna-medium',
    type: 'tts',
    name: 'Piper Anna Medium (Hungarian, female)',
    languages: ['hu'],
    cdnPath: 'wasm-piper-hu-anna-medium',
    modelFile: 'hu_HU-anna-medium.onnx',
    engine: 'piper',
    files: ttsFiles(81_147_096, 26_633),
    numSpeakers: 1,
  },
  {
    id: 'piper-id-news_tts-medium',
    type: 'tts',
    name: 'Piper News tts Medium (Indonesian)',
    languages: ['id'],
    cdnPath: 'wasm-piper-id-news_tts-medium',
    modelFile: 'id_ID-news_tts-medium.onnx',
    engine: 'piper',
    files: ttsFiles(80_944_415, 26_641),
    numSpeakers: 1,
  },
  {
    id: 'piper-is-salka-medium',
    type: 'tts',
    name: 'Piper Salka Medium (Icelandic, female)',
    languages: ['is'],
    cdnPath: 'wasm-piper-is-salka-medium',
    modelFile: 'is_IS-salka-medium.onnx',
    engine: 'piper',
    files: ttsFiles(80_849_369, 26_635),
    numSpeakers: 1,
  },
  {
    id: 'piper-is-ugla-medium',
    type: 'tts',
    name: 'Piper Ugla Medium (Icelandic, female)',
    languages: ['is'],
    cdnPath: 'wasm-piper-is-ugla-medium',
    modelFile: 'is_IS-ugla-medium.onnx',
    engine: 'piper',
    files: ttsFiles(80_849_367, 26_633),
    numSpeakers: 1,
  },
  {
    id: 'piper-is-bui-medium',
    type: 'tts',
    name: 'Piper Bui Medium (Icelandic, male)',
    languages: ['is'],
    cdnPath: 'wasm-piper-is-bui-medium',
    modelFile: 'is_IS-bui-medium.onnx',
    engine: 'piper',
    files: ttsFiles(80_849_372, 26_631),
    numSpeakers: 1,
  },
  {
    id: 'piper-is-steinn-medium',
    type: 'tts',
    name: 'Piper Steinn Medium (Icelandic, male)',
    languages: ['is'],
    cdnPath: 'wasm-piper-is-steinn-medium',
    modelFile: 'is_IS-steinn-medium.onnx',
    engine: 'piper',
    files: ttsFiles(80_849_371, 26_637),
    numSpeakers: 1,
  },
  {
    id: 'piper-it-riccardo-x_low',
    type: 'tts',
    name: 'Piper Riccardo X low (Italian, male)',
    languages: ['it'],
    cdnPath: 'wasm-piper-it-riccardo-x_low',
    modelFile: 'it_IT-riccardo-x_low.onnx',
    engine: 'piper',
    files: ttsFiles(38_575_555, 26_639),
    numSpeakers: 1,
  },
  {
    id: 'piper-it-paola-medium',
    type: 'tts',
    name: 'Piper Paola Medium (Italian, female)',
    languages: ['it'],
    cdnPath: 'wasm-piper-it-paola-medium',
    modelFile: 'it_IT-paola-medium.onnx',
    engine: 'piper',
    files: ttsFiles(81_153_749, 26_635),
    numSpeakers: 1,
  },
  {
    id: 'piper-ka-natia-medium',
    type: 'tts',
    name: 'Piper Natia Medium (Georgian, female)',
    languages: ['ka'],
    cdnPath: 'wasm-piper-ka-natia-medium',
    modelFile: 'ka_GE-natia-medium.onnx',
    engine: 'piper',
    files: ttsFiles(81_199_111, 26_635),
    numSpeakers: 1,
  },
  {
    id: 'piper-kk-iseke-x_low',
    type: 'tts',
    name: 'Piper Iseke X low (Kazakh, male)',
    languages: ['kk'],
    cdnPath: 'wasm-piper-kk-iseke-x_low',
    modelFile: 'kk_KZ-iseke-x_low.onnx',
    engine: 'piper',
    files: ttsFiles(46_127_739, 26_633),
    numSpeakers: 1,
  },
  {
    id: 'piper-kk-raya-x_low',
    type: 'tts',
    name: 'Piper Raya X low (Kazakh, female)',
    languages: ['kk'],
    cdnPath: 'wasm-piper-kk-raya-x_low',
    modelFile: 'kk_KZ-raya-x_low.onnx',
    engine: 'piper',
    files: ttsFiles(38_575_537, 26_631),
    numSpeakers: 1,
  },
  {
    id: 'piper-kk-issai-high',
    type: 'tts',
    name: 'Piper Issai High (Kazakh, multi-speaker)',
    languages: ['kk'],
    cdnPath: 'wasm-piper-kk-issai-high',
    modelFile: 'kk_KZ-issai-high.onnx',
    engine: 'piper',
    files: ttsFiles(145_861_394, 26_637),
    numSpeakers: 6,
  },
  {
    id: 'mimic3-ko-kss-low',
    type: 'tts',
    name: 'Mimic3 (Korean, female)',
    languages: ['ko'],
    cdnPath: 'wasm-mimic3-ko-kss-low',
    modelFile: 'ko_KO-kss_low.onnx',
    engine: 'mimic3',
    files: ttsFiles(80_791_421, 26_750),
    numSpeakers: 1,
  },
  {
    id: 'piper-lb-marylux-medium',
    type: 'tts',
    name: 'Piper Marylux Medium (Luxembourgish, female)',
    languages: ['lb'],
    cdnPath: 'wasm-piper-lb-marylux-medium',
    modelFile: 'lb_LU-marylux-medium.onnx',
    engine: 'piper',
    files: ttsFiles(81_147_104, 26_639),
    numSpeakers: 1,
  },
  {
    id: 'coqui-lt-cv',
    type: 'tts',
    name: 'Coqui (Lithuanian)',
    languages: ['lt'],
    cdnPath: 'wasm-coqui-lt-cv',
    engine: 'coqui',
    files: ttsFiles(71_069_879, 452),
    numSpeakers: 1,
  },
  {
    id: 'piper-lv-aivars-medium',
    type: 'tts',
    name: 'Piper Aivars Medium (Latvian, male)',
    languages: ['lv'],
    cdnPath: 'wasm-piper-lv-aivars-medium',
    modelFile: 'lv_LV-aivars-medium.onnx',
    engine: 'piper',
    files: ttsFiles(81_153_865, 26_637),
    numSpeakers: 1,
  },
  {
    id: 'piper-ml-arjun-medium',
    type: 'tts',
    name: 'Piper Arjun Medium (Malayalam, male)',
    languages: ['ml'],
    cdnPath: 'wasm-piper-ml-arjun-medium',
    modelFile: 'ml_IN-arjun-medium.onnx',
    engine: 'piper',
    files: ttsFiles(80_944_407, 26_635),
    numSpeakers: 1,
  },
  {
    id: 'piper-ml-meera-medium',
    type: 'tts',
    name: 'Piper Meera Medium (Malayalam, female)',
    languages: ['ml'],
    cdnPath: 'wasm-piper-ml-meera-medium',
    modelFile: 'ml_IN-meera-medium.onnx',
    engine: 'piper',
    files: ttsFiles(80_948_146, 26_635),
    numSpeakers: 1,
  },
  {
    id: 'coqui-mt-cv',
    type: 'tts',
    name: 'Coqui (Maltese)',
    languages: ['mt'],
    cdnPath: 'wasm-coqui-mt-cv',
    engine: 'coqui',
    files: ttsFiles(71_079_440, 452),
    numSpeakers: 1,
  },
  // {
  //   id: 'kokoro',
  //   type: 'tts',
  //   name: 'Kokoro (Multilingual, multi-speaker)',
  //   languages: ['en', 'zh'],
  //   cdnPath: 'wasm-kokoro',
  //   modelFile: 'model.int8.onnx',
  //   engine: 'kokoro',
  //   ttsConfig: {
  //     lexicon: './lexicon-us-en.txt,./lexicon-zh.txt',
  //     ruleFsts: './date-zh.fst,./number-zh.fst,./phone-zh.fst',
  //   },
  //   files: ttsFiles(189_453_314, 28_293),
  //   numSpeakers: 54,
  // },
  {
    id: 'mms-nan',
    type: 'tts',
    name: 'MMS (Min Nan)',
    languages: ['nan'],
    cdnPath: 'wasm-mms-nan',
    engine: 'mms',
    files: ttsFiles(114_032_230, 381),
    numSpeakers: 1,
  },
  {
    id: 'piper-ne-google-x_low',
    type: 'tts',
    name: 'Piper Google X low (Nepali, multi-speaker)',
    languages: ['ne'],
    cdnPath: 'wasm-piper-ne-google-x_low',
    modelFile: 'ne_NP-google-x_low.onnx',
    engine: 'piper',
    files: ttsFiles(45_638_768, 26_635),
    numSpeakers: 18,
  },
  {
    id: 'piper-ne-google-medium',
    type: 'tts',
    name: 'Piper Google Medium (Nepali, multi-speaker)',
    languages: ['ne'],
    cdnPath: 'wasm-piper-ne-google-medium',
    modelFile: 'ne_NP-google-medium.onnx',
    engine: 'piper',
    files: ttsFiles(94_713_353, 26_637),
    numSpeakers: 18,
  },
  {
    id: 'piper-ne-chitwan-medium',
    type: 'tts',
    name: 'Piper Chitwan Medium (Nepali, male)',
    languages: ['ne'],
    cdnPath: 'wasm-piper-ne-chitwan-medium',
    modelFile: 'ne_NP-chitwan-medium.onnx',
    engine: 'piper',
    files: ttsFiles(80_944_399, 26_639),
    numSpeakers: 1,
  },
  {
    id: 'piper-nl-be-nathalie-x_low',
    type: 'tts',
    name: 'Piper Nathalie X low (Dutch, female)',
    languages: ['nl'],
    cdnPath: 'wasm-piper-nl-be-nathalie-x_low',
    modelFile: 'nl_BE-nathalie-x_low.onnx',
    engine: 'piper',
    files: ttsFiles(38_573_088, 26_639),
    numSpeakers: 1,
  },
  {
    id: 'piper-nl-be-nathalie-medium',
    type: 'tts',
    name: 'Piper Nathalie Medium (Dutch, female)',
    languages: ['nl'],
    cdnPath: 'wasm-piper-nl-be-nathalie-medium',
    modelFile: 'nl_BE-nathalie-medium.onnx',
    engine: 'piper',
    files: ttsFiles(81_146_923, 26_641),
    numSpeakers: 1,
  },
  {
    id: 'piper-nl-pim-medium',
    type: 'tts',
    name: 'Piper Pim Medium (Dutch, male)',
    languages: ['nl'],
    cdnPath: 'wasm-piper-nl-pim-medium',
    modelFile: 'nl_NL-pim-medium.onnx',
    engine: 'piper',
    files: ttsFiles(81_143_110, 26_631),
    numSpeakers: 1,
  },
  {
    id: 'piper-nl-ronnie-medium',
    type: 'tts',
    name: 'Piper Ronnie Medium (Dutch, male)',
    languages: ['nl'],
    cdnPath: 'wasm-piper-nl-ronnie-medium',
    modelFile: 'nl_NL-ronnie-medium.onnx',
    engine: 'piper',
    files: ttsFiles(80_944_366, 26_637),
    numSpeakers: 1,
  },
  {
    id: 'piper-no-talesyntese-medium',
    type: 'tts',
    name: 'Piper Talesyntese Medium (Norwegian)',
    languages: ['no'],
    cdnPath: 'wasm-piper-no-talesyntese-medium',
    modelFile: 'no_NO-talesyntese-medium.onnx',
    engine: 'piper',
    files: ttsFiles(81_199_188, 26_647),
    numSpeakers: 1,
  },
  {
    id: 'piper-pl-darkman-medium',
    type: 'tts',
    name: 'Piper Darkman Medium (Polish, male)',
    languages: ['pl'],
    cdnPath: 'wasm-piper-pl-darkman-medium',
    modelFile: 'pl_PL-darkman-medium.onnx',
    engine: 'piper',
    files: ttsFiles(81_199_071, 26_639),
    numSpeakers: 1,
  },
  {
    id: 'piper-pl-gosia-medium',
    type: 'tts',
    name: 'Piper Gosia Medium (Polish, female)',
    languages: ['pl'],
    cdnPath: 'wasm-piper-pl-gosia-medium',
    modelFile: 'pl_PL-gosia-medium.onnx',
    engine: 'piper',
    files: ttsFiles(81_199_067, 26_635),
    numSpeakers: 1,
  },
  {
    id: 'piper-pl-zenski-medium',
    type: 'tts',
    name: 'Piper Zenski Medium (Polish, female)',
    languages: ['pl'],
    cdnPath: 'wasm-piper-pl-zenski-medium',
    modelFile: 'pl_PL-zenski_wg_glos-medium.onnx',
    engine: 'piper',
    files: ttsFiles(81_517_197, 26_654),
    numSpeakers: 1,
  },
  {
    id: 'piper-pl-mc_speech-medium',
    type: 'tts',
    name: 'Piper Mc speech Medium (Polish, male)',
    languages: ['pl'],
    cdnPath: 'wasm-piper-pl-mc_speech-medium',
    modelFile: 'pl_PL-mc_speech-medium.onnx',
    engine: 'piper',
    files: ttsFiles(81_147_038, 26_643),
    numSpeakers: 1,
  },
  {
    id: 'piper-pl-meski-medium',
    type: 'tts',
    name: 'Piper Meski Medium (Polish, male)',
    languages: ['pl'],
    cdnPath: 'wasm-piper-pl-meski-medium',
    modelFile: 'pl_PL-meski_wg_glos-medium.onnx',
    engine: 'piper',
    files: ttsFiles(81_517_196, 26_652),
    numSpeakers: 1,
  },
  {
    id: 'piper-pl-justyna-medium',
    type: 'tts',
    name: 'Piper Justyna Medium (Polish, female)',
    languages: ['pl'],
    cdnPath: 'wasm-piper-pl-justyna-medium',
    modelFile: 'pl_PL-justyna_wg_glos-medium.onnx',
    engine: 'piper',
    files: ttsFiles(81_146_201, 26_656),
    numSpeakers: 1,
  },
  {
    id: 'piper-pl-jarvis-medium',
    type: 'tts',
    name: 'Piper Jarvis Medium (Polish, male)',
    languages: ['pl'],
    cdnPath: 'wasm-piper-pl-jarvis-medium',
    modelFile: 'pl_PL-jarvis_wg_glos-medium.onnx',
    engine: 'piper',
    files: ttsFiles(81_517_197, 26_654),
    numSpeakers: 1,
  },
  {
    id: 'piper-pt-br-edresson-low',
    type: 'tts',
    name: 'Piper Edresson Low (Portuguese, male)',
    languages: ['pt'],
    cdnPath: 'wasm-piper-pt-br-edresson-low',
    modelFile: 'pt_BR-edresson-low.onnx',
    engine: 'piper',
    files: ttsFiles(81_049_301, 26_635),
    numSpeakers: 1,
  },
  {
    id: 'piper-pt-br-faber-medium',
    type: 'tts',
    name: 'Piper Faber Medium (Portuguese, male)',
    languages: ['pt'],
    cdnPath: 'wasm-piper-pt-br-faber-medium',
    modelFile: 'pt_BR-faber-medium.onnx',
    engine: 'piper',
    files: ttsFiles(81_146_895, 26_635),
    numSpeakers: 1,
  },
  {
    id: 'piper-pt-tugao-medium',
    type: 'tts',
    name: 'Piper Tugao Medium (Portuguese, male)',
    languages: ['pt'],
    cdnPath: 'wasm-piper-pt-tugao-medium',
    modelFile: 'pt_PT-tugao-medium.onnx',
    engine: 'piper',
    files: ttsFiles(81_199_337, 26_635),
    numSpeakers: 1,
  },
  {
    id: 'piper-pt-br-jeff-medium',
    type: 'tts',
    name: 'Piper Jeff Medium (Portuguese, male)',
    languages: ['pt'],
    cdnPath: 'wasm-piper-pt-br-jeff-medium',
    modelFile: 'pt_BR-jeff-medium.onnx',
    engine: 'piper',
    files: ttsFiles(80_944_381, 26_633),
    numSpeakers: 1,
  },
  {
    id: 'piper-ro-mihai-medium',
    type: 'tts',
    name: 'Piper Mihai Medium (Romanian, male)',
    languages: ['ro'],
    cdnPath: 'wasm-piper-ro-mihai-medium',
    modelFile: 'ro_RO-mihai-medium.onnx',
    engine: 'piper',
    files: ttsFiles(81_146_920, 26_635),
    numSpeakers: 1,
  },
  {
    id: 'piper-ru-denis-medium',
    type: 'tts',
    name: 'Piper Denis Medium (Russian, male)',
    languages: ['ru'],
    cdnPath: 'wasm-piper-ru-denis-medium',
    modelFile: 'ru_RU-denis-medium.onnx',
    engine: 'piper',
    files: ttsFiles(81_146_848, 26_635),
    numSpeakers: 1,
  },
  {
    id: 'piper-ru-dmitri-medium',
    type: 'tts',
    name: 'Piper Dmitri Medium (Russian, male)',
    languages: ['ru'],
    cdnPath: 'wasm-piper-ru-dmitri-medium',
    modelFile: 'ru_RU-dmitri-medium.onnx',
    engine: 'piper',
    files: ttsFiles(81_146_850, 26_637),
    numSpeakers: 1,
  },
  {
    id: 'piper-ru-ruslan-medium',
    type: 'tts',
    name: 'Piper Ruslan Medium (Russian, male)',
    languages: ['ru'],
    cdnPath: 'wasm-piper-ru-ruslan-medium',
    modelFile: 'ru_RU-ruslan-medium.onnx',
    engine: 'piper',
    files: ttsFiles(81_146_959, 26_637),
    numSpeakers: 1,
  },
  {
    id: 'piper-ru-irina-medium',
    type: 'tts',
    name: 'Piper Irina Medium (Russian, female)',
    languages: ['ru'],
    cdnPath: 'wasm-piper-ru-irina-medium',
    modelFile: 'ru_RU-irina-medium.onnx',
    engine: 'piper',
    files: ttsFiles(81_146_778, 26_635),
    numSpeakers: 1,
  },
  {
    id: 'piper-sk-lili-medium',
    type: 'tts',
    name: 'Piper Lili Medium (Slovak, female)',
    languages: ['sk'],
    cdnPath: 'wasm-piper-sk-lili-medium',
    modelFile: 'sk_SK-lili-medium.onnx',
    engine: 'piper',
    files: ttsFiles(81_199_250, 26_633),
    numSpeakers: 1,
  },
  {
    id: 'piper-sl-artur-medium',
    type: 'tts',
    name: 'Piper Artur Medium (Slovenian, male)',
    languages: ['sl'],
    cdnPath: 'wasm-piper-sl-artur-medium',
    modelFile: 'sl_SI-artur-medium.onnx',
    engine: 'piper',
    files: ttsFiles(81_198_512, 26_635),
    numSpeakers: 1,
  },
  {
    id: 'piper-sr-serbski_institut-medium',
    type: 'tts',
    name: 'Piper Serbski institut Medium (Serbian, multi-speaker)',
    languages: ['sr'],
    cdnPath: 'wasm-piper-sr-serbski_institut-medium',
    modelFile: 'sr_RS-serbski_institut-medium.onnx',
    engine: 'piper',
    files: ttsFiles(94_680_464, 26_657),
    numSpeakers: 2,
  },
  {
    id: 'piper-sv-nst-medium',
    type: 'tts',
    name: 'Piper Nst Medium (Swedish, multi-speaker)',
    languages: ['sv'],
    cdnPath: 'wasm-piper-sv-nst-medium',
    modelFile: 'sv_SE-nst-medium.onnx',
    engine: 'piper',
    files: ttsFiles(81_049_301, 26_631),
    numSpeakers: 1,
  },
  {
    id: 'piper-sv-lisa-medium',
    type: 'tts',
    name: 'Piper Lisa Medium (Swedish, female)',
    languages: ['sv'],
    cdnPath: 'wasm-piper-sv-lisa-medium',
    modelFile: 'sv_SE-lisa-medium.onnx',
    engine: 'piper',
    files: ttsFiles(81_153_803, 26_633),
    numSpeakers: 1,
  },
  {
    id: 'piper-sw-lanfrica-medium',
    type: 'tts',
    name: 'Piper Lanfrica Medium (Swahili)',
    languages: ['sw'],
    cdnPath: 'wasm-piper-sw-lanfrica-medium',
    modelFile: 'sw_CD-lanfrica-medium.onnx',
    engine: 'piper',
    files: ttsFiles(81_147_016, 26_641),
    numSpeakers: 1,
  },
  {
    id: 'mms-tha',
    type: 'tts',
    name: 'MMS (Thai)',
    languages: ['th'],
    cdnPath: 'wasm-mms-tha',
    engine: 'mms',
    files: ttsFiles(114_049_893, 381),
    numSpeakers: 1,
  },
  {
    id: 'mimic3-tn-google_nwu-low',
    type: 'tts',
    name: 'Mimic3 (Tswana, multi-speaker)',
    languages: ['tn'],
    cdnPath: 'wasm-mimic3-tn-google_nwu-low',
    modelFile: 'tn_ZA-google-nwu_low.onnx',
    engine: 'mimic3',
    files: ttsFiles(94_375_856, 26_764),
    numSpeakers: 1,
  },
  {
    id: 'piper-tr-fettah-medium',
    type: 'tts',
    name: 'Piper Fettah Medium (Turkish, male)',
    languages: ['tr'],
    cdnPath: 'wasm-piper-tr-fettah-medium',
    modelFile: 'tr_TR-fettah-medium.onnx',
    engine: 'piper',
    files: ttsFiles(81_199_147, 26_637),
    numSpeakers: 1,
  },
  {
    id: 'piper-tr-dfki-medium',
    type: 'tts',
    name: 'Piper Dfki Medium (Turkish, male)',
    languages: ['tr'],
    cdnPath: 'wasm-piper-tr-dfki-medium',
    modelFile: 'tr_TR-dfki-medium.onnx',
    engine: 'piper',
    files: ttsFiles(81_147_043, 26_633),
    numSpeakers: 1,
  },
  {
    id: 'piper-tr-fahrettin-medium',
    type: 'tts',
    name: 'Piper Fahrettin Medium (Turkish, male)',
    languages: ['tr'],
    cdnPath: 'wasm-piper-tr-fahrettin-medium',
    modelFile: 'tr_TR-fahrettin-medium.onnx',
    engine: 'piper',
    files: ttsFiles(81_147_098, 26_643),
    numSpeakers: 1,
  },
  {
    id: 'piper-uk-lada-x_low',
    type: 'tts',
    name: 'Piper Lada X low (Ukrainian, female)',
    languages: ['uk'],
    cdnPath: 'wasm-piper-uk-lada-x_low',
    modelFile: 'uk_UA-lada-x_low.onnx',
    engine: 'piper',
    files: ttsFiles(38_573_140, 26_631),
    numSpeakers: 1,
  },
  {
    id: 'piper-uk-ukrainian_tts-medium',
    type: 'tts',
    name: 'Piper Ukrainian tts Medium (Ukrainian, multi-speaker)',
    languages: ['uk'],
    cdnPath: 'wasm-piper-uk-ukrainian_tts-medium',
    modelFile: 'uk_UA-ukrainian_tts-medium.onnx',
    engine: 'piper',
    files: ttsFiles(94_678_775, 26_651),
    numSpeakers: 3,
  },
  {
    id: 'piper-vi-vivos-x_low',
    type: 'tts',
    name: 'Piper Vivos X low (Vietnamese, multi-speaker)',
    languages: ['vi'],
    cdnPath: 'wasm-piper-vi-vivos-x_low',
    modelFile: 'vi_VN-vivos-x_low.onnx',
    engine: 'piper',
    files: ttsFiles(45_736_171, 26_633),
    numSpeakers: 65,
  },
  {
    id: 'piper-vi-25hours-low',
    type: 'tts',
    name: 'Piper 25hours Low (Vietnamese, female)',
    languages: ['vi'],
    cdnPath: 'wasm-piper-vi-25hours-low',
    modelFile: 'vi_VN-25hours_single-low.onnx',
    engine: 'piper',
    files: ttsFiles(81_101_590, 26_647),
    numSpeakers: 1,
  },
  {
    id: 'mimic3-vi-vais1000-low',
    type: 'tts',
    name: 'Mimic3 (Vietnamese, female)',
    languages: ['vi'],
    cdnPath: 'wasm-mimic3-vi-vais1000-low',
    modelFile: 'vi_VN-vais1000_low.onnx',
    engine: 'mimic3',
    files: ttsFiles(80_795_551, 26_760),
    numSpeakers: 1,
  },
  {
    id: 'piper-vi-vais1000-medium',
    type: 'tts',
    name: 'Piper Vais1000 Medium (Vietnamese, female)',
    languages: ['vi'],
    cdnPath: 'wasm-piper-vi-vais1000-medium',
    modelFile: 'vi_VN-vais1000-medium.onnx',
    engine: 'piper',
    files: ttsFiles(81_146_991, 26_641),
    numSpeakers: 1,
  },
  {
    id: 'cantonese',
    type: 'tts',
    name: 'Cantonese VITS (Cantonese, female)',
    languages: ['yue'],
    cdnPath: 'wasm-cantonese',
    modelFile: 'vits-cantonese-hf-xiaomaiiwn.onnx',
    engine: 'vits',
    ttsConfig: {
      lexicon: './lexicon.txt',
      ruleFsts: './rule.fst',
    },
    files: ttsFiles(114_426_339, 447),
    numSpeakers: 1,
  },
  {
    id: 'icefall-zh-aishell3',
    type: 'tts',
    name: 'Icefall AISHELL3 (Chinese, multi-speaker)',
    languages: ['zh'],
    cdnPath: 'wasm-icefall-zh-aishell3',
    engine: 'vits',
    ttsConfig: {
      lexicon: './lexicon.txt',
      ruleFsts: './date.fst,./number.fst,./phone.fst,./new_heteronym.fst',
      ruleFars: './rule.far',
    },
    files: ttsFiles(213_479_522, 569),
    numSpeakers: 218,
  },
  {
    id: 'piper-zh-huayan-medium',
    type: 'tts',
    name: 'Piper Huayan Medium (Chinese, female)',
    languages: ['zh'],
    cdnPath: 'wasm-piper-zh-huayan-medium',
    modelFile: 'zh_CN-huayan-medium.onnx',
    engine: 'piper',
    files: ttsFiles(81_203_080, 26_761),
    numSpeakers: 1,
  },
  {
    id: 'matcha-zh-baker',
    type: 'tts',
    name: 'Matcha Baker (Chinese, female)',
    languages: ['zh'],
    cdnPath: 'wasm-matcha-zh-baker',
    engine: 'matcha',
    ttsConfig: {
      acousticModel: './model-steps-3.onnx',
      vocoder: './vocos-22khz-univ.onnx',
      lexicon: './lexicon.txt',
      ruleFsts: './date.fst,./phone.fst',
    },
    files: ttsFiles(145_676_954, 1_280),
    numSpeakers: 1,
  },

  // ── Translation Models — third-party HF Hub ─────────────────────────────
  // Downloaded from Xenova/onnx-community repos on HuggingFace Hub. Uses hfModelId.
  // hfModelId is also needed by the worker for pipeline() / from_pretrained() identification.

  // ── Core Pairs (ja/zh/ko/de/fr/es ↔ en) ───────────────────────────────
  { id: 'opus-mt-ja-en', type: 'translation', name: 'Opus-MT (ja → en)', languages: ['ja', 'en'], files: translationFiles(1_376, 293, 5_991_485, 280, 50_705_822, 58_001_744), hfModelId: 'Xenova/opus-mt-ja-en', sourceLang: 'ja', targetLang: 'en' },
  { id: 'opus-mt-en-jap', type: 'translation', name: 'Opus-MT (en → ja)', languages: ['en', 'ja'], files: translationFiles(1_377, 293, 5_068_572, 281, 43_312_542, 50_550_704), hfModelId: 'Xenova/opus-mt-en-jap', sourceLang: 'en', targetLang: 'ja' },
  { id: 'opus-mt-zh-en', type: 'translation', name: 'Opus-MT (zh → en)', languages: ['zh', 'en'], files: translationFiles(1_389, 293, 6_381_339, 282, 52_899_742, 60_212_804), hfModelId: 'Xenova/opus-mt-zh-en', sourceLang: 'zh', targetLang: 'en' },
  { id: 'opus-mt-en-zh', type: 'translation', name: 'Opus-MT (en → zh)', languages: ['en', 'zh'], files: translationFiles(1_503, 293, 6_380_952, 282, 52_899_742, 60_212_804), hfModelId: 'Xenova/opus-mt-en-zh', sourceLang: 'en', targetLang: 'zh' },
  { id: 'opus-mt-ko-en', type: 'translation', name: 'Opus-MT (ko → en)', languages: ['ko', 'en'], files: translationFiles(1_389, 293, 6_487_044, 282, 52_899_741, 60_212_803), hfModelId: 'Xenova/opus-mt-ko-en', sourceLang: 'ko', targetLang: 'en' },
  { id: 'opus-mt-de-en', type: 'translation', name: 'Opus-MT (de → en)', languages: ['de', 'en'], files: translationFiles(1_376, 293, 5_498_450, 280, 49_366_942, 56_652_404), hfModelId: 'Xenova/opus-mt-de-en', sourceLang: 'de', targetLang: 'en' },
  { id: 'opus-mt-en-de', type: 'translation', name: 'Opus-MT (en → de)', languages: ['en', 'de'], files: translationFiles(1_411, 293, 5_498_450, 280, 49_366_942, 56_652_404), hfModelId: 'Xenova/opus-mt-en-de', sourceLang: 'en', targetLang: 'de' },
  { id: 'opus-mt-fr-en', type: 'translation', name: 'Opus-MT (fr → en)', languages: ['fr', 'en'], files: translationFiles(1_411, 293, 5_637_839, 280, 50_090_398, 57_381_512), hfModelId: 'Xenova/opus-mt-fr-en', sourceLang: 'fr', targetLang: 'en' },
  { id: 'opus-mt-en-fr', type: 'translation', name: 'Opus-MT (en → fr)', languages: ['en', 'fr'], files: translationFiles(1_411, 293, 5_637_839, 280, 50_090_398, 57_381_512), hfModelId: 'Xenova/opus-mt-en-fr', sourceLang: 'en', targetLang: 'fr' },
  { id: 'opus-mt-es-en', type: 'translation', name: 'Opus-MT (es → en)', languages: ['es', 'en'], files: translationFiles(1_433, 293, 6_262_682, 282, 52_899_742, 60_212_804), hfModelId: 'Xenova/opus-mt-es-en', sourceLang: 'es', targetLang: 'en' },
  { id: 'opus-mt-en-es', type: 'translation', name: 'Opus-MT (en → es)', languages: ['en', 'es'], files: translationFiles(1_468, 293, 6_262_682, 282, 52_899_742, 60_212_804), hfModelId: 'Xenova/opus-mt-en-es', sourceLang: 'en', targetLang: 'es' },

  // ── English → Other Languages ──────────────────────────────────────────
  { id: 'opus-mt-en-af', type: 'translation', name: 'Opus-MT (en → af)', languages: ['en', 'af'], files: translationFiles(1_376, 293, 5_569_368, 280, 49_031_070, 56_313_908), hfModelId: 'Xenova/opus-mt-en-af', sourceLang: 'en', targetLang: 'af' },
  { id: 'opus-mt-en-ar', type: 'translation', name: 'Opus-MT (en → ar)', languages: ['en', 'ar'], files: translationFiles(1_389, 293, 6_748_848, 282, 51_773_854, 59_078_120), hfModelId: 'Xenova/opus-mt-en-ar', sourceLang: 'en', targetLang: 'ar' },
  { id: 'opus-mt-en-cs', type: 'translation', name: 'Opus-MT (en → cs)', languages: ['en', 'cs'], files: translationFiles(1_376, 293, 6_142_807, 280, 51_623_838, 58_926_932), hfModelId: 'Xenova/opus-mt-en-cs', sourceLang: 'en', targetLang: 'cs' },
  { id: 'opus-mt-en-da', type: 'translation', name: 'Opus-MT (en → da)', languages: ['en', 'da'], files: translationFiles(1_376, 293, 5_685_484, 280, 49_791_390, 57_080_168), hfModelId: 'Xenova/opus-mt-en-da', sourceLang: 'en', targetLang: 'da' },
  { id: 'opus-mt-en-nl', type: 'translation', name: 'Opus-MT (en → nl)', languages: ['en', 'nl'], files: translationFiles(1_376, 293, 6_433_167, 280, 53_937_565, 61_258_735), hfModelId: 'Xenova/opus-mt-en-nl', sourceLang: 'en', targetLang: 'nl' },
  { id: 'opus-mt-en-fi', type: 'translation', name: 'Opus-MT (en → fi)', languages: ['en', 'fi'], files: translationFiles(1_356, 293, 6_315_513, 280, 52_899_742, 60_212_804), hfModelId: 'Xenova/opus-mt-en-fi', sourceLang: 'en', targetLang: 'fi' },
  { id: 'opus-mt-en-hi', type: 'translation', name: 'Opus-MT (en → hi)', languages: ['en', 'hi'], files: translationFiles(1_389, 293, 6_679_560, 282, 51_337_630, 58_638_488), hfModelId: 'Xenova/opus-mt-en-hi', sourceLang: 'en', targetLang: 'hi' },
  { id: 'opus-mt-en-hu', type: 'translation', name: 'Opus-MT (en → hu)', languages: ['en', 'hu'], files: translationFiles(1_376, 293, 6_133_233, 280, 51_630_494, 58_933_640), hfModelId: 'Xenova/opus-mt-en-hu', sourceLang: 'en', targetLang: 'hu' },
  { id: 'opus-mt-en-id', type: 'translation', name: 'Opus-MT (en → id)', languages: ['en', 'id'], files: translationFiles(1_376, 293, 5_291_338, 280, 47_674_781, 54_947_023), hfModelId: 'Xenova/opus-mt-en-id', sourceLang: 'en', targetLang: 'id' },
  { id: 'opus-mt-en-it', type: 'translation', name: 'Opus-MT (en → it)', languages: ['en', 'it'], files: translationFiles(1_376, 293, 7_904_597, 280, 60_597_150, 67_970_348), hfModelId: 'Xenova/opus-mt-en-it', sourceLang: 'en', targetLang: 'it' },
  { id: 'opus-mt-en-ro', type: 'translation', name: 'Opus-MT (en → ro)', languages: ['en', 'ro'], files: translationFiles(1_376, 293, 5_743_335, 280, 50_105_246, 57_396_476), hfModelId: 'Xenova/opus-mt-en-ro', sourceLang: 'en', targetLang: 'ro' },
  { id: 'opus-mt-en-ru', type: 'translation', name: 'Opus-MT (en → ru)', languages: ['en', 'ru'], files: translationFiles(1_376, 293, 7_205_388, 280, 51_628_446, 58_931_576), hfModelId: 'Xenova/opus-mt-en-ru', sourceLang: 'en', targetLang: 'ru' },
  { id: 'opus-mt-en-sv', type: 'translation', name: 'Opus-MT (en → sv)', languages: ['en', 'sv'], files: translationFiles(1_376, 293, 5_450_794, 280, 48_513_438, 55_792_232), hfModelId: 'Xenova/opus-mt-en-sv', sourceLang: 'en', targetLang: 'sv' },
  { id: 'opus-mt-en-uk', type: 'translation', name: 'Opus-MT (en → uk)', languages: ['en', 'uk'], files: translationFiles(1_376, 293, 6_922_026, 280, 51_151_774, 58_451_180), hfModelId: 'Xenova/opus-mt-en-uk', sourceLang: 'en', targetLang: 'uk' },
  { id: 'opus-mt-en-vi', type: 'translation', name: 'Opus-MT (en → vi)', languages: ['en', 'vi'], files: translationFiles(1_389, 293, 5_163_544, 282, 47_105_950, 54_373_748), hfModelId: 'Xenova/opus-mt-en-vi', sourceLang: 'en', targetLang: 'vi' },
  { id: 'opus-mt-en-xh', type: 'translation', name: 'Opus-MT (en → xh)', languages: ['en', 'xh'], files: translationFiles(1_376, 293, 5_890_672, 280, 50_997_150, 58_295_348), hfModelId: 'Xenova/opus-mt-en-xh', sourceLang: 'en', targetLang: 'xh' },
  // { id: 'opus-mt-en-ROMANCE', type: 'translation', name: 'Opus-MT (en → Romance)', languages: ['en', 'fr', 'es', 'it', 'pt', 'ro'], files: translationFiles(1_508, 293, 6_117_691, 503, 52_899_742, 60_212_804), hfModelId: 'Xenova/opus-mt-en-ROMANCE', sourceLang: 'en', targetLang: 'ROMANCE' },

  // ── Other Languages → English ──────────────────────────────────────────
  { id: 'opus-mt-af-en', type: 'translation', name: 'Opus-MT (af → en)', languages: ['af', 'en'], files: translationFiles(1_376, 293, 5_569_368, 280, 49_031_070, 56_313_908), hfModelId: 'Xenova/opus-mt-af-en', sourceLang: 'af', targetLang: 'en' },
  { id: 'opus-mt-ar-en', type: 'translation', name: 'Opus-MT (ar → en)', languages: ['ar', 'en'], files: translationFiles(1_376, 293, 6_734_647, 280, 51_790_238, 59_094_632), hfModelId: 'Xenova/opus-mt-ar-en', sourceLang: 'ar', targetLang: 'en' },
  // { id: 'opus-mt-bat-en', type: 'translation', name: 'Opus-MT (bat → en)', languages: ['bat', 'en'], files: translationFiles(1_390, 293, 5_787_203, 282, 49_855_902, 57_145_184), hfModelId: 'Xenova/opus-mt-bat-en', sourceLang: 'bat', targetLang: 'en' },
  { id: 'opus-mt-cs-en', type: 'translation', name: 'Opus-MT (cs → en)', languages: ['cs', 'en'], files: translationFiles(1_376, 293, 6_142_807, 280, 51_623_838, 58_926_932), hfModelId: 'Xenova/opus-mt-cs-en', sourceLang: 'cs', targetLang: 'en' },
  { id: 'opus-mt-da-en', type: 'translation', name: 'Opus-MT (da → en)', languages: ['da', 'en'], files: translationFiles(1_376, 293, 5_685_484, 280, 49_791_389, 57_080_167), hfModelId: 'Xenova/opus-mt-da-en', sourceLang: 'da', targetLang: 'en' },
  { id: 'opus-mt-et-en', type: 'translation', name: 'Opus-MT (et → en)', languages: ['et', 'en'], files: translationFiles(1_376, 293, 5_687_431, 280, 49_758_622, 57_047_144), hfModelId: 'Xenova/opus-mt-et-en', sourceLang: 'et', targetLang: 'en' },
  { id: 'opus-mt-fi-en', type: 'translation', name: 'Opus-MT (fi → en)', languages: ['fi', 'en'], files: translationFiles(1_389, 293, 5_772_430, 282, 50_164_638, 57_456_332), hfModelId: 'Xenova/opus-mt-fi-en', sourceLang: 'fi', targetLang: 'en' },
  { id: 'opus-mt-hi-en', type: 'translation', name: 'Opus-MT (hi → en)', languages: ['hi', 'en'], files: translationFiles(1_376, 293, 6_578_153, 280, 50_916_254, 58_213_820), hfModelId: 'Xenova/opus-mt-hi-en', sourceLang: 'hi', targetLang: 'en' },
  { id: 'opus-mt-hu-en', type: 'translation', name: 'Opus-MT (hu → en)', languages: ['hu', 'en'], files: translationFiles(1_376, 293, 6_133_233, 280, 51_630_494, 58_933_640), hfModelId: 'Xenova/opus-mt-hu-en', sourceLang: 'hu', targetLang: 'en' },
  { id: 'opus-mt-id-en', type: 'translation', name: 'Opus-MT (id → en)', languages: ['id', 'en'], files: translationFiles(1_376, 293, 5_291_338, 280, 47_674_782, 54_947_024), hfModelId: 'Xenova/opus-mt-id-en', sourceLang: 'id', targetLang: 'en' },
  { id: 'opus-mt-it-en', type: 'translation', name: 'Opus-MT (it → en)', languages: ['it', 'en'], files: translationFiles(1_376, 293, 7_942_314, 280, 60_773_278, 68_147_852), hfModelId: 'Xenova/opus-mt-it-en', sourceLang: 'it', targetLang: 'en' },
  { id: 'opus-mt-jap-en', type: 'translation', name: 'Opus-MT (ja → en)', languages: ['ja', 'en'], files: translationFiles(1_377, 293, 5_068_572, 281, 43_312_542, 50_550_704), hfModelId: 'Xenova/opus-mt-jap-en', sourceLang: 'ja', targetLang: 'en' },
  { id: 'opus-mt-nl-en', type: 'translation', name: 'Opus-MT (nl → en)', languages: ['nl', 'en'], files: translationFiles(1_376, 293, 6_433_167, 280, 53_937_566, 61_258_736), hfModelId: 'Xenova/opus-mt-nl-en', sourceLang: 'nl', targetLang: 'en' },
  { id: 'opus-mt-pl-en', type: 'translation', name: 'Opus-MT (pl → en)', languages: ['pl', 'en'], files: translationFiles(1_376, 293, 6_118_576, 280, 52_095_390, 59_402_168), hfModelId: 'Xenova/opus-mt-pl-en', sourceLang: 'pl', targetLang: 'en' },
  { id: 'opus-mt-ru-en', type: 'translation', name: 'Opus-MT (ru → en)', languages: ['ru', 'en'], files: translationFiles(1_376, 293, 7_205_388, 280, 51_628_446, 58_931_576), hfModelId: 'Xenova/opus-mt-ru-en', sourceLang: 'ru', targetLang: 'en' },
  { id: 'opus-mt-sv-en', type: 'translation', name: 'Opus-MT (sv → en)', languages: ['sv', 'en'], files: translationFiles(1_376, 293, 5_450_794, 280, 48_513_438, 55_792_232), hfModelId: 'Xenova/opus-mt-sv-en', sourceLang: 'sv', targetLang: 'en' },
  { id: 'opus-mt-tc-big-tr-en', type: 'translation', name: 'Opus-MT (tr → en, big)', languages: ['tr', 'en'], files: translationFiles(1_104, 301, 5_606_923, 280, 135_755_056, 162_043_892), hfModelId: 'Xenova/opus-mt-tc-big-tr-en', sourceLang: 'tr', targetLang: 'en' },
  { id: 'opus-mt-th-en', type: 'translation', name: 'Opus-MT (th → en)', languages: ['th', 'en'], files: translationFiles(1_389, 293, 7_011_245, 282, 51_520_414, 58_822_700), hfModelId: 'Xenova/opus-mt-th-en', sourceLang: 'th', targetLang: 'en' },
  { id: 'opus-mt-tr-en', type: 'translation', name: 'Opus-MT (tr → en)', languages: ['tr', 'en'], files: translationFiles(1_376, 293, 6_123_578, 280, 51_562_398, 58_865_012), hfModelId: 'Xenova/opus-mt-tr-en', sourceLang: 'tr', targetLang: 'en' },
  { id: 'opus-mt-uk-en', type: 'translation', name: 'Opus-MT (uk → en)', languages: ['uk', 'en'], files: translationFiles(1_376, 293, 6_922_026, 280, 51_151_774, 58_451_180), hfModelId: 'Xenova/opus-mt-uk-en', sourceLang: 'uk', targetLang: 'en' },
  { id: 'opus-mt-vi-en', type: 'translation', name: 'Opus-MT (vi → en)', languages: ['vi', 'en'], files: translationFiles(1_389, 293, 5_169_708, 282, 47_133_597, 54_401_611), hfModelId: 'Xenova/opus-mt-vi-en', sourceLang: 'vi', targetLang: 'en' },
  { id: 'opus-mt-xh-en', type: 'translation', name: 'Opus-MT (xh → en)', languages: ['xh', 'en'], files: translationFiles(1_376, 293, 5_890_672, 280, 50_997_150, 58_295_348), hfModelId: 'Xenova/opus-mt-xh-en', sourceLang: 'xh', targetLang: 'en' },
  // { id: 'opus-mt-ROMANCE-en', type: 'translation', name: 'Opus-MT (Romance → en)', languages: ['fr', 'es', 'it', 'pt', 'ro', 'en'], files: translationFiles(1_361, 293, 6_120_151, 503, 52_899_741, 60_212_803), hfModelId: 'Xenova/opus-mt-ROMANCE-en', sourceLang: 'ROMANCE', targetLang: 'en' },

  // ── Non-English Pairs ──────────────────────────────────────────────────
  { id: 'opus-mt-da-de', type: 'translation', name: 'Opus-MT (da → de)', languages: ['da', 'de'], files: translationFiles(1_376, 293, 5_538_319, 280, 48_817_054, 56_098_220), hfModelId: 'Xenova/opus-mt-da-de', sourceLang: 'da', targetLang: 'de' },
  { id: 'opus-mt-de-es', type: 'translation', name: 'Opus-MT (de → es)', languages: ['de', 'es'], files: translationFiles(1_376, 293, 5_944_958, 280, 51_005_342, 58_303_604), hfModelId: 'Xenova/opus-mt-de-es', sourceLang: 'de', targetLang: 'es' },
  { id: 'opus-mt-de-fr', type: 'translation', name: 'Opus-MT (de → fr)', languages: ['de', 'fr'], files: translationFiles(1_376, 293, 5_930_679, 280, 50_929_565, 58_227_235), hfModelId: 'Xenova/opus-mt-de-fr', sourceLang: 'de', targetLang: 'fr' },
  { id: 'opus-mt-es-de', type: 'translation', name: 'Opus-MT (es → de)', languages: ['es', 'de'], files: translationFiles(1_376, 293, 5_944_958, 280, 51_005_342, 58_303_604), hfModelId: 'Xenova/opus-mt-es-de', sourceLang: 'es', targetLang: 'de' },
  { id: 'opus-mt-es-fr', type: 'translation', name: 'Opus-MT (es → fr)', languages: ['es', 'fr'], files: translationFiles(1_376, 293, 7_583_355, 280, 57_928_094, 65_280_440), hfModelId: 'Xenova/opus-mt-es-fr', sourceLang: 'es', targetLang: 'fr' },
  { id: 'opus-mt-es-it', type: 'translation', name: 'Opus-MT (es → it)', languages: ['es', 'it'], files: translationFiles(1_376, 293, 5_711_996, 280, 49_843_102, 57_132_284), hfModelId: 'Xenova/opus-mt-es-it', sourceLang: 'es', targetLang: 'it' },
  { id: 'opus-mt-es-ru', type: 'translation', name: 'Opus-MT (es → ru)', languages: ['es', 'ru'], files: translationFiles(1_376, 293, 7_259_220, 280, 52_095_390, 59_402_168), hfModelId: 'Xenova/opus-mt-es-ru', sourceLang: 'es', targetLang: 'ru' },
  { id: 'opus-mt-fi-de', type: 'translation', name: 'Opus-MT (fi → de)', languages: ['fi', 'de'], files: translationFiles(1_376, 293, 5_823_405, 280, 50_068_382, 57_359_324), hfModelId: 'Xenova/opus-mt-fi-de', sourceLang: 'fi', targetLang: 'de' },
  { id: 'opus-mt-fr-de', type: 'translation', name: 'Opus-MT (fr → de)', languages: ['fr', 'de'], files: translationFiles(1_376, 293, 5_930_679, 280, 50_929_566, 58_227_236), hfModelId: 'Xenova/opus-mt-fr-de', sourceLang: 'fr', targetLang: 'de' },
  { id: 'opus-mt-fr-es', type: 'translation', name: 'Opus-MT (fr → es)', languages: ['fr', 'es'], files: translationFiles(1_376, 293, 7_583_355, 280, 57_928_094, 65_280_440), hfModelId: 'Xenova/opus-mt-fr-es', sourceLang: 'fr', targetLang: 'es' },
  { id: 'opus-mt-fr-ro', type: 'translation', name: 'Opus-MT (fr → ro)', languages: ['fr', 'ro'], files: translationFiles(1_376, 293, 5_528_391, 280, 48_615_837, 55_895_431), hfModelId: 'Xenova/opus-mt-fr-ro', sourceLang: 'fr', targetLang: 'ro' },
  { id: 'opus-mt-fr-ru', type: 'translation', name: 'Opus-MT (fr → ru)', languages: ['fr', 'ru'], files: translationFiles(1_376, 293, 7_356_933, 280, 52_580_253, 59_890_819), hfModelId: 'Xenova/opus-mt-fr-ru', sourceLang: 'fr', targetLang: 'ru' },
  { id: 'opus-mt-it-es', type: 'translation', name: 'Opus-MT (it → es)', languages: ['it', 'es'], files: translationFiles(1_376, 293, 5_711_996, 280, 49_843_102, 57_132_284), hfModelId: 'Xenova/opus-mt-it-es', sourceLang: 'it', targetLang: 'es' },
  { id: 'opus-mt-it-fr', type: 'translation', name: 'Opus-MT (it → fr)', languages: ['it', 'fr'], files: translationFiles(1_376, 293, 5_750_861, 280, 50_006_942, 57_297_404), hfModelId: 'Xenova/opus-mt-it-fr', sourceLang: 'it', targetLang: 'fr' },
  { id: 'opus-mt-nl-fr', type: 'translation', name: 'Opus-MT (nl → fr)', languages: ['nl', 'fr'], files: translationFiles(1_376, 293, 5_580_536, 280, 49_131_934, 56_415_560), hfModelId: 'Xenova/opus-mt-nl-fr', sourceLang: 'nl', targetLang: 'fr' },
  { id: 'opus-mt-no-de', type: 'translation', name: 'Opus-MT (no → de)', languages: ['no', 'de'], files: translationFiles(1_383, 290, 664_998, 282, 23_212_445, 30_293_569), hfModelId: 'Xenova/opus-mt-no-de', sourceLang: 'no', targetLang: 'de' },
  { id: 'opus-mt-ro-fr', type: 'translation', name: 'Opus-MT (ro → fr)', languages: ['ro', 'fr'], files: translationFiles(1_376, 293, 5_528_391, 280, 48_615_838, 55_895_432), hfModelId: 'Xenova/opus-mt-ro-fr', sourceLang: 'ro', targetLang: 'fr' },
  { id: 'opus-mt-ru-es', type: 'translation', name: 'Opus-MT (ru → es)', languages: ['ru', 'es'], files: translationFiles(1_376, 293, 7_259_220, 280, 52_095_390, 59_402_168), hfModelId: 'Xenova/opus-mt-ru-es', sourceLang: 'ru', targetLang: 'es' },
  { id: 'opus-mt-ru-fr', type: 'translation', name: 'Opus-MT (ru → fr)', languages: ['ru', 'fr'], files: translationFiles(1_411, 293, 7_356_933, 280, 52_580_253, 59_890_819), hfModelId: 'Xenova/opus-mt-ru-fr', sourceLang: 'ru', targetLang: 'fr' },
  { id: 'opus-mt-ru-uk', type: 'translation', name: 'Opus-MT (ru → uk)', languages: ['ru', 'uk'], files: translationFiles(1_389, 293, 7_632_973, 282, 49_201_054, 56_485_220), hfModelId: 'Xenova/opus-mt-ru-uk', sourceLang: 'ru', targetLang: 'uk' },
  { id: 'opus-mt-uk-ru', type: 'translation', name: 'Opus-MT (uk → ru)', languages: ['uk', 'ru'], files: translationFiles(1_389, 293, 7_632_973, 282, 49_201_054, 56_485_220), hfModelId: 'Xenova/opus-mt-uk-ru', sourceLang: 'uk', targetLang: 'ru' },

  // ── Multilingual Translation Models ───────────────────────────────────
  {
    id: 'qwen2.5-0.5b-translation',
    type: 'translation',
    name: 'Qwen 2.5 0.5B (multilingual, WebGPU)',
    languages: [
      'ja', 'zh', 'en', 'ko', 'de', 'fr', 'es', 'ru',
      'ar', 'pt', 'th', 'vi', 'id', 'tr', 'nl', 'pl',
      'it', 'hi', 'sv', 'da', 'fi', 'hu', 'ro', 'no',
      'uk', 'cs', 'et', 'af',
    ],
    multilingual: true,
    requiredDevice: 'webgpu',
    hfModelId: 'onnx-community/Qwen2.5-0.5B-Instruct',
    files: qwenTranslationFiles(),
    translationWorkerType: 'qwen',
  },
  {
    id: 'qwen3-0.6b-translation',
    type: 'translation',
    name: 'Qwen 3 0.6B (multilingual, WebGPU)',
    languages: [
      'ja', 'zh', 'en', 'ko', 'de', 'fr', 'es', 'ru',
      'ar', 'pt', 'th', 'vi', 'id', 'tr', 'nl', 'pl',
      'it', 'hi', 'sv', 'da', 'fi', 'hu', 'ro', 'no',
      'uk', 'cs', 'et', 'af',
    ],
    multilingual: true,
    requiredDevice: 'webgpu',
    hfModelId: 'onnx-community/Qwen3-0.6B-ONNX',
    files: qwen3TranslationFiles(),
    dtype: 'q4',
    translationWorkerType: 'qwen',
  },
  {
    id: 'qwen3.5-0.8b-translation',
    type: 'translation',
    name: 'Qwen 3.5 0.8B (multilingual, WebGPU)',
    languages: [
      'ja', 'zh', 'en', 'ko', 'de', 'fr', 'es', 'ru',
      'ar', 'pt', 'th', 'vi', 'id', 'tr', 'nl', 'pl',
      'it', 'hi', 'sv', 'da', 'fi', 'hu', 'ro', 'no',
      'uk', 'cs', 'et', 'af',
    ],
    multilingual: true,
    requiredDevice: 'webgpu',
    hfModelId: 'onnx-community/Qwen3.5-0.8B-ONNX',
    files: qwen35_08bTranslationFiles(),
    dtype: { embed_tokens: 'q4', vision_encoder: 'q4', decoder_model_merged: 'q4' },
    translationWorkerType: 'qwen35',
  },
  {
    id: 'qwen3.5-2b-translation',
    type: 'translation',
    name: 'Qwen 3.5 2B (multilingual, WebGPU)',
    languages: [
      'ja', 'zh', 'en', 'ko', 'de', 'fr', 'es', 'ru',
      'ar', 'pt', 'th', 'vi', 'id', 'tr', 'nl', 'pl',
      'it', 'hi', 'sv', 'da', 'fi', 'hu', 'ro', 'no',
      'uk', 'cs', 'et', 'af',
    ],
    multilingual: true,
    requiredDevice: 'webgpu',
    hfModelId: 'onnx-community/Qwen3.5-2B-ONNX',
    files: qwen35_2bTranslationFiles(),
    dtype: { embed_tokens: 'q4', vision_encoder: 'q4', decoder_model_merged: 'q4' },
    translationWorkerType: 'qwen35',
  },

  // ── Language Family Models ─────────────────────────────────────────────
  // { id: 'opus-mt-gem-gem', type: 'translation', name: 'Opus-MT (Germanic ↔ Germanic)', languages: ['de', 'en', 'nl', 'da', 'sv', 'no'], files: translationFiles(1_391, 293, 3_640_084, 282, 38_944_670, 46_148_708), hfModelId: 'Xenova/opus-mt-gem-gem', sourceLang: 'gem', targetLang: 'gem' },
  // { id: 'opus-mt-gmw-gmw', type: 'translation', name: 'Opus-MT (West Germanic ↔ West Germanic)', languages: ['de', 'en', 'nl', 'af'], files: translationFiles(1_391, 293, 3_431_142, 282, 37_776_798, 44_971_712), hfModelId: 'Xenova/opus-mt-gmw-gmw', sourceLang: 'gmw', targetLang: 'gmw' },
];

// ─── Language Helpers ────────────────────────────────────────────────────────

import { getLanguageOption } from '../../utils/languages';
import type { LanguageOption } from '../../services/providers/ProviderConfig';

/** Get all unique source languages available across translation models */
export function getTranslationSourceLanguages(): LanguageOption[] {
  const codes = new Set<string>();
  for (const m of MODEL_MANIFEST.filter(m => m.type === 'translation')) {
    if (m.multilingual) {
      m.languages.forEach(l => codes.add(l));
    } else if (m.sourceLang) {
      codes.add(m.sourceLang);
    }
  }
  return [...codes].map(getLanguageOption).sort((a, b) => a.englishName.localeCompare(b.englishName));
}

/** Get available target languages for a given source language */
export function getTranslationTargetLanguages(sourceLang: string): LanguageOption[] {
  const codes = new Set<string>();
  for (const m of MODEL_MANIFEST.filter(m => m.type === 'translation')) {
    if (m.multilingual && m.languages.includes(sourceLang)) {
      m.languages.forEach(l => { if (l !== sourceLang) codes.add(l); });
    } else if (m.sourceLang === sourceLang && m.targetLang) {
      codes.add(m.targetLang);
    }
  }
  return [...codes].map(getLanguageOption).sort((a, b) => a.englishName.localeCompare(b.englishName));
}

// ─── Query Helpers ───────────────────────────────────────────────────────────

/** Get a manifest entry by model ID */
export function getManifestEntry(modelId: string): ModelManifestEntry | undefined {
  return MODEL_MANIFEST.find(m => m.id === modelId);
}

/** Get all manifest entries of a given type */
export function getManifestByType(type: ModelType): ModelManifestEntry[] {
  return MODEL_MANIFEST.filter(m => m.type === type);
}

/** Get ASR models (offline + streaming) that support a given language */
export function getAsrModelsForLanguage(lang: string): ModelManifestEntry[] {
  return MODEL_MANIFEST.filter(
    m => (m.type === 'asr' || m.type === 'asr-stream')
      && (m.multilingual || m.languages.includes(lang))
  );
}

/** Get translation model for a language pair.
 *  Prefers pair-specific models (faster, higher quality) over multilingual fallback. */
export function getTranslationModel(sourceLang: string, targetLang: string): ModelManifestEntry | undefined {
  // Prefer pair-specific models (higher quality, faster)
  const pairModel = MODEL_MANIFEST.find(
    m => m.type === 'translation' && m.sourceLang === sourceLang && m.targetLang === targetLang
  );
  if (pairModel) return pairModel;
  // Fallback: multilingual model supporting both languages
  return MODEL_MANIFEST.find(
    m => m.type === 'translation' && m.multilingual
      && m.languages.includes(sourceLang) && m.languages.includes(targetLang)
  );
}

/** Check if a translation model is compatible with a given language pair. */
export function isTranslationModelCompatible(
  entry: ModelManifestEntry, sourceLang: string, targetLang: string,
): boolean {
  if (entry.type !== 'translation') return false;
  if (entry.multilingual) {
    return entry.languages.includes(sourceLang) && entry.languages.includes(targetLang);
  }
  return entry.sourceLang === sourceLang && entry.targetLang === targetLang;
}

/** Get TTS models that support a given language */
export function getTtsModelsForLanguage(lang: string): ModelManifestEntry[] {
  return MODEL_MANIFEST.filter(m => m.type === 'tts' && m.languages.includes(lang));
}

/** Total download size in MB, computed from per-file sizes. */
export function getModelSizeMb(entry: ModelManifestEntry): number {
  if (!entry.files) return 0;
  return Math.round(entry.files.reduce((sum, f) => sum + f.sizeBytes, 0) / 1_048_576);
}
