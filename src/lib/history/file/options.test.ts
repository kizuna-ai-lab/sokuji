// What a file transcription is asked for, as the import and the "transcribe again" panels start it.
import { describe, it, expect } from 'vitest';
import type { HistoryRecord } from '../types';
import { importOptions, optionsFor, withMain, withOther, withoutOther } from './options';

const record = (o: Partial<HistoryRecord> = {}): HistoryRecord => ({
  id: 'r', mode: 'both', myLanguage: 'zh', targetLanguage: 'ja', transcripts: [], ...o,
} as unknown as HistoryRecord);
const transcript = (id: number, createdAt: number, origin: object) => ({ id, origin, textKind: 'original', createdAt, sentences: 1 });

describe('the options a file transcription starts from', () => {
  it('an import: the user’s language spoken, and translated into it', () => {
    expect(importOptions('zh')).toEqual({ languages: ['zh'], translateTo: 'zh' });
  });

  it('a record transcribed from a file before: what its newest file transcript was asked for', () => {
    const asked = { languages: ['en', 'fr'], translateTo: 'ja' };
    const r = record({
      transcripts: [
        transcript(1, 10, { service: 'soniox', kind: 'file', options: { languages: ['de'], translateTo: 'zh' } }),
        transcript(2, 30, { service: 'soniox', kind: 'file', options: asked }),
        transcript(3, 40, { service: 'soniox', kind: 'live' }),
      ],
    } as never);
    expect(optionsFor(r)).toEqual(asked);
  });

  it('a session never transcribed from a file: the other side’s language first, then the user’s, translated into the user’s', () => {
    expect(optionsFor(record())).toEqual({ languages: ['ja', 'zh'], translateTo: 'zh' });
    expect(optionsFor(record({ targetLanguage: 'zh' }))).toEqual({ languages: ['zh'], translateTo: 'zh' });
  });

  it('an import from before the options were kept: its own language, translated into the user’s', () => {
    expect(optionsFor(record({ mode: 'import', targetLanguage: 'en' }))).toEqual({ languages: ['en'], translateTo: 'zh' });
  });

  it('leaves out "automatic" and splits a two-way pair into its two languages', () => {
    expect(optionsFor(record({ targetLanguage: 'auto' }))).toEqual({ languages: ['zh'], translateTo: 'zh' });
    expect(optionsFor(record({ targetLanguage: 'en+ja' }))).toEqual({ languages: ['en', 'ja', 'zh'], translateTo: 'zh' });
  });
});

describe('changing the languages', () => {
  const o = { languages: ['ja', 'en'], translateTo: 'zh' };
  it('a new main language is no longer one of the others', () => {
    expect(withMain(o, 'en')).toEqual({ languages: ['en'], translateTo: 'zh' });
    expect(withMain(o, 'fr')).toEqual({ languages: ['fr', 'en'], translateTo: 'zh' });
  });

  it('another language is added once, and never the main one; one removed goes', () => {
    expect(withOther(o, 'fr')).toEqual({ languages: ['ja', 'en', 'fr'], translateTo: 'zh' });
    expect(withOther(o, 'en')).toEqual(o);
    expect(withOther(o, 'ja')).toEqual(o);
    expect(withoutOther(o, 'en')).toEqual({ languages: ['ja'], translateTo: 'zh' });
    expect(withoutOther(o, 'ja')).toEqual(o);
  });
});
