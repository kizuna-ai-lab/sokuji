import { describe, it, expect } from 'vitest';
import { furigana, toHiragana, type JaToken } from './furigana';
import type { RubyPiece } from '../types';

const tok = (surface: string, reading: string | null, unknown = false): JaToken => ({ surface, reading, unknown });
const show = (ps: RubyPiece[]) => ps.map((p) => (p.reading ? `${p.text}(${p.reading})` : p.text)).join('');

describe('furigana', () => {
  const read = (tokens: JaToken[]) => furigana(tokens.map((t) => t.surface).join(''), tokens);

  it('puts kana on the Han runs only, okurigana bare', () => {
    expect(show(read([tok('考え直す', 'カンガエナオス'), tok('必要', 'ヒツヨウ')]))).toBe('考(かんが)え直(なお)す必要(ひつよう)');
    expect(show(read([tok('会い', 'アイ'), tok('ましょ', 'マショ'), tok('う', 'ウ')]))).toBe('会(あ)いましょう');
  });

  it('leaves kana-only tokens bare and merges them', () => {
    expect(read([tok('この', 'コノ'), tok('は', 'ハ')])).toEqual([{ text: 'このは' }]);
  });

  it('gives a token whose reading does not line up its whole reading', () => {
    expect(read([tok('明日', 'アシタ')])).toEqual([{ text: '明日', reading: 'あした' }]);
    expect(read([tok('一か月', 'イッカゲツ')])).toEqual([{ text: '一', reading: 'いっ' }, { text: 'か' }, { text: '月', reading: 'げつ' }]);
  });

  it('leaves an unknown token bare, and the whole unbroken Han run around it', () => {
    // 蒼汰: the dictionary knows 蒼 as a surname (あおい) but not 汰.
    expect(show(read([tok('蒼', 'アオイ'), tok('汰', null, true), tok('くん', 'クン')]))).toBe('蒼汰くん');
    // 𠮷野家: an unknown 𠮷 plus 野家 (のや).
    expect(show(read([tok('𠮷', null), tok('野家', 'ノヤ'), tok('に', 'ニ'), tok('行っ', 'イッ')]))).toBe('𠮷野家に行(い)っ');
  });

  it('concatenates to the input exactly', () => {
    const tokens = [tok('今日', 'キョウ'), tok('は', 'ハ'), tok('ＡＢＣ', null, true), tok('で', 'デ')];
    expect(read(tokens).map((p) => p.text).join('')).toBe('今日はＡＢＣで');
  });

  it('keeps the text the tokens leave out (Lindera drops ASCII whitespace)', () => {
    const tokens = [tok('Hello', null, true), tok('world', null, true), tok('雨', 'アメ'), tok('です', 'デス')];
    const pieces = furigana('Hello world  雨\nです', tokens);
    expect(pieces.map((p) => p.text).join('')).toBe('Hello world  雨\nです');
    expect(show(pieces)).toBe('Hello world  雨(あめ)\nです');
  });

  it('keeps leading and trailing text no token covers', () => {
    expect(furigana(' 雨 ', [tok('雨', 'アメ')])).toEqual([{ text: ' ' }, { text: '雨', reading: 'あめ' }, { text: ' ' }]);
  });

  it('breaks a Han run at a gap, so an unknown token blanks only its own side', () => {
    // Without the space, 蒼 and 汰 are one run and both go bare.
    expect(show(furigana('蒼 汰', [tok('蒼', 'アオイ'), tok('汰', null, true)]))).toBe('蒼(あおい) 汰');
  });

  it('gives the rest of the text plain once a token is not found in it', () => {
    const pieces = furigana('雨と風', [tok('雨', 'アメ'), tok('X', null, true), tok('風', 'カゼ')]);
    expect(pieces).toEqual([{ text: '雨', reading: 'あめ' }, { text: 'と風' }]);
  });
});

describe('toHiragana', () => {
  it('turns katakana into hiragana and leaves the rest', () => {
    expect(toHiragana('カンガエナオス・ヴー')).toBe('かんがえなおす・ゔー');
  });
});
