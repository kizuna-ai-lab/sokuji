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

export interface ModelManifestEntry {
  /** Unique model identifier (e.g. 'sensevoice', 'piper-en', 'opus-mt-ja-en') */
  id: string;
  type: ModelType;
  /** Human-readable name */
  name: string;
  /** Languages supported by this model */
  languages: string[];
  /** Total download size in MB (approximate) */
  totalSizeMb: number;

  // ─── sherpa-onnx specific (ASR / TTS) ──────────────────────────────────
  /** List of files that must be downloaded */
  files?: ModelFileEntry[];
  /** CDN path segment for download URL construction (e.g. 'sherpa-onnx-asr-sensevoice') */
  cdnPath?: string;
  /** TTS .onnx model filename */
  modelFile?: string;

  // ─── Translation specific ──────────────────────────────────────────────
  /** HuggingFace model ID (e.g. 'Xenova/opus-mt-ja-en') */
  hfModelId?: string;
  sourceLang?: string;
  targetLang?: string;
}

// ─── CDN URL Configuration ───────────────────────────────────────────────────

/**
 * Base URL for model file downloads.
 * - Development: Vite dev server serves from public/wasm/ (default)
 * - Production: Set VITE_MODEL_CDN_URL env var to a CDN endpoint
 */
export function getModelCdnBaseUrl(): string {
  return (import.meta as any).env?.VITE_MODEL_CDN_URL || '/wasm';
}

/**
 * Get the download URL for a specific file within a model.
 */
export function getModelFileUrl(cdnPath: string, filename: string): string {
  const base = getModelCdnBaseUrl();
  return `${base}/${cdnPath}/${filename}`;
}

// ─── Shared File Lists ───────────────────────────────────────────────────────
// Offline VAD+ASR models share the same WASM binary structure (same .js/.wasm
// filenames) with different .data files containing different models.
// Sizes are from sensevoice; other models have similar .js/.wasm but different .data.

const ASR_FILES: ModelFileEntry[] = [
  { filename: 'sherpa-onnx-wasm-main-vad-asr.js', sizeBytes: 95_318 },
  { filename: 'sherpa-onnx-wasm-main-vad-asr.wasm', sizeBytes: 11_700_583 },
  { filename: 'sherpa-onnx-wasm-main-vad-asr.data', sizeBytes: 240_193_589 },
  { filename: 'sherpa-onnx-vad.js', sizeBytes: 7_764 },
  { filename: 'sherpa-onnx-asr.js', sizeBytes: 46_198 },
];

// Streaming ASR models use a different WASM binary (no VAD, different main file names).
// Sizes are from stream-en; other streaming models have different .data sizes.
const STREAM_ASR_FILES: ModelFileEntry[] = [
  { filename: 'sherpa-onnx-wasm-main-asr.js', sizeBytes: 92_240 },
  { filename: 'sherpa-onnx-wasm-main-asr.wasm', sizeBytes: 11_547_795 },
  { filename: 'sherpa-onnx-wasm-main-asr.data', sizeBytes: 190_951_044 },
  { filename: 'sherpa-onnx-asr.js', sizeBytes: 46_198 },
];

const TTS_FILES: ModelFileEntry[] = [
  { filename: 'sherpa-onnx-wasm-main-tts.js', sizeBytes: 120_227 },
  { filename: 'sherpa-onnx-wasm-main-tts.wasm', sizeBytes: 11_903_250 },
  { filename: 'sherpa-onnx-wasm-main-tts.data', sizeBytes: 96_523_617 },
  { filename: 'sherpa-onnx-tts.js', sizeBytes: 25_896 },
];

// Translation models (Opus-MT via Transformers.js) share the same file structure.
// Sizes are from Xenova/opus-mt-ja-en; other pairs are similar.
const TRANSLATION_FILES: ModelFileEntry[] = [
  { filename: 'config.json', sizeBytes: 1_376 },
  { filename: 'generation_config.json', sizeBytes: 293 },
  { filename: 'tokenizer.json', sizeBytes: 5_991_485 },
  { filename: 'tokenizer_config.json', sizeBytes: 280 },
  { filename: 'onnx/encoder_model_quantized.onnx', sizeBytes: 50_705_822 },
  { filename: 'onnx/decoder_model_merged_quantized.onnx', sizeBytes: 58_001_744 },
];

