import { describe, it, expect } from 'vitest';
import {
  buildInputAudioTranscription,
  normalizeTranscriptionLanguage,
  parseTranscriptionKeywords,
  retargetTranscriptionLanguage,
  reverseTranscriptionDirection,
  supportsTranscriptionContext,
} from './openaiTranscriptionContext';
import { OpenAIProviderConfig } from './OpenAIProviderConfig';

describe('supportsTranscriptionContext', () => {
  it('accepts the two context-capable models', () => {
    expect(supportsTranscriptionContext('gpt-transcribe')).toBe(true);
    expect(supportsTranscriptionContext('gpt-live-transcribe')).toBe(true);
  });

  it('rejects the legacy models that error on languages/keywords', () => {
    expect(supportsTranscriptionContext('gpt-4o-mini-transcribe')).toBe(false);
    expect(supportsTranscriptionContext('gpt-4o-transcribe')).toBe(false);
    expect(supportsTranscriptionContext('whisper-1')).toBe(false);
    expect(supportsTranscriptionContext('gpt-realtime-whisper')).toBe(false);
    expect(supportsTranscriptionContext(undefined)).toBe(false);
  });
});

describe('normalizeTranscriptionLanguage', () => {
  it('passes through supported base codes', () => {
    expect(normalizeTranscriptionLanguage('en')).toBe('en');
    expect(normalizeTranscriptionLanguage('zh')).toBe('zh');
    expect(normalizeTranscriptionLanguage('ja')).toBe('ja');
  });

  it('strips the region from variants the API rejects', () => {
    // Verified rejected upstream: 'en_AU', 'zh_CN', 'es_419', 'zh-CN'.
    expect(normalizeTranscriptionLanguage('en_AU')).toBe('en');
    expect(normalizeTranscriptionLanguage('en_GB')).toBe('en');
    expect(normalizeTranscriptionLanguage('en_US')).toBe('en');
    expect(normalizeTranscriptionLanguage('zh_CN')).toBe('zh');
    expect(normalizeTranscriptionLanguage('zh_TW')).toBe('zh');
    expect(normalizeTranscriptionLanguage('es_419')).toBe('es');
    expect(normalizeTranscriptionLanguage('pt_BR')).toBe('pt');
    expect(normalizeTranscriptionLanguage('pt_PT')).toBe('pt');
  });

  it('keeps three-letter codes intact instead of truncating them', () => {
    expect(normalizeTranscriptionLanguage('fil')).toBe('fil');
    expect(normalizeTranscriptionLanguage('yue')).toBe('yue');
  });

  it('returns null for languages the API has no code for', () => {
    // Sokuji offers these; the transcription enum does not include them.
    for (const code of ['am', 'bn', 'gu', 'ml', 'te']) {
      expect(normalizeTranscriptionLanguage(code)).toBeNull();
    }
  });

  it('returns null for empty or unknown values', () => {
    expect(normalizeTranscriptionLanguage(undefined)).toBeNull();
    expect(normalizeTranscriptionLanguage('')).toBeNull();
    expect(normalizeTranscriptionLanguage('   ')).toBeNull();
    expect(normalizeTranscriptionLanguage('xx')).toBeNull();
    expect(normalizeTranscriptionLanguage('klingon')).toBeNull();
  });

  it('is case-insensitive', () => {
    expect(normalizeTranscriptionLanguage('EN_us')).toBe('en');
  });

  it('never emits a code outside the verified allowlist for any Sokuji language', () => {
    // Guards the whole provider language list at once: a future language row
    // must either map to a supported code or drop out, never leak through.
    const allowed = new Set([
      'af', 'ar', 'az', 'be', 'bg', 'bs', 'ca', 'cs', 'cy', 'da', 'de', 'el',
      'en', 'es', 'et', 'fa', 'fi', 'fr', 'gl', 'he', 'hi', 'hr', 'hu', 'hy',
      'id', 'is', 'it', 'iw', 'ja', 'kk', 'kn', 'ko', 'lt', 'lv', 'mi', 'mk',
      'mr', 'ms', 'ne', 'nl', 'no', 'pl', 'pt', 'ro', 'ru', 'sk', 'sl', 'sr',
      'sv', 'sw', 'ta', 'th', 'tl', 'tr', 'uk', 'ur', 'vi', 'zh', 'fil', 'yue',
    ]);
    const languages = new OpenAIProviderConfig().getConfig().languages;
    expect(languages.length).toBeGreaterThan(0);
    for (const option of languages) {
      const normalized = normalizeTranscriptionLanguage(option.value);
      if (normalized !== null) {
        expect(allowed.has(normalized), `${option.value} -> ${normalized}`).toBe(true);
      }
    }
  });
});

