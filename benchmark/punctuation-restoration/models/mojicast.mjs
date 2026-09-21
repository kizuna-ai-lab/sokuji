// Mojicast punctuation BERT (ishiki-emo/mojicast-punct-onnx, Apache-2.0): Japanese 、。
// restoration with tohoku-nlp/bert-base-japanese-char-v3 + bobfromjapan's 2-way linear
// head, int8 (per-channel dynamic MatMul) ONNX — the Mojicast app's default precision.
//
// Exact port of Mojicast punct.py (github.com/ishiki-emo/mojicast @d06ddb9f):
//  - input: every 、 and 。 removed; nothing else normalised (no NFKC, no lowercasing);
//  - one token per code point from vocab.txt, unknown characters -> [UNK];
//  - non-overlapping 256-character chunks, each [CLS] chunk [SEP];
//  - sigmoid per token -> [、, 。]; 。 if p > 0.1, else 、 if p > 0.1 (period wins);
//  - _NUM_PUNC_FIX drops a mark between a digit and a counter (1987、年 -> 1987年);
//  - _looks_broken guard: >= 3 marks added and added * 2 > length -> return the text unmarked;
//  - load-time self-test on "これはてすとです" (throws SelfTestFailed; the app then falls back to fp32).
// No ？/！ class and no rule adds one. See models/mojicast.md.
// Pure ESM: only the injected onnxruntime-web instance and readFile are used.

export const info = {
  id: 'mojicast',
  name: 'Mojicast punct BERT int8',
  langs: ['ja'],
  output: 'punct',
  localDir: '/home/jiangzhuo/.cache/huggingface/hub/models--ishiki-emo--mojicast-punct-onnx/snapshots/6bef44545db904999043648af48ee17cd6177ee4',
  files: ['punct_bert.int8.onnx', 'vocab.txt'],
};

// punct.py defaults
export const COMMA_THRESH = 0.1;
export const PERIOD_THRESH = 0.1;
export const MAX_LENGTH = 256;
const PROBE = 'これはてすとです';
// Python `\d` on str is any Unicode decimal digit.
const NUM_PUNC_FIX = /(\p{Nd})[、。](?=[年月日時分秒歳才人個円回本枚台匹冊話曲位点倍万億兆つ杯件番週%％])/gu;

const cpLen = (s) => Array.from(s).length;

/** punct._looks_broken: a model that marks every character. */
export function looksBroken(text, result) {
  const added = cpLen(result) - cpLen(text);
  return added >= 3 && added * 2 > cpLen(text);
}

/** load_punctuator's vocab: one entry per line (only "\n" stripped), later duplicates win. */
function parseVocab(bytes) {
  const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
  const lines = text.split(/\r\n|\r|\n/);
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  const vocab = new Map();
  lines.forEach((line, i) => vocab.set(line, i));
  return vocab;
}

export async function createMojicast({ ort, readFile, executionProviders, sessionOptions }, modelFile) {
  const [modelBytes, vocabBytes] = await Promise.all([readFile(modelFile), readFile('vocab.txt')]);
  const vocab = parseVocab(vocabBytes);
  if (vocab.size < 100 || !vocab.has('[CLS]') || !vocab.has('[SEP]')) {
    throw new Error(`mojicast: invalid vocab (size=${vocab.size})`);
  }
  const clsId = vocab.get('[CLS]');
  const sepId = vocab.get('[SEP]');
  const unkId = vocab.get('[UNK]') ?? 1;
  let session = await ort.InferenceSession.create(modelBytes, { executionProviders, ...sessionOptions });

  /** Sigmoid probabilities [、, 。] for each character of one chunk. */
  async function chunkProbs(chunk) {
    const n = chunk.length + 2;
    const ids = new BigInt64Array(n);
    ids[0] = BigInt(clsId);
    chunk.forEach((ch, j) => {
      ids[j + 1] = BigInt(vocab.get(ch) ?? unkId);
    });
    ids[n - 1] = BigInt(sepId);
    const { logits } = await session.run({
      input_ids: new ort.Tensor('int64', ids, [1, n]),
      attention_mask: new ort.Tensor('int64', new BigInt64Array(n).fill(1n), [1, n]),
    });
    const probs = new Float64Array(chunk.length * 2);
    for (let j = 0; j < chunk.length; j++) {
      // +1 skips the [CLS] row; the [SEP] row is ignored.
      probs[2 * j] = 1 / (1 + Math.exp(-logits.data[2 * (j + 1)]));
      probs[2 * j + 1] = 1 / (1 + Math.exp(-logits.data[2 * (j + 1) + 1]));
    }
    return probs;
  }

  /** punct._punctuate_raw: the model's decision before the guard. Returns text and probabilities. */
  async function punctuateRaw(text, commaThresh = COMMA_THRESH, periodThresh = PERIOD_THRESH, maxLength = MAX_LENGTH) {
    const cps = Array.from(text);
    let out = '';
    const allProbs = [];
    for (let i = 0; i < cps.length; i += maxLength) {
      const chunk = cps.slice(i, i + maxLength);
      const probs = await chunkProbs(chunk);
      for (let j = 0; j < chunk.length; j++) {
        const comma = probs[2 * j];
        const period = probs[2 * j + 1];
        allProbs.push([comma, period]);
        if (period > periodThresh) out += `${chunk[j]}。`;
        else if (comma > commaThresh) out += `${chunk[j]}、`;
        else out += chunk[j];
      }
    }
    return { text: out.replace(NUM_PUNC_FIX, '$1'), probs: allProbs };
  }

  const probe = (await punctuateRaw(PROBE)).text;
  if (!probe || looksBroken(PROBE, probe)) {
    await session.release();
    const err = new Error(`mojicast: self-test failed on ${modelFile} (output: ${probe})`);
    err.name = 'SelfTestFailed';
    throw err;
  }

  /** punct.add_punctuation, plus the per-character probabilities for parity scripts. */
  async function inspect(input) {
    const text = input.replaceAll('、', '').replaceAll('。', '');
    if (!text) return { text, raw: text, probs: [], broken: false, out: text };
    const raw = await punctuateRaw(text);
    const broken = looksBroken(text, raw.text);
    return { text, raw: raw.text, probs: raw.probs, broken, out: broken ? text : raw.text || text };
  }

  return {
    async punctuate(text, lang) {
      if (!info.langs.includes(lang)) throw new Error(`mojicast: unsupported language ${lang}`);
      return (await inspect(text)).out;
    },
    inspect,
    probe,
    async release() {
      await session?.release();
      session = null;
    },
  };
}

export const create = (deps) => createMojicast(deps, 'punct_bert.int8.onnx');
