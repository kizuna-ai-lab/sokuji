/** Isolated factory so ZoomAIClient can be unit-tested with the worker stubbed. */
export function createVadWorker(): Worker | null {
  return new Worker(
    new URL('../../../lib/local-inference/workers/zoom-vad.worker.ts', import.meta.url),
    { type: 'module' },
  );
}