describe('parseTranscriptionKeywords', () => {
  it('splits on commas and newlines and trims', () => {
    expect(parseTranscriptionKeywords('Sokuji, Kizuna AI\nPulseAudio')).toEqual([
      'Sokuji', 'Kizuna AI', 'PulseAudio',
    ]);
  });

  it('accepts full-width separators', () => {
    expect(parseTranscriptionKeywords('東京、大阪，京都')).toEqual(['東京', '大阪', '京都']);
  });

  it('drops empties and duplicates', () => {
    expect(parseTranscriptionKeywords('a,,  ,a, b ')).toEqual(['a', 'b']);
  });

  it('returns an empty array for blank input', () => {
    expect(parseTranscriptionKeywords(undefined)).toEqual([]);
    expect(parseTranscriptionKeywords('')).toEqual([]);
    expect(parseTranscriptionKeywords('  ,  ,')).toEqual([]);
  });
});

describe('buildInputAudioTranscription', () => {
  it('returns undefined without a model', () => {
    expect(buildInputAudioTranscription(undefined, 'en', 'Sokuji')).toBeUndefined();
    expect(buildInputAudioTranscription('', 'en')).toBeUndefined();
  });

  it('sends languages + keywords for context-capable models', () => {
    expect(buildInputAudioTranscription('gpt-live-transcribe', 'en_US', 'Sokuji, Kizuna AI')).toEqual({
      model: 'gpt-live-transcribe',
      languages: ['en'],
      keywords: ['Sokuji', 'Kizuna AI'],
    });
  });

  it('sends the singular language for legacy models and never keywords', () => {
    // The API rejects both `languages` and `keywords` on these models, which
    // would take the whole session down rather than degrade quietly.
    const built = buildInputAudioTranscription('gpt-4o-mini-transcribe', 'zh_CN', 'Sokuji');
    expect(built).toEqual({ model: 'gpt-4o-mini-transcribe', language: 'zh' });
    expect(built).not.toHaveProperty('languages');
    expect(built).not.toHaveProperty('keywords');
  });

  it('omits languages entirely rather than sending an empty array', () => {
    // The API rejects `languages: []` with a minimum-length error.
    expect(buildInputAudioTranscription('gpt-live-transcribe', 'bn', '')).toEqual({
      model: 'gpt-live-transcribe',
    });
  });

  it('omits the language for legacy models when unsupported', () => {
    expect(buildInputAudioTranscription('whisper-1', 'te')).toEqual({ model: 'whisper-1' });
  });

  it('omits keywords when the list parses to nothing', () => {
    expect(buildInputAudioTranscription('gpt-transcribe', 'ja', '  ,  ')).toEqual({
      model: 'gpt-transcribe',
      languages: ['ja'],
    });
  });

  it('is what retargetTranscriptionLanguage must agree with for the reverse direction', () => {
    // The participant session hears the configured TARGET language. Retargeting
    // must land on exactly what a fresh build for that language would produce.
    const forward = buildInputAudioTranscription('gpt-live-transcribe', 'en', 'Sokuji');
    const reversed = retargetTranscriptionLanguage(forward, 'zh_CN');
    expect(reversed).toEqual(buildInputAudioTranscription('gpt-live-transcribe', 'zh_CN', 'Sokuji'));
    expect(reversed).toEqual({
      model: 'gpt-live-transcribe',
      languages: ['zh'],
      keywords: ['Sokuji'],
    });
  });

  it('keeps every model in the provider dropdown to a payload the API accepts', () => {
    const config = new OpenAIProviderConfig().getConfig();
    for (const model of config.transcriptModels) {
      const built = buildInputAudioTranscription(model, 'en_AU', 'Sokuji');
      expect(built?.model).toBe(model);
      if (supportsTranscriptionContext(model)) {
        expect(built).toEqual({ model, languages: ['en'], keywords: ['Sokuji'] });
      } else {
        expect(built).toEqual({ model, language: 'en' });
      }
    }
  });
});

