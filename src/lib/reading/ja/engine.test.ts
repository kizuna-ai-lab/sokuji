import { describe, it, expect } from 'vitest';
import { toJaTokens } from './engine';

describe('toJaTokens', () => {
  it("keeps a token's surface and its IPADIC reading, the eighth detail", () => {
    const details = ['名詞', '一般', '*', '*', '*', '*', '雨', 'アメ', 'アメ'];
    expect(toJaTokens([{ surface: '雨', details, isUnknown: false }])).toEqual([{ surface: '雨', reading: 'アメ', unknown: false }]);
  });

  it('gives an unknown word no reading', () => {
    const details = ['名詞', '一般', '*', '*', '*', '*', '*', '*', '*'];
    expect(toJaTokens([{ surface: '𠮷野家', details, isUnknown: true }])).toEqual([{ surface: '𠮷野家', reading: null, unknown: true }]);
  });

  it('gives a token whose entry has no reading none', () => {
    expect(toJaTokens([{ surface: '、', details: ['記号', '読点', '*', '*', '*', '*', '、'], isUnknown: false }]))
      .toEqual([{ surface: '、', reading: null, unknown: false }]);
  });
});
