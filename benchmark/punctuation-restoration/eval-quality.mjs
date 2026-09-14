// Quality of each punctuation model on the gold corpus, offline and streamed.
// usage: node eval-quality.mjs --models pcs47,fireredpunc [--threads 1] [--no-stream] [--out results/quality.json]
//
// Offline: the whole utterance is punctuated once (a VAD final).
// Streamed: the utterance grows chunk by chunk (real deltas when the corpus item has
// them, else 3 CJK characters / 2 words per chunk) and the model re-runs on each
// prefix. A predicted boundary is committed once R skeleton characters of right
// context have arrived after it; committed boundaries are never revised.
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyze, hypothesisFor, loadCorpus, makeInput, newCounts, pct, scoreInto, summarize, TERMINAL } from './lib/text.mjs';
import { loadModel } from './lib/node-env.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const modelIds = arg('models', '').split(',').filter(Boolean);
const threads = Number(arg('threads', '1'));
const outPath = arg('out', join(here, 'results', `quality-${modelIds.join('+')}.json`));
const doStream = !process.argv.includes('--no-stream');
// --no-offline re-runs only the streaming replay and merges it into an existing --out file.
const doOffline = !process.argv.includes('--no-offline');
const langFilter = arg('langs', '').split(',').filter(Boolean);
// --as-lang en --langs fr,de: feed languages a module does not declare, telling the
// module they are `en` (its guard is the only use of the argument) — to measure
// how a model behaves outside its stated coverage.
const asLang = arg('as-lang', '');
const LATIN = new Set(['en', 'fr', 'de', 'es', 'pt']);
const RIGHT_CONTEXT = [0, 4, 8, 16];

const items = await loadCorpus(join(here, 'corpus'));

const outputBoundaries = hypothesisFor;

function variantsFor(it) {
  const v = ['stripped', 'commas'];
  if (LATIN.has(it.lang)) v.push('lower');
  if (it.raw) v.push('raw');
  return v;
}

function chunksFor(it, input) {
  if (it.deltas?.length) return it.deltas;
  const cjk = it.lang === 'ja' || it.lang === 'zh';
  if (cjk) {
    const cps = Array.from(input);
    const out = [];
    for (let i = 0; i < cps.length; i += 3) out.push(cps.slice(i, i + 3).join(''));
    return out;
  }
  const words = input.split(' ');
  const out = [];
  for (let i = 0; i < words.length; i += 2) out.push((i ? ' ' : '') + words.slice(i, i + 2).join(' '));
  return out;
}

