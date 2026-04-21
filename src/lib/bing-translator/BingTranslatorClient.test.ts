import { describe, it, expect, vi } from 'vitest';
import { parseTranslatorPage, CookieJar, BingTranslatorClient } from './BingTranslatorClient';
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

type FetchCall = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
};

function makeMockFetch() {
  const calls: FetchCall[] = [];
  const queue: Array<Response | Error> = [];

  const mock: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? init.body : undefined;
    const headers: Record<string, string> = {};
    if (init?.headers) {
      const h = init.headers as Record<string, string>;
      for (const [k, v] of Object.entries(h)) headers[k] = v;
    }
    calls.push({ url, method, headers, body });

    const next = queue.shift();
    if (!next) throw new Error(`unexpected fetch to ${url} — no mock response queued`);
    if (next instanceof Error) throw next;
    return next;
  };

  return {
    fetch: mock,
    calls,
    queueResponse: (r: Response) => queue.push(r),
    queueError: (e: Error) => queue.push(e),
  };
}

function htmlResponse(body: string, setCookies: string[] = []): Response {
  const headers = new Headers({ 'content-type': 'text/html' });
  for (const c of setCookies) headers.append('set-cookie', c);
  return new Response(body, { status: 200, headers });
}

function jsonResponse(data: unknown, setCookies: string[] = []): Response {
  const headers = new Headers({ 'content-type': 'application/json' });
  for (const c of setCookies) headers.append('set-cookie', c);
  return new Response(JSON.stringify(data), { status: 200, headers });
}

describe('BingTranslatorClient', () => {
  it('fetches translator page, parses token, then translates', async () => {
    const mock = makeMockFetch();
    mock.queueResponse(htmlResponse(VALID_TRANSLATOR_HTML, ['MUID=ABC; path=/']));
    mock.queueResponse(jsonResponse([{
      translations: [{ text: 'こんにちは', to: 'ja' }],
      detectedLanguage: { language: 'en', score: 1 },
      usedLLM: true,
    }]));

    const client = new BingTranslatorClient({ fetchFn: mock.fetch });
    const result = await client.translate('Hello', 'en', 'ja');

    expect(result.translatedText).toBe('こんにちは');
    expect(result.detectedLanguage?.language).toBe('en');
    expect(result.usedLLM).toBe(true);

    expect(mock.calls).toHaveLength(2);
    expect(mock.calls[0].url).toBe('https://www.bing.com/translator');
    expect(mock.calls[1].url).toContain('/ttranslatev3?isVertical=1&IG=00A32DCAFD524DB683556A03ECA7B5B5&IID=translator.5025');
    expect(mock.calls[1].method).toBe('POST');
    expect(mock.calls[1].body).toContain('fromLang=en');
    expect(mock.calls[1].body).toContain('to=ja');
    expect(mock.calls[1].body).toContain('token=LskUa0jCLiMZEc9SdrRoytKgT-3RyAkf');
    expect(mock.calls[1].body).toContain('key=1776797443746');
    expect(mock.calls[1].headers['Cookie']).toContain('MUID=ABC');
    expect(mock.calls[1].headers['Referer']).toBe('https://www.bing.com/translator');
    expect(mock.calls[1].headers['Origin']).toBe('https://www.bing.com');
  });

  it('maps zh → zh-Hans on the wire', async () => {
    const mock = makeMockFetch();
    mock.queueResponse(htmlResponse(VALID_TRANSLATOR_HTML));
    mock.queueResponse(jsonResponse([{ translations: [{ text: '你好', to: 'zh-Hans' }] }]));

    const client = new BingTranslatorClient({ fetchFn: mock.fetch });
    await client.translate('Hello', 'en', 'zh');

    expect(mock.calls[1].body).toContain('to=zh-Hans');
  });

  it('reuses the cached token on subsequent translations', async () => {
    const mock = makeMockFetch();
    mock.queueResponse(htmlResponse(VALID_TRANSLATOR_HTML));
    mock.queueResponse(jsonResponse([{ translations: [{ text: 'a', to: 'ja' }] }]));
    mock.queueResponse(jsonResponse([{ translations: [{ text: 'b', to: 'ja' }] }]));

    const client = new BingTranslatorClient({ fetchFn: mock.fetch });
    await client.translate('hi', 'en', 'ja');
    await client.translate('bye', 'en', 'ja');

    expect(mock.calls).toHaveLength(3); // one GET, two POSTs
    expect(mock.calls[0].url).toBe('https://www.bing.com/translator');
    expect(mock.calls[1].url).toContain('ttranslatev3');
    expect(mock.calls[2].url).toContain('ttranslatev3');
  });

  it('refreshes the token when it is older than TOKEN_TTL_MS', async () => {
    const mock = makeMockFetch();
    const now = vi.fn(() => 1_000_000);
    mock.queueResponse(htmlResponse(VALID_TRANSLATOR_HTML));
    mock.queueResponse(jsonResponse([{ translations: [{ text: 'a', to: 'ja' }] }]));

    const client = new BingTranslatorClient({ fetchFn: mock.fetch, now });
    await client.translate('hi', 'en', 'ja');
    expect(mock.calls).toHaveLength(2);

    // advance clock past TTL (3.3M ms = 55 min)
    now.mockReturnValue(1_000_000 + 3_400_000);
    mock.queueResponse(htmlResponse(VALID_TRANSLATOR_HTML));
    mock.queueResponse(jsonResponse([{ translations: [{ text: 'b', to: 'ja' }] }]));
    await client.translate('bye', 'en', 'ja');

    // expect a second GET to refresh
    expect(mock.calls).toHaveLength(4);
    expect(mock.calls[2].url).toBe('https://www.bing.com/translator');
    expect(mock.calls[3].url).toContain('ttranslatev3');
  });

  it('throws BingUnsupportedLanguageError before any network call', async () => {
    const mock = makeMockFetch();
    const client = new BingTranslatorClient({ fetchFn: mock.fetch });
    await expect(client.translate('hi', 'en', 'xx')).rejects.toMatchObject({
      name: 'BingUnsupportedLanguageError',
      errorType: 'unsupported',
    });
    expect(mock.calls).toHaveLength(0);
  });
});

