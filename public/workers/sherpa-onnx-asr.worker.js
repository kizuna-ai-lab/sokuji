/**
 * ASR Worker — Classic Web Worker (not ES module) for sherpa-onnx WASM.
 *
 * Uses importScripts() to load Emscripten glue code + sherpa-onnx JS API wrappers.
 * Runs the OfflineRecognizer for non-streaming speech recognition. Two modes, chosen by the init message:
 *
 *   segmentPort given: the app's turn detector cuts the turns and sends each segment on that port; this worker
 *     runs no VAD and decodes the segments one at a time in arrival order (createSegmentInbox below, the same
 *     rules as SegmentInbox in workers/_shared/segment-inbox.ts: epochs, `taken` acks, `drained` marks).
 *   no segmentPort: sherpa's own C++ Silero VAD cuts the turns here (removed in step 5 of shared turn detection).
 *
 * Protocol:
 *   Main → Worker:
 *     { type: 'init', fileUrls, asrEngine, vadConfig?, segmentPort?, runtimeBaseUrl, dataPackageMetadata }
 *     { type: 'audio', samples: Int16Array, sampleRate: number }   (own VAD only)
 *     { type: 'flush' }                                            (own VAD only)
 *     { type: 'stop', epoch: number }                              (segmentPort only)
 *     { type: 'dispose' }
 *
 *   Detector → Worker, on segmentPort: segment | cancel | drained (workers/_shared/turn-detector-protocol.ts)
 *   Worker → Detector, on segmentPort: { type: 'taken', epoch, seq }
 *
 *   Worker → Main:
 *     { type: 'ready', loadTimeMs: number }
 *     { type: 'status', message: string }
 *     { type: 'speech_start' }                                     (own VAD only)
 *     { type: 'result', text, startSample, durationMs, recognitionTimeMs, epoch?, seq?, press?, endedBy?, smartTurnProbability? }
 *     { type: 'drained', epoch, seq }                              (segmentPort only)
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
var isSpeaking = false;
var inbox = null;

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
  var runtimeBaseUrl = msg.runtimeBaseUrl;
  var dataPackageMetadata = msg.dataPackageMetadata;
  var segmentPort = msg.segmentPort || null;

  if (!fileUrls) {
    postMessage({ type: 'error', error: 'fileUrls is required — model must be downloaded first' });
    return;
  }
  if (!asrEngine) {
    postMessage({ type: 'error', error: 'asrEngine is required — model manifest must specify engine type' });
    return;
  }
  if (!runtimeBaseUrl) {
    postMessage({ type: 'error', error: 'runtimeBaseUrl is required — bundled ASR runtime path missing' });
    return;
  }
  if (!dataPackageMetadata) {
    postMessage({ type: 'error', error: 'dataPackageMetadata is required — model metadata missing' });
    return;
  }

  var startTime = performance.now();

  postMessage({ type: 'status', message: 'Loading WASM module...' });

  // Configure the Emscripten Module object before loading the glue code.
  // Must be set BEFORE importScripts loads the Emscripten JS.
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
      // With a segment port the turn detector cuts the turns: no VAD and no audio buffer here.
      if (!segmentPort) {
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
              // Pinned equal to MOONSHINE_V2_LIMIT and SHERPA_OFFLINE_LIMIT in modelManifest.ts (workers/asrLimits.consistency.test.ts).
              // moonshine-v2 throws on any segment past ~9.3 s: its decoder's
              // mask shape does not match the encoder past 384 frames, and the
              // bundled wasm cannot catch the C++ exception, so the whole
              // segment comes back as "ASR processing error" and one error
              // bubble. Executed on moonshine-tiny-ja-quant through this
              // worker: 8 s fine, 12 s throws, twice. Nine seconds is the
              // largest safe multiple of a second. Every other engine here
              // keeps the 20 s this worker has always used — the Max Speech
              // Duration setting does not reach sherpa-onnx at all.
              maxSpeechDuration: asrEngine === 'moonshine-v2' ? 9 : 20,
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
      }

      postMessage({ type: 'status', message: 'Creating recognizer (' + asrEngine + ')...' });

      // Build engine-specific config and create OfflineRecognizer
      recognizer = new OfflineRecognizer(buildAsrConfig(asrEngine), Module);

      // Listen to the detector only now the recognizer exists: nothing it sends is lost, and nothing is decoded before.
      if (segmentPort) inbox = createSegmentInbox(segmentPort);

      isReady = true;
      var elapsed = Math.round(performance.now() - startTime);
      postMessage({ type: 'ready', loadTimeMs: elapsed });
    } catch (e) {
      postMessage({ type: 'error', error: 'Init failed: ' + (e.message || e) });
    }
  };

  // Load bundled Emscripten glue code + sherpa-onnx JS API wrappers.
  // The glue JS is patched to use Module._dataPackageMetadata instead of
  // hardcoded loadPackage({...}) metadata.
  // After importScripts, these globals become available:
  //   - Module (enhanced by Emscripten glue)
  //   - CircularBuffer, Vad, createVad (from sherpa-onnx-vad.js)
  //   - OfflineRecognizer, OfflineStream (from sherpa-onnx-asr.js)
  try {
    importScripts(
      runtimeBaseUrl + '/sherpa-onnx-wasm-main-vad-asr.js',
      runtimeBaseUrl + '/sherpa-onnx-vad.js',
      runtimeBaseUrl + '/sherpa-onnx-asr.js'
    );
  } catch (e) {
    postMessage({
      type: 'error',
      error: 'Failed to load WASM scripts: ' + (e.message || e)
    });
  }
}

// ─── Decoding ────────────────────────────────────────────────────────────────

/**
 * Decode one speech segment (Float32 @ 16 kHz). Returns what the result message carries, or null when the
 * recognizer heard no text. Both turn sources (the own VAD below, the detector's inbox) go through here.
 */
