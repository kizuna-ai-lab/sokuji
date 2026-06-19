/**
 * Node per-stage bench (#263 verification): same as bench-pocket-native.ts but
 * captures the core's per-stage timing line (tMain/tFlow/tDecode) at threads=1
 * for an apples-to-apples comparison against the web bench on the same machine.
 */
import { InferenceSession, Tensor } from 'onnxruntime-node';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  setPocketTensor, encodeReference, resampleTo24k, buildVoiceConditionedState, generate,
  parseNpyFloat32, type PocketSessions, type PocketMetadata, type PocketTensorCtor,
} from '../src/lib/local-inference/pocket/pocketInferenceCore';
import { PocketTokenizer } from '../src/lib/local-inference/pocket/pocketTokenizer';
import {
  POCKET_MODEL_STEMS, POCKET_SAMPLE_RATE, POCKET_METADATA_FILE,
  POCKET_TOKENIZER_FILE, POCKET_BOS_FILE, type PocketSessionId,
} from '../src/lib/local-inference/pocket/pocketBundle';

const MODEL_DIR = path.join(process.cwd(), 'public', 'wasm', 'pocket-tts-en');
const REF = path.join(process.cwd(), 'benchmark', 'test-speech-silence-speech.wav');
const TEXT = 'All processing is done locally on your device (CPU) within your browser '
  + 'with a single thread. No server is involved, ensuring privacy and security. '
  + 'You can disconnect from the Internet once this page is loaded.';
const THREADS = parseInt(process.env.THREADS || '1', 10);

const toAB = (b: Buffer): ArrayBuffer => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
function readWavMono(p: string) {
  const b = fs.readFileSync(p);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const numChannels = dv.getUint16(22, true); const sampleRate = dv.getUint32(24, true);
  const bps = dv.getUint16(34, true); let off = 12;
  while (off + 8 <= b.length) {
    const id = String.fromCharCode(b[off], b[off + 1], b[off + 2], b[off + 3]);
    const size = dv.getUint32(off + 4, true);
    if (id === 'data') {
      const start = off + 8; const n = Math.floor(size / (bps / 8) / numChannels);
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) { let acc = 0; for (let c = 0; c < numChannels; c++) acc += dv.getInt16(start + (i * numChannels + c) * 2, true) / 32768; out[i] = acc / numChannels; }
      return { samples: out, sampleRate };
    }
    off += 8 + size + (size & 1);
  }
  throw new Error('no data');
}

async function main() {
  setPocketTensor(Tensor as unknown as PocketTensorCtor);
  const meta = JSON.parse(fs.readFileSync(path.join(MODEL_DIR, POCKET_METADATA_FILE), 'utf8')) as PocketMetadata;
  const bos = meta.insert_bos_before_voice ? parseNpyFloat32(toAB(fs.readFileSync(path.join(MODEL_DIR, POCKET_BOS_FILE)))) : null;
  const tokenizer = new PocketTokenizer();
  await tokenizer.load(toAB(fs.readFileSync(path.join(MODEL_DIR, POCKET_TOKENIZER_FILE))));
  const ref = readWavMono(REF);
  const ref24 = resampleTo24k(ref.samples, ref.sampleRate);

  const opts: InferenceSession.SessionOptions = { executionProviders: ['cpu'], graphOptimizationLevel: 'all', intraOpNumThreads: THREADS, logSeverityLevel: 3 };
  const created: Partial<PocketSessions> = {};
  for (const id of Object.keys(POCKET_MODEL_STEMS) as PocketSessionId[]) created[id] = await InferenceSession.create(path.join(MODEL_DIR, POCKET_MODEL_STEMS[id]), opts) as never;
  const sessions = created as unknown as PocketSessions;

  const voiceEmb = await encodeReference(sessions, ref24);
  const flowState = await buildVoiceConditionedState(sessions, meta, voiceEmb, bos);
  const ids = tokenizer.encodeIds(TEXT);
  const tokenIds = new Tensor('int64', BigInt64Array.from(ids), [1, ids.length]);
  const tcOut = await sessions.textConditioner.run({ token_ids: tokenIds as unknown as never });
  const textEmbeddings = tcOut[sessions.textConditioner.outputNames[0]];

  console.log(`# node per-stage, threads=${THREADS}`);
  for (let rep = 0; rep < 3; rep++) {
    let stage = '';
    const t0 = performance.now();
    const samples = await generate(sessions, meta, textEmbeddings as never, { ...flowState }, { lsdSteps: 1, maxFrames: 500, speed: 1.0, log: (m) => { if (m.includes('generate')) stage = m; } });
    const genMs = performance.now() - t0;
    const audioSec = samples.length / POCKET_SAMPLE_RATE;
    console.log(`rep ${rep}: audioSec=${audioSec.toFixed(2)} genMs=${Math.round(genMs)} RTF=${(audioSec / (genMs / 1000)).toFixed(2)}`);
    console.log('  ' + stage);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
