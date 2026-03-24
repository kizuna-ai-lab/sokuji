/**
 * Piper-Plus TTS Worker — Classic Web Worker (not ES module).
 *
 * Uses OpenJTalk WASM for Japanese phonemization.
 * Runs VITS inference via ONNX Runtime Web (UMD build loaded via importScripts).
 * Currently supports Japanese only.
 *
 * Protocol:
 *   Main → Worker:
 *     { type: 'init', fileUrls, runtimeBaseUrl, ortBaseUrl, engine, ttsConfig }
 *     { type: 'generate', text, sid, speed, lang }
 *     { type: 'dispose' }
 *
 *   Worker → Main:
 *     { type: 'ready', loadTimeMs, numSpeakers, sampleRate }
 *     { type: 'status', message }
 *     { type: 'result', samples: Float32Array, sampleRate, generationTimeMs }
 *     { type: 'error', error }
 *     { type: 'disposed' }
 */

// ─── State ──────────────────────────────────────────────────────────────────

var openjtalkModule = null;   // OpenJTalk Emscripten module instance
var onnxSession = null;       // ONNX Runtime InferenceSession
var phonemeIdMap = null;       // { phoneme_string: [id, ...], ... } from model.onnx.json
var prosodyIdMap = null;       // optional prosody map from model.onnx.json
var modelSampleRate = 22050;   // default; overridden by model config
var ttsConfig = {};            // engine config from manifest (languageIdMap, etc.)
var isReady = false;

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Fetch a blob URL and return its contents as a Uint8Array.
 * Must be done during init because blob URLs are revoked after ready.
 */
function fetchBlobAsUint8Array(url) {
  return fetch(url).then(function(resp) {
    if (!resp.ok) throw new Error('Failed to fetch blob: ' + resp.status);
    return resp.arrayBuffer();
  }).then(function(buf) {
    return new Uint8Array(buf);
  });
}

/**
 * Fetch a blob URL and return its contents as a string (JSON, etc.).
 */
function fetchBlobAsText(url) {
  return fetch(url).then(function(resp) {
    if (!resp.ok) throw new Error('Failed to fetch blob: ' + resp.status);
    return resp.text();
  });
}

/**
 * Find a blob URL in fileUrls by suffix match.
 * Manifest filenames may include a model-specific prefix (e.g. 'piper-plus-css10-ja-6lang/model.onnx').
 * This helper finds the URL for a file regardless of prefix.
 */
function findFileUrl(fileUrls, suffix) {
  // Try exact match first
  if (fileUrls[suffix]) return fileUrls[suffix];
  // Try suffix match
  var keys = Object.keys(fileUrls);
  for (var i = 0; i < keys.length; i++) {
    if (keys[i].endsWith('/' + suffix) || keys[i] === suffix) {
      return fileUrls[keys[i]];
    }
  }
  return null;
}

/**
 * Load the OpenJTalk factory via importScripts (CSP-compatible).
 * Uses openjtalk-classic.js — a pre-processed version with import.meta.url
 * replaced by self.location.href and export default stripped.
 * After importScripts, OpenJTalkModule is available as a global function.
 */
function loadOpenJTalkFactory(runtimeBaseUrl) {
  importScripts(runtimeBaseUrl + '/openjtalk-classic.js');
  if (typeof OpenJTalkModule === 'function') {
    return Promise.resolve(OpenJTalkModule);
  }
  return Promise.reject(new Error('OpenJTalkModule not found after importing openjtalk-classic.js'));
}

// ─── Init ───────────────────────────────────────────────────────────────────

