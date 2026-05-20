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

  // ... ONNX session loading happens in Task 8
  // ... voice tensor parsing happens in Task 9
  // ... ready message posting happens in Task 9

  // PLACEHOLDER FOR SCAFFOLD: report a partial ready so we can wire up
  // main↔worker before the model loading is complete. Will be replaced
  // in Task 9.
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
