// src/viewer/model.test.ts
import { describe, it, expect } from 'vitest';
import type { ShareState, ViewerEntry } from '../lib/share/types';
import { INITIAL_MODEL, legsOf, reduce, statusOf } from './model';

const STATE: ShareState = { phase: 'live', pair: { source: 'ja', target: 'zh-CN' }, allowSave: false };
const entry = (id: string, t: number, text = id, leg: 'speaker' | 'participant' = 'speaker'): ViewerEntry => ({
  id, leg, t, languages: { source: 'ja', target: 'zh-CN' }, source: [{ key: `${id}:0`, text, final: true }], translation: [],
});

describe('viewer model', () => {
  it('a snapshot after entries replaces them (a phone that slept and reconnected)', () => {
    let m = reduce(INITIAL_MODEL, { type: 'snapshot', state: STATE, entries: [entry('a', 1), entry('b', 2)] });
    m = reduce(m, { type: 'error' });
    expect(statusOf(m)).toBe('reconnecting');
    m = reduce(m, { type: 'snapshot', state: STATE, entries: [entry('b', 2), entry('c', 3)] });
    expect(m.entries.map((e) => e.id)).toEqual(['b', 'c']);
    expect(statusOf(m)).toBe('live');
  });

  it('an upsert of a known id replaces it in place; new ones go in by time', () => {
    let m = reduce(INITIAL_MODEL, { type: 'snapshot', state: STATE, entries: [entry('a', 1, 'partial'), entry('c', 3)] });
    m = reduce(m, { type: 'upsert', entries: [entry('a', 1, 'final'), entry('b', 2)] });
    expect(m.entries.map((e) => [e.id, e.source[0].text])).toEqual([['a', 'final'], ['b', 'b'], ['c', 'c']]);
  });

  it('removes, clears with a reason, and drops the reason when text comes back', () => {
    let m = reduce(INITIAL_MODEL, { type: 'snapshot', state: STATE, entries: [entry('a', 1), entry('b', 2)] });
    m = reduce(m, { type: 'remove', ids: ['a'] });
    expect(m.entries.map((e) => e.id)).toEqual(['b']);
    m = reduce(m, { type: 'clear', reason: 'restart' });
    expect(m.entries).toEqual([]);
    expect(m.notice).toBe('restart');
    m = reduce(m, { type: 'upsert', entries: [entry('x', 9)] });
    expect(m.notice).toBeNull();
  });

  it('derives the status the page shows', () => {
    expect(statusOf(INITIAL_MODEL)).toBe('waiting');
    let m = reduce(INITIAL_MODEL, { type: 'snapshot', state: { ...STATE, phase: 'idle' }, entries: [] });
    expect(statusOf(m)).toBe('waiting');
    m = reduce(m, { type: 'upsert', entries: [entry('a', 1)] });
    expect(statusOf(m)).toBe('paused');
    m = reduce(m, { type: 'state', state: STATE });
    expect(statusOf(m)).toBe('live');
    m = reduce(m, { type: 'ended' });
    expect(statusOf(m)).toBe('ended');
    expect(statusOf(reduce(m, { type: 'error' }))).toBe('ended');
  });

  it('tells which legs are on the page', () => {
    expect(legsOf([entry('a', 1)])).toEqual({ speaker: true, participant: false });
    expect(legsOf([entry('a', 1), entry('b', 2, 'b', 'participant')])).toEqual({ speaker: true, participant: true });
  });
});
