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

describe('displayItems — reuse (`previous`)', () => {
  it('reuses the previous item object for a row whose value, header, end flag, time, leg and languages are unchanged, even when the entry object is new', () => {
    const first = displayItems([exchange('a', 'speaker', [row('s1', 'source', 0, 'hello')], [])], both);
    // A fresh exchange and row object, built the same way — as if the segment's
    // group was rebuilt while some other segment grew elsewhere.
    const second = displayItems([exchange('a', 'speaker', [row('s1', 'source', 0, 'hello')], [])], both, first);
    expect(second[0]).toBe(first[0]);
  });

  it("returns a new object when a row's text changed", () => {
    const first = displayItems([exchange('a', 'speaker', [row('s1', 'source', 0, 'hello')], [])], both);
    const second = displayItems([exchange('a', 'speaker', [row('s1', 'source', 0, 'bye')], [])], both, first);
    expect(second[0]).not.toBe(first[0]);
  });

  it('returns a new object when a header flips (a leg change above changed)', () => {
    const first = displayItems([exchange('a', 'speaker', [row('s1', 'source')], [])], both);
    // Now another exchange of the same leg opens ahead of it, so s1 no longer opens a header.
    const second = displayItems(
      [exchange('z', 'speaker', [row('s0', 'source')], []), exchange('a', 'speaker', [row('s1', 'source')], [])],
      both,
      first,
    );
    expect(second[1]).not.toBe(first[0]);
  });

  it("returns a new object when a row's endsSegment flips", () => {
    const first = displayItems([exchange('a', 'speaker', [], [row('s2', 'translation', 0), row('s2', 'translation', 1)])], both);
    // The segment grew a third row: the previously-last row no longer ends it.
    const second = displayItems(
      [exchange('a', 'speaker', [], [row('s2', 'translation', 0), row('s2', 'translation', 1), row('s2', 'translation', 2)])],
      both,
      first,
    );
    expect(second[1]).not.toBe(first[1]);
    // The row before it is unaffected and is reused.
    expect(second[0]).toBe(first[0]);
  });

  it('reuses a notice item while its entry is the same object', () => {
    const notice: Entry = { kind: 'notice', id: 'n', leg: 'speaker', severity: 'warning', message: 'w', at: 1 };
    const first = displayItems([notice], both);
    const second = displayItems([notice], both, first);
    expect(second[0]).toBe(first[0]);
  });

  it('does not reuse a notice item when a new entry object arrives, even with the same fields', () => {
    const notice1: Entry = { kind: 'notice', id: 'n', leg: 'speaker', severity: 'warning', message: 'w', at: 1 };
    const notice2: Entry = { ...notice1 };
    const first = displayItems([notice1], both);
    const second = displayItems([notice2], both, first);
    expect(second[0]).not.toBe(first[0]);
  });

  it('behaves as today when called without `previous`', () => {
    const entries = [exchange('a', 'speaker', [row('s1', 'source')], [row('s2', 'translation')])];
    expect(shape(displayItems(entries, both))).toEqual(['s1:0+h+e', 's2:0+e']);
  });
});
