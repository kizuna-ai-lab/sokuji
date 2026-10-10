import { describe, it, expect } from 'vitest';
import { earTone } from './earTone';

describe('earTone', () => {
  it('is two short notes with a gap, under a quarter of full scale, at the given rate', () => {
    const clip = earTone(24000);
    expect(clip.sampleRate).toBe(24000);
    // 0.12 s + 0.05 s + 0.18 s.
    expect(clip.audio.length).toBe(2880 + 1200 + 4320);
    const peak = Math.max(...clip.audio.map(Math.abs));
    expect(peak).toBeGreaterThan(0.2);
    expect(peak).toBeLessThanOrEqual(0.25);
    // The gap is silent; both notes start and end near zero (ramped).
    expect(clip.audio.slice(2880, 4080).every((s) => s === 0)).toBe(true);
    expect(Math.abs(clip.audio[0])).toBeLessThan(0.01);
    expect(Math.abs(clip.audio[2879])).toBeLessThan(0.01);
    expect(Math.abs(clip.audio[4080])).toBeLessThan(0.01);
    expect(Math.abs(clip.audio[clip.audio.length - 1])).toBeLessThan(0.01);
  });

  it('defaults to the pipeline rate and carries no pan of its own', () => {
    const clip = earTone();
    expect(clip.sampleRate).toBe(24000);
    expect(clip).not.toHaveProperty('pan');
  });
});