function decodeSpeech(speechSamples) {
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
  text = text.replace(/([　-鿿豈-﫿])\s+(?=[　-鿿豈-﫿])/g, '$1');
  if (!text) return null;
  return { text: text, durationMs: durationMs, recognitionTimeMs: recognitionTimeMs };
}

/** Decode the segments the own VAD has finished and post their results. */
function drainVadSegments() {
  while (!vad.isEmpty()) {
    var speechSegment = vad.front();
    var decoded = decodeSpeech(speechSegment.samples);
    if (decoded) {
      postMessage({
        type: 'result',
        text: decoded.text,
        startSample: speechSegment.start,
        durationMs: decoded.durationMs,
        recognitionTimeMs: decoded.recognitionTimeMs,
      });
    }
    vad.pop();
    isSpeaking = false;
  }
}

// ─── Own VAD (no segment port) ───────────────────────────────────────────────

/**
 * Process incoming audio chunk through VAD → ASR pipeline.
 * Audio flows: circular buffer → VAD windowing → speech segment detection → ASR
 */
function handleAudio(msg) {
  if (!isReady || !vad || !buffer || !recognizer) {
    return; // Silently drop if not initialized (and always, with a segment port: the detector has the audio)
  }

  try {
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

      // Detect speech start transition via VAD state
      if (!isSpeaking && vad.isDetected()) {
        isSpeaking = true;
        postMessage({ type: 'speech_start' });
      }
    }

    drainVadSegments();
  } catch (e) {
    isSpeaking = false;
    postMessage({ type: 'error', error: 'ASR processing error: ' + (e.message || e) });
    // Drain remaining VAD segments to prevent stale state
    try { while (!vad.isEmpty()) { vad.pop(); } } catch (_) {}
  }
}

/**
 * Force VAD to emit any pending speech segment and run it through ASR.
 * Called on PTT release so the user doesn't have to press again to get results.
 */
function handleFlush() {
  if (!isReady || !vad || !recognizer) return;

  try {
    vad.flush();
    drainVadSegments();
  } catch (e) {
    isSpeaking = false;
    postMessage({ type: 'error', error: 'ASR flush error: ' + (e.message || e) });
    try { while (!vad.isEmpty()) { vad.pop(); } } catch (_) {}
  }
}

// ─── The detector's segments (segment port) ──────────────────────────────────

/** Gives queued port messages (a `stop`, a `cancel`) a turn between two synchronous decodes. */
function yieldToPort() {
  return new Promise(function (resolve) { setTimeout(resolve, 0); });
}

