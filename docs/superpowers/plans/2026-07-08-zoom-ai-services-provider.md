# Zoom AI Services Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `Provider.ZOOM_AI` text-only cascade provider (Zoom Scribe ASR → Zoom Translator MT → subtitles) to Sokuji, BYOK, behind a feature flag.

**Architecture:** A new `ZoomAIClient implements IClient` receives mic PCM via `appendInputAudio`, runs client-side Silero VAD (in a dedicated worker) to segment utterances, encodes each utterance as a WAV data-URI, calls Zoom Scribe (transcribe) then Zoom Translator (translate) over HTTPS signed with a client-side HS256 JWT, and emits `user`(transcript)+`assistant`(translation) `ConversationItem`s. Registration mirrors the existing Volcengine ST provider (two-secret BYOK). The cascade/textOnly shape mirrors `LocalInferenceClient`.

**Tech Stack:** TypeScript, React, Zustand, vitest; Web Crypto (`crypto.subtle`) for JWT; `@ricky0123/vad-web` + onnxruntime-web (already bundled) for VAD; `fetch` for Zoom REST.

## Global Constraints

- **Provider id / enum value:** `zoom_ai` (`Provider.ZOOM_AI = 'zoom_ai'`).
- **Feature flag:** `VITE_ENABLE_ZOOM_AI`; dev-on, prod requires `=== 'true'`. Gate exactly like `isVolcengineSTEnabled()`.
- **Endpoints:** `https://api.zoom.us/v2/aiservices/scribe/transcribe` and `https://api.zoom.us/v2/aiservices/translator/translate`. Header `Authorization: Bearer <jwt>`, `Content-Type: application/json`.
- **JWT:** HS256; payload `{ iss: apiKey, iat: now-30, exp: now+7200 }`; signed with apiSecret; base64url (no padding).
- **Scribe request:** `{ file: "data:audio/wav;base64,<bytes>", config: { language, word_time_offsets: true } }`. Response transcript = `result.text_display`. `file` MUST be a data URI (bare base64 → `400 UNSUPPORTED_MEDIA`).
- **Translator request:** `{ text, config: { source_language, target_languages: [target] } }`. Response text = `result.translations[target]`. A pair MUST have English on one side.
- **BYOK two secrets:** `apiKey` (Zoom API Key) + `clientSecret` (Zoom API Secret). Persisted in the settings service like every other BYOK provider's credentials (OpenAI `apiKey`, Volcengine `secretAccessKey`); held client-side and sent to Zoom only as the derived Bearer JWT. Signed client-side (same model as Volcengine).
- **Language matrix (asymmetric):** sources = `en-US, zh-CN, ja-JP, es-ES, it-IT`. `en-US → {zh-CN, zh-TW, ja-JP, ko-KR, es-ES, fr-FR, de-DE, pt-PT, pt-BR, it-IT}`; each of `zh-CN, ja-JP, es-ES, it-IT → en-US` only.
- **Text-only:** `textOnlyCapability: 'always'`; the Zoom settings panel renders a permanently-checked, disabled `ToggleSwitch` labelled "Text Only".
- **Audio format in:** `appendInputAudio(Int16Array)` delivers mono PCM16 @ 24000 Hz; resample to 16000 Hz for VAD + the WAV sent to Scribe.
- **Testing gate:** vitest + Vite build. Do NOT gate on `tsc` (repo is not tsc-clean).
- **Comments/docs:** English only.

---

## File Structure

**Create:**
- `src/services/clients/zoom/ZoomJwtSigner.ts` — HS256 JWT signer (Web Crypto), token caching.
- `src/services/clients/zoom/zoomApi.ts` — WAV encoder, data-URI, `transcribe()`, `translate()`, `ZoomApiError`.
- `src/services/clients/zoom/ZoomJwtSigner.test.ts`, `.../zoomApi.test.ts`.
- `src/services/providers/ZoomAIProviderConfig.ts` — config + asymmetric pair map.
- `src/services/providers/ZoomAIProviderConfig.test.ts`.
- `src/lib/local-inference/workers/zoom-vad.worker.ts` — Silero VAD → utterance emitter.
- `src/services/clients/ZoomAIClient.ts` — `IClient` implementation orchestrating VAD + cascade + emit.
- `src/services/clients/ZoomAIClient.test.ts`.

**Modify:**
- `src/types/Provider.ts` — enum, union, `SUPPORTED_PROVIDERS`, `getProviderDisplayName`.
- `src/utils/environment.ts` — `isZoomAIEnabled()`.
- `src/services/interfaces/IClient.ts` — `ZoomAISessionConfig`, union, guard.
- `src/stores/settingsStore.ts` — settings type/defaults/state/action/hooks/session-config/validate.
- `src/services/ClientOperations.ts` — validate + latest-model cases.
- `src/services/clients/ClientFactory.ts` — create case.
- `src/services/providers/ProviderConfigFactory.ts` — register config.
- `src/components/Settings/sections/ProviderSection.tsx` — credential block + cases.
- `src/components/Settings/sections/ProviderSpecificSettings.tsx` — `renderZoomAISettings()` + update branch.
- `src/components/MainPanel/MainPanel.tsx` — apiKey switch + clientSecret wiring.

---

## Task 1: Provider enum + feature flag

**Files:**
- Modify: `src/types/Provider.ts` (enum ~L10-21, union L26, `SUPPORTED_PROVIDERS` L33-43, import L5, `getProviderDisplayName` ~L82)
- Modify: `src/utils/environment.ts` (add after `isVolcengineSTEnabled` ~L216)

**Interfaces:**
- Produces: `Provider.ZOOM_AI = 'zoom_ai'`; `isZoomAIEnabled(): boolean`.

- [ ] **Step 1: Add `isZoomAIEnabled` to environment.ts**

Add after the existing `isVolcengineSTEnabled` function:
```typescript
/**
 * Check if Zoom AI Services features should be enabled.
 * Development: always true. Production: requires VITE_ENABLE_ZOOM_AI === 'true'.
 */
export function isZoomAIEnabled(): boolean {
  if (isDevelopmentMode()) {
    return true;
  }
  return import.meta.env.VITE_ENABLE_ZOOM_AI === 'true';
}
```

- [ ] **Step 2: Extend Provider.ts enum + union + gating + display name**

Enum — add member:
```typescript
  LOCAL_INFERENCE = 'local_inference',
  ZOOM_AI = 'zoom_ai'
```
`ProviderType` union — append `| Provider.ZOOM_AI`.

Import (L5) — add `isZoomAIEnabled`:
```typescript
import { isKizunaAIEnabled, isPalabraAIEnabled, isVolcengineSTEnabled, isVolcengineAST2Enabled, isZoomAIEnabled } from '../utils/environment';
```
`SUPPORTED_PROVIDERS` — add before the trailing `Provider.OPENAI_COMPATIBLE,`:
```typescript
  ...(isZoomAIEnabled() ? [Provider.ZOOM_AI] : []),
```
`getProviderDisplayName` — add case:
```typescript
    case Provider.ZOOM_AI:
      return 'Zoom AI Services';
```

- [ ] **Step 3: Typecheck-adjacent build check**

Run: `npm run build`
Expected: build succeeds (no references to ZOOM_AI elsewhere yet; enum addition is safe).

- [ ] **Step 4: Commit**

```bash
git add src/types/Provider.ts src/utils/environment.ts
git commit -m "feat(zoom-ai): add Provider.ZOOM_AI enum + isZoomAIEnabled flag"
```

---

## Task 2: ZoomJwtSigner

**Files:**
- Create: `src/services/clients/zoom/ZoomJwtSigner.ts`
- Test: `src/services/clients/zoom/ZoomJwtSigner.test.ts`

**Interfaces:**
- Produces: `class ZoomJwtSigner { constructor(apiKey: string, apiSecret: string); getToken(): Promise<string> }` — returns a cached HS256 JWT, re-signing when within 5 min of expiry.

- [ ] **Step 1: Write the failing test**

