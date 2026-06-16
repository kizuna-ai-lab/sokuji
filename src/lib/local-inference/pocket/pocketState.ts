/**
 * Stateful-ONNX KV-cache / streaming-state threading.
 *
 * The bundle metadata declares, per stateful session, a list of
 * (inputName, outputName, dims, dtype). After each .run(), the output tensor
 * named `outputName` becomes the next step's input named `inputName`.
 *
 * Generic over the tensor type so it is unit-testable without onnxruntime-web.
 */

export interface StateManifestEntry {
  inputName: string;
  outputName: string;
  dims: number[];
  dtype: 'float32' | 'int64';
}

export interface TensorLike {
  type: string;
  data: Float32Array | BigInt64Array;
  dims: number[];
}

export type TensorFactory = (
  dtype: string,
  data: Float32Array | BigInt64Array,
  dims: number[],
) => TensorLike;

export type StateMap = Record<string, TensorLike>;

function zeros(entry: StateManifestEntry): Float32Array | BigInt64Array {
  const len = entry.dims.reduce((a, b) => a * b, 1);
  return entry.dtype === 'int64' ? new BigInt64Array(len) : new Float32Array(len);
}

/** Build initial zero-filled state keyed by each entry's inputName. */
export function initState(manifest: StateManifestEntry[], makeTensor: TensorFactory): StateMap {
  const state: StateMap = {};
  for (const e of manifest) {
    state[e.inputName] = makeTensor(e.dtype, zeros(e), e.dims);
  }
  return state;
}

/** Return a new StateMap with each output threaded into its paired next input. */
export function applyStateUpdates(
  prev: StateMap,
  manifest: StateManifestEntry[],
  runOutputs: Record<string, TensorLike>,
): StateMap {
  const next: StateMap = { ...prev };
  for (const e of manifest) {
    const out = runOutputs[e.outputName];
    if (out) next[e.inputName] = out;
  }
  return next;
}
