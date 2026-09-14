// koen_punctuation: whooray/koen_punctuation (gte-multilingual-mlm-base fine-tune, Korean + English)
// on onnxruntime-web. One token-classification pass; each subtoken gets one of 5 labels
// (none , . ? !) and a word takes the label of its last subtoken.
//
// A port of the inference code the model card points to:
//   spokentxt-punctuation-restoration 0.1.1, spokentxt_punctuation_restoration/punctuation.py
//   PunctuationModel.predict
// Deviations (windowing, <unk>, keeping the input's own characters) are documented in models/koen-punct.md.
// Pure browser-compatible ESM: every dependency is injected.

export const LOCAL_DIR = '/home/jiangzhuo/.cache/sokuji-punct-bench/ko/koen_punctuation';
export const LANGS = ['ko', 'en'];
/** LABEL_0..LABEL_4 -> mark, the `punctuation_map` of punctuation.py. */
export const PUNCT = ['', ',', '.', '?', '!'];
/** Content tokens per window (512 with <s> and </s>). Upstream runs the whole text in one pass. */
export const WINDOW = 510;
/** Tokens shared by neighbouring windows; each side keeps the half nearest its own centre. */
export const OVERLAP = 32;

const BOS_ID = 0;
const EOS_ID = 2;
const UNK_ID = 3;
/** `tokenizer.all_special_tokens`: <s> <pad> </s> <unk> <mask>. predict() skips these tokens entirely. */
const SPECIAL_IDS = new Set([0, 1, 2, UNK_ID, 250001]);
const SP_SPACE = '▁';
const NUM_LABELS = PUNCT.length;
/** How far past a mismatch the character mapper looks for the token's text before giving up. */
const RESYNC_LOOKAHEAD = 16;

const isSpace = (ch) => /\s/u.test(ch);

