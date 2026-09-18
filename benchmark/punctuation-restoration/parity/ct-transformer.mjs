// Parity of models/ct-transformer.mjs against the official sherpa-onnx Python package
// (OfflinePunctuation) on the same model files.
// usage:
//   node tools/dump-inputs.mjs
//   node parity/ct-transformer.mjs prep                  -> results/parity-ct-transformer-rows.json
//   <venv-sherpa>/bin/python parity/ct-transformer.py    -> results/parity-ct-transformer-ref.json
//   node parity/ct-transformer.mjs compare               -> results/parity-ct-transformer.json, -diffwin.json
//   <venv-sherpa>/bin/python parity/ct-transformer.py --diffwin -> results/parity-ct-transformer-diffwin-ref.json
//   node parity/ct-transformer.mjs compare               (again: attaches the first flipped window to every diff)
//   node parity/ct-transformer.mjs latency               -> results/parity-ct-transformer-latency.json
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyze, newCounts, scoreInto, summarize } from '../lib/text.mjs';
import { fileReader, loadModel, ort, Tokenizer } from '../lib/node-env.mjs';
import * as ct from '../models/ct-transformer.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const res = (f) => join(root, 'results', f);
const readJson = async (f) => JSON.parse(await readFile(f, 'utf8'));
const mode = process.argv[2];
const UNK_ID = 272726; // tokens.json: '<unk>' is the last entry

const LONG_ZH = '今天天气很好我们一起去公园散步吧公园里有很多人有的在跑步有的在打太极拳还有一些小朋友在放风筝'
  + '我们走了一个小时觉得有点累了就找了一个长椅坐下来休息你想喝点什么吗我去买两瓶水回来之后我们再继续走吧'
  + '晚上我们还要去朋友家吃饭他们准备了很多好吃的菜听说还有我最喜欢的红烧肉我已经很期待了'
  + '明天是周一我们都要早起上班所以今晚不能玩得太晚';

const EDGE = [
  ['empty', 'zh', ''],
  ['whitespace-only', 'zh', ' '],
  ['marks-only', 'zh', '，。'],
  ['short', 'zh', '你好'],
  ['sherpa-example-mixed', 'zh', '这是一个测试你好吗How are you我很好thank you are you ok谢谢你'],
  ['sherpa-example-en', 'en', 'The African blogosphere is rapidly expanding bringing more voices online in the form of commentaries opinions analyses rants and poetry'],
  ['accents-cyrillic', 'en', 'ÉCOLE abbÉ abbé Привет öffnen Straße'],
  ['decimal-dates', 'zh', '价格是3.5元今天是2024年9月14日'],
  ['emoji', 'zh', '我很开心😀你呢'],
  ['apostrophe-hyphen', 'en', "i don't know it's a well-known fact"],
  ['existing-marks-zh', 'zh', '你好，我很好。谢谢'],
  ['existing-marks-en', 'en', 'hello, world. how are you? i am fine'],
  ['fullwidth', 'zh', 'ＡＢＣ１２３测试一下'],
  ['whitespace-kinds', 'zh', '你好\n世界\t再见 朋友　们'],
  ['uppercase-en', 'en', 'HELLO WORLD THIS IS A TEST OF THE SYSTEM'],
  ['ja-sample', 'ja', '今日はいい天気ですね明日も晴れるといいですね'],
  ['ko-sample', 'ko', '오늘은 날씨가 좋네요 내일도 맑았으면 좋겠어요'],
  ['long-zh-161', 'zh', LONG_ZH],
  ['long-zh-483', 'zh', LONG_ZH.repeat(3)],
];

