/**
 * Simple Unified Phonemizer API
 * Uses OpenJTalk for Japanese, a simple phonemizer for English,
 * and character-based fallbacks for zh/es/fr/pt.
 * Adapted for classic worker importScripts() context (no ES module syntax).
 *
 * Original: piper-plus/src/wasm/openjtalk-web/src/simple_unified_api.js
 *
 * Prerequisites (must be loaded via importScripts before this file):
 *   - simple_english_phonemizer.js  (SimpleEnglishPhonemizer, createEnglishPhonemeMap)
 *   - japanese_phoneme_extract.js   (extractPhonemesFromLabels)
 *
 * Exposes global:
 *   - SimpleUnifiedPhonemizer class
 */

function SimpleUnifiedPhonemizer(options) {
    options = options || {};
    this.openjtalkModule = null;
    this.englishPhonemizer = new SimpleEnglishPhonemizer();
    this.englishPhonemeMap = createEnglishPhonemeMap();
    this.initialized = false;
    // phoneme_id_map from model config (set via setPhonemeIdMap or initialize)
    this.phonemeIdMap = options.phonemeIdMap || null;
    // Base URL for resolving WASM file paths (worker context, no window.location)
    this.baseUrl = options.baseUrl || '';
}

/**
 * Initialize the phonemizer
 */
SimpleUnifiedPhonemizer.prototype.initialize = function(config) {
    var self = this;
    return new Promise(function(resolve, reject) {
        try {
            console.log('Initializing Simple Unified Phonemizer...');

            var chain = Promise.resolve();

            // Initialize OpenJTalk for Japanese
            if (config.openjtalk) {
                chain = chain.then(function() {
                    return self.initializeOpenJTalk(config.openjtalk);
                });
            }

            chain.then(function() {
                self.initialized = true;
                console.log('Simple Unified Phonemizer initialized');
                resolve();
            }).catch(reject);
        } catch (error) {
            console.error('Failed to initialize:', error);
            reject(error);
        }
    });
};

/**
 * Initialize OpenJTalk.
 * In worker context, the OpenJTalk WASM glue must already be loaded
 * via importScripts() so that the factory function is available as a global.
 */
SimpleUnifiedPhonemizer.prototype.initializeOpenJTalk = function(config) {
    var self = this;

    console.log('Loading OpenJTalk WebAssembly...');

    // In worker context, OpenJTalk glue is loaded via importScripts.
    // The Emscripten glue typically sets a global Module or a factory.
    // We expect the caller to have loaded openjtalk.js already and the
    // factory to be available. config.factory can be passed directly.
    var factory = config.factory || (typeof OpenJTalk !== 'undefined' ? OpenJTalk : null);
    if (!factory) {
        return Promise.reject(new Error('OpenJTalk factory not available. Load openjtalk.js via importScripts first.'));
    }

    var wasmUrl = config.wasmUrl || (self.baseUrl + '/openjtalk.wasm');

    return fetch(wasmUrl)
        .then(function(resp) {
            if (!resp.ok) throw new Error('Failed to fetch openjtalk.wasm: ' + resp.status);
            return resp.arrayBuffer();
        })
        .then(function(wasmBinary) {
            return factory({
                locateFile: function(path) {
                    if (path.endsWith('.wasm')) return wasmUrl;
                    return path;
                },
                wasmBinary: wasmBinary
            });
        })
        .then(function(mod) {
            self.openjtalkModule = mod;

            // Create directories
            mod.FS.mkdir('/dict');
            mod.FS.mkdir('/voice');

            // Load dictionary and voice files
            return self.loadOpenJTalkData(config);
        })
        .then(function() {
            // Initialize OpenJTalk
            var dictPtr = self.openjtalkModule.allocateUTF8('/dict');
            var voicePtr = self.openjtalkModule.allocateUTF8('/voice/voice.htsvoice');
            var result = self.openjtalkModule._openjtalk_initialize(dictPtr, voicePtr);
            self.openjtalkModule._free(dictPtr);
            self.openjtalkModule._free(voicePtr);

            if (result !== 0) {
                throw new Error('OpenJTalk initialization failed with code: ' + result);
            }

            console.log('OpenJTalk initialized');
        });
};

