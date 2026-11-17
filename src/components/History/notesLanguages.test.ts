import { describe, expect, it } from 'vitest';
import { notesLanguagesOf } from './notesLanguages';

const codes = (myLanguage: string, targetLanguage: string, ui = 'zh_CN') =>
  notesLanguagesOf({ myLanguage, targetLanguage }, ui).map((l) => l.code);

describe('the languages a record\'s notes can be written in', () => {
  it('are the record\'s own two, my language first, and no other', () => {
    expect(codes('zh', 'en')).toEqual(['zh', 'en']);
    expect(codes('en', 'ja', 'de')).toEqual(['en', 'ja']);
  });

  it('take the interface language for my side when it was detected automatically', () => {
    expect(codes('auto', 'en', 'ja')).toEqual(['ja', 'en']);
    expect(codes('auto', 'en', 'zh_CN')).toEqual(['zh-CN', 'en']);
  });

  it('are never none: both sides automatic leave the interface language', () => {
    expect(codes('auto', 'auto', 'fr')).toEqual(['fr']);
    expect(codes('', '', 'pt_BR')).toEqual(['pt-BR']);
  });

  it('give both languages of a two-way side', () => {
    expect(codes('zh+en', 'ja')).toEqual(['zh', 'en', 'ja']);
    expect(codes('fr', 'de+it')).toEqual(['fr', 'de', 'it']);
  });

  it('give nothing for the other side when it was automatic', () => {
    expect(codes('fr', 'auto')).toEqual(['fr']);
  });

  it('list a language once when both sides share it', () => {
    expect(codes('en', 'en')).toEqual(['en']);
    expect(codes('zh+en', 'en')).toEqual(['zh', 'en']);
  });

  it('carry each language\'s English name for the notes prompt', () => {
    expect(notesLanguagesOf({ myLanguage: 'zh', targetLanguage: 'en' }, 'zh_CN')).toEqual([
      { code: 'zh', name: 'Chinese' },
      { code: 'en', name: 'English' },
    ]);
  });
});
