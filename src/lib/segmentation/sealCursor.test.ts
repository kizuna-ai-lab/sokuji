import { describe, it, expect } from 'vitest';
import { countSkeleton, offsetAfterSkeleton } from './sealCursor';
import { skeleton } from './sentenceEnd';

describe('countSkeleton', () => {
  it('counts letters and digits, and nothing else', () => {
    expect(countSkeleton('')).toBe(0);
    expect(countSkeleton('   ')).toBe(0);
    expect(countSkeleton('... ,,, 。「」')).toBe(0);
    expect(countSkeleton(' Hello world. ')).toBe(10);
    expect(countSkeleton('今天天气很好。')).toBe(6);
    expect(countSkeleton('Room 101!')).toBe(7);
  });

  it('is unchanged by the edits a final makes to a partial', () => {
    const partial = " Lorena and I have a wonderful family together. I'm pretty sure";
    const final = "Lorena and I have a wonderful family together I'm pretty sure";
    expect(countSkeleton(final)).toBe(countSkeleton(partial));
  });

  it('agrees with the segmentation stage’s own skeleton, counted in code points', () => {
    for (const text of ['Hello, world.', '今天天气很好。', "I'm fine", '𠮷野家', 'Room 101']) {
      expect(countSkeleton(text)).toBe([...skeleton(text)].length);
    }
  });
});

describe('offsetAfterSkeleton', () => {
  const after = (text: string, sealed: string) => text.slice(offsetAfterSkeleton(text, countSkeleton(sealed)));

  it('is 0 for a count of 0, so nothing is consumed before the first seal', () => {
    expect(offsetAfterSkeleton(' Hello', 0)).toBe(0);
  });

  it('steps over the mark and the space that ended the sealed sentence', () => {
    expect(after('First sentence done. Second begins', 'First sentence done.')).toBe('Second begins');
    expect(after('今天天气很好。我们出去走走吧', '今天天气很好。')).toBe('我们出去走走吧');
  });

  // The bug this unit was chosen for: a cursor that counts marks walks one
  // letter too far into a final that dropped one.
  it('loses no letter when the final drops a mark the partial carried', () => {
    const partial = " Lorena and I have a wonderful family together. I'm pretty sure";
    const sealed = " Lorena and I have a wonderful family together.";
    const final = "Lorena and I have a wonderful family together I'm pretty sure none of this";
    expect(after(final, sealed)).toBe("I'm pretty sure none of this");
    expect(partial.slice(sealed.length)).toBe(" I'm pretty sure"); // what the partial itself holds
  });

  // The other half of the same revision: a mark the final ADDS before the
  // seal point used to push the cursor short, leaving a "." to be sealed as
  // a bubble of its own.
  it('leaves no stray mark when the final adds one before the seal point', () => {
    const sealed = 'And so my fellow Americans, ask not what your country can do for you.';
    const final = 'And so, my fellow Americans, ask not what your country can do for you. When I was young';
    expect(after(final, sealed)).toBe('When I was young');
  });

  it('is unaffected by whitespace the final lacks at the start and at a seam', () => {
    const sealed = ' 第一段话说完了。 第二段话也说完了。';
    const final = '第一段话说完了。第二段话也说完了。第三段话正在说';
    expect(after(final, sealed)).toBe('第三段话正在说');
  });

  it('keeps an opening bracket or quote with the chunk it opens', () => {
    expect(after('他说。「你好」', '他说。')).toBe('「你好」');
    expect(after('She paused. (Later, she left.)', 'She paused.')).toBe('(Later, she left.)');
  });

  it('lands after a digit when the model path cut inside unpunctuated text', () => {
    // The model inserts a mark the raw text does not have, so the raw cut
    // falls between two digits with no mark to step over.
    expect(after('0123456789abcdef', '0123456789')).toBe('abcdef');
  });

  it('never lands inside a surrogate pair', () => {
    expect(after(' 𠮷好。后面', ' 𠮷好。')).toBe('后面');
  });

  it('consumes the whole text when it holds no more than the count', () => {
    expect(offsetAfterSkeleton('abc', 3)).toBe(3);
    expect(offsetAfterSkeleton('abc', 10)).toBe(3);
    expect(offsetAfterSkeleton('abc.  ', 3)).toBe(6);
  });
});
