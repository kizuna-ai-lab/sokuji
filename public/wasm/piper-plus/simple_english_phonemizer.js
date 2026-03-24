/**
 * Simple English Phonemizer
 * A lightweight alternative to eSpeak-ng for demo purposes.
 * Adapted for classic worker importScripts() context (no ES module syntax).
 *
 * Original: piper-plus/src/wasm/openjtalk-web/src/simple_english_phonemizer.js
 *
 * Exposes globals:
 *   - SimpleEnglishPhonemizer class
 *   - createEnglishPhonemeMap()
 */

function SimpleEnglishPhonemizer() {
    // Basic pronunciation dictionary for common words
    // Using only phonemes available in the test model
    this.dictionary = {
        // Common words
        'hello': ['h', '\u025b', 'l', 'o'],
        'world': ['w', '\u025c', 'r', 'l', 'd'],
        'the': ['\u00f0', '\u0259'],
        'a': ['\u0259'],
        'an': ['\u00e6', 'n'],
        'and': ['\u00e6', 'n', 'd'],
        'is': ['\u026a', 'z'],
        'are': ['\u0251', 'r'],
        'was': ['w', '\u028c', 'z'],
        'were': ['w', '\u025c', 'r'],
        'been': ['b', '\u026a', 'n'],
        'have': ['h', '\u00e6', 'v'],
        'has': ['h', '\u00e6', 'z'],
        'had': ['h', '\u00e6', 'd'],
        'do': ['d', 'u'],
        'does': ['d', '\u028c', 'z'],
        'did': ['d', '\u026a', 'd'],
        'will': ['w', '\u026a', 'l'],
        'would': ['w', '\u028a', 'd'],
        'can': ['k', '\u00e6', 'n'],
        'could': ['k', '\u028a', 'd'],
        'should': ['\u0283', '\u028a', 'd'],
        'may': ['m', 'e', 'i'],
        'might': ['m', 'a', 'i', 't'],
        'must': ['m', '\u028c', 's', 't'],
        'to': ['t', 'u'],
        'of': ['\u028c', 'v'],
        'in': ['\u026a', 'n'],
        'on': ['\u0252', 'n'],
        'at': ['\u00e6', 't'],
        'by': ['b', 'a', 'i'],
        'for': ['f', '\u0254', 'r'],
        'with': ['w', '\u026a', '\u03b8'],
        'from': ['f', 'r', '\u028c', 'm'],
        'up': ['\u028c', 'p'],
        'out': ['a', 'u', 't'],
        'over': ['o', 'v', '\u0259', 'r'],
        'under': ['\u028c', 'n', 'd', '\u0259', 'r'],
        'not': ['n', '\u0252', 't'],
        'all': ['\u0254', 'l'],
        'one': ['w', '\u028c', 'n'],
        'two': ['t', 'u'],
        'three': ['\u03b8', 'r', 'i'],
        'four': ['f', '\u0254', 'r'],
        'five': ['f', 'a', 'i', 'v'],
        'good': ['\u0261', '\u028a', 'd'],
        'bad': ['b', '\u00e6', 'd'],
        'new': ['n', 'j', 'u'],
        'old': ['o', 'l', 'd'],
        'big': ['b', '\u026a', '\u0261'],
        'small': ['s', 'm', '\u0254', 'l'],

        // Tech terms
        'text': ['t', '\u025b', 'k', 's', 't'],
        'speech': ['s', 'p', 'i', '\u0283'],
        'voice': ['v', '\u0254', 'i', 's'],
        'audio': ['\u0254', 'd', 'i', 'o'],
        'system': ['s', '\u026a', 's', 't', '\u0259', 'm'],
        'computer': ['k', '\u0259', 'm', 'p', 'j', 'u', 't', '\u0259', 'r'],
        'artificial': ['\u0251', 'r', 't', '\u026a', 'f', '\u026a', '\u0283', '\u0259', 'l'],
        'intelligence': ['\u026a', 'n', 't', '\u025b', 'l', '\u026a', '\u0292', '\u0259', 'n', 's'],
        'technology': ['t', '\u025b', 'k', 'n', '\u0252', 'l', '\u0259', '\u0292', 'i'],
        'synthesis': ['s', '\u026a', 'n', '\u03b8', '\u0259', 's', '\u026a', 's']
    };

    // Basic letter-to-phoneme rules for unknown words
    this.letterRules = {
        'a': ['\u00e6'], 'b': ['b'], 'c': ['k'], 'd': ['d'],
        'e': ['\u025b'], 'f': ['f'], 'g': ['g'], 'h': ['h'],
        'i': ['\u026a'], 'j': ['d\u0292'], 'k': ['k'], 'l': ['l'],
        'm': ['m'], 'n': ['n'], 'o': ['\u0252'], 'p': ['p'],
        'q': ['k', 'w'], 'r': ['r'], 's': ['s'], 't': ['t'],
        'u': ['\u028c'], 'v': ['v'], 'w': ['w'], 'x': ['k', 's'],
        'y': ['j'], 'z': ['z']
    };
}

