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
function handleInit(msg) {
  var fileUrls = msg.fileUrls;
  if (!fileUrls) {
    postMessage({ type: 'error', error: 'Missing fileUrls in init message' });
    return;
  }

  // Determine the wasmBaseUrl from any file URL (strip filename)
  var wasmBaseUrl = '';
  var keys = Object.keys(fileUrls);
  for (var i = 0; i < keys.length; i++) {
    var url = fileUrls[keys[i]];
    if (url && url.lastIndexOf('/') >= 0) {
      wasmBaseUrl = url.substring(0, url.lastIndexOf('/') + 1);
      break;
    }
  }

  var startTime = performance.now();

  postMessage({ type: 'status', message: 'Loading streaming ASR WASM module...' });

  // Configure the Emscripten Module object before loading the glue code.
  Module = {};
  Module.locateFile = function(path) {
    // Check if we have a blob URL for this file
    if (fileUrls[path]) {
      return fileUrls[path];
    }
    // Fallback to base URL
    return wasmBaseUrl + path;
  };

  Module.setStatus = function(status) {
    postMessage({ type: 'status', message: status });
  };

  Module.onRuntimeInitialized = function() {
    try {
      postMessage({ type: 'status', message: 'Creating online recognizer...' });

      // createOnlineRecognizer is defined in sherpa-onnx-asr.js for streaming packages
      // It auto-detects the model type from files in the virtual filesystem
      recognizer = createOnlineRecognizer(Module);
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

  // Load Emscripten glue code + sherpa-onnx JS API wrapper.
  // Streaming ASR uses different WASM binary (no VAD) and only needs sherpa-onnx-asr.js.
  // After importScripts, these globals become available:
  //   - Module (enhanced by Emscripten glue)
  //   - OnlineRecognizer, OnlineStream, createOnlineRecognizer (from sherpa-onnx-asr.js)
  try {
    var glueUrl = fileUrls['sherpa-onnx-wasm-main-asr.js'] || (wasmBaseUrl + 'sherpa-onnx-wasm-main-asr.js');
    var asrApiUrl = fileUrls['sherpa-onnx-asr.js'] || (wasmBaseUrl + 'sherpa-onnx-asr.js');
    importScripts(glueUrl, asrApiUrl);
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
    recognizer.reset(recognizerStream);
    utteranceStartTime = performance.now();
    lastPartialText = '';
  } else if (text && text !== lastPartialText) {
    // Emit partial result only when text changes
    lastPartialText = text;
    postMessage({ type: 'partial', text: text });
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
    case 'dispose':
      handleDispose();
      break;
    default:
      postMessage({ type: 'error', error: 'Unknown message type: ' + msg.type });
  }
};
