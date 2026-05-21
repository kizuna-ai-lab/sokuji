/**
 * Supertonic 3 TTS Worker — ES module worker bundled by Vite.
 *
 * Runs the 4-stage diffusion TTS pipeline:
 *   duration_predictor → text_encoder → vector_estimator (×totalStep) → vocoder
 *
 * Loaded by `TtsEngine.init` via `new Worker(new URL('...'), {type:'module'})`,
 * so Vite bundles ORT into this worker. The companion jsep WASM runtime is
 * served from `/wasm/ort/` (path passed in via the init message).
 *
 * Input messages:  SupertonicTtsWorkerInMessage (init | generate | dispose)
 * Output messages: TtsWorkerOutMessage (ready | status | result | error | disposed)
 */

import { InferenceSession, Tensor, env as ortEnv } from './_shared/onnxruntime-all';

import type {
  SupertonicTtsInitMessage,
  SupertonicTtsWorkerInMessage,
  SupertonicVoiceListEntry,
  TtsGenerateMessage,
  TtsWorkerOutMessage,
} from '../types';

// ─── Module-level state ──────────────────────────────────────────────────────

interface VoiceTensors {
  styleTtl: Tensor;
  styleDp: Tensor;
  name: string;
  source: 'preset' | 'imported';
  gender?: 'M' | 'F';
}

interface SessionMap {
  dpOrt: InferenceSession;
  textEncOrt: InferenceSession;
  vectorEstOrt: InferenceSession;
  vocoderOrt: InferenceSession;
}

interface VoiceFieldJson {
  data: unknown;       // nested float arrays — flattened via .flat(Infinity)
  dims: number[];
}

interface VoiceJson {
  style_ttl?: VoiceFieldJson;
  style_dp?: VoiceFieldJson;
}

interface SupertonicCfgs {
  ae: { sample_rate: number; base_chunk_size: number };
  ttl: { chunk_compress_factor: number; latent_dim: number };
}

let sessions: SessionMap | null = null;
let voiceTensors: Map<number, VoiceTensors> | null = null;
let cfgs: SupertonicCfgs | null = null;
let indexer: Record<string, number> | null = null;
let sampleRate = 44100;
let totalStep = 16;
let defaultSid = 7;
let backend: 'webgpu' | 'wasm' = 'wasm';

// ─── Constants ───────────────────────────────────────────────────────────────

const MODEL_KEYS: ReadonlyArray<{ key: keyof SessionMap; file: string }> = [
  { key: 'dpOrt',         file: 'onnx/duration_predictor.onnx' },
  { key: 'textEncOrt',    file: 'onnx/text_encoder.onnx' },
  { key: 'vectorEstOrt',  file: 'onnx/vector_estimator.onnx' },
  { key: 'vocoderOrt',    file: 'onnx/vocoder.onnx' },
];

const AVAILABLE_LANGS = new Set([
  'en','ko','ja','ar','bg','cs','da','de','el','es','et','fi','fr',
  'hi','hr','hu','id','it','lt','lv','nl','pl','pt','ro','ru','sk',
  'sl','sv','tr','uk','vi',
]);

// ─── Worker scope ────────────────────────────────────────────────────────────

const workerScope: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;

function post(msg: TtsWorkerOutMessage, transfer?: Transferable[]): void {
  if (transfer && transfer.length > 0) {
    workerScope.postMessage(msg, transfer);
  } else {
    workerScope.postMessage(msg);
  }
}

workerScope.onmessage = async (event: MessageEvent<SupertonicTtsWorkerInMessage>) => {
  const msg = event.data;
  try {
    switch (msg.type) {
      case 'init':
        await handleInit(msg);
        break;
      case 'generate':
        await handleGenerate(msg);
        break;
      case 'dispose':
        await handleDispose();
        break;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    post({ type: 'error', error: message });
  }
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function fetchBlobAsJson<T>(url: string): Promise<T> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to fetch ${url}: ${resp.status}`);
  return (await resp.json()) as T;
}

async function fetchBlobAsArrayBuffer(url: string): Promise<ArrayBuffer> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to fetch ${url}: ${resp.status}`);
  return await resp.arrayBuffer();
}