function handleInit(msg) {
  var fileUrls = msg.fileUrls;
  var runtimeBaseUrl = msg.runtimeBaseUrl;
  var ortBaseUrl = msg.ortBaseUrl;
  ttsConfig = msg.ttsConfig || {};

  if (!fileUrls) {
    postMessage({ type: 'error', error: 'fileUrls is required' });
    return;
  }

  if (!runtimeBaseUrl) {
    postMessage({ type: 'error', error: 'runtimeBaseUrl is required' });
    return;
  }

  if (!ortBaseUrl) {
    postMessage({ type: 'error', error: 'ortBaseUrl is required' });
    return;
  }

  var startTime = performance.now();

  postMessage({ type: 'status', message: 'Loading ONNX Runtime...' });

  // Step 1: Load ONNX Runtime Web UMD build
  try {
    importScripts(ortBaseUrl + '/ort.wasm.min.js');
  } catch (e) {
    postMessage({ type: 'error', error: 'Failed to load ONNX Runtime: ' + (e.message || e) });
    return;
  }

  // Configure ORT WASM paths
  ort.env.wasm.wasmPaths = ortBaseUrl + '/';

  // Step 2: Load Japanese phonemizer module
  postMessage({ type: 'status', message: 'Loading phonemizer modules...' });
  try {
    importScripts(runtimeBaseUrl + '/japanese_phoneme_extract.js');
  } catch (e) {
    postMessage({ type: 'error', error: 'Failed to load phonemizer modules: ' + (e.message || e) });
    return;
  }

  // Step 3: Load OpenJTalk factory, dict/voice files,
  //         model config, and ONNX model in parallel
  postMessage({ type: 'status', message: 'Loading OpenJTalk and model...' });

  var openjtalkFactoryPromise = loadOpenJTalkFactory(runtimeBaseUrl);
  var configUrl = findFileUrl(fileUrls, 'config.json');
  var modelConfigPromise = configUrl
    ? fetchBlobAsText(configUrl).then(function(text) { return JSON.parse(text); })
    : Promise.resolve(null);
  var modelUrl = findFileUrl(fileUrls, 'model.onnx');
  var modelBytesPromise = modelUrl
    ? fetchBlobAsUint8Array(modelUrl)
    : Promise.reject(new Error('model.onnx blob URL not found in fileUrls'));

  // Collect dict files from fileUrls (suffix match handles model-prefixed paths)
  var dictFiles = ['char.bin', 'matrix.bin', 'sys.dic', 'unk.dic',
                   'left-id.def', 'pos-id.def', 'rewrite.def', 'right-id.def'];
  var dictDataPromises = dictFiles.map(function(file) {
    var url = findFileUrl(fileUrls, 'dict/' + file);
    if (url) {
      return fetchBlobAsUint8Array(url);
    }
    return Promise.resolve(null);
  });

  // Voice file
  var voiceUrl = findFileUrl(fileUrls, 'voice/mei_normal.htsvoice');
  var voicePromise = voiceUrl
    ? fetchBlobAsUint8Array(voiceUrl)
    : Promise.resolve(null);

  // OpenJTalk WASM binary
  var openjtalkWasmPromise = fetch(runtimeBaseUrl + '/openjtalk.wasm').then(function(resp) {
    if (!resp.ok) throw new Error('Failed to fetch openjtalk.wasm: ' + resp.status);
    return resp.arrayBuffer();
  });

  Promise.all([
    openjtalkFactoryPromise,
    modelConfigPromise,
    modelBytesPromise,
    Promise.all(dictDataPromises),
    voicePromise,
    openjtalkWasmPromise
  ]).then(function(results) {
    var factory = results[0];
    var modelConfig = results[1];
    var modelBytes = results[2];
    var dictData = results[3];
    var voiceData = results[4];
    var openjtalkWasmBinary = results[5];

    // Parse model config
    if (modelConfig) {
      phonemeIdMap = modelConfig.phoneme_id_map || null;
      prosodyIdMap = modelConfig.prosody_id_map || null;
      if (modelConfig.audio && modelConfig.audio.sample_rate) {
        modelSampleRate = modelConfig.audio.sample_rate;
      }
    }

    postMessage({ type: 'status', message: 'Initializing OpenJTalk...' });

    // Step 4: Initialize OpenJTalk via factory
    return factory({
      locateFile: function(path) {
        if (path.endsWith('.wasm')) return runtimeBaseUrl + '/openjtalk.wasm';
        return path;
      },
      wasmBinary: openjtalkWasmBinary
    }).then(function(mod) {
      openjtalkModule = mod;

      // Create filesystem directories
      try { mod.FS.mkdir('/dict'); } catch (e) { /* may already exist */ }
      try { mod.FS.mkdir('/voice'); } catch (e) { /* may already exist */ }

      // Write dict files to virtual FS
      for (var i = 0; i < dictFiles.length; i++) {
        if (dictData[i]) {
          mod.FS.writeFile('/dict/' + dictFiles[i], dictData[i]);
        }
      }

      // Write voice file
      if (voiceData) {
        mod.FS.writeFile('/voice/mei_normal.htsvoice', voiceData);
      }

      // Initialize OpenJTalk native
      var dictPtr = mod.allocateUTF8('/dict');
      var voicePtr = mod.allocateUTF8('/voice/mei_normal.htsvoice');
      var initResult = mod._openjtalk_initialize(dictPtr, voicePtr);
      mod._free(dictPtr);
      mod._free(voicePtr);

      if (initResult !== 0) {
        throw new Error('OpenJTalk initialization failed with code: ' + initResult);
      }

      postMessage({ type: 'status', message: 'Creating ONNX session...' });

      // Step 5: Create ONNX session from model bytes
      return ort.InferenceSession.create(modelBytes.buffer, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all'
      });
    }).then(function(session) {
      onnxSession = session;

      isReady = true;
      var elapsed = Math.round(performance.now() - startTime);
      postMessage({
        type: 'ready',
        loadTimeMs: elapsed,
        numSpeakers: 1,
        sampleRate: modelSampleRate
      });
    });
  }).catch(function(err) {
    postMessage({ type: 'error', error: 'Piper-Plus init failed: ' + (err.message || err) });
  });
}

