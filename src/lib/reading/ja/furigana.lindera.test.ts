// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { initSync, TokenizerBuilder, type Tokenizer } from 'lindera-wasm-ipadic-web';
import { furigana, type JaToken } from './furigana';
import type { RubyPiece } from '../types';

const require = createRequire(import.meta.url);
let tokenizer: Tokenizer;

beforeAll(() => {
  initSync({ module: readFileSync(require.resolve('lindera-wasm-ipadic-web/lindera_wasm_bg.wasm')) });
  const builder = new TokenizerBuilder();
  builder.setDictionary('embedded://ipadic');
  builder.setMode('normal');
  tokenizer = builder.build();
});

// The worker's own mapping (lindera.worker.ts) in miniature.
const tokenize = (text: string): JaToken[] => tokenizer.tokenize(text).map((t) => {
  const reading = t.details[7];
  const token = { surface: t.surface, reading: reading && reading !== '*' ? reading : null, unknown: t.is_unknown };
  t.free();
  return token;
});
const show = (ps: RubyPiece[]) => ps.map((p) => (p.reading ? `${p.text}(${p.reading})` : p.text)).join('');

describe('furigana over Lindera IPADIC', () => {
  it.each([
    ['この問題はまだ解決されていないので、もう一度考え直す必要があると思います。', 'この問題(もんだい)はまだ解決(かいけつ)されていないので、もう一度(いちど)考(かんが)え直(なお)す必要(ひつよう)があると思(おも)います。'],
    ['明日の午後三時に銀行の前で会いましょうか？', '明日(あした)の午後(ごご)三(さん)時(じ)に銀行(ぎんこう)の前(まえ)で会(あ)いましょうか？'],
    ['今日は生憎の雨ですね', '今日(きょう)は生憎(あいにく)の雨(あめ)ですね'],
    ['蒼汰くんが𠮷野家に行った', '蒼汰くんが𠮷野家に行(い)った'],
  ])('reads %s', (text, expected) => {
    expect(show(furigana(text, tokenize(text)))).toBe(expected);
  });

  it.each([
    ['Hello world  これは テスト です。', 'Hello world  これは テスト です。'],
    ['今日は\n雨です', '今日(きょう)は\n雨(あめ)です'],
    ['AIが ２０２６年 に', 'AIが ２０２６年(ねん) に'],
  ])('keeps the whitespace Lindera leaves out of %j', (text, expected) => {
    const pieces = furigana(text, tokenize(text));
    expect(pieces.map((p) => p.text).join('')).toBe(text);
    expect(show(pieces)).toBe(expected);
  });

  it('reads 令和 wrongly, as the spec states (IPADIC predates it)', () => {
    expect(show(furigana('令和', tokenize('令和')))).toBe('令(りょう)和(わ)');
  });
});
