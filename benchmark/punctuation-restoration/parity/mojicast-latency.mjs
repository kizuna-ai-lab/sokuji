// Single-thread onnxruntime-web (WASM) latency of punctuate() for the Mojicast modules at
// sequence lengths 64 / 128 / 254 ([CLS] and [SEP] included; one token per character).
// usage: node parity/mojicast-latency.mjs [model ids]   (default: mojicast mojicast-fp32)
// writes results/parity-mojicast-latency.json
import { readFile, writeFile } from 'node:fs/promises';
import { cpus, loadavg } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadModel } from '../lib/node-env.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ids = process.argv.length > 2 ? process.argv.slice(2) : ['mojicast', 'mojicast-fp32'];
const inputs = JSON.parse(await readFile(join(root, 'results', 'inputs.json'), 'utf8'));
const passage = [...new Set(inputs.filter((r) => r.lang === 'ja' && r.variant === 'stripped').map((r) => r.input))].join('');
const RUNS = 20;

async function time(model, text) {
  for (let i = 0; i < 3; i++) await model.punctuate(text, 'ja');
  const ms = [];
  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now();
    await model.punctuate(text, 'ja');
    ms.push(performance.now() - t0);
  }
  ms.sort((a, b) => a - b);
  const r1 = (x) => Math.round(x * 10) / 10;
  return { medianMs: r1(ms[RUNS >> 1]), p10Ms: r1(ms[Math.floor(RUNS * 0.1)]), p90Ms: r1(ms[Math.floor(RUNS * 0.9)]) };
}

const report = { runtime: 'onnxruntime-web 1.26 WASM, numThreads=1, Node', cpus: cpus().length, cpuModel: cpus()[0]?.model, models: {} };
for (const id of ids) {
  const { model, loadMs } = await loadModel(id, { threads: 1 });
  const rows = [];
  for (const seq of [64, 128, 254]) {
    const text = Array.from(passage).slice(0, seq - 2).join('');
    rows.push({ seqLen: seq, loadavg1: loadavg()[0], ...(await time(model, text)) });
  }
  report.models[id] = { loadMs: Math.round(loadMs), rows };
  console.log(id, 'load', Math.round(loadMs), 'ms');
  for (const r of rows) console.log(`  seq ${String(r.seqLen).padStart(3)}  median ${r.medianMs} ms  p10 ${r.p10Ms}  p90 ${r.p90Ms}  load1 ${r.loadavg1.toFixed(1)}`);
  await model.release();
}
await writeFile(join(root, 'results', 'parity-mojicast-latency.json'), JSON.stringify(report, null, 1));
console.log('wrote results/parity-mojicast-latency.json');
