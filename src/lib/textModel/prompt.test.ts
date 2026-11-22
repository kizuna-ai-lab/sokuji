import { describe, it, expect } from 'vitest';
import { translationOf } from './prompt';

describe('the translation read from an answer', () => {
  it('leaves out a reasoning model\'s thinking before it', () => {
    expect(translationOf('<think>ok</think> Hello.')).toBe('Hello.');
    expect(translationOf('  Hello.  ')).toBe('Hello.');
  });

  it('is nothing when the answer was cut short inside the thinking', () => {
    expect(translationOf('<think>Let me consider the honorifics here and')).toBe('');
  });
});
