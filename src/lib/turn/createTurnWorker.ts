/** Isolated factory so TurnRuntime can be unit-tested with the worker stubbed. */
export function createTurnWorker(backend: 'webgpu' | 'wasm'): Worker {
  return backend === 'webgpu'
    ? new Worker(new URL('../local-inference/workers/turn-webgpu.worker.ts', import.meta.url), { type: 'module' })
    : new Worker(new URL('../local-inference/workers/turn-wasm.worker.ts', import.meta.url), { type: 'module' });
}
