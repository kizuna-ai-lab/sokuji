import { describe, it, expect } from 'vitest';
import { fillIn } from './fillIn';

describe('fillIn', () => {
  it('leaves text that already ends a sentence alone and never calls the model', async () => {
    let calls = 0;
    expect(await fillIn('en', 'Done.', async () => { calls++; return 'Done!'; })).toBe('Done.');
    expect(calls).toBe(0);
  });

  it('takes the model\'s answer when it only adds marks', async () => {
    expect(await fillIn('en', 'hello world', async () => 'Hello, world.')).toBe('Hello, world.');
  });

  it('rejects an answer that changes letters, and a null answer, and a throw', async () => {
    expect(await fillIn('en', 'hello world', async () => 'hallo world.')).toBe('hello world');
    expect(await fillIn('en', 'hello world', async () => null)).toBe('hello world');
    expect(await fillIn('en', 'hello world', async () => { throw new Error('x'); })).toBe('hello world');
  });

  it('does nothing for empty text', async () => {
    expect(await fillIn('en', '', async () => '.')).toBe('');
  });
});
