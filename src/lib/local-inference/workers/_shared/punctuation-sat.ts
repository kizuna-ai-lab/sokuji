/**
 * SaT sat-3l-sm (wtpsplit "Segment any Text", 3-layer XLM-RoBERTa, "sm" variant): boundary-only
 * sentence segmentation for every language other than Chinese and English, which route to
 * FireRedPunc and Edge-Punct-Casing instead (see punctuation-fireredpunc.ts and
 * punctuation-edge-punct-en.ts). Runs the weight-only 8-bit + 8-bit-embedding q8w-gather build
 * (`sat-3l-sm-q8w-gather` — see its wrapper `sat-3l-sm-q8w-gather.mjs` and
 * `models/sat-3l-sm.md` "q8w build"): no tensor in that graph is float16, so it needs no
 * shader-f16 and runs on WebGPU where the published fp16 file cannot.
 *
 * A faithful port of `benchmark/punctuation-restoration/models/sat-3l-sm.mjs`, itself a port of
 * wtpsplit 2.2.1 `SaT.split(text)` with default arguments:
 *  - tokenize with xlm-roberta-base, no special tokens; each token's logit lands on the character
 *    at its offset end - 1 (every other character gets -inf, i.e. probability 0)
 *  - windows of min(512, n) subwords capped at 510 (+ <s>/</s>), stride 64, the last window
 *    right-aligned; windows run in batches of 32; overlapping logits are averaged uniformly
 *  - the averaging is done in float16, exactly as wtpsplit's numpy buffers do it, so decisions
 *    match the Python reference bit for bit rather than to within rounding
 *  - sigmoid in float32, boundary where p > 0.25 (wtpsplit's default threshold for model names
 *    with "sm")
 *  - a boundary after character i also swallows the whitespace that follows it; input newlines
 *    are always boundaries (split_on_input_newlines=True)
 *
 * @huggingface/tokenizers returns no offsets, so the Rust tokenizer's offset mapping is rebuilt
 * from the library's own normalizer and Unigram model: normalize grapheme by grapheme while
 * recording where each normalized character came from, split on whitespace, prefix U+2581, and
 * walk the pieces the model returns (every piece, <unk> included, is a literal slice of its word).
 *
 * SaT predicts boundaries, not marks, so `run` below is new code, not part of the port: it
 * writes one terminal per predicted cut -- chosen by script so a Japanese bubble does not end in
 * a Latin period -- and never after the last segment, since the utterance's own end supplies
 * that mark and SentenceStream never trusts one at the very end of a tail anyway.
 */
import type { PunctuationAdapter, PunctuationAdapterDeps } from './punctuation-core';

export const SAT_DEFAULTS = { threshold: 0.25, blockSize: 512, stride: 64, batchSize: 32 };

const CLS_ID = 0;
const SEP_ID = 2;
const MAX_SUBWORDS = 510; // 512 positions minus <s> and </s>
const METASPACE = String.fromCharCode(0x2581);

// Python str.isspace(), which wtpsplit uses to extend a sentence over trailing whitespace.
const PY_SPACE = new Set([
  0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x1c, 0x1d, 0x1e, 0x1f, 0x20, 0x85, 0xa0, 0x1680,
  0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a,
  0x2028, 0x2029, 0x202f, 0x205f, 0x3000,
]);
const isPySpace = (ch: string): boolean => PY_SPACE.has(ch.codePointAt(0) ?? -1);

// ---- float16 emulation -------------------------------------------------------------------

const f32 = Math.fround;

function roundHalfEven(q: number): number {
  const fl = Math.floor(q);
  const d = q - fl;
  if (d > 0.5) return fl + 1;
  if (d < 0.5) return fl;
  return fl % 2 === 0 ? fl : fl + 1;
}

// TS's ES2020 lib has no declaration for the (Stage 4, not yet in lib.d.ts) Math.f16round, so
// the runtime probe below is read through an untyped alias rather than widening the lib target.
const mathF16round = (Math as unknown as { f16round?: (x: number) => number }).f16round;

/** Round a double to the nearest IEEE float16 value (ties to even), as numpy's half casts do. */
export const f16round: (x: number) => number = typeof mathF16round === 'function' ? mathF16round : (x: number) => {
  if (!Number.isFinite(x) || x === 0) return x;
  const a = Math.abs(x);
  if (a >= 65520) return x > 0 ? Infinity : -Infinity;
  let e = Math.floor(Math.log2(a));
  if (2 ** e > a) e--;
  else if (2 ** (e + 1) <= a) e++;
  const quantum = 2 ** (Math.max(e, -14) - 10);
  const r = roundHalfEven(a / quantum) * quantum;
  return x > 0 ? r : -r;
};