/**
 * Convert text to phonemes
 */
SimpleEnglishPhonemizer.prototype.textToPhonemes = function(text) {
    var words = text.toLowerCase().split(/\s+/);
    var allPhonemes = [];

    for (var wi = 0; wi < words.length; wi++) {
        var word = words[wi];
        if (!word) continue;

        // Remove punctuation
        var cleanWord = word.replace(/[^a-z]/g, '');
        if (!cleanWord) continue;

        // Look up in dictionary first
        if (this.dictionary[cleanWord]) {
            allPhonemes.push.apply(allPhonemes, this.dictionary[cleanWord]);
            allPhonemes.push(' '); // Word boundary
        } else {
            // Fall back to letter-by-letter conversion
            for (var li = 0; li < cleanWord.length; li++) {
                var letter = cleanWord[li];
                if (this.letterRules[letter]) {
                    allPhonemes.push.apply(allPhonemes, this.letterRules[letter]);
                }
            }
            allPhonemes.push(' '); // Word boundary
        }
    }

    // Remove trailing space
    if (allPhonemes[allPhonemes.length - 1] === ' ') {
        allPhonemes.pop();
    }

    return allPhonemes;
};

/**
 * Convert phonemes to a format similar to eSpeak IPA output
 */
SimpleEnglishPhonemizer.prototype.phonemesToIPA = function(phonemes) {
    // Keep spaces as separate elements for proper word boundaries
    return phonemes;
};

/**
 * Simple phoneme-to-ID mapping for English
 * This maps IPA phonemes to numeric IDs for the ONNX model
 */
function createEnglishPhonemeMap() {
    var phonemes = [
        '_', '^', '$', ' ', // Special markers
        'a', '\u00e6', '\u0251\u02d0', '\u0259', '\u025c\u02d0', '\u0254\u02d0', '\u0252', '\u028c', // Vowels
        'e', '\u025b', 'i', '\u026a', 'i\u02d0', 'o', 'o\u028a', 'u', 'u\u02d0', '\u028a',
        'a\u026a', 'a\u028a', 'e\u026a', '\u0254\u026a', '\u0259\u028a', // Diphthongs
        'b', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 'm', 'n', // Consonants
        'p', 'r', 's', 't', 'v', 'w', 'z',
        '\u03b8', '\u00f0', '\u0283', '\u0292', 't\u0283', 'd\u0292', '\u014b', // Special consonants
        '\u0259r', 'l\u0329', 'n\u0329' // Syllabic consonants
    ];

    var phonemeIdMap = {};
    for (var i = 0; i < phonemes.length; i++) {
        phonemeIdMap[phonemes[i]] = [i];
    }

    return phonemeIdMap;
}