/** Window [start, stop) ranges over `n` content ids. */
export function makeWindows(n, width = WINDOW, overlap = OVERLAP) {
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
 * The word grouping of PunctuationModel.predict over content tokens (no <s>/</s>).
 * A word starts at a token beginning with U+2581; special tokens (<unk> in practice) neither start a
 * word nor change its label, but stay in the group so their characters can be located. `word` is the
 * text upstream accumulates (non-special pieces, first U+2581 dropped); `mark` is the label of the
 * last non-special token. Upstream drops a group whose `word` is empty (with its mark).
 */
export function groupWords(ids, tokens, labels) {
  const groups = [];
  let cur = null;
  for (let k = 0; k < ids.length; k++) {
    if (SPECIAL_IDS.has(ids[k])) {
      if (!cur) {
        cur = { first: k, last: k, word: '', mark: '' };
        groups.push(cur);
      }
      cur.last = k;
      continue;
    }
    const piece = tokens[k];
    if (!cur || piece.startsWith(SP_SPACE)) {
      cur = { first: k, last: k, word: piece.startsWith(SP_SPACE) ? piece.slice(1) : piece, mark: '' };
      groups.push(cur);
    } else {
      cur.word += piece;
      cur.last = k;
    }
    cur.mark = PUNCT[labels[k]];
  }
  return groups;
}

/**
 * Put each group's mark after the original character that ends the group, keeping the input's own
 * characters (upstream returns the tokenizer's normalized pieces instead: ＡＢＣ -> ABC, and drops
 * <unk> words). Whitespace runs collapse to one space and the ends are trimmed, as upstream's
 * `" ".join(word_groups)` does. Returns the text and how many tokens could not be located.
 */
export function render(text, tokens, groups, normalize) {
  const cps = Array.from(text);
  const stream = [];
  for (let i = 0; i < cps.length; i++) {
    for (const ch of Array.from(normalize(cps[i]))) if (!isSpace(ch)) stream.push({ ch, i });
  }
  let p = 0;
  let mismatches = 0;
  const matchesAt = (q, chars) => chars.every((ch, j) => q + j < stream.length && stream[q + j].ch === ch);
  const consume = (chars) => {
    if (chars.length === 0) return false;
    let q = p;
    while (q <= p + RESYNC_LOOKAHEAD && !matchesAt(q, chars)) q++;
    if (q > p + RESYNC_LOOKAHEAD) {
      mismatches++;
      q = p;
    }
    p = Math.min(q + chars.length, stream.length);
    return p > 0;
  };
  const after = new Map();
  for (const g of groups) {
    let consumed = false;
    for (let k = g.first; k <= g.last; k++) {
      let piece = tokens[k];
      while (piece.startsWith(SP_SPACE)) piece = piece.slice(SP_SPACE.length);
      if (consume(Array.from(piece))) consumed = true;
    }
    // Upstream: `if current_word[-1] == current_punct` the mark is not repeated.
    if (!consumed || !g.word || !g.mark || g.word.at(-1) === g.mark) continue;
    const at = stream[p - 1].i;
    after.set(at, (after.get(at) ?? '') + g.mark);
  }
  let out = '';
  let pendingSpace = false;
  for (let i = 0; i < cps.length; i++) {
    if (isSpace(cps[i])) {
      pendingSpace = out.length > 0;
      continue;
    }
    if (pendingSpace) out += ' ';
    pendingSpace = false;
    out += cps[i];
    if (after.has(i)) out += after.get(i);
  }
  return { text: out, mismatches };
}

/** Load tokenizer and one ONNX graph; the model modules and the parity script share this. */
export async function loadEngine({ ort, Tokenizer, readFile, executionProviders, sessionOptions }, modelFile, { window = WINDOW, overlap = OVERLAP } = {}) {
  const tokenizer = new Tokenizer(JSON.parse(new TextDecoder().decode(await readFile('tokenizer.json'))), {});
  const session = await ort.InferenceSession.create(await readFile(modelFile), { executionProviders, ...sessionOptions });
  const normalize = tokenizer.normalizer ? (s) => tokenizer.normalizer(s) : (s) => s.normalize('NFKC');

  /** Content ids and their token strings (an <unk> comes back as the characters it covers). */
  const encode = (s, addSpecial = false) => tokenizer.encode(s, { add_special_tokens: addSpecial });

  /** Argmax label of every position of <s> ids </s> (length ids.length + 2). */
  async function runWindow(ids) {
    const t = ids.length + 2;
    const data = new BigInt64Array(t);
    data[0] = BigInt(BOS_ID);
    for (let i = 0; i < ids.length; i++) data[i + 1] = BigInt(ids[i]);
    data[t - 1] = BigInt(EOS_ID);
    const mask = new BigInt64Array(t).fill(1n);
    const r = await session.run({
      input_ids: new ort.Tensor('int64', data, [1, t]),
      attention_mask: new ort.Tensor('int64', mask, [1, t]),
    });
    const logits = r.logits.data;
    const labels = new Array(t);
    for (let i = 0; i < t; i++) {
      let best = 0;
      for (let c = 1; c < NUM_LABELS; c++) if (logits[i * NUM_LABELS + c] > logits[i * NUM_LABELS + best]) best = c;
      labels[i] = best;
    }
    return labels;
  }

  /** Labels for every content token of `text`, windows stitched. */
  async function predict(text) {
    const { ids, tokens } = encode(text);
    const windows = makeWindows(ids.length, window, overlap);
    const half = Math.floor(overlap / 2);
    const labels = [];
    for (let w = 0; w < windows.length; w++) {
      const [from, stop] = windows[w];
      const r = await runWindow(ids.slice(from, stop));
      const len = stop - from;
      const keepFrom = w > 0 ? half : 0;
      const keepTo = w < windows.length - 1 ? len - half : len;
      for (let i = keepFrom; i < keepTo; i++) labels.push(r[i + 1]);
    }
    return { ids, tokens, labels, windows: windows.length };
  }

  return {
    encode,
    runWindow,
    predict,
    /** predict + group + render. Returns `{ text, mismatches, windows }`. */
    async run(text) {
      const p = await predict(text);
      if (p.ids.length === 0) return { text: '', mismatches: 0, windows: 0 };
      const groups = groupWords(p.ids, p.tokens, p.labels);
      return { ...render(text, p.tokens, groups, normalize), windows: p.windows };
    },
    release: () => session.release(),
  };
}

/** Build a model module (`info` + `create`) over one graph file. */
export function defineKoen({ id, name, modelFile }) {
  const info = { id, name, langs: LANGS, output: 'punct', localDir: LOCAL_DIR, files: [modelFile, 'tokenizer.json'] };
  async function create(deps) {
    const engine = await loadEngine(deps, modelFile);
    return {
      async punctuate(text, lang) {
        if (!LANGS.includes(lang)) throw new Error(`${id}: unsupported language "${lang}"`);
        return (await engine.run(text)).text;
      },
      release: () => engine.release(),
    };
  }
  return { info, create };
}
