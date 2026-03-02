/**
 * ASR Worker — Classic Web Worker (not ES module) for sherpa-onnx WASM.
 *
 * Uses importScripts() to load Emscripten glue code + sherpa-onnx JS API wrappers.
 * Handles VAD + OfflineRecognizer for non-streaming speech recognition.
 *
 * Protocol:
 *   Main → Worker:
 *     { type: 'init', fileUrls: Record<string, string>, asrEngine: string }
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

// ─── Per-Engine Config Builders ──────────────────────────────────────────────
// Each builder returns the modelConfig fields specific to its engine type.
// The engine type is passed explicitly from the manifest via AsrEngine.ts,
// matching the TTS worker pattern (no filesystem probing).

function buildSenseVoiceConfig() {
  return {
    senseVoice: { model: './sense-voice.onnx', useInverseTextNormalization: 1 },
  };
}

function buildWhisperConfig() {
  return {
    whisper: { encoder: './whisper-encoder.onnx', decoder: './whisper-decoder.onnx' },
  };
}

function buildTransducerConfig() {
  return {
    transducer: {
      encoder: './transducer-encoder.onnx',
      decoder: './transducer-decoder.onnx',
      joiner: './transducer-joiner.onnx',
    },
    modelType: 'transducer',
  };
}

function buildNemoTransducerConfig() {
  return {
    transducer: {
      encoder: './nemo-transducer-encoder.onnx',
      decoder: './nemo-transducer-decoder.onnx',
      joiner: './nemo-transducer-joiner.onnx',
    },
    modelType: 'nemo_transducer',
  };
}

function buildParaformerConfig() {
  return {
    paraformer: { model: './paraformer.onnx' },
  };
}

function buildTelespeechConfig() {
  return {
    teleSpeechCtc: './telespeech.onnx',
  };
}

function buildMoonshineConfig() {
  return {
    moonshine: {
      preprocessor: './moonshine-preprocessor.onnx',
      encoder: './moonshine-encoder.onnx',
      uncachedDecoder: './moonshine-uncached-decoder.onnx',
      cachedDecoder: './moonshine-cached-decoder.onnx',
    },
  };
}

function buildMoonshineV2Config() {
  return {
    moonshine: {
      encoder: './moonshine-encoder.ort',
      mergedDecoder: './moonshine-merged-decoder.ort',
    },
  };
}

function buildDolphinConfig() {
  return {
    dolphin: { model: './dolphin.onnx' },
  };
}

function buildZipformerCtcConfig() {
  return {
    zipformerCtc: { model: './zipformer-ctc.onnx' },
  };
}

function buildNemoCtcConfig() {
  return {
    nemoCtc: { model: './nemo-ctc.onnx' },
  };
}

function buildCanaryConfig() {
  return {
    canary: { encoder: './canary-encoder.onnx', decoder: './canary-decoder.onnx' },
  };
}

function buildWenetCtcConfig() {
  return {
    wenetCtc: { model: './wenet-ctc.onnx' },
  };
}

function buildOmnilingualConfig() {
  return {
    omnilingual: { model: './omnilingual.onnx' },
  };
}

/**
 * Build OfflineRecognizer config for the given engine type.
 * Engine type comes from modelManifest.ts asrEngine field.
 */
function buildAsrConfig(engine) {
  var base = { modelConfig: { debug: 1, tokens: './tokens.txt' } };
  var engineConfig;

  switch (engine) {
    case 'sensevoice':       engineConfig = buildSenseVoiceConfig(); break;
    case 'whisper':          engineConfig = buildWhisperConfig(); break;
    case 'transducer':       engineConfig = buildTransducerConfig(); break;
    case 'nemo-transducer':  engineConfig = buildNemoTransducerConfig(); break;
    case 'paraformer':       engineConfig = buildParaformerConfig(); break;
    case 'telespeech':       engineConfig = buildTelespeechConfig(); break;
    case 'moonshine':        engineConfig = buildMoonshineConfig(); break;
    case 'moonshine-v2':     engineConfig = buildMoonshineV2Config(); break;
    case 'dolphin':          engineConfig = buildDolphinConfig(); break;
    case 'zipformer-ctc':    engineConfig = buildZipformerCtcConfig(); break;
    case 'nemo-ctc':         engineConfig = buildNemoCtcConfig(); break;
    case 'canary':           engineConfig = buildCanaryConfig(); break;
    case 'wenet-ctc':        engineConfig = buildWenetCtcConfig(); break;
    case 'omnilingual':      engineConfig = buildOmnilingualConfig(); break;
    default:
      throw new Error('Unknown ASR engine: ' + engine);
  }

  // Merge engine-specific fields into modelConfig
  for (var key in engineConfig) {
    base.modelConfig[key] = engineConfig[key];
  }

  return base;
}

// ─── Emscripten Module Setup ─────────────────────────────────────────────────

/**
 * Initialize the WASM module and sherpa-onnx objects.
 * Called when main thread sends { type: 'init' }.
 */
function handleInit(msg) {
  var fileUrls = msg.fileUrls;
  var asrEngine = msg.asrEngine;
  var vadConfig = msg.vadConfig;
  if (!fileUrls) {
    postMessage({ type: 'error', error: 'fileUrls is required — model must be downloaded first' });
    return;
  }
  if (!asrEngine) {
    postMessage({ type: 'error', error: 'asrEngine is required — model manifest must specify engine type' });
    return;
  }

  var startTime = performance.now();

  postMessage({ type: 'status', message: 'Loading WASM module...' });

  // Configure the Emscripten Module object before loading the glue code.
  // Must be set BEFORE importScripts loads the Emscripten JS.
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
      postMessage({ type: 'status', message: 'Creating VAD...' });

      // createVad is defined in sherpa-onnx-vad.js, uses Silero VAD model
      // pre-loaded into the virtual filesystem via the .data file
      if (vadConfig) {
        var customVadConfig = {
          sileroVad: {
            model: './silero_vad.onnx',
            threshold: vadConfig.threshold || 0.50,
            minSilenceDuration: vadConfig.minSilenceDuration || 0.50,
            minSpeechDuration: vadConfig.minSpeechDuration || 0.25,
            maxSpeechDuration: 20,
            windowSize: 512,
          },
          sampleRate: 16000,
          numThreads: 1,
          provider: 'cpu',
          debug: 1,
          bufferSizeInSeconds: 30,
        };
        vad = createVad(Module, customVadConfig);
      } else {
        vad = createVad(Module);
      }

      // Circular buffer: 30 seconds of audio at 16kHz
      buffer = new CircularBuffer(30 * EXPECTED_SAMPLE_RATE, Module);

      postMessage({ type: 'status', message: 'Creating recognizer (' + asrEngine + ')...' });

      // Build engine-specific config and create OfflineRecognizer
      recognizer = new OfflineRecognizer(buildAsrConfig(asrEngine), Module);

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
      fileUrls['sherpa-onnx-wasm-main-vad-asr.js'],
      fileUrls['sherpa-onnx-vad.js'],
      fileUrls['sherpa-onnx-asr.js']
    );
  } catch (e) {
    postMessage({
      type: 'error',
      error: 'Failed to load WASM scripts: ' + (e.message || e)
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
    // Remove spaces between CJK characters (common with Moonshine zh/ja/ko models)
    text = text.replace(/([\u3000-\u9fff\uF900-\uFAFF])\s+(?=[\u3000-\u9fff\uF900-\uFAFF])/g, '$1');
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
