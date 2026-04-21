# Bing Translator Integration Design

## Summary

Integrate Microsoft's Bing Translator as a free, cloud-based translation option within the existing `LOCAL_INFERENCE` provider. Bing Translator is accessed via the same unofficial endpoint the Bing web UI uses (`www.bing.com/ttranslatev3`), obtained by extracting an anti-abuse token from `www.bing.com/translator`. It sits alongside existing local translation models (Opus-MT, Qwen, TranslateGemma) as one more choice in the translation model list.

This mirrors the architectural shape of the Edge TTS integration (same Microsoft ecosystem, same platform-level header-injection machinery, same "cloud model with no downloads" manifest pattern). Bing Translator is the translation-side counterpart to Edge TTS.

Target motivation: reduce CPU/memory pressure of local translation engines (Opus-MT NLLB models, Qwen LLM inference) for users on low-end devices who still want free, high-quality translation.

## Background

Users who pick `LOCAL_INFERENCE` today must either download one Opus-MT model per language pair (~110 MB each) or run a multilingual Qwen model (heavy WebGPU inference, GPU memory pressure). For low-end devices, both approaches are costly.

Edge TTS already solves the TTS side of this problem: a free cloud service that requires no local model downloads. Bing Translator offers the same tradeoff for translation: 100+ languages, high quality (the service now uses LLM-backed translation, with `usedLLM: true` in responses), a single 10-line network call per translation, no model files. Together with Edge TTS and sherpa-onnx streaming ASR (the lightest local option), this provides a fully free path with minimal local resource cost.

## Verification (proto-tested 2026-04-22)

A standalone Node.js proto (`/tmp/bing-proto/proto.mjs`, not committed) confirmed the following assumptions are currently true:

- `GET https://www.bing.com/translator` returns HTML containing:
  - `IG:"([0-9A-F]+)"` — request context ID
  - `data-iid="([^"]+)"` — interaction ID (e.g. `translator.5025`)
  - `params_AbusePreventionHelper = [key, token, expiry_ms]` — anti-abuse credentials
- Token TTL is **3,600,000 ms (1 hour)**, not 10 minutes.
- `POST https://www.bing.com/ttranslatev3?isVertical=1&IG={ig}&IID={iid}` with body `fromLang`, `text`, `to`, `token`, `key` returns JSON `[{translations: [{text, to, transliteration?}], detectedLanguage: {language, score}, usedLLM: boolean}]`.
- Required request headers: browser-like `User-Agent`, `Referer: https://www.bing.com/translator`, `Origin: https://www.bing.com`, and all cookies from the first `GET` (9 cookies including `MUID`, `_EDGE_S`, `SRCHD`, etc.).
- Response sets an additional `btstkn` cookie that should be folded back into the cookie jar for subsequent requests.
- CORS is restricted to `https://www.bing.com` — browser contexts without header injection cannot call this directly.

No captcha or warm-up is required; first request after token extraction succeeds.

## Architecture

### Overview

```
User selects "Bing Translator (Online)" in translation model dropdown
    |
    v
LocalInferenceClient.processPipelineJob() (post-ASR)
    |
    v
TranslationEngine.init(sourceLang, targetLang, 'bing-translator')
    |
    v
bing-translation.worker.js
    |-- On first translate():
    |     fetch https://www.bing.com/translator
    |     parse IG, IID, AbusePreventionHelper, cookies
    |
    |-- Per translate():
    |     fetch https://www.bing.com/ttranslatev3?...
    |     body: fromLang, text, to, token, key
    |     merge any new cookies from response
    |
    |-- Token refresh:
    |     proactive: > 55 min since last fetch
    |     reactive: one retry on 401/403 with fresh token
    |
    v
TranslationEngine emits TranslationResult
    |
    v
LocalInferenceClient hands translated text to TtsEngine (unchanged)
```

### Component 1: Bing Translator Core Library

**New file: `src/lib/bing-translator/BingTranslatorClient.ts`**

A class that encapsulates the full Bing flow. Runs inside the worker (not in the main thread); exported as a plain class so the worker can import it via bundler.

```typescript
export interface BingTranslateResult {
  translatedText: string;
  detectedLanguage?: { language: string; score: number };
  transliteration?: { text: string; script: string };  // reserved; not surfaced in UI yet
  usedLLM?: boolean;                                    // logged for diagnostics
  inferenceTimeMs: number;
}

export class BingTranslatorClient {
  private ig: string | null = null;
  private iid: string | null = null;
  private key: string | null = null;
  private token: string | null = null;
  private tokenFetchedAt = 0;
  private cookieJar: Map<string, string> = new Map();

  private static readonly TOKEN_TTL_MS = 3_300_000;  // 55 min (5-min safety margin)
  private static readonly FETCH_TIMEOUT_MS = 12_000;
  private static readonly UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 ...';

  async translate(text: string, from: string, to: string): Promise<BingTranslateResult>;
  private async refreshToken(): Promise<void>;
  private isTokenExpired(): boolean;
  private parseHtml(html: string): { ig: string; iid: string; key: string; token: string };
  private updateCookieJar(setCookieHeaders: string[]): void;
  private cookieHeader(): string;
}
```

