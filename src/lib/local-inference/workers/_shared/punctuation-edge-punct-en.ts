/**
 * Edge-Punct-Casing (CNN-BiLSTM, English punctuation + casing), sherpa-onnx
 * online-punct-en-2024-08-06 int8. A port of sherpa-onnx
 * csrc/online-punctuation-cnn-bilstm-impl.h (1.13.8) and of the unigram encoder it
 * uses, ssentencepiece::Ssentencepiece from simple-sentencepiece v0.7 (the tag
 * sherpa-onnx's cmake pins).
 *
 * Port of `benchmark/punctuation-restoration/models/edge-punct-en.mjs`, converted
 * to TypeScript with no behavioural change: every constant, the two upstream
 * quirks in `UnigramEncoder.encodeWord` (the zero score for an uncovered
 * position, and the shortest-piece tie-break), and the `Math.fround` rounding
 * are kept exactly as measured against the real model.
 */
import type { PunctuationAdapter, PunctuationAdapterDeps } from './punctuation-core';
import { sentenceEnds as ruleSentenceEnds } from '../../../segmentation/sentenceEnd';

const MAX_SEQ_LEN = 200; // kMaxSeqLen
const BOS = 1; // <s>, hard-coded upstream
const EOS = 2; // </s>
const PUNCT_SUFFIX = ['', ',', '.', '?']; // NO_PUNCT, COMMA, PERIOD, QUESTION
const CASE_UPPER = 1;
const CASE_CAP = 2; // LOWER = 0 and MIX_CASE = 3 leave the word as written

// std::istream >> word and std::stringstream split on the classic-locale ASCII whitespace only.
const splitWords = (text: string): string[] => text.split(/[ \t\n\v\f\r]+/).filter(Boolean);
const upperAscii = (w: string): string => w.replace(/[a-z]/g, (c) => c.toUpperCase());
const lowerAscii = (w: string): string => w.replace(/[A-Z]/g, (c) => c.toLowerCase());

/** Words as `punctuate` outputs them: a trailing run of the predicted marks , . ? removed, empty words dropped. */
export const moduleWords = (text: string): string[] => splitWords(text).map((w) => w.replace(/[.,?]+$/, '')).filter(Boolean);

interface TrieNode {
  next: Map<number, TrieNode>;
  id: number;
}

/**
 * ssentencepiece v0.7: a byte-level prefix trie over every vocab line, a Viterbi
 * pass from the end over float32 scores, and one <unk> per byte no piece covers.
 * Two of its quirks are kept on purpose because the model was run behind them:
 * an uncovered position scores 0 (better than any real piece), and on a score tie
 * the shortest piece wins.
 */
export class UnigramEncoder {
  private readonly scores: Float32Array;
  private readonly root: TrieNode;
  private unkId: number;
  private bytesOffset: number;
  private readonly enc: TextEncoder;

