/** Messages between TurnRuntime, the Smart Turn worker and the VAD workers' gates. */

export const TURN_SAMPLE_RATE = 16000;
/** Smart Turn reads a fixed 8 s window. */
export const TURN_WINDOW_SAMPLES = 8 * TURN_SAMPLE_RATE;
export const SMART_TURN_FILE = 'smart-turn-v3.2-gpu.onnx';

export interface TurnInitMessage {
  type: 'init';
  /** filename -> blob URL, from ModelManager.getModelBlobUrls(). */
  fileUrls: Record<string, string>;
  ortWasmBaseUrl: string;
  numThreads: number;
}

export interface TurnConnectMessage { type: 'connect'; id: number; port: MessagePort }
export interface TurnDisconnectMessage { type: 'disconnect'; id: number }
export interface TurnDisposeMessage { type: 'dispose' }

export type TurnWorkerInbound = TurnInitMessage | TurnConnectMessage | TurnDisconnectMessage | TurnDisposeMessage;

export type TurnWorkerOutbound =
  | { type: 'ready'; loadTimeMs: number; device: 'webgpu' | 'wasm' }
  | { type: 'error'; error: string }
  | { type: 'disposed' };

/** VAD worker -> turn worker, on a connected port. */
export interface TurnPredictRequest { type: 'predict'; id: number; window: Float32Array }

/** Turn worker -> VAD worker. */
export type TurnPredictAnswer = { id: number; probability: number } | { id: number; error: string };
