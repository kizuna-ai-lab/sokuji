import { describe, expect, it } from 'vitest';
import { identityWire, wireTable } from './wire';

describe('wireTable', () => {
  const t = wireTable([['en'], ['es-CL', 'es-ch'], ['zh+en', 'zhen']]);

  it('maps app codes to vendor codes and back', () => {
    expect(t.toWire('en')).toBe('en');
    expect(t.toWire('es-CL')).toBe('es-ch');
    expect(t.toWire('zh+en')).toBe('zhen');
    expect(t.fromWire('es-ch')).toBe('es-CL');
    expect(t.codes).toEqual(['en', 'es-CL', 'zh+en']);
  });

  it('reads a vendor code whatever its case', () => {
    expect(t.fromWire('ES-CH')).toBe('es-CL');
    expect(t.fromWire('ZHEN')).toBe('zh+en');
  });

  it('answers null for a vendor code it does not know, or none', () => {
    expect(t.fromWire('ka')).toBeNull();
    expect(t.fromWire('')).toBeNull();
    expect(t.fromWire(undefined)).toBeNull();
  });

  it('throws on an app code it does not hold: a build is only handed an offered code', () => {
    expect(() => t.toWire('ja')).toThrow(RangeError);
  });

  it('refuses a table that is not one-to-one, or holds a non-app code', () => {
    expect(() => wireTable([['en'], ['en', 'en-us']])).toThrow(/Duplicate app code/);
    expect(() => wireTable([['en', 'x'], ['ja', 'X']])).toThrow(/Duplicate vendor code/);
    expect(() => wireTable([['zh_CN']])).toThrow(/Not an app code/);
  });
});

describe('identityWire', () => {
  it('sends an app code as itself and reads back only app codes', () => {
    const t = identityWire();
    expect(t.toWire('zh-TW')).toBe('zh-TW');
    expect(t.fromWire('zh-TW')).toBe('zh-TW');
    expect(t.fromWire('zh_TW')).toBeNull();
    expect(() => t.toWire('zh_TW')).toThrow(RangeError);
  });
});
