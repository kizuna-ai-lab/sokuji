/**
 * Shared type definitions for local inference workers and engines.
 */

// ─── ASR Worker Messages (Main → Worker) ─────────────────────────────────────

export interface AsrInitMessage {
  type: 'init';
  /** Map of filename → blob URL for loading model files from IndexedDB */
  fileUrls: Record<string, string>;
  /** Optional VAD configuration to override defaults */
  vadConfig?: {
    threshold?: number;
    minSilenceDuration?: number;
    minSpeechDuration?: number;
  };
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

// ─── Streaming ASR Worker Messages (Worker → Main) ──────────────────────────
// Inbound messages reuse AsrInitMessage (without vadConfig), AsrAudioMessage, AsrDisposeMessage.

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