`src/services/clients/zoom/ZoomJwtSigner.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { ZoomJwtSigner } from './ZoomJwtSigner';

function decodeSegment(seg: string): any {
  const b64 = seg.replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(atob(b64));
}

describe('ZoomJwtSigner', () => {
  it('produces a well-formed HS256 JWT with iss=apiKey', async () => {
    const signer = new ZoomJwtSigner('MY_KEY', 'MY_SECRET');
    const token = await signer.getToken();
    const [h, p, s] = token.split('.');
    expect(h && p && s).toBeTruthy();
    expect(decodeSegment(h)).toEqual({ alg: 'HS256', typ: 'JWT' });
    const payload = decodeSegment(p);
    expect(payload.iss).toBe('MY_KEY');
    expect(payload.exp).toBeGreaterThan(payload.iat);
  });

  it('signature verifies against the secret via Web Crypto', async () => {
    const signer = new ZoomJwtSigner('K', 'topsecret');
    const token = await signer.getToken();
    const [h, p, s] = token.split('.');
    const key = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode('topsecret'),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${h}.${p}`));
    const expected = btoa(String.fromCharCode(...new Uint8Array(sigBuf)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(s).toBe(expected);
  });

  it('caches the token across calls', async () => {
    const signer = new ZoomJwtSigner('K', 'S');
    const a = await signer.getToken();
    const b = await signer.getToken();
    expect(a).toBe(b);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/services/clients/zoom/ZoomJwtSigner.test.ts`
Expected: FAIL — cannot resolve `./ZoomJwtSigner`.

- [ ] **Step 3: Write the implementation**

`src/services/clients/zoom/ZoomJwtSigner.ts`:
```typescript
/**
 * Client-side HS256 JWT signer for Zoom AI Services (Build Platform).
 * Payload: { iss: apiKey, iat, exp }, signed with apiSecret using Web Crypto.
 * Mirrors the client-side-signing model used by VolcengineSTClient's signer.
 */
function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlString(s: string): string {
  return base64url(new TextEncoder().encode(s));
}

const TOKEN_TTL_SEC = 7200; // 2h
const REFRESH_MARGIN_SEC = 300; // re-sign within 5 min of expiry

export class ZoomJwtSigner {
  private apiKey: string;
  private apiSecret: string;
  private cachedToken: string | null = null;
  private cachedExp = 0;

  constructor(apiKey: string, apiSecret: string) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
  }

  async getToken(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    if (this.cachedToken && this.cachedExp - now > REFRESH_MARGIN_SEC) {
      return this.cachedToken;
    }
    const iat = now - 30;
    const exp = iat + TOKEN_TTL_SEC;
    const header = base64urlString(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payload = base64urlString(JSON.stringify({ iss: this.apiKey, iat, exp }));
    const signingInput = `${header}.${payload}`;

    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(this.apiSecret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signingInput));
    const token = `${signingInput}.${base64url(new Uint8Array(sig))}`;

    this.cachedToken = token;
    this.cachedExp = exp;
    return token;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/services/clients/zoom/ZoomJwtSigner.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/clients/zoom/ZoomJwtSigner.ts src/services/clients/zoom/ZoomJwtSigner.test.ts
git commit -m "feat(zoom-ai): client-side HS256 JWT signer"
```

---

## Task 3: zoomApi (WAV encoder + transcribe + translate)

**Files:**
- Create: `src/services/clients/zoom/zoomApi.ts`
- Test: `src/services/clients/zoom/zoomApi.test.ts`

**Interfaces:**
- Consumes: nothing (token passed in by caller).
- Produces:
  - `encodeWavDataUri(samples: Float32Array, sampleRate: number): string` → `"data:audio/wav;base64,..."`.
  - `transcribe(token: string, wavDataUri: string, language: string): Promise<string>` → `result.text_display`.
  - `translate(token: string, text: string, sourceLanguage: string, targetLanguage: string): Promise<string>` → `result.translations[targetLanguage]`.
  - `class ZoomApiError extends Error { status: number; reason?: string }`.

- [ ] **Step 1: Write the failing test**

`src/services/clients/zoom/zoomApi.test.ts`:
```typescript
import { describe, it, expect, vi, afterEach } from 'vitest';
import { encodeWavDataUri, transcribe, translate, ZoomApiError } from './zoomApi';

afterEach(() => vi.restoreAllMocks());

describe('encodeWavDataUri', () => {
  it('produces a wav data URI with a RIFF/WAVE header and correct data length', () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1, -1]);
    const uri = encodeWavDataUri(samples, 16000);
    expect(uri.startsWith('data:audio/wav;base64,')).toBe(true);
    const bytes = Uint8Array.from(atob(uri.split(',')[1]), (c) => c.charCodeAt(0));
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('RIFF');
    expect(String.fromCharCode(...bytes.slice(8, 12))).toBe('WAVE');
    // 44-byte header + 2 bytes/sample
    expect(bytes.length).toBe(44 + samples.length * 2);
  });
});

describe('transcribe', () => {
  it('POSTs a data-uri file + language and returns text_display', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ result: { text_display: 'hello' } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const out = await transcribe('TOK', 'data:audio/wav;base64,AAAA', 'en-US');
    expect(out).toBe('hello');
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toContain('/aiservices/scribe/transcribe');
    const body = JSON.parse(opts.body);
    expect(body.file).toBe('data:audio/wav;base64,AAAA');
    expect(body.config.language).toBe('en-US');
    expect(opts.headers.Authorization).toBe('Bearer TOK');
  });

  it('throws ZoomApiError on non-2xx', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 403,
      text: async () => JSON.stringify({ reason: 'BILLING_SCRIBE_API_PLAN_REQUIRED', message: 'x' }),
    }));
    await expect(transcribe('T', 'data:...', 'en-US')).rejects.toMatchObject({
      status: 403, reason: 'BILLING_SCRIBE_API_PLAN_REQUIRED',
    });
  });
});

