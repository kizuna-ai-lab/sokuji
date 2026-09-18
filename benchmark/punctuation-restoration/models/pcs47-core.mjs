// PCS-47: 1-800-BAD-CODE/xlm-roberta_punctuation_fullstop_truecase on onnxruntime-web.
// Punctuation, true-casing and sentence boundaries in one xlm-roberta pass (argmax is in the graph).
//
// A faithful port of the upstream `punctuators` pipeline:
//   - windowing: punctuators/data/infer_dataset.py  TextInferenceDataset._tokenize_inputs
//   - decoding:  punctuators/collectors/pcs_collector.py  PunctCapSegResultCollector.produce
// Deviations and the preprocessing choice are documented in models/pcs47.md.
// Pure browser-compatible ESM: every dependency is injected.

export const LOCAL_DIR = '/home/jiangzhuo/.cache/sokuji-punct-bench/pcs47';
export const LANGS = ['ja', 'zh', 'en', 'ko'];
/** punctuators' `infer(overlap=16)` default. */
export const OVERLAP = 16;

const NULL_TOKEN = '<NULL>';
const ACRONYM_TOKEN = '<ACRONYM>';
/** cap_preds is [B, T, 16]: one upper-case bit per character of a subtoken (longest sp piece is 16). */
const CAP_SLOTS = 16;
/** sp.model: <s>=0, <pad>=1, </s>=2, <unk>=3 (the same ids as xlm-roberta-base tokenizer.json). */
const BOS_ID = 0;
const EOS_ID = 2;
const UNK_ID = 3;
const SP_SPACE = '▁';

/**
 * Read `max_length`, `pre_labels` and `post_labels` out of the upstream config.yaml. The file
 * writes each list as a bracketed block of double-quoted strings, which is JSON once the
 * trailing comma goes.
 */
export function parseConfig(yaml) {
  const list = (key) => {
    const m = yaml.match(new RegExp(`^${key}:\\s*\\[([\\s\\S]*?)\\]`, 'm'));
    if (!m) throw new Error(`pcs47: config.yaml has no ${key}`);
    return JSON.parse(`[${m[1].trim().replace(/,$/, '')}]`);
  };
  const max = yaml.match(/^max_length:\s*(\d+)/m);
  if (!max) throw new Error('pcs47: config.yaml has no max_length');
  return { maxLength: Number(max[1]), preLabels: list('pre_labels'), postLabels: list('post_labels') };
}

const isNd = (ch) => /\p{Nd}/u.test(ch);

/**
 * The model card builds its test inputs by lower-casing and removing all punctuation, so that is
 * the input this does: drop every character the model itself predicts (its pre/post label set),
 * except '.' and ',' between two digits ("12.5", "3,000"), lower-case, collapse whitespace.
 * punctuators itself does no preprocessing; parity/pcs47.py applies the same function in Python.
 */
export function preprocess(text, marks) {
  const cps = Array.from(text);
  let out = '';
  for (let i = 0; i < cps.length; i++) {
    const ch = cps[i];
    if (marks.has(ch)) {
      if ((ch === '.' || ch === ',') && i > 0 && i < cps.length - 1 && isNd(cps[i - 1]) && isNd(cps[i + 1])) out += ch;
      continue;
    }
    out += ch;
  }
  return out.toLowerCase().replace(/\s+/gu, ' ').trim();
}

/** Window [start, stop) ranges over `n` token ids, as TextInferenceDataset._tokenize_inputs cuts them. */
export function makeWindows(n, maxLength, overlap = OVERLAP) {
  const width = maxLength - 2; // room for BOS + EOS
  const out = [];
  let start = 0;
  for (let idx = 0; start < n; idx++) {
    const from = start - (idx === 0 ? 0 : overlap);
    const stop = from + width;
    out.push([from, Math.min(stop, n)]);
    start = stop;
  }
  return out;
}

/**
 * PunctCapSegResultCollector.produce over already-stitched token predictions.
 * `pieces[k]` is the sentencepiece string of token k, `pre[k]`/`post[k]` a label or null,
 * `cap` a flat [T*16] bit array, `seg[k]` the full-stop bit. Returns the sentences (one element
 * when `applySbd` is false).
 */
