/**
 * Pocket TTS WEB benchmark worker (#263) — thin wrapper over the shared runBench().
 * Investigation-only. Not shipped.
 */
import { runBench, type BenchConfig } from './pocketBenchRun';

const scope = self as unknown as DedicatedWorkerGlobalScope;
scope.onmessage = (e: MessageEvent<BenchConfig>) => {
  runBench(e.data, (m) => scope.postMessage({ type: 'log', m }))
    .then((r) => scope.postMessage(r))
    .catch((err) => scope.postMessage({ type: 'error', error: err instanceof Error ? (err.stack || err.message) : String(err) }));
};