Key behaviors:

- **Cookie jar**: stores `name=value` pairs in a `Map`; on every response with `Set-Cookie`, extract `name=value` (first `;`-delimited segment) and write into the map. Build outgoing `Cookie` header by joining entries.
- **Token refresh**: lazy on first `translate()`, proactive when `Date.now() - tokenFetchedAt > TOKEN_TTL_MS`.
- **HTML parsing**: three regex extractions; fail with `BingTokenFetchError` if any is missing (indicates Bing changed their page structure).
- **Language code mapping**: applied at the edge via `mapToBingCode()` from `languageMap.ts` before being sent.
- **Retry policy**: if `POST /ttranslatev3` returns 401/403 or the JSON response is `[{errorMessage: ...}]`, refresh the token once and retry the same request. No other retries (no fallback to other services).

**New file: `src/lib/bing-translator/languageMap.ts`**

ISO-639-1 → Bing language code translation. Most codes pass through unchanged; special cases:

```typescript
const BING_LANGUAGE_OVERRIDES: Record<string, string> = {
  'zh': 'zh-Hans',         // default to simplified Chinese
  'zh-CN': 'zh-Hans',
  'zh-TW': 'zh-Hant',
  'nb': 'nb',              // Norwegian Bokmål
  // ...expand as needed
};

export function mapToBingCode(iso: string): string;
export function isSupportedByBing(iso: string): boolean;
export const BING_SUPPORTED_LANGUAGES: string[];  // curated list of ~100 codes
```

If the user selects a source/target language not in `BING_SUPPORTED_LANGUAGES`, the engine throws `BingUnsupportedLanguageError` early (before the network call).

**New file: `src/lib/bing-translator/index.ts`**

Re-exports `BingTranslatorClient`, `mapToBingCode`, error classes.

### Component 2: Bing Translation Worker

**New file: `public/workers/bing-translation.worker.js`**

Classic JS worker, consistent with existing translation workers in the project. Instantiates a single `BingTranslatorClient`, handles message protocol:

```
Main → Worker:
  { type: 'init', sourceLang, targetLang }                 // validates language support
  { type: 'translate', id, text, systemPrompt?, wrapTranscript? }  // systemPrompt ignored for Bing
  { type: 'dispose' }

Worker → Main:
  { type: 'ready', device: 'cloud' }
  { type: 'translation-result', id, translatedText, inferenceTimeMs, detectedLanguage?, usedLLM? }
  { type: 'error', id?, message, errorType: 'token' | 'unsupported' | 'network' | 'unknown' }
```

The worker is imported via `new URL('../workers/bing-translation.worker.js', import.meta.url)` pattern in TranslationEngine (matches how TranslationEngine already loads Opus-MT/Qwen workers).

Note: `systemPrompt` and `wrapTranscript` (used by LLM-based Qwen/TranslateGemma) are silently ignored by Bing — it does not accept custom prompts. This is acceptable because Bing's `usedLLM: true` means it's already applying context internally.

### Component 3: TranslationEngine Bing Branch

**Modify file: `src/lib/local-inference/engine/TranslationEngine.ts`**

Add a branch before the existing `if (!entry?.hfModelId)` check:

```typescript
async init(sourceLang, targetLang, modelId?) {
  const entry = modelId ? getManifestEntry(modelId) : getTranslationModel(sourceLang, targetLang);
  if (!entry) throw new Error(...);

  // NEW: cloud engine short-circuit
  if (entry.engine === 'bing') {
    return this.initBingWorker(entry, sourceLang, targetLang);
  }

  // existing path: hfModelId check, ModelManager download check, worker dispatch...
}

private async initBingWorker(entry, sourceLang, targetLang) {
  // Skip ModelManager check (no files to download)
  this.worker = new Worker(
    new URL('../workers/bing-translation.worker.js', import.meta.url)
  );
  // wire up message handlers identical to existing workers
  // post { type: 'init', sourceLang: mapToBingCode(sourceLang), targetLang: mapToBingCode(targetLang) }
  // resolve on 'ready'
}
```

The existing `translate()` method remains unchanged — it just posts `{ type: 'translate', id, text, systemPrompt, wrapTranscript }` to whatever worker is active. The Bing worker ignores `systemPrompt` / `wrapTranscript`.

### Component 4: Model Manifest Entry

