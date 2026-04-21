import { describe, it, expect } from 'vitest';
import { parseTranslatorPage } from './BingTranslatorClient';
import { VALID_TRANSLATOR_HTML, HTML_MISSING_IG, HTML_MISSING_IID, HTML_MISSING_TOKEN } from './fixtures';

describe('parseTranslatorPage', () => {
  it('extracts IG, IID, key, token from valid HTML', () => {
    const parsed = parseTranslatorPage(VALID_TRANSLATOR_HTML);
    expect(parsed.ig).toBe('00A32DCAFD524DB683556A03ECA7B5B5');
    expect(parsed.iid).toBe('translator.5025');
    expect(parsed.key).toBe('1776797443746');
    expect(parsed.token).toBe('LskUa0jCLiMZEc9SdrRoytKgT-3RyAkf');
  });

  it('throws when IG is missing', () => {
    expect(() => parseTranslatorPage(HTML_MISSING_IG)).toThrow(/IG/);
  });

  it('throws when IID is missing', () => {
    expect(() => parseTranslatorPage(HTML_MISSING_IID)).toThrow(/IID/);
  });

  it('throws when AbusePreventionHelper is missing', () => {
    expect(() => parseTranslatorPage(HTML_MISSING_TOKEN)).toThrow(/token/i);
  });
});
