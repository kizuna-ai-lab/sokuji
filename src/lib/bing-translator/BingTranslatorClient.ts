// BingTranslatorClient — unofficial Bing Translator access.
// Scrapes the /translator HTML for an anti-abuse token, then POSTs to /ttranslatev3.
// Token TTL is 1 hour; we refresh proactively 5 minutes before expiry.

export interface ParsedTranslatorPage {
  ig: string;
  iid: string;
  key: string;
  token: string;
}

export function parseTranslatorPage(html: string): ParsedTranslatorPage {
  const ig = html.match(/IG:"([0-9A-Fa-f]+)"/)?.[1];
  if (!ig) throw new BingTokenFetchError('could not find IG in translator page');

  const iid = html.match(/data-iid="([^"]+)"/)?.[1];
  if (!iid) throw new BingTokenFetchError('could not find IID in translator page');

  const abuseMatch = html.match(
    /params_AbusePreventionHelper\s*=\s*\[\s*(\d+)\s*,\s*"([^"]+)"\s*,\s*\d+\s*\]/
  );
  if (!abuseMatch) {
    throw new BingTokenFetchError('could not find token (params_AbusePreventionHelper) in translator page');
  }

  return { ig, iid, key: abuseMatch[1], token: abuseMatch[2] };
}

export class BingTokenFetchError extends Error {
  readonly errorType = 'token' as const;
  constructor(message: string) {
    super(message);
    this.name = 'BingTokenFetchError';
  }
}

export class BingUnsupportedLanguageError extends Error {
  readonly errorType = 'unsupported' as const;
  constructor(message: string) {
    super(message);
    this.name = 'BingUnsupportedLanguageError';
  }
}

export class BingTranslateError extends Error {
  readonly errorType = 'network' as const;
  constructor(message: string) {
    super(message);
    this.name = 'BingTranslateError';
  }
}

/**
 * Minimal cookie jar for the Bing flow. Stores only name=value; all other
 * attributes (path, domain, expires, HttpOnly, etc.) are discarded.
 * Enough for the subset of behavior Bing's endpoint requires.
 */
export class CookieJar {
  private readonly entries = new Map<string, string>();

  ingest(setCookieHeaders: readonly string[]): void {
    for (const raw of setCookieHeaders) {
      if (!raw) continue;
      const firstPair = raw.split(';', 1)[0]?.trim();
      if (!firstPair) continue;
      const eqIdx = firstPair.indexOf('=');
      if (eqIdx <= 0) continue;
      const name = firstPair.slice(0, eqIdx).trim();
      const value = firstPair.slice(eqIdx + 1).trim();
      if (!name) continue;
      this.entries.set(name, value);
    }
  }

  toHeader(): string {
    if (this.entries.size === 0) return '';
    const parts: string[] = [];
    for (const [name, value] of this.entries) {
      parts.push(`${name}=${value}`);
    }
    return parts.join('; ');
  }
}

import { mapToBingCode, isSupportedByBing } from './languageMap';

export interface BingTranslateResult {
  translatedText: string;
  detectedLanguage?: { language: string; score: number };
  usedLLM?: boolean;
  inferenceTimeMs: number;
}

export interface BingTranslatorClientOptions {
  fetchFn?: typeof fetch;
  now?: () => number;
  userAgent?: string;
  fetchTimeoutMs?: number;
}

const DEFAULT_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const TOKEN_TTL_MS = 3_300_000;   // 55 min (Bing advertises 1h; we refresh early)
const DEFAULT_TIMEOUT = 12_000;

export class BingTranslatorClient {
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;
  private readonly userAgent: string;
  private readonly fetchTimeoutMs: number;

  private ig: string | null = null;
  private iid: string | null = null;
  private key: string | null = null;
  private token: string | null = null;
  private tokenFetchedAt = 0;
  private readonly cookies = new CookieJar();