// ─── Model Manifest ──────────────────────────────────────────────────────────

export const MODEL_MANIFEST: ModelManifestEntry[] = [

  // ── Offline VAD+ASR Models ─────────────────────────────────────────────
  {
    id: 'sensevoice',
    type: 'asr',
    name: 'SenseVoice (ja/zh/en/ko/cantonese)',
    languages: ['ja', 'zh', 'en', 'ko', 'cantonese'],
    totalSizeMb: 158,
    cdnPath: 'sherpa-onnx-asr-sensevoice',
    files: ASR_FILES,
  },
  {
    id: 'reazonspeech',
    type: 'asr',
    name: 'ReazonSpeech (Japanese only)',
    languages: ['ja'],
    totalSizeMb: 137,
    cdnPath: 'sherpa-onnx-asr-reazonspeech',
    files: ASR_FILES,
  },
  {
    id: 'whisper-en',
    type: 'asr',
    name: 'Whisper Tiny (English)',
    languages: ['en'],
    totalSizeMb: 51,
    cdnPath: 'sherpa-onnx-asr-whisper-en',
    files: ASR_FILES,
  },
  {
    id: 'zipformer-en',
    type: 'asr',
    name: 'Zipformer GigaSpeech (English)',
    languages: ['en'],
    totalSizeMb: 59,
    cdnPath: 'sherpa-onnx-asr-zipformer-en',
    files: ASR_FILES,
  },
  {
    id: 'moonshine-en',
    type: 'asr',
    name: 'Moonshine Tiny (English)',
    languages: ['en'],
    totalSizeMb: 105,
    cdnPath: 'sherpa-onnx-asr-moonshine-en',
    files: ASR_FILES,
  },
  {
    id: 'paraformer-small',
    type: 'asr',
    name: 'Paraformer Small (zh/en)',
    languages: ['zh', 'en'],
    totalSizeMb: 77,
    cdnPath: 'sherpa-onnx-asr-paraformer-small',
    files: ASR_FILES,
  },
  {
    id: 'paraformer-large',
    type: 'asr',
    name: 'Paraformer Large (zh/en)',
    languages: ['zh', 'en'],
    totalSizeMb: 225,
    cdnPath: 'sherpa-onnx-asr-paraformer-large',
    files: ASR_FILES,
  },
  {
    id: 'wenetspeech',
    type: 'asr',
    name: 'Zipformer WenetSpeech (Chinese)',
    languages: ['zh'],
    totalSizeMb: 69,
    cdnPath: 'sherpa-onnx-asr-wenetspeech',
    files: ASR_FILES,
  },
  {
    id: 'telespeech',
    type: 'asr',
    name: 'TeleSpeech (Chinese)',
    languages: ['zh'],
    totalSizeMb: 177,
    cdnPath: 'sherpa-onnx-asr-telespeech',
    files: ASR_FILES,
  },
  {
    id: 'zipformer-ctc-zh',
    type: 'asr',
    name: 'Zipformer CTC (Chinese)',
    languages: ['zh'],
    totalSizeMb: 290,
    cdnPath: 'sherpa-onnx-asr-zipformer-ctc-zh',
    files: ASR_FILES,
  },
  {
    id: 'dolphin',
    type: 'asr',
    name: 'Dolphin CTC (multilingual)',
    languages: ['zh', 'en', 'ja', 'ko', 'de', 'fr', 'es'],
    totalSizeMb: 80,
    cdnPath: 'sherpa-onnx-asr-dolphin',
    files: ASR_FILES,
  },
  {
    id: 'gigaspeech2-th',
    type: 'asr',
    name: 'Zipformer GigaSpeech2 (Thai)',
    languages: ['th'],
    totalSizeMb: 126,
    cdnPath: 'sherpa-onnx-asr-gigaspeech2-th',
    files: ASR_FILES,
  },

  // ── Streaming ASR Models ───────────────────────────────────────────────
  // These use a different WASM binary (no VAD) and require a streaming engine.
  {
    id: 'stream-en',
    type: 'asr-stream',
    name: 'Streaming Zipformer (English)',
    languages: ['en'],
    totalSizeMb: 167,
    cdnPath: 'sherpa-onnx-asr-stream-en',
    files: STREAM_ASR_FILES,
  },
  {
    id: 'stream-zh-en',
    type: 'asr-stream',
    name: 'Streaming Zipformer (zh/en)',
    languages: ['zh', 'en'],
    totalSizeMb: 173,
    cdnPath: 'sherpa-onnx-asr-stream-zh-en',
    files: STREAM_ASR_FILES,
  },
  {
    id: 'stream-paraformer',
    type: 'asr-stream',
    name: 'Streaming Paraformer (zh/en)',
    languages: ['zh', 'en'],
    totalSizeMb: 218,
    cdnPath: 'sherpa-onnx-asr-stream-paraformer',
    files: STREAM_ASR_FILES,
  },
  {
    id: 'stream-paraformer-cantonese',
    type: 'asr-stream',
    name: 'Streaming Paraformer (zh/cantonese/en)',
    languages: ['zh', 'cantonese', 'en'],
    totalSizeMb: 219,
    cdnPath: 'sherpa-onnx-asr-stream-paraformer-cantonese',
    files: STREAM_ASR_FILES,
  },

  // ── TTS: Piper Models ─────────────────────────────────────────────────
  {
    id: 'piper-en',
    type: 'tts',
    name: 'Piper LibriTTS-R (English, multi-speaker)',
    languages: ['en'],
    totalSizeMb: 81,
    cdnPath: 'sherpa-onnx-tts-piper-en',
    modelFile: 'en_US-libritts_r-medium.onnx',
    files: TTS_FILES,
  },
  {
    id: 'piper-de',
    type: 'tts',
    name: 'Piper Thorsten Emotional (German)',
    languages: ['de'],
    totalSizeMb: 79,
    cdnPath: 'sherpa-onnx-tts-piper-de',
    modelFile: 'de_DE-thorsten_emotional-medium.onnx',
    files: TTS_FILES,
  },

  // ── TTS: Matcha Models ────────────────────────────────────────────────
  // Matcha models share file structure with Piper but use a different model
  // config internally. The TTS worker needs Matcha config support to use these.
  {
    id: 'matcha-en',
    type: 'tts',
    name: 'Matcha LJSpeech (English)',
    languages: ['en'],
    totalSizeMb: 125,
    cdnPath: 'sherpa-onnx-tts-matcha-en',
    files: TTS_FILES,
  },
  {
    id: 'matcha-zh',
    type: 'tts',
    name: 'Matcha Baker (Chinese)',
    languages: ['zh'],
    totalSizeMb: 120,
    cdnPath: 'sherpa-onnx-tts-matcha-zh',
    files: TTS_FILES,
  },
  {
    id: 'matcha-zh-en',
    type: 'tts',
    name: 'Matcha (zh/en bilingual)',
    languages: ['zh', 'en'],
    totalSizeMb: 127,
    cdnPath: 'sherpa-onnx-tts-matcha-zh-en',
    files: TTS_FILES,
  },

  // ── Translation Models ───────────────────────────────────────────────────
  // All translation models use CDN + IndexedDB (same as ASR/TTS).
  // hfModelId is still needed by the worker for pipeline() identification.
  { id: 'opus-mt-ja-en', type: 'translation', name: 'Opus-MT (ja → en)', languages: ['ja', 'en'], totalSizeMb: 110, cdnPath: 'opus-mt-ja-en', files: TRANSLATION_FILES, hfModelId: 'Xenova/opus-mt-ja-en', sourceLang: 'ja', targetLang: 'en' },
  { id: 'opus-mt-en-ja', type: 'translation', name: 'Opus-MT (en → ja)', languages: ['en', 'ja'], totalSizeMb: 110, cdnPath: 'opus-mt-en-ja', files: TRANSLATION_FILES, hfModelId: 'Xenova/opus-mt-en-ja', sourceLang: 'en', targetLang: 'ja' },
  { id: 'opus-mt-zh-en', type: 'translation', name: 'Opus-MT (zh → en)', languages: ['zh', 'en'], totalSizeMb: 110, cdnPath: 'opus-mt-zh-en', files: TRANSLATION_FILES, hfModelId: 'Xenova/opus-mt-zh-en', sourceLang: 'zh', targetLang: 'en' },
  { id: 'opus-mt-en-zh', type: 'translation', name: 'Opus-MT (en → zh)', languages: ['en', 'zh'], totalSizeMb: 110, cdnPath: 'opus-mt-en-zh', files: TRANSLATION_FILES, hfModelId: 'Xenova/opus-mt-en-zh', sourceLang: 'en', targetLang: 'zh' },
  { id: 'opus-mt-ko-en', type: 'translation', name: 'Opus-MT (ko → en)', languages: ['ko', 'en'], totalSizeMb: 110, cdnPath: 'opus-mt-ko-en', files: TRANSLATION_FILES, hfModelId: 'Xenova/opus-mt-ko-en', sourceLang: 'ko', targetLang: 'en' },
  { id: 'opus-mt-en-ko', type: 'translation', name: 'Opus-MT (en → ko)', languages: ['en', 'ko'], totalSizeMb: 110, cdnPath: 'opus-mt-en-ko', files: TRANSLATION_FILES, hfModelId: 'Xenova/opus-mt-en-ko', sourceLang: 'en', targetLang: 'ko' },
  { id: 'opus-mt-de-en', type: 'translation', name: 'Opus-MT (de → en)', languages: ['de', 'en'], totalSizeMb: 110, cdnPath: 'opus-mt-de-en', files: TRANSLATION_FILES, hfModelId: 'Xenova/opus-mt-de-en', sourceLang: 'de', targetLang: 'en' },
  { id: 'opus-mt-en-de', type: 'translation', name: 'Opus-MT (en → de)', languages: ['en', 'de'], totalSizeMb: 110, cdnPath: 'opus-mt-en-de', files: TRANSLATION_FILES, hfModelId: 'Xenova/opus-mt-en-de', sourceLang: 'en', targetLang: 'de' },
  { id: 'opus-mt-fr-en', type: 'translation', name: 'Opus-MT (fr → en)', languages: ['fr', 'en'], totalSizeMb: 110, cdnPath: 'opus-mt-fr-en', files: TRANSLATION_FILES, hfModelId: 'Xenova/opus-mt-fr-en', sourceLang: 'fr', targetLang: 'en' },
  { id: 'opus-mt-en-fr', type: 'translation', name: 'Opus-MT (en → fr)', languages: ['en', 'fr'], totalSizeMb: 110, cdnPath: 'opus-mt-en-fr', files: TRANSLATION_FILES, hfModelId: 'Xenova/opus-mt-en-fr', sourceLang: 'en', targetLang: 'fr' },
  { id: 'opus-mt-es-en', type: 'translation', name: 'Opus-MT (es → en)', languages: ['es', 'en'], totalSizeMb: 110, cdnPath: 'opus-mt-es-en', files: TRANSLATION_FILES, hfModelId: 'Xenova/opus-mt-es-en', sourceLang: 'es', targetLang: 'en' },
  { id: 'opus-mt-en-es', type: 'translation', name: 'Opus-MT (en → es)', languages: ['en', 'es'], totalSizeMb: 110, cdnPath: 'opus-mt-en-es', files: TRANSLATION_FILES, hfModelId: 'Xenova/opus-mt-en-es', sourceLang: 'en', targetLang: 'es' },
];

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
    m => (m.type === 'asr' || m.type === 'asr-stream') && m.languages.includes(lang)
  );
}

/** Get translation model for a language pair */
export function getTranslationModel(sourceLang: string, targetLang: string): ModelManifestEntry | undefined {
  return MODEL_MANIFEST.find(
    m => m.type === 'translation' && m.sourceLang === sourceLang && m.targetLang === targetLang
  );
}

/** Get TTS models that support a given language */
export function getTtsModelsForLanguage(lang: string): ModelManifestEntry[] {
  return MODEL_MANIFEST.filter(m => m.type === 'tts' && m.languages.includes(lang));
}