  constructor(vocabText: string) {
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
  encodeWord(word: string): number[] {
    const bytes = this.enc.encode(`▁${word}`);
    const n = bytes.length;
    const score = new Float32Array(n + 1);
    const next = new Int32Array(n + 1);
    const piece = new Int32Array(n + 1);
    for (let i = n - 1; i >= 0; i--) {
      let maxScore = -Infinity;
      let maxIdx = -1;
      let index = 0;
      let node: TrieNode | undefined = this.root;
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
    const ids: number[] = [];
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

interface EncodedSentences {
  n: number;
  tokenIds: Int32Array;
  validIds: Int32Array;
  labelLens: Int32Array;
}

/**
 * EncodeSentences: <s> w1 w2 ... </s> rows of 200 ids, zero-padded; only a word's
 * first piece (and <s>, </s>) is valid; a word that would push the row past 199
 * starts a new row. `clamp` caps one word at 198 pieces so every row fits; upstream
 * has no cap, builds a longer row and silently misaligns the batch (see below).
 */
export function encodeSentences(encoder: UnigramEncoder, words: string[], clamp: boolean): EncodedSentences {
  const rows: Array<{ tokens: number[]; valids: number[] }> = [];
  const labelLens: number[] = [];
  let tokens: number[] = [BOS];
  let valids: number[] = [1];
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
  return {
    n,
    tokenIds: tokenFlat.slice(0, n * MAX_SEQ_LEN),
    validIds: validFlat.slice(0, n * MAX_SEQ_LEN),
    labelLens: Int32Array.from(labelLens),
  };
}

function argmaxRows(t: { dims: number[]; data: ArrayLike<number> }): Int32Array {
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
export function decodeWord(word: string, casePred: number, punctPred: number): string {
  let w = word;
  if (casePred === CASE_UPPER) w = upperAscii(w);
  else if (casePred === CASE_CAP) w = upperAscii(w.slice(0, 1)) + w.slice(1);
  return w + (PUNCT_SUFFIX[punctPred] ?? '');
}

/**
 * Where Edge-Punct's output ends a sentence.
 *
 * Delegates to the shared rule, exactly as the FireRedPunc adapter does. An
 * earlier draft scanned for `.` and `?` directly, on the claim that this model
 * "writes no abbreviation dots" — which is false. `moduleWords` strips a
 * trailing `.,?` from every word before encoding and `decodeWord` then appends
 * whatever mark the model predicts, so "Dr. Smith" can come back as `Dr.` with
 * a predicted period. Counting that as a sentence end is precisely the
 * mid-abbreviation cut this whole design exists to remove, and
 * `periodIsNotSentenceEnd` already rejects it.
 *
 * The model emits only `,`, `.` and `?` (PUNCT_SUFFIX), a strict subset of the
 * shared terminal set, so nothing it can produce is missed. It never forces a
 * final mark — the utterance end supplies one.
 */
function periodOffsets(text: string): number[] {
  return ruleSentenceEnds(text);
}

/**
 * Sentence ends plus the commas the model wrote.
 *
 * Narrower than the shared `breakpoints()` on purpose: that one also counts
 * `、;；:：—–`, none of which Edge-Punct can emit, so counting them would mean
 * reacting to punctuation that came from the ASR rather than from the model.
 */
function periodOrCommaOffsets(text: string): number[] {
  const ends = new Set(ruleSentenceEnds(text));
  for (let i = 0; i < text.length; i++) {
    if (text[i] === ',') ends.add(i + 1);
  }
  return [...ends].sort((a, b) => a - b);
}

export function createEdgePunctEnAdapter(): PunctuationAdapter {
  let session: any = null;
  let encoder: UnigramEncoder | null = null;
  let Tensor: any = null;

  return {
    model: 'edge-punct-en',
    // Dynamic int8: DynamicQuantizeLSTM, ConvInteger, MatMulInteger, NonZero
    // and TopK have no WebGPU kernels, so a 'webgpu' session would fall back
    // op by op and be slower than plain WASM. Always WASM, in either entry.
    supportsWebGpu: false,
    async load(deps: PunctuationAdapterDeps) {
      const [modelBytes, vocabBytes] = await Promise.all([
        deps.readFile('model.int8.onnx'),
        deps.readFile('bpe.vocab'),
      ]);
      session = await deps.InferenceSession.create(modelBytes, { executionProviders: ['wasm'] });
      encoder = new UnigramEncoder(new TextDecoder().decode(vocabBytes));
      Tensor = deps.Tensor;
    },
    async run(text: string) {
      const words = moduleWords(text);
      if (words.length === 0) {
        return { text: '', sentenceEnds: [], breakpoints: [], model: 'edge-punct-en' as const };
      }
      if (!session || !encoder) throw new Error('edge-punct-en: run() called before load()');
      const enc = encodeSentences(encoder, words.map(lowerAscii), true);
      // All rows go in one batch: the int8 graph quantizes activations per
      // tensor, so splitting the batch would change the numbers.
      const result = await session.run({
        token_ids: new Tensor('int32', enc.tokenIds, [enc.n, MAX_SEQ_LEN]),
        valid_ids: new Tensor('int32', enc.validIds, [enc.n, MAX_SEQ_LEN]),
        label_lens: new Tensor('int32', enc.labelLens, [enc.n]),
      });
      const casePred = argmaxRows(result.active_case_logits);
      const punctPred = argmaxRows(result.active_punct_logits);
      const out = words.map((w, i) => decodeWord(w, casePred[i] ?? 0, punctPred[i] ?? 0)).join(' ');
      return {
        text: out,
        sentenceEnds: periodOffsets(out),
        breakpoints: periodOrCommaOffsets(out),
        model: 'edge-punct-en' as const,
      };
    },
    async release() {
      await session?.release?.();
      session = null;
      encoder = null;
      Tensor = null;
    },
  };
}
