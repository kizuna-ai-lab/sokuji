/**
 * Shared tensor/state TYPES for Pocket TTS.
 *
 * This module now only provides the structural types used to thread streaming
 * ONNX state between .run() calls. The runtime state threading itself (zero/fill
 * init, snake_case manifest handling, and output→input updates) lives in
 * pocketInferenceCore, which mirrors the upstream source's helpers.
 */

export interface TensorLike {
  type: string;
  data: Float32Array | BigInt64Array;
  dims: number[];
}

export type StateMap = Record<string, TensorLike>;
