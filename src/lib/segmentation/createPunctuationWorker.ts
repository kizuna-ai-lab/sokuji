/** Isolated factory so PunctuationRuntime can be unit-tested with the worker stubbed. */
export function createPunctuationWorker(backend: 'webgpu' | 'wasm'): Worker {
  return backend === 'webgpu'
    ? new Worker(
        new URL('../local-inference/workers/punctuation-webgpu.worker.ts', import.meta.url),
        { type: 'module' },
      )
    : new Worker(
        new URL('../local-inference/workers/punctuation-wasm.worker.ts', import.meta.url),
        { type: 'module' },
      );
}
