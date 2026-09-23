import { describe, it, expect } from 'vitest';
import { AUTO, normalizePair, reverseSupported, swapped } from './languages';
import type { LanguageOption } from './types';

const opt = (value: string): LanguageOption => ({ value, name: value, englishName: value });

/** en / ja / fr with detection; fr translates only into en; `zhen` pairs only with itself (AST2's both-or-neither). */
const p = {
  languages: {
    sources: () => [opt(AUTO), opt('en'), opt('ja'), opt('fr'), opt('zhen')],
    targets: (source: string) => {
      if (source === 'zhen') return [opt('zhen')];
      if (source === 'fr') return [opt('en')];
      return [opt('en'), opt('ja'), opt('fr')].filter((o) => o.value !== source);
    },
  },
};
const s = undefined;

describe('reverseSupported', () => {
  it('holds when the target is a source and the source is among its targets', () => {
    expect(reverseSupported(p, s, { source: 'en', target: 'ja' })).toBe(true);
  });
  it('never holds for an AUTO source, since AUTO is never a target', () => {
    expect(reverseSupported(p, s, { source: AUTO, target: 'en' })).toBe(false);
  });
  it('fails when the provider does not offer the reversed direction', () => {
    expect(reverseSupported(p, s, { source: 'ja', target: 'fr' })).toBe(false);
  });
  it('holds for a pair that is its own reverse', () => {
    expect(reverseSupported(p, s, { source: 'zhen', target: 'zhen' })).toBe(true);
  });
});

describe('swapped', () => {
  it('reverses a supported pair', () => {
    expect(swapped(p, s, { source: 'en', target: 'ja' })).toEqual({ source: 'ja', target: 'en' });
  });
  it('is null for an AUTO source', () => {
    expect(swapped(p, s, { source: AUTO, target: 'en' })).toBeNull();
  });
  it('is null when the reverse is not offered', () => {
    expect(swapped(p, s, { source: 'ja', target: 'fr' })).toBeNull();
  });
  it('is null for a pair that is its own reverse, since there is nothing to swap', () => {
    expect(swapped(p, s, { source: 'zhen', target: 'zhen' })).toBeNull();
  });
});

describe('normalizePair', () => {
  it('keeps a pair the provider offers', () => {
    expect(normalizePair(p, s, { source: 'en', target: 'ja' })).toEqual({ source: 'en', target: 'ja' });
  });
  it('replaces an unlisted source with the first source, keeping a target that source offers', () => {
    expect(normalizePair(p, s, { source: 'xx', target: 'ja' })).toEqual({ source: AUTO, target: 'ja' });
  });
  it('replaces a target the source does not offer with its first target', () => {
    expect(normalizePair(p, s, { source: 'fr', target: 'ja' })).toEqual({ source: 'fr', target: 'en' });
  });
  it('fills an empty pair with the first source and its first target', () => {
    expect(normalizePair(p, s, {})).toEqual({ source: AUTO, target: 'en' });
  });
});
