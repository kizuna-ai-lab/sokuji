// Compare a FireRedPunc module (onnxruntime-web WASM, 1 thread) with the upstream references
// from parity/fireredpunc.py, and check edge cases and windowing. Latency: parity/fireredpunc-latency.mjs.
// usage: node parity/fireredpunc.mjs [model id, default fireredpunc]   (after parity/fireredpunc.py)
// writes results/parity-<model id>.json
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadModel } from '../lib/node-env.mjs';
import { analyze } from '../lib/text.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ref = JSON.parse(await readFile(join(root, 'results', 'parity-fireredpunc-upstream.json'), 'utf8'));
const modelId = process.argv[2] ?? 'fireredpunc';
const { model, loadMs } = await loadModel(modelId, { threads: 1 });

const eq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const fold = (s) => s.normalize('NFD').replace(/\p{Mn}/gu, '').toLowerCase();
const rate = (n, d) => (d ? n / d : null);
const DOUBLE_MARK = /[，。？！,.?!]\s?[，。？！,.?!]/u;

const c = { rows: 0, rawTokens: 0, ids: 0, predsOrtPy: 0, predsTorch: 0, fixedOrtPy: 0, textOrtPy: 0, textTorch: 0, textTorchFold: 0, skeleton: 0, tokens: 0, tokOrtPy: 0, tokTorch: 0 };
const diffs = { textVsTorch: [], textVsOrtPy: [], tokenization: [], predsVsOrtPy: [] };
const commas = { rows: 0, unstrippedEqualsStripped: 0, unstrippedDoubleMark: 0, examples: [] };

for (const r of ref.rows) {
  const js = await model.inspect(r.input);
  c.rows++;
  const rawOk = eq(js.tokens, r.raw_tokens);
  const idsOk = eq(js.ids, r.ids);
  c.rawTokens += rawOk;
  c.ids += idsOk;
  if ((!rawOk || !idsOk) && diffs.tokenization.length < 10) diffs.tokenization.push({ id: r.id, variant: r.variant, js: js.tokens, py: r.raw_tokens });
  c.predsOrtPy += eq(js.preds, r.preds_ort_int8);
  c.predsTorch += eq(js.preds, r.preds_torch);
  if (!eq(js.preds, r.preds_ort_int8) && diffs.predsVsOrtPy.length < 10) {
    const at = js.preds.map((p, i) => (p !== r.preds_ort_int8[i] ? [i, r.tokens[i], p, r.preds_ort_int8[i]] : null)).filter(Boolean);
    diffs.predsVsOrtPy.push({ id: r.id, variant: r.variant, at });
  }
  if (idsOk) {
    for (let i = 0; i < js.preds.length; i++) {
      c.tokens++;
      c.tokOrtPy += js.preds[i] === r.preds_ort_int8[i];
      c.tokTorch += js.preds[i] === r.preds_torch[i];
    }
  }
  c.fixedOrtPy += js.fixed === r.ort_int8_text;
  c.textOrtPy += js.out === r.ort_int8_text;
  c.textTorch += js.out === r.torch_text;
  c.textTorchFold += fold(js.out) === fold(r.torch_text);
  c.skeleton += analyze(js.out).skel === analyze(r.input).skel;
  if (js.out !== r.torch_text && diffs.textVsTorch.length < 10) diffs.textVsTorch.push({ id: r.id, variant: r.variant, input: r.input, torch: r.torch_text, ortPy: r.ort_int8_text, js: js.out });
  if (js.out !== r.ort_int8_text && diffs.textVsOrtPy.length < 10) diffs.textVsOrtPy.push({ id: r.id, variant: r.variant, ortPy: r.ort_int8_text, js: js.out });
  if (r.torch_text_unstripped !== undefined) {
    commas.rows++;
    commas.unstrippedEqualsStripped += r.torch_text_unstripped === r.torch_text;
    commas.unstrippedDoubleMark += DOUBLE_MARK.test(r.torch_text_unstripped);
    if (r.torch_text_unstripped !== r.torch_text && commas.examples.length < 5) commas.examples.push({ input: r.input, unstripped: r.torch_text_unstripped, stripped: r.torch_text });
  }
}

