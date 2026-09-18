// Compare models/mojicast.mjs and models/mojicast-fp32.mjs (onnxruntime-web WASM, 1 thread)
// with Mojicast's own punct.py under Python onnxruntime (parity/mojicast.py), and measure
// int8 vs fp32 agreement on both runtimes. Latency: parity/mojicast-latency.mjs.
// usage: node parity/mojicast.mjs   (after parity/mojicast.py)
// writes results/parity-mojicast.json
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadModel } from '../lib/node-env.mjs';
import { analyze } from '../lib/text.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ref = JSON.parse(await readFile(join(root, 'results', 'parity-mojicast-python.json'), 'utf8'));
const THRESH = 0.1;
const rate = (n, d) => (d ? n / d : null);

/** Mark decided after each character: '' | '、' | '。' (before _NUM_PUNC_FIX). */
const decisions = (probs) => probs.map(([c, p]) => (p > THRESH ? '。' : c > THRESH ? '、' : ''));

function markAgreement(a, b) {
  let both = 0;
  let onlyA = 0;
  let onlyB = 0;
  let differ = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] && b[i]) (a[i] === b[i] ? both++ : differ++);
    else if (a[i]) onlyA++;
    else if (b[i]) onlyB++;
  }
  return { both, differentMark: differ, onlyFirst: onlyA, onlySecond: onlyB };
}

const report = { precisions: {}, pythonVersions: ref.versions };
const js = {};
for (const [id, prec] of [['mojicast', 'int8'], ['mojicast-fp32', 'fp32']]) {
  const { model, loadMs } = await loadModel(id, { threads: 1 });
  const py = ref.precisions[prec];
  const rows = [];
  let exact = 0;
  let rawExact = 0;
  let skeleton = 0;
  let maxAbs = 0;
  const flips = [];
  const diffs = [];
  for (const r of py.rows) {
    const j = await model.inspect(r.input);
    rows.push(j);
    exact += j.out === r.out;
    rawExact += j.raw === r.raw;
    skeleton += analyze(j.out).skel === analyze(r.input).skel;
    for (let i = 0; i < r.probs.length; i++) {
      for (let k = 0; k < 2; k++) {
        const d = Math.abs(j.probs[i][k] - r.probs[i][k]);
        maxAbs = Math.max(maxAbs, d);
        if ((j.probs[i][k] > THRESH) !== (r.probs[i][k] > THRESH)) flips.push({ id: r.id, variant: r.variant, pos: i, cls: k ? '。' : '、', js: j.probs[i][k], py: r.probs[i][k] });
      }
    }
    if (j.out !== r.out && diffs.length < 10) diffs.push({ id: r.id, variant: r.variant, py: r.out, js: j.out });
  }
  js[prec] = rows;

  report.precisions[prec] = {
    loadMs: Math.round(loadMs),
    probe: { js: model.probe, py: py.probe },
    rows: py.rows.length,
    textExact_vsPython: rate(exact, py.rows.length),
    rawExact_vsPython: rate(rawExact, py.rows.length),
    skeletonKept: rate(skeleton, py.rows.length),
    probMaxAbsDiff_vsPython: maxAbs,
    thresholdFlips_vsPython: flips,
    diffs,
  };
  await model.release();
}

// int8 vs fp32, on each runtime, at the text and at the decision level.
const agree = (a, b) => a.filter((x, i) => x.out === b[i].out).length / a.length;
const decisionAgree = (a, b) => a.reduce((acc, x, i) => {
  const m = markAgreement(decisions(x.probs), decisions(b[i].probs));
  for (const k of Object.keys(m)) acc[k] = (acc[k] ?? 0) + m[k];
  return acc;
}, {});
report.int8VsFp32 = {
  js: { textExact: agree(js.int8, js.fp32), marks_int8_vs_fp32: decisionAgree(js.int8, js.fp32) },
  python: { textExact: ref.int8_vs_fp32_exact, marks_int8_vs_fp32: decisionAgree(ref.precisions.int8.rows, ref.precisions.fp32.rows) },
  diffs: js.int8.map((x, i) => (x.out !== js.fp32[i].out ? { int8: x.out, fp32: js.fp32[i].out } : null)).filter(Boolean).slice(0, 10),
};

await writeFile(join(root, 'results', 'parity-mojicast.json'), JSON.stringify(report, null, 1));
for (const [prec, p] of Object.entries(report.precisions)) {
  console.log(prec, JSON.stringify({ ...p, thresholdFlips_vsPython: p.thresholdFlips_vsPython.length, diffs: p.diffs.length }, null, 1));
  for (const f of p.thresholdFlips_vsPython.slice(0, 10)) console.log('  FLIP', JSON.stringify(f));
  for (const d of p.diffs) console.log('  DIFF', JSON.stringify(d));
}
console.log('int8 vs fp32', JSON.stringify(report.int8VsFp32, null, 1));
console.log('wrote results/parity-mojicast.json');
