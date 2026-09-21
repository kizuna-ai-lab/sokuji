// Edge-Punct-Casing (CNN-BiLSTM, English punctuation + casing), sherpa-onnx
// online-punct-en-2024-08-06 int8. A port of sherpa-onnx
// csrc/online-punctuation-cnn-bilstm-impl.h (1.13.8) and of the unigram encoder it
// uses, ssentencepiece::Ssentencepiece from simple-sentencepiece v0.7 (the tag
// sherpa-onnx's cmake pins). See edge-punct-en.md for the deviations.

export const info = {
  id: 'edge-punct-en',
  name: 'Edge-Punct-Casing CNN-BiLSTM en int8 (sherpa-onnx 2024-08-06)',
  langs: ['en'],
  output: 'punct',
  localDir: '/home/jiangzhuo/.cache/sokuji-punct-bench/sherpa/sherpa-onnx-online-punct-en-2024-08-06',
  files: ['model.int8.onnx', 'bpe.vocab'],
};

const MAX_SEQ_LEN = 200; // kMaxSeqLen
const BOS = 1; // <s>, hard-coded upstream
const EOS = 2; // </s>
const PUNCT_SUFFIX = ['', ',', '.', '?']; // NO_PUNCT, COMMA, PERIOD, QUESTION
const CASE_UPPER = 1;
const CASE_CAP = 2; // LOWER = 0 and MIX_CASE = 3 leave the word as written

// std::istream >> word and std::stringstream split on the classic-locale ASCII whitespace only.
const splitWords = (text) => text.split(/[ \t\n\v\f\r]+/).filter(Boolean);
const upperAscii = (w) => w.replace(/[a-z]/g, (c) => c.toUpperCase());
const lowerAscii = (w) => w.replace(/[A-Z]/g, (c) => c.toLowerCase());

/** Words as `punctuate` outputs them: a trailing run of the predicted marks , . ? removed, empty words dropped. */
export const moduleWords = (text) => splitWords(text).map((w) => w.replace(/[.,?]+$/, '')).filter(Boolean);
/** The text `punctuate` hands the model: those words, lowercased (parity scripts feed it to the reference). */
export const preprocessText = (text) => moduleWords(text).map(lowerAscii).join(' ');

/**
 * ssentencepiece v0.7: a byte-level prefix trie over every vocab line, a Viterbi
 * pass from the end over float32 scores, and one <unk> per byte no piece covers.
 * Two of its quirks are kept on purpose because the model was run behind them:
 * an uncovered position scores 0 (better than any real piece), and on a score tie
 * the shortest piece wins.
 */
export class UnigramEncoder {
  constructor(vocabText) {
    const lines = vocabText.split('\n');
    if (lines[lines.length - 1] === '') lines.pop();
    this.scores = new Float32Array(lines.length);
    this.root = { next: new Map(), id: -1 };
    this.unkId = 0;
    this.bytesOffset = -1;
    const enc = new TextEncoder();
    lines.forEach((line, id) => {
      const f = line.split(/[ \t\n\v\f\r]+/).filter(Boolean);
      if (f.length < 2 || Number.isNaN(parseFloat(f[1]))) throw new Error(`bpe.vocab line ${id + 1}: expected "piece score"`);
      const [piece, score] = f;
      if (piece === '<0x00>') this.bytesOffset = id;
      if (piece === '<unk>') this.unkId = id;
      this.scores[id] = parseFloat(score);
      let node = this.root;
      for (const b of enc.encode(piece)) {
        let child = node.next.get(b);
        if (!child) node.next.set(b, (child = { next: new Map(), id: -1 }));
        node = child;
      }
      node.id = id;
    });
    this.enc = enc;
  }

  /** Piece ids for one whitespace-free word (upstream prefixes "▁"). */
  encodeWord(word) {
    const bytes = this.enc.encode(`▁${word}`);
    const n = bytes.length;
    const score = new Float32Array(n + 1);
    const next = new Int32Array(n + 1);
    const piece = new Int32Array(n + 1);
    for (let i = n - 1; i >= 0; i--) {
      let maxScore = -Infinity;
      let maxIdx = -1;
      let index = 0;
      let node = this.root;
      // Darts' commonPrefixSearch reads a NUL-terminated key.
      for (let j = i; j < n && bytes[j] !== 0; j++) {
        node = node.next.get(bytes[j]);
        if (!node) break;
        if (node.id < 0) continue;
        const end = j + 1;
        const s = Math.fround(this.scores[node.id] + score[end]);
        if (s > maxScore || (s === maxScore && maxIdx >= end)) {
          maxScore = s;
          maxIdx = end;
          index = node.id;
        }
      }
      score[i] = maxScore === -Infinity ? 0 : maxScore;
      next[i] = maxIdx;
      piece[i] = index;
    }
    const ids = [];
    for (let i = 0; i < n;) {
      if (next[i] === -1) {
        ids.push(this.bytesOffset >= 0 ? bytes[i] + this.bytesOffset : this.unkId);
        i += 1;
      } else {
        ids.push(piece[i]);
        i = next[i];
      }
    }
    return ids;
  }
}

/**
 * EncodeSentences: <s> w1 w2 ... </s> rows of 200 ids, zero-padded; only a word's
 * first piece (and <s>, </s>) is valid; a word that would push the row past 199
 * starts a new row. `clamp` caps one word at 198 pieces so every row fits; upstream
 * has no cap, builds a longer row and silently misaligns the batch (see below).
 */
