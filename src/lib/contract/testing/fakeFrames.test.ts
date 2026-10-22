import { describe, it, expect, vi } from 'vitest';
import type { FrameReason } from '../adapter';
import { fakeFrameSource, JPEG_A, JPEG_B } from './fakeFrames';

describe('fakeFrameSource', () => {
  it('hands a frame in hand to each subscriber at subscribe, then every emit, until unsubscribed', () => {
    const src = fakeFrameSource({ inHand: JPEG_A });
    const got: Array<[Uint8Array, FrameReason]> = [];
    const off = src.subscribe((j, r) => got.push([j, r]), () => {}, () => {});
    expect(got).toEqual([[JPEG_A, 'first']]);
    src.emit(JPEG_B);
    expect(got[1]).toEqual([JPEG_B, 'changed']);
    off();
    src.emit(JPEG_A);
    expect(got).toHaveLength(2);
    expect(src.subscribers).toBe(0);
  });

  it('tells every subscriber a loss and a return, once each', () => {
    const src = fakeFrameSource();
    const lostA = vi.fn();
    const backA = vi.fn();
    const lostB = vi.fn();
    const backB = vi.fn();
    src.subscribe(() => {}, lostA, backA);
    src.subscribe(() => {}, lostB, backB);
    src.lose();
    expect(lostA).toHaveBeenCalledTimes(1);
    expect(lostB).toHaveBeenCalledTimes(1);
    expect(backA).not.toHaveBeenCalled();
    src.back();
    expect(backA).toHaveBeenCalledTimes(1);
    expect(backB).toHaveBeenCalledTimes(1);
    expect(lostA).toHaveBeenCalledTimes(1);
    expect(lostB).toHaveBeenCalledTimes(1);
  });
});
