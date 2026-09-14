// Single-thread onnxruntime-web (WASM) latency of punctuate() for the FireRedPunc modules at
// sequence lengths 64 / 128 / 254 ([CLS] included). zh: one token per character, so exact;
// en: whole words added while [CLS] + tokens still fits.
// usage: node parity/fireredpunc-latency.mjs [model ids]   (default: every models/fireredpunc*.mjs)
// writes results/parity-fireredpunc-latency.json
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { cpus, loadavg } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadModel } from '../lib/node-env.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ids = process.argv.length > 2
  ? process.argv.slice(2)
  : (await readdir(join(root, 'models'))).filter((f) => /^fireredpunc.*\.mjs$/.test(f)).map((f) => f.replace('.mjs', '')).sort();
const inputs = JSON.parse(await readFile(join(root, 'results', 'inputs.json'), 'utf8'));
const zhPassage = [...new Set(inputs.filter((r) => r.lang === 'zh' && r.variant === 'stripped').map((r) => r.input.replace(/\s+/g, '')))].join('');
const enWords = inputs.filter((r) => r.lang === 'en' && r.variant === 'lower').map((r) => r.input).join(' ').split(' ');
const RUNS = 20;

async function time(model, text, lang) {
  for (let i = 0; i < 3; i++) await model.punctuate(text, lang);
  const ms = [];
  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now();
    await model.punctuate(text, lang);
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
    const zh = Array.from(zhPassage).slice(0, seq - 1).join('');
    const zhSeq = (await model.inspect(zh)).ids.length + 1;
    const la = loadavg()[0];
    rows.push({ lang: 'zh', seqLen: zhSeq, loadavg1: la, ...(await time(model, zh, 'zh')) });
    let k = 1;
    while (k < enWords.length && (await model.inspect(enWords.slice(0, k + 1).join(' '))).ids.length + 1 <= seq) k++;
    const en = enWords.slice(0, k).join(' ');
    const enSeq = (await model.inspect(en)).ids.length + 1;
    rows.push({ lang: 'en', seqLen: enSeq, words: k, loadavg1: loadavg()[0], ...(await time(model, en, 'en')) });
  }
  report.models[id] = { loadMs: Math.round(loadMs), rows };
  console.log(id, 'load', Math.round(loadMs), 'ms');
  for (const r of rows) console.log(`  ${r.lang} seq ${String(r.seqLen).padStart(3)}  median ${r.medianMs} ms  p10 ${r.p10Ms}  p90 ${r.p90Ms}  load1 ${r.loadavg1.toFixed(1)}`);
  await model.release();
}
await writeFile(join(root, 'results', 'parity-fireredpunc-latency.json'), JSON.stringify(report, null, 1));
console.log('wrote results/parity-fireredpunc-latency.json');