**Modify file: `src/lib/local-inference/modelManifest.ts`**

Insert a new entry in the translation section, mirroring the Edge TTS pattern:

```typescript
{
  id: 'bing-translator',
  type: 'translation',
  name: 'Bing Translator (Online)',
  languages: [],                 // handled via multilingual flag + languageMap
  multilingual: true,
  recommended: true,
  engine: 'bing',                // NEW engine type
  isCloudModel: true,
  sortOrder: 2,                  // same tier as Qwen 3.5 0.8B
  variants: {},                  // no files to download
}
```

Also extend the `engine` type union in the `ModelEntry` interface (currently `'opus-mt' | 'qwen' | 'qwen35' | 'translategemma' | 'piper' | 'piper-plus' | 'edge-tts'` or similar) to include `'bing'`.

The `getTranslationModel()` selection function already ranks by `recommended` first then `sortOrder` ascending. With `recommended: true` and `sortOrder: 2`, Bing sits alongside Qwen 3.5 0.8B in the recommended tier but does not become the auto-default — `getTranslationModel()` still returns the lowest-sortOrder model (Qwen 3.5 2B at `sortOrder: 1`) for users who don't explicitly pick.

### Component 5: Platform Header Injection

Bing enforces `Origin: https://www.bing.com` via CORS. The browser blocks non-bing origins from setting this header directly, so we reuse the platform-level header rewriting machinery Edge TTS already uses.

**Electron main process**: extend the existing `session.webRequest.onBeforeSendHeaders` filter to match `https://www.bing.com/translator*` and `https://www.bing.com/ttranslatev3*` in addition to the Edge TTS endpoints. For matching requests, inject:

- `User-Agent`: browser UA constant (reuse the Edge TTS UA if present)
- `Origin: https://www.bing.com`
- `Referer: https://www.bing.com/translator`
- `Accept-Language: en-US,en;q=0.9`

**Extension (declarativeNetRequest)**: add rules to the existing rules JSON file targeting the same URL patterns with the same header overrides. Update `extension/manifest.json` `host_permissions` to include `https://*.bing.com/*` (may already be present for Edge TTS — verify and extend if needed).

Do not assume the Electron/Extension changes are drop-in — during implementation, the exact file locations must be discovered by searching for the Edge TTS header injection code first, then extending it.

### Component 6: UI — Model Management

The `ModelManagementSection` component already renders Edge TTS as "Ready (Cloud)" with no download button because of the `isCloudModel: true` flag. Verify during implementation that:

- The same rendering path applies when `type === 'translation' && isCloudModel === true`.
- If the current implementation is hard-coded to `type === 'tts'`, generalize it.

No new UI components are required. The existing translation model dropdown will list Bing like any other translation model, selected via `LocalInferenceSettings.translationModel`.

## Data Flow & State

### Token lifecycle

```
+--------+                 +----------------+
| fresh  |--translate()--> | token present? |
+--------+                 +----------------+
                             | no           | yes, <55min
                             v              v
                      +--------------+  +--------+
                      | refreshToken |  | POST   |
                      +--------------+  +--------+
                             |              | 200?
                             v              v--- yes --> success
                          POST             no (401/403 or error)
                             |              |
                             v              v
                          success     refreshToken (once)
                                           |
                                           v
                                        POST (retry)
                                           |
                                    success | fail --> throw
```

### Settings

No new settings fields. The user configures Bing purely by choosing `LocalInferenceSettings.translationModel === 'bing-translator'`. Existing `sourceLanguage` / `targetLanguage` selectors drive the translation language pair. The languages dropdown will already show all Bing-compatible codes because the manifest is already dynamically aggregating multilingual models' languages (see `getTranslationLanguageCodes()` logic).

## Error Handling

All failures throw; no fallback to other engines (per design decision).

| Error class                      | Trigger                                                                    | Behavior                                           |
| -------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------- |
| `BingTokenFetchError`            | `GET /translator` fails, or HTML is missing `IG` / `IID` / `AbusePrev...`  | Worker sends `{ type: 'error', errorType: 'token' }` |
| `BingUnsupportedLanguageError`   | Source or target not in `BING_SUPPORTED_LANGUAGES`                         | Thrown before network call; errorType `unsupported` |
| `BingTranslateError`             | `POST /ttranslatev3` non-200, or response shape invalid, or empty translations | errorType `network`                                 |
| Timeout                          | fetch exceeds 12s                                                          | errorType `network`                                 |

Errors bubble up through `TranslationEngine.translate()`'s rejected Promise to `LocalInferenceClient`'s existing translation-error handler, which logs to `logStore` and emits a user-visible error state for the affected conversation item. The session continues — subsequent utterances can still be translated once the transient condition clears.

