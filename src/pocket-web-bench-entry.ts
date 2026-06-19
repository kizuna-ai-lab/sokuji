/**
 * Pocket TTS WEB bench driver (issue #263). Runs the shared runBench either in a
 * module Worker (default, = production architecture) or on the main thread
 * (?mainthread=1, where ORT pthreads spawn reliably), with a config from URL params.
 * Exposes logs + result on window.__bench for Playwright/automation.
 *
 * URL params: ?ep=wasm|webgpu&threads=1&simd=1&reps=3&maxFrames=500&lsd=1&mainthread=0
 */
import type { BenchConfig } from './lib/local-inference/workers/pocketBenchRun';

const q = new URLSearchParams(location.search);
const cfg: BenchConfig = {
  ep: (q.get('ep') as 'wasm' | 'webgpu') || 'wasm',
  threads: parseInt(q.get('threads') || '1', 10),
  simd: q.get('simd') !== '0',
  reps: parseInt(q.get('reps') || '3', 10),
  maxFrames: parseInt(q.get('maxFrames') || '500', 10),
  lsdSteps: parseInt(q.get('lsd') || '1', 10),
  // ?relaxed=1 → load the locally-built relaxed-SIMD ORT-web (#263) instead of the npm bundle.
  ortWasmBaseUrl: new URL(q.get('relaxed') === '1' ? '/wasm/ort-relaxed/' : '/wasm/ort/', location.href).href,
};
const mainthread = q.get('mainthread') === '1';

interface BenchState { done: boolean; error: string | null; result: unknown; logs: string[]; cfg: BenchConfig; mainthread: boolean }
const state: BenchState = { done: false, error: null, result: null, logs: [], cfg, mainthread };
(window as unknown as { __bench: BenchState }).__bench = state;

const out = document.getElementById('out') as HTMLPreElement;
const render = () => {
  out.textContent = JSON.stringify(
    { done: state.done, error: state.error, result: state.result, cfg: state.cfg, mainthread, logs: state.logs.slice(-40) },
    null, 2,
  );
};
const log = (m: string) => { state.logs.push(m); console.log('[bench]', m); render(); };

console.log('[bench] starting', JSON.stringify(cfg), 'mainthread=' + mainthread);
render();

if (mainthread) {
  // Run ORT on the page main thread (pthread workers spawn from the document reliably).
  import('./lib/local-inference/workers/pocketBenchRun').then(({ runBench }) =>
    runBench(cfg, log)
      .then((r) => { state.result = r; state.done = true; console.log('[bench] RESULT', JSON.stringify(r)); render(); })
      .catch((e) => { state.error = e instanceof Error ? (e.stack || e.message) : String(e); state.done = true; console.error('[bench] ERROR', state.error); render(); }),
  );
} else {
  const worker = new Worker(
    new URL('./lib/local-inference/workers/pocket-bench.worker.ts', import.meta.url),
    { type: 'module' },
  );
  worker.onmessage = (e: MessageEvent) => {
    const d = e.data;
    if (d.type === 'log') log(d.m);
    else if (d.type === 'result') { state.result = d; state.done = true; console.log('[bench] RESULT', JSON.stringify(d)); render(); }
    else if (d.type === 'error') { state.error = d.error; state.done = true; console.error('[bench] ERROR', d.error); render(); }
  };
  worker.onerror = (e) => { state.error = `worker.onerror: ${e.message}`; state.done = true; console.error('[bench] worker.onerror', e.message); render(); };
  worker.postMessage(cfg);
}
