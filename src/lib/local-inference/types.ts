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
