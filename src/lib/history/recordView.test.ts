// A record's transcript rows: sentences grouped by round, with their translation and speaker labels; and its cues.
import { describe, it, expect } from 'vitest';
import type { Leg, LegName, Segment } from '../conversation/types';
import type { HistorySentence } from './types';
import { recordCues, recordRows, type RecordRow, type SpeakerLabels } from './recordView';

const labels: SpeakerLabels = {
  mine: 'Me', other: 'Other', person: (side, n) => `${side === 'mine' ? 'Me' : 'Other'} speaker ${n}`, anyone: (n) => `Speaker ${n}`,
};

const s = (n: number, segmentId: string | null, text: string, over: Partial<HistorySentence> = {}): HistorySentence => ({
  n, segmentId, side: 'mine', sideCertain: true, track: 'microphone', speaker: '1', speakerByUser: null, speakerName: null,
  startMs: n * 1000, endMs: n * 1000 + 800, text, language: null, timeKind: 'given', translation: null, ...over,
});
const seg = (id: string, side: 'source' | 'translation', text: string, origin: string): Segment => ({
  id, ref: Number(id.split(':').pop()), side, text, final: true, openedAt: 0, marks: [], origin, speech: [],
});
const leg = (name: LegName, segments: Segment[]): Leg => ({ leg: name, session: 'run', languages: { source: 'en', target: 'es' }, segments, notices: [] });
const row = (over: Partial<RecordRow>): RecordRow => ({
  sideKnown: true,
  segmentId: 'a', leg: 'speaker', side: 'mine', speaker: '1', speakerLabel: 'Me', startMs: 0, endMs: 0, timeKind: 'given',
  sentences: [], translation: null, ...over,
});

