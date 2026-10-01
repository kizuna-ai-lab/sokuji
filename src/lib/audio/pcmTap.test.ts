import { describe, it, expect } from 'vitest';
import { createPcmTap, TAP_CAP_SAMPLES, TAP_CHUNK_SAMPLES } from './pcmTap';

describe('createPcmTap', () => {
  it('hands back everything pushed since the last read, oldest first, then nothing', () => {
    const tap = createPcmTap();
    tap.push(Float32Array.of(1, 2));
    tap.push(Float32Array.of(3));
    expect([...tap.read()]).toEqual([1, 2, 3]);
    expect(tap.read()).toHaveLength(0);
  });

  it('keeps only the newest `cap` samples', () => {
    const tap = createPcmTap(4);
    tap.push(Float32Array.of(1, 2, 3));
    tap.push(Float32Array.of(4, 5, 6));
    expect([...tap.read()]).toEqual([3, 4, 5, 6]);
  });

  it('chunks are 100 ms and the cap is thirty seconds, at 24 kHz', () => {
    expect(TAP_CHUNK_SAMPLES).toBe(2400);
    expect(TAP_CAP_SAMPLES).toBe(720_000);
  });
});
