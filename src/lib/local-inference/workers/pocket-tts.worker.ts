/**
 * Pocket TTS worker — Vite-bundled ES module on onnxruntime-web.
 * Loads 5 ONNX sessions + SentencePiece tokenizer + state metadata, encodes a
 * reference voice to an embedding, and runs the autoregressive generate loop.
 * WebGPU with automatic WASM fallback (mirrors supertonic-tts.worker.ts).
 */
import { InferenceSession, Tensor, env as ortEnv } from './_shared/onnxruntime-all';
import type {
  PocketTtsInitMessage, PocketTtsGenerateMessage, PocketTtsWorkerInMessage,
  TtsWorkerOutMessage,
} from '../types';
import {
  POCKET_MODEL_STEMS, POCKET_SAMPLE_RATE, POCKET_METADATA_FILE, POCKET_TOKENIZER_FILE,
  POCKET_BOS_FILE,
  type PocketSessionId,
} from '../pocket/pocketBundle';
import { PocketTokenizer } from '../pocket/pocketTokenizer';
import {
  encodeReference, resampleTo24k, buildVoiceConditionedState, generate, parseNpyFloat32,
  type PocketSessions, type PocketMetadata,
} from '../pocket/pocketInferenceCore';
import type { StateMap } from '../pocket/pocketState';

let sessions: PocketSessions | null = null;
let meta: PocketMetadata | null = null;
let tokenizer: PocketTokenizer | null = null;
let cachedFlowState: StateMap | null = null;
let bosBeforeVoice: Float32Array | null = null;
let lsdSteps = 1;
let maxFrames = 500;
let backend: 'webgpu' | 'wasm' = 'wasm';

const workerScope = self as unknown as DedicatedWorkerGlobalScope;
function post(msg: TtsWorkerOutMessage, transfer?: Transferable[]) {
  if (transfer?.length) workerScope.postMessage(msg, transfer);
  else workerScope.postMessage(msg);
}

workerScope.onmessage = async (e: MessageEvent<PocketTtsWorkerInMessage>) => {
  try {
    if (e.data.type === 'init') await handleInit(e.data);
    else if (e.data.type === 'generate') await handleGenerate(e.data);
    else if (e.data.type === 'dispose') { sessions = null; tokenizer = null; cachedFlowState = null; bosBeforeVoice = null; post({ type: 'disposed' }); }
  } catch (err) {
    post({ type: 'error', error: err instanceof Error ? err.message : String(err) });
  }
};

async function fetchBuf(url: string): Promise<ArrayBuffer> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch ${url}: ${r.status}`);
  return r.arrayBuffer();
}

async function loadSessions(
  fileUrls: Record<string, string>, ep: 'webgpu' | 'wasm',
): Promise<PocketSessions> {
  const opts: InferenceSession.SessionOptions = {
    executionProviders: [ep], graphOptimizationLevel: 'all', logSeverityLevel: 3,
  };
  const ids = Object.keys(POCKET_MODEL_STEMS) as PocketSessionId[];
  const created: Partial<PocketSessions> = {};
  for (const id of ids) {
    const file = POCKET_MODEL_STEMS[id];
    const url = fileUrls[file];
    if (!url) throw new Error(`Missing bundle file: ${file}`);
    created[id] = await InferenceSession.create(await fetchBuf(url), opts);
    post({ type: 'status', message: `Loaded ${file} (${ep})` });
  }
  return created as PocketSessions;
}

async function handleInit(msg: PocketTtsInitMessage) {
  const start = performance.now();
  ortEnv.wasm.wasmPaths = msg.ortWasmBaseUrl;
  // Single-threaded: ORT-web multi-threaded WASM does NOT work inside this Vite-bundled
  // *module* worker — the Emscripten pthread sub-worker (a worker spawning a worker)
  // fails to start ("worker sent an error"), even when the page is cross-origin
  // isolated. Real CPU threading needs a CLASSIC worker that importScripts() the ORT
  // runtime (as sokuji's sherpa workers and KevinAHM's demo do). Tracked as a follow-up.
  ortEnv.wasm.numThreads = 1;
  lsdSteps = msg.ttsConfig.lsdSteps ?? 1;
  maxFrames = msg.ttsConfig.maxFrames ?? 500;

  backend = 'wasm';
  const isolated = (workerScope as unknown as { crossOriginIsolated?: boolean }).crossOriginIsolated ?? false;
  post({
    type: 'status',
    message: `Initializing Pocket TTS (wasm, threads: ${ortEnv.wasm.numThreads}, crossOriginIsolated: ${isolated})`,
  });

  sessions = await loadSessions(msg.fileUrls, 'wasm');

  meta = JSON.parse(new TextDecoder().decode(await fetchBuf(msg.fileUrls[POCKET_METADATA_FILE]))) as PocketMetadata;
  if (meta.insert_bos_before_voice && msg.fileUrls[POCKET_BOS_FILE]) {
    bosBeforeVoice = parseNpyFloat32(await fetchBuf(msg.fileUrls[POCKET_BOS_FILE]));
  }
  tokenizer = new PocketTokenizer();
  await tokenizer.load(await fetchBuf(msg.fileUrls[POCKET_TOKENIZER_FILE]));

  post({
    type: 'ready', loadTimeMs: Math.round(performance.now() - start),
    numSpeakers: 1, sampleRate: POCKET_SAMPLE_RATE, backend,
  });
}

async function handleGenerate(msg: PocketTtsGenerateMessage) {
  if (!sessions || !meta || !tokenizer) throw new Error('Pocket engine not initialized');
  const start = performance.now();

  // (Re)build the voice-conditioned flow state from a new reference, or reuse cache.
  if (msg.referenceAudio && !msg.useCachedVoice) {
    const samples24k = resampleTo24k(msg.referenceAudio, msg.referenceSampleRate ?? POCKET_SAMPLE_RATE);
    const voiceEmb = await encodeReference(sessions, samples24k);
    cachedFlowState = await buildVoiceConditionedState(sessions, meta, voiceEmb, bosBeforeVoice);
  }
  if (!cachedFlowState) throw new Error('No reference voice set');

  // Tokenize → text_conditioner → text_embeddings, then generate.
  const ids = tokenizer.encodeIds(msg.text);
  const tokenIds = new Tensor('int64', BigInt64Array.from(ids), [1, ids.length]);
  const tcOut = await sessions.textConditioner.run({ token_ids: tokenIds });
  const textEmbeddings = tcOut[sessions.textConditioner.outputNames[0]] as Tensor;

  const samples = await generate(
    sessions, meta, textEmbeddings, { ...cachedFlowState },
    { lsdSteps, maxFrames, speed: msg.speed },
  );

  post(
    { type: 'result', samples, sampleRate: POCKET_SAMPLE_RATE, generationTimeMs: Math.round(performance.now() - start) },
    [samples.buffer],
  );
}
