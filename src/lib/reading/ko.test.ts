import { describe, it, expect } from 'vitest';
import { annotateKorean, romanizeHangul } from './ko';

// Examples from the official Revised Romanization rules, plus everyday words.
const WRITES: [string, string][] = [
  ['백마', 'baengma'], ['종로', 'jongno'], ['왕십리', 'wangsimni'], ['별내', 'byeollae'], ['신라', 'silla'],
  ['해돋이', 'haedoji'], ['같이', 'gachi'], ['굳히다', 'guchida'], ['좋고', 'joko'], ['놓다', 'nota'],
  ['잡혀', 'japyeo'], ['낳지', 'nachi'], ['한라산', 'hallasan'], ['국물', 'gungmul'], ['압구정', 'apgujeong'],
  ['낙동강', 'nakdonggang'], ['울산', 'ulsan'], ['구미', 'gumi'], ['영동', 'yeongdong'], ['백암', 'baegam'],
  ['옥천', 'okcheon'], ['합덕', 'hapdeok'], ['호법', 'hobeop'], ['월곶', 'wolgot'], ['벚꽃', 'beotkkot'],
  ['한밭', 'hanbat'], ['구리', 'guri'], ['설악', 'seorak'], ['칠곡', 'chilgok'], ['임실', 'imsil'],
  ['울릉', 'ulleung'], ['대관령', 'daegwallyeong'], ['맞히다', 'machida'], ['반갑습니다', 'bangapseumnida'],
  ['있어요', 'isseoyo'], ['회의실은', 'hoeuisireun'], ['안녕하세요', 'annyeonghaseyo'], ['감사합니다', 'gamsahamnida'],
  ['좋아', 'joa'], ['많아', 'mana'], ['싫어', 'sireo'], ['놓는', 'nonneun'], ['읽고', 'ilgo'], ['읽는', 'ingneun'],
  ['닭', 'dak'], ['값', 'gap'], ['없어', 'eopseo'], ['깨끗하다', 'kkaekkeutada'], ['밝히다', 'balkida'], ['싫네', 'sille'],
];

// The spec's stated misses, pinned as they are: n-insertion, the noun aspiration exception, names.
const STATED_MISSES: [string, string][] = [
  ['학여울', 'hagyeoul'], ['알약', 'aryak'], ['묵호', 'muko'], ['집현전', 'jipyeonjeon'], ['김민수', 'gimminsu'],
];

describe('romanizeHangul', () => {
  it.each(WRITES)('writes %s as %s', (hangul, roman) => {
    expect(romanizeHangul(hangul)).toBe(roman);
  });
  it.each(STATED_MISSES)('writes %s as %s (a stated miss)', (hangul, roman) => {
    expect(romanizeHangul(hangul)).toBe(roman);
  });
});

describe('annotateKorean', () => {
  it('gives each Hangul word one reading and leaves the rest plain', () => {
    expect(annotateKorean('같이 갈까요? KTX를 타요.')).toEqual([
      { text: '같이', reading: 'gachi' }, { text: ' ' }, { text: '갈까요', reading: 'galkkayo' },
      { text: '? KTX' }, { text: '를', reading: 'reul' }, { text: ' ' }, { text: '타요', reading: 'tayo' }, { text: '.' },
    ]);
  });
  it('concatenates to the input exactly', () => {
    const s = '삼 층에 있어요. 2층?';
    expect(annotateKorean(s).map((p) => p.text).join('')).toBe(s);
  });
});