// ─── Phonemization ──────────────────────────────────────────────────────────

/**
 * Convert a phoneme token array to an int64 ID sequence using phoneme_id_map.
 * Matching the multilingual demo's format:
 *   [BOS, PAD, phoneme1, PAD, phoneme2, PAD, ..., EOS]
 *
 * Input tokens should include '^' (BOS) and '$' (EOS).
 * BOS/EOS from the input are skipped — we inject them explicitly.
 * Unknown tokens are silently dropped.
 */
function phonemeTokensToIds(tokens) {
  if (!phonemeIdMap) return [];

  var padIds = phonemeIdMap['_'] || [0];
  var bosIds = phonemeIdMap['^'] || [1];
  var eosIds = phonemeIdMap['$'] || [2];

  var ids = [];

  // BOS + PAD prefix
  for (var b = 0; b < bosIds.length; b++) ids.push(bosIds[b]);
  for (var p = 0; p < padIds.length; p++) ids.push(padIds[p]);

  for (var i = 0; i < tokens.length; i++) {
    var token = tokens[i];
    // Skip BOS/EOS from input — we handle them ourselves
    if (token === '^' || token === '$') continue;

    var mapped = phonemeIdMap[token];
    if (mapped) {
      for (var j = 0; j < mapped.length; j++) {
        ids.push(mapped[j]);
      }
      // PAD after each phoneme
      for (var q = 0; q < padIds.length; q++) ids.push(padIds[q]);
    }
    // Unknown tokens silently dropped
  }

  // EOS suffix
  for (var e = 0; e < eosIds.length; e++) ids.push(eosIds[e]);

  return ids;
}

/**
 * Phonemize text for Japanese using OpenJTalk labels → phoneme extraction.
 * extractPhonemesFromLabels() returns tokens including '^' and '$' from sil labels.
 * Returns an array of phoneme IDs (integers).
 */
function phonemizeJapanese(text) {
  var mod = openjtalkModule;
  var textPtr = mod.allocateUTF8(text);
  var labelsPtr = mod._openjtalk_synthesis_labels(textPtr);
  var labels = mod.UTF8ToString(labelsPtr);

  mod._openjtalk_free_string(labelsPtr);
  mod._free(textPtr);

  if (labels.indexOf('ERROR:') === 0) {
    throw new Error('OpenJTalk label extraction failed: ' + labels);
  }

  // Extract phoneme tokens from labels (includes PUA mapping, '^' and '$')
  var tokens = extractPhonemesFromLabels(labels);
  return phonemeTokensToIds(tokens);
}

/**
 * Phonemize text — currently only Japanese is supported.
 * Returns a Promise resolving to an array of phoneme IDs (integers).
 */
function phonemize(text) {
  return Promise.resolve(phonemizeJapanese(text));
}

// ─── Generate ───────────────────────────────────────────────────────────────