/**
 * Load OpenJTalk data files
 */
SimpleUnifiedPhonemizer.prototype.loadOpenJTalkData = function(config) {
    var self = this;
    var dictUrl = config.dictUrl || (self.baseUrl + '/dict');
    var voiceUrl = config.voiceUrl || (self.baseUrl + '/voice/mei_normal.htsvoice');

    // Load dictionary files
    var dictFiles = [
        'char.bin', 'matrix.bin', 'sys.dic', 'unk.dic',
        'left-id.def', 'pos-id.def', 'rewrite.def', 'right-id.def'
    ];

    var dictPromises = dictFiles.map(function(file) {
        return fetch(dictUrl + '/' + file).then(function(r) { return r.arrayBuffer(); });
    });

    return Promise.all(dictPromises).then(function(dictData) {
        for (var i = 0; i < dictFiles.length; i++) {
            self.openjtalkModule.FS.writeFile('/dict/' + dictFiles[i], new Uint8Array(dictData[i]));
        }

        // Load voice file
        return fetch(voiceUrl).then(function(r) { return r.arrayBuffer(); });
    }).then(function(voiceData) {
        self.openjtalkModule.FS.writeFile('/voice/voice.htsvoice', new Uint8Array(voiceData));
    });
};

/**
 * Convert text to phonemes
 */
SimpleUnifiedPhonemizer.prototype.textToPhonemes = function(text, language) {
    if (!this.initialized) {
        return Promise.reject(new Error('Phonemizer not initialized'));
    }

    // Auto-detect language if not specified
    if (!language) {
        language = this.detectLanguage(text);
    }

    if (language === 'ja') {
        return this.textToPhonemesJapanese(text);
    } else if (language === 'en') {
        return this.textToPhonemesEnglish(text);
    } else if (language === 'zh') {
        return Promise.resolve(this.phonemizeChinese(text));
    } else {
        return Promise.resolve(this.phonemizeLatinFallback(text));
    }
};

/**
 * Japanese text to phonemes using OpenJTalk
 */
SimpleUnifiedPhonemizer.prototype.textToPhonemesJapanese = function(text) {
    var mod = this.openjtalkModule;
    var textPtr = mod.allocateUTF8(text);
    var labelsPtr = mod._openjtalk_synthesis_labels(textPtr);
    var labels = mod.UTF8ToString(labelsPtr);

    mod._openjtalk_free_string(labelsPtr);
    mod._free(textPtr);

    if (labels.indexOf('ERROR:') === 0) {
        return Promise.reject(new Error(labels));
    }

    return Promise.resolve(labels);
};

/**
 * English text to phonemes using simple phonemizer
 */
SimpleUnifiedPhonemizer.prototype.textToPhonemesEnglish = function(text) {
    var phonemes = this.englishPhonemizer.textToPhonemes(text);
    var ipaString = this.englishPhonemizer.phonemesToIPA(phonemes);
    return Promise.resolve(ipaString);
};

/**
 * Chinese text to phoneme IDs using character-based phoneme_id_map fallback.
 */
SimpleUnifiedPhonemizer.prototype.phonemizeChinese = function(text) {
    var phonemeIdMap = this.phonemeIdMap;
    if (!phonemeIdMap) {
        throw new Error('phonemeIdMap is required for Chinese phonemization. Call setPhonemeIdMap() first.');
    }
    var phonemeIds = [1]; // BOS
    for (var ci = 0; ci < text.length; ci++) {
        var char = text[ci];
        if (phonemeIdMap[char]) {
            phonemeIds.push.apply(phonemeIds, phonemeIdMap[char]);
            phonemeIds.push(0); // PAD
        }
    }
    phonemeIds.push(2); // EOS
    return phonemeIds;
};

/**
 * Latin-script language (es/fr/pt) text to phoneme IDs.
 */
