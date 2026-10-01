/**
 * The source transcript's hints (choice 5): the cases of
 * `openaiTranscriptionContext.test.ts`, which move with the copied module,
 * less the reverse helpers' (D17: the participant's hint is built for its
 * own direction — `config.test.ts` pins that).
 */
import { describe, it, expect } from 'vitest';
import { AUTO } from '../../lib/provider/languages';
import { REALTIME_LANGUAGES, TRANSCRIPT_MODELS } from './settings';
import { buildTranscriptionHint, normalizeTranscriptionLanguage, parseTranscriptionKeywords, supportsTranscriptionContext } from './transcription';

describe('supportsTranscriptionContext', () => {
  it('accepts the two context-capable models', () => {
    expect(supportsTranscriptionContext('gpt-transcribe')).toBe(true);
    expect(supportsTranscriptionContext('gpt-live-transcribe')).toBe(true);
  });

  it('refuses the legacy models that error on languages/keywords', () => {
    for (const model of ['gpt-4o-mini-transcribe', 'gpt-4o-transcribe', 'whisper-1', 'gpt-realtime-whisper']) expect(supportsTranscriptionContext(model), model).toBe(false);
    expect(supportsTranscriptionContext(undefined)).toBe(false);
  });
});

describe('normalizeTranscriptionLanguage', () => {
  it('passes supported base codes through, and strips the region from variants the API refuses', () => {
    expect(normalizeTranscriptionLanguage('en')).toBe('en');
    expect(normalizeTranscriptionLanguage('ja')).toBe('ja');
    for (const [value, code] of [['en-AU', 'en'], ['en-GB', 'en'], ['en-US', 'en'], ['zh-CN', 'zh'], ['zh-TW', 'zh'], ['es-419', 'es'], ['pt-BR', 'pt'], ['pt-PT', 'pt']]) {
      expect(normalizeTranscriptionLanguage(value), value).toBe(code);
    }
  });

  it('keeps three-letter codes whole, and is case-insensitive', () => {
    expect(normalizeTranscriptionLanguage('fil')).toBe('fil');
    expect(normalizeTranscriptionLanguage('yue')).toBe('yue');
    expect(normalizeTranscriptionLanguage('EN_us')).toBe('en');
  });

  it('answers null for a language the API has no code for, for Auto-detect, and for nothing', () => {
    for (const code of ['am', 'bn', 'gu', 'ml', 'te', AUTO, 'xx', '', '   ']) expect(normalizeTranscriptionLanguage(code), code).toBeNull();
    expect(normalizeTranscriptionLanguage(undefined)).toBeNull();
  });

  it('never emits a code outside the verified allowlist for any language the provider offers', () => {
    const allowed = new Set([
      'af', 'ar', 'az', 'be', 'bg', 'bs', 'ca', 'cs', 'cy', 'da', 'de', 'el',
      'en', 'es', 'et', 'fa', 'fi', 'fr', 'gl', 'he', 'hi', 'hr', 'hu', 'hy',
      'id', 'is', 'it', 'iw', 'ja', 'kk', 'kn', 'ko', 'lt', 'lv', 'mi', 'mk',
      'mr', 'ms', 'ne', 'nl', 'no', 'pl', 'pt', 'ro', 'ru', 'sk', 'sl', 'sr',
      'sv', 'sw', 'ta', 'th', 'tl', 'tr', 'uk', 'ur', 'vi', 'zh', 'fil', 'yue',
    ]);
    expect(REALTIME_LANGUAGES).toHaveLength(55);
    for (const option of REALTIME_LANGUAGES) {
      const code = normalizeTranscriptionLanguage(option.value);
      if (code !== null) expect(allowed.has(code), `${option.value} -> ${code}`).toBe(true);
    }
  });
});

describe('parseTranscriptionKeywords', () => {
  it('splits on commas, full-width commas and newlines, trims, and drops empties and repeats', () => {
    expect(parseTranscriptionKeywords('Sokuji, Kizuna AI\nPulseAudio')).toEqual(['Sokuji', 'Kizuna AI', 'PulseAudio']);
    expect(parseTranscriptionKeywords('東京、大阪，京都')).toEqual(['東京', '大阪', '京都']);
    expect(parseTranscriptionKeywords('a,,  ,a, b ')).toEqual(['a', 'b']);
    expect(parseTranscriptionKeywords(undefined)).toEqual([]);
    expect(parseTranscriptionKeywords('  ,  ,')).toEqual([]);
  });
});

describe('buildTranscriptionHint', () => {
  it('sends languages and keywords to the context-capable models', () => {
    expect(buildTranscriptionHint('gpt-live-transcribe', 'en-US', 'Sokuji, Kizuna AI')).toEqual({ model: 'gpt-live-transcribe', languages: ['en'], keywords: ['Sokuji', 'Kizuna AI'] });
  });

  it('sends the singular language to a legacy model, and never keywords: the API would refuse the whole session.update', () => {
    const hint = buildTranscriptionHint('gpt-4o-mini-transcribe', 'zh-CN', 'Sokuji');
    expect(hint).toEqual({ model: 'gpt-4o-mini-transcribe', language: 'zh' });
  });

  it('omits the language rather than sending an empty array or an unknown code — Auto-detect included — and keywords that parse to nothing', () => {
    expect(buildTranscriptionHint('gpt-live-transcribe', 'bn', '')).toEqual({ model: 'gpt-live-transcribe' });
    expect(buildTranscriptionHint('gpt-live-transcribe', AUTO, 'Sokuji')).toEqual({ model: 'gpt-live-transcribe', keywords: ['Sokuji'] });
    expect(buildTranscriptionHint('whisper-1', 'te', undefined)).toEqual({ model: 'whisper-1' });
    expect(buildTranscriptionHint('gpt-transcribe', 'ja', '  ,  ')).toEqual({ model: 'gpt-transcribe', languages: ['ja'] });
  });

  it('keeps every model the settings offer to a payload the API accepts', () => {
    for (const model of TRANSCRIPT_MODELS) {
      const hint = buildTranscriptionHint(model, 'en-AU', 'Sokuji');
      expect(hint, model).toEqual(supportsTranscriptionContext(model) ? { model, languages: ['en'], keywords: ['Sokuji'] } : { model, language: 'en' });
    }
  });
});