describe('a record\'s transcript rows', () => {
  it("groups a round's sentences into one row with its translation", () => {
    const rows = recordRows({
      sentences: [s(1, 'run:speaker:1', 'One.'), s(2, 'run:speaker:1', 'Two.')],
      legs: [leg('speaker', [seg('run:speaker:1', 'source', 'One. Two.', 'u1'), seg('run:speaker:2', 'translation', 'Uno. Dos.', 'u1')])],
      textKind: 'original', labels,
    });
    expect(rows).toEqual([expect.objectContaining({ segmentId: 'run:speaker:1', side: 'mine', speakerLabel: 'Me', sentences: [{ n: 1, text: 'One.' }, { n: 2, text: 'Two.' }], translation: 'Uno. Dos.', startMs: 1000, endMs: 2800 })]);
  });

  it("joins a round's translation pieces as the export does", () => {
    const rows = recordRows({
      sentences: [s(1, 'run:speaker:1', 'One. Two.')],
      legs: [leg('speaker', [seg('run:speaker:1', 'source', 'One. Two.', 'u1'), seg('run:speaker:2', 'translation', 'Uno.', 'u1'), seg('run:speaker:3', 'translation', 'Dos.', 'u1')])],
      textKind: 'original', labels,
    });
    expect(rows[0].translation).toBe('Uno. Dos.');
  });

  it('shows a file transcript\u2019s own translations: each row its sentences\u2019, and not the session\u2019s', () => {
    const rows = recordRows({
      sentences: [
        s(1, 'file-participant-1', 'Hello.', { side: 'other', speaker: '1', translation: '你好。' }),
        s(2, 'file-participant-1', 'How are you?', { side: 'other', speaker: '1', translation: '你好吗？' }),
        s(3, 'file-participant-1', 'Fine.', { side: 'other', speaker: '2', translation: '很好。' }),
        s(4, 'file-participant-2', 'Thanks.', { side: 'other', speaker: '1' }),
      ],
      // The session's translations name its own segments: none of them is a file transcript's.
      legs: [leg('speaker', [seg('run:speaker:1', 'source', 'Hello.', 'u1'), seg('run:speaker:2', 'translation', 'Hola.', 'u1')])],
      textKind: 'original', labels, sidesKnown: false,
    });
    expect(rows.map((r) => [r.segmentId, r.sentences.map((x) => x.text), r.translation])).toEqual([
      ['file-participant-1', ['Hello.', 'How are you?'], '你好。你好吗？'],
      ['file-participant-1', ['Fine.'], '很好。'],
      ['file-participant-2', ['Thanks.'], null],
    ]);
  });

  it('shows a transcript cut from the translation once, with no second translation line', () => {
    const rows = recordRows({ sentences: [s(1, 'run:speaker:2', 'Uno.')], legs: [leg('speaker', [seg('run:speaker:2', 'translation', 'Uno.', 'u1')])], textKind: 'translation', labels });
    expect(rows[0]).toEqual(expect.objectContaining({ sentences: [{ n: 1, text: 'Uno.' }], translation: null }));
  });

  // An imported file holds everyone on one track: who is on which side is not known, and no side is named.
  it('labels the speakers of a file whose sides are not known by number alone, one speaker or several', () => {
    const file = { side: 'other' as const, sideCertain: false, track: 'other' as const };
    const of = (sentences: HistorySentence[]) => recordRows({ sentences, legs: [], textKind: 'original', labels, sidesKnown: false });
    const one = of([s(1, 'f-1', 'Hello.', file), s(2, 'f-2', 'Again.', file)]);
    expect(one.map((r) => [r.speakerLabel, r.sideKnown])).toEqual([['Speaker 1', false], ['Speaker 1', false]]);
    expect(of([s(1, 'f-1', 'Hello.', file), s(2, 'f-2', 'Hi.', { ...file, speaker: '2' })]).map((r) => r.speakerLabel)).toEqual(['Speaker 1', 'Speaker 2']);
    // A name given to one of them is still its label.
    expect(of([s(1, 'f-1', 'Hello.', { ...file, speakerName: 'Mina' })])[0].speakerLabel).toBe('Mina');
  });

  // Face to face (one microphone for both people) a session's sides are inferred, not certain: they still say who
  // spoke, and keep their words.
  it('keeps the sides of a session whose sides were only inferred', () => {
    const rows = recordRows({
      sentences: [s(1, 'a', 'Hello.', { sideCertain: false }), s(2, 'b', 'Hi.', { side: 'other', sideCertain: false, track: 'other' })],
      legs: [], textKind: 'original', labels,
    });
    expect(rows.map((r) => [r.speakerLabel, r.sideKnown])).toEqual([['Me', true], ['Other', true]]);
  });

  it('labels speakers by name, by number when a side has several, else by side', () => {
    const rows = recordRows({
      sentences: [s(1, 'a', 'x', { side: 'other', speaker: '1.1' }), s(2, 'b', 'y', { side: 'other', speaker: '1.2' }), s(3, 'c', 'z', { side: 'other', speaker: '1.1', speakerName: 'Mina' }), s(4, 'd', 'w')],
      legs: [], textKind: 'original', labels,
    });
    expect(rows.map((r) => r.speakerLabel)).toEqual(['Mina', 'Other speaker 2', 'Mina', 'Me']);
  });

  it('a sentence moved to another speaker starts its own row', () => {
    const rows = recordRows({ sentences: [s(1, 'a', 'x'), s(2, 'a', 'y', { speakerByUser: 'u1' })], legs: [], textKind: 'original', labels });
    expect(rows.map((r) => r.sentences.map((x) => x.n))).toEqual([[1], [2]]);
  });

  it('makes one cue per row with the lines the scope asks for', () => {
    const rows = [row({ startMs: 1000, endMs: 3000, sentences: [{ n: 1, text: 'One.' }], translation: 'Uno.' })];
    expect(recordCues(rows, { speaker: 'both', participant: 'both' })).toEqual([{ startMs: 1000, endMs: 3000, lines: ['One.', 'Uno.'] }]);
    expect(recordCues(rows, { speaker: 'translation', participant: 'both' })[0].lines).toEqual(['Uno.']);
    expect(recordCues(rows, { speaker: 'none', participant: 'both' })).toEqual([]);
  });

  it('joins Chinese and Japanese sentences without a space, Latin ones with one', () => {
    const rows = [row({ sentences: [{ n: 1, text: '下周三。' }, { n: 2, text: '可以。' }] }), row({ segmentId: 'b', sentences: [{ n: 3, text: 'One.' }, { n: 4, text: 'Two.' }] })];
    expect(recordCues(rows, { speaker: 'source', participant: 'source' }).map((c) => c.lines[0])).toEqual(['下周三。可以。', 'One. Two.']);
  });
});
