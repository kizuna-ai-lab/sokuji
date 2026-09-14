// WASM parity and memory of the weight-only 8-bit sat-3l-sm builds (parity/sat-3l-sm-q8w.py) against the
// published fp16 file under the same module (models/sat-3l-sm.mjs), which on WASM runs upcast to float32 and
// matches wtpsplit's own pipeline on 265 of 270 rows (models/sat-3l-sm.md "Parity").
// Rows: results/parity-sat-3l-sm.rows.json — every row of results/inputs.json, 12 long rows (1-61 windows)
// and 14 tokenizer edge rows.
// usage:
//   node --expose-gc parity/sat-3l-sm-q8w.mjs run <fp16|q8w|q8w-gather>   one variant per process (a WASM heap
//                                                                       never shrinks); probabilities go to scratch
//   node parity/sat-3l-sm-q8w.mjs report                                 writes results/parity-sat-3l-sm-q8w.json
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ort, Tokenizer } from '../lib/node-env.mjs';
import * as sat from '../models/sat-3l-sm.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRATCH = '/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/webgpu-builds/sat';
const SAT_DIR = '/home/jiangzhuo/.cache/sokuji-punct-bench/sat';
const MODEL_FILES = {
  fp16: '/home/jiangzhuo/.cache/huggingface/hub/models--segment-any-text--sat-3l-sm/snapshots/137da054051ad9f1eac42025f758db4ac9f22535/model_optimized.onnx',
  q8w: `${SAT_DIR}/sat-3l-sm-q8w/model.onnx`,
  'q8w-gather': `${SAT_DIR}/sat-3l-sm-q8w-gather/model.onnx`,
};
const TOKENIZER = `${SAT_DIR}/sat-3l-sm/tokenizer.json`;
const THRESHOLD = sat.DEFAULTS.threshold;
const mb = (x) => Math.round(x / 1048576);
const mem = () => {
  globalThis.gc?.();
  const m = process.memoryUsage();
  return { rssMB: mb(m.rss), arrayBuffersMB: mb(m.arrayBuffers), externalMB: mb(m.external) };
};

/** Every input character survives in order; the output only adds '\n' and may drop a space right before one. */
function preservesInput(input, out) {
  const a = Array.from(input);
  const b = Array.from(out);
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && a[i] === ' ' && b[j] === '\n' && a[i] !== b[j]) i++;
    else if (i < a.length && j < b.length && a[i] === b[j]) { i++; j++; }
    else if (j < b.length && b[j] === '\n') j++;
    else return false;
  }
  return true;
}

async function run(variant) {
  if (!MODEL_FILES[variant]) throw new Error(`unknown variant ${variant}`);
  ort.env.wasm.numThreads = 1;
  const files = { 'model.onnx': MODEL_FILES[variant], 'tokenizer.json': TOKENIZER };
  const before = mem();
  const t0 = performance.now();
  const model = await sat.create({ ort, Tokenizer, readFile: async (name) => new Uint8Array(await readFile(files[name])), executionProviders: ['wasm'] });
  const loadMs = Math.round(performance.now() - t0);
  const afterLoad = mem();
  console.log(`${variant}: load ${loadMs} ms, rss ${before.rssMB} -> ${afterLoad.rssMB} MB`);

  const rows = JSON.parse(await readFile(join(root, 'results', 'parity-sat-3l-sm.rows.json'), 'utf8'));
  const out = [];
  let invariantFailures = 0;
  const t1 = performance.now();
  for (const row of rows) {
    const { chars, probs, ids } = await model.predict(row.input);
    const sentences = sat.sentencesFrom(chars, probs, THRESHOLD);
    const joined = sat.joinSegments(sentences);
    if (!preservesInput(row.input, joined)) invariantFailures++;
    out.push({ id: row.id, variant: row.variant, lang: row.lang, nTokens: ids.length, probs: Array.from(probs), sentences });
  }
  const rowsMs = Math.round(performance.now() - t1);
  const afterRows = mem();

  // model.predict on the first T subwords of long3-en, median of 7 after 2 warm-ups (tokenization included).
  const tokenizer = new Tokenizer(JSON.parse(await readFile(TOKENIZER, 'utf8')), {});
  const long = rows.find((r) => r.id === 'long3-en').input;
  const { ends } = sat.tokenizeWithEnds(tokenizer, long);
  const bench = {};
  for (const T of [128, 256, 510]) {
    const text = Array.from(long).slice(0, ends[T - 1] + 1).join('');
    for (let i = 0; i < 2; i++) await model.predict(text);
    const ts = [];
    for (let i = 0; i < 7; i++) {
      const a = performance.now();
      await model.predict(text);
      ts.push(performance.now() - a);
    }
    ts.sort((x, y) => x - y);
    bench[`en/${T}`] = Math.round(ts[3] * 10) / 10;
  }
  await model.release();
  const bytes = (await stat(MODEL_FILES[variant])).size;
  console.log(`${variant}: ${rows.length} rows in ${rowsMs} ms, rss after rows ${afterRows.rssMB} MB, invariant failures ${invariantFailures}, bench`, bench);
  await mkdir(SCRATCH, { recursive: true });
  await writeFile(join(SCRATCH, `sat-${variant}.json`), JSON.stringify({
    variant, modelFile: MODEL_FILES[variant], bytes, ort: ort.env.versions, loadMs, rowsMs,
    memory: { before, afterLoad, afterRows }, invariantFailures, bench, rows: out,
  }));
  console.log(`wrote ${join(SCRATCH, `sat-${variant}.json`)}`);
}

