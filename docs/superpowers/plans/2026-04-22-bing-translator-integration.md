# Bing Translator Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Microsoft Bing Translator as a free, cloud-based translation engine inside the `LOCAL_INFERENCE` provider (the translation-side counterpart to Edge TTS), so low-end devices can keep ASR local while offloading translation off-device.

**Architecture:** A new `BingTranslatorClient` handles the unofficial Bing auth flow (scrape `bing.com/translator` for IG/IID/token, then POST to `ttranslatev3`). It runs inside an ES-module Web Worker plugged into the existing `TranslationEngine` via a new `translationWorkerType: 'bing'` branch. Platform-level header injection (Electron `webRequest`, Extension `declarativeNetRequest`) gets new HTTP rules for `www.bing.com`. A new manifest entry with `isCloudModel: true` makes `TranslationEngine` skip the model-download check. Error surfacing reuses the existing `onError` → conversation error-bubble path; the only new logic is mapping worker `errorType` strings to human-readable messages.

**Tech Stack:** TypeScript, Vitest, Zustand (unchanged), Vite's ES-module workers, Electron `session.webRequest.onBeforeSendHeaders`, Chrome `declarativeNetRequest`.

---

## Spec Corrections (against `2026-04-22-bing-translator-integration-design.md`)

The spec described the manifest field as `engine: 'bing'` and the worker path as `public/workers/bing-translation.worker.js`. After verifying the actual codebase, the correct shape is:

- `translationWorkerType: 'bing'` (the `engine` field is typed `TtsEngineType`, TTS-only — adding `'bing'` there would be type-incorrect)
- Worker at `src/lib/local-inference/workers/bing-translation.worker.ts` (ES module, matches `qwen35-translation.worker.ts` et al.)
- Electron hook is WebSocket-only; Bing needs a **separate HTTP path** in the same handler in `electron/main.js`
- Extension DNR for Edge TTS targets `['websocket']`; Bing needs a **new rule** with `['xmlhttprequest']`, plus `https://www.bing.com/*` added to `extension/manifest.json` `host_permissions`

No existing Translation proto panel exists; smoke testing is manual end-to-end.

---

## File Structure

**New files:**

| Path | Responsibility |
| ---- | -------------- |
| `src/lib/bing-translator/languageMap.ts` | Pure ISO-639-1 → Bing language code map; exported `mapToBingCode`, `isSupportedByBing`, `BING_SUPPORTED_LANGUAGES`. No deps. |
| `src/lib/bing-translator/languageMap.test.ts` | Unit tests for the map. |
| `src/lib/bing-translator/fixtures.ts` | Test-only fixture HTML snippets for parser tests. |
| `src/lib/bing-translator/BingTranslatorClient.ts` | Core auth + translate class: token lifecycle, HTML parsing, cookie jar, single retry on token-invalid, network timeouts. Pure (injectable fetch). |
| `src/lib/bing-translator/BingTranslatorClient.test.ts` | Unit tests with mocked `fetch`. |
| `src/lib/bing-translator/index.ts` | Barrel export. |
| `src/lib/local-inference/workers/bing-translation.worker.ts` | Thin worker wrapper: receives `init` / `translate` / `dispose` messages, delegates to `BingTranslatorClient`. No tests (thin adapter). |

**Modified files:**

| Path | Change |
| ---- | ------ |
| `src/lib/local-inference/modelManifest.ts` | Extend `translationWorkerType` union with `'bing'`; insert `bing-translator` manifest entry next to the Qwen 3.5 entries. |
| `src/lib/local-inference/engine/TranslationEngine.ts` | Short-circuit on `entry.isCloudModel` to skip the download check; add `case 'bing':` to the worker switch. |
| `src/services/clients/LocalInferenceClient.ts` | In the pipeline `catch`, map `errorType` on Bing-origin errors to a human-readable message before pushing the `type: 'error'` conversation item. |
| `src/components/Settings/sections/ModelManagementSection.tsx` | Verify the `isCloudModel` render path works for `type: 'translation'`. (Already generic per exploration; no change expected — this is a verification step.) |
| `electron/main.js` | Add an HTTP branch in the existing `onBeforeSendHeaders` handler: for `www.bing.com/translator` and `www.bing.com/ttranslatev3`, set browser-like User-Agent, Origin, Referer, Accept-Language. |
| `extension/background/background.js` | Add a second DNR rule (distinct ID) targeting `||www.bing.com` with `resourceTypes: ['xmlhttprequest']` and the same header overrides. |
| `extension/manifest.json` | Add `https://www.bing.com/*` to `host_permissions`. |

---

## Implementation Notes for the Engineer

- **You are writing TypeScript.** Run `npx tsc --noEmit` before each commit that touches TS to catch type errors.
- **Tests use Vitest**, not Jest. Import from `vitest`. Run with `npm run test -- <path>` for a single file.
- **No emojis in code.** CLAUDE.md forbids decorative emojis in source code.
- **English only** for all code comments and identifiers.
- **Use `fetch` directly in `BingTranslatorClient`.** Make it injectable (constructor param with a default of the global) so tests can pass in a stub.
- **Do not make git commits with `--no-verify`.** Hooks are there for a reason.
- When a step says "Expected: ...", read the actual output. If it doesn't match, stop and diagnose — do not force the next step to run.

