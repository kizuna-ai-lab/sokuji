import { describe, it, expect } from 'vitest';
import type { Entry, Row } from '../projection/types';
import { displayItems, type LegFilters } from './filter';

const row = (segmentId: string, side: 'source' | 'translation', k = 0, text = 'x'): Row =>
  ({ key: `${segmentId}:${k}`, segmentId, side, start: 0, end: text.length, text, final: true });
const exchange = (id: string, leg: 'speaker' | 'participant', source: Row[], translation: Row[], t = 0): Entry =>
  ({ kind: 'exchange', id, leg, languages: { source: 'en', target: 'ja' }, pairing: 'stated', source, translation, t });
const both: LegFilters = { speaker: 'both', participant: 'both' };
const shape = (items: ReturnType<typeof displayItems>) =>
  items.map((i) => (i.kind === 'notice' ? 'notice' : `${i.row.key}${i.header ? '+h' : ''}${i.endsSegment ? '+e' : ''}`));

describe('displayItems', () => {
  it("draws an exchange's source rows before its translation rows, and opens a header where the leg changes", () => {
    const entries = [
      exchange('a', 'speaker', [row('s1', 'source')], [row('s2', 'translation')]),
      exchange('b', 'speaker', [row('s3', 'source')], []),
      exchange('c', 'participant', [row('p1', 'source')], []),
    ];
    expect(shape(displayItems(entries, both))).toEqual(['s1:0+h+e', 's2:0+e', 's3:0+e', 'p1:0+h+e']);
  });

  it("marks only a segment's last drawn row as its end", () => {
    const entries = [exchange('a', 'speaker', [], [row('s2', 'translation', 0), row('s2', 'translation', 1)])];
    expect(shape(displayItems(entries, both))).toEqual(['s2:0+h', 's2:1+e']);
  });

  it('shows the side a filter asks for, and nothing of a leg filtered to none', () => {
    const entries = [exchange('a', 'speaker', [row('s1', 'source')], [row('s2', 'translation')])];
    expect(shape(displayItems(entries, { ...both, speaker: 'translation' }))).toEqual(['s2:0+h+e']);
    expect(shape(displayItems(entries, { ...both, speaker: 'source' }))).toEqual(['s1:0+h+e']);
    expect(displayItems(entries, { ...both, speaker: 'none' })).toEqual([]);
  });

  it('draws a notice under every filter, and a notice neither opens nor breaks a header group', () => {
    const notice: Entry = { kind: 'notice', id: 'n', leg: 'speaker', severity: 'warning', message: 'w', at: 1 };
    const entries = [
      exchange('a', 'speaker', [row('s1', 'source')], []),
      notice,
      exchange('b', 'speaker', [row('s2', 'source')], []),
    ];
    expect(shape(displayItems(entries, both))).toEqual(['s1:0+h+e', 'notice', 's2:0+e']);
    expect(shape(displayItems(entries, { ...both, speaker: 'none' }))).toEqual(['notice']);
  });
});
