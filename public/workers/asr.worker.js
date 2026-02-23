/**
 * ASR Worker — Classic Web Worker (not ES module) for sherpa-onnx WASM.
 *
 * Uses importScripts() to load Emscripten glue code + sherpa-onnx JS API wrappers.
 * Handles VAD + OfflineRecognizer for non-streaming speech recognition.
 *
 * Protocol:
 *   Main → Worker:
 *     { type: 'init', wasmBaseUrl: string }
 *     { type: 'audio', samples: Int16Array, sampleRate: number }
 *     { type: 'dispose' }
 *
 *   Worker → Main:
 *     { type: 'ready', loadTimeMs: number }
 *     { type: 'status', message: string }
 *     { type: 'result', text, startSample, durationMs, recognitionTimeMs }
 *     { type: 'error', error: string }
 *     { type: 'disposed' }
 */

// sherpa-onnx expects 16kHz audio
var EXPECTED_SAMPLE_RATE = 16000;

// State
var vad = null;
var buffer = null;
var recognizer = null;
var isReady = false;

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

// ─── sherpa-onnx Initialization Helpers ──────────────────────────────────────
// These replicate the logic from app-vad-asr.js demo since that file
// includes DOM code and can't be imported into a worker.

/**
 * Check if a file exists in the Emscripten virtual filesystem.
 * Uses the C API exposed by sherpa-onnx WASM.
 */
function fileExists(filename) {
  var filenameLen = Module.lengthBytesUTF8(filename) + 1;
  var buf = Module._malloc(filenameLen);
  Module.stringToUTF8(filename, buf, filenameLen);
  var exists = Module._SherpaOnnxFileExists(buf);
  Module._free(buf);
  return exists === 1;
}

/**
 * Detect which ASR model is available in the virtual filesystem
 * and create an OfflineRecognizer with the appropriate config.
 * Supports: SenseVoice, Whisper, Transducer (zipformer/nemo), Paraformer,
 * TeleSpeech, Moonshine, Dolphin, Zipformer-CTC.
 */
function initOfflineRecognizer() {
  var config = {
    modelConfig: {
      debug: 1,
      tokens: './tokens.txt',
    },
  };

  if (fileExists('sense-voice.onnx')) {
    config.modelConfig.senseVoice = {
      model: './sense-voice.onnx',
      useInverseTextNormalization: 1,
    };
    postMessage({ type: 'status', message: 'Detected SenseVoice model' });
  } else if (fileExists('whisper-encoder.onnx')) {
    config.modelConfig.whisper = {
      encoder: './whisper-encoder.onnx',
      decoder: './whisper-decoder.onnx',
    };
    postMessage({ type: 'status', message: 'Detected Whisper model' });
  } else if (fileExists('transducer-encoder.onnx')) {
    config.modelConfig.transducer = {
      encoder: './transducer-encoder.onnx',
      decoder: './transducer-decoder.onnx',
      joiner: './transducer-joiner.onnx',
    };
    config.modelConfig.modelType = 'transducer';
    postMessage({ type: 'status', message: 'Detected Transducer model' });
  } else if (fileExists('nemo-transducer-encoder.onnx')) {
    config.modelConfig.transducer = {
      encoder: './nemo-transducer-encoder.onnx',
      decoder: './nemo-transducer-decoder.onnx',
      joiner: './nemo-transducer-joiner.onnx',
    };
    config.modelConfig.modelType = 'nemo_transducer';
    postMessage({ type: 'status', message: 'Detected NeMo Transducer model' });
  } else if (fileExists('paraformer.onnx')) {
    config.modelConfig.paraformer = {
      model: './paraformer.onnx',
    };
    postMessage({ type: 'status', message: 'Detected Paraformer model' });
  } else if (fileExists('telespeech.onnx')) {
    config.modelConfig.telespeechCtc = './telespeech.onnx';
    postMessage({ type: 'status', message: 'Detected TeleSpeech model' });
  } else if (fileExists('moonshine-preprocessor.onnx')) {
    config.modelConfig.moonshine = {
      preprocessor: './moonshine-preprocessor.onnx',
      encoder: './moonshine-encoder.onnx',
      uncachedDecoder: './moonshine-uncached-decoder.onnx',
      cachedDecoder: './moonshine-cached-decoder.onnx',
    };
    postMessage({ type: 'status', message: 'Detected Moonshine model' });
  } else if (fileExists('dolphin.onnx')) {
    config.modelConfig.dolphin = { model: './dolphin.onnx' };
    postMessage({ type: 'status', message: 'Detected Dolphin model' });
  } else if (fileExists('zipformer-ctc.onnx')) {
    config.modelConfig.zipformerCtc = { model: './zipformer-ctc.onnx' };
    postMessage({ type: 'status', message: 'Detected Zipformer-CTC model' });
  } else {
    throw new Error('No supported ASR model found in the WASM virtual filesystem');
  }

  return new OfflineRecognizer(config, Module);
}