let report = { threads, models: {} };
if (!doOffline) report = JSON.parse(await (await import('node:fs/promises')).readFile(outPath, 'utf8'));
for (const id of modelIds) {
  const { info, model, loadMs } = await loadModel(id, { threads });
  const langs = new Set(asLang && langFilter.length ? langFilter : info.langs.filter((l) => !langFilter.length || langFilter.includes(l)));
  const callLang = (lang) => (info.langs.includes(lang) ? lang : asLang);
  const r = doOffline ? { info, loadMs, offline: {}, stream: {}, streamBreak: {}, outputs: [] } : report.models[id];
  r.stream = {};
  r.streamBreak = {};
  report.models[id] = r;
  console.log(`\n== ${id} (${info.name}) load ${loadMs.toFixed(0)} ms, langs ${info.langs.join(',')}`);

  // Warm up once so the first scored call does not pay graph initialisation.
  const warm = items.find((i) => langs.has(i.lang));
  await model.punctuate(makeInput(warm.ref, 'stripped'), callLang(warm.lang));

  const counts = {};
  const timing = {};
  for (const it of doOffline ? items : []) {
    if (!langs.has(it.lang)) continue;
    for (const variant of variantsFor(it)) {
      const input = variant === 'raw' ? it.raw : makeInput(it.ref, variant);
      const t0 = performance.now();
      const out = await model.punctuate(input, callLang(it.lang));
      const ms = performance.now() - t0;
      const key = `${it.lang}/${variant}`;
      counts[key] ??= newCounts();
      timing[key] ??= { ms: 0, chars: 0, calls: 0 };
      timing[key].ms += ms;
      timing[key].chars += Array.from(input).length;
      timing[key].calls++;
      const { hyp } = outputBoundaries(info, out);
      scoreInto(counts[key], it.ref, hyp, { scoreCase: variant === 'lower' });
      r.outputs.push({ id: it.id, variant, input, out, ms: Math.round(ms * 10) / 10 });
    }
  }
  if (doOffline) for (const [key, c] of Object.entries(counts)) r.offline[key] = { ...summarize(c), ...timing[key] };

  if (doStream) {
    for (const it of items) {
      if (!langs.has(it.lang)) continue;
      const input = it.raw ?? makeInput(it.ref, LATIN.has(it.lang) ? 'lower' : 'stripped');
      const gold = analyze(it.ref);
      const gLen = gold.skelChars.length;
      // Two targets: sentence ends (when to hand a sentence to the translator) and
      // breakpoints — any mark — (where a subtitle line may be cut).
      const goldSets = {
        stream: new Set([...gold.marks].filter(([k, c]) => TERMINAL.has(c) && k < gLen).map(([k]) => k)),
        streamBreak: new Set([...gold.marks.keys()].filter((k) => k < gLen)),
      };
      const stats = {};
      const committed = {};
      for (const target of Object.keys(goldSets)) {
        stats[target] = (r[target][it.lang] ??= Object.fromEntries(RIGHT_CONTEXT.map((R) => [R, { tp: 0, fp: 0, fn: 0, lag: 0 }])));
        committed[target] = Object.fromEntries(RIGHT_CONTEXT.map((R) => [R, new Map()]));
      }
      let prefix = '';
      const chunks = chunksFor(it, input);
      for (let ci = 0; ci < chunks.length; ci++) {
        prefix += chunks[ci];
        const last = ci === chunks.length - 1;
        const out = await model.punctuate(prefix, callLang(it.lang));
        const { positions } = outputBoundaries(info, out);
        const predicted = {
          stream: positions,
          streamBreak: info.output === 'boundary' ? positions : [...analyze(out).marks.keys()],
        };
        const len = analyze(prefix).skelChars.length;
        for (const target of Object.keys(goldSets)) {
          for (const R of RIGHT_CONTEXT) {
            for (const k of predicted[target]) {
              if (k <= 0 || k >= len || committed[target][R].has(k)) continue;
              // On the final chunk every predicted position is taken: the VAD closes the utterance.
              if (last || len - k >= R) committed[target][R].set(k, len - k);
            }
          }
        }
      }
      // Skeletons of prefix and gold agree because inputs only drop marks.
      for (const target of Object.keys(goldSets)) {
        for (const R of RIGHT_CONTEXT) {
          const s = stats[target][R];
          for (const [k, lag] of committed[target][R]) {
            if (goldSets[target].has(k)) { s.tp++; s.lag += lag; } else s.fp++;
          }
          for (const k of goldSets[target]) if (!committed[target][R].has(k)) s.fn++;
        }
      }
    }
  }
  await model.release?.();

  console.log('offline  lang/variant   n   bndP   bndR  bndF1  comF1   qF1  final  upF1   ms/call');
  for (const [k, s] of Object.entries(r.offline)) {
    console.log(`         ${k.padEnd(13)} ${String(s.items).padStart(3)}  ${pct(s.boundary.p)}  ${pct(s.boundary.r)}  ${pct(s.boundary.f)}  ${pct(s.comma.f)}  ${pct(s.question.f)}  ${pct(s.finalTerm)}  ${k.endsWith('lower') ? pct(s.upper.f) : '  -  '}  ${(s.ms / s.calls).toFixed(1).padStart(7)}`);
  }
  if (doStream) {
    console.log('stream   lang  R    commitP  commitR  mean lag (chars)');
    for (const [lang, byR] of Object.entries(r.stream)) {
      for (const [R, c] of Object.entries(byR)) {
        const p = c.tp + c.fp ? c.tp / (c.tp + c.fp) : null;
        const rec = c.tp + c.fn ? c.tp / (c.tp + c.fn) : null;
        console.log(`         ${lang}   ${String(R).padStart(2)}   ${pct(p)}    ${pct(rec)}    ${c.tp ? (c.lag / c.tp).toFixed(1) : '-'}`);
      }
    }
  }
}

await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, JSON.stringify(report, null, 1));
console.log(`\nwrote ${outPath}`);