---

## Task 1: Language Code Mapping (TDD)

**Files:**
- Create: `src/lib/bing-translator/languageMap.ts`
- Create: `src/lib/bing-translator/languageMap.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/bing-translator/languageMap.test.ts` with:

```typescript
import { describe, it, expect } from 'vitest';
import { mapToBingCode, isSupportedByBing, BING_SUPPORTED_LANGUAGES } from './languageMap';

describe('languageMap', () => {
  describe('mapToBingCode', () => {
    it('passes through common ISO codes unchanged', () => {
      expect(mapToBingCode('en')).toBe('en');
      expect(mapToBingCode('ja')).toBe('ja');
      expect(mapToBingCode('ko')).toBe('ko');
      expect(mapToBingCode('fr')).toBe('fr');
      expect(mapToBingCode('de')).toBe('de');
      expect(mapToBingCode('es')).toBe('es');
    });

    it('maps bare "zh" to "zh-Hans" (simplified Chinese default)', () => {
      expect(mapToBingCode('zh')).toBe('zh-Hans');
    });

    it('maps "zh-CN" to "zh-Hans" and "zh-TW" to "zh-Hant"', () => {
      expect(mapToBingCode('zh-CN')).toBe('zh-Hans');
      expect(mapToBingCode('zh-TW')).toBe('zh-Hant');
    });

    it('lowercases then looks up — case-insensitive input', () => {
      expect(mapToBingCode('EN')).toBe('en');
      expect(mapToBingCode('Zh-Cn')).toBe('zh-Hans');
    });

    it('throws for unsupported codes', () => {
      expect(() => mapToBingCode('xx')).toThrow(/unsupported/i);
    });
  });

  describe('isSupportedByBing', () => {
    it('returns true for supported codes', () => {
      expect(isSupportedByBing('en')).toBe(true);
      expect(isSupportedByBing('zh')).toBe(true);
      expect(isSupportedByBing('ja')).toBe(true);
    });

    it('returns false for unsupported codes', () => {
      expect(isSupportedByBing('xx')).toBe(false);
      expect(isSupportedByBing('')).toBe(false);
    });
  });

  describe('BING_SUPPORTED_LANGUAGES', () => {
    it('contains the commonly-used languages', () => {
      for (const code of ['en', 'ja', 'zh', 'ko', 'fr', 'de', 'es', 'ru', 'pt', 'it', 'ar', 'hi', 'th', 'vi']) {
        expect(BING_SUPPORTED_LANGUAGES).toContain(code);
      }
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/lib/bing-translator/languageMap.test.ts`
Expected: FAIL — "Cannot find module './languageMap'".

- [ ] **Step 3: Implement the module**

Create `src/lib/bing-translator/languageMap.ts` with:

```typescript
// Maps ISO-639-1 (and common BCP-47 subtags) to Bing Translator's language codes.
// Most codes pass through unchanged; the overrides below capture the known exceptions.

const BING_LANGUAGE_OVERRIDES: Record<string, string> = {
  'zh': 'zh-Hans',
  'zh-cn': 'zh-Hans',
  'zh-tw': 'zh-Hant',
  'zh-hk': 'zh-Hant',
};

// Curated list of Bing-supported language ISO codes (the codes we accept as *input*,
// before mapping). Covers the main language pairs users request. Extend as needed.
export const BING_SUPPORTED_LANGUAGES: readonly string[] = [
  'af', 'ar', 'bg', 'bn', 'bs', 'ca', 'cs', 'cy', 'da', 'de',
  'el', 'en', 'es', 'et', 'fa', 'fi', 'fil', 'fj', 'fr', 'ga',
  'he', 'hi', 'hr', 'ht', 'hu', 'id', 'is', 'it', 'ja', 'kk',
  'km', 'ko', 'lt', 'lv', 'mg', 'ml', 'mr', 'ms', 'mt', 'mww',
  'my', 'nb', 'nl', 'or', 'otq', 'pa', 'pl', 'pt', 'ro', 'ru',
  'sk', 'sl', 'sm', 'sr', 'sv', 'sw', 'ta', 'te', 'th', 'tlh',
  'to', 'tr', 'ty', 'uk', 'ur', 'vi', 'yua', 'yue',
  'zh', 'zh-cn', 'zh-tw', 'zh-hk',
];

const SUPPORTED_SET = new Set(BING_SUPPORTED_LANGUAGES.map(c => c.toLowerCase()));

export function isSupportedByBing(isoCode: string): boolean {
  if (!isoCode) return false;
  return SUPPORTED_SET.has(isoCode.toLowerCase());
}

export function mapToBingCode(isoCode: string): string {
  const lower = (isoCode || '').toLowerCase();
  if (!SUPPORTED_SET.has(lower)) {
    throw new Error(`unsupported language code: "${isoCode}"`);
  }
  return BING_LANGUAGE_OVERRIDES[lower] ?? lower;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/lib/bing-translator/languageMap.test.ts`
Expected: 4 passing test blocks (13 assertions), 0 failures.