export function decode(pieces, pre, post, cap, seg, applySbd) {
  const out = [];
  let cur = '';
  for (let k = 0; k < pieces.length; k++) {
    const chars = Array.from(pieces[k]);
    const lead = chars[0] === SP_SPACE ? 1 : 0;
    if (lead && cur) cur += ' ';
    // A piece that is only U+2581 has no characters, so its post label and full stop are dropped
    // (upstream behaves the same way).
    for (let j = lead; j < chars.length; j++) {
      let ch = chars[j];
      if (j === lead && pre[k] !== null) cur += pre[k];
      if (j < CAP_SLOTS && cap[k * CAP_SLOTS + j]) ch = ch.toUpperCase();
      cur += ch;
      const last = j === chars.length - 1;
      if (post[k] === ACRONYM_TOKEN) cur += '.';
      else if (last && post[k] !== null) cur += post[k];
      if (applySbd && last && seg[k]) {
        out.push(cur);
        cur = '';
      }
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** Load tokenizer, config and one ONNX graph; the model modules and the parity script share this. */
export async function loadEngine({ ort, Tokenizer, readFile, executionProviders, sessionOptions }, modelFile, { overlap = OVERLAP } = {}) {
  const text = new TextDecoder();
  const cfg = parseConfig(text.decode(await readFile('config.yaml')));
  const marks = new Set([...cfg.preLabels, ...cfg.postLabels].filter((l) => !l.startsWith('<')));
  const tokenizer = new Tokenizer(JSON.parse(text.decode(await readFile('tokenizer.json'))), {});
  const session = await ort.InferenceSession.create(await readFile(modelFile), { executionProviders, ...sessionOptions });

  /** Token ids plus the surface text of each token (the surface is what an <unk> decodes to). */
  const encode = (s) => tokenizer.encode(s, { add_special_tokens: false });

  async function runWindow(ids) {
    const t = ids.length + 2;
    const data = new BigInt64Array(t);
    data[0] = BigInt(BOS_ID);
    for (let i = 0; i < ids.length; i++) data[i + 1] = BigInt(ids[i]);
    data[t - 1] = BigInt(EOS_ID);
    const r = await session.run({ input_ids: new ort.Tensor('int64', data, [1, t]) });
    return { pre: r.pre_preds.data, post: r.post_preds.data, cap: r.cap_preds.data, seg: r.seg_preds.data };
  }

  /** Model predictions for every token of an already-preprocessed string, windows stitched. */
  async function predict(pre) {
    const { ids, tokens } = encode(pre);
    const windows = makeWindows(ids.length, cfg.maxLength, overlap);
    const half = Math.floor(overlap / 2);
    const pieces = [];
    const preL = [];
    const postL = [];
    const cap = [];
    const seg = [];
    for (let w = 0; w < windows.length; w++) {
      const [from, stop] = windows[w];
      const r = await runWindow(ids.slice(from, stop));
      const len = stop - from;
      const keepFrom = w > 0 ? half : 0;
      const keepTo = w < windows.length - 1 ? len - half : len;
      for (let i = keepFrom; i < keepTo; i++) {
        const k = i + 1; // skip BOS
        const id = ids[from + i];
        // Upstream decodes with IdToPiece, which turns an <unk> into the literal "<unk>"; the
        // surface text keeps the input's characters instead.
        pieces.push(id === UNK_ID ? tokens[from + i] : tokenizer.id_to_token(id));
        const p = cfg.preLabels[Number(r.pre[k])];
        const q = cfg.postLabels[Number(r.post[k])];
        preL.push(p === NULL_TOKEN ? null : p);
        postL.push(q === NULL_TOKEN ? null : q);
        for (let c = 0; c < CAP_SLOTS; c++) cap.push(r.cap[k * CAP_SLOTS + c] ? 1 : 0);
        seg.push(r.seg[k] ? 1 : 0);
      }
    }
    return { ids, pieces, pre: preL, post: postL, cap, seg, windows: windows.length };
  }

  return {
    cfg,
    encode,
    preprocess: (s) => preprocess(s, marks),
    runWindow,
    /** Preprocess + predict + decode. Returns `{ text, sentences }`. */
    async run(input) {
      const pre = preprocess(input, marks);
      if (!pre) return { text: '', sentences: [] };
      const p = await predict(pre);
      return {
        text: decode(p.pieces, p.pre, p.post, p.cap, p.seg, false)[0] ?? '',
        sentences: decode(p.pieces, p.pre, p.post, p.cap, p.seg, true),
      };
    },
    release: () => session.release(),
  };
}

/** Build a model module (`info` + `create`) over one graph file and one output mode. */
export function definePcs47({ id, name, modelFile, output }) {
  const info = {
    id,
    name,
    langs: LANGS,
    output,
    localDir: LOCAL_DIR,
    files: [modelFile, 'tokenizer.json', 'config.yaml'],
  };
  async function create(deps) {
    const engine = await loadEngine(deps, modelFile);
    return {
      async punctuate(text, lang) {
        if (!LANGS.includes(lang)) throw new Error(`${id}: unsupported language "${lang}"`);
        const r = await engine.run(text);
        return output === 'boundary' ? r.sentences.join('\n') : r.text;
      },
      release: () => engine.release(),
    };
  }
  return { info, create };
}
