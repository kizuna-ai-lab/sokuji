/**
 * eSpeak-ng Phoneme Extractor
 * Adapted for classic worker importScripts() context (no ES module syntax).
 *
 * Original: piper-plus/src/wasm/openjtalk-web/src/espeak_phoneme_extractor.js
 *
 * IMPORTANT: The upstream eSpeak-ng WASM (espeakng.js / espeakng.worker.js)
 * uses a nested Worker pattern: espeakng.js spawns espeakng.worker.js as a
 * sub-worker. This is incompatible with Chrome extension sandbox which
 * prohibits nested workers.
 *
 * This adapted version does NOT use the real eSpeak-ng WASM at all. Instead
 * it provides a self-contained rule-based IPA phonemizer (matching the
 * original upstream fallback behavior in espeak_phoneme_extractor.js which
 * also used a hardcoded dictionary + simple rules rather than actual
 * eSpeak-ng synthesis).
 *
 * If real eSpeak-ng phonemization is needed in the future, the
 * espeakng.worker.js Emscripten module would need to be loaded inline
 * (importScripts) in the same worker context rather than as a sub-worker.
 *
 * Exposes global:
 *   - ESpeakPhonemeExtractor class
 */

function ESpeakPhonemeExtractor() {
    this.initialized = false;
}

/**
 * Initialize the extractor.
 * No sub-worker is spawned; the rule-based phonemizer is always ready.
 */
ESpeakPhonemeExtractor.prototype.initialize = function() {
    this.initialized = true;
    return Promise.resolve();
};

/**
 * Convert text to IPA phonemes.
 * Uses a dictionary + simple letter rules (same as the upstream implementation).
 *
 * @param {string} text
 * @param {string} voice - e.g. 'en-us' (currently only English rules)
 * @returns {Promise<string>} IPA text
 */
ESpeakPhonemeExtractor.prototype.textToIPA = function(text, voice) {
    if (!this.initialized) {
        return Promise.reject(new Error('ESpeakPhonemeExtractor not initialized'));
    }

    var words = text.toLowerCase().split(/\s+/);
    var ipaPhonemes = [];

    for (var i = 0; i < words.length; i++) {
        var word = words[i].toLowerCase();

        if (_espeakWordToIPA[word]) {
            ipaPhonemes.push(_espeakWordToIPA[word]);
        } else {
            ipaPhonemes.push(this.simpleWordToIPA(word));
        }

        if (i < words.length - 1) {
            ipaPhonemes.push(' ');
        }
    }

    return Promise.resolve(ipaPhonemes.join(''));
};

/**
 * Simple rule-based IPA conversion for unknown words.
 */
ESpeakPhonemeExtractor.prototype.simpleWordToIPA = function(word) {
    var ipa = '';

    for (var i = 0; i < word.length; i++) {
        var char = word[i];
        var nextChar = word[i + 1];

        // Special digraph patterns
        if (char === 't' && nextChar === 'h') {
            ipa += '\u03b8'; // θ
            i++;
        } else if (char === 'c' && nextChar === 'h') {
            ipa += 't\u0283'; // tʃ
            i++;
        } else if (char === 's' && nextChar === 'h') {
            ipa += '\u0283'; // ʃ
            i++;
        } else if (char === 'p' && nextChar === 'h') {
            ipa += 'f';
            i++;
        } else if (char === 'n' && nextChar === 'g') {
            ipa += '\u014b'; // ŋ
            i++;
        } else if (_espeakCharToIPA[char]) {
            ipa += _espeakCharToIPA[char];
        } else {
            ipa += char;
        }
    }

    return ipa;
};

/**
 * Extract phoneme array from IPA text.
 */
ESpeakPhonemeExtractor.prototype.extractPhonemesFromIPA = function(ipaText) {
    var phonemes = [];

    for (var i = 0; i < ipaText.length; i++) {
        var char = ipaText[i];

        if (char === ' ') {
            if (phonemes.length > 0 && phonemes[phonemes.length - 1] !== ' ') {
                phonemes.push(' ');
            }
        } else if ('\u02c8\u02cc\u02d0\u02d1'.indexOf(char) !== -1) {
            // Stress marks and length marks: ˈˌːˑ
            phonemes.push(char);
        } else if (char !== '\n' && char !== '\t') {
            phonemes.push(char);
        }
    }

    return phonemes;
};

/**
 * Full phonemization pipeline (Python-compatible).
 */