Also run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/bing-translator/languageMap.ts src/lib/bing-translator/languageMap.test.ts
git commit -m "feat(bing-translator): language code mapping (ISO → Bing)"
```

---

## Task 2: HTML Fixtures and Parser (TDD)

**Files:**
- Create: `src/lib/bing-translator/fixtures.ts`
- Create: `src/lib/bing-translator/BingTranslatorClient.ts`
- Create: `src/lib/bing-translator/BingTranslatorClient.test.ts`

- [ ] **Step 1: Create fixture HTML**

Create `src/lib/bing-translator/fixtures.ts`:

```typescript
// Minimal HTML snippets used by BingTranslatorClient tests.
// Based on the shape observed in the proto run against live www.bing.com/translator.

export const VALID_TRANSLATOR_HTML = `
<!DOCTYPE html>
<html><head><title>Bing Translator</title></head>
<body>
  <div data-iid="translator.5025"></div>
  <script>
    var somethingElse = 1;
    var _G = {IG:"00000000000000000000000000000000"};
    var params_AbusePreventionHelper = [ 1000000000000, "TEST_TOKEN_DO_NOT_USE", 3600000 ];
  </script>
</body></html>
`.trim();

export const HTML_MISSING_IG = VALID_TRANSLATOR_HTML.replace(/IG:"[0-9A-F]+"/, 'IG:""');
export const HTML_MISSING_IID = VALID_TRANSLATOR_HTML.replace(/data-iid="[^"]+"/, 'data-iid=""');
export const HTML_MISSING_TOKEN = VALID_TRANSLATOR_HTML.replace(/params_AbusePreventionHelper[\s\S]*?\];/, '');
```

- [ ] **Step 2: Write the failing parser test**

Create `src/lib/bing-translator/BingTranslatorClient.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseTranslatorPage } from './BingTranslatorClient';
import { VALID_TRANSLATOR_HTML, HTML_MISSING_IG, HTML_MISSING_IID, HTML_MISSING_TOKEN } from './fixtures';

