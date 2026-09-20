import { describe, it, expect } from 'vitest';
import {
  resolveSegmentationMode,
  resolveSegmentationSize,
  type SegmentationMode,
  type SegmentationOffer,
} from './segmentationMode';

/** The three offers the phase-1 capability table actually produces. */
const PAUSE_CLIENT: SegmentationOffer = { pause: true, auto: false, sizes: true };
const SERVER_DEFINITE: SegmentationOffer = { pause: false, auto: true, sizes: false };
const LOCAL_ENGINE: SegmentationOffer = { pause: false, auto: false, sizes: true };
const EVERY_OFFER = [PAUSE_CLIENT, SERVER_DEFINITE, LOCAL_ENGINE];

describe('resolveSegmentationMode', () => {
  it('leaves Off alone everywhere', () => {
    for (const offer of EVERY_OFFER) {
      expect(resolveSegmentationMode('off', offer)).toBe('off');
    }
  });

  // Every provider offers at least one of Auto and sizes, so By sentences is
  // always runnable — only the size below it differs.
  it('leaves By sentences alone everywhere', () => {
    for (const offer of EVERY_OFFER) {
      expect(resolveSegmentationMode('sentences', offer)).toBe('sentences');
    }
  });

  it('keeps By pause where the client has timers of its own', () => {
    expect(resolveSegmentationMode('pause', PAUSE_CLIENT)).toBe('pause');
  });

  // The stored default is `pause`; on a provider with no timers that is Off.
  // One stored value, both behaviours.
  it('resolves By pause to Off where the client has no timers', () => {
    expect(resolveSegmentationMode('pause', SERVER_DEFINITE)).toBe('off');
    expect(resolveSegmentationMode('pause', LOCAL_ENGINE)).toBe('off');
  });

  it('treats a mode string from an older build as the provider default', () => {
    const stale = 'enabled' as unknown as SegmentationMode;
    expect(resolveSegmentationMode(stale, PAUSE_CLIENT)).toBe('pause');
    expect(resolveSegmentationMode(stale, SERVER_DEFINITE)).toBe('off');
    expect(resolveSegmentationMode(stale, LOCAL_ENGINE)).toBe('off');
  });
});

describe('resolveSegmentationSize', () => {
  it('keeps Auto where the boundary already has an owner', () => {
    expect(resolveSegmentationSize(0, SERVER_DEFINITE)).toBe(0);
  });

  it('resolves Auto to the default 3 where there is no Auto', () => {
    expect(resolveSegmentationSize(0, PAUSE_CLIENT)).toBe(3);
    expect(resolveSegmentationSize(0, LOCAL_ENGINE)).toBe(3);
  });

  it('keeps 1-5 where a bubble every N sentences is implementable', () => {
    for (const n of [1, 2, 3, 4, 5] as const) {
      expect(resolveSegmentationSize(n, PAUSE_CLIENT)).toBe(n);
      expect(resolveSegmentationSize(n, LOCAL_ENGINE)).toBe(n);
    }
  });

  it('resolves a size to Auto where sealing every N sentences is not offered', () => {
    for (const n of [1, 2, 3, 4, 5] as const) {
      expect(resolveSegmentationSize(n, SERVER_DEFINITE)).toBe(0);
    }
  });

  it('takes the provider default for a value outside 0-5', () => {
    for (const bad of [-1, 6, 99, NaN, Infinity]) {
      expect(resolveSegmentationSize(bad, PAUSE_CLIENT)).toBe(3);
      expect(resolveSegmentationSize(bad, LOCAL_ENGINE)).toBe(3);
      expect(resolveSegmentationSize(bad, SERVER_DEFINITE)).toBe(0);
    }
  });

  // A hand-edited settings file, or an older build that wrote the number as
  // text, must not reach a SentenceStream as a string.
  it('takes the provider default for a value that is not a number at all', () => {
    const junk = 'three' as unknown as number;
    expect(resolveSegmentationSize(junk, LOCAL_ENGINE)).toBe(3);
    expect(resolveSegmentationSize(junk, SERVER_DEFINITE)).toBe(0);
  });

  it('rounds a fractional size to a whole one', () => {
    expect(resolveSegmentationSize(2.4, LOCAL_ENGINE)).toBe(2);
    expect(resolveSegmentationSize(2.6, LOCAL_ENGINE)).toBe(3);
  });
});