async function prep() {
  const inputs = await readJson(res('inputs.json'));
  const rows = inputs.map((r) => ({ key: `${r.id}/${r.variant}`, id: r.id, lang: r.lang, variant: r.variant, input: r.input, ref: r.ref }));
  for (const [name, lang, input] of EDGE) rows.push({ key: `edge/${name}`, id: `edge/${name}`, lang, variant: 'edge', input });
  // Found by searching prefixes of the zh corpus for sherpa's last-window truncation (see ct-transformer.md).
  const truncation = existsSync(res('parity-ct-transformer-truncation.json')) ? await readJson(res('parity-ct-transformer-truncation.json')) : [];
  for (const t of truncation) rows.push({ key: `edge/truncation-${t.off}+${t.n}`, id: 'edge/truncation', lang: 'zh', variant: 'edge', input: t.text });
  // Concatenations exercise the 20-token windows, their carry-over and the 200-token cap.
  const groups = [['zh', 'stripped', ''], ['en', 'stripped', ' '], ['en', 'lower', ' ']];
  for (const [lang, variant, sep] of groups) {
    const items = inputs.filter((r) => r.lang === lang && r.variant === variant);
    for (const w of [3, 6]) {
      for (let s = 0; s + w <= items.length; s += 3) {
        const part = items.slice(s, s + w);
        rows.push({ key: `concat/${lang}/${variant}/${s}+${w}`, id: `concat/${lang}`, lang, variant: `concat-${variant}`, input: part.map((r) => r.input).join(sep), ref: part.map((r) => r.ref).join(sep) });
      }
    }
    rows.push({ key: `concat/${lang}/${variant}/all`, id: `concat/${lang}`, lang, variant: `concat-${variant}`, input: items.map((r) => r.input).join(sep), ref: items.map((r) => r.ref).join(sep) });
  }
  for (const r of rows) r.pre = ct.stripPredictedMarks(r.input);

  // Logits of one forward pass over each stripped zh/en input, with ORT-web's default
  // graph optimizations and with them disabled, for a kernel-level comparison with native ORT.
  const { model } = await loadModel('ct-transformer');
  const noOpt = await ct.create({ ort, Tokenizer, readFile: fileReader(ct.info.localDir), executionProviders: ['wasm'], sessionOptions: { graphOptimizationLevel: 'disabled' } });
  const logits = [];
  for (const r of inputs.filter((x) => (x.lang === 'zh' || x.lang === 'en') && x.variant === 'stripped')) {
    const ids = model.tokenize(r.input).ids.slice(0, 200);
    const a = await model.logits(ids);
    const b = await noOpt.logits(ids);
    logits.push({ key: `${r.id}/${r.variant}`, ids: Array.from(ids), jsLogits: Array.from(a.data), jsLogitsNoOpt: Array.from(b.data) });
  }
  await model.release();
  await noOpt.release();
  await writeFile(res('parity-ct-transformer-rows.json'), JSON.stringify({ rows, logits }));
  console.log(`wrote ${rows.length} rows (${truncation.length} truncation cases) and ${logits.length} logits rows`);
}

const attempt = async (f) => {
  try {
    return await f();
  } catch (e) {
    return `EXC: ${String(e?.message ?? e).split('\n')[0]}`;
  }
};
const skel = (t) => analyze(t).skel;
const PUNCT = ['<unk>', '_', '，', '。', '？', '、'];
const MARKS = ['<unk>', '，', '。', '？', '、'];

/**
 * Per-token class read back off an output string built from `words`. Stops at the
 * first token it cannot find (a truncated output). A mark is only taken as the
 * token's class when the next token still lines up after it, so an input token that
 * is itself "，" is not mistaken for a predicted mark.
 */
function tokenClasses(out, words) {
  const cls = [];
  let pos = 0;
  const at = (w, p) => w === undefined || out.startsWith(w, p) || (out[p] === ' ' && out.startsWith(w, p + 1));
  for (let i = 0; i < words.length; i++) {
    if (i > 0 && out[pos] === ' ' && !out.startsWith(words[i], pos)) pos++;
    if (!out.startsWith(words[i], pos)) break;
    pos += words[i].length;
    const m = MARKS.find((x) => out.startsWith(x, pos));
    if (m && (at(words[i + 1], pos + m.length) || !at(words[i + 1], pos))) {
      cls.push(m);
      pos += m.length;
    } else {
      cls.push('_');
    }
  }
  return cls;
}

