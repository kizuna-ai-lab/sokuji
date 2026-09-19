import { describe, it, expect } from 'vitest';
import { countNonWhitespace, offsetAfterNonWhitespace } from './whitespaceCursor';

describe('countNonWhitespace', () => {
  it('counts every UTF-16 unit that is not whitespace', () => {
    expect(countNonWhitespace('')).toBe(0);
    expect(countNonWhitespace('   ')).toBe(0);
    expect(countNonWhitespace(' Hello world. ')).toBe(11);
    expect(countNonWhitespace('今天天气很好。')).toBe(7);
  });

  it('treats the ideographic space and the no-break space as whitespace, as trim() does', () => {
    expect(countNonWhitespace('　今天 好')).toBe(3);
  });

  it('counts an astral character as the two units it occupies', () => {
    expect(countNonWhitespace('𠀀')).toBe(2);
    expect(countNonWhitespace(' 𠀀 好')).toBe(3);
  });
});

describe('offsetAfterNonWhitespace', () => {
  it('is 0 for a count of 0, leaving leading whitespace with the remainder', () => {
    expect(offsetAfterNonWhitespace(' Hello', 0)).toBe(0);
  });

  it('lands right after the last counted character, before any whitespace that follows it', () => {
    const text = ' Hello world. How are you';
    const offset = offsetAfterNonWhitespace(text, countNonWhitespace('Hello world.'));
    expect(text.slice(offset)).toBe(' How are you');
  });

  it('maps a cut made in an untrimmed text onto the same characters of its trimmed form', () => {
    const partial = ' 今天天气很好。我们出去走走吧';
    const final = '今天天气很好。我们出去走走吧。';
    const sealed = countNonWhitespace(partial.slice(0, ' 今天天气很好。'.length));
    expect(final.slice(offsetAfterNonWhitespace(final, sealed))).toBe('我们出去走走吧。');
  });

  it('is unaffected by whitespace the other text lacks in the middle', () => {
    const partial = ' 第一段说完了。 第二段也说完了。第三段';
    const final = '第一段说完了。第二段也说完了。第三段还在说。';
    const sealed = countNonWhitespace(partial.slice(0, ' 第一段说完了。 第二段也说完了。'.length));
    expect(final.slice(offsetAfterNonWhitespace(final, sealed))).toBe('第三段还在说。');
  });

  it('never lands inside a surrogate pair', () => {
    const text = ' 𠀀好。后面';
    const offset = offsetAfterNonWhitespace(text, countNonWhitespace('𠀀好。'));
    expect(text.slice(offset)).toBe('后面');
  });

  it('is the text length when the text holds no more than the count', () => {
    expect(offsetAfterNonWhitespace('abc', 3)).toBe(3);
    expect(offsetAfterNonWhitespace('abc', 10)).toBe(3);
    expect(offsetAfterNonWhitespace('ab  ', 5)).toBe(4);
  });
});
