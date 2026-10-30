import { describe, expect, it } from 'vitest';
import { leadTrimmed } from './spans';

describe('a line as drawn', () => {
  it('starts at its first word: the leading space of the first token goes (Sophie: " When trade…")', () => {
    expect(leadTrimmed([{ text: ' When' }, { text: ' trade' }]).map((r) => r.text)).toEqual(['When', ' trade']);
  });

  it('skips rows that are only space before the first word, and keeps the rest as they are', () => {
    expect(leadTrimmed([{ text: '  ' }, { text: ' 交易が' }, { text: ' 続く' }]).map((r) => r.text)).toEqual(['', '交易が', ' 続く']);
  });

  it('leaves a line that starts with a word alone', () => {
    const rows = [{ text: 'Hello' }, { text: ' there' }];
    expect(leadTrimmed(rows)).toEqual(rows);
  });
});
