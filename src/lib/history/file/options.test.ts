// What a file transcription is asked for, as the import and the "transcribe again" panels start it.
import { describe, it, expect } from 'vitest';
import type { HistoryRecord } from '../types';
import { EACH_SIDE, eachSideOffered, fitOptions, importOptions, optionsFor, withMain, withOther, withoutOther } from './options';

const leg = (name: 'speaker' | 'participant', source: string, target: string) => ({
  leg: name, languages: { source, target }, input: null, inputName: null, inputId: null, translated: true, spoken: false,
});
const track = (source: 'speaker' | 'participant', goneAt: number | null = null) => ({ source, file: `${source}.opus`, format: 'ogg-opus', durationMs: 1, bytes: 1, offsetMs: 0, goneAt });
/** A session: I speak Chinese and hear English (the default here: both tracks kept). */
const record = (o: Partial<HistoryRecord> = {}): HistoryRecord => ({
  id: 'r', mode: 'both', myLanguage: 'zh', targetLanguage: 'en', transcripts: [],
  services: { provider: 'soniox', models: {} },
  legs: [leg('speaker', 'zh', 'en'), leg('participant', 'en', 'zh')],
  tracks: [track('speaker'), track('participant')],
  ...o,
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

  it('options kept in a shape it cannot use are passed over', () => {
    const r = record({ transcripts: [transcript(1, 10, { service: 'soniox', kind: 'file', options: { languages: [], translateTo: 'ja' } })] } as never);
    expect(optionsFor(r)).toEqual({ languages: ['en', 'zh'], translateTo: EACH_SIDE });
    const bad = record({ transcripts: [transcript(1, 10, { service: 'soniox', kind: 'file', options: { languages: 'en', translateTo: 7 } })] } as never);
    expect(optionsFor(bad)).toEqual({ languages: ['en', 'zh'], translateTo: EACH_SIDE });
  });

  it('a session with both its tracks: both languages, each side translated into the other’s, as in the session', () => {
    expect(eachSideOffered(record())).toBe(true);
    expect(optionsFor(record())).toEqual({ languages: ['en', 'zh'], translateTo: EACH_SIDE });
  });

  it('"each side" kept with a version, one side’s recording since deleted: the side left is translated as it was', () => {
    const asked = { languages: ['en', 'zh'], translateTo: EACH_SIDE };
    const r = record({
      tracks: [track('speaker'), track('participant', 5)],
      transcripts: [transcript(1, 10, { service: 'soniox', kind: 'file', options: asked })],
    } as never);
    // Only my own side is left: Chinese, which the session translated into English.
    expect(optionsFor(r)).toEqual({ languages: ['en', 'zh'], translateTo: 'en' });
  });

  it('a session with one track: that side’s language, translated as it was in the session', () => {
    // Only my own speech was kept (subtitles of myself): Chinese, translated into English, never into Chinese.
    const mine = record({ tracks: [track('speaker'), track('participant', 5)], legs: [leg('speaker', 'zh', 'en')] } as never);
    expect(eachSideOffered(mine)).toBe(false);
    expect(optionsFor(mine)).toEqual({ languages: ['zh'], translateTo: 'en' });
    const theirs = record({ tracks: [track('participant')], legs: [leg('participant', 'en', 'zh')] } as never);
    expect(optionsFor(theirs)).toEqual({ languages: ['en'], translateTo: 'zh' });
  });

  it('an import whose transcription failed: what it was asked for at import', () => {
    const imported = record({
      mode: 'import', targetLanguage: 'ja', myLanguage: 'zh', legs: [leg('participant', 'ja', 'fr')], tracks: [track('participant')],
      services: { provider: 'soniox', models: {}, options: { languages: ['ja', 'en'], translateTo: 'fr' } },
    } as never);
    expect(eachSideOffered(imported)).toBe(false);
    expect(optionsFor(imported)).toEqual({ languages: ['ja', 'en'], translateTo: 'fr' });
    // From before the options were kept with the record: its language and the translation its leg names.
    const older = record({ mode: 'import', targetLanguage: 'ja', legs: [leg('participant', 'ja', 'fr')], tracks: [track('participant')] } as never);
    expect(optionsFor(older)).toEqual({ languages: ['ja'], translateTo: 'fr' });
    // One whose language was "automatic": the user's language, so there is always a main one.
    const unknown = record({ mode: 'import', targetLanguage: 'auto', legs: [], tracks: [track('participant')] } as never);
    expect(optionsFor(unknown)).toEqual({ languages: ['zh'], translateTo: 'zh' });
  });

  it('"each side" only where the service translates into both sides\u2019 languages', () => {
    expect(eachSideOffered(record(), ['en', 'zh'])).toBe(true);
    // A regional code counts as its language.
    expect(eachSideOffered(record({ legs: [leg('speaker', 'zh', 'en-US'), leg('participant', 'en', 'zh-Hant')] } as never), ['en', 'zh'])).toBe(true);
    // An English / Amharic session: the service has no Amharic to translate the other side into.
    const amharic = record({ legs: [leg('speaker', 'am', 'en'), leg('participant', 'en', 'am')] } as never);
    expect(eachSideOffered(amharic, ['en', 'zh'])).toBe(false);
    expect(fitOptions(optionsFor(amharic), ['en', 'zh'], 'en', eachSideOffered(amharic, ['en', 'zh']))).toEqual({ languages: ['en'], translateTo: 'en' });
  });

  it('a session whose sides say "automatic" or a two-way pair offers no "each side"', () => {
    const auto = record({ myLanguage: 'auto', legs: [leg('speaker', 'auto', 'en'), leg('participant', 'en', 'auto')] } as never);
    expect(eachSideOffered(auto)).toBe(false);
    const pair = record({ legs: [leg('speaker', 'zh+en', 'en'), leg('participant', 'en', 'zh')] } as never);
    expect(eachSideOffered(pair)).toBe(false);
  });
});

describe('the options fitted to what the service offers', () => {
  const offered = ['en', 'ja', 'pt', 'zh'];
  it('leaves out "automatic", splits a two-way pair, and takes a regional code’s language', () => {
    expect(fitOptions({ languages: ['en', 'auto', 'ja+zh', 'pt-BR'], translateTo: 'zh-Hant' }, offered, 'en', false))
      .toEqual({ languages: ['en', 'ja', 'zh', 'pt'], translateTo: 'zh' });
  });

  it('falls back to the user’s language, else the service’s first, when nothing chosen is offered', () => {
    expect(fitOptions({ languages: ['auto'], translateTo: 'auto' }, offered, 'ja', false)).toEqual({ languages: ['ja'], translateTo: 'ja' });
    expect(fitOptions({ languages: ['xx'], translateTo: 'yy' }, offered, 'auto', false)).toEqual({ languages: ['en'], translateTo: 'en' });
  });

  it('keeps "each side" only where it is offered', () => {
    expect(fitOptions({ languages: ['en', 'zh'], translateTo: EACH_SIDE }, offered, 'zh', true)).toEqual({ languages: ['en', 'zh'], translateTo: EACH_SIDE });
    expect(fitOptions({ languages: ['en', 'zh'], translateTo: EACH_SIDE }, offered, 'zh', false)).toEqual({ languages: ['en', 'zh'], translateTo: 'zh' });
  });

  it('changes nothing until the service’s languages are known', () => {
    const o = { languages: ['en'], translateTo: 'zh' };
    expect(fitOptions(o, [], 'en', false)).toBe(o);
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
