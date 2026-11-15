// The browser's decoder made into the import's audio: one 24 kHz channel of 16-bit samples, a slice at a time.
import { describe, it, expect } from 'vitest';
import { mixToInt16 } from './decode';

describe('mixing decoded channels', () => {
  it('averages the channels and scales to 16 bits, clipping beyond full scale', () => {
    const left = new Float32Array([0, 0.5, 1, -1, 2]);
    const right = new Float32Array([0, 0.5, 0, -1, 2]);
    expect([...mixToInt16([left, right], 0, 5)]).toEqual([0, 16384, 16384, -32768, 32767]);
  });

  it('takes one slice of a single channel', () => {
    expect([...mixToInt16([new Float32Array([0.1, 0.25, -0.25, 0.9])], 1, 3)]).toEqual([8192, -8192]);
  });
});
