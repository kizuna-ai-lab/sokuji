import { describe, it, expect, afterEach, vi } from 'vitest';
import { loadTestTone, testToneUrl } from './testTone';

afterEach(() => { vi.unstubAllGlobals(); });

function context(channels: Float32Array[], sampleRate: number) {
  return {
    decodeAudioData: vi.fn(async () => ({
      length: channels[0].length,
      numberOfChannels: channels.length,
      sampleRate,
      getChannelData: (c: number) => channels[c],
    })),
  } as unknown as BaseAudioContext;
}

const ok = vi.fn(async () => new Response(new ArrayBuffer(8)));

describe('loadTestTone', () => {
  it('mixes the channels to one, 10% under full scale, at its own rate', async () => {
    const clip = await loadTestTone(context([Float32Array.of(1, 0), Float32Array.of(0, 1)], 44100), ok, '/tone.mp3');
    expect(ok).toHaveBeenCalledWith('/tone.mp3');
    expect(clip.sampleRate).toBe(44100);
    expect([...clip.audio].map((s) => Math.round(s * 100) / 100)).toEqual([0.45, 0.45]);
  });

  it('rejects when the asset does not load', async () => {
    const missing = vi.fn(async () => new Response(null, { status: 404 }));
    await expect(loadTestTone(context([Float32Array.of(0)], 24000), missing, '/tone.mp3')).rejects.toThrow('404');
  });
});

describe('testToneUrl', () => {
  it('is the bundled asset, served from the extension when there is one', () => {
    expect(testToneUrl()).toBe('/assets/test-tone.mp3');
    vi.stubGlobal('chrome', { runtime: { getURL: (path: string) => `chrome-extension://x/${path}` } });
    expect(testToneUrl()).toBe('chrome-extension://x/assets/test-tone.mp3');
  });
});
