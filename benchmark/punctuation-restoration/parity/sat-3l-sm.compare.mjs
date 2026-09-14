// Compare models/sat-3l-sm.mjs on onnxruntime-web (WASM EP, one thread) against wtpsplit's own
// pipeline (parity/sat-3l-sm.reference.py) for one ONNX variant per process, and optionally time it.
// usage: node parity/sat-3l-sm.compare.mjs --variant fp16|fp32|int8|mc-int8 [--bench]
// reads results/parity-sat-3l-sm.rows.json and every results/parity-sat-3l-sm.ref-<v>.json present,
// writes results/parity-sat-3l-sm-<variant>.json
import { readFile, writeFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ort, Tokenizer } from '../lib/node-env.mjs';
import * as sat from '../models/sat-3l-sm.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const variant = arg('variant', 'fp16');
const bench = process.argv.includes('--bench');

const SAT_DIR = '/home/jiangzhuo/.cache/sokuji-punct-bench/sat';
const MODEL_FILES = {
  fp16: '/home/jiangzhuo/.cache/huggingface/hub/models--segment-any-text--sat-3l-sm/snapshots/137da054051ad9f1eac42025f758db4ac9f22535/model_optimized.onnx',
  fp32: `${SAT_DIR}/sat-3l-sm/model_fp32.onnx`,
  int8: `${SAT_DIR}/sat-3l-sm/model_int8.onnx`,
  'mc-int8': `${SAT_DIR}/modelcloud-int8/model.onnx`,
};
const TOKENIZER = '/home/jiangzhuo/.cache/huggingface/hub/models--FacebookAI--xlm-roberta-base/snapshots/e73636d4f797dec63c3081bb6ed5c7b0bb3f2089/tokenizer.json';
const FILES = { 'model.onnx': MODEL_FILES[variant], 'tokenizer.json': TOKENIZER };
const THRESHOLD = sat.DEFAULTS.threshold;

ort.env.wasm.numThreads = 1;
const mb = (x) => Math.round(x / 1048576);
const mem = () => {
  const m = process.memoryUsage();
  return { rssMB: mb(m.rss), arrayBuffersMB: mb(m.arrayBuffers), externalMB: mb(m.external) };
};

const memBefore = mem();
const t0 = performance.now();
const model = await sat.create({
  ort,
  Tokenizer,
  readFile: async (name) => new Uint8Array(await readFile(FILES[name])),
  executionProviders: ['wasm'],
});
const loadMs = performance.now() - t0;
const memLoaded = mem();
console.log(`${variant}: load ${loadMs.toFixed(0)} ms, rss ${memBefore.rssMB} -> ${memLoaded.rssMB} MB`);

const rows = JSON.parse(await readFile(join(root, 'results', 'parity-sat-3l-sm.rows.json'), 'utf8'));
const refs = {};
for (const v of Object.keys(MODEL_FILES)) {
  const p = join(root, 'results', `parity-sat-3l-sm.ref-${v}.json`);
  try {
    await access(p);
    refs[v] = new Map(JSON.parse(await readFile(p, 'utf8')).rows.map((r) => [r.id + '|' + r.variant, r]));
  } catch { /* reference not produced for this variant */ }
}

/** Code-point offsets (in the '\n'-joined segments) at which a segment list cuts its text. */
function cuts(sentences) {
  const out = [];
  let n = 0;
  for (let i = 0; i < sentences.length - 1; i++) {
    n += Array.from(sentences[i]).length + (i > 0 ? 1 : 0);
    out.push(n);
  }
  return out;
}

/**
 * The module contract: every input character survives in order, the output only adds '\n', and
 * the only character it may drop is a space right before a cut.
 */
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

const stats = Object.fromEntries(Object.keys(refs).map((v) => [v, {
  rows: 0, idsMismatch: 0, splitMismatch: 0, decisionFlips: 0, maxAbsProb: 0, sumRowMaxAbs: 0,
  rowsBitExact: 0, diffs: [],
}]));
const invariantFailures = [];
const perRow = [];
for (const row of rows) {
  const { chars, probs, ids } = await model.predict(row.input);
  const sentences = sat.sentencesFrom(chars, probs, THRESHOLD);
  const out = sat.joinSegments(sentences);
  if (!preservesInput(row.input, out)) invariantFailures.push({ id: row.id, variant: row.variant, input: row.input, out });
  const pr = { id: row.id, variant: row.variant, nTokens: ids.length, out };
  for (const [v, ref] of Object.entries(refs)) {
    const r = ref.get(row.id + '|' + row.variant);
    if (!r) continue;
    const s = stats[v];
    s.rows++;
    const idsOk = JSON.stringify(r.ids) === JSON.stringify(ids);
    if (!idsOk) s.idsMismatch++;
    const splitOk = JSON.stringify(r.sentences) === JSON.stringify(sentences);
    if (!splitOk) s.splitMismatch++;
    let rowMax = 0;
    let flips = 0;
    const flipAt = [];
    const n = Math.min(r.probs.length, probs.length);
    for (let c = 0; c < n; c++) {
      const rp = Math.fround(r.probs[c]);
      const d = Math.abs(rp - probs[c]);
      if (d > rowMax) rowMax = d;
      if ((rp > THRESHOLD) !== (probs[c] > THRESHOLD)) {
        flips++;
        flipAt.push({ char: c, ch: chars[c], js: +probs[c].toPrecision(6), ref: +rp.toPrecision(6) });
      }
    }
    s.decisionFlips += flips;
    s.sumRowMaxAbs += rowMax;
    if (rowMax === 0) s.rowsBitExact++;
    if (rowMax > s.maxAbsProb) s.maxAbsProb = rowMax;
    pr[`maxAbs_${v}`] = rowMax;
    if ((!idsOk || !splitOk) && s.diffs.length < 25) {
      s.diffs.push({
        id: row.id, variant: row.variant, input: row.input.length > 160 ? row.input.slice(0, 160) + '...' : row.input,
        idsMatch: idsOk, jsCuts: cuts(sentences), refCuts: cuts(r.sentences), flips: flipAt.slice(0, 10),
        ...(idsOk ? {} : { jsIds: ids.slice(0, 40), refIds: r.ids.slice(0, 40), refOffsets: r.offsets.slice(0, 40) }),
      });
    }
  }
  perRow.push(pr);
}
const memAfter = mem();

