// Renderer-side cost of one punctuation model: load time, first call, latency by
// input length, and JS+WASM memory. Driven by tools/electron-bench.cjs, which adds
// per-process working-set numbers from app.getAppMetrics().
// Query: ?model=<id>&ep=wasm|webgpu&threads=1&reps=15
import { Tokenizer } from '/tokenizers/tokenizers.mjs';
import { makeInput } from '/lib/text.mjs';

const q = new URLSearchParams(location.search);
// &bundle= picks the onnxruntime-web entry: the WebGPU build (default) or e.g.
// ort.wasm.min.mjs. Their WASM binaries do not register the same CPU kernels.
const bundle = q.get('bundle') ?? 'ort.webgpu.min.mjs';
const ort = await import(`/ort/${bundle}`);
const id = q.get('model');
const ep = q.get('ep') ?? 'wasm';
const threads = Number(q.get('threads') ?? '1');
const reps = Number(q.get('reps') ?? '15');
const out = { id, ep, threads, bundle, crossOriginIsolated: self.crossOriginIsolated, ua: navigator.userAgent, done: false };
window.__result = out;
const status = (s) => console.log(`STATUS ${s}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Electron rejects measureUserAgentSpecificMemory even when cross-origin isolated,
// so fall back to the V8 heap; the driver's per-process working set is the real number.
async function jsMemory() {
  try {
    // The measurement waits for a GC; bound it so a busy page cannot hang the run.
    const m = await Promise.race([performance.measureUserAgentSpecificMemory(), sleep(20000).then(() => null)]);
    if (m) return { bytes: m.bytes, source: 'measureUserAgentSpecificMemory' };
  } catch {}
  return performance.memory ? { bytes: performance.memory.usedJSHeapSize, source: 'usedJSHeapSize' } : null;
}

function stats(times) {
  const s = [...times].sort((a, b) => a - b);
  const at = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { min: s[0], median: at(0.5), p90: at(0.9), n: s.length };
}

try {
  ort.env.wasm.wasmPaths = '/ort/';
  ort.env.wasm.numThreads = threads;
  const mod = await import(`/models/${id}.mjs`);
  out.info = mod.info;
  const corpus = await (await fetch('/corpus/synthetic.gold.json')).json();
  await sleep(1500);
  out.memBefore = await jsMemory();
  status('ready');

  const readFile = async (name) => new Uint8Array(await (await fetch(`/files/${id}/${encodeURIComponent(name)}`)).arrayBuffer());
  const t0 = performance.now();
  const model = await mod.create({ ort, Tokenizer, readFile, executionProviders: [ep] });
  out.loadMs = performance.now() - t0;
  status('loaded');

  // ?mode=outputs: punctuate every corpus input once and return the texts, so the
  // same model can be compared across execution providers (tools/ep-parity.mjs).
  if (q.get('mode') === 'outputs') {
    const gl = await (await fetch('/corpus/gpt-live.gold.json')).json();
    out.outputs = [];
    for (const it of [...corpus.items, ...gl.items]) {
      if (!mod.info.langs.includes(it.lang)) continue;
      const variant = it.raw ? 'raw' : it.lang === 'en' ? 'lower' : 'stripped';
      const input = it.raw ?? makeInput(it.ref, variant);
      out.outputs.push({ id: it.id, variant, out: await model.punctuate(input, it.lang) });
    }
    out.done = true;
    console.log(`RESULT ${JSON.stringify(out)}`);
    status('done');
    throw Object.assign(new Error('outputs-mode-finished'), { finished: true });
  }

  // One long spoken passage per language, stripped of punctuation, cut to each length.
  const base = {};
  for (const lang of mod.info.langs) {
    const passages = corpus.items.filter((i) => i.lang === lang).map((i) => makeInput(i.ref, lang === 'en' ? 'lower' : 'stripped'));
    base[lang] = passages.join(lang === 'ja' || lang === 'zh' ? '' : ' ');
  }
  const lengths = (lang) => (lang === 'ja' || lang === 'zh' ? [30, 60, 120, 240, 480] : [60, 120, 240, 480, 960]);

  out.firstCall = {};
  out.latency = [];
  for (const lang of mod.info.langs) {
    const cps = Array.from(base[lang]);
    const t1 = performance.now();
    await model.punctuate(cps.slice(0, lengths(lang)[1]).join(''), lang);
    out.firstCall[lang] = performance.now() - t1;
    for (const n of lengths(lang)) {
      let text = cps.slice(0, n).join('');
      while (Array.from(text).length < n) text += ' ' + base[lang];
      text = Array.from(text).slice(0, n).join('').trim();
      await model.punctuate(text, lang);
      const times = [];
      for (let i = 0; i < reps; i++) {
        const t = performance.now();
        await model.punctuate(text, lang);
        times.push(performance.now() - t);
      }
      out.latency.push({ lang, chars: n, ...stats(times) });
    }
  }
  status('ran');
  out.memAfter = await jsMemory();
  await model.release?.();
} catch (err) {
  if (!err?.finished) out.error = String(err?.stack ?? err);
}
if (q.get('mode') !== 'outputs' || out.error) {
  out.done = true;
  console.log(`RESULT ${JSON.stringify(out)}`);
  status('done');
}