function f16decode(h: number): number {
  const sign = h & 0x8000 ? -1 : 1;
  const e = (h >> 10) & 0x1f;
  const f = h & 0x3ff;
  if (e === 0) return sign * f * 2 ** -24;
  if (e === 31) return f ? NaN : sign * Infinity;
  return sign * (1 + f / 1024) * 2 ** (e - 15);
}

/** Logits tensor data as plain numbers, whatever the output dtype and Float16Array support. */
function logitsToNumbers(tensor: { type: string; data: ArrayLike<number> }): ArrayLike<number> {
  const d = tensor.data;
  if (tensor.type === 'float16' && d instanceof Uint16Array) {
    const out = new Float64Array(d.length);
    for (let i = 0; i < d.length; i++) out[i] = f16decode(d[i]);
    return out;
  }
  return d;
}

// ---- tokenization with offsets -----------------------------------------------------------

// Intl.Segmenter's type declarations are not in this project's ES2020 lib target --
// splitSentences.ts hits the identical gap already, in the pre-existing baseline. Declared
// locally, through an untyped alias, rather than widening the lib target.
interface GraphemeSegment { segment: string }
interface GraphemeSegmenterLike { segment(text: string): Iterable<GraphemeSegment> }
const intlSegmenterCtor = (Intl as unknown as {
  Segmenter?: new (locale: string, opts: { granularity: string }) => GraphemeSegmenterLike;
}).Segmenter;
const graphemeSegmenter: GraphemeSegmenterLike | null = typeof intlSegmenterCtor === 'function'
  ? new intlSegmenterCtor('und', { granularity: 'grapheme' })
  : null;

function utf8Length(codePoints: string[]): number {
  let n = 0;
  for (const ch of codePoints) {
    const c = ch.codePointAt(0) ?? 0;
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
  }
  return n;
}

function graphemes(text: string): string[] {
  if (graphemeSegmenter) return Array.from(graphemeSegmenter.segment(text), (s) => s.segment);
  return text.match(/\P{M}\p{M}*|\p{M}+/gsu) ?? [];
}

interface TokenizeWithEndsResult {
  ids: number[];
  ends: number[];
  length: number;
}

/**
 * Token ids plus, for each token, the code-point index of the last input character it covers
 * (the Rust tokenizer's offset end - 1).
 */
export function tokenizeWithEnds(tokenizer: any, text: string): TokenizeWithEndsResult {
  const normalize: (s: string) => string = tokenizer.normalizer ? (s: string) => tokenizer.normalizer(s) : (s: string) => s;
  const unkId = tokenizer.model.unk_token_id;

  // Normalized code points, each with the end of the original code point it is aligned to.
  // Mirrors the Rust Precompiled normalizer: a grapheme shorter than 6 UTF-8 bytes is normalized
  // as a whole, a longer one code point by code point (so half-width kana + voiced mark, 6 bytes,
  // is not composed, and each emoji of a ZWJ sequence keeps its own offset). Within a piece of m
  // code points, normalized character k aligns to original code point min(k, m - 1): a
  // composition lands on the first original character, an expansion repeats the last one.
  const normChars: string[] = [];
  const origEnd: number[] = [];
  let cp = 0;
  for (const g of graphemes(text)) {
    const gChars = Array.from(g);
    const pieces = utf8Length(gChars) < 6 ? [gChars] : gChars.map((c) => [c]);
    for (const piece of pieces) {
      let k = 0;
      for (const ch of normalize(piece.join(''))) {
        normChars.push(ch);
        origEnd.push(cp + Math.min(k, piece.length - 1) + 1);
        k++;
      }
      cp += piece.length;
    }
  }

  const ids: number[] = [];
  const ends: number[] = [];
  let i = 0;
  while (i < normChars.length) {
    if (/\s/u.test(normChars[i])) { i++; continue; }
    let j = i;
    while (j < normChars.length && !/\s/u.test(normChars[j])) j++;
    const pieces: string[] = tokenizer.model([METASPACE + normChars.slice(i, j).join('')]);
    // Positions count within the prefixed word: 0 is the prefix, k >= 1 is the word's
    // character k - 1. The prefix is aligned to the word's first character, as the Rust
    // Metaspace pre-tokenizer does.
    let pos = 0;
    for (const piece of pieces) {
      pos += Array.from(piece).length;
      ids.push(tokenizer.model.tokens_to_ids.get(piece) ?? unkId);
      ends.push(origEnd[i + Math.max(pos - 2, 0)] - 1);
    }
    i = j;
  }
  return { ids, ends, length: cp };
}

