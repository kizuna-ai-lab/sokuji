import { describe, expect, it } from 'vitest';
import { LANGUAGE_CODES, LANGUAGE_PRIORITY } from './languages';
import { parseCode } from '../lib/language/code';

describe('the local vocabulary', () => {
  it('is app codes only', () => {
    for (const code of LANGUAGE_CODES) expect(parseCode(code), code).not.toBeNull();
    for (const code of LANGUAGE_PRIORITY) expect(parseCode(code), code).not.toBeNull();
    expect(LANGUAGE_CODES).toContain('yue');
    expect(LANGUAGE_CODES).toContain('fil');
    expect(LANGUAGE_CODES).not.toContain('cantonese');
    expect(LANGUAGE_CODES).not.toContain('tl');
  });
});
