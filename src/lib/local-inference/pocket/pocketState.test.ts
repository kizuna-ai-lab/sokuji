import { describe, it, expect } from 'vitest';
import { initState, applyStateUpdates, type StateManifestEntry } from './pocketState';

const manifest: StateManifestEntry[] = [
  { inputName: 'cache_in', outputName: 'cache_out', dims: [1, 2], dtype: 'float32' },
];

describe('pocketState', () => {
  it('initializes zero tensors for each state input', () => {
    const state = initState(manifest, makeTensor);
    expect(Object.keys(state)).toEqual(['cache_in']);
    expect(state.cache_in.data).toEqual(new Float32Array([0, 0]));
  });

  it('threads each output back to its paired next-step input', () => {
    const state = initState(manifest, makeTensor);
    const runOutputs = { cache_out: makeTensor('float32', new Float32Array([5, 6]), [1, 2]) };
    const next = applyStateUpdates(state, manifest, runOutputs);
    expect(next.cache_in.data).toEqual(new Float32Array([5, 6]));
  });
});

// Minimal tensor factory matching the ORT Tensor shape used by the helper.
function makeTensor(dtype: string, data: Float32Array, dims: number[]) {
  return { type: dtype, data, dims };
}
