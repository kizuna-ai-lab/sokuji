/**
 * Streaming ASR Worker — Classic Web Worker (not ES module) for sherpa-onnx WASM.
 *
 * Uses importScripts() to load Emscripten glue code + sherpa-onnx JS API wrappers.
 * Handles OnlineRecognizer for streaming (real-time) speech recognition.
 * No VAD — uses built-in endpoint detection.
 *
 * Protocol:
 *   Main → Worker:
 *     { type: 'init', fileUrls: Record<string, string> }
 *     { type: 'audio', samples: Int16Array, sampleRate: number }
 *     { type: 'dispose' }
 *
 *   Worker → Main:
 *     { type: 'ready', loadTimeMs: number }
 *     { type: 'status', message: string }
 *     { type: 'speech_start' }
 *     { type: 'partial', text: string }
 *     { type: 'result', text: string, durationMs: number, recognitionTimeMs: number }
 *     { type: 'error', error: string }
 *     { type: 'disposed' }
 */

// sherpa-onnx expects 16kHz audio
var EXPECTED_SAMPLE_RATE = 16000;

// State
var recognizer = null;
var recognizerStream = null;
var isReady = false;
var isParaformer = false;

// Track timing for final results
var utteranceStartTime = 0;
var lastPartialText = '';

/**
 * Reset the recognizer stream state. If reset() fails, rebuild the stream.
 * Shared by handleAudio and handleFlush error recovery.
 */
function resetStreamState() {
  try {
    recognizer.reset(recognizerStream);
  } catch (_) {
    // Stream may be corrupted — rebuild it
    try { recognizerStream.free(); } catch (_) {}
    recognizerStream = recognizer.createStream();
  }
  utteranceStartTime = performance.now();
  lastPartialText = '';
}

// ─── Audio Conversion ────────────────────────────────────────────────────────

/**
 * Downsample Int16Array to Float32Array at target sample rate.
 * Combines format conversion (Int16 → Float32 normalized) and resampling.
 */
function downsampleInt16ToFloat32(input, inputSampleRate, outputSampleRate) {
  if (inputSampleRate === outputSampleRate) {
    var output = new Float32Array(input.length);
    for (var i = 0; i < input.length; i++) {
      output[i] = input[i] / 32768;
    }
    return output;
  }

  var ratio = inputSampleRate / outputSampleRate;
  var outputLength = Math.floor(input.length / ratio);
  var output = new Float32Array(outputLength);

  for (var i = 0; i < outputLength; i++) {
    var srcIndex = i * ratio;
    var srcIndexFloor = Math.floor(srcIndex);
    var srcIndexCeil = Math.min(srcIndexFloor + 1, input.length - 1);
    var frac = srcIndex - srcIndexFloor;
    var sample = input[srcIndexFloor] * (1 - frac) + input[srcIndexCeil] * frac;
    output[i] = sample / 32768;
  }

  return output;
}

// ─── Emscripten Module Setup ─────────────────────────────────────────────────

/**
 * Initialize the WASM module and sherpa-onnx objects.
 * Called when main thread sends { type: 'init' }.
 */
// Map asrEngine string to sherpa-onnx model type integer
var ASR_ENGINE_TYPE_MAP = {
  'stream-transducer': 0,
  'stream-paraformer': 1,
  'stream-zipformer2-ctc': 2,
  'stream-nemo-ctc': 3,
  'stream-tone-ctc': 4,
};

function handleInit(msg) {
  var fileUrls = msg.fileUrls;
  var asrEngine = msg.asrEngine;
  var runtimeBaseUrl = msg.runtimeBaseUrl;
  var dataPackageMetadata = msg.dataPackageMetadata;

  if (!fileUrls) {
    postMessage({ type: 'error', error: 'Missing fileUrls in init message' });
    return;
  }
  if (!runtimeBaseUrl) {
    postMessage({ type: 'error', error: 'runtimeBaseUrl is required — bundled streaming ASR runtime path missing' });
    return;
  }
  if (!dataPackageMetadata) {
    postMessage({ type: 'error', error: 'dataPackageMetadata is required — model metadata missing' });
    return;
  }

  var startTime = performance.now();

  postMessage({ type: 'status', message: 'Loading streaming ASR WASM module...' });

  // Configure the Emscripten Module object before loading the glue code.
  Module = {};

  // Inject the data package metadata so the patched glue JS uses it
  // instead of the hardcoded loadPackage({...}) that was stripped out.
  Module._dataPackageMetadata = dataPackageMetadata;

  // locateFile resolves .data to IndexedDB blob URL, .wasm to bundled path.
  Module.locateFile = function(path) {
    // .data file comes from IndexedDB (model-specific, downloaded from CDN)
    if (fileUrls[path]) {
      return fileUrls[path];
    }
    // .wasm file is bundled with the app
    return runtimeBaseUrl + '/' + path;
  };

  Module.setStatus = function(status) {
    postMessage({ type: 'status', message: status });
  };

  Module.onRuntimeInitialized = function() {
    try {
      postMessage({ type: 'status', message: 'Creating online recognizer...' });

      // createOnlineRecognizer is defined in sherpa-onnx-asr.js for streaming packages
      // Pass the model type so it builds the correct config for the model architecture
      var modelType = ASR_ENGINE_TYPE_MAP[asrEngine] || 0;
      recognizer = createOnlineRecognizer(Module, null, modelType);
      recognizerStream = recognizer.createStream();

      // Detect if this is a Paraformer model (needs tail padding)
      isParaformer = recognizer.config.modelConfig.paraformer.encoder !== '';

      isReady = true;
      utteranceStartTime = performance.now();
      var elapsed = Math.round(performance.now() - startTime);
      postMessage({ type: 'ready', loadTimeMs: elapsed });
    } catch (e) {
      postMessage({ type: 'error', error: 'Init failed: ' + (e.message || e) });
    }
  };

  // Load bundled Emscripten glue code + sherpa-onnx JS API wrapper.
  // The glue JS is patched to use Module._dataPackageMetadata instead of
  // hardcoded loadPackage({...}) metadata.
  // After importScripts, these globals become available:
  //   - Module (enhanced by Emscripten glue)
  //   - OnlineRecognizer, OnlineStream, createOnlineRecognizer (from sherpa-onnx-asr.js)
  try {
    importScripts(
      runtimeBaseUrl + '/sherpa-onnx-wasm-main-asr.js',
      runtimeBaseUrl + '/sherpa-onnx-asr.js'
    );
  } catch (e) {
    postMessage({
      type: 'error',
      error: 'Failed to load streaming ASR WASM scripts: ' + (e.message || e)
    });
  }
}

