/**
 * TTS Worker — Classic Web Worker (not ES module) for sherpa-onnx WASM.
 *
 * Uses importScripts() to load Emscripten glue code + sherpa-onnx TTS JS API.
 * Builds engine-specific configs based on each model's engine type,
 * following the patterns from the model-packs/tts demo pages.
 *
 * Protocol:
 *   Main → Worker:
 *     { type: 'init', fileUrls: Record<string, string>, modelFile: string, engine: string, ttsConfig: object }
 *     { type: 'generate', text: string, sid: number, speed: number }
 *     { type: 'dispose' }
 *
 *   Worker → Main:
 *     { type: 'ready', loadTimeMs: number, numSpeakers: number, sampleRate: number }
 *     { type: 'status', message: string }
 *     { type: 'result', samples: Float32Array, sampleRate: number, generationTimeMs: number }
 *     { type: 'error', error: string }
 *     { type: 'disposed' }
 */

// State
var tts = null;
var isReady = false;

// ─── Per-Engine Config Builders ─────────────────────────────────────────────
//
// Each builder returns the full config object for createOfflineTts(Module, config).
// Patterns reference model-packs/tts/{engine}.html demo pages.

/**
 * Base config shell — all engines share these outer fields.
 * The engine-specific builder fills in offlineTtsModelConfig.
 */
function baseConfig(modelConfig, ruleFsts, ruleFars) {
  return {
    offlineTtsModelConfig: Object.assign({
      numThreads: 1,
      debug: 1,
      provider: 'cpu',
    }, modelConfig),
    ruleFsts: ruleFsts || '',
    ruleFars: ruleFars || '',
    maxNumSentences: 1,
  };
}

/** Empty VITS config section (required when other VITS-type fields are populated). */
function emptyVits() {
  return {
    offlineTtsVitsModelConfig: {
      model: '', lexicon: '', tokens: '', dataDir: '',
      noiseScale: 0.667, noiseScaleW: 0.8, lengthScale: 1.0,
    },
  };
}

/** Empty Matcha config section. */
function emptyMatcha() {
  return {
    offlineTtsMatchaModelConfig: {
      acousticModel: '', vocoder: '', lexicon: '', tokens: '', dataDir: '',
      noiseScale: 0.667, lengthScale: 1.0,
    },
  };
}

/** Empty Kokoro config section. */
function emptyKokoro() {
  return {
    offlineTtsKokoroModelConfig: {
      model: '', voices: '', tokens: '', dataDir: '',
      lengthScale: 1.0, lexicon: '', lang: '',
    },
  };
}

/** Empty Kitten config section. */
function emptyKitten() {
  return {
    offlineTtsKittenModelConfig: {
      model: '', voices: '', tokens: '', dataDir: '',
      lengthScale: 1.0,
    },
  };
}

// ─── Piper (piper.html) ─────────────────────────────────────────────────────
// VITS engine with custom .onnx filename, espeak-ng phonemizer.
function buildPiperConfig(modelFile) {
  return baseConfig({
    offlineTtsVitsModelConfig: {
      model: './' + modelFile,
      lexicon: '',
      tokens: './tokens.txt',
      dataDir: './espeak-ng-data',
      noiseScale: 0.667,
      noiseScaleW: 0.8,
      lengthScale: 1.0,
    },
    ...emptyMatcha(),
    ...emptyKokoro(),
    ...emptyKitten(),
  });
}

// ─── Coqui (coqui.html) ────────────────────────────────────────────────────
// VITS engine, always model.onnx. Non-English: grapheme-based (no espeak).
// English variants would use espeak-ng-data, but we handle via ttsConfig.dataDir.
function buildCoquiConfig(ttsConfig) {
  return baseConfig({
    offlineTtsVitsModelConfig: {
      model: './model.onnx',
      lexicon: '',
      tokens: './tokens.txt',
      dataDir: (ttsConfig && ttsConfig.dataDir) || '',
      noiseScale: 0.667,
      noiseScaleW: 0.8,
      lengthScale: 1.0,
    },
    ...emptyMatcha(),
    ...emptyKokoro(),
    ...emptyKitten(),
  });
}

