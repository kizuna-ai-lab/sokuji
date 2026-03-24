/**
 * Piper-Plus TTS Worker — Classic Web Worker (not ES module).
 *
 * Uses OpenJTalk WASM for Japanese phonemization, a simple rule-based
 * phonemizer for English, and character-level fallback for zh/es/fr/pt.
 * Runs VITS inference via ONNX Runtime Web (UMD build loaded via importScripts).
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
var phonemizer = null;         // SimpleUnifiedPhonemizer instance

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
 * Load the OpenJTalk ES module by fetching as text, stripping the export,
 * and evaluating to get the factory function.
 * openjtalk.js is `async function OpenJTalkModule(moduleArg={}) { ... }; export default OpenJTalkModule;`
 */
function loadOpenJTalkFactory(runtimeBaseUrl) {
  // Ensure runtimeBaseUrl ends with '/' for URL resolution
  var baseUrl = runtimeBaseUrl.endsWith('/') ? runtimeBaseUrl : runtimeBaseUrl + '/';
  // Build the full URL to openjtalk.js so we can use it as the "script URL"
  var openjtalkJsUrl = baseUrl + 'openjtalk.js';

  return fetch(openjtalkJsUrl).then(function(resp) {
    if (!resp.ok) throw new Error('Failed to fetch openjtalk.js: ' + resp.status);
    return resp.text();
  }).then(function(src) {
    // Patch 1: Replace import.meta.url with the actual script URL.
    // openjtalk.js uses import.meta.url for:
    //   - var _scriptName = import.meta.url  (script location)
    //   - new URL("openjtalk.wasm", import.meta.url).href  (wasm file resolution)
    // In a classic worker, import.meta is not available, so we inject the URL as a string.
    var cleaned = src.replace(/import\.meta\.url/g, JSON.stringify(openjtalkJsUrl));

    // Patch 2: Strip ES module export to make it evaluable in classic worker context
    cleaned = cleaned.replace(/export\s+default\s+\w+\s*;?\s*$/, '');

    // Evaluate and return the factory function
    // The file defines `async function OpenJTalkModule(moduleArg={}) { ... }`
    // After eval, it's available in the worker scope
    // eslint-disable-next-line no-eval
    (0, eval)(cleaned);
    if (typeof OpenJTalkModule === 'function') {
      return OpenJTalkModule;
    }
    throw new Error('OpenJTalkModule not found after evaluating openjtalk.js');
  });
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

  // Step 2: Load phonemizer JS modules (classic scripts — importScripts works)
  postMessage({ type: 'status', message: 'Loading phonemizer modules...' });
  try {
    importScripts(
      runtimeBaseUrl + '/simple_english_phonemizer.js',
      runtimeBaseUrl + '/japanese_phoneme_extract.js',
      runtimeBaseUrl + '/espeak_phoneme_extractor.js',
      runtimeBaseUrl + '/simple_unified_api.js'
    );
  } catch (e) {
    postMessage({ type: 'error', error: 'Failed to load phonemizer modules: ' + (e.message || e) });
    return;
  }

  // Step 3: Load OpenJTalk factory (ES module — needs fetch+eval), dict/voice files,
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

      // Initialize phonemizer
      phonemizer = new SimpleUnifiedPhonemizer({ phonemeIdMap: phonemeIdMap });
      // Attach the already-initialized OpenJTalk module directly
      phonemizer.openjtalkModule = mod;
      phonemizer.initialized = true;

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
 * Phonemize text for English using ESpeakPhonemeExtractor.
 * Uses the same dictionary + rule-based IPA pipeline as the piper-plus demo.
 * ESpeakPhonemeExtractor.phonemize() returns ['^', ...phonemes, '$'].
 * Returns a Promise resolving to an array of phoneme IDs (integers).
 */
function phonemizeEnglish(text) {
  var extractor = new ESpeakPhonemeExtractor();
  extractor.initialized = true;
  // phonemize() is sync in practice (dictionary lookup, no async eSpeak)
  // but returns a Promise for API compatibility
  return extractor.phonemize(text, 'en-us');
}

/**
 * Phonemize text for Chinese using character-level phoneme_id_map lookup.
 * Returns an array of phoneme IDs (integers) with BOS/PAD/EOS.
 */
function phonemizeChinese(text) {
  if (!phonemeIdMap) return [];
  var ids = [];
  var padIds = phonemeIdMap['_'] || [0];
  var bosIds = phonemeIdMap['^'] || [1];
  var eosIds = phonemeIdMap['$'] || [2];

  for (var b = 0; b < bosIds.length; b++) ids.push(bosIds[b]);
  for (var p = 0; p < padIds.length; p++) ids.push(padIds[p]);

  for (var i = 0; i < text.length; i++) {
    var ch = text[i];
    var mapped = phonemeIdMap[ch];
    if (mapped) {
      for (var j = 0; j < mapped.length; j++) ids.push(mapped[j]);
      for (var q = 0; q < padIds.length; q++) ids.push(padIds[q]);
    }
  }

  for (var e = 0; e < eosIds.length; e++) ids.push(eosIds[e]);
  return ids;
}

/**
 * Phonemize text for Latin languages (es/fr/pt) using character-level mapping.
 * Lowercases text first, then maps each character through phoneme_id_map.
 * Returns an array of phoneme IDs (integers) with BOS/PAD/EOS.
 */
function phonemizeLatinFallback(text) {
  if (!phonemeIdMap) return [];
  var ids = [];
  var padIds = phonemeIdMap['_'] || [0];
  var bosIds = phonemeIdMap['^'] || [1];
  var eosIds = phonemeIdMap['$'] || [2];
  var spaceIds = phonemeIdMap[' '] || null;

  for (var b = 0; b < bosIds.length; b++) ids.push(bosIds[b]);
  for (var p = 0; p < padIds.length; p++) ids.push(padIds[p]);

  var lower = text.toLowerCase();
  for (var i = 0; i < lower.length; i++) {
    var ch = lower[i];
    if (ch === ' ') {
      if (spaceIds) {
        for (var s = 0; s < spaceIds.length; s++) ids.push(spaceIds[s]);
        for (var q = 0; q < padIds.length; q++) ids.push(padIds[q]);
      }
    } else {
      var mapped = phonemeIdMap[ch];
      if (mapped) {
        for (var j = 0; j < mapped.length; j++) ids.push(mapped[j]);
        for (var q2 = 0; q2 < padIds.length; q2++) ids.push(padIds[q2]);
      }
    }
  }

  for (var e = 0; e < eosIds.length; e++) ids.push(eosIds[e]);
  return ids;
}

/**
 * Route phonemization based on language.
 * Japanese and English return phoneme tokens → phonemeTokensToIds.
 * Chinese and Latin languages return raw phoneme IDs directly.
 * English returns a Promise; others are synchronous.
 */
function phonemize(text, lang) {
  if (lang === 'ja') {
    return Promise.resolve(phonemizeJapanese(text));
  } else if (lang === 'en') {
    // ESpeakPhonemeExtractor.phonemize returns Promise<token[]>
    return phonemizeEnglish(text).then(function(tokens) {
      return phonemeTokensToIds(tokens);
    });
  } else if (lang === 'zh') {
    return Promise.resolve(phonemizeChinese(text));
  } else {
    // es, fr, pt — Latin character-level fallback
    return Promise.resolve(phonemizeLatinFallback(text));
  }
}

// ─── Prosody Features ───────────────────────────────────────────────────────

/**
 * Build prosody features tensor for Japanese (if prosody_id_map exists).
 * Maps the same phoneme token sequence to prosody IDs.
 * Returns null if prosody is not supported by the model.
 */
function buildProsodyFeatures(text, phonemeIds) {
  if (!prosodyIdMap) return null;

  // For prosody, we need the token sequence to align with phoneme IDs.
  // The prosody feature tensor has shape [1, seq_len, 3] where seq_len matches
  // the phoneme input length. Each position gets 3 prosody features.
  // For now, return default prosody (zeros) — full prosody extraction would
  // require the label-level A1/A2/A3 data which extractPhonemesFromLabels
  // already parses but doesn't expose separately.
  var seqLen = phonemeIds.length;
  var features = new BigInt64Array(seqLen * 3);
  // Fill with zeros (default prosody)
  return features;
}

// ─── Generate ───────────────────────────────────────────────────────────────

function handleGenerate(msg) {
  if (!isReady || !onnxSession) {
    postMessage({ type: 'error', error: 'TTS not initialized' });
    return;
  }

  var text = msg.text || '';
  var speed = msg.speed || 1.0;
  var lang = msg.lang || 'ja';

  if (!text.trim()) {
    postMessage({ type: 'error', error: 'Empty text' });
    return;
  }

  // Normalize language code: 'zh_CN' → 'zh', 'ja-JP' → 'ja', 'en' → 'en'
  lang = lang.split(/[-_]/)[0].toLowerCase();

  var startTime = performance.now();

  // Step 1: Phonemize (async — English path returns a Promise)
  phonemize(text, lang).then(function(phonemeIds) {
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

    // Language ID tensor — required by multilingual piper-plus models (input name: 'lid')
    // Default to 0 (Japanese) if language not found in map
    var langId = 0;
    if (ttsConfig.languageIdMap && lang && ttsConfig.languageIdMap[lang] !== undefined) {
      langId = ttsConfig.languageIdMap[lang];
    }
    feeds.lid = new ort.Tensor('int64', new BigInt64Array([BigInt(langId)]), [1]);

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
  phonemizer = null;
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
