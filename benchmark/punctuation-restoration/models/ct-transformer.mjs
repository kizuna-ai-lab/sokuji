// CT-Transformer punctuation (FunASR punc_ct-transformer_zh-cn-common-vocab272727,
// sherpa-onnx int8 export). A port of sherpa-onnx
// csrc/offline-punctuation-ct-transformer-impl.h (1.13.8) plus the SplitUtf8 /
// MergeCharactersIntoWords / ToLowerCase helpers in csrc/text-utils.cc.
// See ct-transformer.md for the deviations and their reasons.

export const info = {
  id: 'ct-transformer',
  name: 'CT-Transformer zh-en vocab272727 int8 (sherpa-onnx 2024-04-12)',
  langs: ['zh', 'en'],
  output: 'punct',
  localDir: '/home/jiangzhuo/.cache/sokuji-punct-bench/sherpa/sherpa-onnx-punct-ct-transformer-zh-en-vocab272727-2024-04-12-int8',
  files: ['model.int8.onnx', 'tokens.json'],
};

// Upstream constants (sherpa-onnx impl: segment_size, max_len).
const SEGMENT_SIZE = 20;
const MAX_LEN = 200;

// The model's `punctuations` metadata, in class order. onnxruntime-web does not
// expose custom metadata, so it is fixed here; config.yaml carries the same list.
const PUNCT = ['<unk>', '_', '，', '。', '？', '、'];
const UNK_CLASS = 0;
const UNDERLINE = 1;
const COMMA = 2;
const DOT = 3;
const QUEST = 4;

// Two-byte letters that MergeCharactersIntoWords keeps inside a word (IsSpecial:
// German umlauts, Spanish and French diacritics). Every other two-byte character
// is a token of its own.
const SPECIAL_2BYTE = new Set('äöüÄÖÜßáéíóúñÁÉÍÓÚÑàèùçâêîôûëïÀÈÙÇÂÊÎÔÛËÏ');

const utf8Len = (cp) => (cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4);
// std::ispunct / std::isspace on one ASCII byte; the apostrophe stays inside words.
const isCPunct = (c) => c !== 0x27 && ((c >= 0x21 && c <= 0x2f) || (c >= 0x3a && c <= 0x40) || (c >= 0x5b && c <= 0x60) || (c >= 0x7b && c <= 0x7e));
const isCSpace = (c) => c === 0x20 || (c >= 0x09 && c <= 0x0d);

/**
 * sherpa's SplitUtf8 + MergeCharactersIntoWords: every character of three or more
 * UTF-8 bytes (CJK, kana, Hangul, emoji, fullwidth forms) and every non-special
 * two-byte character is one token; runs of ASCII letters/digits (plus the special
 * two-byte letters) form one word; ASCII punctuation other than the apostrophe is
 * one token; ASCII whitespace separates and is dropped.
 */
export function splitTokens(text) {
  const out = [];
  let word = '';
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    const n = utf8Len(cp);
    const space = n === 1 && isCSpace(cp);
    if (n >= 3 || (n === 2 && !SPECIAL_2BYTE.has(ch)) || (n === 1 && (isCPunct(cp) || space))) {
      if (word) {
        out.push(word);
        word = '';
      }
      if (!space) out.push(ch);
    } else {
      word += ch;
    }
  }
  if (word) out.push(word);
  return out;
}

// sherpa's ToLowerCase goes through std::towlower, which lowercases every script in
// a UTF-8 locale (the Python binding runs under one). A mapping that would expand
// to several code points keeps the original, as towlower does.
function lowerToken(t) {
  if (/^[\x00-\x7f]*$/.test(t)) return t.toLowerCase();
  let s = '';
  for (const ch of t) {
    const l = ch.toLowerCase();
    s += l.length === ch.length ? l : ch;
  }
  return s;
}

/**
 * Marks the model predicts. The model was trained on text with them removed, so
 * the module strips any the ASR already wrote and predicts them again. A dot
 * between two digits is a decimal point and stays. Each mark becomes a space so
 * "hello,world" still splits into two words.
 */
export function stripPredictedMarks(text) {
  const cps = Array.from(text);
  const digit = (ch) => ch !== undefined && ch >= '0' && ch <= '9';
  let out = '';
  for (let i = 0; i < cps.length; i++) {
    const ch = cps[i];
    if (ch === '，' || ch === '。' || ch === '？' || ch === '、' || ch === ',' || ch === '?') out += ' ';
    else if (ch === '.' && !(digit(cps[i - 1]) && digit(cps[i + 1]))) out += ' ';
    else out += ch;
  }
  return out;
}

