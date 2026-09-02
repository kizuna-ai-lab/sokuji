import { describe, expect, it } from 'vitest';
import { createBpeDecoder } from './bpe-decoder';

// Byte-level BPE strings use the GPT-2 byte→unicode table: 'Ġ' is a space, and the three
// UTF-8 bytes of 世 (E4 B8 96) map to 'ä', '¸', 'ĸ'; 界 (E7 95 8C) to 'ç', 'ķ', 'Į'.
const tokenizerJson = {
  model: { vocab: { Hello: 0, Ġworld: 1, 'ä¸ĸ': 2, 'çķĮ': 3, 'ä¸': 4, 'ĸ': 5, '!': 6 } },
  added_tokens: [
    { id: 9, content: '<|im_end|>' },
    { id: 10, content: '<asr_text>' },
  ],
};

describe('createBpeDecoder', () => {
  const d = createBpeDecoder(tokenizerJson);

  it('decodes ASCII tokens with the Ġ space marker', () => {
    expect(d.decode([0, 1, 6])).toBe('Hello world!');
  });

  it('reassembles multi-byte UTF-8 characters, including ones split across tokens', () => {
    expect(d.decode([2, 3])).toBe('世界');
    expect(d.decode([4, 5, 3])).toBe('世界');
  });

  it('skips added (special) tokens by default and can keep them', () => {
    expect(d.decode([0, 9])).toBe('Hello');
    expect(d.decode([0, 9, 1], { skipSpecial: false })).toBe('Hello<|im_end|> world');
  });

  it('flushes pending bytes around an unknown id instead of throwing', () => {
    expect(d.decode([2, 12345, 3])).toBe('世<unk:12345>界');
  });

  it('exposes the special-token map for callers that need ids', () => {
    expect(d.special.get(10)).toBe('<asr_text>');
  });
});
