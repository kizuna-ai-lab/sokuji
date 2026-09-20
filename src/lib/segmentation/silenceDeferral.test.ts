import { describe, it, expect } from 'vitest';
import { SilenceDeferral, tailIsClean } from './silenceDeferral';

describe('tailIsClean', () => {
  it('nothing left to seal is a place a bubble may end', () => {
    expect(tailIsClean('')).toBe(true);
    expect(tailIsClean('   \n')).toBe(true);
  });

  it('a finished sentence is a place a bubble may end, trailing space and closers included', () => {
    expect(tailIsClean('これは完成した文です。')).toBe(true);
    expect(tailIsClean('Done. ')).toBe(true);
    expect(tailIsClean('He said "go."')).toBe(true);
  });

  it('a clause mark or bare text in the middle of a sentence is not', () => {
    expect(tailIsClean('成为商人或者是商队的向导，')).toBe(false);
    expect(tailIsClean('half a sentence')).toBe(false);
    expect(tailIsClean('Dr. Andrew')).toBe(false);
  });
});

describe('SilenceDeferral', () => {
  it('closes on the first expiry when the tail ends at a sentence terminal', () => {
    const d = new SilenceDeferral();
    expect(d.deferAtExpiry('終わりました。')).toBe(false);
  });

  it('closes on the first expiry when there is nothing left to seal', () => {
    const d = new SilenceDeferral();
    expect(d.deferAtExpiry('')).toBe(false);
  });

  it('defers a mid-sentence tail once, then closes when it has not grown', () => {
    const d = new SilenceDeferral();
    expect(d.deferAtExpiry('向导，')).toBe(true);
    expect(d.deferAtExpiry('向导，')).toBe(false);
  });

  it('keeps deferring while the speaker is still producing text', () => {
    const d = new SilenceDeferral();
    expect(d.deferAtExpiry('向导，')).toBe(true);
    expect(d.deferAtExpiry('向导，以及')).toBe(true);
    expect(d.deferAtExpiry('向导，以及保')).toBe(true);
    expect(d.deferAtExpiry('向导，以及保')).toBe(false);
  });

  it('reads trailing whitespace as no growth at all', () => {
    const d = new SilenceDeferral();
    expect(d.deferAtExpiry('half a sentence')).toBe(true);
    expect(d.deferAtExpiry('half a sentence   ')).toBe(false);
  });

  it('closes as soon as the deferred sentence finishes', () => {
    const d = new SilenceDeferral();
    expect(d.deferAtExpiry('向导，')).toBe(true);
    expect(d.deferAtExpiry('向导，以及保镖。')).toBe(false);
  });

  it('reset forgets the previous expiry, so the next item starts with its own window', () => {
    const d = new SilenceDeferral();
    expect(d.deferAtExpiry('向导，')).toBe(true);
    d.reset();
    expect(d.deferAtExpiry('向导，')).toBe(true);
  });
});
