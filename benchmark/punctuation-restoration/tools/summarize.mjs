// Markdown tables from results/quality-*.json, results/resource.json and
// results/segmenter-node.json. usage: node tools/summarize.mjs > results/summary.md
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const res = join(root, 'results');
const f1 = (x) => (x == null ? '–' : (100 * x).toFixed(1));
const readJson = async (p) => JSON.parse(await readFile(p, 'utf8'));

const quality = {};
for (const f of (await readdir(res)).filter((n) => /^quality-.*\.json$/.test(n)).sort()) {
  const data = await readJson(join(res, f));
  Object.assign(quality, data.models);
}
let segmenter = null;
try { segmenter = await readJson(join(res, 'segmenter-node.json')); } catch {}

const LANGS = ['ja', 'zh', 'en', 'ko'];
console.log('## Offline quality (one call per utterance)\n');
console.log('Sentence-boundary F1 excludes the end of the utterance. `stripped` = all marks removed; `raw` = GPT-Live\'s own transcript; `lower` = English lowercased.\n');
console.log(`| Model | ${LANGS.map((l) => `${l} boundary F1 (P/R)`).join(' | ')} | zh raw boundary F1 | en raw boundary F1 | en lower casing F1 |`);
console.log(`|---|${LANGS.map(() => '---').join('|')}|---|---|---|`);
const cell = (s) => (s ? `**${f1(s.boundary.f)}** (${f1(s.boundary.p)}/${f1(s.boundary.r)})` : '–');
if (segmenter) {
  const r = segmenter.results;
  console.log(`| Intl.Segmenter | ${LANGS.map((l) => cell(r[`${l}/stripped`])).join(' | ')} | ${cell(r['zh/raw'])} | ${cell(r['en/raw'])} | – |`);
}
for (const [id, m] of Object.entries(quality)) {
  const o = m.offline;
  console.log(`| ${id} | ${LANGS.map((l) => cell(o[`${l}/stripped`])).join(' | ')} | ${cell(o['zh/raw'])} | ${cell(o['en/raw'])} | ${o['en/lower'] ? f1(o['en/lower'].upper.f) : '–'} |`);
}

console.log('\n## Offline breakpoints (a comma or a sentence end at the same position)\n');
console.log('Where a subtitle line may be cut. Chinese uses comma vs period loosely, so this is the fairer zh measure.\n');
console.log(`| Model | ${LANGS.map((l) => `${l} breakpoint F1 (P/R)`).join(' | ')} | zh raw breakpoint F1 |`);
console.log(`|---|${LANGS.map(() => '---').join('|')}|---|`);
const bp = (s) => (s?.breakpoint ? `**${f1(s.breakpoint.f)}** (${f1(s.breakpoint.p)}/${f1(s.breakpoint.r)})` : '–');
for (const [id, m] of Object.entries(quality)) {
  const o = m.offline;
  console.log(`| ${id} | ${LANGS.map((l) => bp(o[`${l}/stripped`])).join(' | ')} | ${bp(o['zh/raw'])} |`);
}

console.log('\n## Offline punctuation marks (stripped input)\n');
console.log('| Model | lang | comma F1 | period F1 | question F1 | final terminator | ms per call |');
console.log('|---|---|---|---|---|---|---|');
for (const [id, m] of Object.entries(quality)) {
  if (m.info.output === 'boundary') continue;
  for (const l of LANGS) {
    const s = m.offline[`${l}/stripped`];
    if (!s) continue;
    console.log(`| ${id} | ${l} | ${f1(s.comma.f)} | ${f1(s.period.f)} | ${f1(s.question.f)} | ${f1(s.finalTerm)}% | ${(s.ms / s.calls).toFixed(0)} |`);
  }
}

const pr = (c) => {
  const p = c.tp + c.fp ? c.tp / (c.tp + c.fp) : null;
  const r = c.tp + c.fn ? c.tp / (c.tp + c.fn) : null;
  return `${f1(p)}/${f1(r)}`;
};
for (const [target, title] of [
  ['stream', 'sentence ends'],
  ['streamBreak', 'breakpoints (any mark)'],
]) {
  console.log(`\n## Streaming commits: ${title} (model re-run on every chunk; committed after R characters of right context)\n`);
  console.log('| Model | lang | R=0 P/R | R=4 P/R | R=8 P/R | R=16 P/R | mean lag at R=8 (chars) |');
  console.log('|---|---|---|---|---|---|---|');
  for (const [id, m] of Object.entries(quality)) {
    for (const [lang, byR] of Object.entries(m[target] ?? {})) {
      console.log(`| ${id} | ${lang} | ${pr(byR[0])} | ${pr(byR[4])} | ${pr(byR[8])} | ${pr(byR[16])} | ${byR[8].tp ? (byR[8].lag / byR[8].tp).toFixed(1) : '–'} |`);
    }
  }
}

let resource = {};
try { resource = await readJson(join(res, 'resource.json')); } catch {}
console.log('\n## Renderer cost (Electron 40 renderer on this box)\n');
console.log('Memory is working set from app.getAppMetrics(); "model MB" = renderer after load minus before load.\n');
console.log('| Cell | files MB | load ms | model MB (renderer) | renderer peak MB | GPU proc peak MB | ms @ short | ms @ medium | ms @ long |');
console.log('|---|---|---|---|---|---|---|---|---|');
const mb = (kb) => (kb == null ? '–' : Math.round(kb / 1024));
for (const [key, r] of Object.entries(resource)) {
  if (key.startsWith('_smoke')) continue;
  const p = r.page;
  if (!p || p.error) { console.log(`| ${key} | | failed: ${(p?.error ?? 'timeout').split('\n')[0]} | | | | | | |`); continue; }
  let bytes = 0;
  for (const f of p.info.files) bytes += (await stat(join(p.info.localDir, f))).size;
  const lat = (i) => p.latency.filter((_, j) => j % 5 === i).map((l) => `${l.lang} ${l.chars}: ${l.median.toFixed(0)}`).join('<br>');
  const d = r.marks.loaded && r.marks.ready ? mb(r.marks.loaded.rendererKB - r.marks.ready.rendererKB) : '–';
  console.log(`| ${key} | ${(bytes / 1e6).toFixed(0)} | ${Math.round(p.loadMs)} | ${d} | ${mb(r.peak.rendererKB)} | ${mb(r.peak.gpuKB)} | ${lat(1)} | ${lat(2)} | ${lat(4)} |`);
}
