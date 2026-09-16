import { describe, it, expect } from 'vitest';
import { UnigramEncoder, moduleWords, encodeSentences, decodeWord } from './punctuation-edge-punct-en';

// Five pieces is enough to exercise the trie, the tie-break and <unk>.
const VOCAB = ['<unk>\t0', '<s>\t0', '</s>\t0', '▁the\t-1.0', '▁cat\t-2.0'].join('\r\n');

describe('edge-punct UnigramEncoder', () => {
  it('encodes a known word to its single piece', () => {
    const enc = new UnigramEncoder(VOCAB);
    expect(enc.encodeWord('the')).toEqual([3]);
  });
  it('falls back to one <unk> per byte for an uncovered word, since the vocab has no byte pieces', () => {
    const enc = new UnigramEncoder(VOCAB);
    // Six, not one: `▁zzz` is 6 UTF-8 bytes (the metaspace alone is 3), and
    // with no `<0x00>` piece in the vocab `bytesOffset` stays -1, so the
    // Viterbi walk emits an <unk> for every uncovered byte rather than
    // collapsing the word into a single one.
    expect(enc.encodeWord('zzz')).toEqual([0, 0, 0, 0, 0, 0]);
  });
});

describe('edge-punct preprocessing', () => {
  it('strips a trailing run of .,? from each word and drops emptied words', () => {
    expect(moduleWords('hello, world. ... ok?')).toEqual(['hello', 'world', 'ok']);
  });
});

describe('edge-punct batching', () => {
  it('marks only the first piece of a word valid', () => {
    const enc = new UnigramEncoder(VOCAB);
    const out = encodeSentences(enc, ['the', 'cat'], true);
    expect(out.n).toBe(1);
    expect(Array.from(out.tokenIds.slice(0, 4))).toEqual([1, 3, 4, 2]);
    expect(Array.from(out.validIds.slice(0, 4))).toEqual([1, 1, 1, 1]);
    expect(Array.from(out.labelLens)).toEqual([4]);
  });
});

describe('edge-punct decoding', () => {
  it.each([
    ['ok', 0, 0, 'ok'],
    ['ok', 1, 0, 'OK'],
    ['ok', 2, 0, 'Ok'],
    ['ok', 0, 1, 'ok,'],
    ['ok', 0, 2, 'ok.'],
    ['ok', 0, 3, 'ok?'],
    ['ok', 2, 2, 'Ok.'],
    ['ok', 3, 0, 'ok'],
  ])('decodeWord(%s, case=%i, punct=%i) -> %s', (word, c, p, expected) => {
    expect(decodeWord(word as string, c as number, p as number)).toBe(expected);
  });
});