const summary = {};
for (const [v, s] of Object.entries(stats)) {
  summary[v] = {
    rows: s.rows,
    idsExactMatchRate: s.rows ? 1 - s.idsMismatch / s.rows : null,
    splitExactMatchRate: s.rows ? 1 - s.splitMismatch / s.rows : null,
    splitMismatches: s.splitMismatch,
    idsMismatches: s.idsMismatch,
    decisionFlips: s.decisionFlips,
    maxAbsProb: s.maxAbsProb,
    meanRowMaxAbsProb: s.rows ? s.sumRowMaxAbs / s.rows : null,
    rowsBitExact: s.rowsBitExact,
  };
  console.log(`vs python ${v.padEnd(7)} rows ${s.rows}  ids ${(100 * summary[v].idsExactMatchRate).toFixed(1)}%  split ${(100 * summary[v].splitExactMatchRate).toFixed(1)}% (${s.splitMismatch} diff)  flips ${s.decisionFlips}  max|dp| ${s.maxAbsProb.toExponential(3)}  mean row max ${summary[v].meanRowMaxAbsProb.toExponential(3)}  bit-exact rows ${s.rowsBitExact}`);
}
console.log(`punctuate invariant failures: ${invariantFailures.length}`);

// Without --bench, keep the timings of an earlier benched run of this variant.
let timing = null;
if (!bench) {
  try {
    timing = JSON.parse(await readFile(join(root, 'results', `parity-sat-3l-sm-${variant}.json`), 'utf8')).timing ?? null;
  } catch { /* no earlier run */ }
}
if (bench) {
  timing = {};
  const tokenizer = new Tokenizer(JSON.parse(await readFile(TOKENIZER, 'utf8')), {});
  for (const lang of ['ja', 'zh', 'en', 'ko']) {
    const long = rows.find((r) => r.id === `long3-${lang}`).input;
    const longChars = Array.from(long);
    const { ends } = sat.tokenizeWithEnds(tokenizer, long);
    for (const T of [64, 128, 256]) {
      const text = longChars.slice(0, ends[T - 1] + 1).join('');
      const nTok = sat.tokenizeWithEnds(tokenizer, text).ids.length;
      for (let w = 0; w < 3; w++) await model.predict(text);
      const ms = [];
      const tokMs = [];
      for (let k = 0; k < 15; k++) {
        const a = performance.now();
        sat.tokenizeWithEnds(tokenizer, text);
        const b = performance.now();
        await model.predict(text);
        ms.push(performance.now() - b);
        tokMs.push(b - a);
      }
      ms.sort((x, y) => x - y);
      tokMs.sort((x, y) => x - y);
      timing[`${lang}/${T}`] = { tokens: nTok, chars: Array.from(text).length, medianMs: +ms[7].toFixed(1), minMs: +ms[0].toFixed(1), maxMs: +ms[14].toFixed(1), tokenizeMedianMs: +tokMs[7].toFixed(2) };
      console.log(`bench ${lang}/${T}: ${nTok} subwords ${Array.from(text).length} chars  median ${ms[7].toFixed(1)} ms (min ${ms[0].toFixed(1)}, max ${ms[14].toFixed(1)}), tokenize ${tokMs[7].toFixed(2)} ms`);
    }
  }
}
const memEnd = mem();
await model.release();

await writeFile(join(root, 'results', `parity-sat-3l-sm-${variant}.json`), JSON.stringify({
  variant,
  modelFile: MODEL_FILES[variant],
  ort: ort.env.versions,
  threshold: THRESHOLD,
  loadMs: Math.round(loadMs),
  memory: { before: memBefore, afterLoad: memLoaded, afterParity: memAfter, end: memEnd },
  summary,
  diffs: Object.fromEntries(Object.entries(stats).map(([v, s]) => [v, s.diffs])),
  invariantFailures,
  timing,
  perRow,
}, null, 1));
console.log(`wrote results/parity-sat-3l-sm-${variant}.json`);
