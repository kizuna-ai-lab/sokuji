/**
 * FireRedPunc (FireRedTeam/FireRedASR2S, Apache-2.0): Chinese/English punctuation
 * restoration with a chinese-lert-base BERT token classifier, run from the weight-only
 * 8-bit ONNX export (`punc.q8w.onnx`, MatMulNBits over 42ailab/FireRedPunc-ONNX's fp32
 * graph).
 *
 * Port of `benchmark/punctuation-restoration/models/fireredpunc.mjs`, which is itself a
 * port of fireredasr2s/fireredpunc/punc.py FireRedPunc.process (FireRedASR2S @4e7d9aaf):
 * BertTokenizer(chinese-lert-base) -> [CLS] + ids (no [SEP]) -> argmax over
 * {space ， 。 ？ ！} per token -> ModelIO.add_punc_to_txt -> RuleBaedTxtFix.fix.
 * Deviations, all documented in the benchmark's models/fireredpunc.md:
 *  - The output is rebuilt from the ORIGINAL characters. Upstream emits the tokenizer's
 *    tokens (lowercased, accent-stripped: です -> てす, and only the first character of a
 *    multi-character [UNK] word). Every upstream decision (spacing rule, RuleBaedTxtFix
 *    mark conversion and capitalisation) is still taken on the upstream token text.
 *  - Marks the model predicts, and their ASCII/half-width twins, are removed from the
 *    input first (the model is trained on unpunctuated text); a ',' or '.' between two
 *    digits is kept.
 *  - Inputs over 511 tokens run in overlapping windows (511 tokens, 128 overlap, each
 *    token taken from the window where it sits furthest from an artificial edge).
 *    Upstream FireRedPuncBert.forward_model hard-splits every 511 tokens with no overlap.
 *
 * The benchmark measured this exact code at breakpoint F1 91.5 and 100% agreement with
 * the fp32 reference on the whole corpus: every regex, the window-merge rule and the
 * order of the regexes inside ruleBasedTxtFix are load-bearing and ported verbatim.
 */
import type { PunctuationAdapter, PunctuationAdapterDeps } from './punctuation-core';
import { sentenceEnds as ruleSentenceEnds } from '../../../segmentation/sentenceEnd';

// FireRedPuncBert.max_input_len: 512 position embeddings minus the [CLS] slot.
const MAX_TOKENS = 511;
const WINDOW_OVERLAP = 128;
// transformers WordpieceTokenizer.max_input_chars_per_word
const MAX_CHARS_PER_WORD = 100;
const UNK_TOKEN = '[UNK]';

const STRIP_MARKS = new Set(['，', '。', '？', '！', '、', ',', '.', '?', '!', '．', '｡', '､']);
const DIGIT_JOINERS = new Set([',', '.', '．']);
const FW_TO_ASCII: Record<string, string> = { '，': ',', '。': '.', '？': '?', '！': '!' };

const RE_DIGIT = /\p{Nd}/u;
const RE_CONTROL = /\p{C}/u;
const RE_ZS = /\p{Zs}/u;
const RE_SPLIT_SPACE = /\s/u;
const RE_PUNCT = /\p{P}/u;
const RE_MN = /\p{Mn}/u;
// punc.py add_punc_to_txt: `re.search("[a-zA-Z0-9#]+", token)`
const RE_ALNUM_HASH = /[a-zA-Z0-9#]/;

const decodeUtf8 = (bytes: Uint8Array): string => new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);

interface TokenizerJson {
  model: { vocab: Record<string, number> };
}

/** WordPiece unit produced by `tokenize`, with its span of original code points. */
interface WordpieceUnit {
  raw: string;
  id: number;
  first: number;
  last: number;
}

