// src/lib/share/diff.test.ts
import { describe, it, expect } from 'vitest';
import type { ViewerEntry } from './types';
import { applyDiff, diffEntries } from './diff';

const entry = (id: string, text: string): ViewerEntry => ({
  id, leg: 'speaker', t: 1, languages: { source: 'ja', target: 'en' },
  source: [{ key: `${id}:0`, text, final: true }], translation: [],
});
const item = (e: ViewerEntry) => ({ entry: e, json: JSON.stringify(e) });

describe('diffEntries', () => {
  it('sends new and changed entries, removes vanished ones, skips unchanged ones', () => {
    const acked = new Map<string, string>();
    const first = diffEntries(acked, [item(entry('a', '1')), item(entry('b', '1'))]);
    expect(first.upsert.map((e) => e.id)).toEqual(['a', 'b']);
    applyDiff(acked, first);

    const second = diffEntries(acked, [item(entry('a', '1')), item(entry('c', '1')), item(entry('b', '2'))]);
    expect(second.upsert.map((e) => e.id)).toEqual(['c', 'b']);
    expect(second.remove).toEqual([]);
    applyDiff(acked, second);

    const third = diffEntries(acked, [item(entry('c', '1'))]);
    expect(third.upsert).toEqual([]);
    expect(third.remove.sort()).toEqual(['a', 'b']);
    applyDiff(acked, third);
    expect([...acked.keys()]).toEqual(['c']);
  });

  it('changes nothing until applied, so a failed send is retried', () => {
    const acked = new Map<string, string>();
    const d = diffEntries(acked, [item(entry('a', '1'))]);
    expect(acked.size).toBe(0);
    expect(diffEntries(acked, [item(entry('a', '1'))]).upsert.map((e) => e.id)).toEqual(['a']);
    applyDiff(acked, d);
    expect(diffEntries(acked, [item(entry('a', '1'))]).upsert).toEqual([]);
  });
});