// Character preservation on inputs the corpus does not cover.
const edgeInputs = [
  ['café résumé naïve déjà vu', 'en'], ['école été', 'en'], ['我用iPhone拍照然后发给你', 'zh'],
  ['hello😀world how are you', 'en'], ['第①步操作价格≤1000元', 'zh'], ['ＡＢＣ公司的Ｘｙｚ产品', 'zh'],
  ['it costs 3.5 dollars or 1,000 yen', 'en'], ['the u.s. army and dr. smith arrived', 'en'],
  ['寄蜉蝣于天地渺沧海之一粟魑魅魍魉', 'zh'], ['안녕하세요 반갑습니다', 'zh'], ['こんにちは世界', 'zh'],
  ['', 'zh'], ['   ', 'en'], ['，。？！', 'zh'], ['i', 'en'], ["i'm here i'll go i've been i'd say", 'en'],
];
const edgeCases = [];
for (const [text, lang] of edgeInputs) {
  const out = await model.punctuate(text, lang);
  edgeCases.push({ text, out, skeletonKept: analyze(out).skel === analyze(text).skel });
}

// Windowing: a passage well over 511 tokens (every zh row, stripped, concatenated).
const zhPassage = [...new Set(ref.rows.filter((r) => r.lang === 'zh').map((r) => r.stripped.replace(/\s+/g, '')))].join('');
const longRes = await model.inspect(zhPassage);
const windowing = {
  tokens: longRes.ids.length,
  skeletonKept: analyze(longRes.out).skel === analyze(zhPassage).skel,
  out: longRes.out.slice(0, 300),
};
// Around the first window seam: does the windowed pass agree with a single pass over the
// first 511 tokens? (Only the first 511 - 128/2 positions are taken from window 0.)
const firstWindow = await model.inspect(Array.from(zhPassage).slice(0, 511).join(''));
let seamAgree = 0;
for (let i = 0; i < 511; i++) seamAgree += firstWindow.preds[i] === longRes.preds[i];
windowing.firstWindowAgree = seamAgree / 511;

await model.release();

const summary = {
  rows: c.rows,
  loadMs: Math.round(loadMs),
  rawTokensMatchUpstream: rate(c.rawTokens, c.rows),
  idsMatchUpstream: rate(c.ids, c.rows),
  tokenClassAgree_vsPythonOrtInt8: rate(c.tokOrtPy, c.tokens),
  tokenClassAgree_vsTorchFp32: rate(c.tokTorch, c.tokens),
  rowPredsExact_vsPythonOrtInt8: rate(c.predsOrtPy, c.rows),
  rowPredsExact_vsTorchFp32: rate(c.predsTorch, c.rows),
  upstreamTextExact_jsIntermediate_vsPythonOrtInt8: rate(c.fixedOrtPy, c.rows),
  textExact_vsPythonOrtInt8: rate(c.textOrtPy, c.rows),
  textExact_vsTorchFp32: rate(c.textTorch, c.rows),
  textExactAccentCaseFolded_vsTorchFp32: rate(c.textTorchFold, c.rows),
  skeletonKept: rate(c.skeleton, c.rows),
  python: ref.summary,
};
const report = { model: modelId, summary, layoutProbe: ref.layout_probe, commasLeftIn: commas, diffs, edgeCases, windowing };
const outName = `parity-${modelId}.json`;
await writeFile(join(root, 'results', outName), JSON.stringify(report, null, 1));
console.log(JSON.stringify({ summary: { ...summary, python: undefined }, commas: { ...commas, examples: undefined }, windowing }, null, 1));
for (const d of diffs.textVsTorch.slice(0, 3)) console.log('DIFF vs torch', JSON.stringify(d));
for (const e of edgeCases) console.log('EDGE', JSON.stringify(e));
console.log(`wrote results/${outName}`);
