import { describe, expect, it } from 'vitest';
import { LANGUAGE_PRIORITY } from './languages';
import { parseCode } from '../lib/language/code';

describe('the language display priority', () => {
  it('is app codes only', () => {
    for (const code of LANGUAGE_PRIORITY) expect(parseCode(code), code).not.toBeNull();
    expect(LANGUAGE_PRIORITY).toContain('fil');
    expect(LANGUAGE_PRIORITY).not.toContain('tl');
  });
});