**One internal retry**: token refresh + retry on `token invalid` style failures is handled entirely inside `BingTranslatorClient`, not surfaced as a retry at the engine or client level.

## Testing

### Unit tests

**New file: `src/lib/bing-translator/BingTranslatorClient.test.ts`**

- HTML parser: given fixture HTML strings, extracts `IG`, `IID`, `key`, `token` correctly.
- Parser failure paths: missing each field produces `BingTokenFetchError`.
- Language mapping: `zh` → `zh-Hans`, `en` → `en`, unsupported code throws.
- Cookie jar: merges new cookies, produces correct `Cookie` header string.
- Token expiry: `isTokenExpired()` true when stale, false when fresh.
- Token refresh retry: mock fetch so first `translate()` sees a 401, verify one `refreshToken` + retry happens, no second retry.

**New file: `src/lib/bing-translator/languageMap.test.ts`**

- Known override cases.
- Passthrough cases.
- Round-trip `isSupportedByBing`.

### Integration / smoke

Extend the existing Translation proto panel (`Ctrl+Shift+T`) with a "Bing Translator" engine selector. Lets a developer:

- Open proto, pick Bing, enter text + language pair, click Translate.
- See: translated text, detected language, latency, any transliteration.
- Verify token refresh works by waiting >55 min (or manually invalidating the in-memory token) and translating again.

This is the primary pre-merge integration check. It runs in the actual Electron/Extension environment where header injection applies, unlike the proto script that runs in Node without the header-rewriting middleware.

### End-to-end

- Start `LOCAL_INFERENCE` session with sherpa-onnx ASR + Bing Translator + Edge TTS. Speak English utterances, verify Japanese translation output through speakers.
- Switch translation engine mid-session (should work — `TranslationEngine.init()` tears down and re-creates the worker). Verify no leaks.
- Disconnect network mid-session, verify error surfaces cleanly to UI, session does not crash. Reconnect, verify translation resumes on next utterance.

## File Change List

**New files**

| Path                                                  | Purpose                                      |
| ----------------------------------------------------- | -------------------------------------------- |
| `src/lib/bing-translator/BingTranslatorClient.ts`     | Auth + translate API + cookie jar + retry    |
| `src/lib/bing-translator/languageMap.ts`              | ISO → Bing language code mapping             |
| `src/lib/bing-translator/index.ts`                    | Barrel export                                |
| `src/lib/bing-translator/BingTranslatorClient.test.ts`| Unit tests                                   |
| `src/lib/bing-translator/languageMap.test.ts`         | Unit tests                                   |
| `public/workers/bing-translation.worker.js`           | Worker wrapper around `BingTranslatorClient` |

**Modified files**

| Path                                                             | Change                                                             |
| ---------------------------------------------------------------- | ------------------------------------------------------------------ |
| `src/lib/local-inference/modelManifest.ts`                       | Add `bing-translator` entry; extend `engine` union with `'bing'`   |
| `src/lib/local-inference/engine/TranslationEngine.ts`            | Branch on `engine === 'bing'` before `hfModelId` check             |
| `src/components/Settings/sections/ModelManagementSection.tsx`    | Ensure `isCloudModel` rendering path covers translation models     |
| Electron main process (file TBD — locate via Edge TTS header code) | Extend `onBeforeSendHeaders` filter to include `www.bing.com/translator` and `www.bing.com/ttranslatev3` |
| Extension `declarativeNetRequest` rules (file TBD)               | Add Bing URL patterns with same header overrides                   |
| `extension/manifest.json`                                        | Ensure `host_permissions` includes `https://*.bing.com/*`          |
| Translation proto panel component (existing)                     | Add Bing engine selector                                           |

**Deletions / cleanups**: none.

## Open Questions

These are expected to be resolved during implementation research, not at spec time:

1. **Edge TTS header injection file locations** — for both Electron and Extension; needed to extend them for `www.bing.com`.
2. **Whether `isCloudModel` branch in `ModelManagementSection.tsx` is already generic** or tts-specific. If tts-specific, generalization is a small additional change.
3. **Exact shape of `BING_SUPPORTED_LANGUAGES`** — curate from Bing's published supported-languages list; aim for ~100 codes.

## Non-Goals

- **Fallback to other translation services** (e.g. Google) when Bing fails. Explicitly excluded per product decision.
- **Web-platform support.** `LOCAL_INFERENCE` is an Electron/Extension feature in practice; no web-specific gating is added.
- **Transliteration surfacing in UI.** The response field is parsed and stored but not displayed; may be reused later.
- **Custom system prompts / context** like Qwen/TranslateGemma. Bing uses its own internal context.
- **Making Bing the default translation engine.** It is offered with equal prominence to Qwen 3.5 but does not change `DEFAULT_TRANSLATION_MODEL`.
