// JS side of the PCS-47 parity check (see parity/pcs47.py for the reference side).
//
// usage:
//   node parity/pcs47.mjs run <fp32|int8|int8-matmul>   replay results/parity-pcs47-ref-fp32.json rows through
//                                                        models/pcs47-core.mjs on that graph (WASM, 1 thread),
//                                                        verify the tokenizer, time session.run at 64/128/254 tokens
//   node parity/pcs47.mjs report                        compare every results/parity-pcs47-{js,ref}-*.json present
import { readFile, writeFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ort, Tokenizer, fileReader } from '../lib/node-env.mjs';
import { loadEngine, LOCAL_DIR } from '../models/pcs47-core.mjs';
import { analyze } from '../lib/text.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const results = (name) => join(root, 'results', name);
const readJson = async (p) => JSON.parse(await readFile(p, 'utf8'));
const exists = (p) => access(p).then(() => true, () => false);
const FILES = { fp32: 'model.onnx', int8: 'model.int8.onnx', 'int8-matmul': 'model.int8-matmul.onnx' };
const sameIds = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

async function run(variant) {
  const modelFile = FILES[variant];
  if (!modelFile) throw new Error(`unknown variant ${variant}`);
  ort.env.wasm.numThreads = 1;
  const ref = await readJson(results('parity-pcs47-ref-fp32.json'));
  const t0 = performance.now();
  const engine = await loadEngine({ ort, Tokenizer, readFile: fileReader(LOCAL_DIR), executionProviders: ['wasm'] }, modelFile);
  const loadMs = performance.now() - t0;
  console.log(`${variant}: loaded ${modelFile} in ${loadMs.toFixed(0)} ms`);

  const tok = { rows: 0, preprocessMismatch: [], inputIdsMismatch: [], preIdsMismatch: [], unkRows: [] };
  const rows = [];
  for (const r of ref.rows) {
    tok.rows++;
    const pre = engine.preprocess(r.input);
    if (pre !== r.pre) tok.preprocessMismatch.push({ id: r.id, variant: r.variant, js: pre, py: r.pre });
    const idsIn = engine.encode(r.input).ids;
    if (!sameIds(idsIn, r.sp_ids_input)) tok.inputIdsMismatch.push({ id: r.id, variant: r.variant, js: idsIn, sp: r.sp_ids_input });
    const idsPre = engine.encode(r.pre).ids;
    if (!sameIds(idsPre, r.sp_ids_pre)) tok.preIdsMismatch.push({ id: r.id, variant: r.variant, js: idsPre, sp: r.sp_ids_pre });
    if (idsPre.includes(3)) tok.unkRows.push(`${r.id}/${r.variant}`);
    const s = performance.now();
    const out = await engine.run(r.input);
    rows.push({ id: r.id, variant: r.variant, punct: out.text, sbd: out.sentences.join('\n'), ms: Math.round((performance.now() - s) * 10) / 10 });
  }
  console.log(`tokenizer: ${tok.rows} rows, preprocess mismatches ${tok.preprocessMismatch.length}, raw-input id mismatches ${tok.inputIdsMismatch.length}, preprocessed id mismatches ${tok.preIdsMismatch.length}, rows with <unk> ${tok.unkRows.length}`);

  // session.run latency on single windows of exactly N tokens (+BOS/EOS), median of 15 after 3 warm-ups.
  const bench = {};
  for (const lang of ['en', 'ja']) {
    const long = ref.rows.find((r) => r.id === `${lang}-long`);
    for (const n of [64, 128, 254]) {
      const ids = long.sp_ids_pre.slice(0, n);
      for (let i = 0; i < 3; i++) await engine.runWindow(ids);
      const ts = [];
      for (let i = 0; i < 15; i++) {
        const s = performance.now();
        await engine.runWindow(ids);
        ts.push(performance.now() - s);
      }
      ts.sort((a, b) => a - b);
      bench[`${lang}/${n}`] = Math.round(ts[7] * 10) / 10;
    }
  }
  console.log('session.run median ms (1 thread):', bench);
  await engine.release();
  const dst = results(`parity-pcs47-js-${variant}.json`);
  await writeFile(dst, JSON.stringify({ variant, modelFile, loadMs, tokenizer: tok, bench, rows }, null, 1));
  console.log(`wrote ${dst}`);
}

/**
 * Scored events of one output: for `punct`, (skeleton position, mark class) pairs as lib/text.mjs
 * scores them; for `sbd`, the skeleton positions of the '\n' splits.
 */
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

function compare(label, a, b, key, limit = 10) {
  const byKey = new Map(b.map((r) => [`${r.id}/${r.variant}`, r]));
  let same = 0;
  let n = 0;
  let agree = 0;
  let union = 0;
  const diffs = [];
  for (const r of a) {
    const o = byKey.get(`${r.id}/${r.variant}`);
    if (!o) continue;
    n++;
    if (r[key] === o[key]) same++;
    else if (diffs.length < limit) diffs.push({ row: `${r.id}/${r.variant}`, a: r[key], b: o[key] });
    const ea = events(r[key], key);
    const eb = events(o[key], key);
    for (const e of ea) if (eb.has(e)) agree++;
    union += new Set([...ea, ...eb]).size;
  }
  const pctOf = (x, y) => (y ? ((100 * x) / y).toFixed(1) : '-');
  const what = key === 'sbd' ? 'boundaries' : 'marks';
  console.log(`${label.padEnd(44)} ${key.padEnd(5)} rows ${same}/${n} (${pctOf(same, n)}%)  ${what} ${agree}/${union} (${pctOf(agree, union)}%)`);
  return { label, key, same, n, eventsAgree: agree, eventsUnion: union, diffs };
}

