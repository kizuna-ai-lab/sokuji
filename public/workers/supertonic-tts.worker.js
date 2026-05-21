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

const AVAILABLE_LANGS = [
  'en','ko','ja','ar','bg','cs','da','de','el','es','et','fi','fr',
  'hi','hr','hu','id','it','lt','lv','nl','pl','pt','ro','ru','sk',
  'sl','sv','tr','uk','vi',
];

function jsonToFloat32Tensor(voiceField) {
  // voiceField shape: { data: nested arrays, dims: [d1, d2, d3] }
  const dims = voiceField.dims;
  if (!Array.isArray(dims)) throw new Error('voice JSON missing dims array');
  const flat = Array.isArray(voiceField.data) ? voiceField.data.flat(Infinity) : null;
  if (!flat) throw new Error('voice JSON data must be a (nested) array');
  return new ort.Tensor('float32', Float32Array.from(flat), dims);
}

async function loadVoiceTensorMap(voiceList) {
  const map = new Map();
  for (const v of voiceList || []) {
    try {
      const json = await fetchBlobAsJson(v.blobUrl);
      if (!json.style_ttl || !json.style_dp) {
        self.postMessage({
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
      self.postMessage({
        type: 'status',
        message: `Skipping voice ${v.name} (sid ${v.sid}): ${err.message || err}`,
      });
    }
  }
  return map;
}

async function loadAllSessions(fileUrls, executionProvider) {
  const opts = {
    executionProviders: [executionProvider],
    graphOptimizationLevel: 'all',
  };
  const out = {};
  try {
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
  } catch (err) {
    // Release any sessions that succeeded before the failure so we don't
    // pin GPU/WASM resources during the WebGPU→WASM fallback retry.
    await releaseSessions(out);
    throw err;
  }
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

  voiceTensors = await loadVoiceTensorMap(voiceList || []);

  // Recompute voices payload from the actually-loaded tensors so the UI
  // sees only voices that initialized successfully.
  const loadedVoices = [];
  for (const v of voiceList || []) {
    if (voiceTensors.has(v.sid)) {
      loadedVoices.push({
        sid: v.sid, name: v.name, source: v.source, gender: v.gender,
      });
    }
  }

  self.postMessage({
    type: 'ready',
    loadTimeMs: Math.round(performance.now() - startTime),
    numSpeakers: loadedVoices.length,
    sampleRate,
    voices: loadedVoices,
    backend,
  });
}

function intArrayToTensor(rows, shape) {
  const flat = rows.flat(Infinity).map(x => BigInt(x));
  return new ort.Tensor('int64', BigInt64Array.from(flat), shape);
}

function floatArrayToTensor(rows, shape) {
  const flat = rows.flat(Infinity);
  return new ort.Tensor('float32', Float32Array.from(flat), shape);
}

function sampleNoisyLatent(durationReshaped) {
  const baseChunkSize = cfgs.ae.base_chunk_size;
  const chunkCompressFactor = cfgs.ttl.chunk_compress_factor;
  const ldim = cfgs.ttl.latent_dim;

  const bsz = durationReshaped.length;
  const wavLenMax = Math.max(...durationReshaped.map(d => d[0][0])) * sampleRate;
  const wavLengths = durationReshaped.map(d => Math.floor(d[0][0] * sampleRate));
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

  const latentMask = wavLengths.map(len => {
    const validLen = Math.floor((len + chunkSize - 1) / chunkSize);
    const row = new Array(latentLen);
    for (let t = 0; t < latentLen; t++) row[t] = t < validLen ? 1.0 : 0.0;
    return [row];
  });

  return { latentBuffer, latentDim, latentLen, latentMask };
}

function preprocessText(text, lang) {
  text = text.normalize('NFKD');

  // Strip emoji (overlap with main-thread stripEmoji is intentional; this
  // is the official preprocess and we keep parity)
  text = text.replace(
    /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}]+/gu,
    '',
  );

  const replacements = {
    '–': '-', '‑': '-', '—': '-', '_': ' ',
    // Smart quotes → ASCII. Written as \u escapes because the literal
    // smart-quote chars can be collapsed to ASCII by some editors/clipboards
    // (which silently breaks this map: ASCII " → ASCII " is a no-op).
    '“': '"', '”': '"', '‘': "'", '’': "'",
    '´': "'", '`': "'",
    '[': ' ', ']': ' ', '|': ' ', '/': ' ', '#': ' ',
    '→': ' ', '←': ' ',
  };
  for (const [k, v] of Object.entries(replacements)) {
    text = text.replaceAll(k, v);
  }

  text = text.replace(/[♥☆♡©\\]/g, '');

  const exprReplacements = { '@': ' at ', 'e.g.,': 'for example,', 'i.e.,': 'that is,' };
  for (const [k, v] of Object.entries(exprReplacements)) {
    text = text.replaceAll(k, v);
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

  let effectiveLang = lang;
  if (lang && !AVAILABLE_LANGS.includes(lang)) {
    self.postMessage({
      type: 'status',
      message: `Language '${lang}' not supported; using language-agnostic mode (na)`,
    });
    effectiveLang = null;
  }
  text = effectiveLang ? `<${effectiveLang}>${text}</${effectiveLang}>` : `<na>${text}</na>`;

  return text;
}

function textToUnicodeValues(text) {
  return Array.from(text).map(ch => ch.charCodeAt(0));
}

function getTextMask(lengths) {
  const maxLen = Math.max(...lengths);
  return lengths.map(len => {
    const row = new Array(maxLen);
    for (let j = 0; j < maxLen; j++) row[j] = j < len ? 1.0 : 0.0;
    return [row];
  });
}

function applyIndexer(processedTexts) {
  const lengths = processedTexts.map(t => Array.from(t).length);
  const maxLen = Math.max(...lengths);
  const textIds = [];
  const unsupportedChars = new Set();
  for (let i = 0; i < processedTexts.length; i++) {
    const row = new Array(maxLen).fill(0);
    const codes = textToUnicodeValues(processedTexts[i]);
    for (let j = 0; j < codes.length; j++) {
      const idx = indexer[codes[j]];
      if (idx === undefined || idx === null || idx === -1) {
        unsupportedChars.add(Array.from(processedTexts[i])[j]);
        row[j] = 0;
      } else {
        row[j] = idx;
      }
    }
    textIds.push(row);
  }
  return { textIds, textMask: getTextMask(lengths), unsupportedChars: Array.from(unsupportedChars) };
}

async function handleGenerate({ text, sid, speed, lang }) {
  if (!sessions) throw new Error('Engine not initialized');

  const startTime = performance.now();

  // Look up voice tensors with sid fallback
  let voice = voiceTensors.get(sid);
  if (!voice) {
    self.postMessage({
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
    self.postMessage({
      type: 'status',
      message: `Unsupported characters skipped: ${unsupportedChars.map(c => `"${c}"`).join(', ')}`,
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
  const durOnnx = Array.from(dpResult.duration.data);
  const durationFactor = speed && speed > 0 ? 1.0 / speed : 1.0;
  for (let i = 0; i < durOnnx.length; i++) durOnnx[i] *= durationFactor;
  const durReshaped = [];
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
  const totalStepTensor = floatArrayToTensor([new Array(bsz).fill(totalStep)], scalarShape);
  const stepTensors = [];
  for (let step = 0; step < totalStep; step++) {
    stepTensors.push(floatArrayToTensor([new Array(bsz).fill(step)], scalarShape));
  }

  for (let step = 0; step < totalStep; step++) {
    const noisyLatentTensor = new ort.Tensor('float32', latentBuffer, latentShape);
    const r = await sessions.vectorEstOrt.run({
      noisy_latent:  noisyLatentTensor,
      text_emb:      textEmbTensor,
      style_ttl:     voice.styleTtl,
      text_mask:     textMaskTensor,
      latent_mask:   latentMaskTensor,
      total_step:    totalStepTensor,
      current_step:  stepTensors[step],
    });
    latentBuffer.set(r.denoised_latent.data);
  }

  // Stage 4: vocoder
  const vocoderResult = await sessions.vocoderOrt.run({
    latent: new ort.Tensor('float32', latentBuffer, latentShape),
  });
  const wavBatch = vocoderResult.wav_tts.data;
  const wavLen = Math.floor(sampleRate * durOnnx[0]);
  const samples = wavBatch.slice(0, wavLen);

  self.postMessage(
    { type: 'result', samples, sampleRate, generationTimeMs: Math.round(performance.now() - startTime) },
    [samples.buffer],
  );
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
