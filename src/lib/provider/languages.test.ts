import { describe, it, expect } from 'vitest';
import { AUTO, normalizePair, reversedPair, reverseSupported, swapped } from './languages';
import { identityWire } from '../language/wire';
import type { LanguageContext, LanguageOption } from './types';

const opt = (value: string): LanguageOption => ({ value });

/** en / ja / fr with detection; fr translates only into en; `zhen` pairs only with itself (AST2's both-or-neither). */
const p = {
  languages: {
    wire: identityWire(),
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

/** Speaking offers en and ja; text also offers ko — Doubao AST 2.0's shape: it speaks fewer languages than it transcribes. */
const spoken = (context?: LanguageContext) => [opt('en'), opt('ja'), ...(context?.speech ? [] : [opt('ko')])];
const q = {
  languages: {
    wire: identityWire(),
    sources: (_s: unknown, context?: LanguageContext) => spoken(context),
    targets: (source: string, _s: unknown, context?: LanguageContext) => spoken(context).filter((o) => o.value !== source),
  },
};

describe('a language context (Stage 2 Volcengine AST2, choice 1)', () => {
  it('normalizes into the offer for the context, and into the widest offer without one', () => {
    expect(normalizePair(q, s, { source: 'ko', target: 'en' }, { speech: true })).toEqual({ source: 'en', target: 'ja' });
    expect(normalizePair(q, s, { source: 'ko', target: 'en' }, { speech: false })).toEqual({ source: 'ko', target: 'en' });
    expect(normalizePair(q, s, { source: 'ko', target: 'en' })).toEqual({ source: 'ko', target: 'en' });
  });

  it('reverses and swaps within the offer for the context', () => {
    expect(reverseSupported(q, s, { source: 'en', target: 'ko' }, { speech: true })).toBe(false);
    expect(reverseSupported(q, s, { source: 'en', target: 'ko' }, { speech: false })).toBe(true);
    expect(swapped(q, s, { source: 'en', target: 'ko' }, { speech: true })).toBeNull();
    expect(swapped(q, s, { source: 'en', target: 'ko' })).toEqual({ source: 'ko', target: 'en' });
  });

  it('changes nothing for a provider whose languages ignore it', () => {
    expect(normalizePair(p, s, { source: 'fr', target: 'ja' }, { speech: true })).toEqual(normalizePair(p, s, { source: 'fr', target: 'ja' }));
    expect(reverseSupported(p, s, { source: 'en', target: 'ja' }, { speech: false })).toBe(true);
  });
});

/**
 * A provider that states its reverse (Stage 2 Palabra, ruling 9), shaped as
 * Palabra: `en` is a source and `en-us` a target of the same language; `xx`
 * is a source with no reverse; `yy` a target whose reverse it does not offer.
 */
const regional = {
  languages: {
    wire: identityWire(),
    sources: () => [opt(AUTO), opt('en'), opt('ja'), opt('xx')],
    targets: () => [opt('en-us'), opt('ja'), opt('yy')],
    reverse: (pair: { source: string; target: string }) => {
      const toSource: Record<string, string> = { 'en-us': 'en', ja: 'ja', yy: 'zz' };
      const toTarget: Record<string, string> = { en: 'en-us', ja: 'ja' };
      const source = toSource[pair.target];
      const target = toTarget[pair.source];
      return source !== undefined && target !== undefined ? { source, target } : null;
    },
  },
};

describe("a provider's own reverse (Stage 2 Palabra, ruling 9)", () => {
  it('is the plain swap when the provider states none', () => {
    expect(reversedPair(p, s, { source: 'en', target: 'ja' })).toEqual({ source: 'ja', target: 'en' });
  });

  it("is the provider's own when it states one, null where it has none", () => {
    expect(reversedPair(regional, s, { source: 'ja', target: 'en-us' })).toEqual({ source: 'en', target: 'ja' });
    expect(reversedPair(regional, s, { source: 'en', target: 'ja' })).toEqual({ source: 'ja', target: 'en-us' });
    expect(reversedPair(regional, s, { source: 'xx', target: 'ja' })).toBeNull();
  });

  it('reverses a region target by its source code, where the plain swap finds no source', () => {
    expect(reverseSupported(regional, s, { source: 'ja', target: 'en-us' })).toBe(true);
    // The control: the same lists with no reverse of their own.
    const plain = { languages: { wire: identityWire(), sources: regional.languages.sources, targets: regional.languages.targets } };
    expect(reverseSupported(plain, s, { source: 'ja', target: 'en-us' })).toBe(false);
  });

  it('refuses a pair its reverse leaves without one, or leads outside the offer', () => {
    expect(reverseSupported(regional, s, { source: 'xx', target: 'ja' })).toBe(false);
    expect(reverseSupported(regional, s, { source: 'ja', target: 'yy' })).toBe(false);
    expect(reverseSupported(regional, s, { source: AUTO, target: 'ja' })).toBe(false);
  });

  it("swaps into the provider's reverse, and not at all when that is the same pair", () => {
    expect(swapped(regional, s, { source: 'en', target: 'ja' })).toEqual({ source: 'ja', target: 'en-us' });
    expect(swapped(regional, s, { source: 'ja', target: 'en-us' })).toEqual({ source: 'en', target: 'ja' });
    expect(swapped(regional, s, { source: 'ja', target: 'ja' })).toBeNull();
    expect(swapped(regional, s, { source: 'en', target: 'en-us' })).toBeNull();
  });

  it('refuses an AUTO source even when the hook maps it into a pair the provider offers (D20; review M2)', () => {
    const rogue = { languages: { wire: identityWire(), sources: regional.languages.sources, targets: regional.languages.targets, reverse: () => ({ source: 'en', target: 'ja' }) } };
    expect(reverseSupported(rogue, s, { source: AUTO, target: 'ja' })).toBe(false);
  });
});
