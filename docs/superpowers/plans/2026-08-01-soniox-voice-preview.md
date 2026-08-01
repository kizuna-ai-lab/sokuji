# Soniox Cloned-Voice Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-row preview button to ready cloned voices in the Soniox voice section that synthesizes a short sample over the TTS REST endpoint and plays it back, without starting a session.

**Architecture:** Two new leaf modules — a one-shot TTS REST caller (`SonioxTtsRest.ts`) and a language→sample-sentence table (`sonioxPreviewSample.ts`) — feed a generalized `onPreview` contract on the existing shared `VoiceLibrarySection`, which already owns the single-player playback plumbing. `SonioxVoiceSection` wires the two together, caches results, and maps errors into its existing banner.

**Tech Stack:** TypeScript, React 19, Vitest + @testing-library/react (jsdom), SCSS, i18next.

**Spec:** `docs/superpowers/specs/2026-08-01-soniox-voice-preview-design.md`

## Global Constraints

- TTS model is `tts-rt-v1`; preview requests `audio_format: 'pcm_s16le'` at `sample_rate: 24000`.
- `speed` is 0.7–1.3 and is **omitted from the wire when it equals 1.0** (same rule as `SonioxTtsStream.openStream`).
- Int16→Float32 conversion divides by `32768` (repo convention, `PalabraAIClient.ts:381`).
- All comments and documentation are **English only** (project CLAUDE.md).
- Every user-facing string goes through `t('key', 'English default')`, and every key added to `src/locales/en/translation.json` **must also be added to the other 29 locale directories** — `src/locales/locales.consistency.test.ts` asserts exact key parity and will fail otherwise.
- **Do not gate on `tsc`.** The repo has ~113 pre-existing type errors; the build is Vite/esbuild and the correctness gate is Vitest.
- Conventional commit format.
- Scope is BYOK cloned voices only. Do not add preview to the 28 built-ins, to managed mode, or make the sample text user-editable.
- Run single test files with `npx vitest run <path>` (the `npm run test` script starts watch mode).

---

### Task 1: One-shot TTS REST caller

**Files:**
- Create: `src/services/clients/SonioxTtsRest.ts`
- Create: `src/services/clients/SonioxTtsRest.test.ts`
- Modify: `src/services/clients/SonioxVoicesClient.ts:47` (export the existing `throwApiError`)
- Modify: `extension/manifest.json:116` (add the REST host to `connect-src`)
- Modify: `extension/manifest.consistency.test.ts` (pin the new CSP entry)

**Interfaces:**
- Consumes: `SonioxVoicesError` and `throwApiError` from `./SonioxVoicesClient`.
- Produces:
  - `synthesizeOnce(opts: SonioxTtsRestOptions): Promise<{ audio: Float32Array; sampleRate: number }>`
  - `interface SonioxTtsRestOptions { apiKey: string; voice: string; language: string; text: string; speed?: number; signal?: AbortSignal }`
  - Rejections are always `SonioxVoicesError`; `errorType` is `'aborted'` for a caller-initiated cancel, `'timeout'` for the internal deadline, `'empty_audio'` for a zero-byte body, `'network'` for transport failures, and the server's `error_type` for HTTP errors.

- [ ] **Step 1: Export `throwApiError` from `SonioxVoicesClient.ts`**

Change line 47 from `async function throwApiError(` to `export async function throwApiError(`. Nothing else in that file changes. This is reuse rather than duplication: the TTS error body (`TTSApiError`) has the same `{error_type, error_message}` shape the helper already parses.

- [ ] **Step 2: Write the failing test**

Create `src/services/clients/SonioxTtsRest.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { synthesizeOnce } from './SonioxTtsRest';

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Response whose body is little-endian Int16 PCM of the given samples. */
const pcmBody = (samples: number[]) => {
  const dv = new DataView(new ArrayBuffer(samples.length * 2));
  samples.forEach((s, i) => dv.setInt16(i * 2, s, true));
  return { ok: true, status: 200, arrayBuffer: async () => dv.buffer };
};
const errBody = (status: number, body: unknown) => ({
  ok: false,
  status,
  json: async () => body,
});
const OPTS = { apiKey: 'k', voice: 'uuid-1', language: 'ja', text: 'こんにちは。' };

describe('synthesizeOnce', () => {
  it('posts every required field with a Bearer header and omits speed at 1.0', async () => {
    fetchMock.mockResolvedValueOnce(pcmBody([0]));
    await synthesizeOnce({ ...OPTS, speed: 1.0 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://tts-rt.soniox.com/tts');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer k');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({
      model: 'tts-rt-v1',
      voice: 'uuid-1',
      language: 'ja',
      text: 'こんにちは。',
      audio_format: 'pcm_s16le',
      sample_rate: 24000,
    });
  });

  it('includes speed when it differs from the server default', async () => {
    fetchMock.mockResolvedValueOnce(pcmBody([0]));
    await synthesizeOnce({ ...OPTS, speed: 1.2 });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).speed).toBe(1.2);
  });

  it('decodes little-endian Int16 PCM into normalized Float32 at 24 kHz', async () => {
    fetchMock.mockResolvedValueOnce(pcmBody([0, 16384, -16384, 32767]));
    const { audio, sampleRate } = await synthesizeOnce(OPTS);
    expect(sampleRate).toBe(24000);
    expect(Array.from(audio)).toEqual([0, 0.5, -0.5, 32767 / 32768]);
  });

  it('maps an HTTP error body to SonioxVoicesError with its error_type', async () => {
    fetchMock.mockResolvedValueOnce(errBody(401, {
      error_code: 401, error_type: 'unauthenticated', error_message: 'bad key',
    }));
    await expect(synthesizeOnce(OPTS)).rejects.toMatchObject({
      errorType: 'unauthenticated', status: 401, message: 'bad key',
    });
  });

  it('rejects a zero-byte body rather than returning silent audio', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(0) });
    await expect(synthesizeOnce(OPTS)).rejects.toMatchObject({ errorType: 'empty_audio' });
  });

  it('does not spend a request when the caller signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(synthesizeOnce({ ...OPTS, signal: controller.signal }))
      .rejects.toMatchObject({ errorType: 'aborted' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps an in-flight abort to errorType "aborted"', async () => {
    fetchMock.mockRejectedValueOnce(new DOMException('cancelled', 'AbortError'));
    await expect(synthesizeOnce(OPTS)).rejects.toMatchObject({ errorType: 'aborted' });
  });

  it('maps the internal deadline to errorType "timeout"', async () => {
    fetchMock.mockRejectedValueOnce(new DOMException('deadline', 'TimeoutError'));
    await expect(synthesizeOnce(OPTS)).rejects.toMatchObject({ errorType: 'timeout' });
  });

  it('normalizes transport failures to errorType "network"', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(synthesizeOnce(OPTS)).rejects.toMatchObject({ errorType: 'network', status: 0 });
  });

  it('passes an AbortSignal to fetch so a cancel actually reaches the network', async () => {
    fetchMock.mockResolvedValueOnce(pcmBody([0]));
    await synthesizeOnce(OPTS);
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/services/clients/SonioxTtsRest.test.ts`
Expected: FAIL — cannot resolve `./SonioxTtsRest`.

