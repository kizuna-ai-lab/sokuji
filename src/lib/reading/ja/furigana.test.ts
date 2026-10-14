import { describe, it, expect } from 'vitest';
import { furigana, toHiragana, type JaToken } from './furigana';
import type { RubyPiece } from '../types';

const tok = (surface: string, reading: string | null, unknown = false): JaToken => ({ surface, reading, unknown });
const show = (ps: RubyPiece[]) => ps.map((p) => (p.reading ? `${p.text}(${p.reading})` : p.text)).join('');

describe('furigana', () => {
  it('puts kana on the Han runs only, okurigana bare', () => {
    expect(show(furigana([tok('考え直す', 'カンガエナオス'), tok('必要', 'ヒツヨウ')]))).toBe('考(かんが)え直(なお)す必要(ひつよう)');
    expect(show(furigana([tok('会い', 'アイ'), tok('ましょ', 'マショ'), tok('う', 'ウ')]))).toBe('会(あ)いましょう');
  });

  it('leaves kana-only tokens bare and merges them', () => {
    expect(furigana([tok('この', 'コノ'), tok('は', 'ハ')])).toEqual([{ text: 'このは' }]);
  });

  it('gives a token whose reading does not line up its whole reading', () => {
    expect(furigana([tok('明日', 'アシタ')])).toEqual([{ text: '明日', reading: 'あした' }]);
    expect(furigana([tok('一か月', 'イッカゲツ')])).toEqual([{ text: '一', reading: 'いっ' }, { text: 'か' }, { text: '月', reading: 'げつ' }]);
  });

  it('leaves an unknown token bare, and the whole unbroken Han run around it', () => {
    // 蒼汰: the dictionary knows 蒼 as a surname (あおい) but not 汰.
    expect(show(furigana([tok('蒼', 'アオイ'), tok('汰', null, true), tok('くん', 'クン')]))).toBe('蒼汰くん');
    // 𠮷野家: an unknown 𠮷 plus 野家 (のや).
    expect(show(furigana([tok('𠮷', null), tok('野家', 'ノヤ'), tok('に', 'ニ'), tok('行っ', 'イッ')]))).toBe('𠮷野家に行(い)っ');
  });

  it('concatenates to the input exactly', () => {
    const tokens = [tok('今日', 'キョウ'), tok('は', 'ハ'), tok('ＡＢＣ', null, true), tok('で', 'デ')];
    expect(furigana(tokens).map((p) => p.text).join('')).toBe('今日はＡＢＣで');
  });
});

describe('toHiragana', () => {
  it('turns katakana into hiragana and leaves the rest', () => {
    expect(toHiragana('カンガエナオス・ヴー')).toBe('かんがえなおす・ゔー');
  });
});
