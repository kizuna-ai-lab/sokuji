import { describe, expect, it } from 'vitest';
import { EDGE_TTS_LANGUAGES, WHISPER_LANGUAGES } from './languageSupport';
import { parseCode } from '../language/code';

describe('languageSupport tables', () => {
  it.each([
    ['WHISPER_LANGUAGES', WHISPER_LANGUAGES, 99],
    ['EDGE_TTS_LANGUAGES', EDGE_TTS_LANGUAGES, 75],
  ])('%s is app codes, unique, and the expected size', (_n, table, size) => {
    for (const code of table) expect(parseCode(code), code).not.toBeNull();
    expect(table).toHaveLength(size);
    expect(new Set(table).size).toBe(size);
  });
});
