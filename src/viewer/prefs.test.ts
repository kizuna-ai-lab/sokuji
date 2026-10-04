// src/viewer/prefs.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readPref, writePref } from './prefs';

const isBool = (v: unknown): v is boolean => typeof v === 'boolean';

beforeEach(() => window.localStorage.clear());

describe('viewer prefs', () => {
  it('round-trips under sokuji.viewer.* and ignores bad values', () => {
    writePref('completeOnly', true);
    expect(window.localStorage.getItem('sokuji.viewer.completeOnly')).toBe('true');
    expect(readPref('completeOnly', false, isBool)).toBe(true);
    window.localStorage.setItem('sokuji.viewer.completeOnly', '"yes"');
    expect(readPref('completeOnly', false, isBool)).toBe(false);
  });

  it('works when storage throws', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(readPref('completeOnly', false, isBool)).toBe(false);
    expect(() => writePref('completeOnly', true)).not.toThrow();
    spy.mockRestore();
    set.mockRestore();
  });
});
