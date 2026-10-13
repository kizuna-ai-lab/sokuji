import { describe, it, expect } from 'vitest';
import type { Voice } from './edgeTts';
import { getVoiceDisplayName, voiceNameFromShortName } from './voiceList';

describe('voiceNameFromShortName', () => {
  it('names a voice from its ShortName, without locale or the Neural suffix', () => {
    expect(voiceNameFromShortName('zh-CN-XiaoxiaoNeural')).toBe('Xiaoxiao');
    expect(voiceNameFromShortName('en-US-AvaMultilingualNeural')).toBe('Ava Multilingual');
  });
});

describe('getVoiceDisplayName', () => {
  it('adds the gender and locale to that name', () => {
    expect(getVoiceDisplayName({ ShortName: 'zh-HK-HiuGaaiNeural', Gender: 'Female', Locale: 'zh-HK' } as Voice)).toBe('Hiu Gaai (Female, zh-HK)');
  });
});
