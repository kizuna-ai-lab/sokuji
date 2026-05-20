/**
 * Supertonic 3 TTS Worker — ESM module worker.
 *
 * Loads onnxruntime-web (ESM WebGPU build) dynamically from the bundled
 * /wasm/ort/ directory. Runs a 4-stage diffusion TTS pipeline:
 *   text_encoder → duration_predictor → vector_estimator (×totalStep) → vocoder
 *
 * Protocol (Main → Worker):
 *   { type: 'init', fileUrls, voiceList, ortBaseUrl, ttsConfig }
 *   { type: 'generate', text, sid, speed, lang? }
 *   { type: 'dispose' }
 *
 * Protocol (Worker → Main):
 *   { type: 'ready', loadTimeMs, numSpeakers, sampleRate, voices, backend }
 *   { type: 'status', message }
 *   { type: 'result', samples: Float32Array, sampleRate, generationTimeMs }
 *   { type: 'error', error }
 *   { type: 'disposed' }
 */

async function fetchBlobAsJson(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to fetch ${url}: ${resp.status}`);
  return await resp.json();
}

async function fetchBlobAsArrayBuffer(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to fetch ${url}: ${resp.status}`);
  return await resp.arrayBuffer();
}

const MODEL_KEYS = [
  { key: 'dpOrt',         file: 'onnx/duration_predictor.onnx' },
  { key: 'textEncOrt',    file: 'onnx/text_encoder.onnx' },
  { key: 'vectorEstOrt',  file: 'onnx/vector_estimator.onnx' },
  { key: 'vocoderOrt',    file: 'onnx/vocoder.onnx' },
];

async function loadAllSessions(fileUrls, executionProvider) {
  const opts = {
    executionProviders: [executionProvider],
    graphOptimizationLevel: 'all',
  };
  const out = {};
  for (const { key, file } of MODEL_KEYS) {
    const url = fileUrls[file];
    if (!url) throw new Error(`Missing model file: ${file}`);
    const bytes = await fetchBlobAsArrayBuffer(url);
    out[key] = await ort.InferenceSession.create(bytes, opts);
    self.postMessage({
      type: 'status',
      message: `Loaded ${file} (${executionProvider})`,
    });
  }
  return out;
}

async function releaseSessions(sessionMap) {
  if (!sessionMap) return;
  for (const key of Object.keys(sessionMap)) {
    try {
      await sessionMap[key].release();
    } catch (e) {
      console.warn(`Supertonic worker: failed to release ${key}:`, e);
    }
  }
}

let ort = null;
let sessions = null;      // { dpOrt, textEncOrt, vectorEstOrt, vocoderOrt }
let voiceTensors = null;  // Map<sid, { styleTtl, styleDp, name, source, gender }>
let cfgs = null;          // tts.json contents
let indexer = null;       // unicode_indexer.json contents
let sampleRate = 44100;
let totalStep = 16;
let defaultSid = 7;
let backend = 'wasm';

self.onmessage = async (event) => {
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
    self.postMessage({ type: 'error', error: err && err.message ? err.message : String(err) });
  }
};

async function handleInit({ fileUrls, voiceList, ortBaseUrl, ttsConfig }) {
  const startTime = performance.now();

  // Normalize: strip trailing slash so concatenations like `+ '/ort.webgpu.min.mjs'`
  // don't produce a double slash if caller passes a trailing slash.
  if (ortBaseUrl.endsWith('/')) ortBaseUrl = ortBaseUrl.slice(0, -1);

  if (ttsConfig) {
    if (typeof ttsConfig.totalStep === 'number') totalStep = ttsConfig.totalStep;
    if (typeof ttsConfig.defaultSid === 'number') defaultSid = ttsConfig.defaultSid;
  }

  // Dynamic import of ORT WebGPU ESM bundle
  ort = await import(ortBaseUrl + '/ort.webgpu.min.mjs');
  ort.env.wasm.wasmPaths = ortBaseUrl + '/';
  ort.env.wasm.numThreads = 1;

  // Detect WebGPU availability (available in worker scope on Chromium 113+)
  const hasWebGPU = typeof self.navigator !== 'undefined'
    && typeof self.navigator.gpu !== 'undefined';
  backend = hasWebGPU ? 'webgpu' : 'wasm';

  self.postMessage({
    type: 'status',
    message: `Initializing Supertonic 3 (backend: ${backend})`,
  });

  // Load 4 ONNX sessions with WebGPU→WASM auto-fallback
  let ep = backend;
  try {
    sessions = await loadAllSessions(fileUrls, ep);
  } catch (err) {
    if (ep === 'webgpu') {
      self.postMessage({
        type: 'status',
        message: `WebGPU init failed (${err.message || err}), falling back to WASM`,
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

  // Load tts.json and unicode_indexer.json
  cfgs = await fetchBlobAsJson(fileUrls['onnx/tts.json']);
  indexer = await fetchBlobAsJson(fileUrls['onnx/unicode_indexer.json']);
  sampleRate = cfgs.ae.sample_rate;

  // (Task 9 inserts voice tensor parsing here)

  self.postMessage({
    type: 'ready',
    loadTimeMs: Math.round(performance.now() - startTime),
    numSpeakers: voiceList ? voiceList.length : 0,
    sampleRate,
    voices: (voiceList || []).map(v => ({
      sid: v.sid, name: v.name, source: v.source, gender: v.gender,
    })),
    backend,
  });
}

async function handleGenerate(_msg) {
  throw new Error('handleGenerate not implemented yet');
}

async function handleDispose() {
  if (sessions) {
    for (const key of Object.keys(sessions)) {
      try {
        await sessions[key].release();
      } catch (e) {
        console.warn(`Supertonic worker: failed to release ${key}:`, e);
      }
    }
    sessions = null;
  }
  voiceTensors = null;
  cfgs = null;
  indexer = null;
  self.postMessage({ type: 'disposed' });
}
