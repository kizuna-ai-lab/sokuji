// A file transcript's words become the record's numbered sentences, cut as live sentences are.
import { describe, it, expect } from 'vitest';
import type { FileToken } from '../types';
import { fileSentences, numberSentences, TURN_GAP_MS } from './sentences';
import sonioxAnswer from './testdata/soniox-translated.json';

/** Words of one speaker, each `step` ms long, starting at `at`. */
function words(text: string, o: { at: number; step?: number; speaker?: string; language?: string; spaced?: boolean }): FileToken[] {
  const step = o.step ?? 300;
  const parts = o.spaced === false ? [...text] : text.split(' ').map((w, i) => (i === 0 ? w : ` ${w}`));
  return parts.map((t, i) => ({ text: t, start_ms: o.at + i * step, end_ms: o.at + (i + 1) * step, speaker: o.speaker ?? '1', language: o.language ?? 'en' }));
}
const OTHER = { side: 'other' as const, sideCertain: false, track: 'other' as const, offsetMs: 0, idPrefix: 'file-participant' };

describe('sentences from a file transcript', () => {
  it('cuts at sentence ends inside a turn, with the words’ own times', () => {
    const out = fileSentences(words('Hello there. How are you?', { at: 1000 }), { ...OTHER, offsetMs: 500 });
    expect(out).toEqual([
      { segmentId: 'file-participant-1', side: 'other', sideCertain: false, track: 'other', speaker: '1', startMs: 1500, endMs: 2100, text: 'Hello there.', language: 'en', timeKind: 'given' },
      { segmentId: 'file-participant-1', side: 'other', sideCertain: false, track: 'other', speaker: '1', startMs: 2100, endMs: 3000, text: 'How are you?', language: 'en', timeKind: 'given' },
    ]);
  });

  it('starts a new turn when the speaker changes, or after a silence', () => {
    const tokens = [
      ...words('One.', { at: 0, speaker: '1' }),
      ...words('Two.', { at: 400, speaker: '2' }),
      ...words('Three.', { at: 700 + TURN_GAP_MS, speaker: '2' }),
    ];
    const out = fileSentences(tokens, OTHER);
    expect(out.map((s) => [s.segmentId, s.speaker, s.text])).toEqual([
      ['file-participant-1', '1', 'One.'],
      ['file-participant-2', '2', 'Two.'],
      ['file-participant-3', '2', 'Three.'],
    ]);
  });

  it('cuts a long turn without punctuation before 45 seconds', () => {
    const long = Array.from({ length: 100 }, (_, i) => `w${i}`).join(' ');
    const out = fileSentences(words(long, { at: 0, step: 500 }), OTHER);
    expect(out.length).toBeGreaterThanOrEqual(2);
    expect(out[0].endMs - out[0].startMs).toBeLessThanOrEqual(45_000);
    expect(out.map((s) => s.text).join(' ')).toBe(long);
  });

  it('keeps Chinese and Japanese without spaces, and names the turn’s language by most of its words', () => {
    const tokens = [...words('你好。', { at: 0, spaced: false, language: 'zh' }), { text: 'OK', start_ms: 900, end_ms: 1000, speaker: '1', language: 'en' }];
    const out = fileSentences(tokens, OTHER);
    expect(out.map((s) => [s.text, s.language])).toEqual([['你好。', 'zh'], ['OK', 'zh']]);
  });

  it('gives speaker 1 when the service named none, and the side and track it was asked for', () => {
    const tokens = words('Mine.', { at: 0 }).map(({ speaker: _s, ...t }) => t);
    const out = fileSentences(tokens, { side: 'mine', sideCertain: true, track: 'microphone', offsetMs: 0, idPrefix: 'file-speaker', language: 'ja' });
    expect(out[0]).toMatchObject({ side: 'mine', sideCertain: true, track: 'microphone', speaker: '1', segmentId: 'file-speaker-1' });
  });

  it('gives nothing for no words', () => {
    expect(fileSentences([], OTHER)).toEqual([]);
    expect(fileSentences([{ text: ' ', start_ms: 0, end_ms: 10 }], OTHER)).toEqual([]);
  });

  it('merges the tracks by start time and numbers them from 1', () => {
    const mine = fileSentences(words('Alpha. Gamma.', { at: 0, step: 1000 }), { ...OTHER, side: 'mine', idPrefix: 'file-speaker' });
    const other = fileSentences(words('Beta.', { at: 500 }), OTHER);
    expect(numberSentences([mine, other]).map((s) => [s.n, s.text, s.side])).toEqual([[1, 'Alpha.', 'mine'], [2, 'Beta.', 'other'], [3, 'Gamma.', 'mine']]);
  });
});

/** Translated words, as the service gives them: no time, after the words they translate. */
const translated = (text: string, language = 'zh'): FileToken[] => [{ text, translation_status: 'translation', language, source_language: 'en' }];
const spoken = (text: string, o: Parameters<typeof words>[1]) => words(text, o).map((t) => ({ ...t, translation_status: 'original' as const }));

/** Each sentence's turn, text and the translation it carries. */
const carried = (tokens: FileToken[]) => fileSentences(tokens, OTHER).map((x) => [x.segmentId, x.text, x.translation]);