// ─── Emscripten Module Setup ─────────────────────────────────────────────────

/**
 * Initialize the WASM module and sherpa-onnx objects.
 * Called when main thread sends { type: 'init' }.
 */
function handleInit(msg) {
  var wasmBaseUrl = msg.wasmBaseUrl;
  // Ensure trailing slash
  if (wasmBaseUrl && !wasmBaseUrl.endsWith('/')) {
    wasmBaseUrl += '/';
  }

  var startTime = performance.now();

  postMessage({ type: 'status', message: 'Loading WASM module...' });

  // Configure the Emscripten Module object before loading the glue code.
  // Must be set BEFORE importScripts loads the Emscripten JS.
  Module = {};
  Module.locateFile = function(path) {
    // Resolve .wasm and .data files relative to the model's WASM base URL
    return wasmBaseUrl + path;
  };

  Module.setStatus = function(status) {
    postMessage({ type: 'status', message: status });
  };

  Module.onRuntimeInitialized = function() {
    try {
      postMessage({ type: 'status', message: 'Creating VAD...' });

      // createVad is defined in sherpa-onnx-vad.js, uses Silero VAD model
      // pre-loaded into the virtual filesystem via the .data file
      vad = createVad(Module);

      // Circular buffer: 30 seconds of audio at 16kHz
      buffer = new CircularBuffer(30 * EXPECTED_SAMPLE_RATE, Module);

      postMessage({ type: 'status', message: 'Creating recognizer...' });

      // Detect model type and create OfflineRecognizer
      recognizer = initOfflineRecognizer();

      isReady = true;
      var elapsed = Math.round(performance.now() - startTime);
      postMessage({ type: 'ready', loadTimeMs: elapsed });
    } catch (e) {
      postMessage({ type: 'error', error: 'Init failed: ' + (e.message || e) });
    }
  };

  // Load Emscripten glue code + sherpa-onnx JS API wrappers.
  // After importScripts, these globals become available:
  //   - Module (enhanced by Emscripten glue)
  //   - CircularBuffer, Vad, createVad (from sherpa-onnx-vad.js)
  //   - OfflineRecognizer, OfflineStream (from sherpa-onnx-asr.js)
  try {
    importScripts(
      wasmBaseUrl + 'sherpa-onnx-wasm-main-vad-asr.js',
      wasmBaseUrl + 'sherpa-onnx-vad.js',
      wasmBaseUrl + 'sherpa-onnx-asr.js'
    );
  } catch (e) {
    postMessage({
      type: 'error',
      error: 'Failed to load WASM scripts from ' + wasmBaseUrl + ': ' + (e.message || e)
    });
  }
}

// ─── Audio Processing ────────────────────────────────────────────────────────

/**
 * Process incoming audio chunk through VAD → ASR pipeline.
 * Audio flows: circular buffer → VAD windowing → speech segment detection → ASR
 */
function handleAudio(msg) {
  if (!isReady || !vad || !buffer || !recognizer) {
    return; // Silently drop if not initialized
  }

  // Convert incoming audio to Float32 @ 16kHz
  var samples = downsampleInt16ToFloat32(msg.samples, msg.sampleRate, EXPECTED_SAMPLE_RATE);

  // Push into circular buffer
  buffer.push(samples);

  // Get VAD window size (typically 512 samples for Silero VAD at 16kHz)
  var windowSize = vad.config.sileroVad.windowSize || 512;

  // Feed all available windows to VAD
  while (buffer.size() >= windowSize) {
    var segment = buffer.get(buffer.head(), windowSize);
    buffer.pop(windowSize);
    vad.acceptWaveform(segment);
  }

  // Process completed speech segments through ASR
  while (!vad.isEmpty()) {
    var speechSegment = vad.front();
    var speechSamples = speechSegment.samples;
    var startSample = speechSegment.start;

    var recognitionStart = performance.now();

    // Create a stream, feed the speech segment, decode
    var stream = recognizer.createStream();
    stream.acceptWaveform(EXPECTED_SAMPLE_RATE, speechSamples);
    recognizer.decode(stream);
    var result = recognizer.getResult(stream);
    stream.free();

    var recognitionTimeMs = Math.round(performance.now() - recognitionStart);
    var durationMs = Math.round((speechSamples.length / EXPECTED_SAMPLE_RATE) * 1000);

    var text = (result.text || '').trim();
    if (text) {
      postMessage({
        type: 'result',
        text: text,
        startSample: startSample,
        durationMs: durationMs,
        recognitionTimeMs: recognitionTimeMs,
      });
    }

    vad.pop();
  }
}

// ─── Dispose ─────────────────────────────────────────────────────────────────

function handleDispose() {
  if (recognizer) {
    recognizer.free();
    recognizer = null;
  }
  if (vad) {
    vad.free();
    vad = null;
  }
  if (buffer) {
    buffer.free();
    buffer = null;
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
