import { describe, expect, it } from 'vitest';
import type { Entry, Row } from '@shared/lib/projection/types';
import { readingLines } from './reading';

const MIN = 60000;
const t0 = Date.UTC(2026, 9, 28, 1, 0, 5);

const row = (key: string, text: string, final = true, person?: string): Row =>
  ({ key, segmentId: key, side: 'source', start: 0, end: text.length, text, final, ...(person ? { person } : {}) }) as Row;

const exchange = (id: string, t: number, opts: { person?: string; final?: boolean } = {}): Entry => ({
  kind: 'exchange',
  id,
  leg: 'speaker',
  languages: { source: 'en', target: 'ja' },
  pairing: 'stated',
  t,
  source: [row(`${id}s`, `src ${id}`, opts.final ?? true, opts.person)],
  translation: [row(`${id}t`, `tr ${id}`, opts.final ?? true, opts.person)],
}) as Entry;

describe('a saved session as reading lines', () => {
  it('reads top to bottom in the order spoken, notices left out', () => {
    const notice = { kind: 'notice', id: 'n', leg: 'speaker', severity: 'error', message: 'socket closed', at: t0 } as Entry;
    const lines = readingLines([exchange('a', t0), notice, exchange('b', t0 + 1000)]);
    expect(lines.map((l) => l.id)).toEqual(['a', 'b']);
  });

  it('shows the time on the first line and when the minute changes, not on every line', () => {
    const lines = readingLines([exchange('a', t0), exchange('b', t0 + 20000), exchange('c', t0 + MIN)]);
    expect(lines.map((l) => l.showTime)).toEqual([true, false, true]);
  });

  it('numbers speakers only when there are two or more, and marks where the speaker changes', () => {
    const one = readingLines([exchange('a', t0, { person: '1' }), exchange('b', t0 + 1000, { person: '1' })]);
    expect(one.map((l) => l.person)).toEqual([undefined, undefined]);

    const two = readingLines([
      exchange('a', t0, { person: 'x' }),
      exchange('b', t0 + 1000, { person: 'x' }),
      exchange('c', t0 + 2000, { person: 'y' }),
    ]);
    expect(two.map((l) => l.person)).toEqual([1, 1, 2]);
    expect(two.map((l) => l.showPerson)).toEqual([true, false, true]);
    // A new speaker also shows the time, so each turn has its own heading.
    expect(two.map((l) => l.showTime)).toEqual([true, false, true]);
  });

  it('marks a line the session ended in the middle of', () => {
    const lines = readingLines([exchange('a', t0), exchange('b', t0 + 1000, { final: false })]);
    expect(lines.map((l) => l.unfinished)).toEqual([false, true]);
  });
});

describe('a line with no translation', () => {
  it('says so, so the reader can show the source instead of an empty line', () => {
    const untranslated = { ...exchange('a', t0), translation: [] } as Entry;
    const blank = { ...exchange('b', t0 + 1000), translation: [row('bt', '  ')] } as Entry;
    const lines = readingLines([untranslated, blank, exchange('c', t0 + 2000)]);
    expect(lines.map((l) => l.translated)).toEqual([false, false, true]);
  });
});
