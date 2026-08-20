import { describe, it, expect } from 'vitest';
import { normalizeHex, hexToHsv, hsvToHex } from './color';

describe('normalizeHex', () => {
  it('expands 3-digit shorthand', () => {
    expect(normalizeHex('#abc')).toBe('#aabbcc');
    expect(normalizeHex('abc')).toBe('#aabbcc');
  });

  it('lowercases and prefixes 6-digit values', () => {
    expect(normalizeHex('#A1B2C3')).toBe('#a1b2c3');
    expect(normalizeHex('A1B2C3')).toBe('#a1b2c3');
  });

  it('tolerates surrounding whitespace', () => {
    expect(normalizeHex('  #fff  ')).toBe('#ffffff');
  });

  it('rejects anything that is not a 3- or 6-digit hex', () => {
    expect(normalizeHex('#12345')).toBeNull();
    expect(normalizeHex('#gggggg')).toBeNull();
    expect(normalizeHex('rebeccapurple')).toBeNull();
    expect(normalizeHex('')).toBeNull();
    expect(normalizeHex('#')).toBeNull();
  });
});

describe('hexToHsv', () => {
  it('maps the primaries onto their hue angles', () => {
    expect(hexToHsv('#ff0000')).toEqual({ h: 0, s: 100, v: 100 });
    expect(hexToHsv('#00ff00')).toEqual({ h: 120, s: 100, v: 100 });
    expect(hexToHsv('#0000ff')).toEqual({ h: 240, s: 100, v: 100 });
  });

  it('maps the achromatic ends', () => {
    expect(hexToHsv('#000000')).toEqual({ h: 0, s: 0, v: 0 });
    expect(hexToHsv('#ffffff')).toEqual({ h: 0, s: 0, v: 100 });
  });

  it('falls back to black for an unparseable input instead of throwing', () => {
    expect(hexToHsv('not-a-color')).toEqual({ h: 0, s: 0, v: 0 });
  });
});

describe('hsvToHex', () => {
  it('inverts hexToHsv for the primaries', () => {
    expect(hsvToHex({ h: 0, s: 100, v: 100 })).toBe('#ff0000');
    expect(hsvToHex({ h: 120, s: 100, v: 100 })).toBe('#00ff00');
    expect(hsvToHex({ h: 240, s: 100, v: 100 })).toBe('#0000ff');
    expect(hsvToHex({ h: 0, s: 0, v: 0 })).toBe('#000000');
    expect(hsvToHex({ h: 0, s: 0, v: 100 })).toBe('#ffffff');
  });

  // hexToHsv keeps full float precision precisely so this holds: a color the
  // user never touched must survive a trip through the picker unchanged.
  it('round-trips arbitrary colors exactly', () => {
    for (const hex of ['#7f3ac1', '#10a37f', '#6cc5ff', '#1b5e20', '#ffd27d', '#123456']) {
      expect(hsvToHex(hexToHsv(hex))).toBe(hex);
    }
  });

  it('wraps hue and clamps s/v out of range', () => {
    expect(hsvToHex({ h: 360, s: 100, v: 100 })).toBe('#ff0000');
    expect(hsvToHex({ h: -60, s: 100, v: 100 })).toBe('#ff00ff');
    expect(hsvToHex({ h: 0, s: 150, v: 150 })).toBe('#ff0000');
    expect(hsvToHex({ h: 0, s: -10, v: -10 })).toBe('#000000');
  });
});