function jsonToFloat32Tensor(voiceField: VoiceFieldJson): Tensor {
  if (!Array.isArray(voiceField.dims)) {
    throw new Error('voice JSON missing dims array');
  }
  if (!Array.isArray(voiceField.data)) {
    throw new Error('voice JSON data must be a (nested) array');
  }
  const flat = (voiceField.data as unknown[]).flat(Infinity) as number[];
  return new Tensor('float32', Float32Array.from(flat), voiceField.dims);
}

async function loadVoiceTensorMap(
  voiceList: SupertonicVoiceListEntry[],
): Promise<Map<number, VoiceTensors>> {
  const map = new Map<number, VoiceTensors>();
  for (const v of voiceList) {
    try {
      const json = await fetchBlobAsJson<VoiceJson>(v.blobUrl);
      if (!json.style_ttl || !json.style_dp) {
        post({
          type: 'status',
          message: `Skipping voice ${v.name} (sid ${v.sid}): missing style_ttl/style_dp`,
        });
        continue;
      }
      map.set(v.sid, {
        styleTtl: jsonToFloat32Tensor(json.style_ttl),
        styleDp: jsonToFloat32Tensor(json.style_dp),
        name: v.name,
        source: v.source,
        gender: v.gender,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      post({
        type: 'status',
        message: `Skipping voice ${v.name} (sid ${v.sid}): ${message}`,
      });
    }
  }
  return map;
}

async function loadAllSessions(
  fileUrls: Record<string, string>,
  executionProvider: 'webgpu' | 'wasm',
): Promise<SessionMap> {
  const opts: InferenceSession.SessionOptions = {
    executionProviders: [executionProvider],
    graphOptimizationLevel: 'all',
    // Silence ORT's per-session "VerifyEachNodeIsAssignedToAnEp" warning that
    // fires whenever some ops fall back to CPU (always happens with WebGPU
    // models — shape ops etc.). 0=verbose, 1=info, 2=warning(default), 3=error.
    logSeverityLevel: 3,
  };
  const out: Partial<SessionMap> = {};
  try {
    for (const { key, file } of MODEL_KEYS) {
      const url = fileUrls[file];
      if (!url) throw new Error(`Missing model file: ${file}`);
      const bytes = await fetchBlobAsArrayBuffer(url);
      out[key] = await InferenceSession.create(bytes, opts);
      post({
        type: 'status',
        message: `Loaded ${file} (${executionProvider})`,
      });
    }
    return out as SessionMap;
  } catch (err) {
    // Release any sessions that succeeded before the failure so we don't
    // pin GPU/WASM resources during the WebGPU→WASM fallback retry.
    await releaseSessions(out as Partial<SessionMap>);
    throw err;
  }
}

async function releaseSessions(
  sessionMap: Partial<SessionMap> | null,
): Promise<void> {
  if (!sessionMap) return;
  for (const key of Object.keys(sessionMap) as Array<keyof SessionMap>) {
    const sess = sessionMap[key];
    if (!sess) continue;
    try {
      await sess.release();
    } catch (e) {
      console.warn(`Supertonic worker: failed to release ${key}:`, e);
    }
  }
}

// ─── Init handler ────────────────────────────────────────────────────────────

async function handleInit(msg: SupertonicTtsInitMessage): Promise<void> {
  const startTime = performance.now();
  const { fileUrls, voiceList, ortWasmBaseUrl, ttsConfig } = msg;

  if (typeof ttsConfig?.totalStep === 'number') totalStep = ttsConfig.totalStep;
  if (typeof ttsConfig?.defaultSid === 'number') defaultSid = ttsConfig.defaultSid;

  // Point ORT at the bundled /wasm/ort/ runtime (jsep .wasm + .mjs). The
  // trailing slash matches the existing whisper-webgpu / voxtral-webgpu
  // workers — modern ORT handles both, but parity is nice.
  ortEnv.wasm.wasmPaths = ortWasmBaseUrl;
  ortEnv.wasm.numThreads = 1;

  // WebGPU is available in worker scope on Chromium 113+ via `self.navigator.gpu`.
  // TS lib.webworker.d.ts doesn't yet declare `gpu` on WorkerNavigator, so cast.
  const hasWebGPU = typeof workerScope.navigator !== 'undefined'
    && typeof (workerScope.navigator as unknown as { gpu?: unknown }).gpu !== 'undefined';
  backend = hasWebGPU ? 'webgpu' : 'wasm';

  post({
    type: 'status',
    message: `Initializing Supertonic 3 (backend: ${backend})`,
  });

  // Load 4 ONNX sessions with WebGPU→WASM auto-fallback.
  let ep: 'webgpu' | 'wasm' = backend;
  try {
    sessions = await loadAllSessions(fileUrls, ep);
  } catch (err) {
    if (ep === 'webgpu') {
      const message = err instanceof Error ? err.message : String(err);
      post({
        type: 'status',
        message: `WebGPU init failed (${message}), falling back to WASM`,
      });
      await releaseSessions(sessions);
      sessions = null;
      ep = 'wasm';
      backend = 'wasm';
      sessions = await loadAllSessions(fileUrls, ep);
    } else {
      throw err;
    }
  }

  cfgs = await fetchBlobAsJson<SupertonicCfgs>(fileUrls['onnx/tts.json']);
  indexer = await fetchBlobAsJson<Record<string, number>>(fileUrls['onnx/unicode_indexer.json']);
  sampleRate = cfgs.ae.sample_rate;

  voiceTensors = await loadVoiceTensorMap(voiceList);

  // Recompute voices payload from the actually-loaded tensors so the UI
  // sees only voices that initialized successfully.
  const loadedVoices = voiceList
    .filter((v) => voiceTensors!.has(v.sid))
    .map((v) => ({ sid: v.sid, name: v.name, source: v.source, gender: v.gender }));

  post({
    type: 'ready',
    loadTimeMs: Math.round(performance.now() - startTime),
    numSpeakers: loadedVoices.length,
    sampleRate,
    voices: loadedVoices,
    backend,
  });
}

// ─── Generate pipeline ───────────────────────────────────────────────────────

function intArrayToTensor(rows: number[][], shape: number[]): Tensor {
  const flat = rows.flat(Infinity).map((x) => BigInt(x as number));
  return new Tensor('int64', BigInt64Array.from(flat), shape);
}

function floatArrayToTensor(rows: number[] | number[][] | number[][][], shape: number[]): Tensor {
  const flat = (rows as unknown[]).flat(Infinity) as number[];
  return new Tensor('float32', Float32Array.from(flat), shape);
}

function sampleNoisyLatent(durationReshaped: number[][][]): {
  latentBuffer: Float32Array;
  latentDim: number;
  latentLen: number;
  latentMask: number[][][];
} {
  if (!cfgs) throw new Error('cfgs not loaded');
  const baseChunkSize = cfgs.ae.base_chunk_size;
  const chunkCompressFactor = cfgs.ttl.chunk_compress_factor;
  const ldim = cfgs.ttl.latent_dim;

  const bsz = durationReshaped.length;
  const wavLenMax = Math.max(...durationReshaped.map((d) => d[0][0])) * sampleRate;
  const wavLengths = durationReshaped.map((d) => Math.floor(d[0][0] * sampleRate));
  const chunkSize = baseChunkSize * chunkCompressFactor;
  const latentLen = Math.floor((wavLenMax + chunkSize - 1) / chunkSize);
  const latentDim = ldim * chunkCompressFactor;

  const latentBuffer = new Float32Array(bsz * latentDim * latentLen);
  let idx = 0;
  for (let b = 0; b < bsz; b++) {
    const validLen = Math.floor((wavLengths[b] + chunkSize - 1) / chunkSize);
    for (let d = 0; d < latentDim; d++) {
      for (let t = 0; t < latentLen; t++) {
        if (t < validLen) {
          const u1 = Math.random(), u2 = Math.random();
          latentBuffer[idx++] = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
        } else {
          latentBuffer[idx++] = 0;
        }
      }
    }
  }

  const latentMask: number[][][] = wavLengths.map((len) => {
    const validLen = Math.floor((len + chunkSize - 1) / chunkSize);
    const row = new Array<number>(latentLen);
    for (let t = 0; t < latentLen; t++) row[t] = t < validLen ? 1.0 : 0.0;
    return [row];
  });

  return { latentBuffer, latentDim, latentLen, latentMask };
}

function preprocessText(text: string, lang: string | undefined): string {
  text = text.normalize('NFKD');

  // Strip emoji (overlap with main-thread stripEmoji is intentional; this
  // is the official preprocess and we keep parity)
  text = text.replace(
    /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}]+/gu,
    '',
  );

  const replacements: Record<string, string> = {
    '–': '-', '‑': '-', '—': '-', '_': ' ',
    // Smart quotes → ASCII. Written as actual chars (not escapes) — but be
    // careful editing this in tools that auto-normalize quotes: the file is
    // UTF-8 and the JS engine reads them as their actual codepoints.
    '“': '"', '”': '"', '‘': "'", '’': "'",
    '´': "'", '`': "'",
    '[': ' ', ']': ' ', '|': ' ', '/': ' ', '#': ' ',
    '→': ' ', '←': ' ',
  };
  for (const [k, v] of Object.entries(replacements)) {
    text = text.split(k).join(v);
  }

  text = text.replace(/[♥☆♡©\\]/g, '');

  const exprReplacements: Record<string, string> = {
    '@': ' at ', 'e.g.,': 'for example,', 'i.e.,': 'that is,',
  };
  for (const [k, v] of Object.entries(exprReplacements)) {
    text = text.split(k).join(v);
  }

  text = text.replace(/ ,/g, ',').replace(/ \./g, '.').replace(/ !/g, '!')
             .replace(/ \?/g, '?').replace(/ ;/g, ';').replace(/ :/g, ':')
             .replace(/ '/g, "'");
  while (text.includes('""')) text = text.replace(/""/g, '"');
  while (text.includes("''")) text = text.replace(/''/g, "'");
  while (text.includes('``')) text = text.replace(/``/g, '`');
  text = text.replace(/\s+/g, ' ').trim();

  if (!/[.!?;:,'")\]}…。」』】〉》›»]$/.test(text)) {
    text += '.';
  }

  let effectiveLang: string | null = lang ?? null;
  if (lang && !AVAILABLE_LANGS.has(lang)) {
    post({
      type: 'status',
      message: `Language '${lang}' not supported; using language-agnostic mode (na)`,
    });
    effectiveLang = null;
  }
  text = effectiveLang ? `<${effectiveLang}>${text}</${effectiveLang}>` : `<na>${text}</na>`;

  return text;
}

function textToUnicodeValues(text: string): number[] {
  return Array.from(text).map((ch) => ch.charCodeAt(0));
}

function getTextMask(lengths: number[]): number[][][] {
  const maxLen = Math.max(...lengths);
  return lengths.map((len) => {
    const row = new Array<number>(maxLen);
    for (let j = 0; j < maxLen; j++) row[j] = j < len ? 1.0 : 0.0;
    return [row];
  });
}

function applyIndexer(processedTexts: string[]): {
  textIds: number[][];
  textMask: number[][][];
  unsupportedChars: string[];
} {
  if (!indexer) throw new Error('indexer not loaded');
  const lengths = processedTexts.map((t) => Array.from(t).length);
  const maxLen = Math.max(...lengths);
  const textIds: number[][] = [];
  const unsupportedChars = new Set<string>();
  for (let i = 0; i < processedTexts.length; i++) {
    const row = new Array<number>(maxLen).fill(0);
    const codes = textToUnicodeValues(processedTexts[i]);
    const chars = Array.from(processedTexts[i]);
    for (let j = 0; j < codes.length; j++) {
      const idx = indexer[String(codes[j])];
      if (idx === undefined || idx === null || idx === -1) {
        unsupportedChars.add(chars[j]);
        row[j] = 0;
      } else {
        row[j] = idx;
      }
    }
    textIds.push(row);
  }
  return { textIds, textMask: getTextMask(lengths), unsupportedChars: Array.from(unsupportedChars) };
}

async function handleGenerate(msg: TtsGenerateMessage): Promise<void> {
  if (!sessions) throw new Error('Engine not initialized');
  if (!voiceTensors) throw new Error('Voices not loaded');

  const { text, sid, speed, lang } = msg;
  const startTime = performance.now();

  // Look up voice tensors with sid fallback
  let voice = voiceTensors.get(sid);
  if (!voice) {
    post({
      type: 'status',
      message: `sid ${sid} not loaded; falling back to default sid ${defaultSid}`,
    });
    voice = voiceTensors.get(defaultSid);
    if (!voice) {
      throw new Error('Default voice not available — engine misconfigured');
    }
  }

  const processed = preprocessText(text, lang);
  const { textIds, textMask, unsupportedChars } = applyIndexer([processed]);
  if (unsupportedChars.length > 0) {
    post({
      type: 'status',
      message: `Unsupported characters skipped: ${unsupportedChars.map((c) => `"${c}"`).join(', ')}`,
    });
  }

  const bsz = 1;
  const textIdsShape = [bsz, textIds[0].length];
  const textMaskShape = [bsz, 1, textMask[0][0].length];
  const textMaskTensor = floatArrayToTensor(textMask, textMaskShape);

  // Stage 1: duration predictor
  const dpResult = await sessions.dpOrt.run({
    text_ids:  intArrayToTensor(textIds, textIdsShape),
    style_dp:  voice.styleDp,
    text_mask: textMaskTensor,
  });
  const durOnnx = Array.from(dpResult.duration.data as Float32Array);
  const durationFactor = speed && speed > 0 ? 1.0 / speed : 1.0;
  for (let i = 0; i < durOnnx.length; i++) durOnnx[i] *= durationFactor;
  const durReshaped: number[][][] = [];
  for (let b = 0; b < bsz; b++) durReshaped.push([[durOnnx[b]]]);

  // Stage 2: text encoder
  const textEncResult = await sessions.textEncOrt.run({
    text_ids:  intArrayToTensor(textIds, textIdsShape),
    style_ttl: voice.styleTtl,
    text_mask: textMaskTensor,
  });
  const textEmbTensor = textEncResult.text_emb;

  // Stage 3: diffusion (totalStep iterations of vector_estimator)
  const { latentBuffer, latentDim, latentLen, latentMask } = sampleNoisyLatent(durReshaped);
  const latentShape = [bsz, latentDim, latentLen];
  const latentMaskShape = [bsz, 1, latentMask[0][0].length];
  const latentMaskTensor = floatArrayToTensor(latentMask, latentMaskShape);

  const scalarShape = [bsz];
  const totalStepTensor = floatArrayToTensor([new Array<number>(bsz).fill(totalStep)], scalarShape);
  const stepTensors: Tensor[] = [];
  for (let step = 0; step < totalStep; step++) {
    stepTensors.push(floatArrayToTensor([new Array<number>(bsz).fill(step)], scalarShape));
  }

  for (let step = 0; step < totalStep; step++) {
    const noisyLatentTensor = new Tensor('float32', latentBuffer, latentShape);
    const r = await sessions.vectorEstOrt.run({
      noisy_latent:  noisyLatentTensor,
      text_emb:      textEmbTensor,
      style_ttl:     voice.styleTtl,
      text_mask:     textMaskTensor,
      latent_mask:   latentMaskTensor,
      total_step:    totalStepTensor,
      current_step:  stepTensors[step],
    });
    latentBuffer.set(r.denoised_latent.data as Float32Array);
  }

  // Stage 4: vocoder
  const vocoderResult = await sessions.vocoderOrt.run({
    latent: new Tensor('float32', latentBuffer, latentShape),
  });
  const wavBatch = vocoderResult.wav_tts.data as Float32Array;
  const wavLen = Math.floor(sampleRate * durOnnx[0]);
  const samples = wavBatch.slice(0, wavLen);

  post(
    { type: 'result', samples, sampleRate, generationTimeMs: Math.round(performance.now() - startTime) },
    [samples.buffer],
  );
}

async function handleDispose(): Promise<void> {
  if (sessions) {
    await releaseSessions(sessions);
    sessions = null;
  }
  voiceTensors = null;
  cfgs = null;
  indexer = null;
  post({ type: 'disposed' });
}
