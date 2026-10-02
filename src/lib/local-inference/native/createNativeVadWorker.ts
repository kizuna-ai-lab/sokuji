/** Isolated factory so the native clients' owners can be unit-tested with the worker stubbed (#578: the old client and the new adapter both use it). */
export function createNativeVadWorker(): Worker | null {
  return new Worker(
    new URL('../workers/native-vad.worker.ts', import.meta.url),
    { type: 'module' },
  );
}
