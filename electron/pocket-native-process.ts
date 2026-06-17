/**
 * Pocket TTS native runtime — Electron utilityProcess (Node context).
 * Runs pocketInferenceCore on onnxruntime-node (native CPU), driven by main.js over
 * parentPort. Dev PoC: model files read from disk (modelDir passed in the init message).
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
import type { StateMap } from '../src/lib/local-inference/pocket/pocketState';

setPocketTensor(Tensor as unknown as PocketTensorCtor);

const parentPort = (process as unknown as {
  parentPort: { on(ev: 'message', cb: (e: { data: any }) => void): void; postMessage(msg: any): void };
}).parentPort;

let sessions: PocketSessions | null = null;
let meta: PocketMetadata | null = null;
let tokenizer: PocketTokenizer | null = null;
let cachedFlowState: StateMap | null = null;
let bos: Float32Array | null = null;

const toAB = (b: Buffer): ArrayBuffer => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);

async function loadSessions(modelDir: string): Promise<PocketSessions> {
  const opts: InferenceSession.SessionOptions = {
    executionProviders: ['cpu'], graphOptimizationLevel: 'all', logSeverityLevel: 3,
  };
  const created: Partial<PocketSessions> = {};
  for (const id of Object.keys(POCKET_MODEL_STEMS) as PocketSessionId[]) {
    created[id] = await InferenceSession.create(path.join(modelDir, POCKET_MODEL_STEMS[id]), opts) as never;
  }
  return created as unknown as PocketSessions;
}

async function handleInit(modelDir: string) {
  const start = Date.now();
  sessions = await loadSessions(modelDir);
  meta = JSON.parse(fs.readFileSync(path.join(modelDir, POCKET_METADATA_FILE), 'utf8')) as PocketMetadata;
  bos = meta.insert_bos_before_voice
    ? parseNpyFloat32(toAB(fs.readFileSync(path.join(modelDir, POCKET_BOS_FILE))))
    : null;
  tokenizer = new PocketTokenizer();
  await tokenizer.load(toAB(fs.readFileSync(path.join(modelDir, POCKET_TOKENIZER_FILE))));
  return { loadTimeMs: Date.now() - start, sampleRate: POCKET_SAMPLE_RATE, numSpeakers: 1 };
}

async function handleGenerate(msg: any) {
  if (!sessions || !meta || !tokenizer) throw new Error('Pocket native engine not initialized');
  const start = Date.now();
  if (msg.referenceAudio && !msg.useCachedVoice) {
    const ref24 = resampleTo24k(msg.referenceAudio as Float32Array, msg.referenceSampleRate ?? POCKET_SAMPLE_RATE);
    const voiceEmb = await encodeReference(sessions, ref24);
    cachedFlowState = await buildVoiceConditionedState(sessions, meta, voiceEmb, bos);
  }
  if (!cachedFlowState) throw new Error('No reference voice set');
  const ids = tokenizer.encodeIds(msg.text);
  const tokenIds = new Tensor('int64', BigInt64Array.from(ids), [1, ids.length]);
  const tcOut = await sessions.textConditioner.run({ token_ids: tokenIds as unknown as never });
  const textEmbeddings = tcOut[sessions.textConditioner.outputNames[0]];
  const samples = await generate(
    sessions, meta, textEmbeddings as never, { ...cachedFlowState },
    { lsdSteps: 1, maxFrames: 500, speed: msg.speed ?? 1.0, log: (m) => console.log(m) },
  );
  return { samples, sampleRate: POCKET_SAMPLE_RATE, generationTimeMs: Date.now() - start };
}

parentPort.on('message', async (e) => {
  const msg = e.data;
  try {
    let result;
    if (msg.type === 'init') result = await handleInit(msg.modelDir);
    else if (msg.type === 'generate') result = await handleGenerate(msg);
    else throw new Error(`unknown message type: ${msg.type}`);
    parentPort.postMessage({ id: msg.id, result });
  } catch (err) {
    parentPort.postMessage({ id: msg.id, error: err instanceof Error ? err.message : String(err) });
  }
});