async function report() {
  const load = async (name) => ((await exists(results(name))) ? (await readJson(results(name))).rows : null);
  const py = { fp32: await load('parity-pcs47-ref-fp32.json'), int8: await load('parity-pcs47-ref-int8.json'), 'int8-matmul': await load('parity-pcs47-ref-int8-matmul.json') };
  const js = { fp32: await load('parity-pcs47-js-fp32.json'), int8: await load('parity-pcs47-js-int8.json'), 'int8-matmul': await load('parity-pcs47-js-int8-matmul.json') };
  const out = [];
  for (const v of Object.keys(FILES)) {
    if (js[v] && py[v]) for (const k of ['punct', 'sbd']) out.push(compare(`JS ${v} vs punctuators ${v}`, js[v], py[v], k));
  }
  py['int8-noopt'] = await load('parity-pcs47-ref-int8-noopt.json');
  if (js.int8 && py['int8-noopt']) for (const k of ['punct', 'sbd']) out.push(compare('JS int8 vs punctuators int8 (graph opt off)', js.int8, py['int8-noopt'], k));
  for (const v of ['int8', 'int8-matmul']) {
    if (js[v] && js.fp32) for (const k of ['punct', 'sbd']) out.push(compare(`JS ${v} vs JS fp32`, js[v], js.fp32, k));
    if (py[v] && py.fp32) for (const k of ['punct', 'sbd']) out.push(compare(`punctuators ${v} vs punctuators fp32`, py[v], py.fp32, k));
  }
  for (const c of out) {
    if (!c.diffs.length) continue;
    console.log(`\n-- ${c.label} (${c.key}): first ${c.diffs.length} diffs`);
    for (const d of c.diffs) console.log(`   ${d.row}\n     a: ${JSON.stringify(d.a)}\n     b: ${JSON.stringify(d.b)}`);
  }
  const tok = {};
  for (const v of Object.keys(FILES)) {
    const p = results(`parity-pcs47-js-${v}.json`);
    if (await exists(p)) {
      const j = await readJson(p);
      tok[v] = { loadMs: j.loadMs, bench: j.bench, tokenizer: { rows: j.tokenizer.rows, preprocessMismatch: j.tokenizer.preprocessMismatch.length, inputIdsMismatch: j.tokenizer.inputIdsMismatch.length, preIdsMismatch: j.tokenizer.preIdsMismatch.length, unkRows: j.tokenizer.unkRows } };
    }
  }
  console.log('\n', JSON.stringify(tok, null, 1));
  await writeFile(results('parity-pcs47.json'), JSON.stringify({ comparisons: out, js: tok }, null, 1));
  console.log(`wrote ${results('parity-pcs47.json')}`);
}

const median = (ts) => {
  const s = [...ts].sort((a, b) => a - b);
  return Math.round(s[Math.floor(s.length / 2)] * 10) / 10;
};

/**
 * Latency only, one graph per process (a WASM heap never shrinks, so loading the 1.1 GB fp32
 * graph after another one risks running out of the 4 GB address space). Run it on a quiet CPU.
 * `session.run` on one window of exactly N ids (+BOS/EOS), median of 15 after 3 warm-ups; and the
 * whole pipeline (preprocess, tokenize, two stitched windows, decode) on each ~450-token `long` row.
 */
async function bench(variant) {
  const modelFile = FILES[variant];
  if (!modelFile) throw new Error(`unknown variant ${variant}`);
  ort.env.wasm.numThreads = 1;
  const ref = await readJson(results('parity-pcs47-ref-fp32.json'));
  const t0 = performance.now();
  const engine = await loadEngine({ ort, Tokenizer, readFile: fileReader(LOCAL_DIR), executionProviders: ['wasm'] }, modelFile);
  const r = { variant, modelFile, loadMs: Math.round(performance.now() - t0), window: {}, pipeline: {} };
  for (const lang of ['en', 'ja', 'zh', 'ko']) {
    const long = ref.rows.find((x) => x.id === `${lang}-long`);
    for (const n of [64, 128, 254]) {
      const ids = long.sp_ids_pre.slice(0, n);
      for (let i = 0; i < 3; i++) await engine.runWindow(ids);
      const ts = [];
      for (let i = 0; i < 15; i++) {
        const s = performance.now();
        await engine.runWindow(ids);
        ts.push(performance.now() - s);
      }
      r.window[`${lang}/${n}`] = median(ts);
    }
    await engine.run(long.input);
    const ts = [];
    for (let i = 0; i < 5; i++) {
      const s = performance.now();
      await engine.run(long.input);
      ts.push(performance.now() - s);
    }
    r.pipeline[`${lang}/${long.n_tokens}tok`] = median(ts);
  }
  await engine.release();
  console.log(JSON.stringify(r));
  const dst = results('parity-pcs47-bench.json');
  const all = (await exists(dst)) ? await readJson(dst) : {};
  all[variant] = r;
  await writeFile(dst, JSON.stringify(all, null, 1));
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === 'run') await run(arg);
else if (cmd === 'bench') await bench(arg);
else if (cmd === 'report') await report();
else throw new Error('usage: node parity/pcs47.mjs run <fp32|int8|int8-matmul> | bench <fp32|int8|int8-matmul> | report');