function compare(a, b) {
  const byKey = new Map(b.rows.map((r) => [`${r.id}|${r.variant}`, r]));
  let rows = 0;
  let splitSame = 0;
  let flipsTotal = 0;
  let bitExact = 0;
  let maxAbs = 0;
  let sumRowMax = 0;
  const byLang = {};
  const diffs = [];
  let worst = null;
  for (const x of a.rows) {
    const y = byKey.get(`${x.id}|${x.variant}`);
    if (!y) continue;
    rows++;
    const same = JSON.stringify(x.sentences) === JSON.stringify(y.sentences);
    splitSame += same;
    const l = (byLang[x.lang] ??= { rows: 0, splitSame: 0 });
    l.rows++;
    l.splitSame += same;
    let rowMax = 0;
    let at = -1;
    const flips = [];
    for (let c = 0; c < y.probs.length; c++) {
      const d = Math.abs(x.probs[c] - y.probs[c]);
      if (d > rowMax) { rowMax = d; at = c; }
      if ((x.probs[c] > THRESHOLD) !== (y.probs[c] > THRESHOLD)) flips.push({ char: c, first: +x.probs[c].toPrecision(5), second: +y.probs[c].toPrecision(5) });
    }
    flipsTotal += flips.length;
    bitExact += rowMax === 0;
    sumRowMax += rowMax;
    if (rowMax > maxAbs) {
      maxAbs = rowMax;
      worst = { id: x.id, variant: x.variant, char: at, first: x.probs[at], second: y.probs[at] };
    }
    if (!same && diffs.length < 15) diffs.push({ id: x.id, variant: x.variant, nTokens: x.nTokens, flips: flips.slice(0, 8) });
  }
  return {
    rows,
    splitExact: splitSame,
    splitExactPct: +((100 * splitSame) / rows).toFixed(1),
    byLang,
    decisionFlips: flipsTotal,
    maxAbsProb: maxAbs,
    worst,
    meanRowMaxAbsProb: sumRowMax / rows,
    rowsBitExact: bitExact,
    diffs,
  };
}

async function report() {
  const load = async (v) => {
    try {
      return JSON.parse(await readFile(join(SCRATCH, `sat-${v}.json`), 'utf8'));
    } catch {
      return null;
    }
  };
  const runs = {};
  for (const v of Object.keys(MODEL_FILES)) runs[v] = await load(v);
  if (!runs.fp16) throw new Error('run fp16 first');
  const out = {
    threshold: THRESHOLD,
    baseline: 'fp16 = published model_optimized.onnx under models/sat-3l-sm.mjs (WASM upcasts it to float32)',
    builds: Object.fromEntries(Object.entries(runs).filter(([, r]) => r).map(([v, r]) => [v, {
      modelFile: r.modelFile, bytes: r.bytes, loadMs: r.loadMs, rowsMs: r.rowsMs, memory: r.memory,
      invariantFailures: r.invariantFailures, benchPredictMedianMs: r.bench,
    }])),
    comparisons: {},
  };
  for (const v of ['q8w', 'q8w-gather']) if (runs[v]) out.comparisons[`${v} vs fp16`] = compare(runs[v], runs.fp16);
  if (runs.q8w && runs['q8w-gather']) out.comparisons['q8w-gather vs q8w'] = compare(runs['q8w-gather'], runs.q8w);
  for (const [k, c] of Object.entries(out.comparisons)) {
    console.log(`${k}: split ${c.splitExact}/${c.rows} (${c.splitExactPct}%), flips ${c.decisionFlips}, max|dp| ${c.maxAbsProb.toExponential(3)}, mean row max ${c.meanRowMaxAbsProb.toExponential(3)}, bit-exact rows ${c.rowsBitExact}`);
    for (const d of c.diffs.slice(0, 6)) console.log('  DIFF', JSON.stringify(d));
  }
  for (const [v, b] of Object.entries(out.builds)) console.log(v, JSON.stringify(b));
  await writeFile(join(root, 'results', 'parity-sat-3l-sm-q8w.json'), JSON.stringify(out, null, 1));
  console.log('wrote results/parity-sat-3l-sm-q8w.json');
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === 'run') await run(arg);
else if (cmd === 'report') await report();
else throw new Error('usage: node --expose-gc parity/sat-3l-sm-q8w.mjs run <fp16|q8w|q8w-gather> | report');
