import { afterEach, describe, it, expect, vi } from 'vitest';
import { decodeOggOpus } from './decode';

/** An `OfflineAudioContext` stand-in: records what it was built with and handed, and decodes to fixed samples. */
function stubContext(samples: number[]) {
  const made: Array<{ channels: number; length: number; rate: number; bytes: number[] }> = [];
  vi.stubGlobal('OfflineAudioContext', class {
    private readonly entry: (typeof made)[number];
    constructor(channels: number, length: number, rate: number) {
      this.entry = { channels, length, rate, bytes: [] };
      made.push(this.entry);
    }
    async decodeAudioData(buffer: ArrayBuffer) {
      this.entry.bytes = Array.from(new Uint8Array(buffer));
      return { getChannelData: () => Float32Array.from(samples) };
    }
  });
  return made;
}

afterEach(() => vi.unstubAllGlobals());

describe('decodeOggOpus', () => {
  it('decodes through an offline context at the contract rate, mono, handing it exactly the clip', async () => {
    const made = stubContext([0]);
    const backing = new Uint8Array([7, 1, 2, 3, 7]);
    await decodeOggOpus(backing.subarray(1, 4));
    expect(made).toEqual([{ channels: 1, length: 1, rate: 24_000, bytes: [1, 2, 3] }]);
    // The clip passed in is left whole: the decoder took a copy.
    expect(Array.from(backing)).toEqual([7, 1, 2, 3, 7]);
  });

  it('turns the float samples into Int16, clipped to full scale', async () => {
    stubContext([0, 0.5, -0.5, 1, -1, 2, -2]);
    expect(Array.from(await decodeOggOpus(new Uint8Array([1])))).toEqual([0, 16383, -16384, 32767, -32768, 32767, -32768]);
  });
});
