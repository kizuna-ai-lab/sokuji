import { describe, it, expect } from 'vitest';
import type { Entry, Row } from '../projection/types';
import type { LegFilters, NoticeEntry } from '../view/filter';
import { buildBands, type Band } from './bands';

const row = (segmentId: string, k: number, start: number, text: string, side: 'source' | 'translation' = 'source'): Row =>
  ({ key: `${segmentId}:${k}`, segmentId, side, start, end: start + text.length, text, final: true });
const exchange = (id: string, leg: 'speaker' | 'participant', source: Row[], translation: Row[] = []): Entry =>
  ({ kind: 'exchange', id, leg, languages: { source: 'en', target: 'ja' }, pairing: 'stated', source, translation, t: 0 });
const both: LegFilters = { speaker: 'both', participant: 'both' };
const words = (notice: NoticeEntry) => `[${notice.message}]`;
const text = (band: Band) => band.pieces.map((piece) => piece.before + piece.text).join('');

describe('buildBands', () => {
  it("joins one segment's rows as written, and puts a space between segments where the script wants one", () => {
    const bands = buildBands([
      exchange('a', 'speaker', [row('s1', 0, 0, 'One.'), row('s1', 1, 4, ' Two.')]),
      exchange('b', 'speaker', [row('s2', 0, 0, 'Three.')]),
    ], both, words);
    expect(bands.map((band) => [band.id, text(band)])).toEqual([['speaker-source', 'One. Two. Three.']]);
  });

  it('puts no space between Chinese or Japanese segments', () => {
    const bands = buildBands([
      exchange('a', 'speaker', [], [row('t1', 0, 0, '今天天气很好。', 'translation')]),
      exchange('b', 'speaker', [], [row('t2', 0, 0, '我们去公园吧。', 'translation')]),
    ], both, words);
    expect(text(bands[0])).toBe('今天天气很好。我们去公园吧。');
  });

  it("trims a segment's edges where it meets another, and keeps karaoke's offset on the trimmed text", () => {
    const bands = buildBands([
      exchange('a', 'speaker', [row('s1', 0, 0, 'Hi. ')]),
      exchange('b', 'speaker', [row('s2', 0, 0, '  Yes.')]),
    ], both, words);
    expect(bands[0].pieces.map((piece) => [piece.text, piece.before, piece.start])).toEqual([['Hi.', '', 0], ['Yes.', ' ', 2]]);
  });

  it("puts a notice into its leg's translation band, in order, in its words", () => {
    const notice: Entry = { kind: 'notice', id: 'n', leg: 'speaker', severity: 'warning', message: 'hiccup', at: 1 };
    const bands = buildBands([exchange('a', 'speaker', [], [row('t1', 0, 0, 'Hello.', 'translation')]), notice], both, words);
    expect(bands.map((band) => [band.id, text(band)])).toEqual([['speaker-translation', 'Hello. [hiccup]']]);
    expect(bands[0].pieces[1]).toMatchObject({ key: 'n', notice });
  });

  it("draws the sides a leg's filter shows, in a fixed band order", () => {
    const entries = [
      exchange('p', 'participant', [row('p1', 0, 0, 'Hi.')], [row('p2', 0, 0, 'やあ。', 'translation')]),
      exchange('s', 'speaker', [row('s1', 0, 0, 'Yo.')]),
    ];
    expect(buildBands(entries, both, words).map((band) => band.id)).toEqual(['speaker-source', 'participant-source', 'participant-translation']);
    expect(buildBands(entries, { ...both, participant: 'translation' }, words).map((band) => band.id)).toEqual(['speaker-source', 'participant-translation']);
    expect(buildBands(entries, { speaker: 'none', participant: 'none' }, words)).toEqual([]);
  });

  it('keeps only the newest text past the cap, with nothing drawn before the first piece kept', () => {
    const entries = [0, 1, 2].map((i) => exchange(`e${i}`, 'speaker', [row(`s${i}`, 0, 0, `Word${i}.`)]));
    const [band] = buildBands(entries, both, words, 12);
    expect(band.pieces.map((piece) => piece.text)).toEqual(['Word1.', 'Word2.']);
    expect(band.pieces[0].before).toBe('');
  });

  it("trims a segment's end even when its last row is only whitespace", () => {
    const bands = buildBands([
      exchange('a', 'speaker', [row('s1', 0, 0, 'Hi. '), row('s1', 1, 4, '   ')]),
      exchange('b', 'speaker', [row('s2', 0, 0, 'Bye.')]),
    ], both, words);
    expect(text(bands[0])).toBe('Hi. Bye.');
  });

  it('drops any number of blank rows at a segment end, keeping the separator', () => {
    const bands = buildBands([
      exchange('a', 'speaker', [row('s1', 0, 0, 'Hi.'), row('s1', 1, 3, '   '), row('s1', 2, 6, '  ')]),
      exchange('b', 'speaker', [row('s2', 0, 0, 'Bye.')]),
    ], both, words);
    expect(text(bands[0])).toBe('Hi. Bye.');
  });

  it("drops a blank first row and the next row's leading whitespace, keeping karaoke's offset", () => {
    const bands = buildBands([exchange('a', 'speaker', [row('s1', 0, 0, '  '), row('s1', 1, 2, ' Hi.')])], both, words);
    expect(bands[0].pieces.map((piece) => [piece.text, piece.start])).toEqual([['Hi.', 3]]);
  });
});

const said = (r: Row, person: string): Row => ({ ...r, person });
const dots = (band: Band) => band.pieces.map((piece) => (piece.mark ? String(piece.person) : '-'));

describe('buildBands — people', () => {
  it('marks the first run of each change of person on a labelled leg, the same number on both bands', () => {
    const bands = buildBands([
      exchange('a', 'participant', [said(row('s1', 0, 0, 'One.'), '1.1')], [said(row('t1', 0, 0, '一。', 'translation'), '1.1')]),
      exchange('b', 'participant', [said(row('s2', 0, 0, 'Two.'), '1.2')], [said(row('t2', 0, 0, '二。', 'translation'), '1.2')]),
      exchange('c', 'participant', [said(row('s3', 0, 0, 'Three.'), '1.2')], [said(row('t3', 0, 0, '三。', 'translation'), '1.2')]),
    ], both, words);
    expect(bands.map((band) => [band.id, dots(band)])).toEqual([
      ['participant-source', ['1', '2', '-']],
      ['participant-translation', ['1', '2', '-']],
    ]);
  });

  it('marks nothing while the leg has had one person', () => {
    const bands = buildBands([
      exchange('a', 'participant', [said(row('s1', 0, 0, 'One.'), '1.1')]),
      exchange('b', 'participant', [said(row('s2', 0, 0, 'Two.'), '1.1')]),
    ], both, words);
    expect(dots(bands[0])).toEqual(['-', '-']);
  });

  it('draws no second dot across a notice, and keeps later dots when the cap cuts the first', () => {
    const notice: Entry = { kind: 'notice', id: 'n', leg: 'participant', severity: 'warning', message: 'w', at: 0 };
    const entries = [
      exchange('a', 'participant', [], [said(row('t1', 0, 0, 'A long first line.', 'translation'), '1.1')]),
      notice,
      exchange('b', 'participant', [], [said(row('t2', 0, 0, 'Same.', 'translation'), '1.1')]),
      exchange('c', 'participant', [], [said(row('t3', 0, 0, 'Other.', 'translation'), '1.2')]),
    ];
    expect(dots(buildBands(entries, both, words)[0])).toEqual(['1', '-', '-', '2']);
    expect(dots(buildBands(entries, both, words, 12)[0])).toEqual(['-', '2']);
  });
});
