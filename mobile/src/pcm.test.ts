import { describe, it, expect } from 'vitest';
import { floatToInt16 } from './pcm';

describe('floatToInt16', () => {
  it('maps the full range and clamps', () => {
    const out = floatToInt16(new Float32Array([-1, 0, 1, 1.5, -1.5, 0.5]));
    expect(Array.from(out)).toEqual([-32768, 0, 32767, 32767, -32768, 16383]);
  });
});