function handleGenerate(msg) {
  if (!isReady || !onnxSession) {
    postMessage({ type: 'error', error: 'TTS not initialized' });
    return;
  }

  var text = msg.text || '';
  var speed = msg.speed || 1.0;

  if (!text.trim()) {
    postMessage({ type: 'error', error: 'Empty text' });
    return;
  }

  var startTime = performance.now();

  // Step 1: Phonemize (Japanese only — OpenJTalk)
  phonemize(text).then(function(phonemeIds) {
    if (!phonemeIds || phonemeIds.length === 0) {
      postMessage({ type: 'error', error: 'Phonemization produced no output for: ' + text });
      return;
    }

    var seqLen = phonemeIds.length;

    // Step 2: Build ONNX tensors
    // input: int64 [1, seq_len]
    var inputData = new BigInt64Array(seqLen);
    for (var i = 0; i < seqLen; i++) {
      inputData[i] = BigInt(phonemeIds[i]);
    }
    var inputTensor = new ort.Tensor('int64', inputData, [1, seqLen]);

    // input_lengths: int64 [1]
    var inputLengths = new BigInt64Array([BigInt(seqLen)]);
    var inputLengthsTensor = new ort.Tensor('int64', inputLengths, [1]);

    // scales: float32 [3] — [noise_scale, length_scale, noise_scale_w]
    var lengthScale = 1.0 / speed;
    var scalesData = new Float32Array([0.667, lengthScale, 0.8]);
    var scalesTensor = new ort.Tensor('float32', scalesData, [3]);

    var feeds = {
      input: inputTensor,
      input_lengths: inputLengthsTensor,
      scales: scalesTensor
    };

    // Language ID tensor — required by the model (input name: 'lid')
    // Currently Japanese only (lid=0)
    feeds.lid = new ort.Tensor('int64', new BigInt64Array([BigInt(0)]), [1]);

    // Prosody features — required by this model, shape [1, seq_len, 3]
    // Default to zeros (neutral prosody). Full prosody extraction from
    // OpenJTalk A1/A2/A3 labels can be added later for better intonation.
    var prosodyData = new BigInt64Array(seqLen * 3);  // zero-filled
    feeds.prosody_features = new ort.Tensor('int64', prosodyData, [1, seqLen, 3]);

    // Step 3: Run ONNX inference
    onnxSession.run(feeds).then(function(results) {
      // Extract output samples
      var outputTensor = results.output || results[Object.keys(results)[0]];
      var samples = outputTensor.data;

      // Ensure Float32Array
      if (!(samples instanceof Float32Array)) {
        samples = new Float32Array(samples);
      }

      var generationTimeMs = Math.round(performance.now() - startTime);

      // Transfer the buffer for zero-copy performance
      postMessage(
        {
          type: 'result',
          samples: samples,
          sampleRate: modelSampleRate,
          generationTimeMs: generationTimeMs
        },
        [samples.buffer]
      );
    }).catch(function(err) {
      postMessage({ type: 'error', error: 'ONNX inference failed: ' + (err.message || err) });
    });
  }).catch(function(e) {
    postMessage({ type: 'error', error: 'Generation failed: ' + (e.message || e) });
  });
}

// ─── Dispose ────────────────────────────────────────────────────────────────

function handleDispose() {
  try {
    if (openjtalkModule && openjtalkModule._openjtalk_clear) {
      openjtalkModule._openjtalk_clear();
    }
  } catch (e) {
    // Ignore cleanup errors
  }

  if (onnxSession) {
    try {
      onnxSession.release();
    } catch (e) {
      // Ignore cleanup errors
    }
  }

  openjtalkModule = null;
  onnxSession = null;
  phonemeIdMap = null;
  prosodyIdMap = null;
  isReady = false;
  ttsConfig = {};

  postMessage({ type: 'disposed' });
}

// ─── Message Handler ────────────────────────────────────────────────────────

self.onmessage = function(event) {
  var msg = event.data;
  switch (msg.type) {
    case 'init':
      try {
        handleInit(msg);
      } catch (e) {
        postMessage({ type: 'error', error: 'Init error: ' + (e.message || e) });
      }
      break;
    case 'generate':
      try {
        handleGenerate(msg);
      } catch (e) {
        postMessage({ type: 'error', error: 'Generate error: ' + (e.message || e) });
      }
      break;
    case 'dispose':
      handleDispose();
      break;
    default:
      postMessage({ type: 'error', error: 'Unknown message type: ' + msg.type });
  }
};
