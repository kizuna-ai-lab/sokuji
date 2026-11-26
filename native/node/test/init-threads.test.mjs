// init() called from two worker_threads at once: the addon's state is process-wide, so exactly one call may run
// sk_init and install its log sink; the other waits, then reports the same result.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { isMainThread, parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { loadAddon, nativeDir } from './helpers.mjs';

if (!isMainThread) {
  // A worker: wait for the shared start signal so the two init() calls overlap, then init with an onLog.
  const sk = loadAddon();
  const lines = [];
  Atomics.wait(new Int32Array(workerData.gate), 0, 0);
  const r = sk.init({ moduleDir: workerData.dir, onLog: (_level, message) => lines.push(message) });
  // The sink delivers asynchronously on this thread's event loop: give it a moment before reporting.
  setTimeout(() => parentPort.postMessage({ threads: r.threads, lines }), 300);
} else {
  test('two workers calling init at once: one sk_init, one result, no lost log sink', () => {
    // Several fresh processes: the race is in the timing, so one lucky run proves nothing.
    const script = `
      import { Worker } from 'node:worker_threads';
      const gate = new SharedArrayBuffer(4);
      const mk = () => new Promise((res, rej) => {
        const w = new Worker(${JSON.stringify(fileURLToPath(import.meta.url))}, { execArgv: [], workerData: { gate, dir: ${JSON.stringify(nativeDir())} } });
        w.once('message', res); w.once('error', rej);
      });
      const a = mk(), b = mk();
      await new Promise((r) => setTimeout(r, 400));
      Atomics.store(new Int32Array(gate), 0, 1); Atomics.notify(new Int32Array(gate), 0);
      const out = await Promise.all([a, b]);
      process.stdout.write(JSON.stringify(out));
    `;
    for (let i = 0; i < 12; i++) {
      const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 60000 });
      assert.equal(r.status, 0, `run ${i}: status ${r.status} ${r.signal}\n${r.stderr}`);
      const [x, y] = JSON.parse(r.stdout);
      assert.equal(x.threads, y.threads, `run ${i}: the two calls disagree on the thread count`);
      const initLines = [...x.lines, ...y.lines].filter((l) => l.startsWith('sk_init: '));
      assert.equal(initLines.length, 1, `run ${i}: expected one sk_init line across both sinks, got ${initLines.length}`);
    }
  });
}