SimpleUnifiedPhonemizer.prototype.phonemizeLatinFallback = function(text) {
    var phonemeIdMap = this.phonemeIdMap;
    if (!phonemeIdMap) {
        throw new Error('phonemeIdMap is required for Latin fallback phonemization. Call setPhonemeIdMap() first.');
    }
    var phonemeIds = [1]; // BOS
    var lowerText = text.toLowerCase();
    for (var ci = 0; ci < lowerText.length; ci++) {
        var char = lowerText[ci];
        if (phonemeIdMap[char]) {
            phonemeIds.push.apply(phonemeIds, phonemeIdMap[char]);
            phonemeIds.push(0); // PAD
        } else if (char === ' ' && phonemeIdMap[' ']) {
            phonemeIds.push.apply(phonemeIds, phonemeIdMap[' ']);
            phonemeIds.push(0); // PAD
        }
    }
    phonemeIds.push(2); // EOS
    return phonemeIds;
};

/**
 * Set the phoneme_id_map from model config.
 */
SimpleUnifiedPhonemizer.prototype.setPhonemeIdMap = function(phonemeIdMap) {
    this.phonemeIdMap = phonemeIdMap;
};

/**
 * Extract phonemes from labels based on language.
 */
SimpleUnifiedPhonemizer.prototype.extractPhonemes = function(labels, language) {
    language = language || 'ja';
    if (language === 'ja') {
        return this.extractPhonemesFromLabels(labels);
    } else if (language === 'en') {
        return this.extractPhonemesFromIPA(labels);
    } else {
        // zh/es/fr/pt: textToPhonemes already returns phoneme ID arrays
        return labels;
    }
};

/**
 * Extract phonemes from OpenJTalk labels.
 * Uses the global extractPhonemesFromLabels from japanese_phoneme_extract.js
 */
SimpleUnifiedPhonemizer.prototype.extractPhonemesFromLabels = function(labels) {
    return extractPhonemesFromLabels(labels);
};

/**
 * Extract phonemes from IPA text
 */
SimpleUnifiedPhonemizer.prototype.extractPhonemesFromIPA = function(ipaData) {
    var phonemes = [];

    // Add BOS marker
    phonemes.push('^');

    // Handle both array and string input
    if (Array.isArray(ipaData)) {
        phonemes.push.apply(phonemes, ipaData);
    } else if (typeof ipaData === 'string') {
        var i = 0;
        while (i < ipaData.length) {
            var char = ipaData[i];

            // Check for two-character phonemes
            if (i + 1 < ipaData.length) {
                var twoChar = ipaData.substr(i, 2);
                if (this.englishPhonemeMap[twoChar]) {
                    phonemes.push(twoChar);
                    i += 2;
                    continue;
                }
            }

            // Single character or space
            if (char === ' ') {
                phonemes.push(' ');
            } else if (this.englishPhonemeMap[char]) {
                phonemes.push(char);
            }
            i++;
        }
    }

    // Add EOS marker
    phonemes.push('$');

    return phonemes;
};

/**
 * Get phoneme ID map for the specified language
 */
SimpleUnifiedPhonemizer.prototype.getPhonemeIdMap = function(language) {
    if (language === 'en') {
        return this.englishPhonemeMap;
    }
    if (language === 'zh' || language === 'es' || language === 'fr' || language === 'pt') {
        return this.phonemeIdMap;
    }
    return null;
};

/**
 * Detect language from text.
 * Priority: JA (Hiragana/Katakana) > ZH (CJK without Kana) > EN (default).
 */
SimpleUnifiedPhonemizer.prototype.detectLanguage = function(text) {
    var hasKana = false;
    var hasCJK = false;
    for (var ci = 0; ci < text.length; ci++) {
        var code = text.charCodeAt(ci);
        if ((code >= 0x3040 && code <= 0x309F) || (code >= 0x30A0 && code <= 0x30FF)) {
            hasKana = true;
            break;
        }
        if (code >= 0x4E00 && code <= 0x9FFF) {
            hasCJK = true;
        }
    }
    if (hasKana) return 'ja';
    if (hasCJK) return 'zh';
    return 'en';
};

/**
 * Cleanup
 */
SimpleUnifiedPhonemizer.prototype.dispose = function() {
    if (this.openjtalkModule && this.openjtalkModule._openjtalk_clear) {
        this.openjtalkModule._openjtalk_clear();
    }
    this.initialized = false;
};
