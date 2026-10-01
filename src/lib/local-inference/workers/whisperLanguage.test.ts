import { describe, expect, it } from 'vitest';
import { whisperLanguage } from './whisperLanguage';

describe('whisperLanguage', () => {
  it("passes a two-letter base language, and nothing for a code Whisper's table lacks", () => {
    expect(whisperLanguage('ja')).toBe('ja');
    expect(whisperLanguage('zh-Hant')).toBe('zh');
    expect(whisperLanguage('yue')).toBeUndefined();
    expect(whisperLanguage('fil')).toBe('tl');
    expect(whisperLanguage('auto')).toBeUndefined();
    expect(whisperLanguage(undefined)).toBeUndefined();
  });

  it("sends Whisper its own code where it differs from the app code: jv as jw, fil as tl", () => {
    expect(whisperLanguage('jv')).toBe('jw');
    expect(whisperLanguage('fil')).toBe('tl');
  });

  it("sends nothing for a two-letter code Whisper's table lacks, so it detects instead of throwing", () => {
    expect(whisperLanguage('xh')).toBeUndefined();
    expect(whisperLanguage('ga')).toBeUndefined();
  });
});