// ---- probabilities to segments -----------------------------------------------------------

/** wtpsplit `indices_to_sentences` followed by `split_on_input_newlines`. */
export function sentencesFrom(chars: string[], probs: ArrayLike<number>, threshold: number = SAT_DEFAULTS.threshold): string[] {
  const sentences: string[] = [];
  let offset = 0;
  let idx = 0;
  for (let c = 0; c < probs.length; c++) {
    if (!(probs[c] > threshold)) continue;
    idx = c + 1;
    while (idx < chars.length && isPySpace(chars[idx])) idx++;
    if (idx > offset) sentences.push(chars.slice(offset, idx).join(''));
    offset = idx;
  }
  if (idx !== chars.length) {
    const last = chars.slice(idx).join('');
    if (last.length > 0) sentences.push(last);
  }
  const out: string[] = [];
  sentences.forEach((s, i) => {
    out.push(...(i < sentences.length - 1 && s.endsWith('\n') ? s.slice(0, -1) : s).split('\n'));
  });
  return out;
}

/**
 * The contract output: segments joined with '\n', minus the one space left at the end of each
 * cut segment. Segments concatenate back to the input except at input newlines, which
 * `sentencesFrom` consumed as cuts, so '\n' is inserted only where the model cut and restored
 * where the input already had one.
 */
export function joinSegments(sentences: string[]): string {
  return sentences
    .map((s, i) => (i < sentences.length - 1 && s.endsWith(' ') ? s.slice(0, -1) : s))
    .join('\n');
}

// ---- boundaries to marks ------------------------------------------------------------------

/**
 * Turn SaT's segments into text with marks, and report where they landed.
 *
 * Exported and pure because it is the one piece of this adapter with no
 * upstream to be faithful to, and it is where the mistakes live.
 *
 * Spacing: `sentencesFrom` leaves the whitespace that followed a boundary on
 * the END of the preceding segment, so the mark goes before that space -- and
 * a segment that had no trailing space must not gain one. Japanese has none,
 * and inventing one puts `です。 散歩` in the bubble, which is neither an input
 * character nor a mark and disagrees with how FireRedPunc writes the same 。
 * A newline-derived cut therefore yields `one.two` rather than `one. two`:
 * running two Latin words together reads worse, but inventing a character the
 * ASR never produced is the thing the contract forbids.
 *
 * The last segment never takes a terminal. The utterance end supplies it, and
 * `SentenceStream` distrusts a mark at the very end of a tail anyway.
 */
export function markBoundaries(
  segments: string[],
  terminal: string,
): { text: string; sentenceEnds: number[] } {
  // Blank segments come from consecutive or leading input newlines. Marking
  // one emits a freestanding terminal with no sentence in front of it, and
  // leaving one at the end would make the real last segment take a mark.
  const real = segments.filter((s) => s.length > 0);
  const sentenceEnds: number[] = [];
  let text = '';
  real.forEach((seg, i) => {
    const isLast = i === real.length - 1;
    const hadSpace = !isLast && seg.endsWith(' ');
    text += hadSpace ? seg.slice(0, -1) : seg;
    if (isLast) return;
    text += terminal;
    sentenceEnds.push(text.length);
    if (hadSpace) text += ' ';
  });
  return { text, sentenceEnds };
}

// ---- model -------------------------------------------------------------------------------