// ─── Mimic3 (mimic3.html) ──────────────────────────────────────────────────
// VITS engine with unique .onnx filenames, always espeak-ng phonemizer.
function buildMimic3Config(modelFile) {
  return baseConfig({
    offlineTtsVitsModelConfig: {
      model: './' + modelFile,
      lexicon: '',
      tokens: './tokens.txt',
      dataDir: './espeak-ng-data',
      noiseScale: 0.667,
      noiseScaleW: 0.8,
      lengthScale: 1.0,
    },
    ...emptyMatcha(),
    ...emptyKokoro(),
    ...emptyKitten(),
  });
}

// ─── MMS (mms.html) ────────────────────────────────────────────────────────
// VITS engine, always model.onnx, grapheme-based (no espeak-ng, no dataDir).
function buildMmsConfig() {
  return baseConfig({
    offlineTtsVitsModelConfig: {
      model: './model.onnx',
      lexicon: '',
      tokens: './tokens.txt',
      dataDir: '',
      noiseScale: 0.667,
      noiseScaleW: 0.8,
      lengthScale: 1.0,
    },
    ...emptyMatcha(),
    ...emptyKokoro(),
    ...emptyKitten(),
  });
}

// ─── Matcha (matcha.html) ───────────────────────────────────────────────────
// Uses offlineTtsMatchaModelConfig with separate acoustic model + vocoder.
// Config fields come from ttsConfig in the manifest.
function buildMatchaConfig(ttsConfig) {
  return baseConfig({
    ...emptyVits(),
    offlineTtsMatchaModelConfig: {
      acousticModel: ttsConfig.acousticModel || './model-steps-3.onnx',
      vocoder: ttsConfig.vocoder || './vocos-22khz-univ.onnx',
      lexicon: ttsConfig.lexicon || '',
      tokens: './tokens.txt',
      dataDir: ttsConfig.dataDir || '',
      noiseScale: 0.667,
      lengthScale: 1.0,
    },
    ...emptyKokoro(),
    ...emptyKitten(),
  }, ttsConfig.ruleFsts);
}

// ─── Kokoro (kokoro.html) ───────────────────────────────────────────────────
// Uses offlineTtsKokoroModelConfig with voices.bin + optional lexicons.
function buildKokoroConfig(modelFile, ttsConfig) {
  return baseConfig({
    ...emptyVits(),
    ...emptyMatcha(),
    offlineTtsKokoroModelConfig: {
      model: './' + (modelFile || 'model.int8.onnx'),
      voices: './voices.bin',
      tokens: './tokens.txt',
      dataDir: './espeak-ng-data',
      lengthScale: 1.0,
      lexicon: (ttsConfig && ttsConfig.lexicon) || '',
      lang: '',
    },
    ...emptyKitten(),
  }, (ttsConfig && ttsConfig.ruleFsts) || '');
}

// ─── VITS Special (vits.html) ───────────────────────────────────────────────
// Advanced VITS models with lexicon, dictDir, ruleFsts, ruleFars.
// Used for: Cantonese, Icefall, MeloTTS, zh-ll.
function buildVitsConfig(modelFile, ttsConfig) {
  return baseConfig({
    offlineTtsVitsModelConfig: {
      model: './' + (modelFile || 'model.onnx'),
      lexicon: (ttsConfig && ttsConfig.lexicon) || '',
      tokens: './tokens.txt',
      dataDir: (ttsConfig && ttsConfig.dataDir) || '',
      dictDir: (ttsConfig && ttsConfig.dictDir) || '',
      noiseScale: 0.667,
      noiseScaleW: 0.8,
      lengthScale: 1.0,
    },
    ...emptyMatcha(),
    ...emptyKokoro(),
    ...emptyKitten(),
  }, (ttsConfig && ttsConfig.ruleFsts) || '', (ttsConfig && ttsConfig.ruleFars) || '');
}

// ─── Engine Router ──────────────────────────────────────────────────────────

/**
 * Build the sherpa-onnx config for createOfflineTts based on engine type.
 */
function buildEngineConfig(engine, modelFile, ttsConfig) {
  switch (engine) {
    case 'piper':
      return buildPiperConfig(modelFile);
    case 'coqui':
      return buildCoquiConfig(ttsConfig);
    case 'mimic3':
      return buildMimic3Config(modelFile);
    case 'mms':
      return buildMmsConfig();
    case 'matcha':
      return buildMatchaConfig(ttsConfig || {});
    case 'kokoro':
      return buildKokoroConfig(modelFile, ttsConfig);
    case 'vits':
      return buildVitsConfig(modelFile, ttsConfig);
    default:
      throw new Error('Unknown TTS engine: ' + engine);
  }
}