- [ ] **Step 4: Write the implementation**

Create `src/services/clients/SonioxTtsRest.ts`:

```ts
/**
 * Soniox one-shot TTS REST component (`POST https://tts-rt.soniox.com/tts`).
 *
 * Separate from SonioxVoicesClient on purpose: that client wraps
 * `api.soniox.com/v1/voices`, whose invariant is "permanent project key only"
 * (temporary keys are live-probed 401 there). TTS lives on a different host
 * and accepts temporary keys too, so merging the two would blur that rule.
 *
 * Separate from SonioxTtsStream too: that is the session-time WebSocket wire
 * (incremental text in, streamed audio out, stream serialization, keepalive).
 * This is a single request/response call for one short utterance.
 *
 * Facts honored here (OpenAPI `CreateTTSPayload` + live probes, 2026-08-01):
 * - required: model, language, voice, audio_format, text
 * - `voice` accepts a built-in name OR a cloned-voice UUID (docs verbatim)
 * - `speed` is 0.7..1.3 with server default 1.0 — omitted at 1.0, the same
 *   rule SonioxTtsStream.openStream applies
 * - the response body is RAW audio bytes for the requested audio_format
 * - CORS is open (`access-control-allow-origin: *`), so the browser calls this
 *   directly — but the extension CSP must list `https://tts-rt.soniox.com`
 *   (it already listed only the `wss://` origin, which does NOT cover https)
 */
import { SonioxVoicesError, throwApiError } from './SonioxVoicesClient';

const TTS_REST_URL = 'https://tts-rt.soniox.com/tts';
const TTS_MODEL = 'tts-rt-v1';
const SAMPLE_RATE = 24000;
// A preview is one short sentence; anything past this is a stall, not slowness.
const REQUEST_TIMEOUT_MS = 20_000;

export interface SonioxTtsRestOptions {
  apiKey: string;
  voice: string;
  /** ISO-639-1 code; MUST match the language `text` is written in. */
  language: string;
  text: string;
  /** 0.7..1.3; 1.0 (the server default) is omitted from the wire. */
  speed?: number;
  /** Caller cancellation (e.g. the user switched to another voice). */
  signal?: AbortSignal;
}

/**
 * Synthesize one utterance and return it as mono Float32 PCM.
 *
 * Every rejection is a SonioxVoicesError so callers map ONE error shape.
 * `errorType === 'aborted'` marks a user-initiated cancel, which callers
 * should treat as a non-event rather than surfacing as a failure.
 */