/** Python universal-newline line iteration: no phantom line after a trailing newline. */
function pyLines(text: string): string[] {
  const lines = text.split(/\r\n|\r|\n/);
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** TokenDict.read_dict for out_dict: "<space> 0" -> ' '. */
export function parseOutDict(text: string): string[] {
  const id2word: string[] = [];
  pyLines(text).forEach((line, i) => {
    const toks = line.trim().split(/\s+/).filter(Boolean);
    let word = ' ';
    let index = i;
    if (toks.length >= 2) [word, index] = [toks[0], Number(toks[1])];
    else if (toks.length === 1) word = toks[0];
    if (word === '<space>') word = ' ';
    id2word[index] = word;
  });
  return id2word;
}

// transformers BasicTokenizer._is_chinese_char
function isChineseChar(cp: number): boolean {
  return (cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0x3400 && cp <= 0x4dbf)
    || (cp >= 0x20000 && cp <= 0x2a6df) || (cp >= 0x2a700 && cp <= 0x2b73f)
    || (cp >= 0x2b740 && cp <= 0x2b81f) || (cp >= 0x2b820 && cp <= 0x2ceaf)
    || (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0x2f800 && cp <= 0x2fa1f);
}
// _is_control: tab/newline/CR are whitespace, every other category C* is dropped.
const isControl = (ch: string): boolean => ch !== '\t' && ch !== '\n' && ch !== '\r' && RE_CONTROL.test(ch);
// _is_whitespace, plus what Python's str.split() also splits on (U+2028 and friends).
const isSpace = (ch: string): boolean =>
  ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || RE_ZS.test(ch) || RE_SPLIT_SPACE.test(ch);
function isPunctuation(ch: string): boolean {
  const cp = ch.codePointAt(0) ?? 0;
  return (cp >= 33 && cp <= 47) || (cp >= 58 && cp <= 64) || (cp >= 91 && cp <= 96) || (cp >= 123 && cp <= 126) || RE_PUNCT.test(ch);
}
/** BasicTokenizer per character: NFC, lower(), then NFD with every Mn removed. */
function normalizeChar(ch: string): string[] {
  return Array.from(ch.normalize('NFC').toLowerCase().normalize('NFD')).filter((c) => !RE_MN.test(c));
}

/** Remove the marks the model predicts; a stripped mark becomes a space so words never merge. */
export function stripMarks(text: string): string {
  const cps = Array.from(text);
  let out = '';
  for (let i = 0; i < cps.length; i++) {
    const ch = cps[i];
    const joinsDigits = DIGIT_JOINERS.has(ch) && RE_DIGIT.test(cps[i - 1] ?? '') && RE_DIGIT.test(cps[i + 1] ?? '');
    out += STRIP_MARKS.has(ch) && !joinsDigits ? ' ' : ch;
  }
  return out;
}

/**
 * BertTokenizer(chinese-lert-base).tokenize with each token's span of original code
 * points. Units are WordPiece tokens: { raw, id, first, last }.
 */
export function tokenize(cps: string[], vocab: Map<string, number>, unkId: number): WordpieceUnit[] {
  const words: { c: string; k: number }[][] = [];
  let cur: { c: string; k: number }[] = [];
  const flush = () => {
    if (cur.length) words.push(cur);
    cur = [];
  };
  for (let k = 0; k < cps.length; k++) {
    const ch = cps[k];
    const cp = ch.codePointAt(0) ?? 0;
    if (cp === 0 || cp === 0xfffd || isControl(ch)) continue;
    if (isSpace(ch)) {
      flush();
      continue;
    }
    const chinese = isChineseChar(cp);
    if (chinese) flush();
    for (const c of normalizeChar(ch)) {
      if (isPunctuation(c)) {
        flush();
        words.push([{ c, k }]);
      } else {
        cur.push({ c, k });
      }
    }
    if (chinese) flush();
  }
  flush();

  const units: WordpieceUnit[] = [];
  for (const w of words) {
    const unk: WordpieceUnit = { raw: UNK_TOKEN, id: unkId, first: w[0].k, last: w[w.length - 1].k };
    if (w.length > MAX_CHARS_PER_WORD) {
      units.push(unk);
      continue;
    }
    const pieces: WordpieceUnit[] = [];
    let start = 0;
    let bad = false;
    while (start < w.length) {
      let end = w.length;
      let found: string | null = null;
      while (start < end) {
        let sub = start > 0 ? '##' : '';
        for (let x = start; x < end; x++) sub += w[x].c;
        if (vocab.has(sub)) {
          found = sub;
          break;
        }
        end--;
      }
      if (found === null) {
        bad = true;
        break;
      }
      pieces.push({ raw: found, id: vocab.get(found) as number, first: w[start].k, last: w[end - 1].k });
      start = end;
    }
    if (bad) units.push(unk);
    else units.push(...pieces);
  }
  return units;
}

/**
 * Original characters owned by each unit. A character that yields no token text
 * (a control character or a lone combining mark) is attached to the preceding unit;
 * whitespace is dropped, as upstream drops it.
 */
function assignOriginal(cps: string[], units: WordpieceUnit[]): string[] {
  const orig = units.map(() => '');
  let next = 0;
  for (let u = 0; u < units.length; u++) {
    const { first, last } = units[u];
    for (let k = next; k <= last; k++) {
      if (k < first) {
        if (!isSpace(cps[k])) orig[Math.max(0, u - 1)] += cps[k];
      } else {
        orig[u] += cps[k];
      }
    }
    next = Math.max(next, last + 1);
  }
  for (let k = next; k < cps.length; k++) if (!isSpace(cps[k])) orig[units.length - 1] += cps[k];
  return orig;
}

/** punc.py RuleBaedTxtFix.fix(txt, capitalize_first=True), regex for regex. */
export function ruleBasedTxtFix(txtOri: string): string {
  let txt = txtOri.toLowerCase();
  txt = txt.replace(/([a-z])，([a-z])/g, '$1, $2');
  txt = txt.replace(/([a-z])。([a-z])/g, '$1. $2');
  txt = txt.replace(/([a-z])？([a-z])/g, '$1? $2');
  txt = txt.replace(/([a-z])！([a-z])/g, '$1! $2');
  txt = txt.replace(/^([a-z]+)，/, '$1,');
  txt = txt.replace(/^([a-z]+)。/, '$1.');
  txt = txt.replace(/^([a-z]+)？/, '$1?');
  txt = txt.replace(/^([a-z]+)！/, '$1!');
  txt = txt.replace(/( [a-zA-Z']+)，$/, '$1,');
  txt = txt.replace(/( [a-zA-Z']+)。$/, '$1.');
  txt = txt.replace(/( [a-zA-Z']+)？$/, '$1?');
  txt = txt.replace(/( [a-zA-Z']+)！$/, '$1!');
  txt = txt.replace(/^i /, 'I ');
  txt = txt.replace(/^i'm /, "I'm ");
  txt = txt.replace(/^i'd /, "I'd ");
  txt = txt.replace(/^i've /, "I've ");
  txt = txt.replace(/^i'll /, "I'll ");
  txt = txt.replace(/ i /g, ' I ');
  txt = txt.replace(/ i'm /g, " I'm ");
  txt = txt.replace(/ i'd /g, " I'd ");
  txt = txt.replace(/ i've /g, " I've ");
  txt = txt.replace(/ i'll /g, " I'll ");
  if (txt.length > 0 && /^[a-z]/.test(txt)) txt = txt[0].toUpperCase() + txt.slice(1);
  txt = txt.replace(/([.!?。？！])\s+([a-z])/g, (_m, a, b) => `${a} ${b.toUpperCase()}`);
  return txt;
}

/** Upper-case the original characters whose token characters RuleBaedTxtFix upper-cased. */
function applyCase(orig: string, norm: string, upperAt: Set<number>): string {
  const lower = Array.from(orig.toLowerCase());
  if (!upperAt.size) return lower.join('');
  const normLen = Array.from(norm).length;
  for (const k of upperAt) {
    if (normLen === lower.length) lower[k] = lower[k].toUpperCase();
    else if (k === 0 && lower.length) lower[0] = lower[0].toUpperCase();
  }
  return lower.join('');
}

type PCharOwner =
  | { i: number; kind: 'lead' }
  | { i: number; kind: 'norm'; k: number }
  | { i: number; kind: 'mark' };

/**
 * add_punc_to_txt + RuleBaedTxtFix on the upstream token text, then the same edits
 * projected onto the original characters.
 */
export function decode(
  cps: string[],
  units: WordpieceUnit[],
  preds: number[],
  outDict: string[],
): { out: string; built: string; fixed: string } {
  const orig = assignOriginal(cps, units);
  // Upstream's `token_seq` after _recover_unk: an [UNK] becomes the lowercased source text.
  const tokenText = units.map((u, i) =>
    u.raw === UNK_TOKEN ? Array.from(orig[i]).filter((c) => !isSpace(c)).join('').toLowerCase() : u.raw,
  );

  const pChars: string[] = [];
  const owner: PCharOwner[] = [];
  const norms: string[] = [];
  for (let i = 0; i < units.length; i++) {
    const tag = outDict[preds[i]];
    let token = tokenText[i];
    if (token.startsWith('##')) {
      // target lib is ES2020: no String.prototype.replaceAll yet.
      token = token.replace(/##/g, '');
    } else if (RE_ALNUM_HASH.test(token) && i > 0 && RE_ALNUM_HASH.test(tokenText[i - 1]) && outDict[preds[i - 1]] === ' ') {
      pChars.push(' ');
      owner.push({ i, kind: 'lead' });
    }
    norms.push(token);
    Array.from(token).forEach((c, k) => {
      pChars.push(c);
      owner.push({ i, kind: 'norm', k });
    });
    if (tag !== ' ') {
      pChars.push(tag);
      owner.push({ i, kind: 'mark' });
    }
  }
  // Upstream then does txt.replace("  ", " "); tokens never hold a space and a lead
  // space only follows a token with no mark, so no double space can occur here.
  const built = pChars.join('');
  const fixed = ruleBasedTxtFix(built);
  const fChars = Array.from(fixed);

  const lead = units.map(() => '');
  const mark = units.map(() => '');
  const upperAt = units.map(() => new Set<number>());
  let j = 0;
  for (let x = 0; x < pChars.length; x++) {
    const p = pChars[x];
    const f = fChars[j];
    const own = owner[x];
    const { i } = own;
    const converted = FW_TO_ASCII[p] !== undefined && FW_TO_ASCII[p] === f;
    if (!(f === p || (p >= 'a' && p <= 'z' && f === p.toUpperCase()) || converted)) {
      throw new Error(`fireredpunc: RuleBaedTxtFix projection lost sync at ${x} in ${JSON.stringify(built)} -> ${JSON.stringify(fixed)}`);
    }
    j++;
    if (own.kind === 'lead') lead[i] = ' ';
    else if (own.kind === 'norm') {
      if (f !== p) upperAt[i].add(own.k);
    } else {
      mark[i] += f;
      // "a，b" -> "a, b": the fix inserts a space after a converted mark.
      if (converted && fChars[j] === ' ' && pChars[x + 1] !== ' ') {
        mark[i] += ' ';
        j++;
      }
    }
  }
  if (j !== fChars.length) throw new Error(`fireredpunc: RuleBaedTxtFix projection left ${fChars.length - j} characters`);

  let out = '';
  for (let i = 0; i < units.length; i++) out += lead[i] + applyCase(orig[i], norms[i], upperAt[i]) + mark[i];
  return { out, built, fixed };
}

/**
 * Where FireRedPunc's output ends a sentence.
 *
 * Delegates to the shared rule rather than reimplementing it. The model writes
 * only 。，？！, and `ruleBasedTxtFix` converts each terminal to its ASCII form
 * in ASCII-letter contexts, so everything this model can produce is a strict
 * subset of what `sentenceEnd.ts` already recognises — a narrower copy here
 * buys nothing and only creates ways to disagree. An earlier draft did
 * reimplement it and silently dropped the ASCII `!` and `?` that the model's
 * own post-processing creates, so `"wow！amazing"` became `"Wow! Amazing"`
 * with no sentence end at all.
 *
 * The model prefers commas — 64 sentence ends against 103 in the reference,
 * but 205 of 225 marks overall — which is why the Chinese length fallback
 * exists. That under-emission is not compensated for here.
 */
export function countSentenceEnds(text: string): number[] {
  return ruleSentenceEnds(text);
}

/**
 * Sentence ends plus the commas the model wrote.
 *
 * Deliberately narrower than the shared `breakpoints()`, which also counts
 * 、;；:：—– . FireRedPunc never emits any of those, so counting them would
 * mean reacting to punctuation that came from the ASR's own text rather than
 * from the model.
 */
export function countBreakpoints(text: string): number[] {
  const ends = new Set(ruleSentenceEnds(text));
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '，' || text[i] === ',') ends.add(i + 1);
  }
  return [...ends].sort((a, b) => a - b);
}

export function createFireRedPuncAdapter(): PunctuationAdapter {
  let session: any = null;
  let punctuate: ((text: string) => Promise<string>) | null = null;

  return {
    model: 'fireredpunc',
    // MatMulNBits at 8 bits has a WebGPU kernel; measured 27 ms for 480 zh
    // characters against 394 ms on WASM with 4 threads.
    supportsWebGpu: true,
    async load(deps: PunctuationAdapterDeps) {
      const [modelBytes, tokBytes, outDictBytes] = await Promise.all(
        ['punc.q8w.onnx', 'tokenizer.json', 'out_dict'].map((f) => deps.readFile(f)),
      );
      const tok = JSON.parse(decodeUtf8(tokBytes)) as TokenizerJson;
      const vocab = new Map(Object.entries(tok.model.vocab));
      const clsId = vocab.get('[CLS]');
      const unkId = vocab.get(UNK_TOKEN);
      if (clsId === undefined || unkId === undefined) {
        throw new Error('fireredpunc: tokenizer vocab is missing [CLS] or [UNK]');
      }
      const outDict = parseOutDict(decodeUtf8(outDictBytes));
      const nClasses = outDict.length;
      session = await deps.InferenceSession.create(modelBytes, { executionProviders: deps.executionProviders });

      /** Logits for one window: input is [CLS] + ids (no [SEP]); the graph drops the [CLS] row. */
      async function windowLogits(ids: number[]) {
        const n = ids.length;
        const inputIds = new BigInt64Array(n + 1);
        inputIds[0] = BigInt(clsId as number);
        for (let i = 0; i < n; i++) inputIds[i + 1] = BigInt(ids[i]);
        const feeds = {
          input_ids: new deps.Tensor('int64', inputIds, [1, n + 1]),
          attention_mask: new deps.Tensor('int64', new BigInt64Array(n + 1).fill(1n), [1, n + 1]),
        };
        const { logits } = await session.run(feeds);
        if (logits.dims[1] !== n || logits.dims[2] !== nClasses) {
          throw new Error(`fireredpunc: unexpected logits shape ${logits.dims} for ${n} tokens`);
        }
        return logits.data as Float32Array | Float64Array;
      }

      async function predict(ids: number[]): Promise<number[]> {
        const n = ids.length;
        const preds = new Array<number>(n).fill(0);
        if (n === 0) return preds;
        const spans: Array<[number, number]> = [];
        if (n <= MAX_TOKENS) {
          spans.push([0, n]);
        } else {
          const step = MAX_TOKENS - WINDOW_OVERLAP;
          for (let s = 0; s + MAX_TOKENS < n; s += step) spans.push([s, s + MAX_TOKENS]);
          spans.push([n - MAX_TOKENS, n]);
        }
        const best = new Float64Array(n).fill(-1);
        for (const [s, e] of spans) {
          const data = await windowLogits(ids.slice(s, e));
          for (let t = s; t < e; t++) {
            const margin = Math.min(s === 0 ? Infinity : t - s, e === n ? Infinity : e - 1 - t);
            if (!(margin > best[t])) continue;
            best[t] = margin;
            const off = (t - s) * nClasses;
            let arg = 0;
            for (let c = 1; c < nClasses; c++) if (data[off + c] > data[off + arg]) arg = c;
            preds[t] = arg;
          }
        }
        return preds;
      }

      punctuate = async (text: string): Promise<string> => {
        const stripped = stripMarks(text);
        const cps = Array.from(stripped);
        const units = tokenize(cps, vocab, unkId as number);
        if (!units.length) return stripped.trim();
        const ids = units.map((u) => u.id);
        const preds = await predict(ids);
        return decode(cps, units, preds, outDict).out;
      };
    },
    async run(text: string) {
      if (!punctuate) throw new Error('fireredpunc: run() called before load()');
      const out = await punctuate(text);
      return {
        text: out,
        sentenceEnds: countSentenceEnds(out),
        breakpoints: countBreakpoints(out),
        model: 'fireredpunc' as const,
      };
    },
    async release() {
      await session?.release?.();
      session = null;
      punctuate = null;
    },
  };
}
