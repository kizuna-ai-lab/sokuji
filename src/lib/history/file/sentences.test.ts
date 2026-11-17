// A file transcript's words become the record's numbered sentences, cut as live sentences are.
import { describe, it, expect } from 'vitest';
import type { FileToken } from '../types';
import { fileSentences, fileTranslations, numberSentences, TURN_GAP_MS } from './sentences';

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

describe('translations from a file transcript', () => {
  it('a turn\u2019s translation is the translated words that follow its words; they are never taken for spoken ones', () => {
    const tokens = [
      ...spoken('Hello there.', { at: 0 }), ...translated('你好。'),
      ...spoken('Bye.', { at: 900, speaker: '2' }), ...translated('再见。'),
    ];
    expect(fileSentences(tokens, OTHER).map((s) => [s.segmentId, s.text, s.startMs, s.endMs])).toEqual([
      ['file-participant-1', 'Hello there.', 0, 600],
      ['file-participant-2', 'Bye.', 900, 1200],
    ]);
    expect(fileTranslations(tokens, OTHER)).toEqual([
      { segmentId: 'file-participant-1', text: '你好。', language: 'zh' },
      { segmentId: 'file-participant-2', text: '再见。', language: 'zh' },
    ]);
  });

  it('a turn of several translated rounds joins them; a round over two turns goes to the turn it began in', () => {
    const tokens = [
      ...spoken('One.', { at: 0 }), ...translated('一。'), ...spoken('Two.', { at: 400 }), ...translated(' 二。'),
      ...spoken('Three.', { at: 900, speaker: '2' }), ...spoken('Four.', { at: 1300, speaker: '3' }), ...translated('三。'), ...translated('四。'),
    ];
    expect(fileTranslations(tokens, OTHER)).toEqual([
      { segmentId: 'file-participant-1', text: '一。二。', language: 'zh' },
      { segmentId: 'file-participant-2', text: '三。四。', language: 'zh' },
    ]);
    expect(fileTranslations([...spoken('One.', { at: 0 }), ...translated('Uno.', 'es'), ...spoken('Two.', { at: 400 }), ...translated('Dos.', 'es')], OTHER))
      .toEqual([{ segmentId: 'file-participant-1', text: 'Uno. Dos.', language: 'es' }]);
  });

  it('words already in the language asked for are not translated: their turn has none', () => {
    const tokens = words('你好。', { at: 0, spaced: false, language: 'zh' }).map((t) => ({ ...t, translation_status: 'none' as const }));
    expect(fileTranslations([...tokens, ...spoken('Hi.', { at: 2000 + TURN_GAP_MS }), ...translated('嗨。')], OTHER))
      .toEqual([{ segmentId: 'file-participant-2', text: '嗨。', language: 'zh' }]);
    expect(fileTranslations(words('No translation asked.', { at: 0 }), OTHER)).toEqual([]);
  });

  it('translated words with nothing before them to translate are left out', () => {
    expect(fileTranslations([...translated('孤独。'), ...spoken('Hi.', { at: 0 })], OTHER)).toEqual([]);
  });
});
