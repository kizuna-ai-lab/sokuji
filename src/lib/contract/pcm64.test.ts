import { describe, it, expect } from 'vitest';
import { base64ToPcm, pcmToBase64 } from './pcm64';

const bytesOf = (b64: string) => atob(b64).split('').map((c) => c.charCodeAt(0));

describe('pcm as base64 (Stage 2 OpenAI Realtime, choice 1)', () => {
  it("encodes a view's own bytes, never its backing buffer's, little-endian", () => {
    const backing = new Int16Array([7, 1, -2, 300, 9]);
    const view = backing.subarray(1, 4);
    expect(Array.from(base64ToPcm(pcmToBase64(view)))).toEqual([1, -2, 300]);
    expect(bytesOf(pcmToBase64(new Int16Array([0x0102])))).toEqual([0x02, 0x01]);
  });

  it('round-trips pcm past one step of the encoder (over 0x8000 bytes)', () => {
    const original = new Int16Array(20_000);
    for (let i = 0; i < original.length; i++) original[i] = (i % 4001) - 2000;
    expect(Array.from(base64ToPcm(pcmToBase64(original)))).toEqual(Array.from(original));
  });

  it('drops an odd trailing byte, reads nothing as empty pcm, and throws on text that is not base64', () => {
    expect(Array.from(base64ToPcm(btoa('\x01\x00\x02\x00\x03')))).toEqual([1, 2]);
    expect(base64ToPcm('')).toHaveLength(0);
    expect(pcmToBase64(new Int16Array(0))).toBe('');
    expect(() => base64ToPcm('!!not base64!!')).toThrow();
  });
});
