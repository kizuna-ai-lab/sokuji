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

  // ── Existing Core Pairs (ja/zh/ko/de/fr/es ↔ en) ──────────────────────
  { id: 'opus-mt-ja-en', type: 'translation', name: 'Opus-MT (ja → en)', languages: ['ja', 'en'], totalSizeMb: 110, cdnPath: 'opus-mt-ja-en', files: TRANSLATION_FILES, hfModelId: 'Xenova/opus-mt-ja-en', sourceLang: 'ja', targetLang: 'en' },
  { id: 'opus-mt-en-jap', type: 'translation', name: 'Opus-MT (en → ja)', languages: ['en', 'ja'], totalSizeMb: 110, cdnPath: 'opus-mt-en-jap', files: TRANSLATION_FILES, hfModelId: 'Xenova/opus-mt-en-jap', sourceLang: 'en', targetLang: 'ja' },
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

  // ── English → Other Languages ──────────────────────────────────────────
  { id: 'opus-mt-en-af', type: 'translation', name: 'Opus-MT (en → af)', languages: ['en', 'af'], totalSizeMb: 110, cdnPath: 'opus-mt-en-af', files: TRANSLATION_FILES, hfModelId: 'Xenova/opus-mt-en-af', sourceLang: 'en', targetLang: 'af' },
  { id: 'opus-mt-en-ar', type: 'translation', name: 'Opus-MT (en → ar)', languages: ['en', 'ar'], totalSizeMb: 110, cdnPath: 'opus-mt-en-ar', files: TRANSLATION_FILES, hfModelId: 'Xenova/opus-mt-en-ar', sourceLang: 'en', targetLang: 'ar' },
  { id: 'opus-mt-en-cs', type: 'translation', name: 'Opus-MT (en → cs)', languages: ['en', 'cs'], totalSizeMb: 110, cdnPath: 'opus-mt-en-cs', files: TRANSLATION_FILES, hfModelId: 'Xenova/opus-mt-en-cs', sourceLang: 'en', targetLang: 'cs' },
  { id: 'opus-mt-en-da', type: 'translation', name: 'Opus-MT (en → da)', languages: ['en', 'da'], totalSizeMb: 110, cdnPath: 'opus-mt-en-da', files: TRANSLATION_FILES, hfModelId: 'Xenova/opus-mt-en-da', sourceLang: 'en', targetLang: 'da' },
  { id: 'opus-mt-en-nl', type: 'translation', name: 'Opus-MT (en → nl)', languages: ['en', 'nl'], totalSizeMb: 110, cdnPath: 'opus-mt-en-nl', files: TRANSLATION_FILES, hfModelId: 'Xenova/opus-mt-en-nl', sourceLang: 'en', targetLang: 'nl' },
  { id: 'opus-mt-en-fi', type: 'translation', name: 'Opus-MT (en → fi)', languages: ['en', 'fi'], totalSizeMb: 110, cdnPath: 'opus-mt-en-fi', files: TRANSLATION_FILES, hfModelId: 'Xenova/opus-mt-en-fi', sourceLang: 'en', targetLang: 'fi' },
  { id: 'opus-mt-en-hi', type: 'translation', name: 'Opus-MT (en → hi)', languages: ['en', 'hi'], totalSizeMb: 110, cdnPath: 'opus-mt-en-hi', files: TRANSLATION_FILES, hfModelId: 'Xenova/opus-mt-en-hi', sourceLang: 'en', targetLang: 'hi' },
  { id: 'opus-mt-en-hu', type: 'translation', name: 'Opus-MT (en → hu)', languages: ['en', 'hu'], totalSizeMb: 110, cdnPath: 'opus-mt-en-hu', files: TRANSLATION_FILES, hfModelId: 'Xenova/opus-mt-en-hu', sourceLang: 'en', targetLang: 'hu' },
  { id: 'opus-mt-en-id', type: 'translation', name: 'Opus-MT (en → id)', languages: ['en', 'id'], totalSizeMb: 110, cdnPath: 'opus-mt-en-id', files: TRANSLATION_FILES, hfModelId: 'Xenova/opus-mt-en-id', sourceLang: 'en', targetLang: 'id' },
  { id: 'opus-mt-en-mul', type: 'translation', name: 'Opus-MT (en → mul)', languages: ['en', 'mul'], totalSizeMb: 110, cdnPath: 'opus-mt-en-mul', files: TRANSLATION_FILES, hfModelId: 'Xenova/opus-mt-en-mul', sourceLang: 'en', targetLang: 'mul' },
  { id: 'opus-mt-en-ro', type: 'translation', name: 'Opus-MT (en → ro)', languages: ['en', 'ro'], totalSizeMb: 110, cdnPath: 'opus-mt-en-ro', files: TRANSLATION_FILES, hfModelId: 'Xenova/opus-mt-en-ro', sourceLang: 'en', targetLang: 'ro' },
  { id: 'opus-mt-en-ru', type: 'translation', name: 'Opus-MT (en → ru)', languages: ['en', 'ru'], totalSizeMb: 110, cdnPath: 'opus-mt-en-ru', files: TRANSLATION_FILES, hfModelId: 'Xenova/opus-mt-en-ru', sourceLang: 'en', targetLang: 'ru' },
  { id: 'opus-mt-en-sv', type: 'translation', name: 'Opus-MT (en → sv)', languages: ['en', 'sv'], totalSizeMb: 110, cdnPath: 'opus-mt-en-sv', files: TRANSLATION_FILES, hfModelId: 'Xenova/opus-mt-en-sv', sourceLang: 'en', targetLang: 'sv' },
  { id: 'opus-mt-en-uk', type: 'translation', name: 'Opus-MT (en → uk)', languages: ['en', 'uk'], totalSizeMb: 110, cdnPath: 'opus-mt-en-uk', files: TRANSLATION_FILES, hfModelId: 'Xenova/opus-mt-en-uk', sourceLang: 'en', targetLang: 'uk' },
  { id: 'opus-mt-en-vi', type: 'translation', name: 'Opus-MT (en → vi)', languages: ['en', 'vi'], totalSizeMb: 110, cdnPath: 'opus-mt-en-vi', files: TRANSLATION_FILES, hfModelId: 'Xenova/opus-mt-en-vi', sourceLang: 'en', targetLang: 'vi' },
  { id: 'opus-mt-en-xh', type: 'translation', name: 'Opus-MT (en → xh)', languages: ['en', 'xh'], totalSizeMb: 110, cdnPath: 'opus-mt-en-xh', files: TRANSLATION_FILES, hfModelId: 'Xenova/opus-mt-en-xh', sourceLang: 'en', targetLang: 'xh' },

  // ── Other Languages → English ──────────────────────────────────────────
  { id: 'opus-mt-af-en', type: 'translation', name: 'Opus-MT (af → en)', languages: ['af', 'en'], totalSizeMb: 110, cdnPath: 'opus-mt-af-en', files: TRANSLATION_FILES, hfModelId: 'Xenova/opus-mt-af-en', sourceLang: 'af', targetLang: 'en' },
  { id: 'opus-mt-ar-en', type: 'translation', name: 'Opus-MT (ar → en)', languages: ['ar', 'en'], totalSizeMb: 110, cdnPath: 'opus-mt-ar-en', files: TRANSLATION_FILES, hfModelId: 'Xenova/opus-mt-ar-en', sourceLang: 'ar', targetLang: 'en' },
  { id: 'opus-mt-bat-en', type: 'translation', name: 'Opus-MT (bat → en)', languages: ['bat', 'en'], totalSizeMb: 110, cdnPath: 'opus-mt-bat-en', files: TRANSLATION_FILES, hfModelId: 'Xenova/opus-mt-bat-en', sourceLang: 'bat', targetLang: 'en' },
  { id: 'opus-mt-cs-en', type: 'translation', name: 'Opus-MT (cs → en)', languages: ['cs', 'en'], totalSizeMb: 110, cdnPath: 'opus-mt-cs-en', files: TRANSLATION_FILES, hfModelId: 'Xenova/opus-mt-cs-en', sourceLang: 'cs', targetLang: 'en' },
  { id: 'opus-mt-hi-en', type: 'translation', name: 'Opus-MT (hi → en)', languages: ['hi', 'en'], totalSizeMb: 110, cdnPath: 'opus-mt-hi-en', files: TRANSLATION_FILES, hfModelId: 'Xenova/opus-mt-hi-en', sourceLang: 'hi', targetLang: 'en' },
  { id: 'opus-mt-id-en', type: 'translation', name: 'Opus-MT (id → en)', languages: ['id', 'en'], totalSizeMb: 110, cdnPath: 'opus-mt-id-en', files: TRANSLATION_FILES, hfModelId: 'Xenova/opus-mt-id-en', sourceLang: 'id', targetLang: 'en' },
  { id: 'opus-mt-it-en', type: 'translation', name: 'Opus-MT (it → en)', languages: ['it', 'en'], totalSizeMb: 110, cdnPath: 'opus-mt-it-en', files: TRANSLATION_FILES, hfModelId: 'Xenova/opus-mt-it-en', sourceLang: 'it', targetLang: 'en' },
  { id: 'opus-mt-nl-en', type: 'translation', name: 'Opus-MT (nl → en)', languages: ['nl', 'en'], totalSizeMb: 110, cdnPath: 'opus-mt-nl-en', files: TRANSLATION_FILES, hfModelId: 'Xenova/opus-mt-nl-en', sourceLang: 'nl', targetLang: 'en' },
  { id: 'opus-mt-pl-en', type: 'translation', name: 'Opus-MT (pl → en)', languages: ['pl', 'en'], totalSizeMb: 110, cdnPath: 'opus-mt-pl-en', files: TRANSLATION_FILES, hfModelId: 'Xenova/opus-mt-pl-en', sourceLang: 'pl', targetLang: 'en' },
  { id: 'opus-mt-ru-en', type: 'translation', name: 'Opus-MT (ru → en)', languages: ['ru', 'en'], totalSizeMb: 110, cdnPath: 'opus-mt-ru-en', files: TRANSLATION_FILES, hfModelId: 'Xenova/opus-mt-ru-en', sourceLang: 'ru', targetLang: 'en' },
  { id: 'opus-mt-sv-en', type: 'translation', name: 'Opus-MT (sv → en)', languages: ['sv', 'en'], totalSizeMb: 110, cdnPath: 'opus-mt-sv-en', files: TRANSLATION_FILES, hfModelId: 'Xenova/opus-mt-sv-en', sourceLang: 'sv', targetLang: 'en' },
  { id: 'opus-mt-tr-en', type: 'translation', name: 'Opus-MT (tr → en)', languages: ['tr', 'en'], totalSizeMb: 110, cdnPath: 'opus-mt-tr-en', files: TRANSLATION_FILES, hfModelId: 'Xenova/opus-mt-tr-en', sourceLang: 'tr', targetLang: 'en' },
  { id: 'opus-mt-uk-en', type: 'translation', name: 'Opus-MT (uk → en)', languages: ['uk', 'en'], totalSizeMb: 110, cdnPath: 'opus-mt-uk-en', files: TRANSLATION_FILES, hfModelId: 'Xenova/opus-mt-uk-en', sourceLang: 'uk', targetLang: 'en' },
  { id: 'opus-mt-xh-en', type: 'translation', name: 'Opus-MT (xh → en)', languages: ['xh', 'en'], totalSizeMb: 110, cdnPath: 'opus-mt-xh-en', files: TRANSLATION_FILES, hfModelId: 'Xenova/opus-mt-xh-en', sourceLang: 'xh', targetLang: 'en' },

  // ── Non-English Pairs ──────────────────────────────────────────────────
  { id: 'opus-mt-da-de', type: 'translation', name: 'Opus-MT (da → de)', languages: ['da', 'de'], totalSizeMb: 110, cdnPath: 'opus-mt-da-de', files: TRANSLATION_FILES, hfModelId: 'Xenova/opus-mt-da-de', sourceLang: 'da', targetLang: 'de' },
  { id: 'opus-mt-fi-de', type: 'translation', name: 'Opus-MT (fi → de)', languages: ['fi', 'de'], totalSizeMb: 110, cdnPath: 'opus-mt-fi-de', files: TRANSLATION_FILES, hfModelId: 'Xenova/opus-mt-fi-de', sourceLang: 'fi', targetLang: 'de' },
  { id: 'opus-mt-fr-de', type: 'translation', name: 'Opus-MT (fr → de)', languages: ['fr', 'de'], totalSizeMb: 110, cdnPath: 'opus-mt-fr-de', files: TRANSLATION_FILES, hfModelId: 'Xenova/opus-mt-fr-de', sourceLang: 'fr', targetLang: 'de' },
  { id: 'opus-mt-de-fr', type: 'translation', name: 'Opus-MT (de → fr)', languages: ['de', 'fr'], totalSizeMb: 110, cdnPath: 'opus-mt-de-fr', files: TRANSLATION_FILES, hfModelId: 'Xenova/opus-mt-de-fr', sourceLang: 'de', targetLang: 'fr' },
  { id: 'opus-mt-fr-ro', type: 'translation', name: 'Opus-MT (fr → ro)', languages: ['fr', 'ro'], totalSizeMb: 110, cdnPath: 'opus-mt-fr-ro', files: TRANSLATION_FILES, hfModelId: 'Xenova/opus-mt-fr-ro', sourceLang: 'fr', targetLang: 'ro' },
  { id: 'opus-mt-ro-fr', type: 'translation', name: 'Opus-MT (ro → fr)', languages: ['ro', 'fr'], totalSizeMb: 110, cdnPath: 'opus-mt-ro-fr', files: TRANSLATION_FILES, hfModelId: 'Xenova/opus-mt-ro-fr', sourceLang: 'ro', targetLang: 'fr' },
  { id: 'opus-mt-fr-ru', type: 'translation', name: 'Opus-MT (fr → ru)', languages: ['fr', 'ru'], totalSizeMb: 110, cdnPath: 'opus-mt-fr-ru', files: TRANSLATION_FILES, hfModelId: 'Xenova/opus-mt-fr-ru', sourceLang: 'fr', targetLang: 'ru' },
  { id: 'opus-mt-ru-fr', type: 'translation', name: 'Opus-MT (ru → fr)', languages: ['ru', 'fr'], totalSizeMb: 110, cdnPath: 'opus-mt-ru-fr', files: TRANSLATION_FILES, hfModelId: 'Xenova/opus-mt-ru-fr', sourceLang: 'ru', targetLang: 'fr' },
  { id: 'opus-mt-fr-es', type: 'translation', name: 'Opus-MT (fr → es)', languages: ['fr', 'es'], totalSizeMb: 110, cdnPath: 'opus-mt-fr-es', files: TRANSLATION_FILES, hfModelId: 'Xenova/opus-mt-fr-es', sourceLang: 'fr', targetLang: 'es' },
  { id: 'opus-mt-es-fr', type: 'translation', name: 'Opus-MT (es → fr)', languages: ['es', 'fr'], totalSizeMb: 110, cdnPath: 'opus-mt-es-fr', files: TRANSLATION_FILES, hfModelId: 'Xenova/opus-mt-es-fr', sourceLang: 'es', targetLang: 'fr' },
  { id: 'opus-mt-de-es', type: 'translation', name: 'Opus-MT (de → es)', languages: ['de', 'es'], totalSizeMb: 110, cdnPath: 'opus-mt-de-es', files: TRANSLATION_FILES, hfModelId: 'Xenova/opus-mt-de-es', sourceLang: 'de', targetLang: 'es' },
  { id: 'opus-mt-es-de', type: 'translation', name: 'Opus-MT (es → de)', languages: ['es', 'de'], totalSizeMb: 110, cdnPath: 'opus-mt-es-de', files: TRANSLATION_FILES, hfModelId: 'Xenova/opus-mt-es-de', sourceLang: 'es', targetLang: 'de' },
  { id: 'opus-mt-it-fr', type: 'translation', name: 'Opus-MT (it → fr)', languages: ['it', 'fr'], totalSizeMb: 110, cdnPath: 'opus-mt-it-fr', files: TRANSLATION_FILES, hfModelId: 'Xenova/opus-mt-it-fr', sourceLang: 'it', targetLang: 'fr' },
  { id: 'opus-mt-it-es', type: 'translation', name: 'Opus-MT (it → es)', languages: ['it', 'es'], totalSizeMb: 110, cdnPath: 'opus-mt-it-es', files: TRANSLATION_FILES, hfModelId: 'Xenova/opus-mt-it-es', sourceLang: 'it', targetLang: 'es' },
  { id: 'opus-mt-es-it', type: 'translation', name: 'Opus-MT (es → it)', languages: ['es', 'it'], totalSizeMb: 110, cdnPath: 'opus-mt-es-it', files: TRANSLATION_FILES, hfModelId: 'Xenova/opus-mt-es-it', sourceLang: 'es', targetLang: 'it' },
  { id: 'opus-mt-no-de', type: 'translation', name: 'Opus-MT (no → de)', languages: ['no', 'de'], totalSizeMb: 110, cdnPath: 'opus-mt-no-de', files: TRANSLATION_FILES, hfModelId: 'Xenova/opus-mt-no-de', sourceLang: 'no', targetLang: 'de' },
  { id: 'opus-mt-ru-uk', type: 'translation', name: 'Opus-MT (ru → uk)', languages: ['ru', 'uk'], totalSizeMb: 110, cdnPath: 'opus-mt-ru-uk', files: TRANSLATION_FILES, hfModelId: 'Xenova/opus-mt-ru-uk', sourceLang: 'ru', targetLang: 'uk' },
  { id: 'opus-mt-uk-ru', type: 'translation', name: 'Opus-MT (uk → ru)', languages: ['uk', 'ru'], totalSizeMb: 110, cdnPath: 'opus-mt-uk-ru', files: TRANSLATION_FILES, hfModelId: 'Xenova/opus-mt-uk-ru', sourceLang: 'uk', targetLang: 'ru' },
  { id: 'opus-mt-es-ru', type: 'translation', name: 'Opus-MT (es → ru)', languages: ['es', 'ru'], totalSizeMb: 110, cdnPath: 'opus-mt-es-ru', files: TRANSLATION_FILES, hfModelId: 'Xenova/opus-mt-es-ru', sourceLang: 'es', targetLang: 'ru' },
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