describe('translate', () => {
  it('POSTs text + config and returns translations[target]', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      text: async () => JSON.stringify({ result: { translations: { 'zh-CN': '你好' } } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const out = await translate('TOK', 'hello', 'en-US', 'zh-CN');
    expect(out).toBe('你好');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.text).toBe('hello');
    expect(body.config.source_language).toBe('en-US');
    expect(body.config.target_languages).toEqual(['zh-CN']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/services/clients/zoom/zoomApi.test.ts`
Expected: FAIL — cannot resolve `./zoomApi`.

- [ ] **Step 3: Write the implementation**

`src/services/clients/zoom/zoomApi.ts`:
```typescript
/**
 * Zoom AI Services REST wrappers: WAV encoding + Scribe (ASR) + Translator (MT).
 * All calls are signed with an HS256 JWT (see ZoomJwtSigner) passed as `token`.
 */
const API_BASE = 'https://api.zoom.us/v2/aiservices';

export class ZoomApiError extends Error {
  status: number;
  reason?: string;
  constructor(status: number, message: string, reason?: string) {
    super(message);
    this.name = 'ZoomApiError';
    this.status = status;
    this.reason = reason;
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

/** Encode Float32 [-1,1] mono samples as a 16-bit PCM WAV data URI. */
export function encodeWavDataUri(samples: Float32Array, sampleRate: number): string {
  const numSamples = samples.length;
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + numSamples * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // audio format = PCM
  view.setUint16(22, 1, true); // channels = mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits/sample
  writeStr(36, 'data');
  view.setUint32(40, numSamples * 2, true);
  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return `data:audio/wav;base64,${bytesToBase64(new Uint8Array(buffer))}`;
}

async function post(path: string, token: string, body: unknown): Promise<any> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  if (!res.ok) {
    let reason: string | undefined;
    let message = raw;
    try {
      const j = JSON.parse(raw);
      reason = j.reason;
      message = j.message || raw;
    } catch { /* keep raw */ }
    throw new ZoomApiError(res.status, message, reason);
  }
  return JSON.parse(raw);
}

export async function transcribe(token: string, wavDataUri: string, language: string): Promise<string> {
  const json = await post('/scribe/transcribe', token, {
    file: wavDataUri,
    config: { language, word_time_offsets: true },
  });
  return json?.result?.text_display ?? '';
}

export async function translate(
  token: string,
  text: string,
  sourceLanguage: string,
  targetLanguage: string,
): Promise<string> {
  const json = await post('/translator/translate', token, {
    text,
    config: { source_language: sourceLanguage, target_languages: [targetLanguage] },
  });
  return json?.result?.translations?.[targetLanguage] ?? '';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/services/clients/zoom/zoomApi.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/clients/zoom/zoomApi.ts src/services/clients/zoom/zoomApi.test.ts
git commit -m "feat(zoom-ai): WAV encoder + Scribe/Translator REST wrappers"
```

---

## Task 4: ZoomAIProviderConfig (language matrix)

**Files:**
- Create: `src/services/providers/ZoomAIProviderConfig.ts`
- Test: `src/services/providers/ZoomAIProviderConfig.test.ts`

**Interfaces:**
- Consumes: `ProviderConfig`, `LanguageOption` from `./ProviderConfig`.
- Produces: `class ZoomAIProviderConfig { getConfig(): ProviderConfig; static getSourceLanguages(): LanguageOption[]; static getTargetLanguagesForSource(src: string): LanguageOption[] }`.

- [ ] **Step 1: Write the failing test**

`src/services/providers/ZoomAIProviderConfig.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { ZoomAIProviderConfig } from './ZoomAIProviderConfig';

describe('ZoomAIProviderConfig', () => {
  it('exposes exactly the 5 Scribe source languages', () => {
    const values = ZoomAIProviderConfig.getSourceLanguages().map((l) => l.value).sort();
    expect(values).toEqual(['en-US', 'es-ES', 'it-IT', 'ja-JP', 'zh-CN']);
  });

  it('en-US allows many targets including zh-CN and ja-JP', () => {
    const t = ZoomAIProviderConfig.getTargetLanguagesForSource('en-US').map((l) => l.value);
    expect(t).toContain('zh-CN');
    expect(t).toContain('ja-JP');
    expect(t).not.toContain('en-US');
  });

  it('non-English sources allow only en-US', () => {
    for (const src of ['zh-CN', 'ja-JP', 'es-ES', 'it-IT']) {
      const t = ZoomAIProviderConfig.getTargetLanguagesForSource(src).map((l) => l.value);
      expect(t).toEqual(['en-US']);
    }
  });

  it('getConfig reports text-only always and no voices', () => {
    const cfg = new ZoomAIProviderConfig().getConfig();
    expect(cfg.capabilities.textOnlyCapability).toBe('always');
    expect(cfg.voices).toEqual([]);
    expect(cfg.id).toBe('zoom_ai');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/services/providers/ZoomAIProviderConfig.test.ts`
Expected: FAIL — cannot resolve `./ZoomAIProviderConfig`.

- [ ] **Step 3: Write the implementation**

`src/services/providers/ZoomAIProviderConfig.ts`:
```typescript
import { ProviderConfig, LanguageOption, VoiceOption, ModelOption } from './ProviderConfig';

/**
 * Zoom AI Services (Scribe + Translator) — text-only cascade provider.
 * Asymmetric language matrix: sources are the 5 Scribe-recognizable languages;
 * a translation pair must have English on one side.
 */
export class ZoomAIProviderConfig {
  // ASR-recognizable sources (Zoom Scribe supported languages).
  private static readonly SOURCE_LANGUAGES: LanguageOption[] = [
    { name: 'English', value: 'en-US', englishName: 'English' },
    { name: '中文', value: 'zh-CN', englishName: 'Chinese (Simplified)' },
    { name: '日本語', value: 'ja-JP', englishName: 'Japanese' },
    { name: 'Español', value: 'es-ES', englishName: 'Spanish' },
    { name: 'Italiano', value: 'it-IT', englishName: 'Italian' },
  ];

  // All translator target languages reachable from English.
  private static readonly EN_TARGETS: LanguageOption[] = [
    { name: '中文 (简体)', value: 'zh-CN', englishName: 'Chinese (Simplified)' },
    { name: '中文 (繁體)', value: 'zh-TW', englishName: 'Chinese (Traditional)' },
    { name: '日本語', value: 'ja-JP', englishName: 'Japanese' },
    { name: '한국어', value: 'ko-KR', englishName: 'Korean' },
    { name: 'Español', value: 'es-ES', englishName: 'Spanish' },
    { name: 'Français', value: 'fr-FR', englishName: 'French' },
    { name: 'Deutsch', value: 'de-DE', englishName: 'German' },
    { name: 'Português (PT)', value: 'pt-PT', englishName: 'Portuguese (Portugal)' },
    { name: 'Português (BR)', value: 'pt-BR', englishName: 'Portuguese (Brazil)' },
    { name: 'Italiano', value: 'it-IT', englishName: 'Italian' },
  ];

  private static readonly EN_ONLY: LanguageOption[] = [
    { name: 'English', value: 'en-US', englishName: 'English' },
  ];

  // source value → allowed target list
  private static readonly PAIRS: Record<string, LanguageOption[]> = {
    'en-US': ZoomAIProviderConfig.EN_TARGETS,
    'zh-CN': ZoomAIProviderConfig.EN_ONLY,
    'ja-JP': ZoomAIProviderConfig.EN_ONLY,
    'es-ES': ZoomAIProviderConfig.EN_ONLY,
    'it-IT': ZoomAIProviderConfig.EN_ONLY,
  };

  private static readonly VOICES: VoiceOption[] = [];
  private static readonly MODELS: ModelOption[] = [
    { id: 'zoom-scribe-translator-v1', type: 'realtime' },
  ];

  static getSourceLanguages(): LanguageOption[] {
    return ZoomAIProviderConfig.SOURCE_LANGUAGES;
  }

  static getTargetLanguagesForSource(src: string): LanguageOption[] {
    return ZoomAIProviderConfig.PAIRS[src] ?? ZoomAIProviderConfig.EN_ONLY;
  }

  getConfig(): ProviderConfig {
    return {
      id: 'zoom_ai',
      displayName: 'Zoom AI Services',

      apiKeyLabel: 'API Key',
      apiKeyPlaceholder: 'Enter your Zoom Build Platform API Key',

      languages: ZoomAIProviderConfig.SOURCE_LANGUAGES,
      voices: ZoomAIProviderConfig.VOICES,
      models: ZoomAIProviderConfig.MODELS,
      noiseReductionModes: [],
      transcriptModels: [],

      capabilities: {
        hasTemplateMode: false,
        hasTurnDetection: false,
        hasVoiceSettings: false,
        hasNoiseReduction: false,
        hasModelConfiguration: false,
        textOnlyCapability: 'always',
        turnDetection: {
          modes: [],
          hasThreshold: false,
          hasPrefixPadding: false,
          hasSilenceDuration: false,
          hasSemanticEagerness: false,
        },
        temperatureRange: { min: 0.0, max: 1.0, step: 0.1 },
        maxTokensRange: { min: 1, max: 4096, step: 1 },
      },

      defaults: {
        model: 'zoom-scribe-translator-v1',
        voice: '',
        temperature: 0.8,
        maxTokens: 4096,
        sourceLanguage: 'ja-JP',
        targetLanguage: 'en-US',
        turnDetectionMode: 'Auto',
        threshold: 0.5,
        prefixPadding: 0.0,
        silenceDuration: 0.0,
        semanticEagerness: 'Auto',
        noiseReduction: 'None',
        transcriptModel: 'auto',
      },
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/services/providers/ZoomAIProviderConfig.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/providers/ZoomAIProviderConfig.ts src/services/providers/ZoomAIProviderConfig.test.ts
git commit -m "feat(zoom-ai): provider config with asymmetric language matrix"
```

---

## Task 5: Session config type

**Files:**
- Modify: `src/services/interfaces/IClient.ts` (add interface near L145, union L193, guard near L216)

**Interfaces:**
- Produces: `ZoomAISessionConfig`, `isZoomAISessionConfig`.

- [ ] **Step 1: Add the session config interface**

After `VolcengineSTSessionConfig` (~L145):
```typescript
export interface ZoomAISessionConfig extends BaseSessionConfig {
  provider: 'zoom_ai';
  sourceLanguage: string;
  targetLanguages: string[];
}
```

- [ ] **Step 2: Add to the SessionConfig union (L193)**
```typescript
export type SessionConfig = OpenAISessionConfig | OpenAITranslateSessionConfig | GeminiSessionConfig | PalabraAISessionConfig | VolcengineSTSessionConfig | VolcengineAST2SessionConfig | LocalInferenceSessionConfig | ZoomAISessionConfig;
```

- [ ] **Step 3: Add the type guard (after the Volcengine guard ~L216)**
```typescript
export function isZoomAISessionConfig(config: SessionConfig): config is ZoomAISessionConfig {
  return config.provider === 'zoom_ai';
}
```

- [ ] **Step 4: Build check**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/services/interfaces/IClient.ts
git commit -m "feat(zoom-ai): ZoomAISessionConfig type + guard"
```

---

## Task 6: Zoom VAD worker

**Files:**
- Create: `src/lib/local-inference/workers/zoom-vad.worker.ts`

**Interfaces:**
- Consumes (messages IN): `{ type: 'init' }` | `{ type: 'audio', pcm: Int16Array, sampleRate: number }` | `{ type: 'flush' }` | `{ type: 'dispose' }`.
- Produces (messages OUT): `{ type: 'ready' }` | `{ type: 'speech_start' }` | `{ type: 'utterance', audio: Float32Array }` | `{ type: 'error', message: string }`.

**Reference:** mirrors the VAD half of `src/lib/local-inference/workers/whisper-webgpu.worker.ts` (constants L69-124, `initVad` L126-164, `feedAudio` framing L342-411) but replaces `runWhisper(ev.audio, …)` with posting the utterance. Verify the exact `_shared` import paths against that file at implementation time.

- [ ] **Step 1: Write the worker**

`src/lib/local-inference/workers/zoom-vad.worker.ts`:
```typescript
/**
 * Client-side Silero VAD segmenter for the Zoom AI cascade provider.
 * Receives PCM16 frames, resamples to 16 kHz, runs Silero VAD, and posts each
 * detected utterance (Float32Array @16k) back to the main thread. No ASR here —
 * the ZoomAIClient sends utterances to Zoom Scribe over HTTPS.
 *
 * VAD scaffolding mirrors whisper-webgpu.worker.ts (same constants/loop).
 */
import { InferenceSession, Tensor } from './_shared/onnxruntime-all';
import { FrameProcessor, Message } from '@ricky0123/vad-web';
import type { FrameProcessorEvent } from '@ricky0123/vad-web/dist/frame-processor';

const VAD_SAMPLE_RATE = 16000;
const VAD_FRAME_SAMPLES = 512; // 32ms @ 16kHz
const VAD_FRAME_MS = (VAD_FRAME_SAMPLES / VAD_SAMPLE_RATE) * 1000;

interface VadSession { session: InferenceSession; state: Tensor; }
let vadSession: VadSession | null = null;
let frameProcessor: FrameProcessor | null = null;
let audioBuffer = new Float32Array(0);
let maxSpeechFrames = Math.ceil(20000 / VAD_FRAME_MS);
let speechFramesSinceStart = 0;
let processing = false;

const post = (msg: any, transfer?: Transferable[]) =>
  (self as any).postMessage(msg, transfer ?? []);

/** Linear resample Int16 PCM to Float32 [-1,1] @ 16kHz. */
function resampleInt16ToFloat32_16k(samples: Int16Array, sampleRate: number): Float32Array {
  const float = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) float[i] = samples[i] / 32768;
  if (sampleRate === VAD_SAMPLE_RATE) return float;
  const ratio = VAD_SAMPLE_RATE / sampleRate;
  const outLen = Math.floor(float.length * ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const srcPos = i / ratio;
    const idx = Math.floor(srcPos);
    const frac = srcPos - idx;
    const a = float[idx] ?? 0;
    const b = float[idx + 1] ?? a;
    out[i] = a + (b - a) * frac;
  }
  return out;
}

async function vadInfer(frame: Float32Array): Promise<{ isSpeech: number; notSpeech: number }> {
  if (!vadSession) return { isSpeech: 0, notSpeech: 1 };
  const input = new Tensor('float32', frame, [1, VAD_FRAME_SAMPLES]);
  const sr = new Tensor('int64', BigInt64Array.from([BigInt(VAD_SAMPLE_RATE)]), []);
  const result = await vadSession.session.run({ input, sr, state: vadSession.state });
  vadSession.state = result.stateN as Tensor;
  const prob = (result.output as Tensor).data[0] as number;
  return { isSpeech: prob, notSpeech: 1 - prob };
}

function vadResetStates() {
  if (!vadSession) return;
  vadSession.state = new Tensor('float32', new Float32Array(2 * 128), [2, 1, 128]);
}

async function initVad(): Promise<void> {
  const session = await InferenceSession.create('./wasm/vad/silero_vad_v5.onnx', {
    executionProviders: ['wasm'],
  });
  vadSession = { session, state: new Tensor('float32', new Float32Array(2 * 128), [2, 1, 128]) };
  frameProcessor = new FrameProcessor(
    vadInfer,
    vadResetStates,
    {
      positiveSpeechThreshold: 0.3,
      negativeSpeechThreshold: 0.25,
      redemptionMs: 1400,
      minSpeechMs: 400,
      preSpeechPadMs: 800,
      submitUserSpeechOnPause: false,
    },
    VAD_FRAME_MS,
  );
  frameProcessor.resume();
  audioBuffer = new Float32Array(0);
  post({ type: 'ready' });
}

function emitUtterance(audio: Float32Array) {
  post({ type: 'utterance', audio }, [audio.buffer]);
}

async function feedAudio(samples: Int16Array, sampleRate: number): Promise<void> {
  if (!vadSession || !frameProcessor || processing) return;
  processing = true;
  try {
    const resampled = resampleInt16ToFloat32_16k(samples, sampleRate);
    const newBuf = new Float32Array(audioBuffer.length + resampled.length);
    newBuf.set(audioBuffer);
    newBuf.set(resampled, audioBuffer.length);
    audioBuffer = newBuf;

    while (audioBuffer.length >= VAD_FRAME_SAMPLES) {
      const frame = audioBuffer.slice(0, VAD_FRAME_SAMPLES);
      audioBuffer = audioBuffer.slice(VAD_FRAME_SAMPLES);
      const events: FrameProcessorEvent[] = [];
      await frameProcessor.process(frame, (ev) => events.push(ev));
      for (const ev of events) {
        switch (ev.msg) {
          case Message.SpeechStart:
            speechFramesSinceStart = 0;
            post({ type: 'speech_start' });
            break;
          case Message.SpeechEnd:
            speechFramesSinceStart = 0;
            emitUtterance(ev.audio);
            break;
          case Message.VADMisfire:
            speechFramesSinceStart = 0;
            break;
        }
      }
      if (frameProcessor.speaking) {
        speechFramesSinceStart++;
        if (speechFramesSinceStart >= maxSpeechFrames) {
          const endEvents: FrameProcessorEvent[] = [];
          frameProcessor.endSegment((ev) => endEvents.push(ev));
          for (const ev of endEvents) {
            if (ev.msg === Message.SpeechEnd) emitUtterance(ev.audio);
          }
          speechFramesSinceStart = 0;
        }
      } else {
        speechFramesSinceStart = 0;
      }
    }
  } finally {
    processing = false;
  }
}

function flush(): void {
  if (!frameProcessor) return;
  const endEvents: FrameProcessorEvent[] = [];
  frameProcessor.endSegment((ev) => endEvents.push(ev));
  for (const ev of endEvents) {
    if (ev.msg === Message.SpeechEnd) emitUtterance(ev.audio);
  }
  speechFramesSinceStart = 0;
}

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data;
  try {
    switch (msg.type) {
      case 'init': await initVad(); break;
      case 'audio': await feedAudio(msg.pcm as Int16Array, msg.sampleRate as number); break;
      case 'flush': flush(); break;
      case 'dispose':
        vadSession?.session?.release?.();
        vadSession = null; frameProcessor = null; audioBuffer = new Float32Array(0);
        break;
    }
  } catch (err: any) {
    post({ type: 'error', message: err?.message ?? String(err) });
  }
};
```

- [ ] **Step 2: Build check (worker bundling)**

Run: `npm run build`
Expected: succeeds and emits the worker bundle. If `./_shared/onnxruntime-all` import path differs, correct it to match `whisper-webgpu.worker.ts`'s import.

- [ ] **Step 3: Commit**

```bash
git add src/lib/local-inference/workers/zoom-vad.worker.ts
git commit -m "feat(zoom-ai): client-side Silero VAD worker (utterance segmenter)"
```

---

## Task 7: ZoomAIClient

**Files:**
- Create: `src/services/clients/ZoomAIClient.ts`
- Test: `src/services/clients/ZoomAIClient.test.ts`

**Interfaces:**
- Consumes: `ZoomJwtSigner` (Task 2); `encodeWavDataUri`, `transcribe`, `translate`, `ZoomApiError` (Task 3); `ZoomAISessionConfig`, `isZoomAISessionConfig`, `IClient`, `ClientEventHandlers`, `ConversationItem` (Tasks 5 + interfaces); the VAD worker (Task 6).
- Produces: `class ZoomAIClient implements IClient` with `constructor(apiKey: string, apiSecret: string)` and `static validateApiKeyAndFetchModels(apiKey: string, apiSecret: string)`.

- [ ] **Step 1: Write the failing test (cascade emit, worker + fetch mocked)**

`src/services/clients/ZoomAIClient.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the REST layer so the cascade can be tested without network.
vi.mock('./zoom/zoomApi', () => ({
  encodeWavDataUri: () => 'data:audio/wav;base64,AAAA',
  transcribe: vi.fn(async () => 'こんにちは'),
  translate: vi.fn(async () => 'Hello'),
  ZoomApiError: class extends Error {},
}));
// Worker is not available in jsdom — stub the module that creates it.
vi.mock('./zoom/createVadWorker', () => ({ createVadWorker: () => null }));

import { ZoomAIClient } from './ZoomAIClient';

describe('ZoomAIClient cascade', () => {
  let client: ZoomAIClient;
  const items: any[] = [];
  beforeEach(() => {
    items.length = 0;
    client = new ZoomAIClient('KEY', 'SECRET');
    client.setEventHandlers({ onConversationUpdated: (d) => items.push(d.item) });
    (client as any).currentConfig = { provider: 'zoom_ai', sourceLanguage: 'ja-JP', targetLanguages: ['en-US'] };
  });

  it('emits a user (transcript) then assistant (translation) item for an utterance', async () => {
    await (client as any).handleUtterance(new Float32Array(1600));
    const roles = items.map((i) => i.role);
    expect(roles).toEqual(['user', 'assistant']);
    expect(items[0].formatted.transcript).toBe('こんにちは');
    expect(items[1].formatted.transcript).toBe('Hello');
    expect(items[1].status).toBe('completed');
  });

  it('reports provider id', () => {
    expect(client.getProvider()).toBe('zoom_ai');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/services/clients/ZoomAIClient.test.ts`
Expected: FAIL — cannot resolve `./ZoomAIClient`.

- [ ] **Step 3: Write a tiny worker factory (so it can be mocked in tests)**

`src/services/clients/zoom/createVadWorker.ts`:
```typescript
/** Isolated factory so ZoomAIClient can be unit-tested with the worker stubbed. */
export function createVadWorker(): Worker {
  return new Worker(
    new URL('../../../lib/local-inference/workers/zoom-vad.worker.ts', import.meta.url),
    { type: 'module' },
  );
}
```

- [ ] **Step 4: Write the client**

`src/services/clients/ZoomAIClient.ts`:
```typescript
import {
  IClient, SessionConfig, ClientEventHandlers, ConversationItem,
  ResponseConfig, ApiKeyValidationResult, FilteredModel,
  ZoomAISessionConfig, isZoomAISessionConfig,
} from '../interfaces/IClient';
import { Provider, ProviderType } from '../../types/Provider';
import { ZoomJwtSigner } from './zoom/ZoomJwtSigner';
import { encodeWavDataUri, transcribe, translate, ZoomApiError } from './zoom/zoomApi';
import { createVadWorker } from './zoom/createVadWorker';

const VAD_INPUT_SAMPLE_RATE = 24000; // Sokuji recorder output

export class ZoomAIClient implements IClient {
  private apiKey: string;
  private apiSecret: string;
  private signer: ZoomJwtSigner;
  private worker: Worker | null = null;
  private eventHandlers: ClientEventHandlers = {};
  private conversationItems: ConversationItem[] = [];
  private currentConfig: ZoomAISessionConfig | null = null;
  private connected = false;
  private instanceId: string;
  private itemCounter = 0;

  constructor(apiKey: string, apiSecret: string) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.signer = new ZoomJwtSigner(apiKey, apiSecret);
    this.instanceId = `zoom_ai_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  }

  private nextId(kind: string): string {
    return `${this.instanceId}_${kind}_${++this.itemCounter}`;
  }

  async connect(config: SessionConfig): Promise<void> {
    if (!isZoomAISessionConfig(config)) {
      throw new Error('Invalid session config for Zoom AI client');
    }
    this.currentConfig = config;
    this.conversationItems = [];

    await new Promise<void>((resolve, reject) => {
      const worker = createVadWorker();
      if (!worker) { this.connected = true; resolve(); return; } // test/no-worker env
      this.worker = worker;
      const timer = setTimeout(() => reject(new Error('VAD worker init timeout')), 15000);
      worker.onmessage = (e: MessageEvent) => {
        const msg = e.data;
        if (msg.type === 'ready') {
          clearTimeout(timer);
          this.connected = true;
          this.eventHandlers.onOpen?.();
          resolve();
        } else if (msg.type === 'speech_start') {
          this.eventHandlers.onRealtimeEvent?.({ source: 'client', event: { type: 'zoom.speech_start', data: {} } });
        } else if (msg.type === 'utterance') {
          void this.handleUtterance(msg.audio as Float32Array);
        } else if (msg.type === 'error') {
          this.eventHandlers.onError?.(new Error(msg.message));
        }
      };
      worker.onerror = (err) => { clearTimeout(timer); reject(err); };
      // Resolve ORT wasm + Silero model on the MAIN thread (self.location is
      // unreliable across Electron/extension/web) — same pattern as AsrEngine.
      worker.postMessage({
        type: 'init',
        ortWasmBaseUrl: new URL('./wasm/ort/', window.location.href).href,
        vadModelUrl: new URL('./wasm/vad/silero_vad_v5.onnx', window.location.href).href,
      });
    });
  }

  private async handleUtterance(audio: Float32Array): Promise<void> {
    const cfg = this.currentConfig;
    if (!cfg) return;
    const target = cfg.targetLanguages[0];
    try {
      const token = await this.signer.getToken();
      const wav = encodeWavDataUri(audio, 16000);
      const transcriptText = await transcribe(token, wav, cfg.sourceLanguage);
      if (!transcriptText) return;

      const userItem: ConversationItem = {
        id: this.nextId('user'), role: 'user', type: 'message', status: 'completed',
        createdAt: Date.now(),
        formatted: { transcript: transcriptText, text: transcriptText },
        content: [{ type: 'text', text: transcriptText }],
      };
      this.conversationItems.push(userItem);
      this.eventHandlers.onConversationUpdated?.({ item: userItem });

      const translated = await translate(token, transcriptText, cfg.sourceLanguage, target);
      if (!translated) return;

      const asstItem: ConversationItem = {
        id: this.nextId('asst'), role: 'assistant', type: 'message', status: 'completed',
        createdAt: Date.now(),
        formatted: { transcript: translated, text: translated },
        content: [{ type: 'text', text: translated }],
      };
      this.conversationItems.push(asstItem);
      this.eventHandlers.onConversationUpdated?.({ item: asstItem });
    } catch (err) {
      this.emitError(err);
    }
  }

  private emitError(err: unknown): void {
    const message = err instanceof ZoomApiError
      ? `[Zoom ${err.status}${err.reason ? ` ${err.reason}` : ''}] ${err.message}`
      : (err as Error)?.message ?? String(err);
    const errorItem: ConversationItem = {
      id: this.nextId('error'), role: 'system', type: 'error', status: 'completed',
      formatted: { text: message }, content: [{ type: 'text', text: message }],
    };
    this.conversationItems.push(errorItem);
    this.eventHandlers.onConversationUpdated?.({ item: errorItem });
    this.eventHandlers.onError?.(err);
  }

  appendInputAudio(audioData: Int16Array): void {
    if (!this.worker || !this.connected) return;
    // Copy so the transferable buffer is not detached from the caller's view.
    const pcm = new Int16Array(audioData);
    this.worker.postMessage({ type: 'audio', pcm, sampleRate: VAD_INPUT_SAMPLE_RATE }, [pcm.buffer]);
  }

  createResponse(_config?: ResponseConfig): void {
    this.worker?.postMessage({ type: 'flush' }); // PTT key-release: flush pending utterance
  }

  cancelResponse(_trackId?: string, _offset?: number): void {
    // Nothing streamed to cancel; utterances complete atomically.
  }

  appendInputText(_text: string): void {
    console.warn('[ZoomAIClient] Text input is not supported');
  }

  async disconnect(): Promise<void> {
    if (this.worker) {
      this.worker.postMessage({ type: 'dispose' });
      this.worker.terminate();
      this.worker = null;
    }
    this.connected = false;
    this.eventHandlers.onClose?.({});
  }

  isConnected(): boolean { return this.connected; }

  updateSession(_config: Partial<SessionConfig>): void {
    console.warn('[ZoomAIClient] Session updates are not supported. Reconnect to change languages.');
  }

  reset(): void { this.conversationItems = []; this.itemCounter = 0; }
  getConversationItems(): ConversationItem[] { return [...this.conversationItems]; }
  clearConversationItems(): void { this.conversationItems = []; }
  setEventHandlers(handlers: ClientEventHandlers): void { this.eventHandlers = { ...handlers }; }
  getProvider(): ProviderType { return Provider.ZOOM_AI; }

  static async validateApiKeyAndFetchModels(
    apiKey: string,
    apiSecret: string,
  ): Promise<{ validation: ApiKeyValidationResult; models: FilteredModel[] }> {
    if (!apiKey || !apiSecret) {
      return { validation: { valid: false, message: '', validating: false }, models: [] };
    }
    try {
      const signer = new ZoomJwtSigner(apiKey, apiSecret);
      const token = await signer.getToken();
      // Cheapest reachable call that exercises auth + plan: a tiny translate.
      await translate(token, 'test', 'en-US', 'zh-CN');
      return {
        validation: { valid: true, message: 'API key validated', validating: false },
        models: [{ id: 'zoom-scribe-translator-v1', type: 'realtime', created: Date.now() }],
      };
    } catch (err) {
      const message = err instanceof ZoomApiError
        ? `${err.status}${err.reason ? ` ${err.reason}` : ''}: ${err.message}`
        : (err as Error)?.message ?? 'Validation failed';
      return { validation: { valid: false, message, validating: false }, models: [] };
    }
  }
}
```

> Note: confirm `ApiKeyValidationResult` and `FilteredModel` are exported from `../interfaces/IClient` (they are used by `IClientStatic`). If they live elsewhere, adjust the import to match VolcengineSTClient's imports.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test -- src/services/clients/ZoomAIClient.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/services/clients/ZoomAIClient.ts src/services/clients/zoom/createVadWorker.ts src/services/clients/ZoomAIClient.test.ts
git commit -m "feat(zoom-ai): ZoomAIClient (VAD → Scribe → Translator cascade)"
```

---

## Task 8: settingsStore wiring

**Files:**
- Modify: `src/stores/settingsStore.ts` (mirror every Volcengine ST site: settings type, defaults, state field + initial, action decl + impl, hooks, session-config helper + case, getCurrentProviderSettings case, validateApiKey branches; import `ZoomAISessionConfig`)

**Interfaces:**
- Consumes: `ZoomAISessionConfig` (Task 5).
- Produces: `ZoomAISettings`, `useZoomAISettings`, `useUpdateZoomAI`, `state.zoomAI`, `Provider.ZOOM_AI` handled in `createSessionConfig` / `getCurrentProviderSettings` / `validateApiKey`.

- [ ] **Step 1: Add the settings type (near `VolcengineSTSettings`, ~L140)**
```typescript
// Zoom AI Services Settings
export interface ZoomAISettings {
  apiKey: string;
  apiSecret: string;
  sourceLanguage: string;
  targetLanguage: string;
}
```

- [ ] **Step 2: Add defaults (near `defaultVolcengineSTSettings`, ~L320)**
```typescript
const defaultZoomAISettings: ZoomAISettings = {
  apiKey: '',
  apiSecret: '',
  sourceLanguage: 'ja-JP',
  targetLanguage: 'en-US',
};
```

- [ ] **Step 3: Add store field (~L374) + initial state (~L801)**

Field (interface):
```typescript
  zoomAI: ZoomAISettings;
```
Initial state:
```typescript
    zoomAI: defaultZoomAISettings,
```

- [ ] **Step 4: Add action declaration (~L456) + impl (~L1102)**

Declaration:
```typescript
  updateZoomAI: (settings: Partial<ZoomAISettings>) => void;
```
Impl (after `updateVolcengineST`):
```typescript
    updateZoomAI: async (settings) => {
      set((state) => ({ zoomAI: { ...state.zoomAI, ...settings } }));
      try {
        const service = ServiceFactory.getSettingsService();
        for (const [key, value] of Object.entries(settings)) {
          await service.setSetting(`settings.zoomAI.${key}`, value);
        }
      } catch (error) {
        console.error('[SettingsStore] Error persisting Zoom AI settings:', error);
      }
    },
```

- [ ] **Step 5: Add hooks (near the Volcengine hooks, ~L1731 / ~L1780)**
```typescript
export const useZoomAISettings = () => useSettingsStore((state) => state.zoomAI);
```
```typescript
export const useUpdateZoomAI = () => useSettingsStore((state) => state.updateZoomAI);
```

- [ ] **Step 6: Session config helper (near `createVolcengineSTSessionConfig`, ~L597) + import**

Import (extend the IClient type import at ~L13 to include `ZoomAISessionConfig`).
```typescript
function createZoomAISessionConfig(
  settings: ZoomAISettings,
  systemInstructions: string,
): ZoomAISessionConfig {
  return {
    provider: 'zoom_ai',
    model: 'zoom-scribe-translator-v1',
    instructions: systemInstructions,
    sourceLanguage: settings.sourceLanguage,
    targetLanguages: [settings.targetLanguage],
    textOnly: true,
  };
}
```

- [ ] **Step 7: Dispatch cases**

`createSessionConfig` (near L1676):
```typescript
        case Provider.ZOOM_AI:
          config = createZoomAISessionConfig(state.zoomAI, systemInstructions);
          break;
```
`getCurrentProviderSettings` (near L1584):
```typescript
        case Provider.ZOOM_AI:
          return state.zoomAI;
```

- [ ] **Step 8: validateApiKey branches (mirror the three Volcengine ST spots)**

Credential resolution (near L1295, add an `else if`):
```typescript
      } else if (provider === Provider.ZOOM_AI) {
        const zoomSettings = currentSettings as ZoomAISettings;
        apiKey = zoomSettings.apiKey || '';
        if (!zoomSettings.apiKey || !zoomSettings.apiSecret) {
          set({ isApiKeyValid: null, availableModels: [], validationMessage: '', isValidating: false });
          return { valid: false, message: '', validating: false };
        }
```
Cache key (near L1331):
```typescript
      } else if (provider === Provider.ZOOM_AI) {
        cacheKey = `${provider}:${apiKey}:${(currentSettings as ZoomAISettings).apiSecret}`;
```
clientSecret resolution (near L1362):
```typescript
        } else if (provider === Provider.ZOOM_AI) {
          clientSecret = (currentSettings as ZoomAISettings).apiSecret;
```

- [ ] **Step 9: Build + existing tests**

Run: `npm run build && npm run test -- src/stores`
Expected: build succeeds; store tests pass.

- [ ] **Step 10: Commit**

```bash
git add src/stores/settingsStore.ts
git commit -m "feat(zoom-ai): settingsStore wiring (settings, session config, validate)"
```

---

## Task 9: ClientOperations + ClientFactory

**Files:**
- Modify: `src/services/ClientOperations.ts` (import; case in `validateApiKeyAndFetchModels` ~L81; case in `getLatestRealtimeModel` ~L147)
- Modify: `src/services/clients/ClientFactory.ts` (import L9; env import L13; case ~L133)

**Interfaces:**
- Consumes: `ZoomAIClient` (Task 7); `isZoomAIEnabled` (Task 1).

- [ ] **Step 1: ClientOperations — import + cases**

Import (near L5):
```typescript
import { ZoomAIClient } from './clients/ZoomAIClient';
```
`validateApiKeyAndFetchModels` case:
```typescript
      case Provider.ZOOM_AI:
        if (!clientSecret || !apiKey) {
          return {
            validation: { valid: false, message: 'Both API Key and API Secret are required for Zoom AI Services', validating: false },
            models: [],
          };
        }
        return await ZoomAIClient.validateApiKeyAndFetchModels(apiKey, clientSecret);
```
`getLatestRealtimeModel` case:
```typescript
      case Provider.ZOOM_AI:
        return 'zoom-scribe-translator-v1';
```

- [ ] **Step 2: ClientFactory — import + env import + case**

Import (L9):
```typescript
import { ZoomAIClient } from './ZoomAIClient';
```
Env import (L13) — add `isZoomAIEnabled`.
Case (near L133):
```typescript
      case Provider.ZOOM_AI:
        if (!isZoomAIEnabled()) {
          throw new Error(`Provider ${provider} is not available in this build`);
        }
        if (!clientSecret) {
          throw new Error(`API Secret is required for ${provider} provider`);
        }
        // apiKey = Zoom API Key, clientSecret = Zoom API Secret
        return new ZoomAIClient(apiKey, clientSecret);
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/services/ClientOperations.ts src/services/clients/ClientFactory.ts
git commit -m "feat(zoom-ai): register client in ClientFactory + ClientOperations"
```

---

## Task 10: ProviderConfigFactory registration

**Files:**
- Modify: `src/services/providers/ProviderConfigFactory.ts` (import; env import L13; registration block ~L50)

- [ ] **Step 1: Import + register**

Import (near L9):
```typescript
import { ZoomAIProviderConfig } from './ZoomAIProviderConfig';
```
Env import (L13) — add `isZoomAIEnabled`.
Registration (after the Volcengine ST block ~L50):
```typescript
    // Only register Zoom AI Services if the feature flag is enabled
    if (isZoomAIEnabled()) {
      ProviderConfigFactory.configs.set(Provider.ZOOM_AI, new ZoomAIProviderConfig());
    }
```
> `ZoomAIProviderConfig` is used via `new ...().getConfig()`? Check how `VolcengineSTProviderConfig` is stored: the factory stores the instance. `getAllConfigs()` calls `getConfig()` on each. Match whatever the factory expects (store `new ZoomAIProviderConfig()`; it exposes `getConfig()` like Volcengine).

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: succeeds; the provider now appears in `getAllConfigs()` when the flag is on.

- [ ] **Step 3: Commit**

```bash
git add src/services/providers/ProviderConfigFactory.ts
git commit -m "feat(zoom-ai): register ZoomAIProviderConfig behind flag"
```

---

## Task 11: Settings UI wiring

**Files:**
- Modify: `src/components/Settings/sections/ProviderSection.tsx` (hooks; `getCurrentApiKey` ~L184; `updateApiKey` ~L212; `getProviderInfoById` ~L302; credential block ~L558-595)
- Modify: `src/components/Settings/sections/ProviderSpecificSettings.tsx` (hooks ~L107/L124; import; update branch ~L390; `renderZoomAISettings()`; invocation ~L2419)
- Modify: `src/components/MainPanel/MainPanel.tsx` (hook ~L260; clientSecret block ~L525; apiKey switch ~L1475; useCallback deps)

**Interfaces:**
- Consumes: `useZoomAISettings`, `useUpdateZoomAI` (Task 8); `ZoomAIProviderConfig` (Task 4).

- [ ] **Step 1: ProviderSection.tsx — hooks + cases**

Add hooks (near the Volcengine hooks):
```typescript
  const zoomAISettings = useZoomAISettings();
  const updateZoomAISettings = useUpdateZoomAI();
```
(import both from `../../../stores/settingsStore` alongside the existing Volcengine hook imports.)

`getCurrentApiKey` case:
```typescript
      case Provider.ZOOM_AI:
        return zoomAISettings.apiKey;
```
`updateApiKey` case:
```typescript
      case Provider.ZOOM_AI:
        updateZoomAISettings({ apiKey: value });
        break;
```
`getProviderInfoById` case (use a generic Zoom-ish icon already imported, or reuse an existing one; do not invent a missing import):
```typescript
      case Provider.ZOOM_AI:
        return {
          name: t('providers.zoom_ai.name', 'Zoom AI Services'),
          icon: VolcengineIcon, // TODO: swap for a Zoom icon when available; reuse an existing icon to avoid a broken import
          description: t('providers.zoom_ai.description', 'Zoom Scribe transcription + Translator (text only)')
        };
```

- [ ] **Step 2: ProviderSection.tsx — two-field credential block**

Add another branch in the credential render chain (after the Volcengine ST branch, before Palabra):
```tsx
        ) : provider === Provider.ZOOM_AI ? (
          // Zoom AI requires both an API Key and an API Secret (Build Platform)
          <div className="volcengine-st-credentials-group">
            <div className="api-key-input-group">
              <input
                type="text"
                value={zoomAISettings.apiKey}
                onChange={(e) => updateZoomAISettings({ apiKey: e.target.value })}
                placeholder={t('providers.zoom_ai.apiKeyPlaceholder', 'API Key')}
                className={`api-key-input ${isApiKeyValid === true ? 'valid' : isApiKeyValid === false ? 'invalid' : ''}`}
                disabled={isSessionActive}
              />
            </div>
            <div className="api-key-input-group">
              <input
                type="password"
                value={zoomAISettings.apiSecret}
                onChange={(e) => updateZoomAISettings({ apiSecret: e.target.value })}
                placeholder={t('providers.zoom_ai.apiSecretPlaceholder', 'API Secret')}
                className={`api-key-input ${isApiKeyValid === true ? 'valid' : isApiKeyValid === false ? 'invalid' : ''}`}
                disabled={isSessionActive}
              />
              <button
                className="validate-button"
                onClick={handleValidateApiKey}
                disabled={!zoomAISettings.apiKey || !zoomAISettings.apiSecret || isValidating || isSessionActive}
                title={t('simpleSettings.validate')}
              >
                {isValidating ? <span className="spinner" /> : isApiKeyValid ? <CheckCircle size={16} /> : t('simpleSettings.validate')}
              </button>
            </div>
          </div>
        ) : provider === Provider.PALABRA_AI ? (
```

- [ ] **Step 3: ProviderSpecificSettings.tsx — hooks, import, update branch**

Import (near L3):
```typescript
import { ZoomAIProviderConfig } from '../../../services/providers/ZoomAIProviderConfig';
```
Hooks:
```typescript
  const zoomAISettings = useZoomAISettings();
  const updateZoomAISettings = useUpdateZoomAI();
```
Update branch (near L390):
```typescript
    } else if (provider === Provider.ZOOM_AI) {
      updateZoomAISettings({ [key]: value });
```

- [ ] **Step 4: ProviderSpecificSettings.tsx — renderZoomAISettings() with source-dependent targets + locked text-only switch**

Add `import ToggleSwitch from '../shared/ToggleSwitch';` if not already imported. Then:
```tsx
  const renderZoomAISettings = () => {
    if (provider !== Provider.ZOOM_AI) return null;

    const sourceLanguages = ZoomAIProviderConfig.getSourceLanguages();
    const targetLanguages = ZoomAIProviderConfig.getTargetLanguagesForSource(zoomAISettings.sourceLanguage);

    return (
      <>
        <div className="settings-section">
          <h2>{t('settings.languageSettings', 'Language Settings')}</h2>
          <div className="setting-item">
            <div className="setting-label"><span>{t('settings.sourceLanguage')}</span></div>
            <select
              className="select-dropdown"
              value={zoomAISettings.sourceLanguage}
              onChange={(e) => {
                const newSource = e.target.value;
                const allowed = ZoomAIProviderConfig.getTargetLanguagesForSource(newSource).map((l) => l.value);
                const nextTarget = allowed.includes(zoomAISettings.targetLanguage) ? zoomAISettings.targetLanguage : allowed[0];
                updateZoomAISettings({ sourceLanguage: newSource, targetLanguage: nextTarget });
              }}
              disabled={isSessionActive}
            >
              {sourceLanguages.map((lang) => (
                <option key={lang.value} value={lang.value}>{lang.name}</option>
              ))}
            </select>
          </div>
          <div className="setting-item">
            <div className="setting-label"><span>{t('settings.targetLanguage')}</span></div>
            <select
              className="select-dropdown"
              value={zoomAISettings.targetLanguage}
              onChange={(e) => updateZoomAISettings({ targetLanguage: e.target.value })}
              disabled={isSessionActive}
            >
              {targetLanguages.map((lang) => (
                <option key={lang.value} value={lang.value}>{lang.name}</option>
              ))}
            </select>
          </div>
          <div className="setting-item">
            <ToggleSwitch
              checked={true}
              onChange={() => {}}
              label={t('simpleConfig.textOnly', 'Text Only')}
              disabled
              tooltip={t('simpleConfig.textOnlyDesc', 'Zoom AI produces text only; audio synthesis is not available.')}
            />
          </div>
        </div>

        <div className="settings-section">
          <h2>{t('settings.zoomAIInfo', 'Zoom AI Services Info')}</h2>
          <div className="setting-item">
            <div className="volcengine-st-info-notice" style={{ padding: '12px', backgroundColor: 'rgba(16, 163, 127, 0.1)', border: '1px solid rgba(16, 163, 127, 0.3)', borderRadius: '8px', fontSize: '13px', color: '#aaa' }}>
              <Info size={14} style={{ marginRight: '8px', verticalAlign: 'middle', color: '#10a37f' }} />
              {t('settings.zoomAIInfoText', 'Zoom Scribe transcribes each utterance and Zoom Translator translates it to text. Translation pairs must include English on one side.')}
            </div>
          </div>
        </div>
      </>
    );
  };
```
Invoke it near the other render calls (~L2419): `{renderZoomAISettings()}`.

- [ ] **Step 5: MainPanel.tsx — hook + clientSecret + apiKey switch**

Hook (near L260):
```typescript
  const zoomAISettings = useZoomAISettings();
```
clientSecret block (near L525, add an `else if`):
```typescript
    } else if (provider === Provider.ZOOM_AI) {
      clientSecret = zoomAISettings.apiSecret;
    }
```
Add `zoomAISettings.apiSecret` to the `useCallback` dependency array on that memo (near L540).
apiKey switch (near L1475):
```typescript
        case Provider.ZOOM_AI:
          apiKey = zoomAISettings.apiKey;
          break;
```

- [ ] **Step 6: Build + full test suite**

Run: `npm run build && npm run test`
Expected: build succeeds; all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/components/Settings/sections/ProviderSection.tsx src/components/Settings/sections/ProviderSpecificSettings.tsx src/components/MainPanel/MainPanel.tsx
git commit -m "feat(zoom-ai): settings + main panel UI wiring (locked text-only switch)"
```

---

## Task 12: i18n keys + manual integration check

**Files:**
- Modify: `src/locales/en/*.json` (or wherever provider strings live — match how `providers.volcengine_st.*` keys are defined) to add `providers.zoom_ai.name`, `.description`, `.apiKeyPlaceholder`, `.apiSecretPlaceholder`, and `settings.zoomAIInfo`, `settings.zoomAIInfoText`.

- [ ] **Step 1: Find the provider string location**

Run: `grep -rn "volcengine_st" src/locales/en | head`
Expected: shows the file(s) holding `providers.volcengine_st.*`.

- [ ] **Step 2: Add the English keys mirroring Volcengine's**

Add to the same file(s):
```json
"zoom_ai": {
  "name": "Zoom AI Services",
  "description": "Zoom Scribe transcription + Translator (text only)",
  "apiKeyPlaceholder": "Zoom Build Platform API Key",
  "apiSecretPlaceholder": "Zoom Build Platform API Secret"
}
```
and under `settings`:
```json
"zoomAIInfo": "Zoom AI Services Info",
"zoomAIInfoText": "Zoom Scribe transcribes each utterance and Zoom Translator translates it to text. Translation pairs must include English on one side."
```
(English fallback covers the other 34 locales; per project convention non-English locales fall back to English.)

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/locales
git commit -m "feat(zoom-ai): English i18n strings for the provider"
```

- [ ] **Step 5: Manual integration check (real BYOK credentials)**

Run: `npm run electron:dev` (or `npm run dev`). In Settings, select **Zoom AI Services**, enter a valid Build Platform API Key + Secret, click Validate → expect valid. Choose `ja-JP → en-US`, start a session, speak a Japanese sentence → expect a user transcript item then an English assistant item within ~2–3 s. Then choose `en-US → zh-CN` and verify. Confirm the "Text Only" switch shows on + disabled.
Expected: transcript + translation render; no audio output; errors (bad key / wrong plan) surface in the Logs panel.

- [ ] **Step 6: Extension CSP check**

Run: `grep -rn "connect-src\|api.zoom" extension/ public/ | head`
If `api.zoom.us` is not covered by the extension CSP/host permissions, add it (mirror how other provider API hosts are permitted). Rebuild the extension and re-test.

---

## Self-Review

- **Spec coverage:** cascade client (T7) ✓; VAD segmentation (T6) ✓; Scribe+Translator wrappers (T3) ✓; JWT auth (T2) ✓; asymmetric language matrix (T4, enforced in T11 UI) ✓; BYOK two-secret registration across the 7 file groups (T1, T5, T8, T9, T10, T11) ✓; locked text-only switch (T11) ✓; feature flag (T1) ✓; error handling — plan/auth/unsupported-pair/empty transcript surface via `emitError`/validate (T7) ✓; testing (T2, T3, T4, T7) ✓; no usage metering (omitted per decision) ✓.
- **Placeholder scan:** the only intentional TODO is the provider icon in `getProviderInfoById` (T11 Step 1) — it reuses an existing icon to avoid a broken import; swap when a Zoom icon asset is added. No functional placeholders remain.
- **Type consistency:** `ZoomAISettings` fields (`apiKey`, `apiSecret`, `sourceLanguage`, `targetLanguage`) are used identically in settingsStore (T8), ProviderSection (T11), ProviderSpecificSettings (T11), MainPanel (T11). `ZoomAISessionConfig` (`sourceLanguage`, `targetLanguages[]`) matches its construction in `createZoomAISessionConfig` (T8) and consumption in `ZoomAIClient.handleUtterance` (T7). `transcribe`/`translate`/`encodeWavDataUri` signatures match between zoomApi (T3) and ZoomAIClient (T7). `zoom-scribe-translator-v1` model id is consistent across T4/T7/T9.
- **Risk to verify during execution:** the VAD worker's `_shared/onnxruntime-all` import path and worker bundling (T6 Step 2); confirm `ApiKeyValidationResult`/`FilteredModel` export location (T7 note); confirm `ProviderConfigFactory` stores instances that expose `getConfig()` (T10).