  constructor(options: BingTranslatorClientOptions = {}) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.now = options.now ?? (() => Date.now());
    this.userAgent = options.userAgent ?? DEFAULT_UA;
    this.fetchTimeoutMs = options.fetchTimeoutMs ?? DEFAULT_TIMEOUT;
  }

  async translate(text: string, from: string, to: string): Promise<BingTranslateResult> {
    if (!isSupportedByBing(from)) {
      throw new BingUnsupportedLanguageError(`source language not supported: ${from}`);
    }
    if (!isSupportedByBing(to)) {
      throw new BingUnsupportedLanguageError(`target language not supported: ${to}`);
    }

    const start = this.now();
    if (this.isTokenExpired()) {
      await this.refreshToken();
    }

    try {
      return await this.doTranslate(text, from, to, start);
    } catch (err) {
      if (err instanceof BingTranslateError && this.looksLikeTokenError(err.message)) {
        // single retry with a fresh token
        await this.refreshToken();
        return await this.doTranslate(text, from, to, start);
      }
      throw err;
    }
  }

  private isTokenExpired(): boolean {
    if (!this.token) return true;
    return this.now() - this.tokenFetchedAt > TOKEN_TTL_MS;
  }

  private looksLikeTokenError(msg: string): boolean {
    return /token|unauthori[sz]ed|401|403/i.test(msg);
  }

  private async refreshToken(): Promise<void> {
    const url = 'https://www.bing.com/translator';
    const res = await this.fetchWithTimeout(url, {
      method: 'GET',
      headers: {
        'User-Agent': this.userAgent,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    if (!res.ok) {
      throw new BingTokenFetchError(`translator page request failed: ${res.status}`);
    }
    const setCookies = readSetCookies(res);
    this.cookies.ingest(setCookies);

    const html = await res.text();
    const parsed = parseTranslatorPage(html);
    this.ig = parsed.ig;
    this.iid = parsed.iid;
    this.key = parsed.key;
    this.token = parsed.token;
    this.tokenFetchedAt = this.now();
  }

  private async doTranslate(
    text: string,
    from: string,
    to: string,
    startTime: number,
  ): Promise<BingTranslateResult> {
    if (!this.ig || !this.iid || !this.key || !this.token) {
      throw new BingTokenFetchError('missing token state after refresh');
    }

    const url = `https://www.bing.com/ttranslatev3?isVertical=1&IG=${this.ig}&IID=${this.iid}`;
    const body = new URLSearchParams({
      fromLang: mapToBingCode(from),
      text,
      to: mapToBingCode(to),
      token: this.token,
      key: this.key,
    });

    const res = await this.fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'User-Agent': this.userAgent,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        Referer: 'https://www.bing.com/translator',
        Origin: 'https://www.bing.com',
        Cookie: this.cookies.toHeader(),
      },
      body: body.toString(),
    });
    this.cookies.ingest(readSetCookies(res));

    if (!res.ok) {
      throw new BingTranslateError(`translate request failed: HTTP ${res.status}`);
    }
    const json = await res.json().catch(() => null) as unknown;
    if (!Array.isArray(json) || json.length === 0) {
      throw new BingTranslateError('unexpected response shape (not array)');
    }
    const first = json[0] as {
      translations?: Array<{ text?: string; to?: string }>;
      detectedLanguage?: { language: string; score: number };
      usedLLM?: boolean;
      errorMessage?: string;
    };
    if (first.errorMessage) {
      throw new BingTranslateError(first.errorMessage);
    }
    const translation = first.translations?.[0]?.text;
    if (typeof translation !== 'string' || translation.length === 0) {
      throw new BingTranslateError('empty translations[]');
    }
    return {
      translatedText: translation,
      detectedLanguage: first.detectedLanguage,
      usedLLM: first.usedLLM,
      inferenceTimeMs: this.now() - startTime,
    };
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), this.fetchTimeoutMs);
    try {
      return await this.fetchFn(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(t);
    }
  }
}

function readSetCookies(res: Response): string[] {
  // Headers.getSetCookie() is standard in Node >=18 and modern browsers; fall back to get().
  const h = res.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof h.getSetCookie === 'function') return h.getSetCookie();
  const raw = res.headers.get('set-cookie');
  return raw ? [raw] : [];
}