describe('retargetTranscriptionLanguage', () => {
  it('swaps the language while keeping model and glossary', () => {
    expect(retargetTranscriptionLanguage(
      { model: 'gpt-live-transcribe', languages: ['en'], keywords: ['Sokuji'] },
      'ja'
    )).toEqual({ model: 'gpt-live-transcribe', languages: ['ja'], keywords: ['Sokuji'] });
  });

  it('keeps the singular-language shape for legacy models', () => {
    expect(retargetTranscriptionLanguage(
      { model: 'gpt-4o-mini-transcribe', language: 'en' },
      'zh_TW'
    )).toEqual({ model: 'gpt-4o-mini-transcribe', language: 'zh' });
  });

  it('never leaks a glossary onto a legacy model', () => {
    // A keywords array can only reach here if the model changed under a
    // persisted config; emitting it would fail the whole session.update.
    expect(retargetTranscriptionLanguage(
      { model: 'whisper-1', keywords: ['Sokuji'] },
      'de'
    )).toEqual({ model: 'whisper-1', language: 'de' });
  });

  it('drops the hint when the new language has no supported code', () => {
    expect(retargetTranscriptionLanguage(
      { model: 'gpt-live-transcribe', languages: ['en'], keywords: ['Sokuji'] },
      'te'
    )).toEqual({ model: 'gpt-live-transcribe', keywords: ['Sokuji'] });
  });

  it('passes undefined through', () => {
    expect(retargetTranscriptionLanguage(undefined, 'en')).toBeUndefined();
  });
});

describe('reverseTranscriptionDirection', () => {
  it('flips the direction and repoints the hint at the participant language', () => {
    // Regression: the participant session reverses `instructions` but used to
    // leave the transcription hint on the user's source language, aiming the
    // other party's ASR at the wrong language.
    const config = {
      sourceLanguage: 'en',
      targetLanguage: 'zh_CN',
      inputAudioTranscription: buildInputAudioTranscription('gpt-live-transcribe', 'en', 'Sokuji'),
    };
    reverseTranscriptionDirection(config);
    expect(config.sourceLanguage).toBe('zh_CN');
    expect(config.targetLanguage).toBe('en');
    expect(config.inputAudioTranscription).toEqual({
      model: 'gpt-live-transcribe',
      languages: ['zh'],
      keywords: ['Sokuji'],
    });
  });

  it('reverses legacy models onto the singular language field', () => {
    const config = {
      sourceLanguage: 'ja',
      targetLanguage: 'en_US',
      inputAudioTranscription: buildInputAudioTranscription('gpt-4o-mini-transcribe', 'ja'),
    };
    reverseTranscriptionDirection(config);
    expect(config.inputAudioTranscription).toEqual({
      model: 'gpt-4o-mini-transcribe',
      language: 'en',
    });
  });

  it('is an involution — reversing twice restores the forward config', () => {
    const forward = {
      sourceLanguage: 'en',
      targetLanguage: 'ja',
      inputAudioTranscription: buildInputAudioTranscription('gpt-transcribe', 'en', 'Sokuji'),
    };
    const snapshot = JSON.parse(JSON.stringify(forward));
    reverseTranscriptionDirection(forward);
    reverseTranscriptionDirection(forward);
    expect(forward).toEqual(snapshot);
  });

  it('leaves a config without transcription alone', () => {
    const config = { sourceLanguage: 'en', targetLanguage: 'ja' };
    reverseTranscriptionDirection(config);
    expect(config).toEqual({ sourceLanguage: 'ja', targetLanguage: 'en' });
  });
});
