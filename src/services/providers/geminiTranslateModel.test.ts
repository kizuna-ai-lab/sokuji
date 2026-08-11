import { describe, it, expect } from 'vitest';
import {
  isGeminiTranslateModel,
  toTranslationLanguageCode,
  buildGeminiTranslationConfig,
  reverseGeminiTranslationDirection,
} from './geminiTranslateModel';
import { GeminiSessionConfig } from '../interfaces/IClient';

const TRANSLATE = 'gemini-3.5-live-translate-preview';
const DIALOGUE = 'gemini-3.1-flash-live-preview';

function session(over: Partial<GeminiSessionConfig> = {}): GeminiSessionConfig {
  return {
    provider: 'gemini',
    model: TRANSLATE,
    turnDetectionMode: 'Auto',
    vadStartSensitivity: 'low',
    vadEndSensitivity: 'high',
    vadSilenceDurationMs: 500,
    vadPrefixPaddingMs: 300,
    ...over,
  } as GeminiSessionConfig;
}

describe('isGeminiTranslateModel', () => {
  it('matches the Live Translate model', () => {
    expect(isGeminiTranslateModel(TRANSLATE)).toBe(true);
  });

  it('does not match the dialogue Live models', () => {
    expect(isGeminiTranslateModel(DIALOGUE)).toBe(false);
    expect(isGeminiTranslateModel('gemini-2.5-flash-native-audio-latest')).toBe(false);
  });

  it('is narrower than "translate" alone, so a non-Live translation model cannot match', () => {
    expect(isGeminiTranslateModel('gemini-translate-text-preview')).toBe(false);
  });

  it('treats a missing model as not-translate rather than throwing', () => {
    expect(isGeminiTranslateModel(undefined)).toBe(false);
    expect(isGeminiTranslateModel(null)).toBe(false);
    expect(isGeminiTranslateModel('')).toBe(false);
  });
});

describe('toTranslationLanguageCode', () => {
  it('reduces a regional value to its primary subtag', () => {
    expect(toTranslationLanguageCode('ja-JP')).toBe('ja');
    expect(toTranslationLanguageCode('en-US')).toBe('en');
    expect(toTranslationLanguageCode('pt-BR')).toBe('pt');
    expect(toTranslationLanguageCode('uk-UA')).toBe('uk');
  });

  it('maps Mandarin from Gemini\'s `cmn-CN` to the BCP-47 macrolanguage `zh`', () => {
    // The one value the generic rule gets wrong: it would yield `cmn`.
    expect(toTranslationLanguageCode('cmn-CN')).toBe('zh');
  });

  it('reduces Google\'s pseudo-region for Standard Arabic', () => {
    expect(toTranslationLanguageCode('ar-XA')).toBe('ar');
  });

  it('leaves an already-short code alone', () => {
    expect(toTranslationLanguageCode('fr')).toBe('fr');
  });

  it('returns empty for a missing value instead of throwing', () => {
    expect(toTranslationLanguageCode(undefined)).toBe('');
    expect(toTranslationLanguageCode('')).toBe('');
  });
});

describe('buildGeminiTranslationConfig', () => {
  it('produces nothing for a dialogue model, which carries direction in the instruction', () => {
    expect(buildGeminiTranslationConfig(DIALOGUE, 'ja-JP')).toBeUndefined();
  });

  it('pins the target language for the translate model, with echo off', () => {
    expect(buildGeminiTranslationConfig(TRANSLATE, 'ja-JP')).toEqual({
      targetLanguageCode: 'ja',
      echoTargetLanguage: false,
    });
  });

  it('applies the short-code mapping rather than passing the regional value through', () => {
    expect(buildGeminiTranslationConfig(TRANSLATE, 'cmn-CN')?.targetLanguageCode).toBe('zh');
  });
});

describe('reverseGeminiTranslationDirection', () => {
  it('points a translate session at the user\'s own language for the participant channel', () => {
    const config = session({
      translationConfig: { targetLanguageCode: 'ja', echoTargetLanguage: false },
      sourceLanguageCode: 'en',
    });

    reverseGeminiTranslationDirection(config);

    expect(config.translationConfig).toEqual({ targetLanguageCode: 'en', echoTargetLanguage: false });
    expect(config.sourceLanguageCode).toBe('ja');
  });

  it('is a no-op for a dialogue session, whose direction was already swapped in the instruction', () => {
    const config = session({ model: DIALOGUE, instructions: 'translate Japanese to English' });

    reverseGeminiTranslationDirection(config);

    expect(config.translationConfig).toBeUndefined();
    expect(config.instructions).toBe('translate Japanese to English');
  });

  it('leaves the target alone when there is no source to swap in', () => {
    const config = session({
      translationConfig: { targetLanguageCode: 'ja', echoTargetLanguage: false },
    });

    reverseGeminiTranslationDirection(config);

    expect(config.translationConfig?.targetLanguageCode).toBe('ja');
  });

  it('round-trips: reversing twice restores the speaker direction', () => {
    const config = session({
      translationConfig: { targetLanguageCode: 'ja', echoTargetLanguage: false },
      sourceLanguageCode: 'en',
    });

    reverseGeminiTranslationDirection(config);
    reverseGeminiTranslationDirection(config);

    expect(config.translationConfig?.targetLanguageCode).toBe('ja');
    expect(config.sourceLanguageCode).toBe('en');
  });
});
