import { describe, it, expect } from 'vitest';
import { annotateChinese } from './zh';
import type { RubyPiece } from './types';

const show = (ps: RubyPiece[]) => ps.map((p) => (p.reading ? `${p.text}(${p.reading})` : p.text)).join('');

describe('annotateChinese', () => {
  it('gives each Han character its syllable, polyphones read in context', () => {
    expect(show(annotateChinese('我觉得还要重新考虑一下。'))).toBe('我(wǒ)觉(jué)得(de)还(hái)要(yào)重(chóng)新(xīn)考(kǎo)虑(lǜ)一(yí)下(xià)。');
    expect(show(annotateChinese('长城和重庆'))).toBe('长(cháng)城(chéng)和(hé)重(chóng)庆(qìng)');
    expect(show(annotateChinese('在银行门口'))).toBe('在(zài)银(yín)行(háng)门(mén)口(kǒu)');
  });

  it('keeps everything that is not Han as plain text, merged', () => {
    const pieces = annotateChinese('OK，我们');
    expect(pieces[0]).toEqual({ text: 'OK，' });
    expect(pieces.slice(1).every((p) => p.reading)).toBe(true);
  });

  it('concatenates to the input exactly', () => {
    for (const s of ['张伟说他喜欢长城。', 'Hello 世界 123', '𠮷', '']) {
      expect(annotateChinese(s).map((p) => p.text).join('')).toBe(s);
    }
  });
});
