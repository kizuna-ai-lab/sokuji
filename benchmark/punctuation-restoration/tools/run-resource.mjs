// Run the renderer benchmark for a matrix of models x execution providers x
// thread counts, one fresh Electron process per cell, and summarise.
// usage (tools/serve.mjs running on :8787):
//   node tools/run-resource.mjs --models pcs47,fireredpunc --eps wasm,webgpu --threads 1,4 [--reps 15]
// Results merge into results/resource.json keyed by model/ep/threads.
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ELECTRON = process.env.ELECTRON_BIN ?? '/home/jiangzhuo/Desktop/kizunaai/sokuji/node_modules/electron/dist/electron';
const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const models = arg('models', '').split(',').filter(Boolean);
const eps = arg('eps', 'wasm').split(',');
const threadList = arg('threads', '1').split(',').map(Number);
const reps = arg('reps', '15');
const port = arg('port', '8787');
const bundle = arg('bundle', '');
const outPath = join(root, 'results', 'resource.json');

function runCell(model, ep, threads) {
  const url = `http://127.0.0.1:${port}/www/index.html?model=${model}&ep=${ep}&threads=${threads}&reps=${reps}${bundle ? `&bundle=${bundle}` : ''}`;
  return new Promise((resolve) => {
    const child = spawn(ELECTRON, [join(root, 'tools', 'electron-bench.cjs'), url], {
      env: { ...process.env, BENCH_TIMEOUT_MS: process.env.BENCH_TIMEOUT_MS ?? '900000' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', () => {
      const line = stdout.split('\n').find((l) => l.startsWith('ELECTRON '));
      const pageErrors = stderr.split('\n').filter((l) => l.startsWith('[page]') && !l.includes('Security Warning'));
      resolve(line ? { ...JSON.parse(line.slice(9)), pageErrors } : { url, failed: true, stderr: stderr.slice(-2000) });
    });
  });
}

let results = {};
try { results = JSON.parse(await readFile(outPath, 'utf8')); } catch {}

const mb = (kb) => (kb == null ? '   -' : String(Math.round(kb / 1024)).padStart(5));
for (const model of models) {
  for (const ep of eps) {
    for (const threads of ep === 'webgpu' ? [1] : threadList) {
      const key = `${model}/${ep}/t${threads}${bundle ? `/${bundle}` : ''}`;
      process.stdout.write(`${key} ... `);
      const r = await runCell(model, ep, threads);
      results[key] = r;
      await mkdir(dirname(outPath), { recursive: true });
      await writeFile(outPath, JSON.stringify(results, null, 1));
      const p = r.page;
      if (!p || p.error || r.timedOut) {
        console.log(`FAILED ${p?.error?.split('\n')[0] ?? r.stderr?.slice(-300) ?? 'timeout'}`);
        continue;
      }
      const m = r.marks;
      console.log(`load ${Math.round(p.loadMs)} ms | renderer MB ready ${mb(m.ready?.rendererKB)} loaded ${mb(m.loaded?.rendererKB)} peak ${mb(r.peak.rendererKB)} | gpu MB ready ${mb(m.ready?.gpuKB)} peak ${mb(r.peak.gpuKB)}`);
      for (const l of p.latency) {
        console.log(`    ${l.lang} ${String(l.chars).padStart(4)} chars  median ${l.median.toFixed(1).padStart(7)} ms  p90 ${l.p90.toFixed(1).padStart(7)} ms`);
      }
    }
  }
}