export async function create({ ort, readFile, executionProviders, sessionOptions }) {
  const [modelBytes, tokenBytes] = await Promise.all([readFile('model.int8.onnx'), readFile('tokens.json')]);
  const session = await ort.InferenceSession.create(modelBytes, { executionProviders, ...sessionOptions });
  const tokens = JSON.parse(new TextDecoder().decode(tokenBytes));
  const token2id = new Map();
  for (let i = 0; i < tokens.length; i++) token2id.set(tokens[i], i);
  const unkId = token2id.get('<unk>');

  function tokenize(text) {
    const words = splitTokens(text);
    const ids = Int32Array.from(words, (w) => token2id.get(lowerToken(w)) ?? unkId);
    return { words, ids };
  }

  async function logits(ids) {
    const out = await session.run({
      inputs: new ort.Tensor('int32', ids, [1, ids.length]),
      text_lengths: new ort.Tensor('int32', Int32Array.from([ids.length]), [1]),
    });
    return out.logits;
  }

  // std::max_element: the first of equal maxima wins.
  function argmax(l) {
    const [, t, c] = l.dims;
    const d = l.data;
    const res = new Int32Array(t);
    for (let k = 0; k < t; k++) {
      let best = 0;
      for (let j = 1; j < c; j++) if (d[k * c + j] > d[k * c + best]) best = j;
      res[k] = best;
    }
    return res;
  }

  /**
   * `exact` reproduces sherpa-onnx byte for byte, including its two failure modes:
   * a sentence end found inside the last window drops every token after it, and a
   * whitespace-only input runs the model on zero tokens and throws. The module path
   * (exact = false) keeps the whole last window and returns token-less input as is.
   */
  async function run(text, exact, trace) {
    if (text.length === 0) return '';
    const { words, ids } = tokenize(text);
    const n = ids.length;
    if (n === 0 && !exact) return text;

    // Upstream computes ceil((n + 19) / 20) rather than ceil(n / 20): one window
    // more than needed, which the carry-over below absorbs.
    const numSegments = Math.ceil((n + SEGMENT_SIZE - 1) / SEGMENT_SIZE);
    const punct = [];
    let last = -1;
    for (let i = 0; i < numSegments; i++) {
      let start = i * SEGMENT_SIZE;
      const end = Math.min(start + SEGMENT_SIZE, n);
      if (last !== -1) start = last;
      const l = await logits(ids.subarray(start, end));
      const cls = argmax(l);
      const len = end - start;

      // The last 。/？ in the window, never its first or last position.
      let dot = -1;
      let comma = -1;
      for (let m = len - 2; m >= 1; m--) {
        if (cls[m] === DOT || cls[m] === QUEST) {
          dot = m;
          break;
        }
        if (comma === -1 && cls[m] === COMMA) comma = m;
      }
      if (dot === -1 && len >= MAX_LEN && comma !== -1) {
        dot = comma;
        cls[dot] = DOT;
      }

      const final = i === numSegments - 1;
      if (dot === -1) {
        if (last === -1) last = start;
        if (final) dot = len - 1;
      } else {
        last = start + dot + 1;
        if (final && !exact) dot = len - 1;
      }
      if (dot !== -1) for (let k = 0; k <= dot; k++) punct.push(cls[k]);
      if (trace) trace.push({ start, ids: Array.from(ids.subarray(start, end)), logits: Array.from(l.data), committed: dot + 1 });
    }

    if (punct.length === 0) return text + PUNCT[DOT];
    const parts = [];
    for (let i = 0; i < punct.length && i < words.length; i++) {
      const w = words[i];
      if (i > 0 && parts[parts.length - 1].charCodeAt(0) < 0x80 && w.charCodeAt(0) < 0x80) parts.push(' ');
      parts.push(w);
      // Class 0 is the literal "<unk>"; upstream would print it, the module prints nothing.
      if (punct[i] !== UNDERLINE && (exact || punct[i] !== UNK_CLASS)) parts.push(PUNCT[punct[i]]);
    }
    const tail = parts[parts.length - 1];
    if (tail === PUNCT[COMMA] || tail === '、') parts[parts.length - 1] = PUNCT[DOT];
    const end = parts[parts.length - 1];
    if (end !== PUNCT[DOT] && end !== PUNCT[QUEST]) parts.push(PUNCT[DOT]);
    return parts.join('');
  }

  return {
    async punctuate(text, lang) {
      if (!info.langs.includes(lang)) throw new Error(`ct-transformer: unsupported language ${lang}`);
      return run(stripPredictedMarks(text), false);
    },
    /**
     * sherpa-onnx OfflinePunctuation.add_punctuation, unmodified (parity only).
     * `trace`, if given, receives every window's start, ids, logits and how many of
     * its positions were committed to the output.
     */
    punctuateUpstream: (text, trace) => run(text, true, trace),
    tokenize,
    logits,
    async release() {
      await session.release();
    },
  };
}
