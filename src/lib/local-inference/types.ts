/**
 * Shared type definitions for local inference workers and engines.
 */

// ─── ASR Worker Messages (Main → Worker) ─────────────────────────────────────

export interface AsrInitMessage {
  type: 'init';
  /** Map of filename → blob URL for model-specific files (.data only) */
  fileUrls: Record<string, string>;
  /** ASR engine type — determines which config builder the worker uses */
  asrEngine: string;
  /** Optional VAD configuration to override defaults */
  vadConfig?: {
    threshold?: number;
    minSilenceDuration?: number;
    minSpeechDuration?: number;
  };
  /** Base URL for bundled ASR runtime (JS/WASM shared across all models) */
  runtimeBaseUrl: string;
  /** Emscripten loadPackage metadata (file offsets/sizes from package-metadata.json) */
  dataPackageMetadata: Record<string, unknown>;
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

export interface WhisperAsrInitMessage {
  type: 'init';
  /** Map of filename → blob URL for model files from IndexedDB */
  fileUrls: Record<string, string>;
  /** HuggingFace model ID for Transformers.js pipeline identification */
  hfModelId: string;
  /** Source language for Whisper (e.g. 'ja', 'en') or undefined for auto-detect */
  language?: string;
  /** VAD configuration overrides (durations in seconds). Defaults match @ricky0123/vad-web. */
  vadConfig?: {
    /** Positive speech threshold (default 0.3, matching vad-web) */
    threshold?: number;
    /** Negative threshold to confirm silence — hysteresis gap prevents oscillation (default 0.25) */
    negativeThreshold?: number;
    /** Redemption / min silence duration in seconds before ending speech (default 1.4) */
    minSilenceDuration?: number;
    /** Min speech duration in seconds to emit a segment (default 0.4) */
    minSpeechDuration?: number;
    /** Max speech segment duration in seconds before forced flush (default 20) */
    maxSpeechDuration?: number;
    /** Pre-speech pad duration in seconds — audio context prepended before speech start (default 0.8) */
    preSpeechPadDuration?: number;
  };
  /** ONNX dtype config for WebGPU models */
  dtype?: string | Record<string, string>;
  /** Resolved absolute URL for bundled ORT WASM files */
  ortWasmBaseUrl?: string;
  /** Resolved absolute URL for bundled VAD model */
  vadModelUrl?: string;
}

export type AsrWorkerInMessage = AsrInitMessage | WhisperAsrInitMessage | VoxtralAsrInitMessage | CohereTranscribeAsrInitMessage | AsrAudioMessage | AsrDisposeMessage;

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

export interface AsrSpeechStartMessage {
  type: 'speech_start';
}

export type AsrWorkerOutMessage =
  | AsrReadyMessage
  | AsrStatusMessage
  | AsrSpeechStartMessage
  | AsrResultMessage
  | AsrErrorMessage
  | AsrDisposedMessage;

// ─── Streaming ASR Worker Messages (Main → Worker) ──────────────────────────

export interface StreamingAsrInitMessage {
  type: 'init';
  /** Map of filename → blob URL for model-specific files (.data only) */
  fileUrls: Record<string, string>;
  /** ASR engine type — for future use when streaming models get explicit config */
  asrEngine?: string;
  /** Base URL for bundled streaming ASR runtime (JS/WASM shared across all models) */
  runtimeBaseUrl: string;
  /** Emscripten loadPackage metadata (file offsets/sizes from package-metadata.json) */
  dataPackageMetadata: Record<string, unknown>;
}

export interface VoxtralAsrInitMessage {
  type: 'init';
  /** Map of filename → blob URL for model files from IndexedDB */
  fileUrls: Record<string, string>;
  /** HuggingFace model ID for Transformers.js from_pretrained */
  hfModelId: string;
  /** Source language hint (optional, for future use) */
  language?: string;
  /** ONNX dtype config — 'q4f16' or 'q4', or per-component mapping */
  dtype: string | Record<string, string>;
  /** Resolved absolute URL for bundled VAD model */
  vadModelUrl: string;
  /** Resolved absolute URL for bundled ORT WASM files */
  ortWasmBaseUrl?: string;
}

export interface CohereTranscribeAsrInitMessage {
  type: 'init';
  /** Map of filename → blob URL for model files from IndexedDB */
  fileUrls: Record<string, string>;
  /** HuggingFace model ID for Transformers.js pipeline identification */
  hfModelId: string;
  /** Source language code (e.g. 'ja', 'en') — required, no auto-detect */
  language?: string;
  /** ONNX dtype config — 'q4f16' or 'q4', or per-component mapping */
  dtype: string | Record<string, string>;
  /** Resolved absolute URL for bundled VAD model */
  vadModelUrl: string;
  /** Resolved absolute URL for bundled ORT WASM files */
  ortWasmBaseUrl?: string;
}

// ─── Streaming ASR Worker Messages (Worker → Main) ──────────────────────────
// Inbound messages reuse StreamingAsrInitMessage, AsrAudioMessage, AsrDisposeMessage.

/** Streaming ASR: partial (interim) result message */
export interface StreamingAsrPartialMessage {
  type: 'partial';
  text: string;
}

/** Streaming ASR: final result (at endpoint) */
export interface StreamingAsrResultMessage {
  type: 'result';
  text: string;
  durationMs: number;
  recognitionTimeMs: number;
}

export type StreamingAsrWorkerOutMessage =
  | AsrReadyMessage
  | AsrStatusMessage
  | AsrSpeechStartMessage
  | StreamingAsrPartialMessage
  | StreamingAsrResultMessage
  | AsrErrorMessage
  | AsrDisposedMessage;

// ─── TTS Worker Messages (Main → Worker) ─────────────────────────────────────

export interface TtsInitMessage {
  type: 'init';
  /** Model .onnx filename (without path prefix), e.g. 'en_US-libritts_r-medium.onnx' */
  modelFile: string;
  /** Map of filename → blob URL for loading model files from IndexedDB */
  fileUrls: Record<string, string>;
}

export interface TtsGenerateMessage {
  type: 'generate';
  /** Text to synthesize */
  text: string;
  /** Speaker ID (0 to numSpeakers-1) */
  sid: number;
  /** Speech rate multiplier (default 1.0) */
  speed: number;
  /** Language code for multilingual models (e.g. 'ja', 'en') */
  lang?: string;
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