describe('translations from a file transcript', () => {
  // As Soniox answers (checked against its file API with the repository's recordings): the translation of a clause or
  // a sentence follows its words, and none runs over the end of a sentence.
  it('each sentence carries the translation that follows its words; translated words are never spoken ones', () => {
    const [hello, there, how, are, you] = spoken('Hello there. How are you?', { at: 0 });
    const tokens = [hello, there, ...translated('你好。'), how, are, you, ...translated('你好吗？'), ...spoken('Bye.', { at: 1800, speaker: '2' }), ...translated('再见。')];
    expect(fileSentences(tokens, OTHER).map((x) => [x.segmentId, x.text, x.startMs, x.endMs, x.translation])).toEqual([
      ['file-participant-1', 'Hello there.', 0, 600, '你好。'],
      ['file-participant-1', 'How are you?', 600, 1500, '你好吗？'],
      ['file-participant-2', 'Bye.', 1800, 2100, '再见。'],
    ]);
  });

  // Soniox's own answer for two of the repository's Japanese recordings (scripts/dev/wire-probe/assets/ja: umbrella,
  // door), translated into English: the first sentence came back as two clauses, each translated after its words.
  it('pairs Soniox\u2019s real answer sentence by sentence', () => {
    expect(carried(sonioxAnswer as FileToken[])).toEqual([
      ['file-participant-1', '今日は雨が降りそうなので、傘を持っていきます。', "It looks like it's going to rain today, so I'll take an umbrella."],
      ['file-participant-2', 'ドアを閉めてください。', 'Please close the door.'],
    ]);
  });

  it('a sentence translated clause by clause carries the clauses joined', () => {
    const [it, will, rain, so, take, an, umbrella] = spoken('It will rain, so take an umbrella.', { at: 0 });
    expect(carried([it, will, rain, ...translated('要下雨了，'), so, take, an, umbrella, ...translated('所以带把伞。')]))
      .toEqual([['file-participant-1', 'It will rain, so take an umbrella.', '要下雨了，所以带把伞。']]);
    expect(carried([it, will, rain, ...translated('Va a llover,', 'es'), so, take, an, umbrella, ...translated(' así que lleva un paraguas.', 'es')]))
      .toEqual([['file-participant-1', 'It will rain, so take an umbrella.', 'Va a llover, así que lleva un paraguas.']]);
  });

  it('a translation over two sentences, or two turns, goes to the one it began in', () => {
    expect(carried([...spoken('Hello there. How are you?', { at: 0 }), ...translated('你好。你好吗？')])).toEqual([
      ['file-participant-1', 'Hello there.', '你好。你好吗？'],
      ['file-participant-1', 'How are you?', undefined],
    ]);
    expect(carried([...spoken('Three.', { at: 900, speaker: '2' }), ...spoken('Four.', { at: 1300, speaker: '3' }), ...translated('三。'), ...translated('四。')])).toEqual([
      ['file-participant-1', 'Three.', '三。四。'],
      ['file-participant-2', 'Four.', undefined],
    ]);
  });

  it('words already in the language asked for are not translated: their turn carries none', () => {
    const tokens = words('你好。', { at: 0, spaced: false, language: 'zh' }).map((t) => ({ ...t, translation_status: 'none' as const }));
    expect(carried([...tokens, ...spoken('Hi.', { at: 2000 + TURN_GAP_MS }), ...translated('嗨。')]))
      .toEqual([['file-participant-1', '你好。', undefined], ['file-participant-2', 'Hi.', '嗨。']]);
    expect(carried(words('No translation asked.', { at: 0 }))).toEqual([['file-participant-1', 'No translation asked.', undefined]]);
  });

  // Soniox sends a lone space as a word of its own at times (see the test data): it begins no round of its own.
  it('a lone space before a sentence does not take the sentence\u2019s translation to the one before', () => {
    const [one] = spoken('One.', { at: 0 });
    const [two] = spoken('Two.', { at: 600 });
    const space: FileToken = { text: ' ', start_ms: 450, end_ms: 500, speaker: '1', language: 'en', translation_status: 'original' };
    expect(carried([one, ...translated('一。'), space, { ...two, text: ' Two.' }, ...translated('二。')]))
      .toEqual([['file-participant-1', 'One.', '一。'], ['file-participant-1', 'Two.', '二。']]);
  });

  it('translated words with nothing before them to translate are left out', () => {
    expect(carried([...translated('孤独。'), ...spoken('Hi.', { at: 0 })])).toEqual([['file-participant-1', 'Hi.', undefined]]);
  });

  // As Soniox answers (checked against its file API): a translated word has times of 0, and says it is a translation.
  it('takes translated words with times of 0 for translations, not for words spoken at the start', () => {
    const zeroed = translated('明天的会议下午三点开始。').map((t) => ({ ...t, start_ms: 0, end_ms: 0 }));
    expect(carried([...spoken('明日の会議は午後三時に始まります。', { at: 270, spaced: false, language: 'ja' }), ...zeroed]))
      .toEqual([['file-participant-1', '明日の会議は午後三時に始まります。', '明天的会议下午三点开始。']]);
  });
});