export function encodeSentences(encoder, words, clamp) {
  const rows = [];
  const labelLens = [];
  let tokens = [BOS];
  let valids = [1];
  const flush = () => {
    tokens.push(EOS);
    valids.push(1);
    labelLens.push(valids.reduce((a, v) => a + (v === 1 ? 1 : 0), 0));
    rows.push({ tokens, valids });
    tokens = [BOS];
    valids = [1];
  };
  for (const w of words) {
    let pieces = encoder.encodeWord(w);
    if (clamp && pieces.length > MAX_SEQ_LEN - 2) pieces = pieces.slice(0, MAX_SEQ_LEN - 2);
    if (tokens.length + pieces.length > MAX_SEQ_LEN - 1) flush();
    tokens.push(...pieces);
    valids.push(1);
    for (let k = 1; k < pieces.length; k++) valids.push(0);
  }
  flush();
  const n = rows.length;
  // Upstream appends every row to one flat buffer, padding a short row to 200 but
  // never cutting a long one, and wraps the buffer as [n, 200]; ORT reads its first
  // n*200 values. A row longer than 200 (possible only without `clamp`) therefore
  // shifts every later row. Reproduced as is.
  const flatLen = rows.reduce((a, r) => a + Math.max(r.tokens.length, MAX_SEQ_LEN), 0);
  const tokenFlat = new Int32Array(flatLen);
  const validFlat = new Int32Array(flatLen);
  let off = 0;
  for (const r of rows) {
    tokenFlat.set(r.tokens, off);
    validFlat.set(r.valids, off);
    off += Math.max(r.tokens.length, MAX_SEQ_LEN);
  }
  return { n, tokenIds: tokenFlat.slice(0, n * MAX_SEQ_LEN), validIds: validFlat.slice(0, n * MAX_SEQ_LEN), labelLens: Int32Array.from(labelLens) };
}

function argmaxRows(t) {
  const [rows, c] = t.dims;
  const d = t.data;
  const out = new Int32Array(rows);
  for (let r = 0; r < rows; r++) {
    let best = 0;
    for (let j = 1; j < c; j++) if (d[r * c + j] > d[r * c + best]) best = j;
    out[r] = best;
  }
  return out;
}

/** DecodeSentences: UPPER uppercases the word, CAP its first byte; ASCII only, as std::toupper does. */
function decodeWord(word, casePred, punctPred) {
  let w = word;
  if (casePred === CASE_UPPER) w = upperAscii(w);
  else if (casePred === CASE_CAP) w = upperAscii(w.slice(0, 1)) + w.slice(1);
  return w + (PUNCT_SUFFIX[punctPred] ?? '');
}

export async function create({ ort, readFile, executionProviders, sessionOptions }) {
  const [modelBytes, vocabBytes] = await Promise.all([readFile('model.int8.onnx'), readFile('bpe.vocab')]);
  const session = await ort.InferenceSession.create(modelBytes, { executionProviders, ...sessionOptions });
  const encoder = new UnigramEncoder(new TextDecoder().decode(vocabBytes));

  /** Case and punctuation class per entry of `encWords`, from one batched run as upstream does. */
  async function predict(encWords, clamp) {
    const enc = encodeSentences(encoder, encWords, clamp);
    // All rows go in one batch: the int8 graph quantizes activations per tensor,
    // so splitting the batch would change the numbers.
    const out = await session.run({
      token_ids: new ort.Tensor('int32', enc.tokenIds, [enc.n, MAX_SEQ_LEN]),
      valid_ids: new ort.Tensor('int32', enc.validIds, [enc.n, MAX_SEQ_LEN]),
      label_lens: new ort.Tensor('int32', enc.labelLens, [enc.n]),
    });
    return { casePred: argmaxRows(out.active_case_logits), punctPred: argmaxRows(out.active_punct_logits), enc };
  }

  return {
    /**
     * Module path: a trailing run of , . ? on a word is removed (the model predicts
     * those marks and never saw them in its input), the encoder sees the word
     * lowercased (the vocab has no uppercase piece, so a capital would be <unk>), and
     * the output keeps the word as written apart from the predicted UPPER / CAP.
     */
    async punctuate(text, lang) {
      if (!info.langs.includes(lang)) throw new Error(`edge-punct-en: unsupported language ${lang}`);
      const words = splitWords(text).map((w) => w.replace(/[.,?]+$/, '')).filter(Boolean);
      if (words.length === 0) return '';
      const { casePred, punctPred } = await predict(words.map(lowerAscii), true);
      return words.map((w, i) => decodeWord(w, casePred[i] ?? 0, punctPred[i] ?? 0)).join(' ');
    },
    /** The text `punctuate` hands the model, for the parity script. */
    preprocess: (text) => splitWords(text).map((w) => lowerAscii(w.replace(/[.,?]+$/, ''))).filter(Boolean).join(' '),
    /** sherpa-onnx OnlinePunctuation.add_punctuation_with_case, unmodified (parity only). */
    async punctuateUpstream(text) {
      if (text.length === 0) return '';
      const words = splitWords(text);
      const { casePred, punctPred } = await predict(words, false);
      return words.map((w, i) => decodeWord(w, casePred[i] ?? 0, punctPred[i] ?? 0)).join(' ');
    },
    encoder,
    async release() {
      await session.release();
    },
  };
}