export function createSatAdapter(): PunctuationAdapter {
  let session: any = null;
  let tokenizer: any = null;
  let splitText: ((text: string) => Promise<string[]>) | null = null;

  return {
    model: 'sat-3l-sm',
    // No tensor in the q8w-gather build is float16, so it needs no shader-f16
    // and clears the existing gate. Measured 11-16 ms on WebGPU at any length.
    supportsWebGpu: true,
    async load(deps: PunctuationAdapterDeps) {
      const { Tokenizer } = await import('@huggingface/tokenizers');
      const tokenizerJson = JSON.parse(new TextDecoder().decode(await deps.readFile('tokenizer.json')));
      tokenizer = new Tokenizer(tokenizerJson, {});
      session = await deps.InferenceSession.create(await deps.readFile('model.onnx'), {
        executionProviders: deps.executionProviders,
      });
      const maskMeta = session.inputMetadata?.find?.((m: { name: string }) => m.name === 'attention_mask');
      const maskType: 'float16' | 'float32' = maskMeta?.type ?? 'float16';
      if (maskType !== 'float16' && maskType !== 'float32') {
        throw new Error(`sat-3l-sm: unexpected attention_mask type ${maskType}`);
      }

      /** Per-token logits averaged over windows, in float16 as wtpsplit's `extract` computes them. */
      async function tokenLogits(ids: number[], o: typeof SAT_DEFAULTS): Promise<Float64Array> {
        const { blockSize, stride, batchSize } = o;
        const n = ids.length;
        const block = Math.min(blockSize, n, MAX_SUBWORDS);
        const windows: Array<[number, number]> = [];
        for (let j = 0; j < n; j += stride) {
          const done = j + block >= n;
          const end = done ? n : j + block;
          windows.push([done ? Math.max(end - block, 0) : j, end]);
          if (done) break;
        }

        const S = block + 2;
        const sums = new Float64Array(n);
        const counts = new Float64Array(n);
        for (let b = 0; b < windows.length; b += batchSize) {
          const batch = windows.slice(b, b + batchSize);
          const B = batch.length;
          const idData = new BigInt64Array(B * S); // padding id 0, as wtpsplit's zero-filled buffer
          const maskData = maskType === 'float16' ? new Uint16Array(B * S) : new Float32Array(B * S);
          const one = maskType === 'float16' ? 0x3c00 : 1;
          batch.forEach(([start, end], r) => {
            const row = r * S;
            idData[row] = BigInt(CLS_ID);
            for (let k = start; k < end; k++) idData[row + 1 + k - start] = BigInt(ids[k]);
            idData[row + 1 + end - start] = BigInt(SEP_ID);
            maskData.fill(one, row, row + end - start + 2);
          });
          const out = await session.run({
            input_ids: new deps.Tensor('int64', idData, [B, S]),
            attention_mask: new deps.Tensor(maskType, maskData, [B, S]),
          });
          const logits = logitsToNumbers(out.logits);
          const L = out.logits.dims[2];
          batch.forEach(([start, end], r) => {
            for (let k = start; k < end; k++) {
              // logits[:, 1:-1] skips <s>; uniform weight 1; a float16 buffer += a float32 value.
              const x = logits[(r * S + 1 + k - start) * L];
              sums[k] = f16round(f32(sums[k] + f32(x)));
              counts[k] += 1;
            }
          });
          out.logits.dispose?.();
        }
        for (let k = 0; k < n; k++) sums[k] = f16round(f32(sums[k] / counts[k]));
        return sums;
      }

      /** wtpsplit's per-character sentence probabilities. */
      async function predict(text: string): Promise<{ chars: string[]; probs: Float32Array }> {
        const chars = Array.from(text);
        const probs = new Float32Array(chars.length);
        if (chars.every(isPySpace)) return { chars, probs };
        const { ids, ends } = tokenizeWithEnds(tokenizer, text);
        if (ids.length === 0) return { chars, probs };
        const logits = await tokenLogits(ids, SAT_DEFAULTS);
        // A later token overwrites an earlier one ending on the same character (numpy assignment).
        const charLogit = new Float64Array(chars.length).fill(-Infinity);
        for (let t = 0; t < ids.length; t++) charLogit[ends[t]] = logits[t];
        for (let c = 0; c < chars.length; c++) {
          probs[c] = f32(1 / f32(1 + f32(Math.exp(-charLogit[c]))));
        }
        return { chars, probs };
      }

      splitText = async (text: string): Promise<string[]> => {
        const { chars, probs } = await predict(text);
        return sentencesFrom(chars, probs, SAT_DEFAULTS.threshold);
      };
    },
    async run(text: string) {
      if (!splitText) throw new Error('sat-3l-sm: run() called before load()');
      const segments = await splitText(text);
      // The mark is chosen by script so a Japanese bubble does not end in a
      // Latin period. Chosen once for the whole call: a mostly-Latin tail
      // carrying one stray fullwidth character will take 。 throughout, which
      // is rare enough to accept.
      const terminal = /[　-鿿＀-￯]/.test(text) ? '。' : '.';
      const { text: out, sentenceEnds } = markBoundaries(segments, terminal);
      return { text: out, sentenceEnds, breakpoints: [...sentenceEnds], model: 'sat-3l-sm' as const };
    },
    async release() {
      await session?.release?.();
      session = null;
      tokenizer = null;
      splitText = null;
    },
  };
}