export async function synthesizeOnce(
  opts: SonioxTtsRestOptions
): Promise<{ audio: Float32Array; sampleRate: number }> {
  // An already-cancelled request must not be paid for: the user's tokens are
  // spent the moment the request lands, so check before dialing out.
  if (opts.signal?.aborted) {
    throw new SonioxVoicesError('aborted', 'Preview cancelled', 0);
  }

  // An explicit controller rather than AbortSignal.any(): the deadline and the
  // caller's cancel must stay distinguishable at the catch site, and the abort
  // reason's `name` is what carries that distinction.
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new DOMException('Soniox TTS request timed out', 'TimeoutError')),
    REQUEST_TIMEOUT_MS
  );
  const forwardAbort = () => controller.abort(opts.signal?.reason);
  opts.signal?.addEventListener('abort', forwardAbort, { once: true });

  let res: Response;
  try {
    res = await fetch(TTS_REST_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${opts.apiKey}`,
      },
      body: JSON.stringify({
        model: TTS_MODEL,
        voice: opts.voice,
        language: opts.language,
        text: opts.text,
        audio_format: 'pcm_s16le',
        sample_rate: SAMPLE_RATE,
        ...(opts.speed != null && opts.speed !== 1.0 ? { speed: opts.speed } : {}),
      }),
      signal: controller.signal,
    });
  } catch (e) {
    const name = e instanceof DOMException ? e.name : '';
    if (name === 'TimeoutError') {
      throw new SonioxVoicesError('timeout', `Request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`, 408);
    }
    if (name === 'AbortError') {
      throw new SonioxVoicesError('aborted', 'Preview cancelled', 0);
    }
    throw new SonioxVoicesError('network', e instanceof Error ? e.message : String(e), 0);
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', forwardAbort);
  }

  if (!res.ok) await throwApiError(res);

  const bytes = await res.arrayBuffer();
  // A zero-byte 200 would decode to silence and read to the user as "the
  // button does nothing" — fail loudly instead.
  if (bytes.byteLength === 0) {
    throw new SonioxVoicesError('empty_audio', 'Soniox returned no audio', res.status);
  }
  // Int16Array requires an even byte length; a truncated tail is dropped
  // rather than throwing on an otherwise usable clip.
  const evenLength = bytes.byteLength - (bytes.byteLength % 2);
  const pcm = new Int16Array(bytes.slice(0, evenLength));
  const audio = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) audio[i] = pcm[i] / 32768;
  return { audio, sampleRate: SAMPLE_RATE };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/services/clients/SonioxTtsRest.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 6: Verify the voices client still passes after the export change**

Run: `npx vitest run src/services/clients/SonioxVoicesClient.test.ts`
Expected: PASS (unchanged behavior — only a visibility modifier changed).

- [ ] **Step 7: Add the REST host to the extension CSP**

In `extension/manifest.json` line 116, inside `content_security_policy.extension_pages`, append ` https://tts-rt.soniox.com` to the end of the `connect-src` list (it currently ends with `wss://tts-rt.soniox.com`). The `wss://` entry does **not** cover `https://` — CSP source expressions match the scheme literally.

Resulting tail of the directive:

```
... https://api.soniox.com wss://stt-rt.soniox.com wss://tts-rt.soniox.com https://tts-rt.soniox.com
```

- [ ] **Step 8: Pin the CSP entry with a test**

Append to the `describe` block in `extension/manifest.consistency.test.ts`:

```ts
  it('CSP connect-src allows the Soniox TTS REST host', () => {
    // Without this the preview call is blocked in the extension while working
    // fine in Electron — a silent, platform-specific failure that local
    // development never surfaces.
    const csp = (manifest as any).content_security_policy.extension_pages;
    expect(csp).toContain('https://tts-rt.soniox.com');
  });
```

- [ ] **Step 9: Run the manifest test**

Run: `npx vitest run extension/manifest.consistency.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 10: Commit**

```bash
git add src/services/clients/SonioxTtsRest.ts src/services/clients/SonioxTtsRest.test.ts \
        src/services/clients/SonioxVoicesClient.ts \
        extension/manifest.json extension/manifest.consistency.test.ts
git commit -m "feat(soniox): one-shot TTS REST caller for voice preview (#375)"
```

---

### Task 2: Preview sample-text table

**Files:**
- Create: `src/components/Settings/sections/sonioxPreviewSample.ts`
- Create: `src/components/Settings/sections/sonioxPreviewSample.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks. The test reads `new SonioxProviderConfig().getConfig().languages` from `src/services/providers/SonioxProviderConfig`.
- Produces:
  - `interface PreviewSample { language: string; text: string }`
  - `previewSampleFor(language: string): PreviewSample`

- [ ] **Step 1: Write the failing test**

Create `src/components/Settings/sections/sonioxPreviewSample.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { previewSampleFor, PREVIEW_SAMPLES } from './sonioxPreviewSample';
import { SonioxProviderConfig } from '../../../services/providers/SonioxProviderConfig';

const supported = new Set(
  new SonioxProviderConfig().getConfig().languages.map((l) => l.value)
);

describe('previewSampleFor', () => {
  it('only seeds languages Soniox can actually synthesize', () => {
    // Cross-assertion: if the provider's language list is ever trimmed, this
    // fails loudly instead of the table silently requesting a dead language.
    const unknown = Object.keys(PREVIEW_SAMPLES).filter((k) => !supported.has(k));
    expect(unknown).toEqual([]);
  });

  it('covers the 28 Soniox codes the app UI locales map onto', () => {
    expect(Object.keys(PREVIEW_SAMPLES).sort()).toEqual([
      'ar', 'bn', 'de', 'en', 'es', 'fa', 'fi', 'fr', 'he', 'hi', 'id', 'it',
      'ja', 'ko', 'ms', 'nl', 'pl', 'pt', 'ru', 'sv', 'ta', 'te', 'th', 'tl',
      'tr', 'uk', 'vi', 'zh',
    ]);
  });

  it('returns the requested language paired with its own sentence', () => {
    expect(previewSampleFor('ja')).toEqual({ language: 'ja', text: PREVIEW_SAMPLES.ja });
    expect(previewSampleFor('zh')).toEqual({ language: 'zh', text: PREVIEW_SAMPLES.zh });
  });

  it('falls back to the English pair for an unseeded language', () => {
    // 'cy' (Welsh) is a real Soniox target language with no seeded sentence.
    expect(previewSampleFor('cy')).toEqual({ language: 'en', text: PREVIEW_SAMPLES.en });
  });

  it('falls back to the English pair for an unknown or empty language', () => {
    expect(previewSampleFor('')).toEqual({ language: 'en', text: PREVIEW_SAMPLES.en });
    expect(previewSampleFor('klingon')).toEqual({ language: 'en', text: PREVIEW_SAMPLES.en });
  });

  it('never returns a language whose text came from a different language', () => {
    // The pair is the whole point: a mismatched (text, language) makes Soniox
    // read the sentence with the wrong phonology.
    for (const code of [...supported]) {
      const sample = previewSampleFor(code);
      expect(sample.text).toBe(PREVIEW_SAMPLES[sample.language]);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/Settings/sections/sonioxPreviewSample.test.ts`
Expected: FAIL — cannot resolve `./sonioxPreviewSample`.

- [ ] **Step 3: Write the implementation**

Create `src/components/Settings/sections/sonioxPreviewSample.ts`:

```ts
/**
 * Sample sentences spoken when auditioning a Soniox voice.
 *
 * These are TTS *input*, not UI copy: the key is the TTS target language, not
 * the user's UI locale, so they deliberately live here as literals instead of
 * going through i18n. Soniox's REST payload requires `language` alongside
 * `text`, and a mismatched pair makes the model read the sentence with the
 * wrong phonology — hence `previewSampleFor` returns the pair, never a bare
 * string, so no caller can construct the mismatch.
 *
 * Seeded with the 28 Soniox codes the app's 30 UI locales map onto
 * (`fil→tl`, `pt_BR`/`pt_PT→pt`, `zh_CN`/`zh_TW→zh`) — i.e. the languages
 * the product actually serves. The remaining Soniox target languages fall
 * back to English; timbre still reads correctly because cloned voices are
 * officially any-voice-any-language.
 *
 * Sentences are neutral (they never say "cloned") so the table can be reused
 * if built-in voice preview lands later, and short (~2-3 s) to keep each
 * audition cheap and fast.
 */

export interface PreviewSample {
  language: string;
  text: string;
}

export const PREVIEW_SAMPLES: Record<string, string> = {
  ar: 'مرحبًا. هذه عينة قصيرة لصوت هذا المتحدث.',
  bn: 'নমস্কার। এটি এই কণ্ঠস্বরের একটি সংক্ষিপ্ত নমুনা।',
  de: 'Hallo. Dies ist eine kurze Hörprobe dieser Stimme.',
  en: 'Hello. This is a short preview of how this voice sounds.',
  es: 'Hola. Esta es una breve muestra de cómo suena esta voz.',
  fa: 'سلام. این یک نمونه کوتاه از صدای این گوینده است.',
  fi: 'Hei. Tämä on lyhyt näyte siitä, miltä tämä ääni kuulostaa.',
  fr: 'Bonjour. Voici un bref aperçu du son de cette voix.',
  he: 'שלום. זו דוגמה קצרה לאיך הקול הזה נשמע.',
  hi: 'नमस्ते। यह इस आवाज़ का एक छोटा सा नमूना है।',
  id: 'Halo. Ini adalah contoh singkat suara ini.',
  it: 'Ciao. Questa è una breve anteprima di come suona questa voce.',
  ja: 'こんにちは。これはこの声の短い試聴です。',
  ko: '안녕하세요. 이 목소리의 짧은 미리 듣기입니다.',
  ms: 'Helo. Ini ialah contoh pendek bunyi suara ini.',
  nl: 'Hallo. Dit is een korte voorproef van hoe deze stem klinkt.',
  pl: 'Cześć. To krótka próbka tego, jak brzmi ten głos.',
  pt: 'Olá. Esta é uma breve amostra de como esta voz soa.',
  ru: 'Здравствуйте. Это короткий пример того, как звучит этот голос.',
  sv: 'Hej. Det här är ett kort smakprov på hur den här rösten låter.',
  ta: 'வணக்கம். இது இந்தக் குரலின் ஒரு சிறு மாதிரி.',
  te: 'నమస్కారం. ఇది ఈ స్వరం యొక్క ఒక చిన్న నమూనా.',
  th: 'สวัสดี นี่คือตัวอย่างสั้น ๆ ของเสียงนี้',
  tl: 'Kumusta. Ito ay isang maikling halimbawa ng tunog ng boses na ito.',
  tr: 'Merhaba. Bu, bu sesin nasıl duyulduğuna dair kısa bir örnektir.',
  uk: 'Вітаю. Це короткий приклад того, як звучить цей голос.',
  vi: 'Xin chào. Đây là đoạn nghe thử ngắn của giọng nói này.',
  zh: '你好，这是这个声音的简短试听。',
};

const FALLBACK_LANGUAGE = 'en';

/** The (text, language) pair to synthesize when auditioning a voice. */
export function previewSampleFor(language: string): PreviewSample {
  const text = PREVIEW_SAMPLES[language];
  return text
    ? { language, text }
    : { language: FALLBACK_LANGUAGE, text: PREVIEW_SAMPLES[FALLBACK_LANGUAGE] };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/Settings/sections/sonioxPreviewSample.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/Settings/sections/sonioxPreviewSample.ts \
        src/components/Settings/sections/sonioxPreviewSample.test.ts
git commit -m "feat(soniox): language-keyed preview sample sentences (#375)"
```

---

### Task 3: Generalize `onPreview` in the shared voice library

**Files:**
- Modify: `src/components/Settings/sections/VoiceLibrarySection.tsx` (lines 56–58, 90–150)
- Modify: `src/components/Settings/sections/VoiceLibrarySection.scss:225-243`
- Modify: `src/components/Settings/sections/VoiceLibrarySection.test.tsx:42-89`
- Modify: `src/locales/*/translation.json` (all 30 directories — one new key)

**Interfaces:**
- Consumes: nothing from earlier tasks (this task is independently testable).
- Produces: the widened prop contract that Task 4 implements —
  `onPreview?: (id: string, signal?: AbortSignal) => Promise<{ audio: Float32Array; sampleRate: number } | null>`.
  The button renders only when `onPreview && v.removable && !v.disabled`.
  New locale key: `voiceLibrary.synthesizing`.

**Note on the existing test:** `VoiceLibrarySection.test.tsx:67` currently asserts `expect(onPreview).toHaveBeenCalledWith('custom:1')`. Adding the signal argument makes that assertion fail — Step 1 updates it deliberately. This is an intended contract change, not a regression.

- [ ] **Step 1: Update the existing preview test for the new signature and add the new cases**

In `src/components/Settings/sections/VoiceLibrarySection.test.tsx`, replace line 67:

```ts
    await waitFor(() => expect(onPreview).toHaveBeenCalledWith('custom:1'));
```

with:

```ts
    await waitFor(() =>
      expect(onPreview).toHaveBeenCalledWith('custom:1', expect.any(AbortSignal)));
```

Then append these tests inside the top-level `describe('VoiceLibrarySection', ...)` block:

```ts
  /** Shared Web Audio stub — jsdom has no Web Audio API. */
  function stubWebAudio() {
    const mockSource: any = { connect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null, buffer: null };
    const mockCtx: any = {
      state: 'running',
      resume: vi.fn().mockResolvedValue(undefined),
      destination: {},
      createBuffer: vi.fn(() => ({ copyToChannel: vi.fn() })),
      createBufferSource: vi.fn(() => mockSource),
      close: vi.fn().mockResolvedValue(undefined),
    };
    (window as any).AudioContext = function AudioContext() { return mockCtx; };
    return { mockCtx, mockSource };
  }

  it('shows a spinner and disables the button while the preview is in flight', async () => {
    stubWebAudio();
    let release: (v: { audio: Float32Array; sampleRate: number }) => void = () => {};
    const onPreview = vi.fn(() => new Promise<any>((res) => { release = res; }));

    render(
      <VoiceLibrarySection
        {...base}
        selectedId=""
        voices={[{ id: 'custom:1', label: 'Mine', group: 'custom', removable: true }]}
        capability={{ importModes: ['record'], curation: false }}
        onPreview={onPreview}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /^play$/i }));
    const busy = await screen.findByRole('button', { name: /synthesizing/i });
    expect(busy).toBeDisabled();

    release({ audio: new Float32Array(2048), sampleRate: 24000 });
    await waitFor(() => expect(screen.queryByRole('button', { name: /synthesizing/i })).toBeNull());
  });

  it('renders no preview button for a disabled entry (processing / failed clone)', () => {
    render(
      <VoiceLibrarySection
        {...base}
        selectedId=""
        voices={[{ id: 'custom:1', label: 'Cooking', group: 'custom', removable: true, disabled: true }]}
        capability={{ importModes: ['record'], curation: false }}
        onPreview={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: /^play$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /synthesizing/i })).toBeNull();
  });

  it('aborts an in-flight preview when the user starts another one', async () => {
    stubWebAudio();
    const signals: AbortSignal[] = [];
    const onPreview = vi.fn((_id: string, signal?: AbortSignal) => {
      if (signal) signals.push(signal);
      return new Promise<any>(() => {}); // never settles
    });

    render(
      <VoiceLibrarySection
        {...base}
        selectedId=""
        voices={[
          { id: 'custom:1', label: 'First', group: 'custom', removable: true },
          { id: 'custom:2', label: 'Second', group: 'custom', removable: true },
        ]}
        capability={{ importModes: ['record'], curation: false }}
        onPreview={onPreview}
      />,
    );

    const [firstBtn, secondBtn] = screen.getAllByRole('button', { name: /^play$/i });
    fireEvent.click(firstBtn);
    await waitFor(() => expect(signals).toHaveLength(1));
    expect(signals[0].aborted).toBe(false);

    fireEvent.click(secondBtn);
    await waitFor(() => expect(signals[0].aborted).toBe(true));
  });

  it('aborts an in-flight preview on unmount', async () => {
    stubWebAudio();
    const signals: AbortSignal[] = [];
    const onPreview = vi.fn((_id: string, signal?: AbortSignal) => {
      if (signal) signals.push(signal);
      return new Promise<any>(() => {});
    });

    const { unmount } = render(
      <VoiceLibrarySection
        {...base}
        selectedId=""
        voices={[{ id: 'custom:1', label: 'Mine', group: 'custom', removable: true }]}
        capability={{ importModes: ['record'], curation: false }}
        onPreview={onPreview}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /^play$/i }));
    await waitFor(() => expect(signals).toHaveLength(1));
    unmount();
    expect(signals[0].aborted).toBe(true);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/Settings/sections/VoiceLibrarySection.test.tsx`
Expected: FAIL — the signature assertion fails (called with one argument), no `synthesizing` button exists, the disabled entry still renders a Play button, and no signal is ever passed.

- [ ] **Step 3: Widen the `onPreview` prop type**

In `src/components/Settings/sections/VoiceLibrarySection.tsx`, replace the `onPreview` declaration (lines 55–58):

```ts
  /** Fetch a playable sample of a removable voice — either a stored reference
   *  clip (the native providers keep clips locally) or one synthesized on
   *  demand (Soniox stores nothing locally, so its sample is a TTS audition).
   *  Returns null when the voice has no playable sample. Preview controls only
   *  render when this is provided, the entry is removable, and the entry is not
   *  disabled. `signal` aborts when the user starts another preview or the
   *  component unmounts; implementations that cannot cancel may ignore it. */
  onPreview?: (id: string, signal?: AbortSignal) => Promise<{ audio: Float32Array; sampleRate: number } | null>;
```

- [ ] **Step 4: Add busy + abort state and rewrite `togglePreview`**

Replace lines 90–107 (the state block and `stopPreview`) with:

```ts
  // ---- local playback (listen back to a voice's sample) -------------------
  const [playingId, setPlayingId] = useState<string | null>(null);
  // Non-null while an onPreview call is in flight for that row.
  const [previewLoadingId, setPreviewLoadingId] = useState<string | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);

  // Monotonic token: a toggle invalidates any earlier onPreview still in
  // flight, so a stale resolution can't start playback over a newer one.
  const previewTokenRef = useRef(0);
  // Cancels the in-flight onPreview itself, not just its result: a synthesized
  // sample costs the user money, so a superseded request should never reach
  // the network rather than being paid for and discarded.
  const previewAbortRef = useRef<AbortController | null>(null);

  const stopPreview = useCallback(() => {
    previewTokenRef.current += 1;
    previewAbortRef.current?.abort();
    previewAbortRef.current = null;
    setPreviewLoadingId(null);
    const src = sourceRef.current;
    if (src) {
      src.onended = null;
      try { src.stop(); } catch { /* already stopped/ended */ }
      sourceRef.current = null;
    }
    setPlayingId(null);
  }, []);
```

Then replace `togglePreview` (lines 109–130) with:

```ts
  const togglePreview = useCallback(async (id: string) => {
    if (playingId === id) { stopPreview(); return; }
    stopPreview();
    if (!onPreview) return;
    const token = previewTokenRef.current;
    const controller = new AbortController();
    previewAbortRef.current = controller;
    setPreviewLoadingId(id);
    let payload: { audio: Float32Array; sampleRate: number } | null = null;
    try {
      payload = await onPreview(id, controller.signal);
    } catch {
      payload = null;
    } finally {
      if (previewAbortRef.current === controller) previewAbortRef.current = null;
      // Only the newest request owns the spinner — a superseded one must not
      // clear a spinner that now belongs to another row.
      if (token === previewTokenRef.current) setPreviewLoadingId(null);
    }
    if (token !== previewTokenRef.current) return; // superseded by a newer toggle
    if (!payload || payload.audio.length === 0) return;
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = audioCtxRef.current ?? (audioCtxRef.current = new AudioCtx());
    if (ctx.state === 'suspended') { try { await ctx.resume(); } catch { /* ignore */ } }
    const buffer = ctx.createBuffer(1, payload.audio.length, payload.sampleRate);
    buffer.copyToChannel(payload.audio, 0);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    src.onended = () => { if (sourceRef.current === src) { sourceRef.current = null; setPlayingId(null); } };
    sourceRef.current = src;
    setPlayingId(id);
    src.start();
  }, [playingId, onPreview, stopPreview]);
```

- [ ] **Step 5: Rewrite `renderPreviewButton` with gating and the spinner**

Replace lines 138–150 with:

```ts
  const renderPreviewButton = (v: VoiceEntry) => {
    // A disabled entry (a processing/failed clone, or the "(deleted voice)"
    // placeholder) has nothing playable behind it.
    if (!onPreview || !v.removable || v.disabled) return null;
    const isLoading = previewLoadingId === v.id;
    const isPlaying = playingId === v.id;
    const label = isLoading
      ? t('voiceLibrary.synthesizing', 'Synthesizing…')
      : isPlaying
        ? t('voiceLibrary.stopPreview', 'Stop')
        : t('voiceLibrary.play', 'Play');
    return (
      <button
        type="button"
        className="voice-row-btn"
        // Disabled while loading so a second click cannot start a second
        // synthesis (which would spend the user's tokens twice).
        disabled={isLoading}
        onClick={() => void togglePreview(v.id)}
        aria-label={label}
        title={label}
      >
        {isLoading
          ? <span className="voice-preview-spinner" aria-hidden="true" />
          : isPlaying ? <Square size={14} /> : <Play size={14} />}
      </button>
    );
  };
```

- [ ] **Step 6: Add the spinner styles**

In `src/components/Settings/sections/VoiceLibrarySection.scss`, inside the existing `.voice-row-btn` block (after the `&.voice-row-btn-danger` rule, before the block's closing brace), add:

```scss
  // Synthesis-in-progress spinner. Local keyframes with a unique name — the
  // SonioxCloneConfirmModal precedent — so this rule never depends on another
  // file's @keyframes placement. The shared `.spinner` class in Settings.scss
  // is NOT usable here: it is only ever defined nested inside two unrelated
  // parent blocks, so it would render an invisible empty span.
  .voice-preview-spinner {
    display: inline-block;
    width: 14px;
    height: 14px;
    border: 2px solid transparent;
    border-top-color: currentColor;
    border-radius: 50%;
    animation: voice-preview-spin 0.8s linear infinite;
  }
```

Then append at the end of the file:

```scss
@keyframes voice-preview-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run src/components/Settings/sections/VoiceLibrarySection.test.tsx`
Expected: PASS — the original tests plus the four new ones.

- [ ] **Step 8: Verify the native voice sections did not regress**

Run: `npx vitest run src/components/Settings/sections/NativeVoiceSection.test.tsx src/components/Settings/sections/LocalInferenceVoiceSection.test.tsx`
Expected: PASS. Those adapters never set `disabled` on a `VoiceEntry` and their `onPreview` implementations simply ignore the new second argument, so behavior is unchanged.

- [ ] **Step 9: Add the `voiceLibrary.synthesizing` key to all 30 locales**

Add one key to the `voiceLibrary` object in **every** `src/locales/*/translation.json`. The English source string is:

```json
"synthesizing": "Synthesizing…"
```

Locale directories: `ar bn de en es fa fi fil fr he hi id it ja ko ms nl pl pt_BR pt_PT ru sv ta te th tr uk vi zh_CN zh_TW`.

Each locale gets a natural translation of "Synthesizing…" (a progress label, keep the ellipsis character `…`). The string contains no `{x}` or `{{x}}` placeholders, so the placeholder-parity assertion has nothing to check — only key parity matters.

- [ ] **Step 10: Run the locale consistency test**

Run: `npx vitest run src/locales/locales.consistency.test.ts`
Expected: PASS — every locale has exactly `en`'s keys.

- [ ] **Step 11: Commit**

```bash
git add src/components/Settings/sections/VoiceLibrarySection.tsx \
        src/components/Settings/sections/VoiceLibrarySection.scss \
        src/components/Settings/sections/VoiceLibrarySection.test.tsx \
        src/locales
git commit -m "feat(voice-library): generalize onPreview with busy state and abort (#375)"
```

---

### Task 4: Wire the preview into the Soniox voice section

**Files:**
- Modify: `src/components/Settings/sections/SonioxVoiceSection.tsx` (props at 44–49, imports at 27–42, body, render at 372–421)
- Modify: `src/components/Settings/sections/SonioxVoiceSection.test.tsx` (mocks at 17–25, `mount` helper at 64–76)
- Modify: `src/locales/*/translation.json` (all 30 directories — four new keys)

**Interfaces:**
- Consumes:
  - `synthesizeOnce(opts)` from `../../../services/clients/SonioxTtsRest` (Task 1)
  - `previewSampleFor(language)` from `./sonioxPreviewSample` (Task 2)
  - the widened `onPreview?: (id, signal?) => Promise<...>` contract (Task 3)
- Produces: no exports consumed by later tasks. New locale keys: `settings.sonioxVoicePreviewCostHint`, `settings.sonioxVoicePreviewAuthError`, `settings.sonioxVoicePreviewQuotaError`, `settings.sonioxVoicePreviewTimeout`.

**Note on the existing test helper:** `SonioxVoiceSection.test.tsx`'s `mount()` passes `settings={{ voice: 'Maya', apiKey: 'k' }}`. The widened prop type needs `targetLanguage` and `ttsSpeed` too — Step 1 updates the helper. The call site in `ProviderSpecificSettings.tsx:1746` already spreads the full `activeSonioxSettings` object and needs **no change**.

- [ ] **Step 1: Add the TTS mock and widen the test helper**

In `src/components/Settings/sections/SonioxVoiceSection.test.tsx`, add after the existing `SonioxVoicesClient` mock block (after line 25):

```ts
const synthesizeMock = vi.fn();
vi.mock('../../../services/clients/SonioxTtsRest', () => ({
  synthesizeOnce: (...args: unknown[]) => synthesizeMock(...args),
}));
```

Update the `mount` helper's settings object:

```ts
      settings={{ voice: 'Maya', apiKey: 'k', targetLanguage: 'ja', ttsSpeed: 1.0 }}
```

Add to the existing `beforeEach` block:

```ts
    synthesizeMock.mockReset().mockResolvedValue({ audio: new Float32Array(2048), sampleRate: 24000 });
    // VoiceLibrarySection plays the returned sample through Web Audio, which
    // jsdom does not implement. The confirm-modal tests stub AudioContext with
    // decodeAudioData only; preview needs the buffer-source surface too.
    (window as any).AudioContext = function AudioContext() {
      return {
        state: 'running',
        resume: vi.fn().mockResolvedValue(undefined),
        destination: {},
        createBuffer: vi.fn(() => ({ copyToChannel: vi.fn() })),
        createBufferSource: vi.fn(() => ({ connect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null, buffer: null })),
        close: vi.fn().mockResolvedValue(undefined),
        decodeAudioData: vi.fn(),
      };
    };
```

- [ ] **Step 2: Write the failing tests**

Append inside `describe('SonioxVoiceSection', ...)` in the same file:

```ts
  it('previews a ready clone with the target language pair and the configured speed', async () => {
    listMock.mockResolvedValue([cloned()]);
    mount({ settings: { voice: 'Maya', apiKey: 'k', targetLanguage: 'ja', ttsSpeed: 1.2 } });
    openManageDetails();
    const playBtn = await screen.findByRole('button', { name: /^play$/i });
    fireEvent.click(playBtn);
    await waitFor(() => expect(synthesizeMock).toHaveBeenCalledTimes(1));
    expect(synthesizeMock.mock.calls[0][0]).toMatchObject({
      apiKey: 'k',
      voice: 'uuid-1',
      language: 'ja',
      text: 'こんにちは。これはこの声の短い試聴です。',
      speed: 1.2,
    });
  });

  it('falls back to the English pair for a target language with no seeded sentence', async () => {
    listMock.mockResolvedValue([cloned()]);
    mount({ settings: { voice: 'Maya', apiKey: 'k', targetLanguage: 'cy', ttsSpeed: 1.0 } });
    openManageDetails();
    fireEvent.click(await screen.findByRole('button', { name: /^play$/i }));
    await waitFor(() => expect(synthesizeMock).toHaveBeenCalledTimes(1));
    expect(synthesizeMock.mock.calls[0][0]).toMatchObject({
      language: 'en',
      text: 'Hello. This is a short preview of how this voice sounds.',
    });
  });

  it('reuses the cached clip on a second preview of the same voice', async () => {
    listMock.mockResolvedValue([cloned()]);
    mount();
    openManageDetails();
    fireEvent.click(await screen.findByRole('button', { name: /^play$/i }));
    await waitFor(() => expect(synthesizeMock).toHaveBeenCalledTimes(1));
    // Stop, then play again — no second synthesis, no second charge.
    fireEvent.click(await screen.findByRole('button', { name: /^stop$/i }));
    fireEvent.click(await screen.findByRole('button', { name: /^play$/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /^stop$/i })).toBeInTheDocument());
    expect(synthesizeMock).toHaveBeenCalledTimes(1);
  });

  it('renders no preview button for processing or failed clones', async () => {
    listMock.mockResolvedValue([
      cloned({ id: 'proc', name: 'Cooking', models: [{ model: 'tts-rt-v1', status: 'processing' }] }),
      cloned({ id: 'bad', name: 'Broken', models: [{ model: 'tts-rt-v1', status: 'failed' }] }),
    ]);
    mount();
    openManageDetails();
    await screen.findByText(/Cooking/);
    expect(screen.queryByRole('button', { name: /^play$/i })).toBeNull();
  });

  it('surfaces a mapped synthesis failure in the capture-error banner', async () => {
    listMock.mockResolvedValue([cloned()]);
    synthesizeMock.mockRejectedValue(new SonioxVoicesError('unauthenticated', 'bad key', 401));
    mount();
    openManageDetails();
    fireEvent.click(await screen.findByRole('button', { name: /^play$/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/check the API key/i);
  });

  it('keeps the banner empty when the preview was cancelled by the user', async () => {
    listMock.mockResolvedValue([cloned()]);
    synthesizeMock.mockRejectedValue(new SonioxVoicesError('aborted', 'Preview cancelled', 0));
    mount();
    openManageDetails();
    fireEvent.click(await screen.findByRole('button', { name: /^play$/i }));
    await waitFor(() => expect(synthesizeMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('offers no preview affordance and no cost hint without an API key', async () => {
    mount({ settings: { voice: 'Maya', apiKey: '', targetLanguage: 'ja', ttsSpeed: 1.0 } });
    await waitFor(() => expect(screen.queryByRole('button', { name: /^play$/i })).toBeNull());
    expect(screen.queryByText(/your own Soniox quota/i)).toBeNull();
  });

  it('shows the cost hint once a client exists', async () => {
    mount();
    expect(await screen.findByText(/your own Soniox quota/i)).toBeInTheDocument();
  });

  it('keeps preview available during an active session', async () => {
    // Deliberate: VoiceLibrarySection's contract keeps import/rename/delete
    // open mid-session so users can stage voices for the next one, and preview
    // audio goes to the default output rather than the session's (possibly
    // virtual) device, so it cannot leak into a meeting.
    listMock.mockResolvedValue([cloned()]);
    mount({ isSessionActive: true });
    openManageDetails();
    fireEvent.click(await screen.findByRole('button', { name: /^play$/i }));
    await waitFor(() => expect(synthesizeMock).toHaveBeenCalledTimes(1));
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/components/Settings/sections/SonioxVoiceSection.test.tsx`
Expected: FAIL — no Play button renders (the section passes no `onPreview`), `synthesizeMock` is never called, and no cost hint exists.

- [ ] **Step 4: Add the imports and widen the props**

In `src/components/Settings/sections/SonioxVoiceSection.tsx`, add after the existing `SonioxVoicesClient` import block (after line 36):

```ts
import { synthesizeOnce } from '../../../services/clients/SonioxTtsRest';
import { previewSampleFor } from './sonioxPreviewSample';
```

Replace the props interface (lines 44–49):

```ts
export interface SonioxVoiceSectionProps {
  /** `targetLanguage` and `ttsSpeed` drive the preview audition so it matches
   *  what the session would actually speak. */
  settings: { voice: string; apiKey: string; targetLanguage: string; ttsSpeed: number };
  onUpdate: (patch: { voice: string }) => void;
  managed: boolean;
  isSessionActive: boolean;
}
```

- [ ] **Step 5: Add the error mapper, the cache, and the preview handler**

Insert after the existing `mapCreateError` function (after line 155):

```ts
  // Separate from mapCreateError: those branches are all voices-CRUD specific
  // (name conflicts, voice quota, terminal processing failure), none of which
  // a synthesis call can produce.
  const mapTtsError = (e: unknown): Error => {
    if (e instanceof SonioxVoicesError) {
      if (e.status === 401 || e.errorType === 'unauthenticated') {
        return new Error(t('settings.sonioxVoicePreviewAuthError', 'Preview failed — check the API key'));
      }
      if (e.status === 429 || e.errorType === 'limit_exceeded') {
        return new Error(t('settings.sonioxVoicePreviewQuotaError', 'Preview failed — Soniox rate limit or quota reached'));
      }
      if (e.errorType === 'timeout') {
        return new Error(t('settings.sonioxVoicePreviewTimeout', 'Preview timed out — try again'));
      }
    }
    return e instanceof Error ? e : new Error(String(e));
  };

  // Synthesized samples are effectively deterministic for a fixed text, so a
  // repeat listen carries no new information but would spend the user's tokens
  // again. Keyed by voice + language + speed so changing either re-synthesizes.
  const previewCacheRef = useRef(new Map<string, { audio: Float32Array; sampleRate: number }>());
  // A changed client means a (possibly) different Soniox project: audio cached
  // against the old project's UUIDs must not replay under the new key.
  useEffect(() => { previewCacheRef.current.clear(); }, [client]);

  const handlePreview = useCallback(async (
    id: string,
    signal?: AbortSignal
  ): Promise<{ audio: Float32Array; sampleRate: number } | null> => {
    if (!client) return null;
    const sample = previewSampleFor(settings.targetLanguage);
    const speed = settings.ttsSpeed;
    const cacheKey = `${id}|${sample.language}|${speed}`;
    const cached = previewCacheRef.current.get(cacheKey);
    if (cached) return cached;
    setCaptureError(null);
    try {
      const result = await synthesizeOnce({
        apiKey: settings.apiKey,
        voice: id,
        language: sample.language,
        text: sample.text,
        speed,
        signal,
      });
      previewCacheRef.current.set(cacheKey, result);
      return result;
    } catch (e) {
      // A user-initiated cancel (switching rows, closing the panel) is not a
      // failure and must never reach the banner.
      if (e instanceof SonioxVoicesError && e.errorType === 'aborted') return null;
      setCaptureError(mapTtsError(e).message);
      return null;
    }
  }, [client, settings.apiKey, settings.targetLanguage, settings.ttsSpeed, t]);
```

- [ ] **Step 6: Pass `onPreview` and render the cost hint**

In the JSX, add the `onPreview` prop to `<VoiceLibrarySection>` immediately after `onDelete={onDelete}` (line 391):

```tsx
        onPreview={client ? handlePreview : undefined}
```

Then insert between the closing `/>` of `<VoiceLibrarySection>` (line 406) and the `{captureError && ...}` block:

```tsx
      {client && (
        <div className="setting-item">
          <div className="setting-description">
            {t(
              'settings.sonioxVoicePreviewCostHint',
              'Previewing a voice synthesizes a short clip using your own Soniox quota.'
            )}
          </div>
        </div>
      )}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run src/components/Settings/sections/SonioxVoiceSection.test.tsx`
Expected: PASS — the existing suite plus the nine new tests.

- [ ] **Step 8: Add the four new keys to all 30 locales**

Add to the `settings` object in **every** `src/locales/*/translation.json`. English source strings:

```json
"sonioxVoicePreviewCostHint": "Previewing a voice synthesizes a short clip using your own Soniox quota.",
"sonioxVoicePreviewAuthError": "Preview failed — check the API key",
"sonioxVoicePreviewQuotaError": "Preview failed — Soniox rate limit or quota reached",
"sonioxVoicePreviewTimeout": "Preview timed out — try again"
```

Locale directories: `ar bn de en es fa fi fil fr he hi id it ja ko ms nl pl pt_BR pt_PT ru sv ta te th tr uk vi zh_CN zh_TW`.

None of these strings contain `{x}` or `{{x}}` placeholders, so only key parity is checked.

- [ ] **Step 9: Run the locale consistency test**

Run: `npx vitest run src/locales/locales.consistency.test.ts`
Expected: PASS.

- [ ] **Step 10: Run the full suite**

Run: `npx vitest run`
Expected: PASS — no regressions anywhere. `ProviderSpecificSettings.soniox.test.tsx` in particular exercises the section's call site.

- [ ] **Step 11: Commit**

```bash
git add src/components/Settings/sections/SonioxVoiceSection.tsx \
        src/components/Settings/sections/SonioxVoiceSection.test.tsx \
        src/locales
git commit -m "feat(soniox): preview a cloned voice without starting a session (#375)"
```

---

## Manual verification (BYOK key required)

Automated tests mock the network end to end; the wire itself has never been
exercised from inside the app. Before calling this done, run one live check —
the #372 lesson was that a real download/upload smoke test catches what mocks
cannot.

- [ ] Build the extension (`npm run extension:build`), load it unpacked, paste a real Soniox BYOK key, and confirm a cloned voice previews. This is the only path that proves the CSP entry works; Electron would pass even with the CSP line missing.
- [ ] Confirm the spinner is visible during the round-trip (the invisible-spinner failure mode is a styling bug no test catches).
- [ ] Set the target language to Japanese and to Welsh, and confirm the audition language changes and falls back respectively.
