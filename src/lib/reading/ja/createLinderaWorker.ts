/** Isolated factory so the client can be unit-tested with the worker stubbed. */
export function createLinderaWorker(): Worker {
  return new Worker(new URL('./lindera.worker.ts', import.meta.url), { type: 'module' });
}
