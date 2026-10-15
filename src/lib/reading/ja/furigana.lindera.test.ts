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

  // IPADIC reads a numeral and its counter piece by piece (三日 さん にち, 4月 つき).
  it.each([
    ['一人で行く', '一人(ひとり)で行(い)く'],
    ['二人で行く', '二人(ふたり)で行(い)く'],
    ['4人います', '4人(よにん)います'],
    ['一人一人', '一人(ひとり)一人(ひとり)'],
    ['一人目', '一人(ひとり)目(め)'],
    ['十一人', '十(じゅう)一(いち)人(にん)'],
    ['三人で', '三(さん)人(にん)で'],
    ['四月一日は休みです', '四月(しがつ)一日(ついたち)は休(やす)みです'],
    ['4月1日に会う', '4月(しがつ)1日(ついたち)に会(あ)う'],
    ['毎月1日', '毎月(まいつき)1日(ついたち)'],
    ['一日中寝ていた', '一(いち)日(にち)中(ちゅう)寝(ね)ていた'],
    ['3日', '3日(みっか)'],
    ['二十日', '二十日(はつか)'],
    ['14日', '14日(じゅうよっか)'],
    ['十一日', '十(じゅう)一(いち)日(にち)'],
    ['三日間', '三日間(みっかかん)'],
    ['9月', '9月(くがつ)'],
    ['二十歳になった', '二十歳(はたち)になった'],
    ['２０歳', '２０歳(はたち)'],
    ['1 人', '1 人(ひと)'], // not merged across the space
  ])('reads the counter in %s by its number', (text, expected) => {
    expect(show(furigana(text, tokenize(text)))).toBe(expected);
  });

  // IPADIC reads 空く by its あく entry whatever precedes it.
  it.each([
    ['お腹が空いた', 'お腹(なか)が空(す)いた'],
    ['お腹空いてない？', 'お腹(なか)空(す)いてない？'],
    ['お腹が空きました', 'お腹(なか)が空(す)きました'],
    ['腹が空いた', '腹(はら)が空(す)いた'],
    ['席が空いた', '席(せき)が空(あ)いた'],
  ])('reads 空く in %s by what is empty', (text, expected) => {
    expect(show(furigana(text, tokenize(text)))).toBe(expected);
  });

  it.each([
    ['電車が空いている', '電車(でんしゃ)が空(あ)いている'],
    ['このカレーは辛い', 'このカレーは辛(つら)い'],
    ['その方がいい', 'その方(ほう)がいい'],
  ])('leaves what only the meaning settles to IPADIC, as the spec states: %s', (text, expected) => {
    expect(show(furigana(text, tokenize(text)))).toBe(expected);
  });
});