// ─── Audio Processing ────────────────────────────────────────────────────────

/**
 * Process incoming audio chunk through OnlineRecognizer.
 * Audio flows directly: feed → decode → check partial/endpoint.
 */
function handleAudio(msg) {
  if (!isReady || !recognizer || !recognizerStream) {
    return; // Silently drop if not initialized
  }

  try {
    // Convert incoming audio to Float32 @ 16kHz
    var samples = downsampleInt16ToFloat32(msg.samples, msg.sampleRate, EXPECTED_SAMPLE_RATE);

    // Feed audio directly to the online recognizer stream
    recognizerStream.acceptWaveform(EXPECTED_SAMPLE_RATE, samples);

    // Decode all available frames
    while (recognizer.isReady(recognizerStream)) {
      recognizer.decode(recognizerStream);
    }

    // Get current result
    var result = recognizer.getResult(recognizerStream);
    var text = (result.text || '').trim();

    // Check if we hit an endpoint (natural pause / sentence boundary)
    if (recognizer.isEndpoint(recognizerStream)) {
      if (text) {
        var now = performance.now();
        postMessage({
          type: 'result',
          text: text,
          durationMs: Math.round(now - utteranceStartTime),
          recognitionTimeMs: Math.round(now - utteranceStartTime),
        });
      }
      // Reset for next utterance
      resetStreamState();
    } else if (text && text !== lastPartialText) {
      // Emit speech_start on first non-empty partial (transition from silence to speech)
      if (!lastPartialText) {
        postMessage({ type: 'speech_start' });
      }
      // Emit partial result only when text changes
      lastPartialText = text;
      postMessage({ type: 'partial', text: text });
    }
  } catch (e) {
    postMessage({ type: 'error', error: 'Streaming ASR processing error: ' + (e.message || e) });
    // Reset stream state to recover; rebuilds stream if reset fails
    resetStreamState();
  }
}

// ─── Flush (force-finalize pending utterance) ────────────────────────────────

/**
 * Force-emit the current partial result as a final result and reset.
 * Used by Push-to-Talk: when the user releases the key, any in-progress
 * recognition should be finalized immediately rather than waiting for
 * endpoint detection from more audio.
 */
function handleFlush() {
  if (!isReady || !recognizer || !recognizerStream) return;

  try {
    // Decode any remaining buffered frames
    while (recognizer.isReady(recognizerStream)) {
      recognizer.decode(recognizerStream);
    }

    var result = recognizer.getResult(recognizerStream);
    var text = (result.text || '').trim();

    if (text) {
      var now = performance.now();
      postMessage({
        type: 'result',
        text: text,
        durationMs: Math.round(now - utteranceStartTime),
        recognitionTimeMs: Math.round(now - utteranceStartTime),
      });
    }

    // Reset for next utterance
    resetStreamState();
  } catch (e) {
    postMessage({ type: 'error', error: 'ASR flush error: ' + (e.message || e) });
    resetStreamState();
  }
}

// ─── Dispose ─────────────────────────────────────────────────────────────────

function handleDispose() {
  if (recognizerStream) {
    recognizerStream.free();
    recognizerStream = null;
  }
  if (recognizer) {
    recognizer.free();
    recognizer = null;
  }
  isReady = false;
  isParaformer = false;
  lastPartialText = '';
  postMessage({ type: 'disposed' });
}

// ─── Message Handler ─────────────────────────────────────────────────────────

self.onmessage = function(event) {
  var msg = event.data;
  switch (msg.type) {
    case 'init':
      handleInit(msg);
      break;
    case 'audio':
      handleAudio(msg);
      break;
    case 'flush':
      handleFlush();
      break;
    case 'dispose':
      handleDispose();
      break;
    default:
      postMessage({ type: 'error', error: 'Unknown message type: ' + msg.type });
  }
};
