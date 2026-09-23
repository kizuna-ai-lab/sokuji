import { describe, it, expect } from 'vitest';
import { reanchorRanges } from './reanchor';

describe('reanchorRanges', () => {
  it('keeps ranges when the text only grew', () => {
    expect(reanchorRanges('hello', 'hello world', [[0, 5]])).toEqual([[0, 5]]);
  });

  it('moves ranges by skeleton when only punctuation and spacing changed', () => {
    // "hello world" → "Hello, world." : the range [6, 11] ("world") lands on "world."
    expect(reanchorRanges('hello world', 'Hello, world.', [[0, 5], [6, 11]])).toEqual([[0, 7], [7, 13]]);
  });

  it('drops ranges when letters changed', () => {
    expect(reanchorRanges('hello world', 'hallo world', [[0, 5], undefined])).toEqual([undefined, undefined]);
  });

  it('is a no-op on a list with no ranges', () => {
    expect(reanchorRanges('a', 'b', [undefined])).toEqual([undefined]);
  });
});
