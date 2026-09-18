// WASM parity of the WebGPU-oriented PCS-47 builds (parity/pcs47-webgpu-builds.py) against the fp32 graph.
// The fp32 side is results/parity-pcs47-js-fp32.json: models/pcs47-core.mjs on model.onnx, WASM, 1 thread,
// itself identical to punctuators on all 248 rows (models/pcs47.md "Parity"). Rows are the same 248: the 244
// ja/zh/en/ko rows of results/inputs.json plus the four stitched *-long rows.
// usage: node --expose-gc parity/pcs47-webgpu-builds.mjs <q8w|q8w-gather|fp16>
// writes results/parity-pcs47-<variant>.json
import { readFile, writeFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ort, Tokenizer, fileReader } from '../lib/node-env.mjs';
import { loadEngine, LOCAL_DIR } from '../models/pcs47-core.mjs';
import { analyze } from '../lib/text.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILES = { q8w: 'model.q8w.onnx', 'q8w-gather': 'model.q8w-gather.onnx', fp16: 'model.fp16.onnx' };
const variant = process.argv[2];
const modelFile = FILES[variant];
if (!modelFile) throw new Error('usage: node --expose-gc parity/pcs47-webgpu-builds.mjs <q8w|q8w-gather|fp16>');

ort.env.wasm.numThreads = 1;
const readJson = async (p) => JSON.parse(await readFile(p, 'utf8'));
const rssMB = () => {
  globalThis.gc?.();
  return Math.round(process.memoryUsage().rss / 1048576);
};
const pct = (n, d) => (d ? +((100 * n) / d).toFixed(1) : null);

const ref = (await readJson(join(root, 'results', 'parity-pcs47-ref-fp32.json'))).rows;
const base = new Map((await readJson(join(root, 'results', 'parity-pcs47-js-fp32.json'))).rows.map((r) => [`${r.id}/${r.variant}`, r]));

const rssBefore = rssMB();
const t0 = performance.now();
const engine = await loadEngine({ ort, Tokenizer, readFile: fileReader(LOCAL_DIR), executionProviders: ['wasm'] }, modelFile);
const loadMs = Math.round(performance.now() - t0);
const rssLoaded = rssMB();
console.log(`${variant}: ${modelFile} loaded in ${loadMs} ms, rss ${rssBefore} -> ${rssLoaded} MB`);

/** Scored events, as parity/pcs47.mjs counts them: (skeleton position, mark class) or '\n' split positions. */
function events(s, key) {
  if (key === 'sbd') {
    const parts = s.split('\n');
    const out = new Set();
    let n = 0;
    for (let i = 0; i < parts.length - 1; i++) {
      n += analyze(parts[i]).skelChars.length;
      out.add(`b${n}`);
    }
    return out;
  }
  return new Set([...analyze(s).marks].map(([k, c]) => `${k}:${c}`));
}

const tally = () => ({ rows: 0, punctSame: 0, sbdSame: 0, marksAgree: 0, marksUnion: 0, boundariesAgree: 0, boundariesUnion: 0, skeletonKept: 0 });
const all = tally();
const byLang = {};
const diffs = { punct: [], sbd: [] };
const rows = [];
for (const r of ref) {
  const key = `${r.id}/${r.variant}`;
  const b = base.get(key);
  if (!b) throw new Error(`no fp32 JS row for ${key}`);
  const s = performance.now();
  const out = await engine.run(r.input);
  const punct = out.text;
  const sbd = out.sentences.join('\n');
  rows.push({ id: r.id, variant: r.variant, punct, sbd, ms: Math.round((performance.now() - s) * 10) / 10 });
  const lang = r.lang ?? r.id.split('-')[0];
  for (const t of [all, (byLang[lang] ??= tally())]) {
    t.rows++;
    t.punctSame += punct === b.punct;
    t.sbdSame += sbd === b.sbd;
    for (const [k, agreeKey, unionKey, text, other] of [['punct', 'marksAgree', 'marksUnion', punct, b.punct], ['sbd', 'boundariesAgree', 'boundariesUnion', sbd, b.sbd]]) {
      const ea = events(text, k);
      const eb = events(other, k);
      for (const e of ea) if (eb.has(e)) t[agreeKey]++;
      t[unionKey] += new Set([...ea, ...eb]).size;
    }
    t.skeletonKept += analyze(punct).skel === analyze(r.input).skel;
  }
  if (punct !== b.punct && diffs.punct.length < 10) diffs.punct.push({ row: key, fp32: b.punct, [variant]: punct });
  if (sbd !== b.sbd && diffs.sbd.length < 10) diffs.sbd.push({ row: key, fp32: b.sbd, [variant]: sbd });
}
const rssRows = rssMB();

const rates = (t) => ({
  ...t,
  punctExactPct: pct(t.punctSame, t.rows),
  sbdExactPct: pct(t.sbdSame, t.rows),
  marksAgreePct: pct(t.marksAgree, t.marksUnion),
  boundariesAgreePct: pct(t.boundariesAgree, t.boundariesUnion),
});
const summary = { all: rates(all), byLang: Object.fromEntries(Object.entries(byLang).map(([k, v]) => [k, rates(v)])) };

// One window of exactly N ids (+BOS/EOS), median of 7 after 2 warm-ups: WASM only, indicative.
const bench = {};
for (const lang of ['en', 'ja']) {
  const long = ref.find((x) => x.id === `${lang}-long`);
  for (const n of [128, 254]) {
    const ids = long.sp_ids_pre.slice(0, n);
    for (let i = 0; i < 2; i++) await engine.runWindow(ids);
    const ts = [];
    for (let i = 0; i < 7; i++) {
      const a = performance.now();
      await engine.runWindow(ids);
      ts.push(performance.now() - a);
    }
    ts.sort((x, y) => x - y);
    bench[`${lang}/${n}`] = Math.round(ts[3] * 10) / 10;
  }
}
await engine.release();

const bytes = (await stat(join(LOCAL_DIR, modelFile))).size;
console.log(JSON.stringify({ all: summary.all, byLang: Object.fromEntries(Object.entries(summary.byLang).map(([k, v]) => [k, [v.punctExactPct, v.sbdExactPct]])) }, null, 1));
for (const k of ['punct', 'sbd']) {
  for (const d of diffs[k].slice(0, 5)) console.log(`DIFF ${k} ${d.row}\n  fp32: ${JSON.stringify(d.fp32)}\n  ${variant}: ${JSON.stringify(d[variant])}`);
}
console.log('bench session.run median ms (1 thread):', bench, `rss after rows ${rssRows} MB`);
const dst = join(root, 'results', `parity-pcs47-${variant}.json`);
await writeFile(dst, JSON.stringify({
  variant,
  modelFile,
  bytes,
  baseline: 'results/parity-pcs47-js-fp32.json (model.onnx, same module, WASM 1 thread)',
  ort: ort.env.versions,
  loadMs,
  rssMB: { before: rssBefore, afterLoad: rssLoaded, afterRows: rssRows },
  summary,
  diffs,
  bench,
  rows,
}, null, 1));
console.log(`wrote ${dst}`);
