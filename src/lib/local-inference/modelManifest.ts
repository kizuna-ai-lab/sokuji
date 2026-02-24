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

export type ModelType = 'asr' | 'tts' | 'translation';
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
// ASR models (sensevoice / reazonspeech) share the same WASM binary structure
// but with different .data files containing different models.

const ASR_FILES: ModelFileEntry[] = [
  { filename: 'sherpa-onnx-wasm-main-vad-asr.js', sizeBytes: 95_318 },
  { filename: 'sherpa-onnx-wasm-main-vad-asr.wasm', sizeBytes: 11_700_583 },
  { filename: 'sherpa-onnx-wasm-main-vad-asr.data', sizeBytes: 240_193_589 },
  { filename: 'sherpa-onnx-vad.js', sizeBytes: 7_764 },
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

  // ── ASR Models ───────────────────────────────────────────────────────────
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

  // ── TTS Models ───────────────────────────────────────────────────────────
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

/** Get ASR models that support a given language */
export function getAsrModelsForLanguage(lang: string): ModelManifestEntry[] {
  return MODEL_MANIFEST.filter(m => m.type === 'asr' && m.languages.includes(lang));
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
