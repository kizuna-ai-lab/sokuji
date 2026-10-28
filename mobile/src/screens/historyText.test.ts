import { describe, expect, it } from 'vitest';
import { sessionLines } from './historyText';

const start = Date.UTC(2026, 9, 28, 1, 0);
const fmt = {
  when: (ms: number) => `D${(ms - start) / 60000}`,
  pair: (source: string, target: string) => `${source}>${target}`,
  minutes: (n: number) => `${n}m`,
};

describe('a session in the history list', () => {
  it('is named by its date when it has no title, and the date is not said twice', () => {
    expect(sessionLines({ title: '', startedAt: start, endedAt: start + 12 * 60000, source: 'auto', target: 'ja' }, fmt)).toEqual({
      name: 'D0',
      meta: 'auto>ja · 12m',
    });
  });

  it('keeps the date under a title', () => {
    expect(sessionLines({ title: 'Standup', startedAt: start, endedAt: start + 60000, source: 'en', target: 'ja' }, fmt)).toEqual({
      name: 'Standup',
      meta: 'D0 · en>ja · 1m',
    });
  });

  it('leaves the length out while a session has no end (it was cut off)', () => {
    expect(sessionLines({ startedAt: start, endedAt: null, source: 'en', target: 'ja' }, fmt).meta).toBe('en>ja');
  });
});