/**
 * The recognizer's end of the detector's port, the plain-JS twin of SegmentInbox (workers/_shared/segment-inbox.ts;
 * this worker is a classic script and cannot import it). Segments are decoded one at a time in arrival order, each
 * acknowledged `taken` when its decode starts or when it is dropped, so the detector's decode-queue bound frees it.
 * A stop raises the epoch and drops the older one's queued segments; a cancel drops that press's segments not yet
 * started; a drain mark is answered once everything before it is decoded or dropped.
 */
function createSegmentInbox(port) {
  const INITIAL_EPOCH = 1;
  let queue = [];
  let epoch = INITIAL_EPOCH;
  let pumping = null;
  let closed = false;

  function ack(item) {
    if (closed) return;
    port.postMessage({ type: 'taken', epoch: item.epoch, seq: item.seq });
  }

  function decodeOne(item) {
    const decoded = decodeSpeech(item.audio);
    if (!decoded) return;
    const result = {
      type: 'result',
      text: decoded.text,
      startSample: item.start,
      durationMs: decoded.durationMs,
      recognitionTimeMs: decoded.recognitionTimeMs,
      epoch: item.epoch,
      seq: item.seq,
      endedBy: item.endedBy,
    };
    if (item.press !== undefined) result.press = item.press;
    if (item.smartTurnProbability !== undefined) result.smartTurnProbability = item.smartTurnProbability;
    postMessage(result);
  }

  async function pump() {
    let item;
    while (!closed && (item = queue.shift())) {
      if (item.epoch < epoch) {
        if (item.type === 'segment') ack(item);
        continue;
      }
      if (item.type === 'drained') {
        try { postMessage({ type: 'drained', epoch: item.epoch, seq: item.seq }); } catch (_) { /* best-effort */ }
        continue;
      }
      ack(item);
      try {
        decodeOne(item);
      } catch (e) {
        // The segment was acked before it started, so the detector is not wedged; the ones behind it still run.
        try { postMessage({ type: 'error', error: 'ASR processing error: ' + (e.message || e) }); } catch (_) { /* best-effort */ }
      }
      await yieldToPort();
    }
  }

  function receive(msg) {
    if (closed) return;
    switch (msg.type) {
      case 'segment':
        if (msg.epoch < epoch) { ack(msg); return; }
        queue.push(msg);
        break;
      case 'drained':
        queue.push(msg);
        break;
      case 'cancel':
        if (msg.epoch < epoch) return;
        queue = queue.filter(function (item) {
          if (item.type !== 'segment' || item.epoch !== msg.epoch || item.press !== msg.press) return true;
          ack(item);
          return false;
        });
        return;
      default:
        return;
    }
    if (!pumping) pumping = pump().then(function () { pumping = null; }, function () { pumping = null; });
  }

  port.onmessage = function (e) { receive(e.data); };

  return {
    /** Segments of an older epoch are dropped (and acked); their drained marks stay unanswered. */
    stop: function (next) {
      if (next <= epoch) return;
      epoch = next;
      queue = queue.filter(function (item) {
        if (item.epoch >= next) return true;
        if (item.type === 'segment') ack(item);
        return false;
      });
    },
    /** Stops listening; resolves when the decode in flight has finished. Whatever still waits is dropped. */
    close: function () {
      closed = true;
      port.onmessage = null;
      queue = [];
      port.close();
      return pumping || Promise.resolve();
    },
  };
}

// ─── Dispose ─────────────────────────────────────────────────────────────────

async function handleDispose() {
  // Stop listening and wait for the decode in flight: nothing can then run against the recognizer freed below.
  isReady = false; // from here audio and stop are ignored, whatever arrives during the awaits below
  if (inbox) {
    const closing = inbox;
    inbox = null;
    // A port that will not close must not leave the recognizer unfreed or `disposed` unsaid.
    try { await closing.close(); } catch (_) { /* freed below regardless */ }
  }
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
    case 'flush':
      handleFlush();
      break;
    case 'stop':
      if (inbox) inbox.stop(msg.epoch);
      break;
    case 'dispose':
      handleDispose();
      break;
    default:
      postMessage({ type: 'error', error: 'Unknown message type: ' + msg.type });
  }
};
