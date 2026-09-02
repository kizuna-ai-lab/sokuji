/** Isolated factory so LocalNativeClient can be unit-tested with the worker stubbed. */
export function createNativeVadWorker(): Worker | null {
  return new Worker(
    new URL('../../lib/local-inference/workers/native-vad.worker.ts', import.meta.url),
    { type: 'module' },
  );
}
