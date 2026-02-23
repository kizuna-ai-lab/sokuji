/**
 * Shared type definitions for local inference workers and engines.
 */

// ─── ASR Worker Messages (Main → Worker) ─────────────────────────────────────

export interface AsrInitMessage {
  type: 'init';
  /** Base URL where the WASM files are served, e.g. '/wasm/sherpa-onnx-asr/' */
  wasmBaseUrl: string;
}

export interface AsrAudioMessage {
  type: 'audio';
  /** Raw audio samples from the recorder (Int16Array @ 24kHz) */
  samples: Int16Array;
  /** Sample rate of the incoming audio */
  sampleRate: number;
}

export interface AsrDisposeMessage {
  type: 'dispose';
}

export type AsrWorkerInMessage = AsrInitMessage | AsrAudioMessage | AsrDisposeMessage;

// ─── ASR Worker Messages (Worker → Main) ─────────────────────────────────────

export interface AsrReadyMessage {
  type: 'ready';
  loadTimeMs: number;
}

export interface AsrStatusMessage {
  type: 'status';
  message: string;
}

export interface AsrResultMessage {
  type: 'result';
  text: string;
  /** Start sample index of the speech segment from VAD */
  startSample: number;
  /** Duration of the speech segment in seconds */
  durationMs: number;
  /** Time taken for recognition in milliseconds */
  recognitionTimeMs: number;
}

export interface AsrErrorMessage {
  type: 'error';
  error: string;
}

export interface AsrDisposedMessage {
  type: 'disposed';
}

export type AsrWorkerOutMessage =
  | AsrReadyMessage
  | AsrStatusMessage
  | AsrResultMessage
  | AsrErrorMessage
  | AsrDisposedMessage;

// ─── ASR Model Definitions ───────────────────────────────────────────────────

export interface AsrModelConfig {
  id: string;
  label: string;
  languages: string[];
  /** Directory name under public/wasm/ */
  wasmDir: string;
  /** Approximate download size in MB */
  sizeMb: number;
}

export const ASR_MODELS: AsrModelConfig[] = [
  {
    id: 'sensevoice',
    label: 'SenseVoice (ja/zh/en/ko/cantonese)',
    languages: ['ja', 'zh', 'en', 'ko', 'cantonese'],
    wasmDir: 'sherpa-onnx-asr-sensevoice',
    sizeMb: 158,
  },
  {
    id: 'reazonspeech',
    label: 'ReazonSpeech (Japanese only)',
    languages: ['ja'],
    wasmDir: 'sherpa-onnx-asr-reazonspeech',
    sizeMb: 137,
  },
];

// ─── Translation Model Definitions ──────────────────────────────────────────

export interface TranslationModelConfig {
  id: string;
  label: string;
  sourceLang: string;
  targetLang: string;
  /** HuggingFace model ID, e.g. 'Xenova/opus-mt-ja-en' */
  modelId: string;
}

