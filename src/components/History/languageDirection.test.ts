import { describe, it, expect } from 'vitest';
import { languageDirection } from './languageDirection';

// A record keeps "my language" and the other side's (owner, 2026-11-18): shown as they were stored, a session that only
// translated the other side read "Chinese → Japanese" while Japanese was spoken and translated into Chinese.
describe("a session's languages, as the History list and the record page show them", () => {
  const record = { myLanguage: 'zh', targetLanguage: 'ja' };

  it('in "Me": what I speak, into the other side\'s language', () => {
    expect(languageDirection({ ...record, mode: 'speaker' }, 'en')).toEqual({ left: 'Chinese', arrow: '→', right: 'Japanese' });
  });

  it('in "Other": what the other side speaks, into mine', () => {
    expect(languageDirection({ ...record, mode: 'participant' }, 'en')).toEqual({ left: 'Japanese', arrow: '→', right: 'Chinese' });
  });

  it('in "Both", and face to face: the two, each way', () => {
    expect(languageDirection({ ...record, mode: 'both' }, 'en')).toEqual({ left: 'Chinese', arrow: '⇄', right: 'Japanese' });
    expect(languageDirection({ ...record, mode: 'face-to-face' }, 'en')).toEqual({ left: 'Chinese', arrow: '⇄', right: 'Japanese' });
  });

  it('names the languages in the interface language', () => {
    expect(languageDirection({ ...record, mode: 'participant' }, 'zh_CN')).toEqual({ left: '日语', arrow: '→', right: '中文' });
  });
});