/**
 * The first token whose class differs between the reference and the JS output, the
 * window that committed it, and the ORT-web logits there. Windows before it are
 * identical on both sides (window starts depend only on committed sentence ends),
 * so this window saw the same ids in sherpa-onnx.
 */
function firstFlip(key, words, refOut, jsOut, trace) {
  const r = tokenClasses(refOut, words);
  const j = tokenClasses(jsOut, words);
  let k = 0;
  while (k < Math.min(r.length, j.length) && r[k] === j[k]) k++;
  if (k >= Math.min(r.length, j.length)) return null;
  const w = trace.findIndex((t) => t.start <= k && k < t.start + t.committed);
  if (w < 0) return null;
  const pos = k - trace[w].start;
  const webLogits = trace[w].logits.slice(pos * 6, pos * 6 + 6).map((v) => Math.round(v * 1e4) / 1e4);
  const webIdx = webLogits.indexOf(Math.max(...webLogits));
  const refIdx = PUNCT.indexOf(r[k]);
  return {
    key,
    token: words[k],
    tokenIndex: k,
    lastToken: k === words.length - 1,
    window: w,
    windowStart: trace[w].start,
    windowLen: trace[w].ids.length,
    pos,
    windowIds: trace[w].ids,
    refClass: r[k],
    jsClassInOutput: j[k],
    webClass: PUNCT[webIdx],
    webLogits,
    webMarginOverRefClass: refIdx >= 0 ? Math.round((webLogits[webIdx] - webLogits[refIdx]) * 1e4) / 1e4 : null,
  };
}
const NEAR_TIE_LIMIT = 1; // logits; see ct-transformer.md
const nearTie = (f) => f && f.webMarginOverRefClass !== null && f.webMarginOverRefClass < NEAR_TIE_LIMIT;

