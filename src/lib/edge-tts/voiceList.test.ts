import { describe, it, expect } from 'vitest';
import type { Voice } from './edgeTts';
import { filterVoicesByLanguage, getVoiceDisplayName, voiceNameFromShortName } from './voiceList';

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

describe('filterVoicesByLanguage', () => {
  const voice = (ShortName: string) => ({ ShortName, Locale: ShortName.split('-').slice(0, 2).join('-') }) as Voice;
  const all = ['zh-CN-XiaoxiaoNeural', 'zh-HK-HiuGaaiNeural', 'zh-TW-HsiaoChenNeural', 'nb-NO-PernilleNeural', 'pt-PT-RaquelNeural', 'pt-BR-FranciscaNeural', 'en-US-AvaNeural'].map(voice);
  const names = (lang: string) => filterVoicesByLanguage(all, lang).map((v) => v.ShortName);

  it("offers Hong Kong's voices for Cantonese and keeps them out of Mandarin", () => {
    expect(names('yue')).toEqual(['zh-HK-HiuGaaiNeural']);
    expect(names('zh')).toEqual(['zh-CN-XiaoxiaoNeural', 'zh-TW-HsiaoChenNeural']);
  });

  it('offers Hong Kong\'s voices for Chinese of Hong Kong too', () => {
    expect(names('zh-HK')).toEqual(['zh-HK-HiuGaaiNeural']);
  });

  it("offers Bokmål's voices for Norwegian", () => {
    expect(names('no')).toEqual(['nb-NO-PernilleNeural']);
    expect(names('nb')).toEqual(['nb-NO-PernilleNeural']);
  });

  it("offers a regional code its language's voices, its own region's first", () => {
    expect(names('pt-PT')).toEqual(['pt-PT-RaquelNeural', 'pt-BR-FranciscaNeural']);
    expect(names('pt')).toEqual(['pt-BR-FranciscaNeural', 'pt-PT-RaquelNeural']);
  });

  it('offers nothing for a language Edge has no voice for', () => {
    expect(names('xx')).toEqual([]);
  });
});
