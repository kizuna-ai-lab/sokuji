/**
 * Japanese phoneme extraction from OpenJTalk full-context labels.
 * Adapted for classic worker importScripts() context (no ES module syntax).
 *
 * Original: piper-plus/src/wasm/openjtalk-web/src/japanese_phoneme_extract.js
 *
 * Exposes globals:
 *   - PUA_MAP
 *   - applyNPhonemeRules(tokens)
 *   - mapToPUA(tokens)
 *   - extractPhonemesFromLabels(labels)
 */

// PUA mapping - must match token_mapper.py FIXED_PUA_MAPPING exactly
var PUA_MAP = {
    'a:': '\ue000', 'i:': '\ue001', 'u:': '\ue002', 'e:': '\ue003', 'o:': '\ue004',
    'cl': '\ue005',
    'ky': '\ue006', 'kw': '\ue007', 'gy': '\ue008', 'gw': '\ue009',
    'ty': '\ue00a', 'dy': '\ue00b', 'py': '\ue00c', 'by': '\ue00d',
    'ch': '\ue00e', 'ts': '\ue00f', 'sh': '\ue010', 'zy': '\ue011', 'hy': '\ue012',
    'ny': '\ue013', 'my': '\ue014', 'ry': '\ue015',
    'N_m': '\ue019', 'N_n': '\ue01a', 'N_ng': '\ue01b', 'N_uvular': '\ue01c'
};

// Regex patterns matching the Python implementation
var _RE_PHONEME = /-([^+]+)\+/;
var _RE_A1 = /\/A:([\d-]+)\+/;
var _RE_A2 = /\+([0-9]+)\+/;
var _RE_A3 = /\+([0-9]+)\//;

// Tokens to skip when looking ahead for N-variant rules
var _SKIP_TOKENS_SET = { '_': 1, '#': 1, '[': 1, ']': 1, '^': 1, '$': 1, '?': 1, '?!': 1, '?.': 1, '?~': 1 };

// Long vowel detection: if same vowel appears consecutively, second becomes long vowel
var _VOWELS_SET = { 'a': 1, 'i': 1, 'u': 1, 'e': 1, 'o': 1 };

/**
 * Apply context-dependent N phoneme rules.
 * Matches _apply_n_phoneme_rules() in japanese.py
 */
function applyNPhonemeRules(tokens) {
    var result = [];
    for (var i = 0; i < tokens.length; i++) {
        if (tokens[i] !== 'N') {
            result.push(tokens[i]);
            continue;
        }

        // Look ahead to find next actual phoneme
        var nextPhoneme = null;
        for (var j = i + 1; j < tokens.length; j++) {
            if (!_SKIP_TOKENS_SET[tokens[j]]) {
                nextPhoneme = tokens[j];
                break;
            }
        }

        if (nextPhoneme === null) {
            result.push('N_uvular');
        } else if (['m', 'my', 'b', 'by', 'p', 'py'].indexOf(nextPhoneme) !== -1) {
            result.push('N_m');
        } else if (['n', 'ny', 't', 'ty', 'd', 'dy', 'ts', 'ch'].indexOf(nextPhoneme) !== -1) {
            result.push('N_n');
        } else if (['k', 'ky', 'kw', 'g', 'gy', 'gw'].indexOf(nextPhoneme) !== -1) {
            result.push('N_ng');
        } else {
            result.push('N_uvular');
        }
    }
    return result;
}

/**
 * Map multi-character tokens to PUA single codepoints.
 * Matches map_sequence() in token_mapper.py
 */
function mapToPUA(tokens) {
    return tokens.map(function(t) { return PUA_MAP[t] || t; });
}

/**
 * Extract phonemes from OpenJTalk full-context labels.
 * Replicates phonemize_japanese() from japanese.py.
 *
 * @param {string} labels - Full-context labels (newline-separated)
 * @returns {string[]} Array of phoneme tokens (PUA-mapped)
 */
function extractPhonemesFromLabels(labels) {
    var lines = labels.split('\n').filter(function(line) { return line.trim(); });
    var tokens = [];

    for (var idx = 0; idx < lines.length; idx++) {
        var line = lines[idx];
        var mPh = line.match(_RE_PHONEME);
        if (!mPh) continue;
        var phoneme = mPh[1];

        // Beginning / end silence handling
        if (phoneme === 'sil') {
            if (idx === 0) {
                tokens.push('^');
            } else if (idx === lines.length - 1) {
                tokens.push('$');
            }
            continue;
        }

        // Short pause -> _
        if (phoneme === 'pau') {
            tokens.push('_');
            continue;
        }

        // Add phoneme token
        tokens.push(phoneme);

        // Extract A1/A2/A3 for Kurihara prosody markers
        var mA1 = line.match(_RE_A1);
        var mA2 = line.match(_RE_A2);
        var mA3 = line.match(_RE_A3);
        if (!(mA1 && mA2 && mA3)) continue;

        var a1 = parseInt(mA1[1], 10);
        var a2 = parseInt(mA2[1], 10);
        var a3 = parseInt(mA3[1], 10);

        // Look-ahead for a2_next
        var a2Next = -1;
        if (idx < lines.length - 1) {
            var mA2Next = lines[idx + 1].match(_RE_A2);
            if (mA2Next) a2Next = parseInt(mA2Next[1], 10);
        }

        // Insert accent nucleus mark "]"
        if (a1 === 0 && a2Next === a2 + 1) {
            tokens.push(']');
        }

        // Insert accent phrase boundary "#"
        if (a2 === a3 && a2Next === 1) {
            tokens.push('#');
        }

        // Insert rising mark "["
        if (a2 === 1 && a2Next === 2) {
            tokens.push('[');
        }
    }

    // Apply N phoneme rules
    var withNVariants = applyNPhonemeRules(tokens);

    // Map to PUA codepoints
    return mapToPUA(withNVariants);
}