export const TRANSLATION_MODELS: TranslationModelConfig[] = [
  { id: 'opus-mt-ja-en', label: 'Opus-MT (ja → en)', sourceLang: 'ja', targetLang: 'en', modelId: 'Xenova/opus-mt-ja-en' },
  { id: 'opus-mt-en-ja', label: 'Opus-MT (en → ja)', sourceLang: 'en', targetLang: 'ja', modelId: 'Xenova/opus-mt-en-ja' },
  { id: 'opus-mt-zh-en', label: 'Opus-MT (zh → en)', sourceLang: 'zh', targetLang: 'en', modelId: 'Xenova/opus-mt-zh-en' },
  { id: 'opus-mt-en-zh', label: 'Opus-MT (en → zh)', sourceLang: 'en', targetLang: 'zh', modelId: 'Xenova/opus-mt-en-zh' },
  { id: 'opus-mt-ko-en', label: 'Opus-MT (ko → en)', sourceLang: 'ko', targetLang: 'en', modelId: 'Xenova/opus-mt-ko-en' },
  { id: 'opus-mt-en-ko', label: 'Opus-MT (en → ko)', sourceLang: 'en', targetLang: 'ko', modelId: 'Xenova/opus-mt-en-ko' },
  { id: 'opus-mt-de-en', label: 'Opus-MT (de → en)', sourceLang: 'de', targetLang: 'en', modelId: 'Xenova/opus-mt-de-en' },
  { id: 'opus-mt-en-de', label: 'Opus-MT (en → de)', sourceLang: 'en', targetLang: 'de', modelId: 'Xenova/opus-mt-en-de' },
  { id: 'opus-mt-fr-en', label: 'Opus-MT (fr → en)', sourceLang: 'fr', targetLang: 'en', modelId: 'Xenova/opus-mt-fr-en' },
  { id: 'opus-mt-en-fr', label: 'Opus-MT (en → fr)', sourceLang: 'en', targetLang: 'fr', modelId: 'Xenova/opus-mt-en-fr' },
  { id: 'opus-mt-es-en', label: 'Opus-MT (es → en)', sourceLang: 'es', targetLang: 'en', modelId: 'Xenova/opus-mt-es-en' },
  { id: 'opus-mt-en-es', label: 'Opus-MT (en → es)', sourceLang: 'en', targetLang: 'es', modelId: 'Xenova/opus-mt-en-es' },
];

// ─── TTS Worker Messages (Main → Worker) ─────────────────────────────────────

export interface TtsInitMessage {
  type: 'init';
  /** Base URL where the TTS WASM files are served, e.g. '/wasm/sherpa-onnx-tts-piper-en/' */
  wasmBaseUrl: string;
  /** Model .onnx filename (without path prefix), e.g. 'en_US-libritts_r-medium.onnx' */
  modelFile: string;
}

export interface TtsGenerateMessage {
  type: 'generate';
  /** Text to synthesize */
  text: string;
  /** Speaker ID (0 to numSpeakers-1) */
  sid: number;
  /** Speech rate multiplier (default 1.0) */
  speed: number;
}

export interface TtsDisposeMessage {
  type: 'dispose';
}

export type TtsWorkerInMessage = TtsInitMessage | TtsGenerateMessage | TtsDisposeMessage;

// ─── TTS Worker Messages (Worker → Main) ─────────────────────────────────────

export interface TtsReadyMessage {
  type: 'ready';
  loadTimeMs: number;
  numSpeakers: number;
  sampleRate: number;
}

export interface TtsStatusMessage {
  type: 'status';
  message: string;
}

export interface TtsResultMessage {
  type: 'result';
  /** Synthesized audio samples (Float32Array, range [-1.0, 1.0]) */
  samples: Float32Array;
  /** Output sample rate */
  sampleRate: number;
  /** Time taken for generation in milliseconds */
  generationTimeMs: number;
}

export interface TtsErrorMessage {
  type: 'error';
  error: string;
}

export interface TtsDisposedMessage {
  type: 'disposed';
}

export type TtsWorkerOutMessage =
  | TtsReadyMessage
  | TtsStatusMessage
  | TtsResultMessage
  | TtsErrorMessage
  | TtsDisposedMessage;

// ─── TTS Model Definitions ──────────────────────────────────────────────────

export interface TtsModelConfig {
  id: string;
  label: string;
  language: string;
  /** Directory name under public/wasm/ */
  wasmDir: string;
  /** Model .onnx filename (varies per prebuilt package) */
  modelFile: string;
  /** Approximate download size in MB */
  sizeMb: number;
}

export const TTS_MODELS: TtsModelConfig[] = [
  {
    id: 'piper-en',
    label: 'Piper LibriTTS-R (English, multi-speaker)',
    language: 'en',
    wasmDir: 'sherpa-onnx-tts-piper-en',
    modelFile: 'en_US-libritts_r-medium.onnx',
    sizeMb: 81,
  },
  {
    id: 'piper-de',
    label: 'Piper Thorsten Emotional (German)',
    language: 'de',
    wasmDir: 'sherpa-onnx-tts-piper-de',
    modelFile: 'de_DE-thorsten_emotional-medium.onnx',
    sizeMb: 79,
  },
];
