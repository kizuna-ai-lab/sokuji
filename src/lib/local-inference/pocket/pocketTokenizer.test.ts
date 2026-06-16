import { describe, it, expect, vi } from 'vitest';

// Mock the vendored SentencePiece with a deterministic fake.
vi.mock('./sentencepiece.js', () => {
  class SentencePieceProcessor {
    loaded = false;
    async loadFromB64StringModel(_b64: string) { this.loaded = true; }
    encodeIds(text: string): number[] {
      // Deterministic stand-in: one id per char code, offset by 3.
      return Array.from(text).map((c) => c.charCodeAt(0) + 3);
    }
  }
  return { SentencePieceProcessor };
});

import { PocketTokenizer } from './pocketTokenizer';

describe('PocketTokenizer', () => {
  it('loads a model buffer and encodes text to bigint ids', async () => {
    const tok = new PocketTokenizer();
    await tok.load(new Uint8Array([1, 2, 3]).buffer);
    const ids = tok.encodeIds('AB');
    expect(ids).toEqual([68n, 69n]); // 'A'=65+3, 'B'=66+3
    expect(ids.every((x) => typeof x === 'bigint')).toBe(true);
  });

  it('throws if used before load', () => {
    const tok = new PocketTokenizer();
    expect(() => tok.encodeIds('x')).toThrow(/not loaded/i);
  });
});