describe('BingTranslatorClient error paths', () => {
  it('retries with a fresh token once on a 401 error', async () => {
    const mock = makeMockFetch();
    mock.queueResponse(htmlResponse(VALID_TRANSLATOR_HTML));
    mock.queueResponse(new Response('', { status: 401 }));
    // retry path: fresh token + successful translate
    mock.queueResponse(htmlResponse(VALID_TRANSLATOR_HTML));
    mock.queueResponse(jsonResponse([{ translations: [{ text: 'retry-ok', to: 'ja' }] }]));

    const client = new BingTranslatorClient({ fetchFn: mock.fetch });
    const result = await client.translate('hi', 'en', 'ja');

    expect(result.translatedText).toBe('retry-ok');
    expect(mock.calls).toHaveLength(4);
    // 0: initial GET /translator
    // 1: POST /ttranslatev3 (401)
    // 2: refresh GET /translator
    // 3: POST /ttranslatev3 (success)
    expect(mock.calls[2].url).toBe('https://www.bing.com/translator');
    expect(mock.calls[3].url).toContain('ttranslatev3');
  });

  it('does not retry twice — a second 401 bubbles as BingTranslateError', async () => {
    const mock = makeMockFetch();
    mock.queueResponse(htmlResponse(VALID_TRANSLATOR_HTML));
    mock.queueResponse(new Response('', { status: 401 }));
    mock.queueResponse(htmlResponse(VALID_TRANSLATOR_HTML));
    mock.queueResponse(new Response('', { status: 401 }));

    const client = new BingTranslatorClient({ fetchFn: mock.fetch });
    await expect(client.translate('hi', 'en', 'ja')).rejects.toMatchObject({
      name: 'BingTranslateError',
      errorType: 'network',
    });
    expect(mock.calls).toHaveLength(4);
  });

  it('surfaces errorMessage field as BingTranslateError', async () => {
    const mock = makeMockFetch();
    mock.queueResponse(htmlResponse(VALID_TRANSLATOR_HTML));
    mock.queueResponse(jsonResponse([{ errorMessage: 'something bad' }]));

    const client = new BingTranslatorClient({ fetchFn: mock.fetch });
    await expect(client.translate('hi', 'en', 'ja')).rejects.toMatchObject({
      name: 'BingTranslateError',
      message: 'something bad',
    });
  });

  it('throws BingTranslateError on empty translations array', async () => {
    const mock = makeMockFetch();
    mock.queueResponse(htmlResponse(VALID_TRANSLATOR_HTML));
    mock.queueResponse(jsonResponse([{ translations: [] }]));

    const client = new BingTranslatorClient({ fetchFn: mock.fetch });
    await expect(client.translate('hi', 'en', 'ja')).rejects.toMatchObject({
      name: 'BingTranslateError',
    });
  });

  it('throws BingTokenFetchError on non-OK /translator response', async () => {
    const mock = makeMockFetch();
    mock.queueResponse(new Response('', { status: 503 }));

    const client = new BingTranslatorClient({ fetchFn: mock.fetch });
    await expect(client.translate('hi', 'en', 'ja')).rejects.toMatchObject({
      name: 'BingTokenFetchError',
      errorType: 'token',
    });
  });
});