ESpeakPhonemeExtractor.prototype.phonemize = function(text, voice) {
    var self = this;
    return this.textToIPA(text, voice || 'en-us').then(function(ipaText) {
        var phonemes = self.extractPhonemesFromIPA(ipaText);
        return ['^'].concat(phonemes).concat(['$']);
    }).catch(function(error) {
        console.error('Phonemization failed:', error);
        // Fallback: split into characters
        var chars = [];
        for (var i = 0; i < text.length; i++) chars.push(text[i]);
        return ['^'].concat(chars).concat(['$']);
    });
};

// ---- Private lookup tables ----

var _espeakCharToIPA = {
    'a': '\u00e6', // æ
    'e': 'e',
    'i': '\u026a', // ɪ
    'o': '\u0252', // ɒ
    'u': '\u028c', // ʌ
    'y': 'i',
    'b': 'b',
    'c': 'k',
    'd': 'd',
    'f': 'f',
    'g': '\u0261', // ɡ
    'h': 'h',
    'j': 'd\u0292', // dʒ
    'k': 'k',
    'l': 'l',
    'm': 'm',
    'n': 'n',
    'p': 'p',
    'q': 'k',
    'r': 'r',
    's': 's',
    't': 't',
    'v': 'v',
    'w': 'w',
    'x': 'ks',
    'z': 'z'
};

var _espeakWordToIPA = {
    'hello': 'h\u025b\u02c8lo\u028a',
    'world': 'w\u025c\u02d0rld',
    'the': '\u00f0\u0259',
    'a': '\u0259',
    'an': '\u0259n',
    'and': '\u00e6nd',
    'is': '\u026az',
    'are': '\u0251\u02d0r',
    'was': 'w\u028cz',
    'were': 'w\u025c\u02d0r',
    'be': 'bi\u02d0',
    'been': 'bi\u02d0n',
    'being': '\u02c8bi\u02d0\u026a\u014b',
    'have': 'h\u00e6v',
    'has': 'h\u00e6z',
    'had': 'h\u00e6d',
    'do': 'du\u02d0',
    'does': 'd\u028cz',
    'did': 'd\u026ad',
    'will': 'w\u026al',
    'would': 'w\u028ad',
    'can': 'k\u00e6n',
    'could': 'k\u028ad',
    'may': 'me\u026a',
    'might': 'ma\u026at',
    'must': 'm\u028cst',
    'shall': '\u0283\u00e6l',
    'should': '\u0283\u028ad',
    'to': 'tu\u02d0',
    'of': '\u028cv',
    'in': '\u026an',
    'for': 'f\u0254\u02d0r',
    'on': '\u0252n',
    'with': 'w\u026a\u00f0',
    'at': '\u00e6t',
    'by': 'ba\u026a',
    'from': 'fr\u028cm',
    'up': '\u028cp',
    'about': '\u0259\u02c8ba\u028at',
    'into': '\u02c8\u026antu\u02d0',
    'through': '\u03b8ru\u02d0',
    'after': '\u02c8\u00e6ft\u0259r',
    'over': '\u02c8o\u028av\u0259r',
    'between': 'b\u026a\u02c8twi\u02d0n',
    'under': '\u02c8\u028cnd\u0259r',
    'not': 'n\u0252t',
    'all': '\u0254\u02d0l',
    'this': '\u00f0\u026as',
    'that': '\u00f0\u00e6t',
    'these': '\u00f0i\u02d0z',
    'those': '\u00f0o\u028az',
    'test': 'test',
    'text': 'tekst',
    'speech': 'spi\u02d0t\u0283',
    'system': '\u02c8s\u026ast\u0259m',
    'piper': '\u02c8pa\u026ap\u0259r',
    'one': 'w\u028cn',
    'two': 'tu\u02d0',
    'three': '\u03b8ri\u02d0',
    'four': 'f\u0254\u02d0r',
    'five': 'fa\u026av',
    'six': 's\u026aks',
    'seven': '\u02c8sev\u0259n',
    'eight': 'e\u026at',
    'nine': 'na\u026an',
    'ten': 'ten',
    'i': 'a\u026a',
    'you': 'ju\u02d0',
    'he': 'hi\u02d0',
    'she': '\u0283i\u02d0',
    'it': '\u026at',
    'we': 'wi\u02d0',
    'they': '\u00f0e\u026a',
    'my': 'ma\u026a',
    'your': 'j\u0254\u02d0r',
    'his': 'h\u026az',
    'her': 'h\u025c\u02d0r',
    'its': '\u026ats',
    'our': '\u02c8a\u028a\u0259r',
    'their': '\u00f0e\u0259r'
};
