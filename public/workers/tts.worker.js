/**
 * TTS Worker — Classic Web Worker (not ES module) for sherpa-onnx WASM.
 *
 * Uses importScripts() to load Emscripten glue code + sherpa-onnx TTS JS API.
 * Handles OfflineTts for text-to-speech synthesis.
 *
 * Protocol:
 *   Main → Worker:
 *     { type: 'init', fileUrls: Record<string, string>, modelFile: string }
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

// ─── Emscripten Module Setup ─────────────────────────────────────────────────

/**
 * Initialize the WASM module and sherpa-onnx TTS objects.
 * Called when main thread sends { type: 'init' }.
 */
function handleInit(msg) {
  var fileUrls = msg.fileUrls;
  var modelFile = msg.modelFile || './model.onnx';

  if (!fileUrls) {
    postMessage({ type: 'error', error: 'fileUrls is required — model must be downloaded first' });
    return;
  }

  var startTime = performance.now();

  postMessage({ type: 'status', message: 'Loading TTS WASM module...' });

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
      postMessage({ type: 'status', message: 'Creating TTS engine...' });

      // Build custom config with the correct model filename for this package.
      // The default createOfflineTts() hardcodes './model.onnx' which doesn't
      // match prebuilt Piper packages (e.g. 'en_US-libritts_r-medium.onnx').
      var config = {
        offlineTtsModelConfig: {
          offlineTtsVitsModelConfig: {
            model: './' + modelFile,
            lexicon: '',
            tokens: './tokens.txt',
            dataDir: './espeak-ng-data',
            noiseScale: 0.667,
            noiseScaleW: 0.8,
            lengthScale: 1.0,
          },
          offlineTtsMatchaModelConfig: {
            acousticModel: '',
            vocoder: '',
            lexicon: '',
            tokens: '',
            dataDir: '',
            noiseScale: 0.667,
            lengthScale: 1.0,
          },
          offlineTtsKokoroModelConfig: {
            model: '',
            voices: '',
            tokens: '',
            dataDir: '',
            lengthScale: 1.0,
            lexicon: '',
            lang: '',
          },
          offlineTtsKittenModelConfig: {
            model: '',
            voices: '',
            tokens: '',
            dataDir: '',
            lengthScale: 1.0,
          },
          numThreads: 1,
          debug: 1,
          provider: 'cpu',
        },
        ruleFsts: '',
        ruleFars: '',
        maxNumSentences: 1,
      };

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
      postMessage({ type: 'error', error: 'TTS init failed: ' + (e.message || e) });
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
