import { describe, it, expect } from 'vitest';
import { parseTranslatorPage, CookieJar } from './BingTranslatorClient';
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

describe('CookieJar', () => {
  it('starts empty and emits no Cookie header', () => {
    const jar = new CookieJar();
    expect(jar.toHeader()).toBe('');
  });

  it('parses a single Set-Cookie and emits it', () => {
    const jar = new CookieJar();
    jar.ingest(['MUID=ABC123; path=/; domain=.bing.com']);
    expect(jar.toHeader()).toBe('MUID=ABC123');
  });

  it('merges multiple Set-Cookie headers', () => {
    const jar = new CookieJar();
    jar.ingest([
      'MUID=ABC; path=/',
      '_EDGE_S=F=1&SID=XYZ; HttpOnly',
    ]);
    const header = jar.toHeader();
    expect(header).toContain('MUID=ABC');
    expect(header).toContain('_EDGE_S=F=1&SID=XYZ');
    expect(header.split('; ').length).toBe(2);
  });

  it('overwrites an existing cookie on re-ingest', () => {
    const jar = new CookieJar();
    jar.ingest(['MUID=OLD; path=/']);
    jar.ingest(['MUID=NEW; path=/']);
    expect(jar.toHeader()).toBe('MUID=NEW');
  });

  it('ignores attribute-only segments (path, domain, etc.)', () => {
    const jar = new CookieJar();
    jar.ingest(['btstkn=XYZ; Path=/; Domain=.bing.com; Secure; HttpOnly']);
    expect(jar.toHeader()).toBe('btstkn=XYZ');
  });
});
