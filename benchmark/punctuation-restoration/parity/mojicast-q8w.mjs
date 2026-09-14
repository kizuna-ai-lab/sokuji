// WASM parity of the weight-only 8-bit Mojicast builds (parity/mojicast-q8w.py) against mojicast-fp32,
// which is itself identical to Mojicast's punct.py on all 51 ja rows (models/mojicast.md "Parity").
// Rows: every ja row of results/inputs.json. One process, one model at a time, WASM EP, 1 thread.
// usage: node --expose-gc parity/mojicast-q8w.mjs
// writes results/parity-mojicast-q8w.json
import { readFile, writeFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadModel } from '../lib/node-env.mjs';
import { analyze } from '../lib/text.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const THRESH = 0.1;
const IDS = ['mojicast-fp32', 'mojicast-q8w', 'mojicast-q8w-nonan'];
const inputs = JSON.parse(await readFile(join(root, 'results', 'inputs.json'), 'utf8')).filter((r) => r.lang === 'ja');
const rssMB = () => {
  globalThis.gc?.();
  return Math.round(process.memoryUsage().rss / 1048576);
};

/** Mark decided after each character: '' | '、' | '。' (before _NUM_PUNC_FIX). */
const decisions = (probs) => probs.map(([c, p]) => (p > THRESH ? '。' : c > THRESH ? '、' : ''));
/** Sentences as a caption would cut them: after every 。. */
const sentences = (s) => s.split(/(?<=。)/u).filter(Boolean);

const runs = {};
for (const id of IDS) {
  const before = rssMB();
  const { model, loadMs, info } = await loadModel(id, { threads: 1 });
  const loaded = rssMB();
  const rows = [];
  for (const r of inputs) rows.push(await model.inspect(r.input));
  // Latency: one 126-character chunk ([CLS] + 126 + [SEP] = 128 tokens), median of 7 after 2 warm-ups.
  const text = Array.from(inputs.filter((r) => r.variant === 'stripped').map((r) => r.input).join('')).slice(0, 126).join('');
  for (let i = 0; i < 2; i++) await model.punctuate(text, 'ja');
  const ts = [];
  for (let i = 0; i < 7; i++) {
    const a = performance.now();
    await model.punctuate(text, 'ja');
    ts.push(performance.now() - a);
  }
  ts.sort((x, y) => x - y);
  const bytes = (await stat(join(info.localDir, info.files[0]))).size;
  runs[id] = { file: info.files[0], bytes, loadMs: Math.round(loadMs), rssMB: { before, afterLoad: loaded }, probe: model.probe, bench128Ms: Math.round(ts[3] * 10) / 10, rows };
  console.log(`${id}: ${bytes} B, load ${Math.round(loadMs)} ms, rss ${before} -> ${loaded} MB (cumulative in this process), probe ${model.probe}, 128 tokens ${runs[id].bench128Ms} ms`);
  await model.release();
}

function compare(a, b) {
  let textExact = 0;
  let rawExact = 0;
  let splitExact = 0;
  let skeletonKept = 0;
  let rowsBitExact = 0;
  let maxAbs = 0;
  const flips = [];
  const marks = { both: 0, differentMark: 0, onlyFirst: 0, onlySecond: 0 };
  const diffs = [];
  inputs.forEach((r, i) => {
    const x = a.rows[i];
    const y = b.rows[i];
    textExact += x.out === y.out;
    rawExact += x.raw === y.raw;
    splitExact += JSON.stringify(sentences(x.out)) === JSON.stringify(sentences(y.out));
    skeletonKept += analyze(x.out).skel === analyze(r.input).skel;
    let rowMax = 0;
    for (let c = 0; c < y.probs.length; c++) {
      for (let k = 0; k < 2; k++) {
        const d = Math.abs(x.probs[c][k] - y.probs[c][k]);
        if (d > rowMax) rowMax = d;
        if ((x.probs[c][k] > THRESH) !== (y.probs[c][k] > THRESH)) flips.push({ id: r.id, variant: r.variant, pos: c, cls: k ? '。' : '、', first: x.probs[c][k], second: y.probs[c][k] });
      }
    }
    rowsBitExact += rowMax === 0;
    maxAbs = Math.max(maxAbs, rowMax);
    const da = decisions(x.probs);
    const db = decisions(y.probs);
    for (let c = 0; c < da.length; c++) {
      if (da[c] && db[c]) (da[c] === db[c] ? marks.both++ : marks.differentMark++);
      else if (da[c]) marks.onlyFirst++;
      else if (db[c]) marks.onlySecond++;
    }
    if (x.out !== y.out && diffs.length < 10) diffs.push({ id: r.id, variant: r.variant, first: x.out, second: y.out });
  });
  const n = inputs.length;
  return { rows: n, textExact, rawExact, splitExact, skeletonKept, rowsBitExact, maxAbsProb: maxAbs, thresholdFlips: flips, marks, diffs };
}

const report = {
  rows: inputs.length,
  threshold: THRESH,
  builds: Object.fromEntries(Object.entries(runs).map(([k, v]) => [k, { ...v, rows: undefined }])),
  'mojicast-q8w vs mojicast-fp32': compare(runs['mojicast-q8w'], runs['mojicast-fp32']),
  'mojicast-q8w-nonan vs mojicast-fp32': compare(runs['mojicast-q8w-nonan'], runs['mojicast-fp32']),
  'mojicast-q8w-nonan vs mojicast-q8w': compare(runs['mojicast-q8w-nonan'], runs['mojicast-q8w']),
};
for (const [k, v] of Object.entries(report)) {
  if (!k.includes(' vs ')) continue;
  console.log(k, JSON.stringify({ ...v, thresholdFlips: v.thresholdFlips.length, diffs: v.diffs.length }));
  for (const f of v.thresholdFlips.slice(0, 5)) console.log('  FLIP', JSON.stringify(f));
  for (const d of v.diffs.slice(0, 5)) console.log('  DIFF', JSON.stringify(d));
}
await writeFile(join(root, 'results', 'parity-mojicast-q8w.json'), JSON.stringify(report, null, 1));
console.log('wrote results/parity-mojicast-q8w.json');
