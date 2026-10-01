import { describe, expect, it } from 'vitest';
import { whisperLanguage } from './whisperLanguage';

describe('whisperLanguage', () => {
  it("passes a two-letter base language, and nothing for a code Whisper's table lacks", () => {
    expect(whisperLanguage('ja')).toBe('ja');
    expect(whisperLanguage('zh-Hant')).toBe('zh');
    expect(whisperLanguage('yue')).toBeUndefined();
    expect(whisperLanguage('fil')).toBeUndefined();
    expect(whisperLanguage('auto')).toBeUndefined();
    expect(whisperLanguage(undefined)).toBeUndefined();
  });
});
