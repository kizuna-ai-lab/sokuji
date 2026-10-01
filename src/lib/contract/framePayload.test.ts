import { describe, it, expect } from 'vitest';
import { FRAME_STRING_MAX, framePayload } from './framePayload';

describe('framePayload', () => {
  it('redacts every string and clips one past 2 000 characters with an ellipsis', () => {
    expect(FRAME_STRING_MAX).toBe(2000);
    const long = framePayload('x'.repeat(3000));
    expect(typeof long).toBe('string');
    expect((long as string).length).toBe(2001);
    expect((long as string).endsWith('…')).toBe(true);
    // Exactly at the bound: kept whole.
    expect(framePayload('x'.repeat(2000))).toBe('x'.repeat(2000));
    const key = `sk-proj-${'a'.repeat(40)}`;
    const clean = framePayload(`key ${key} here`);
    expect(clean).not.toContain(key);
    expect(clean).toContain('[REDACTED]');
  });

  it('walks arrays and objects, and leaves numbers, booleans and undefined alone', () => {
    expect(framePayload({ a: [1, 'ok'], b: true, c: undefined })).toEqual({ a: [1, 'ok'], b: true, c: undefined });
    // Nested strings are redacted too.
    const key = `sk-proj-${'b'.repeat(40)}`;
    expect(framePayload({ outer: [{ message: key }] })).toEqual({ outer: [{ message: '[REDACTED]' }] });
    expect(framePayload(42)).toBe(42);
    expect(framePayload(null)).toBe(null);
  });
});