async function compare() {
  const { rows } = await readJson(res('parity-ct-transformer-rows.json'));
  const ref = await readJson(res('parity-ct-transformer-ref.json'));
  const refByKey = new Map(ref.rows.map((r) => [r.key, r]));
  // Native-ORT logits at each first flip, from `parity/ct-transformer.py --diffwin`.
  const flips = existsSync(res('parity-ct-transformer-diffwin-ref.json'))
    ? new Map((await readJson(res('parity-ct-transformer-diffwin-ref.json'))).map((d) => [d.key, d]))
    : new Map();
  const { model } = await loadModel('ct-transformer');
  const up = { n: 0, match: 0, bothThrow: 0, explained: {}, unexplained: 0, diffs: [] };
  const mod = { n: 0, match: 0, explained: {}, unexplained: 0, diffs: [], skeletonLost: 0 };
  const count = (o, why) => (why ? (o.explained[why] = (o.explained[why] ?? 0) + 1) : o.unexplained++);
  const diffwin = [];
  const truncated = [];
  for (const r of rows) {
    const rf = refByKey.get(r.key);
    const js = await attempt(() => model.punctuateUpstream(r.input));
    up.n++;
    if (js === rf.refInput || (js.startsWith('EXC:') && rf.refInput.startsWith('EXC:'))) {
      up.match++;
      if (js.startsWith('EXC:')) up.bothThrow++;
    } else {
      const trace = [];
      await model.punctuateUpstream(r.input, trace);
      const flip = firstFlip(r.key, model.tokenize(r.input).words, rf.refInput, js, trace);
      if (flip) diffwin.push(flip);
      const why = nearTie(flip) ? `ORT-web vs sherpa-onnx near-tie at one token (margin < ${NEAR_TIE_LIMIT} logit), same window ids; later windows follow from it` : null;
      count(up, why);
      up.diffs.push({ key: r.key, input: r.input, ref: rf.refInput, js, explanation: why ?? 'UNEXPLAINED', firstFlip: flip && { ...flip, windowIds: undefined, native: flips.get(r.key) ?? null } });
    }
    if (!rf.refInput.startsWith('EXC:') && skel(rf.refInput) !== skel(r.input)) truncated.push({ key: r.key, inputChars: skel(r.input).length, refChars: skel(rf.refInput).length });

    if (!ct.info.langs.includes(r.lang)) continue;
    const out = await attempt(() => model.punctuate(r.input, r.lang));
    mod.n++;
    if (skel(out) !== skel(r.input)) mod.skeletonLost++;
    const expected = rf.refPre;
    if (out === expected) {
      mod.match++;
      continue;
    }
    let why = null;
    let flip = null;
    if (expected.startsWith('EXC:') && skel(r.pre) === '') why = 'no tokens: upstream throws (T=0 ConvInteger), module returns the input';
    else if (!expected.startsWith('EXC:') && skel(expected) !== skel(r.pre) && out.startsWith(expected) && skel(out) === skel(r.pre)) why = 'upstream drops the tokens after a sentence end found in its last window; module keeps them';
    else {
      const trace = [];
      await model.punctuateUpstream(r.pre, trace);
      const f = firstFlip(`module:${r.key}`, model.tokenize(r.pre).words, expected, out, trace);
      if (f) diffwin.push(f);
      if (nearTie(f)) why = `ORT-web vs sherpa-onnx near-tie at one token (margin < ${NEAR_TIE_LIMIT} logit), same window ids; later windows follow from it`;
      flip = f && { ...f, windowIds: undefined, native: flips.get(`module:${r.key}`) ?? null };
    }
    count(mod, why);
    mod.diffs.push({ key: r.key, pre: r.pre, refOnPre: expected, module: out, explanation: why ?? 'UNEXPLAINED', firstFlip: flip });
  }

  // How the model does per language through the module path (strip marks, keep the last window whole).
  const langProbe = {};
  for (const lang of ['zh', 'en', 'ja', 'ko']) {
    for (const variant of ['stripped', 'commas']) {
      const items = rows.filter((r) => r.lang === lang && r.variant === variant);
      const counts = newCounts();
      let tokens = 0;
      let unk = 0;
      const samples = [];
      for (const r of items) {
        const { ids } = model.tokenize(r.pre);
        tokens += ids.length;
        unk += ids.filter((x) => x === UNK_ID).length;
        const out = r.pre.trim() ? await model.punctuateUpstream(r.pre) : r.input;
        scoreInto(counts, r.ref, out);
        if (samples.length < 3) samples.push({ key: r.key, ref: r.ref, out });
      }
      const s = summarize(counts);
      langProbe[`${lang}/${variant}`] = { items: s.items, unkTokenRate: tokens ? unk / tokens : null, boundaryF1: s.boundary.f, boundaryP: s.boundary.p, boundaryR: s.boundary.r, commaF1: s.comma.f, questionF1: s.question.f, finalTerm: s.finalTerm, samples };
    }
  }
  await model.release();

  const lg = ref.logits;
  const logits = lg && {
    rows: lg.length,
    nativeOrt: ref.onnxruntime,
    maxAbsDiff: Object.fromEntries(Object.keys(lg[0].maxAbsDiff).map((k) => [k, Math.max(...lg.map((x) => x.maxAbsDiff[k]))])),
    minArgmaxAgree: Object.fromEntries(Object.keys(lg[0].argmaxAgree).map((k) => [k, Math.min(...lg.map((x) => x.argmaxAgree[k]))])),
    worst: [...lg].sort((a, b) => b.maxAbsDiff['native-all~web-default'] - a.maxAbsDiff['native-all~web-default']).slice(0, 3).map((x) => ({ key: x.key, T: x.T, maxAbsDiff: x.maxAbsDiff })),
  };
  const report = {
    reference: { sherpaOnnx: ref.sherpaOnnx },
    upstream: { ...up, rate: up.match / up.n, note: 'models/ct-transformer.mjs punctuateUpstream(input) vs sherpa OfflinePunctuation.add_punctuation(input)' },
    module: { ...mod, rate: mod.match / mod.n, note: 'punctuate(input, lang) vs add_punctuation(stripPredictedMarks(input)), langs ' + ct.info.langs.join(',') },
    referenceTruncatedRows: truncated,
    logits,
    langProbe,
  };
  await writeFile(res('parity-ct-transformer.json'), JSON.stringify(report, null, 1));
  await writeFile(res('parity-ct-transformer-diffwin.json'), JSON.stringify(diffwin));
  console.log(`upstream ${up.match}/${up.n} exact (${up.bothThrow} both throw), diffs explained ${JSON.stringify(up.explained)}, unexplained ${up.unexplained}`);
  console.log(`module ${mod.match}/${mod.n} exact, explained ${JSON.stringify(mod.explained)}, unexplained ${mod.unexplained}, skeleton lost ${mod.skeletonLost}`);
  console.log(`reference truncated ${truncated.length} rows: ${JSON.stringify(truncated)}`);
  if (logits) console.log(`logits: ${JSON.stringify(logits.maxAbsDiff)} argmax ${JSON.stringify(logits.minArgmaxAgree)}`);
  for (const [k, v] of Object.entries(langProbe)) console.log(`probe ${k.padEnd(12)} unk ${(100 * v.unkTokenRate).toFixed(1)}%  bndF1 ${(100 * v.boundaryF1).toFixed(1)}  commaF1 ${(100 * v.commaF1).toFixed(1)}`);
  for (const d of [...up.diffs, ...mod.diffs]) {
    const f = d.firstFlip;
    console.log('diff', d.key, '|', d.explanation, '|', f ? `token ${JSON.stringify(f.token)} #${f.tokenIndex} win ${f.window} pos ${f.pos}/${f.windowLen}: ref ${f.refClass} js ${f.jsClassInOutput} web ${JSON.stringify(f.webLogits)} margin ${f.webMarginOverRefClass} native ${f.native ? `${f.native.nativeClass} ${JSON.stringify(f.native.nativeLogits)}` : '-'}` : '');
  }
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

async function latency() {
  const inputs = await readJson(res('inputs.json'));
  const { model, loadMs } = await loadModel('ct-transformer', { threads: 1 });
  const han = Array.from(inputs.filter((r) => r.lang === 'zh' && r.variant === 'stripped').map((r) => r.input).join('')).filter((ch) => /\p{Script=Han}/u.test(ch));
  const enWords = inputs.filter((r) => r.lang === 'en' && r.variant === 'lower').map((r) => r.input).join(' ').split(' ').filter((w) => ct.splitTokens(w).length === 1);
  const report = { threads: 1, loadMs, runs: 15, cases: [] };
  for (const [lang, make] of [['zh', (n) => han.slice(0, n).join('')], ['en', (n) => enWords.slice(0, n).join(' ')]]) {
    for (const n of [64, 128, 200]) {
      const text = make(n);
      const { ids } = model.tokenize(text);
      for (let i = 0; i < 2; i++) await model.punctuate(text, lang);
      const call = [];
      const fwd = [];
      let windows = 0;
      for (let i = 0; i < report.runs; i++) {
        let t0 = performance.now();
        await model.punctuate(text, lang);
        call.push(performance.now() - t0);
        t0 = performance.now();
        await model.logits(ids);
        fwd.push(performance.now() - t0);
      }
      const trace = [];
      await model.punctuateUpstream(text, trace);
      windows = trace.map((w) => w.ids.length);
      report.cases.push({ lang, tokens: ids.length, punctuateMedianMs: median(call), singleForwardMedianMs: median(fwd), windowLengths: windows });
    }
  }
  await model.release();
  await writeFile(res('parity-ct-transformer-latency.json'), JSON.stringify(report, null, 1));
  console.log(JSON.stringify(report, null, 1));
}

if (mode === 'prep') await prep();
else if (mode === 'compare') await compare();
else if (mode === 'latency') await latency();
else throw new Error('usage: node parity/ct-transformer.mjs prep|compare|latency');