describe('parseTranslatorPage', () => {
  it('extracts IG, IID, key, token from valid HTML', () => {
    const parsed = parseTranslatorPage(VALID_TRANSLATOR_HTML);
    expect(parsed.ig).toBe('00000000000000000000000000000000');
    expect(parsed.iid).toBe('translator.5025');
    expect(parsed.key).toBe('1000000000000');
    expect(parsed.token).toBe('TEST_TOKEN_DO_NOT_USE');
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
```

- [ ] **Step 3: Run to verify fail**

Run: `npm run test -- src/lib/bing-translator/BingTranslatorClient.test.ts`
Expected: FAIL — "Cannot find module './BingTranslatorClient'".

- [ ] **Step 4: Implement the parser**

Create `src/lib/bing-translator/BingTranslatorClient.ts`:

```typescript
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
  const ig = html.match(/IG:"([0-9A-F]+)"/)?.[1];
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
```

- [ ] **Step 5: Run tests**

Run: `npm run test -- src/lib/bing-translator/BingTranslatorClient.test.ts`
Expected: 4 passing, 0 failing.

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/bing-translator/fixtures.ts src/lib/bing-translator/BingTranslatorClient.ts src/lib/bing-translator/BingTranslatorClient.test.ts
git commit -m "feat(bing-translator): translator-page HTML parser + error classes"
```

---

## Task 3: Cookie Jar (TDD)

**Files:**
- Modify: `src/lib/bing-translator/BingTranslatorClient.ts`
- Modify: `src/lib/bing-translator/BingTranslatorClient.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `src/lib/bing-translator/BingTranslatorClient.test.ts`:

```typescript
import { CookieJar } from './BingTranslatorClient';

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
```

- [ ] **Step 2: Run to verify fail**

Run: `npm run test -- src/lib/bing-translator/BingTranslatorClient.test.ts`
Expected: FAIL — "CookieJar" is not a constructor / module does not export.

- [ ] **Step 3: Implement CookieJar**

Append to `src/lib/bing-translator/BingTranslatorClient.ts`:

```typescript
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
```

- [ ] **Step 4: Run tests**

Run: `npm run test -- src/lib/bing-translator/BingTranslatorClient.test.ts`
Expected: 4 parser tests + 5 jar tests all pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/bing-translator/BingTranslatorClient.ts src/lib/bing-translator/BingTranslatorClient.test.ts
git commit -m "feat(bing-translator): minimal cookie jar"
```

---

## Task 4: BingTranslatorClient Class — Token Lifecycle + translate() (TDD)

**Files:**
- Modify: `src/lib/bing-translator/BingTranslatorClient.ts`
- Modify: `src/lib/bing-translator/BingTranslatorClient.test.ts`

- [ ] **Step 1: Write failing tests for the client class**

Append to `src/lib/bing-translator/BingTranslatorClient.test.ts`:

```typescript
import { vi, beforeEach } from 'vitest';
import { BingTranslatorClient } from './BingTranslatorClient';

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
    expect(mock.calls[1].url).toContain('/ttranslatev3?isVertical=1&IG=00000000000000000000000000000000&IID=translator.5025');
    expect(mock.calls[1].method).toBe('POST');
    expect(mock.calls[1].body).toContain('fromLang=en');
    expect(mock.calls[1].body).toContain('to=ja');
    expect(mock.calls[1].body).toContain('token=TEST_TOKEN_DO_NOT_USE');
    expect(mock.calls[1].body).toContain('key=1000000000000');
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
```

- [ ] **Step 2: Run to verify fail**

Run: `npm run test -- src/lib/bing-translator/BingTranslatorClient.test.ts`
Expected: FAIL — `BingTranslatorClient` is not a constructor.

- [ ] **Step 3: Implement BingTranslatorClient class**

Append to `src/lib/bing-translator/BingTranslatorClient.ts`:

```typescript
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
```

- [ ] **Step 4: Run tests**

Run: `npm run test -- src/lib/bing-translator/BingTranslatorClient.test.ts`
Expected: parser (4) + jar (5) + client (5) = 14 passing, 0 failing.

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/bing-translator/BingTranslatorClient.ts src/lib/bing-translator/BingTranslatorClient.test.ts
git commit -m "feat(bing-translator): BingTranslatorClient with token lifecycle + translate()"
```

---

## Task 5: Error Paths — Token Retry, Timeout, Bad Responses (TDD)

**Files:**
- Modify: `src/lib/bing-translator/BingTranslatorClient.test.ts`

- [ ] **Step 1: Add failing error-path tests**

Append to `src/lib/bing-translator/BingTranslatorClient.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run tests — expect pass**

Run: `npm run test -- src/lib/bing-translator/BingTranslatorClient.test.ts`
Expected: all new tests pass (the retry behavior was already implemented in Task 4; this task hardens the test coverage).

If any test fails, inspect the `translate()` / `doTranslate()` / `looksLikeTokenError()` logic — do not skip.

- [ ] **Step 3: Commit**

```bash
git add src/lib/bing-translator/BingTranslatorClient.test.ts
git commit -m "test(bing-translator): error-path coverage for retry, errorMessage, empty translations"
```

---

## Task 6: Barrel Export

**Files:**
- Create: `src/lib/bing-translator/index.ts`

- [ ] **Step 1: Create index**

Create `src/lib/bing-translator/index.ts`:

```typescript
export {
  BingTranslatorClient,
  BingTokenFetchError,
  BingUnsupportedLanguageError,
  BingTranslateError,
  CookieJar,
  parseTranslatorPage,
} from './BingTranslatorClient';
export type { BingTranslateResult, BingTranslatorClientOptions, ParsedTranslatorPage } from './BingTranslatorClient';
export { mapToBingCode, isSupportedByBing, BING_SUPPORTED_LANGUAGES } from './languageMap';
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/bing-translator/index.ts
git commit -m "feat(bing-translator): barrel export"
```

---

## Task 7: Worker Wrapper

**Files:**
- Create: `src/lib/local-inference/workers/bing-translation.worker.ts`

- [ ] **Step 1: Read one existing translation worker for protocol alignment**

Run: `cat src/lib/local-inference/workers/translation.worker.ts | head -80`

Note the message-protocol shape (`init`, `translate`, `dispose` → `ready`, `translation-result`, `error`) and the field names `id`, `sourceText`, `translatedText`, `inferenceTimeMs`, `systemPrompt`. Use the same field names in the Bing worker.

- [ ] **Step 2: Create the Bing worker**

Create `src/lib/local-inference/workers/bing-translation.worker.ts`:

```typescript
/// <reference lib="webworker" />
// Thin worker wrapper around BingTranslatorClient. Mirrors the message protocol
// used by the other translation workers in this directory, with extra fields
// for Bing-specific diagnostics (detectedLanguage, usedLLM).

import {
  BingTranslatorClient,
  BingTokenFetchError,
  BingUnsupportedLanguageError,
  BingTranslateError,
} from '../../bing-translator';

type InMessage =
  | { type: 'init'; sourceLang: string; targetLang: string }
  | { type: 'translate'; id: string; text: string; systemPrompt?: string; wrapTranscript?: boolean }
  | { type: 'dispose' };

type OutMessage =
  | { type: 'ready'; device: 'cloud'; loadTimeMs: number }
  | {
      type: 'translation-result';
      id: string;
      sourceText: string;
      translatedText: string;
      inferenceTimeMs: number;
      detectedLanguage?: { language: string; score: number };
      usedLLM?: boolean;
    }
  | {
      type: 'error';
      id?: string;
      errorType: 'token' | 'unsupported' | 'network' | 'unknown';
      message: string;
    };

let client: BingTranslatorClient | null = null;
let sourceLang = '';
let targetLang = '';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

function post(msg: OutMessage) {
  ctx.postMessage(msg);
}

ctx.onmessage = async (event: MessageEvent<InMessage>) => {
  const msg = event.data;
  switch (msg.type) {
    case 'init': {
      const start = performance.now();
      sourceLang = msg.sourceLang;
      targetLang = msg.targetLang;
      client = new BingTranslatorClient();
      post({ type: 'ready', device: 'cloud', loadTimeMs: performance.now() - start });
      break;
    }

    case 'translate': {
      if (!client) {
        post({
          type: 'error',
          id: msg.id,
          errorType: 'unknown',
          message: 'worker not initialized',
        });
        return;
      }
      try {
        const result = await client.translate(msg.text, sourceLang, targetLang);
        post({
          type: 'translation-result',
          id: msg.id,
          sourceText: msg.text,
          translatedText: result.translatedText,
          inferenceTimeMs: result.inferenceTimeMs,
          detectedLanguage: result.detectedLanguage,
          usedLLM: result.usedLLM,
        });
      } catch (err) {
        post({
          type: 'error',
          id: msg.id,
          errorType: classifyError(err),
          message: err instanceof Error ? err.message : String(err),
        });
      }
      break;
    }

    case 'dispose': {
      client = null;
      break;
    }
  }
};

function classifyError(err: unknown): 'token' | 'unsupported' | 'network' | 'unknown' {
  if (err instanceof BingTokenFetchError) return 'token';
  if (err instanceof BingUnsupportedLanguageError) return 'unsupported';
  if (err instanceof BingTranslateError) return 'network';
  return 'unknown';
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: 0 errors. If the worker complains about DOM lib missing, ensure the `/// <reference lib="webworker" />` directive is on line 1.

- [ ] **Step 4: Commit**

```bash
git add src/lib/local-inference/workers/bing-translation.worker.ts
git commit -m "feat(bing-translator): worker wrapper with standard translation message protocol"
```

---

## Task 8: Manifest Entry + Type Union Update

**Files:**
- Modify: `src/lib/local-inference/modelManifest.ts` (around line 115 and line 2820)

- [ ] **Step 1: Extend `translationWorkerType` union**

Open `src/lib/local-inference/modelManifest.ts`. Find the line defining `translationWorkerType` (exploration said line 115):

```typescript
translationWorkerType?: 'opus-mt' | 'qwen' | 'qwen35' | 'translategemma';
```

Change to:

```typescript
translationWorkerType?: 'opus-mt' | 'qwen' | 'qwen35' | 'translategemma' | 'bing';
```

- [ ] **Step 2: Add the `bing-translator` manifest entry**

Find the Qwen 3.5 2B entry (exploration said around line 2820, starts with `id: 'qwen3.5-2b-translation'`). Insert the following object **immediately after** the Qwen 3.5 2B entry's closing `},` — still inside the translation section of `MODEL_MANIFEST`:

```typescript
  // ── Bing Translator (Online) ───────────────────────────────────────────
  {
    id: 'bing-translator',
    type: 'translation',
    name: 'Bing Translator (Online)',
    languages: [],           // handled via multilingual flag + languageMap
    multilingual: true,
    recommended: true,
    translationWorkerType: 'bing',
    isCloudModel: true,
    sortOrder: 2,            // same tier as Qwen 3.5 0.8B
    variants: {},            // no files to download
  },
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: 0 errors.

If an error says "property ... is missing in type" (e.g. `sourceLang` / `targetLang` are required), check the `ModelManifestEntry` interface around line 90-120. Those fields are already optional on multilingual entries (Qwen 3 has them absent) — the error means something else. Fix by adding whatever field the interface declares as required.

- [ ] **Step 4: Smoke-check via Node one-liner**

Run:

```bash
node -e "const mod = require('./node_modules/tsx/dist/cli.mjs'); console.log('tsx present');" 2>&1 | head -3
```

If `tsx` is installed, run a quick sanity script:

```bash
npx tsx -e "import('./src/lib/local-inference/modelManifest.ts').then(m => {
  const entry = m.getManifestEntry('bing-translator');
  console.log('found:', entry?.name, entry?.translationWorkerType, entry?.isCloudModel);
  if (!entry || entry.translationWorkerType !== 'bing' || !entry.isCloudModel) process.exit(1);
})"
```

Expected output: `found: Bing Translator (Online) bing true`.

If `tsx` is not available, skip — the unit tests and E2E in Task 15 will catch any issue.

- [ ] **Step 5: Commit**

```bash
git add src/lib/local-inference/modelManifest.ts
git commit -m "feat(bing-translator): manifest entry + translationWorkerType union"
```

---

## Task 9: TranslationEngine Cloud-Model Short-Circuit + 'bing' Worker Case

**Files:**
- Modify: `src/lib/local-inference/engine/TranslationEngine.ts` (around lines 44-105)

- [ ] **Step 1: Read the current init() flow**

Run: `sed -n '40,110p' src/lib/local-inference/engine/TranslationEngine.ts`

Confirm the current structure:
1. lookup `entry`
2. check `!entry?.hfModelId` → throw
3. compare with `isReady` / same modelId to short-circuit
4. dispose previous worker
5. `ModelManager.isModelReady(entry.id)` check
6. `getModelBlobUrls(entry.id)`
7. new Worker(...) with switch on `translationWorkerType`

The change: insert a cloud-model branch **before** step 2 (`hfModelId` check), which skips steps 2, 5, and 6 for cloud entries.

- [ ] **Step 2: Apply the patch**

In `src/lib/local-inference/engine/TranslationEngine.ts`, find the block starting:

```typescript
const entry = modelId ? getManifestEntry(modelId) : getTranslationModel(sourceLang, targetLang);
if (!entry?.hfModelId) {
  const available = getManifestByType('translation').map(m =>
    m.multilingual ? `${m.id} (multilingual)` : `${m.sourceLang}-${m.targetLang}`
  ).join(', ');
  throw new Error(`No translation model available for language pair: ${sourceLang}-${targetLang}. Available: ${available}`);
}
const hfModelId = entry.hfModelId;
```

Replace with:

```typescript
const entry = modelId ? getManifestEntry(modelId) : getTranslationModel(sourceLang, targetLang);
if (!entry) {
  const available = getManifestByType('translation').map(m =>
    m.multilingual ? `${m.id} (multilingual)` : `${m.sourceLang}-${m.targetLang}`
  ).join(', ');
  throw new Error(`No translation model available for language pair: ${sourceLang}-${targetLang}. Available: ${available}`);
}

const isCloud = entry.isCloudModel === true;

if (!isCloud && !entry.hfModelId) {
  throw new Error(`Translation model "${entry.id}" has no hfModelId and is not flagged as cloud.`);
}

const hfModelId = entry.hfModelId ?? entry.id;
```

Then in the block that calls `ModelManager.isModelReady` and `getModelBlobUrls`, wrap both in a guard:

```typescript
// Cloud engines (e.g. Bing) have no local files. Skip the download check.
let fileUrls: Record<string, string> = {};
let dtype: string | undefined = undefined;
if (!isCloud) {
  const manager = ModelManager.getInstance();
  if (!await manager.isModelReady(entry.id)) {
    throw new Error(`Translation model "${entry.id}" is not downloaded. Download it first via Model Management.`);
  }
  const variantInfo = await manager.getModelVariantInfo(entry.id);
  dtype = variantInfo.dtype;
  fileUrls = await manager.getModelBlobUrls(entry.id);
}
```

(Adjust the exact variable wiring to match the file's current names. The goal is: when `isCloud` is true, skip the download check and send empty fileUrls to the worker.)

In the worker switch statement (around line 77), add a case **before `default`**:

```typescript
case 'bing':
  this.worker = new Worker(
    new URL('../workers/bing-translation.worker.ts', import.meta.url),
    { type: 'module' }
  );
  break;
```

Also find where the `init` message is posted to the worker. For cloud models, the `fileUrls` payload is empty — make sure the code handles this. If the existing code unconditionally includes `fileUrls`, `dtype`, `hfModelId`, that's fine (the Bing worker ignores those fields). The Bing worker expects `{ type: 'init', sourceLang, targetLang }`.

If the existing code only sends `{ type: 'init', hfModelId, dtype, fileUrls }` — which is the typical translation-worker init — we need to make the init message compatible. Adjust the `init` post to additionally include `sourceLang: this.sourceLang, targetLang: this.targetLang` so both worker types can read what they need:

```typescript
this.worker!.postMessage({
  type: 'init',
  hfModelId,
  dtype,
  fileUrls,
  sourceLang: this.sourceLang,
  targetLang: this.targetLang,
});
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/local-inference/engine/TranslationEngine.ts
git commit -m "feat(bing-translator): TranslationEngine cloud short-circuit + 'bing' worker case"
```

---

## Task 10: LocalInferenceClient — errorType → Human-Readable Message

**Files:**
- Modify: `src/services/clients/LocalInferenceClient.ts` (around lines 484-712)

- [ ] **Step 1: Read current pipeline error path**

Run: `sed -n '680,715p' src/services/clients/LocalInferenceClient.ts`

Confirm the current catch builds an error item with `formatted: { transcript: `Translation error: ${error instanceof Error ? error.message : 'Unknown error'}` }`.

- [ ] **Step 2: Add a helper that extracts errorType and produces a user-facing string**

In `src/services/clients/LocalInferenceClient.ts`, add a module-level helper above the class (or at the bottom of the file):

```typescript
const BING_ERROR_MESSAGES: Record<string, string> = {
  token: 'Bing Translator could not connect. Check your network and try again.',
  unsupported: 'Bing Translator does not support this language pair.',
  network: 'Bing Translator is temporarily unavailable.',
};

function humanizeTranslationError(err: unknown): string {
  if (!err) return 'Translation failed.';
  const maybe = err as { errorType?: string; name?: string; message?: string };
  if (maybe.errorType && BING_ERROR_MESSAGES[maybe.errorType]) {
    return BING_ERROR_MESSAGES[maybe.errorType];
  }
  if (maybe.name === 'BingTokenFetchError') return BING_ERROR_MESSAGES.token;
  if (maybe.name === 'BingUnsupportedLanguageError') return BING_ERROR_MESSAGES.unsupported;
  if (maybe.name === 'BingTranslateError') return BING_ERROR_MESSAGES.network;
  return maybe.message ?? 'Translation failed.';
}
```

- [ ] **Step 3: Apply humanized error in the catch block**

In the catch block around line 692-712, change:

```typescript
formatted: { transcript: `Translation error: ${error instanceof Error ? error.message : 'Unknown error'}` },
```

to:

```typescript
formatted: { transcript: `Translation error: ${humanizeTranslationError(error)}` },
```

Also update the `emitEvent` call so the raw error message still goes to logs (for diagnostics) while the conversation shows the user-facing string:

```typescript
this.emitEvent('local.pipeline.error', 'server', {
  error: error instanceof Error ? error.message : String(error),
  userMessage: humanizeTranslationError(error),
});
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/services/clients/LocalInferenceClient.ts
git commit -m "feat(bing-translator): map worker errorType to user-facing error message"
```

---

## Task 11: Electron webRequest — HTTP Header Injection for bing.com

**Files:**
- Modify: `electron/main.js` (around lines 706-759)

- [ ] **Step 1: Read current handler**

Run: `sed -n '700,765p' electron/main.js`

Confirm you see the `session.defaultSession.webRequest.onBeforeSendHeaders` handler that checks `details.resourceType === 'webSocket'`.

- [ ] **Step 2: Add an HTTP branch for Bing**

At the top of the `onBeforeSendHeaders` callback (same function, before or after the existing WebSocket block), add:

```javascript
// Bing Translator (HTTP): inject browser-like identity so the unofficial
// www.bing.com/translator and /ttranslatev3 endpoints accept requests from
// Electron. Must be applied unconditionally — the Bing client runs inside
// a Web Worker and fetch() from there cannot set Origin/Referer itself.
if (
  details.resourceType !== 'webSocket'
  && typeof details.url === 'string'
  && (
    details.url.startsWith('https://www.bing.com/translator')
    || details.url.startsWith('https://www.bing.com/ttranslatev3')
  )
) {
  requestHeaders['User-Agent'] =
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
  requestHeaders['Origin'] = 'https://www.bing.com';
  requestHeaders['Referer'] = 'https://www.bing.com/translator';
  requestHeaders['Accept-Language'] = 'en-US,en;q=0.9';
}
```

Make sure the callback still ends with `callback({ requestHeaders })` as it did before.

- [ ] **Step 3: Electron smoke test (deferred to Task 15)**

Typecheck is not applicable for `.js`. Move on.

- [ ] **Step 4: Commit**

```bash
git add electron/main.js
git commit -m "feat(bing-translator): Electron webRequest header injection for bing.com HTTP"
```

---

## Task 12: Extension DNR Rule + Host Permission

**Files:**
- Modify: `extension/background/background.js` (around lines 323-381)
- Modify: `extension/manifest.json` (lines 34-39)

- [ ] **Step 1: Read current DNR rule for Edge TTS**

Run: `sed -n '320,385p' extension/background/background.js`

Note the existing constants (`EDGE_TTS_DNR_RULE_ID_BASE`, `EDGE_TTS_WS_HOST`, `EDGE_TTS_CHROMIUM_MAJOR`) and the rule shape.

- [ ] **Step 2: Add a Bing DNR rule**

Add a new constant near the Edge TTS constants:

```javascript
const BING_TRANSLATOR_DNR_RULE_ID = 9301; // pick a free ID; avoid collision with Edge TTS IDs
const BING_TRANSLATOR_HOST = 'www.bing.com';
const BING_TRANSLATOR_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/'
  + `${EDGE_TTS_CHROMIUM_MAJOR}.0.0.0 Safari/537.36 Edg/${EDGE_TTS_CHROMIUM_MAJOR}.0.0.0`;
```

Then, alongside the Edge TTS rule (in the same rules array that's passed to `chrome.declarativeNetRequest.updateDynamicRules`), append a second rule:

```javascript
{
  id: BING_TRANSLATOR_DNR_RULE_ID,
  priority: 1,
  action: {
    type: 'modifyHeaders',
    requestHeaders: [
      { header: 'User-Agent', operation: 'set', value: BING_TRANSLATOR_UA },
      { header: 'Origin', operation: 'set', value: 'https://www.bing.com' },
      { header: 'Referer', operation: 'set', value: 'https://www.bing.com/translator' },
      { header: 'Accept-Language', operation: 'set', value: 'en-US,en;q=0.9' },
    ],
  },
  condition: {
    urlFilter: `||${BING_TRANSLATOR_HOST}`,
    resourceTypes: ['xmlhttprequest'],
  },
},
```

If the existing code clears rules by ID (e.g. `removeRuleIds: [EDGE_TTS_DNR_RULE_ID_BASE]`), add `BING_TRANSLATOR_DNR_RULE_ID` to that array so hot-reload does not leak rules.

- [ ] **Step 3: Add host permission**

In `extension/manifest.json`, extend `host_permissions`:

```json
"host_permissions": [
  "https://sokuji-api.kizuna.ai/*",
  "https://sokuji.kizuna.ai/*",
  "wss://openspeech.bytedance.com/*",
  "https://speech.platform.bing.com/*",
  "wss://speech.platform.bing.com/*",
  "https://www.bing.com/*"
]
```

- [ ] **Step 4: Syntactic sanity**

Run: `node -e "JSON.parse(require('fs').readFileSync('extension/manifest.json','utf8'))" && echo OK`
Expected: `OK`.

- [ ] **Step 5: Commit**

```bash
git add extension/background/background.js extension/manifest.json
git commit -m "feat(bing-translator): extension DNR rule + host_permissions for www.bing.com"
```

---

## Task 13: Verify ModelManagementSection Renders Cloud Translation Correctly

**Files:**
- Read: `src/components/Settings/sections/ModelManagementSection.tsx` (around lines 70-400)

- [ ] **Step 1: Read the current rendering logic**

Run: `sed -n '70,110p' src/components/Settings/sections/ModelManagementSection.tsx`
Run: `sed -n '380,410p' src/components/Settings/sections/ModelManagementSection.tsx`

The exploration confirmed the `isCloudModel` branch is already generalized (line 76, 92, 388-391). Verify that claim yourself in this step.

- [ ] **Step 2: Check — does the translation section of the UI show the Bing entry?**

Search the file for `type === 'translation'` or similar list-building logic. Confirm it iterates over `getManifestByType('translation')` without filtering out `isCloudModel: true` entries.

- [ ] **Step 3: If the cloud path is TTS-specific, generalize it.**

If (and only if) you find a branch that checks `type === 'tts' && isCloudModel` — change the test to not require `type === 'tts'`, OR remove the `type` check from the cloud-rendering branch.

If no change is needed (most likely per exploration), skip to step 4.

- [ ] **Step 4: Commit if modified, otherwise skip**

If you changed the file:

```bash
git add src/components/Settings/sections/ModelManagementSection.tsx
git commit -m "fix(model-management): generalize isCloudModel render path to translation"
```

If nothing changed, do **not** create an empty commit.

---

## Task 14: End-to-End Smoke Test (Manual)

**Files:** none

- [ ] **Step 1: Start Electron in dev mode**

Run: `npm run electron:dev`

Wait for the app window to open.

- [ ] **Step 2: Switch provider to LOCAL_INFERENCE**

Open settings, choose the local inference provider ("Free" per the Edge TTS spec's rename). Ensure at least one streaming ASR model is already downloaded (if not, this is a separate prerequisite — pick any small streaming ASR and let it download).

- [ ] **Step 3: Open Model Management → Translation**

Verify:
- "Bing Translator (Online)" appears in the translation model list.
- It shows as **Ready** / **Cloud** with **no download button**.
- It sits near the Qwen 3.5 0.8B entry (both `sortOrder: 2`, both recommended).

- [ ] **Step 4: Select Bing Translator**

Click "Bing Translator (Online)" to select it as the active translation model. Source = English, target = Japanese.

- [ ] **Step 5: Configure a TTS model (Edge TTS is fine)**

Select Edge TTS as the TTS engine. Pick any English-compatible voice.

- [ ] **Step 6: Start a translation session, speak an English phrase**

Click connect. Speak: "Hello, how are you today?"

Expected:
- ASR recognizes the English.
- A Japanese translation appears (should match or closely match the proto output: "こんにちは、今日はいかがですか？").
- Edge TTS speaks the Japanese through the output device.
- LogsPanel shows `local.pipeline.translation` events with `usedLLM: true`.

- [ ] **Step 7: Exercise error paths**

Disconnect from the internet (Wi-Fi off, or firewall bing.com). Speak another phrase.

Expected:
- Conversation stream shows a system error bubble: "Translation error: Bing Translator is temporarily unavailable." (or "...could not connect..." depending on which request phase failed).
- Session does NOT crash. Reconnect internet; next utterance translates normally.

- [ ] **Step 8: Chrome extension smoke test**

Build extension: `npm run build:extension` (or whatever the project's extension-build command is — check `package.json` scripts).

Load unpacked in Chrome, open the side panel, repeat steps 3-7 in the extension context.

Expected: same behavior as Electron.

- [ ] **Step 9: Record findings**

No commit for this task. If any step above fails, stop and debug. Create a follow-up commit with the fix **scoped to the specific defect**.

---

## Task 15: Final Integration Commit + Cleanup

- [ ] **Step 1: Full test run**

Run: `npm run test`
Expected: all tests green.

- [ ] **Step 2: Typecheck the project**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Build the production bundle**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: If any of steps 1-3 fail, fix and commit the fix**

Do not proceed to step 5 until all three green.

- [ ] **Step 5: Final sanity commit (only if steps above required fixes)**

If no fixes were needed, skip this step. Do not create empty commits.

```bash
git log --oneline | head -20
```

Confirm the commit history is clean and each commit matches a task in this plan.

---

## Self-Review Checklist

After completing all tasks, verify against the spec:

- [ ] ✅ `BingTranslatorClient` exists and passes all tests (Tasks 2-5)
- [ ] ✅ `languageMap` covers `zh` → `zh-Hans` and rejects unknown codes (Task 1)
- [ ] ✅ Token lifecycle: lazy init, proactive refresh at 55 min, single retry on 401 (Task 4, Task 5)
- [ ] ✅ Cookie jar ingests and merges Set-Cookie headers (Task 3)
- [ ] ✅ Worker speaks the existing translation-worker message protocol (Task 7)
- [ ] ✅ Manifest entry uses `translationWorkerType: 'bing'`, `isCloudModel: true`, `recommended: true`, `sortOrder: 2` (Task 8)
- [ ] ✅ `TranslationEngine` skips download check for `isCloudModel` entries and dispatches to the new worker (Task 9)
- [ ] ✅ Error messages shown to the user in the conversation error bubble are human-readable (Task 10)
- [ ] ✅ Electron injects Origin/Referer/UA for bing.com HTTP (Task 11)
- [ ] ✅ Extension DNR modifies the same headers for bing.com xmlhttprequest + host_permissions added (Task 12)
- [ ] ✅ `ModelManagementSection` renders Bing as cloud/ready (Task 13)
- [ ] ✅ End-to-end speak-and-hear flow works in Electron and Extension (Task 14)

Items explicitly excluded per the spec's Non-Goals: fallback to other services, transliteration, banner/toast notifications, changing `DEFAULT_TRANSLATION_MODEL`, web-platform support.