// ─── Emscripten Module Setup ─────────────────────────────────────────────────

/**
 * Initialize the WASM module and sherpa-onnx TTS objects.
 * Called when main thread sends { type: 'init' }.
 */
function handleInit(msg) {
  var fileUrls = msg.fileUrls;
  var modelFile = msg.modelFile || '';
  var engine = msg.engine || '';
  var ttsConfig = msg.ttsConfig || {};

  if (!fileUrls) {
    postMessage({ type: 'error', error: 'fileUrls is required — model must be downloaded first' });
    return;
  }

  if (!engine) {
    postMessage({ type: 'error', error: 'engine is required — model must specify an engine type' });
    return;
  }

  var startTime = performance.now();

  postMessage({ type: 'status', message: 'Loading TTS WASM module (' + engine + ')...' });

  // Configure the Emscripten Module object before loading the glue code.
  Module = {};
  Module.locateFile = function(path) {
    var url = fileUrls[path];
    if (!url) {
      postMessage({ type: 'error', error: 'Missing file URL for: ' + path });
    }
    return url;
  };

  Module.setStatus = function(status) {
    postMessage({ type: 'status', message: status });
  };

  Module.onRuntimeInitialized = function() {
    try {
      postMessage({ type: 'status', message: 'Creating TTS engine (' + engine + ')...' });

      var config = buildEngineConfig(engine, modelFile, ttsConfig);
      tts = createOfflineTts(Module, config);

      isReady = true;
      var elapsed = Math.round(performance.now() - startTime);
      postMessage({
        type: 'ready',
        loadTimeMs: elapsed,
        numSpeakers: tts.numSpeakers,
        sampleRate: tts.sampleRate,
      });
    } catch (e) {
      postMessage({ type: 'error', error: 'TTS init failed (' + engine + '): ' + (e.message || e) });
    }
  };

  // Load Emscripten glue code + sherpa-onnx TTS JS API wrapper.
  // After importScripts, these globals become available:
  //   - Module (enhanced by Emscripten glue)
  //   - OfflineTts, createOfflineTts (from sherpa-onnx-tts.js)
  try {
    importScripts(
      fileUrls['sherpa-onnx-wasm-main-tts.js'],
      fileUrls['sherpa-onnx-tts.js']
    );
  } catch (e) {
    postMessage({
      type: 'error',
      error: 'Failed to load TTS WASM scripts: ' + (e.message || e)
    });
  }
}

// ─── Text-to-Speech Generation ───────────────────────────────────────────────

/**
 * Generate speech audio from text.
 * Returns Float32Array samples + sample rate.
 */
function handleGenerate(msg) {
  if (!isReady || !tts) {
    postMessage({ type: 'error', error: 'TTS not initialized' });
    return;
  }

  var startTime = performance.now();

  try {
    var audio = tts.generate({
      text: msg.text,
      sid: msg.sid || 0,
      speed: msg.speed || 1.0,
    });

    var generationTimeMs = Math.round(performance.now() - startTime);

    // Transfer the samples buffer for zero-copy performance
    postMessage(
      {
        type: 'result',
        samples: audio.samples,
        sampleRate: audio.sampleRate,
        generationTimeMs: generationTimeMs,
      },
      [audio.samples.buffer]
    );
  } catch (e) {
    postMessage({ type: 'error', error: 'Generation failed: ' + (e.message || e) });
  }
}

// ─── Dispose ─────────────────────────────────────────────────────────────────

function handleDispose() {
  if (tts) {
    tts.free();
    tts = null;
  }
  isReady = false;
  postMessage({ type: 'disposed' });
}

// ─── Message Handler ─────────────────────────────────────────────────────────

self.onmessage = function(event) {
  var msg = event.data;
  switch (msg.type) {
    case 'init':
      handleInit(msg);
      break;
    case 'generate':
      handleGenerate(msg);
      break;
    case 'dispose':
      handleDispose();
      break;
    default:
      postMessage({ type: 'error', error: 'Unknown message type: ' + msg.type });
  }
};
