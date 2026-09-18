// Same model, two execution providers, inside the Electron renderer: do the
// punctuated outputs agree? Also scores each run against the gold corpus.
// usage (tools/serve.mjs running):
//   node tools/ep-parity.mjs --model fireredpunc-q8w [--eps wasm,webgpu] [--bundle ort.wasm.min.mjs]
//   node tools/ep-parity.mjs --model pcs47-q8w-gather --eps webgpu --node results/quality-final-webgpu-builds.json
// With --node, the renderer run is compared with the Node (WASM) outputs saved by
// eval-quality.mjs instead of a second renderer run — for graphs the browser's
// WASM build cannot load.
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hypothesisFor, loadCorpus, newCounts, pct, scoreInto, summarize } from '../lib/text.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ELECTRON = process.env.ELECTRON_BIN ?? '/home/jiangzhuo/Desktop/kizunaai/sokuji/node_modules/electron/dist/electron';
const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const model = arg('model');
const eps = arg('eps', 'wasm,webgpu').split(',');
const threads = arg('threads', '4');
const bundle = arg('bundle', '');
const nodeFile = arg('node', '');

function run(ep) {
  const url = `http://127.0.0.1:8787/www/index.html?model=${model}&ep=${ep}&threads=${threads}&mode=outputs${bundle ? `&bundle=${bundle}` : ''}`;
  return new Promise((resolve) => {
    const child = spawn(ELECTRON, [join(root, 'tools', 'electron-bench.cjs'), url], {
      env: { ...process.env, BENCH_TIMEOUT_MS: process.env.BENCH_TIMEOUT_MS ?? '1800000' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', () => {});
    child.on('close', () => {
      const line = stdout.split('\n').find((l) => l.startsWith('ELECTRON '));
      resolve(line ? JSON.parse(line.slice(9)).page : null);
    });
  });
}

const items = new Map((await loadCorpus(join(root, 'corpus'))).map((i) => [i.id, i]));
const runs = {};
for (const ep of eps) {
  const page = await run(ep);
  if (!page?.outputs) {
    console.log(`${ep}: FAILED ${page?.error?.split('\n')[0] ?? 'no result'}`);
    process.exit(1);
  }
  runs[ep] = page;
}
if (nodeFile) {
  // The page picks raw, else lower for English, else stripped; take the same rows from Node.
  const saved = JSON.parse(await readFile(join(root, nodeFile), 'utf8')).models[model];
  const wanted = new Set(runs[eps[0]].outputs.map((o) => `${o.id}/${o.variant}`));
  runs.node = { info: saved.info, outputs: saved.outputs.filter((o) => wanted.has(`${o.id}/${o.variant}`)) };
  eps.push('node');
}
for (const ep of eps) {
  const page = runs[ep];
  const counts = newCounts();
  for (const o of page.outputs) scoreInto(counts, items.get(o.id).ref, hypothesisFor(page.info, o.out).hyp);
  const s = summarize(counts);
  console.log(`${ep}: ${page.outputs.length} outputs, all-language boundary F1 ${pct(s.boundary.f)}, breakpoint F1 ${pct(s.breakpoint.f)}`);
}
const [a, b] = eps;
const byId = new Map(runs[b].outputs.map((o) => [`${o.id}/${o.variant}`, o.out]));
const diffs = runs[a].outputs.filter((o) => byId.get(`${o.id}/${o.variant}`) !== o.out);
console.log(`${a} vs ${b}: ${runs[a].outputs.length - diffs.length}/${runs[a].outputs.length} identical`);
for (const d of diffs.slice(0, 8)) console.log(`  ${d.id}\n    ${a}: ${d.out.replace(/\n/g, ' ‖ ')}\n    ${b}: ${String(byId.get(`${d.id}/${d.variant}`)).replace(/\n/g, ' ‖ ')}`);
await writeFile(join(root, 'results', `ep-parity-${model}${nodeFile ? '-vs-node' : ''}.json`), JSON.stringify({ model, eps, threads, bundle, runs, diffs: diffs.map((d) => d.id) }, null, 1));
