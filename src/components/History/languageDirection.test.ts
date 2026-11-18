import { describe, it, expect } from 'vitest';
import { ArrowRight, ArrowRightLeft } from 'lucide-react';
import { languageDirection as direction } from './languageDirection';

/** The icon's labels as their English defaults. */
const t = (_key: string, fallback: string) => fallback;
const languageDirection = (r: Parameters<typeof direction>[0], ui: string) => direction(r, ui, t);

// A record keeps "my language" and the other side's (owner, 2026-11-18): shown as they were stored, a session that only
// translated the other side read "Chinese → Japanese" while Japanese was spoken and translated into Chinese.
describe("a session's languages, as the History list and the record page show them", () => {
  const record = { myLanguage: 'zh', targetLanguage: 'ja' };

  it('in "Me": what I speak, into the other side\'s language', () => {
    expect(languageDirection({ ...record, mode: 'speaker' }, 'en')).toEqual({ left: 'Chinese', arrow: ArrowRight, label: 'translated into', right: 'Japanese' });
  });

  it('in "Other": what the other side speaks, into mine', () => {
    expect(languageDirection({ ...record, mode: 'participant' }, 'en')).toEqual({ left: 'Japanese', arrow: ArrowRight, label: 'translated into', right: 'Chinese' });
  });

  it('in "Both", and face to face: the two, each way', () => {
    expect(languageDirection({ ...record, mode: 'both' }, 'en')).toEqual({ left: 'Chinese', arrow: ArrowRightLeft, label: 'translated both ways', right: 'Japanese' });
    expect(languageDirection({ ...record, mode: 'face-to-face' }, 'en')).toEqual({ left: 'Chinese', arrow: ArrowRightLeft, label: 'translated both ways', right: 'Japanese' });
  });

  // Review: a bidirectional pair (`zh+en`) is kept as both languages of the record; its two languages are named once,
  // each way, as the footer names them.
  it('names a bidirectional pair\'s two languages once, each way', () => {
    expect(languageDirection({ myLanguage: 'zh+en', targetLanguage: 'zh+en', mode: 'both' }, 'en'))
      .toEqual({ left: 'Chinese', arrow: ArrowRightLeft, label: 'translated both ways', right: 'English' });
  });

  it('names the languages in the interface language', () => {
    expect(languageDirection({ ...record, mode: 'participant' }, 'zh_CN')).toMatchObject({ left: '日语', right: '中文' });
  });
});
