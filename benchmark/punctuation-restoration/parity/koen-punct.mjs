// JS side of the koen_punctuation parity check (see parity/koen-punct.py for the reference side).
//
// usage:
//   node parity/koen-punct.mjs run <fp32|int8|int8-matmul>   replay results/parity-koen-punct-ref-torch.json rows through
//                                                             models/koen-punct-core.mjs on that graph (WASM, 1 thread):
//                                                             tokenizer ids, per-token labels, output text, and
//                                                             session.run latency at 64/128/256 content tokens
//   node parity/koen-punct.mjs report                        compare every results/parity-koen-punct-{js,ref}-*.json present
import { readFile, writeFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ort, Tokenizer, fileReader } from '../lib/node-env.mjs';
import { loadEngine, LOCAL_DIR, WINDOW } from '../models/koen-punct-core.mjs';
import { analyze } from '../lib/text.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const results = (name) => join(root, 'results', name);
const readJson = async (p) => JSON.parse(await readFile(p, 'utf8'));
const exists = (p) => access(p).then(() => true, () => false);
const FILES = { fp32: 'model.onnx', int8: 'model.int8.onnx', 'int8-matmul': 'model.int8-matmul.onnx' };
const sameArr = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

async function run(variant) {
  const modelFile = FILES[variant];
  if (!modelFile) throw new Error(`unknown variant ${variant}`);
  ort.env.wasm.numThreads = 1;
  const ref = await readJson(results('parity-koen-punct-ref-torch.json'));
  const t0 = performance.now();
  const engine = await loadEngine({ ort, Tokenizer, readFile: fileReader(LOCAL_DIR), executionProviders: ['wasm'] }, modelFile);
  const loadMs = performance.now() - t0;
  console.log(`${variant}: loaded ${modelFile} in ${loadMs.toFixed(0)} ms`);

  const tok = { rows: 0, idMismatch: [], unkRows: [] };
  const rows = [];
  for (const r of ref.rows) {
    tok.rows++;
    const ids = engine.encode(r.input, true).ids;
    if (!sameArr(ids, r.ids)) tok.idMismatch.push({ id: r.id, variant: r.variant, js: ids, py: r.ids });
    if (ids.includes(3)) tok.unkRows.push(`${r.id}/${r.variant}`);
    const s = performance.now();
    const p = await engine.predict(r.input);
    const out = await engine.run(r.input);
    rows.push({
      id: r.id, variant: r.variant, lang: r.lang, labels: p.labels, windows: p.windows,
      punct: out.text, mismatches: out.mismatches, ms: Math.round((performance.now() - s) * 10) / 10,
    });
  }
  console.log(`tokenizer: ${tok.rows} rows, id mismatches ${tok.idMismatch.length}, rows with <unk> ${tok.unkRows.length}`);
  console.log(`character-mapping misses: ${rows.reduce((a, r) => a + r.mismatches, 0)}`);

  // session.run latency on single windows of exactly N content tokens (+<s></s>), median of 15 after 3 warm-ups.
  const bench = {};
  for (const lang of ['ko', 'en']) {
    const long = ref.rows.find((r) => r.id === `${lang}-long`);
    const content = long.ids.slice(1, -1);
    for (const n of [64, 128, 256]) {
      const ids = Array.from({ length: n }, (_, i) => content[i % content.length]);
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
  const dst = results(`parity-koen-punct-js-${variant}.json`);
  await writeFile(dst, JSON.stringify({ variant, modelFile, loadMs, tokenizer: tok, bench, rows }, null, 1));
  console.log(`wrote ${dst}`);
}

/** Scored (skeleton position, mark class) pairs of one output, as lib/text.mjs scores them. */
const events = (s) => new Set([...analyze(s).marks].map(([k, c]) => `${k}:${c}`));

/** Content-token labels of a row: JS rows store them without <s></s>, reference rows with. */
const contentLabels = (r) => (r.ids ? r.labels.slice(1, -1) : r.labels);

function compare(label, a, b, { filter = () => true, limit = 10 } = {}) {
  const byKey = new Map(b.map((r) => [`${r.id}/${r.variant}`, r]));
  const c = { label, rows: 0, same: 0, labelsSame: 0, labelsTotal: 0, rowsLabelsEqual: 0, eventsAgree: 0, eventsUnion: 0, diffs: [] };
  for (const r of a) {
    const o = byKey.get(`${r.id}/${r.variant}`);
    if (!o || !filter(r)) continue;
    c.rows++;
    if (r.punct === o.punct) c.same++;
    else if (c.diffs.length < limit) c.diffs.push({ row: `${r.id}/${r.variant}`, a: r.punct, b: o.punct });
    const la = contentLabels(r);
    const lb = contentLabels(o);
    if (sameArr(la, lb)) c.rowsLabelsEqual++;
    for (let i = 0; i < Math.min(la.length, lb.length); i++) if (la[i] === lb[i]) c.labelsSame++;
    c.labelsTotal += Math.max(la.length, lb.length);
    const ea = events(r.punct);
    const eb = events(o.punct);
    for (const e of ea) if (eb.has(e)) c.eventsAgree++;
    c.eventsUnion += new Set([...ea, ...eb]).size;
  }
  const pctOf = (x, y) => (y ? ((100 * x) / y).toFixed(1) : '-');
  console.log(`${label.padEnd(52)} rows ${c.same}/${c.rows} (${pctOf(c.same, c.rows)}%)  label-rows ${c.rowsLabelsEqual}/${c.rows}  tokens ${c.labelsSame}/${c.labelsTotal} (${pctOf(c.labelsSame, c.labelsTotal)}%)  marks ${c.eventsAgree}/${c.eventsUnion} (${pctOf(c.eventsAgree, c.eventsUnion)}%)`);
  return c;
}

async function report() {
  const load = async (name) => ((await exists(results(name))) ? (await readJson(results(name))).rows : null);
  const torch = await load('parity-koen-punct-ref-torch.json');
  const py = {};
  const js = {};
  for (const v of Object.keys(FILES)) {
    py[v] = await load(`parity-koen-punct-ref-${v}.json`);
    js[v] = await load(`parity-koen-punct-js-${v}.json`);
  }
  const scopes = [
    ['ko corpus', (r) => r.lang === 'ko' && r.variant !== 'long'],
    ['en corpus', (r) => r.lang === 'en' && r.variant !== 'long'],
    ['long rows', (r) => r.variant === 'long'],
  ];
  const out = [];
  const both = (label, a, b) => {
    if (!a || !b) return;
    for (const [scope, filter] of scopes) out.push(compare(`${label} [${scope}]`, a, b, { filter }));
  };
  for (const v of Object.keys(FILES)) both(`JS ${v} vs torch`, js[v], torch);
  for (const v of Object.keys(FILES)) both(`onnxruntime-py ${v} vs torch`, py[v], torch);
  for (const v of ['int8', 'int8-matmul']) both(`JS ${v} vs JS fp32`, js[v], js.fp32);
  for (const v of Object.keys(FILES)) both(`JS ${v} vs onnxruntime-py ${v}`, js[v], py[v]);
  for (const c of out) {
    if (!c.diffs.length) continue;
    console.log(`\n-- ${c.label}: first ${c.diffs.length} diffs`);
    for (const d of c.diffs) console.log(`   ${d.row}\n     a: ${JSON.stringify(d.a)}\n     b: ${JSON.stringify(d.b)}`);
  }
  const meta = {};
  for (const v of Object.keys(FILES)) {
    const p = results(`parity-koen-punct-js-${v}.json`);
    if (!(await exists(p))) continue;
    const j = await readJson(p);
    meta[v] = {
      loadMs: Math.round(j.loadMs), bench: j.bench,
      tokenizer: { rows: j.tokenizer.rows, idMismatch: j.tokenizer.idMismatch.length, unkRows: j.tokenizer.unkRows },
      mappingMisses: j.rows.reduce((a, r) => a + r.mismatches, 0),
      maxWindows: Math.max(...j.rows.map((r) => r.windows)),
    };
  }
  const longTokens = torch?.filter((r) => r.variant === 'long').map((r) => `${r.id}: ${r.n_tokens} tokens (window ${WINDOW})`);
  console.log('\n', JSON.stringify({ meta, longTokens }, null, 1));
  await writeFile(results('parity-koen-punct.json'), JSON.stringify({ comparisons: out, js: meta, longTokens }, null, 1));
  console.log(`wrote ${results('parity-koen-punct.json')}`);
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === 'run') await run(arg);
else if (cmd === 'report') await report();
else throw new Error('usage: node parity/koen-punct.mjs run <fp32|int8|int8-matmul> | report');
