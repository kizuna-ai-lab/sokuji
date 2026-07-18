# Soniox Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Soniox as a BYOK speech-to-speech translation provider: one WebSocket for STT+translation, a second for TTS, orchestrated by a new `SonioxClient`; `textOnly` toggles subtitles-only vs spoken translation.

**Architecture:** Three-file symmetric split — `SonioxSttStream` and `SonioxTtsStream` are protocol-only wire components (zero knowledge of each other or of `IClient`); `SonioxClient` implements `IClient` and owns all Sokuji semantics (conversation items, finals-only TTS feeding, degradation). Descriptor + registration mirror `VolcengineSTProviderConfig`, credentials are single-key BYOK inherited from `BaseProviderDescriptor`.

**Tech Stack:** TypeScript, browser `WebSocket`, Zustand settings store, Vitest (jsdom). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-18-soniox-provider-design.md`

## Global Constraints

- All code comments and docs in English; conversation with user in Chinese.
- Correctness gate is `npm run test` (vitest). `tsc` is NOT clean (~113 pre-existing errors) — do not gate on tsc.
- No-interruption rule: `createResponse`/`cancelResponse` must be no-ops; never fire `onConversationInterrupted`.
- TTS failure must never kill subtitles (degrade to text-only, log once).
- Do NOT touch `ClientFactory.ts`, `ProviderDescriptor.ts`, `MainPanel.tsx` — they are generic over the descriptor.
- Never `git push` or open a PR without explicit per-action user approval.

## Verified wire-protocol facts (do not re-derive; live-tested 2026-07-18)

- STT: `wss://stt-rt.soniox.com/transcribe-websocket`, model `stt-rt-v5`. First frame = JSON config. Raw PCM **requires** `audio_format:"pcm_s16le"` + `sample_rate` + `num_channels` (`"auto"` sniffs containers and fails on raw PCM with 408). Sokuji mic pipeline is 24000 Hz Int16 mono (`BaseAudioRecorder.ts:23`).
- End of STT stream = **empty TEXT frame** `""` → server replies `{finished:true}` and closes. `{"type":"finalize"}` only flushes pending tokens (emits a `<fin>` pseudo-token); it does NOT end the session. ~20 s without input → `408 Request timeout`; prevent with `{"type":"keepalive"}`.
- STT responses: `{tokens:[...]}` where each token has `text`, `is_final`, `translation_status` (`original`|`translation`|`none`), `language`, `source_language`, `start_ms` (originals only). In-band pseudo-tokens: `<end>` (endpoint) and `<fin>` (finalize marker). Partial (non-final) tokens are re-sent in full on every message — partial buffers must reset per message.
- TTS: `wss://tts-rt.soniox.com/tts-websocket`, model `tts-rt-v1`. Per-utterance stream: config `{api_key, stream_id, model, voice, language, audio_format:"pcm_s16le", sample_rate:24000}` → `{stream_id, text, text_end:false}` chunks → `{stream_id, text:"", text_end:true}` to close. Server replies `{stream_id, audio:"<base64 pcm_s16le>"}` chunks then `{stream_id, terminated:true}`. TTS keepalive is `{"keep_alive":true}` (different shape from STT!). All 12 voices speak zh/ja/en (9/9 matrix verified) — one voice serves both two_way directions.
- Key validation probe: `POST https://api.soniox.com/v1/auth/temporary-api-key` with `Authorization: Bearer <key>`, body `{usage_type:"transcribe_websocket", expires_in_seconds:60}` → HTTP 201 = key valid, 401/403 = invalid.

---

### Task 1: Provider enum + Soniox session config types

**Files:**
- Modify: `src/types/Provider.ts`
- Modify: `src/services/interfaces/IClient.ts`

**Interfaces:**
- Produces: `Provider.SONIOX` (= `'soniox'`), `SonioxSessionConfig`, `isSonioxSessionConfig`. Later tasks import these.

- [ ] **Step 1: Add enum value and union member**

In `src/types/Provider.ts`, add to the `Provider` enum (after `ZOOM_AI = 'zoom_ai'`, add a comma to the previous line):

```ts
  ZOOM_AI = 'zoom_ai',
  SONIOX = 'soniox'
```

And extend the `ProviderType` union (line ~26) by appending ` | Provider.SONIOX` before the semicolon.

- [ ] **Step 2: Add session config + guard**

In `src/services/interfaces/IClient.ts`, after the `VolcengineAST2SessionConfig` interface, add:

```ts
/**
 * Soniox speech-to-speech translation session configuration.
 * `voice` comes from BaseSessionConfig. When `twoWayTranslation` is true the
 * client sends a two_way translation block (source ↔ target); sourceLanguage
 * must then be a concrete language ('auto' is only valid for one_way, where
 * it means "no language_hints").
 */
export interface SonioxSessionConfig extends BaseSessionConfig {
  provider: 'soniox';
  sourceLanguage: string; // 'auto' | ISO code
  targetLanguage: string; // ISO code
  twoWayTranslation: boolean;
}
```

Append `| SonioxSessionConfig` to the `SessionConfig` union (line ~232), and add next to the other guards:

```ts
export function isSonioxSessionConfig(config: SessionConfig): config is SonioxSessionConfig {
  return config.provider === 'soniox';
}
```

- [ ] **Step 3: Verify existing tests still pass**

Run: `npm run test -- src/types/Provider.test.ts src/services/providers/descriptorRegistry.test.ts`
Expected: PASS (count is still 12 — Soniox is not registered yet).

- [ ] **Step 4: Commit**

```bash
git add src/types/Provider.ts src/services/interfaces/IClient.ts
git commit -m "feat(soniox): add provider enum value and session config type"
```

---

### Task 2: SonioxSttStream wire component

**Files:**
- Create: `src/services/clients/SonioxSttStream.ts`
- Test: `src/services/clients/SonioxSttStream.test.ts`

**Interfaces:**
- Produces (consumed by Task 4):

```ts
export interface SonioxToken {
  text: string;
  is_final?: boolean;
  translation_status?: 'original' | 'translation' | 'none';
  language?: string;
  source_language?: string;
  speaker?: string;
  start_ms?: number;
  end_ms?: number;
  confidence?: number;
}
export interface SonioxSttMessage {
  tokens?: SonioxToken[];
  finished?: boolean;
  error_code?: number | string;
  error_message?: string;
}
export type SonioxTranslationConfig =
  | { type: 'one_way'; target_language: string }
  | { type: 'two_way'; language_a: string; language_b: string };
export interface SonioxSttConfig {
  apiKey: string;
  model: string;         // 'stt-rt-v5'
  sampleRate: number;    // 24000
  languageHints?: string[];
  translation: SonioxTranslationConfig;
}
export interface SonioxSttStreamHandlers {
  onMessage?: (message: SonioxSttMessage) => void;   // error-free messages only
  onFinished?: () => void;
  onError?: (code: string, message: string) => void; // wire errors AND post-open socket errors
  onClose?: (event: { code?: number; reason?: string }) => void;
}
class SonioxSttStream {
  setHandlers(h: SonioxSttStreamHandlers): void;
  connect(config: SonioxSttConfig): Promise<void>;   // resolves on socket open (config frame sent)
  sendAudio(audio: Int16Array): void;
  finalize(): void;                                  // {"type":"finalize"}
  end(): void;                                       // empty text frame ""
  close(): void;
  isOpen(): boolean;
}
```

- [ ] **Step 1: Write the failing test**

Create `src/services/clients/SonioxSttStream.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SonioxSttStream, SonioxSttMessage } from './SonioxSttStream';

/** Minimal scripted WebSocket double. Instances register on MockWebSocket.instances. */
class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static OPEN = 1;
  static CLOSED = 3;
  url: string;
  readyState = 0;
  sent: Array<string | Int16Array> = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onclose: ((ev: { code?: number; reason?: string }) => void) | null = null;
  constructor(url: string) { this.url = url; MockWebSocket.instances.push(this); }
  send(data: string | Int16Array) { this.sent.push(data); }
  close() { this.readyState = MockWebSocket.CLOSED; this.onclose?.({ code: 1000 }); }
  // test helpers
  open() { this.readyState = MockWebSocket.OPEN; this.onopen?.(); }
  message(obj: unknown) { this.onmessage?.({ data: JSON.stringify(obj) }); }
}

beforeEach(() => {
  MockWebSocket.instances = [];
  vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket);
  vi.useFakeTimers();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const CONFIG = {
  apiKey: 'k', model: 'stt-rt-v5', sampleRate: 24000,
  translation: { type: 'one_way' as const, target_language: 'en' },
};

async function openStream(config = CONFIG) {
  const s = new SonioxSttStream();
  const p = s.connect(config);
  MockWebSocket.instances[0].open();
  await p;
  return { s, ws: MockWebSocket.instances[0] };
}

describe('SonioxSttStream', () => {
  it('sends explicit raw-PCM config as the first frame', async () => {
    const { ws } = await openStream({ ...CONFIG, languageHints: ['zh'] });
    const first = JSON.parse(ws.sent[0] as string);
    expect(first).toMatchObject({
      api_key: 'k', model: 'stt-rt-v5',
      audio_format: 'pcm_s16le', sample_rate: 24000, num_channels: 1,
      enable_endpoint_detection: true, max_endpoint_delay_ms: 500,
      enable_language_identification: true,
      language_hints: ['zh'],
      translation: { type: 'one_way', target_language: 'en' },
    });
  });

  it('omits language_hints when not provided and supports two_way', async () => {
    const { ws } = await openStream({
      ...CONFIG, translation: { type: 'two_way', language_a: 'zh', language_b: 'en' },
    });
    const first = JSON.parse(ws.sent[0] as string);
    expect(first.language_hints).toBeUndefined();
    expect(first.translation).toEqual({ type: 'two_way', language_a: 'zh', language_b: 'en' });
  });

  it('forwards audio frames as binary and end() as an empty TEXT frame', async () => {
    const { s, ws } = await openStream();
    const pcm = new Int16Array([1, 2, 3]);
    s.sendAudio(pcm);
    expect(ws.sent[1]).toBe(pcm);
    s.end();
    expect(ws.sent[2]).toBe('');
  });

  it('sends finalize and keepalive control messages', async () => {
    const { s, ws } = await openStream();
    s.finalize();
    expect(JSON.parse(ws.sent[1] as string)).toEqual({ type: 'finalize' });
    // keepalive fires automatically after 15 s of no audio
    vi.advanceTimersByTime(15_000);
    expect(JSON.parse(ws.sent[2] as string)).toEqual({ type: 'keepalive' });
  });

  it('does not send keepalive while audio is flowing', async () => {
    const { s, ws } = await openStream();
    for (let i = 0; i < 4; i++) {
      vi.advanceTimersByTime(5_000);
      s.sendAudio(new Int16Array([0]));
    }
    const keepalives = ws.sent.filter(
      (m) => typeof m === 'string' && m.includes('keepalive'));
    expect(keepalives).toHaveLength(0);
  });

  it('routes messages, errors and finished to handlers', async () => {
    const { s, ws } = await openStream();
    const got: SonioxSttMessage[] = [];
    const errors: string[] = [];
    let finished = false;
    s.setHandlers({
      onMessage: (m) => got.push(m),
      onError: (code) => errors.push(code),
      onFinished: () => { finished = true; },
    });
    ws.message({ tokens: [{ text: 'Hi', is_final: true }] });
    ws.message({ error_code: 408, error_message: 'Request timeout.' });
    ws.message({ tokens: [], finished: true });
    expect(got).toHaveLength(2);           // error message NOT passed to onMessage
    expect(errors).toEqual(['408']);
    expect(finished).toBe(true);
  });

  it('close() stops the keepalive timer', async () => {
    const { s, ws } = await openStream();
    s.close();
    vi.advanceTimersByTime(60_000);
    const keepalives = ws.sent.filter(
      (m) => typeof m === 'string' && m.includes('keepalive'));
    expect(keepalives).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/services/clients/SonioxSttStream.test.ts`
Expected: FAIL — cannot resolve `./SonioxSttStream`.

- [ ] **Step 3: Implement**

Create `src/services/clients/SonioxSttStream.ts`:

```ts
/**
 * Soniox real-time STT+translation WebSocket wire component.
 *
 * Protocol-only: this class knows the Soniox STT wire protocol and nothing
 * about IClient or Sokuji conversation semantics (that is SonioxClient's job).
 *
 * Live-verified protocol facts (2026-07-18):
 * - The first frame after open MUST be a JSON config message.
 * - Raw headerless PCM requires explicit audio_format/sample_rate/num_channels;
 *   "auto" only sniffs containers and 408s on raw PCM.
 * - End-of-stream is an EMPTY TEXT frame (""): the server flushes remaining
 *   tokens, replies {finished:true} and closes the connection.
 * - {"type":"finalize"} only finalizes pending tokens (emits a <fin> token);
 *   it does NOT end the session.
 * - ~20 s without input triggers "408 Request timeout"; {"type":"keepalive"}
 *   prevents it. We send one after 15 s without audio.
 */

export interface SonioxToken {
  text: string;
  is_final?: boolean;
  translation_status?: 'original' | 'translation' | 'none';
  language?: string;
  source_language?: string;
  speaker?: string;
  start_ms?: number;
  end_ms?: number;
  confidence?: number;
}

export interface SonioxSttMessage {
  tokens?: SonioxToken[];
  finished?: boolean;
  error_code?: number | string;
  error_message?: string;
}

export type SonioxTranslationConfig =
  | { type: 'one_way'; target_language: string }
  | { type: 'two_way'; language_a: string; language_b: string };

export interface SonioxSttConfig {
  apiKey: string;
  model: string;
  sampleRate: number;
  languageHints?: string[];
  translation: SonioxTranslationConfig;
}

export interface SonioxSttStreamHandlers {
  onMessage?: (message: SonioxSttMessage) => void;
  onFinished?: () => void;
  onError?: (code: string, message: string) => void;
  onClose?: (event: { code?: number; reason?: string }) => void;
}

const STT_URL = 'wss://stt-rt.soniox.com/transcribe-websocket';
const CONNECTION_TIMEOUT_MS = 15000;
const KEEPALIVE_AFTER_IDLE_MS = 15000;

export class SonioxSttStream {
  private ws: WebSocket | null = null;
  private handlers: SonioxSttStreamHandlers = {};
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  private lastAudioAt = 0;

  setHandlers(handlers: SonioxSttStreamHandlers): void {
    this.handlers = handlers;
  }

  connect(config: SonioxSttConfig): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(STT_URL);
      this.ws = ws;
      let opened = false;
      const timer = setTimeout(() => {
        if (!opened) {
          ws.close();
          reject(new Error('Soniox STT connection timeout'));
        }
      }, CONNECTION_TIMEOUT_MS);

      ws.onopen = () => {
        opened = true;
        clearTimeout(timer);
        ws.send(JSON.stringify({
          api_key: config.apiKey,
          model: config.model,
          audio_format: 'pcm_s16le',
          sample_rate: config.sampleRate,
          num_channels: 1,
          enable_endpoint_detection: true,
          max_endpoint_delay_ms: 500,
          enable_language_identification: true,
          ...(config.languageHints?.length ? { language_hints: config.languageHints } : {}),
          translation: config.translation,
        }));
        this.lastAudioAt = Date.now();
        this.startKeepalive();
        resolve();
      };

      ws.onmessage = (event) => {
        let message: SonioxSttMessage;
        try {
          message = JSON.parse(event.data as string);
        } catch {
          return;
        }
        if (message.error_code != null) {
          this.handlers.onError?.(String(message.error_code), message.error_message ?? '');
          return;
        }
        this.handlers.onMessage?.(message);
        if (message.finished) this.handlers.onFinished?.();
      };

      ws.onerror = (error) => {
        clearTimeout(timer);
        if (!opened) {
          reject(error instanceof Error ? error : new Error('Soniox STT connection failed'));
        } else {
          this.handlers.onError?.('socket_error', String(error));
        }
      };

      ws.onclose = (event) => {
        clearTimeout(timer);
        this.stopKeepalive();
        this.handlers.onClose?.({ code: (event as CloseEvent).code, reason: (event as CloseEvent).reason });
      };
    });
  }

  sendAudio(audio: Int16Array): void {
    if (!this.isOpen()) return;
    this.lastAudioAt = Date.now();
    this.ws!.send(audio);
  }

  /** Finalize pending tokens without ending the session. */
  finalize(): void {
    if (!this.isOpen()) return;
    this.ws!.send(JSON.stringify({ type: 'finalize' }));
  }

  /** End the audio stream: the server flushes, sends {finished:true}, closes. */
  end(): void {
    if (!this.isOpen()) return;
    // Must be an empty TEXT frame — an empty binary frame is NOT recognized.
    this.ws!.send('');
  }

  close(): void {
    this.stopKeepalive();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private startKeepalive(): void {
    this.stopKeepalive();
    this.keepaliveTimer = setInterval(() => {
      if (!this.isOpen()) return;
      if (Date.now() - this.lastAudioAt >= KEEPALIVE_AFTER_IDLE_MS) {
        this.ws!.send(JSON.stringify({ type: 'keepalive' }));
        this.lastAudioAt = Date.now();
      }
    }, KEEPALIVE_AFTER_IDLE_MS);
  }

  private stopKeepalive(): void {
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/services/clients/SonioxSttStream.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/clients/SonioxSttStream.ts src/services/clients/SonioxSttStream.test.ts
git commit -m "feat(soniox): STT wire component with explicit raw-PCM config and keepalive"
```

---

### Task 3: SonioxTtsStream wire component

**Files:**
- Create: `src/services/clients/SonioxTtsStream.ts`
- Test: `src/services/clients/SonioxTtsStream.test.ts`

**Interfaces:**
- Produces (consumed by Task 4):

```ts
export interface SonioxTtsOptions {
  apiKey: string;
  voice: string;
  model: string;      // 'tts-rt-v1'
  sampleRate: number; // 24000
}
export interface SonioxTtsStreamHandlers {
  onAudio?: (audio: Int16Array) => void;
  onError?: (code: string, message: string) => void;
}
class SonioxTtsStream {
  constructor(options: SonioxTtsOptions);
  setHandlers(h: SonioxTtsStreamHandlers): void;
  connect(): Promise<void>;
  prewarm(language: string): void;          // pre-open a stream to skip config RTT on first utterance
  sendText(text: string, language: string): void;  // lazily opens per-utterance stream
  endUtterance(): void;                     // closes the active stream (text_end:true)
  close(): void;
  isOpen(): boolean;
}
```

Behavior contract (mirrors the official demo, plus two_way support):
- One TTS stream per utterance, `stream_id` = `"utt-<n>"` (prewarm uses `"prewarm-<n>"`).
- Streams that produced audio are **serialized**: the next utterance's stream is not opened until the previous stream's `terminated` arrives (prevents interleaved audio). Text arriving in between is queued.
- A prewarmed stream with a matching language is reused by the first `sendText`. On language mismatch it is discarded (`text_end:true` immediately — it produced no audio, so no serialization wait) and a correct-language stream is opened.
- `{keep_alive:true}` every 20 s while the socket is open.
- All errors go to `onError`; no method throws.

- [ ] **Step 1: Write the failing test**

Create `src/services/clients/SonioxTtsStream.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SonioxTtsStream } from './SonioxTtsStream';

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static OPEN = 1;
  static CLOSED = 3;
  url: string;
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  constructor(url: string) { this.url = url; MockWebSocket.instances.push(this); }
  send(data: string) { this.sent.push(data); }
  close() { this.readyState = MockWebSocket.CLOSED; this.onclose?.({}); }
  open() { this.readyState = MockWebSocket.OPEN; this.onopen?.(); }
  message(obj: unknown) { this.onmessage?.({ data: JSON.stringify(obj) }); }
  jsonSent(): any[] { return this.sent.map((s) => JSON.parse(s)); }
}

beforeEach(() => {
  MockWebSocket.instances = [];
  vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket);
  vi.useFakeTimers();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const OPTS = { apiKey: 'k', voice: 'Maya', model: 'tts-rt-v1', sampleRate: 24000 };

async function openTts() {
  const t = new SonioxTtsStream(OPTS);
  const p = t.connect();
  MockWebSocket.instances[0].open();
  await p;
  return { t, ws: MockWebSocket.instances[0] };
}

/** base64 of Int16 samples [100, -100] little-endian */
function pcmB64(): string {
  const bytes = new Uint8Array(new Int16Array([100, -100]).buffer);
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin);
}

describe('SonioxTtsStream', () => {
  it('lazily opens a per-utterance stream with full config, then streams text', async () => {
    const { t, ws } = await openTts();
    t.sendText('Hello ', 'en');
    t.sendText('world', 'en');
    const msgs = ws.jsonSent();
    expect(msgs[0]).toMatchObject({
      api_key: 'k', stream_id: 'utt-1', model: 'tts-rt-v1', voice: 'Maya',
      language: 'en', audio_format: 'pcm_s16le', sample_rate: 24000,
    });
    expect(msgs[1]).toEqual({ stream_id: 'utt-1', text: 'Hello ', text_end: false });
    expect(msgs[2]).toEqual({ stream_id: 'utt-1', text: 'world', text_end: false });
  });

  it('endUtterance closes the active stream with text_end:true', async () => {
    const { t, ws } = await openTts();
    t.sendText('Hi', 'en');
    t.endUtterance();
    const last = ws.jsonSent().at(-1);
    expect(last).toEqual({ stream_id: 'utt-1', text: '', text_end: true });
  });

  it('endUtterance without any text is a no-op', async () => {
    const { t, ws } = await openTts();
    t.endUtterance();
    expect(ws.sent).toHaveLength(0);
  });

  it('serializes utterance streams: next opens only after previous terminated', async () => {
    const { t, ws } = await openTts();
    t.sendText('one', 'en');
    t.endUtterance();
    t.sendText('two', 'en');       // must be queued — utt-1 still draining
    let ids = ws.jsonSent().filter((m) => m.model).map((m) => m.stream_id);
    expect(ids).toEqual(['utt-1']);
    ws.message({ stream_id: 'utt-1', terminated: true });
    ids = ws.jsonSent().filter((m) => m.model).map((m) => m.stream_id);
    expect(ids).toEqual(['utt-1', 'utt-2']);
    expect(ws.jsonSent().at(-1)).toEqual({ stream_id: 'utt-2', text: 'two', text_end: false });
  });

  it('reuses a prewarmed stream when the language matches', async () => {
    const { t, ws } = await openTts();
    t.prewarm('en');
    t.sendText('Hi', 'en');
    const msgs = ws.jsonSent();
    expect(msgs[0].stream_id).toBe('prewarm-1');
    expect(msgs[1]).toEqual({ stream_id: 'prewarm-1', text: 'Hi', text_end: false });
  });

  it('discards a prewarmed stream on language mismatch and opens a correct one immediately', async () => {
    const { t, ws } = await openTts();
    t.prewarm('en');
    t.sendText('你好', 'zh');
    const msgs = ws.jsonSent();
    // prewarm-1 closed empty, then utt-1 opened with zh — no wait for terminated
    expect(msgs[1]).toEqual({ stream_id: 'prewarm-1', text: '', text_end: true });
    expect(msgs[2]).toMatchObject({ stream_id: 'utt-1', language: 'zh' });
    expect(msgs[3]).toEqual({ stream_id: 'utt-1', text: '你好', text_end: false });
  });

  it('decodes base64 audio chunks to Int16Array', async () => {
    const { t, ws } = await openTts();
    const chunks: Int16Array[] = [];
    t.setHandlers({ onAudio: (a) => chunks.push(a) });
    t.sendText('Hi', 'en');
    ws.message({ stream_id: 'utt-1', audio: pcmB64() });
    expect(chunks).toHaveLength(1);
    expect(Array.from(chunks[0])).toEqual([100, -100]);
  });

  it('reports wire errors via onError without throwing', async () => {
    const { t, ws } = await openTts();
    const errors: string[] = [];
    t.setHandlers({ onError: (code) => errors.push(code) });
    ws.message({ error_code: 400, error_message: 'bad voice' });
    expect(errors).toEqual(['400']);
  });

  it('sends keep_alive every 20 s', async () => {
    const { ws } = await openTts();
    vi.advanceTimersByTime(20_000);
    expect(ws.jsonSent().at(-1)).toEqual({ keep_alive: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/services/clients/SonioxTtsStream.test.ts`
Expected: FAIL — cannot resolve `./SonioxTtsStream`.

- [ ] **Step 3: Implement**

Create `src/services/clients/SonioxTtsStream.ts`:

```ts
/**
 * Soniox real-time TTS WebSocket wire component.
 *
 * Protocol-only: knows the Soniox TTS wire protocol and nothing about STT,
 * IClient or Sokuji semantics. Deliberately decoupled — it consumes a
 * (text, language) event stream from ANY source, which is the seam for
 * future cross-provider composition (e.g. другой STT → Soniox TTS).
 *
 * Stream model (mirrors the official soniox_examples STS demo):
 * - One TTS stream per utterance over a single WebSocket, identified by
 *   stream_id. A stream is opened lazily by the first text of an utterance
 *   (config message), fed {text, text_end:false} chunks, and closed with
 *   {text:"", text_end:true}.
 * - Streams that produced audio are serialized: we wait for the server's
 *   {terminated} of the previous stream before opening the next, so audio
 *   chunks never interleave between utterances. Text arriving meanwhile is
 *   queued.
 * - prewarm() pre-opens a stream so the first utterance skips the config
 *   round-trip (~400 ms). A prewarmed stream with the wrong language (only
 *   possible in two_way mode) is discarded immediately — it produced no
 *   audio, so no serialization wait is needed.
 * - {keep_alive:true} every 20 s keeps idle sockets alive (NOTE: different
 *   shape from the STT keepalive {"type":"keepalive"}).
 */

export interface SonioxTtsOptions {
  apiKey: string;
  voice: string;
  model: string;
  sampleRate: number;
}

export interface SonioxTtsStreamHandlers {
  onAudio?: (audio: Int16Array) => void;
  onError?: (code: string, message: string) => void;
}

interface QueuedItem {
  kind: 'text' | 'end';
  text?: string;
  language?: string;
}

const TTS_URL = 'wss://tts-rt.soniox.com/tts-websocket';
const CONNECTION_TIMEOUT_MS = 15000;
const KEEPALIVE_INTERVAL_MS = 20000;

export class SonioxTtsStream {
  private options: SonioxTtsOptions;
  private ws: WebSocket | null = null;
  private handlers: SonioxTtsStreamHandlers = {};
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;

  // Active stream state
  private activeStreamId: string | null = null;
  private activeLanguage: string | null = null;
  private activeStreamUsed = false;     // has the active stream received any text?
  private drainingStreamId: string | null = null; // used stream closed, terminated pending
  private queue: QueuedItem[] = [];
  private utteranceCounter = 0;
  private prewarmCounter = 0;

  constructor(options: SonioxTtsOptions) {
    this.options = options;
  }

  setHandlers(handlers: SonioxTtsStreamHandlers): void {
    this.handlers = handlers;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(TTS_URL);
      this.ws = ws;
      let opened = false;
      const timer = setTimeout(() => {
        if (!opened) {
          ws.close();
          reject(new Error('Soniox TTS connection timeout'));
        }
      }, CONNECTION_TIMEOUT_MS);

      ws.onopen = () => {
        opened = true;
        clearTimeout(timer);
        this.startKeepalive();
        resolve();
      };

      ws.onmessage = (event) => {
        let data: { stream_id?: string; audio?: string; terminated?: boolean; error_code?: number | string; error_message?: string };
        try {
          data = JSON.parse(event.data as string);
        } catch {
          return;
        }
        if (data.error_code != null) {
          this.handlers.onError?.(String(data.error_code), data.error_message ?? '');
          return;
        }
        if (data.audio) {
          this.handlers.onAudio?.(this.base64ToInt16(data.audio));
        }
        if (data.terminated) {
          if (data.stream_id === this.drainingStreamId) {
            this.drainingStreamId = null;
            this.flushQueue();
          }
        }
      };

      ws.onerror = (error) => {
        clearTimeout(timer);
        if (!opened) {
          reject(error instanceof Error ? error : new Error('Soniox TTS connection failed'));
        } else {
          this.handlers.onError?.('socket_error', String(error));
        }
      };

      ws.onclose = () => {
        clearTimeout(timer);
        this.stopKeepalive();
      };
    });
  }

  /** Pre-open a stream so the first utterance skips the config round-trip. */
  prewarm(language: string): void {
    if (!this.isOpen() || this.activeStreamId || this.drainingStreamId) return;
    this.prewarmCounter += 1;
    const streamId = `prewarm-${this.prewarmCounter}`;
    this.openStream(streamId, language);
  }

  sendText(text: string, language: string): void {
    if (!this.isOpen()) return;
    if (this.drainingStreamId) {
      this.queue.push({ kind: 'text', text, language });
      return;
    }
    this.doSendText(text, language);
  }

  endUtterance(): void {
    if (!this.isOpen()) return;
    if (this.drainingStreamId) {
      this.queue.push({ kind: 'end' });
      return;
    }
    this.doEndUtterance();
  }

  close(): void {
    this.stopKeepalive();
    this.queue = [];
    if (this.ws) {
      // Best-effort close of the active stream so the server frees it.
      if (this.activeStreamId && this.activeStreamUsed) {
        try {
          this.ws.send(JSON.stringify({ stream_id: this.activeStreamId, text: '', text_end: true }));
        } catch { /* closing anyway */ }
      }
      this.ws.close();
      this.ws = null;
    }
    this.activeStreamId = null;
    this.activeLanguage = null;
    this.activeStreamUsed = false;
    this.drainingStreamId = null;
  }

  isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private doSendText(text: string, language: string): void {
    // Unused stream (prewarm) with wrong language: discard immediately.
    // It produced no audio, so there is nothing to serialize against.
    if (this.activeStreamId && !this.activeStreamUsed && this.activeLanguage !== language) {
      this.ws!.send(JSON.stringify({ stream_id: this.activeStreamId, text: '', text_end: true }));
      this.activeStreamId = null;
      this.activeLanguage = null;
    }
    if (!this.activeStreamId) {
      this.utteranceCounter += 1;
      this.openStream(`utt-${this.utteranceCounter}`, language);
    }
    this.ws!.send(JSON.stringify({ stream_id: this.activeStreamId, text, text_end: false }));
    this.activeStreamUsed = true;
  }

  private doEndUtterance(): void {
    if (!this.activeStreamId || !this.activeStreamUsed) return;
    this.ws!.send(JSON.stringify({ stream_id: this.activeStreamId, text: '', text_end: true }));
    // The stream produced audio: serialize the next one behind its terminated.
    this.drainingStreamId = this.activeStreamId;
    this.activeStreamId = null;
    this.activeLanguage = null;
    this.activeStreamUsed = false;
  }

  private flushQueue(): void {
    while (this.queue.length > 0 && !this.drainingStreamId) {
      const item = this.queue.shift()!;
      if (item.kind === 'text') {
        this.doSendText(item.text!, item.language!);
      } else {
        this.doEndUtterance();
      }
    }
  }

  private openStream(streamId: string, language: string): void {
    this.ws!.send(JSON.stringify({
      api_key: this.options.apiKey,
      stream_id: streamId,
      model: this.options.model,
      voice: this.options.voice,
      language,
      audio_format: 'pcm_s16le',
      sample_rate: this.options.sampleRate,
    }));
    this.activeStreamId = streamId;
    this.activeLanguage = language;
    this.activeStreamUsed = false;
  }

  private base64ToInt16(b64: string): Int16Array {
    const bin = atob(b64);
    const evenLength = bin.length - (bin.length % 2);
    const bytes = new Uint8Array(evenLength);
    for (let i = 0; i < evenLength; i++) bytes[i] = bin.charCodeAt(i);
    return new Int16Array(bytes.buffer);
  }

  private startKeepalive(): void {
    this.stopKeepalive();
    this.keepaliveTimer = setInterval(() => {
      if (this.isOpen()) {
        this.ws!.send(JSON.stringify({ keep_alive: true }));
      }
    }, KEEPALIVE_INTERVAL_MS);
  }

  private stopKeepalive(): void {
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/services/clients/SonioxTtsStream.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/clients/SonioxTtsStream.ts src/services/clients/SonioxTtsStream.test.ts
git commit -m "feat(soniox): TTS wire component with per-utterance streams and prewarm"
```

---

### Task 4: SonioxClient orchestrator

**Files:**
- Create: `src/services/clients/SonioxClient.ts`
- Test: `src/services/clients/SonioxClient.test.ts`

**Interfaces:**
- Consumes: `SonioxSttStream`/`SonioxTtsStream` (Tasks 2–3, exact signatures above), `SonioxSessionConfig`/`Provider.SONIOX` (Task 1).
- Produces: `class SonioxClient implements IClient` with `constructor(apiKey: string)` and `static validateApiKeyAndFetchModels(apiKey: string)` — consumed by the descriptor in Task 5.

Key behaviors (from the spec):
- Token routing: `translation_status` `original`/`none` → user item; `translation` → assistant item. `<end>`/`<fin>` pseudo-tokens filtered from display; `<end>` completes the current item pair and (when TTS active) calls `tts.endUtterance()`.
- Finals append to committed buffers; partial buffers reset on every message.
- TTS feeding: only `is_final && translation_status === 'translation'` tokens. Per-utterance TTS language: first such token's `language`, falling back to `targetLanguage` (in one_way it IS the target).
- Audio deltas are emitted **separately** (delta contains only `audio`) — MainPanel plays them and skips UI updates.
- two_way degrade: `twoWayTranslation && sourceLanguage === 'auto'` → treated as one_way (belt to the descriptor's brace).
- TTS is best-effort: connect failure or runtime error → log once via console.error + emit a realtime event, keep STT running.

- [ ] **Step 1: Write the failing test**

Create `src/services/clients/SonioxClient.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SonioxClient } from './SonioxClient';
import { SonioxSessionConfig, ConversationItem } from '../interfaces/IClient';
import { Provider } from '../../types/Provider';
import type { SonioxSttMessage, SonioxSttStreamHandlers, SonioxSttConfig } from './SonioxSttStream';

// --- Mock both wire components; capture instances for driving the client ---
const sttInstances: MockStt[] = [];
class MockStt {
  handlers: SonioxSttStreamHandlers = {};
  config: SonioxSttConfig | null = null;
  sentAudio: Int16Array[] = [];
  ended = false;
  closed = false;
  constructor() { sttInstances.push(this); }
  setHandlers(h: SonioxSttStreamHandlers) { this.handlers = h; }
  connect(config: SonioxSttConfig) { this.config = config; return Promise.resolve(); }
  sendAudio(a: Int16Array) { this.sentAudio.push(a); }
  finalize() {}
  end() { this.ended = true; }
  close() { this.closed = true; }
  isOpen() { return !this.closed; }
  // helper
  emit(msg: SonioxSttMessage) { this.handlers.onMessage?.(msg); }
}

const ttsInstances: MockTts[] = [];
class MockTts {
  handlers: { onAudio?: (a: Int16Array) => void; onError?: (c: string, m: string) => void } = {};
  options: unknown;
  prewarmed: string[] = [];
  sent: Array<{ text: string; language: string }> = [];
  utteranceEnds = 0;
  closed = false;
  static failConnect = false;
  constructor(options: unknown) { this.options = options; ttsInstances.push(this); }
  setHandlers(h: MockTts['handlers']) { this.handlers = h; }
  connect() { return MockTts.failConnect ? Promise.reject(new Error('boom')) : Promise.resolve(); }
  prewarm(lang: string) { this.prewarmed.push(lang); }
  sendText(text: string, language: string) { this.sent.push({ text, language }); }
  endUtterance() { this.utteranceEnds += 1; }
  close() { this.closed = true; }
  isOpen() { return !this.closed; }
}

vi.mock('./SonioxSttStream', () => ({ SonioxSttStream: vi.fn(() => new MockStt()) }));
vi.mock('./SonioxTtsStream', () => ({ SonioxTtsStream: vi.fn((o: unknown) => new MockTts(o)) }));

const BASE_CONFIG: SonioxSessionConfig = {
  provider: 'soniox',
  model: 'stt-rt-v5',
  voice: 'Maya',
  sourceLanguage: 'zh',
  targetLanguage: 'en',
  twoWayTranslation: false,
  textOnly: false,
};

function tok(text: string, extra: object = {}) {
  return { text, ...extra };
}

async function connectedClient(cfg: Partial<SonioxSessionConfig> = {}) {
  const client = new SonioxClient('key');
  const updates: Array<{ item: ConversationItem; delta?: any }> = [];
  client.setEventHandlers({ onConversationUpdated: (d) => updates.push(d) });
  await client.connect({ ...BASE_CONFIG, ...cfg });
  return { client, updates, stt: sttInstances.at(-1)!, tts: ttsInstances.at(-1) };
}

beforeEach(() => {
  sttInstances.length = 0;
  ttsInstances.length = 0;
  MockTts.failConnect = false;
});

describe('SonioxClient connect', () => {
  it('builds a one_way STT config with language hints from a concrete source', async () => {
    const { stt } = await connectedClient();
    expect(stt.config).toMatchObject({
      apiKey: 'key', model: 'stt-rt-v5', sampleRate: 24000,
      languageHints: ['zh'],
      translation: { type: 'one_way', target_language: 'en' },
    });
  });

  it('auto source sends no hints', async () => {
    const { stt } = await connectedClient({ sourceLanguage: 'auto' });
    expect(stt.config!.languageHints).toBeUndefined();
  });

  it('two_way uses source/target as language_a/language_b with both hints', async () => {
    const { stt } = await connectedClient({ twoWayTranslation: true });
    expect(stt.config!.translation).toEqual({ type: 'two_way', language_a: 'zh', language_b: 'en' });
    expect(stt.config!.languageHints).toEqual(['zh', 'en']);
  });

  it('two_way with auto source degrades to one_way', async () => {
    const { stt } = await connectedClient({ twoWayTranslation: true, sourceLanguage: 'auto' });
    expect(stt.config!.translation).toEqual({ type: 'one_way', target_language: 'en' });
  });

  it('textOnly skips TTS entirely; otherwise TTS connects and prewarns target', async () => {
    const a = await connectedClient({ textOnly: true });
    expect(a.tts).toBeUndefined();
    const b = await connectedClient({ textOnly: false });
    expect(b.tts).toBeDefined();
    expect(b.tts!.prewarmed).toEqual(['en']);
  });

  it('TTS connect failure degrades to text-only without failing connect', async () => {
    MockTts.failConnect = true;
    const { client } = await connectedClient();
    expect(client.isConnected()).toBe(true);
  });
});

describe('SonioxClient token handling', () => {
  it('routes originals to a user item and translations to an assistant item', async () => {
    const { updates, stt } = await connectedClient();
    stt.emit({ tokens: [
      tok('你好', { is_final: true, translation_status: 'original', language: 'zh' }),
      tok('Hello', { is_final: true, translation_status: 'translation', language: 'en' }),
    ] });
    const roles = updates.map((u) => u.item.role);
    expect(roles).toContain('user');
    expect(roles).toContain('assistant');
    const user = updates.find((u) => u.item.role === 'user')!;
    expect(user.item.formatted?.text).toBe('你好');
  });

  it('treats translation_status none as original side', async () => {
    const { updates, stt } = await connectedClient();
    stt.emit({ tokens: [tok('Hey', { is_final: true, translation_status: 'none' })] });
    expect(updates[0].item.role).toBe('user');
  });

  it('partials reset each message; finals accumulate', async () => {
    const { updates, stt } = await connectedClient();
    stt.emit({ tokens: [tok('He', { translation_status: 'original' })] });
    stt.emit({ tokens: [tok('He was', { translation_status: 'original' })] });
    stt.emit({ tokens: [tok('He was', { is_final: true, translation_status: 'original' })] });
    const texts = updates.filter((u) => u.item.role === 'user').map((u) => u.item.formatted?.text);
    expect(texts).toEqual(['He', 'He was', 'He was']);  // not 'HeHe was'
  });

  it('filters <end> and <fin> from display and completes the pair on <end>', async () => {
    const { updates, stt } = await connectedClient();
    stt.emit({ tokens: [
      tok('Hi', { is_final: true, translation_status: 'original' }),
      tok('你好', { is_final: true, translation_status: 'translation' }),
      tok('<end>'),
    ] });
    expect(updates.some((u) => u.item.formatted?.text?.includes('<end>'))).toBe(false);
    const completed = updates.filter((u) => u.item.status === 'completed');
    expect(completed.map((u) => u.item.role).sort()).toEqual(['assistant', 'user']);
    // next utterance opens fresh items
    stt.emit({ tokens: [tok('Again', { is_final: true, translation_status: 'original' })] });
    const userIds = new Set(updates.filter((u) => u.item.role === 'user').map((u) => u.item.id));
    expect(userIds.size).toBe(2);
  });
});

describe('SonioxClient TTS feeding', () => {
  it('feeds only final translation tokens, with per-utterance language', async () => {
    const { stt, tts } = await connectedClient();
    stt.emit({ tokens: [
      tok('partial', { translation_status: 'translation', language: 'en' }),   // partial → NOT fed
      tok('Hello', { is_final: true, translation_status: 'translation', language: 'en' }),
      tok('原文', { is_final: true, translation_status: 'original' }),          // original → NOT fed
    ] });
    expect(tts!.sent).toEqual([{ text: 'Hello', language: 'en' }]);
  });

  it('<end> ends the TTS utterance', async () => {
    const { stt, tts } = await connectedClient();
    stt.emit({ tokens: [
      tok('Hello', { is_final: true, translation_status: 'translation', language: 'en' }),
      tok('<end>'),
    ] });
    expect(tts!.utteranceEnds).toBe(1);
  });

  it('emits TTS audio as an audio-only delta on the assistant item', async () => {
    const { updates, stt, tts } = await connectedClient();
    stt.emit({ tokens: [tok('Hello', { is_final: true, translation_status: 'translation', language: 'en' })] });
    const audio = new Int16Array([5, 6]);
    tts!.handlers.onAudio!(audio);
    const audioUpdate = updates.find((u) => u.delta?.audio);
    expect(audioUpdate).toBeDefined();
    expect(audioUpdate!.item.role).toBe('assistant');
    expect(audioUpdate!.delta.text).toBeUndefined();
  });

  it('textOnly session never touches TTS', async () => {
    const { stt } = await connectedClient({ textOnly: true });
    stt.emit({ tokens: [tok('Hello', { is_final: true, translation_status: 'translation' }), tok('<end>')] });
    expect(ttsInstances).toHaveLength(0);
  });
});

describe('SonioxClient lifecycle and IClient contract', () => {
  it('forwards mic audio to the STT stream', async () => {
    const { client, stt } = await connectedClient();
    const pcm = new Int16Array([1]);
    client.appendInputAudio(pcm);
    expect(stt.sentAudio).toEqual([pcm]);
  });

  it('disconnect ends STT politely and closes TTS', async () => {
    const { client, stt, tts } = await connectedClient();
    await client.disconnect();
    expect(stt.ended).toBe(true);
    expect(stt.closed).toBe(true);
    expect(tts!.closed).toBe(true);
    expect(client.isConnected()).toBe(false);
  });

  it('no-interruption: createResponse/cancelResponse are no-ops and interruption never fires', async () => {
    const interrupted = vi.fn();
    const client = new SonioxClient('key');
    client.setEventHandlers({ onConversationInterrupted: interrupted });
    await client.connect(BASE_CONFIG);
    client.createResponse();
    client.cancelResponse();
    sttInstances.at(-1)!.emit({ tokens: [tok('x', { is_final: true })] });
    expect(interrupted).not.toHaveBeenCalled();
  });

  it('getProvider returns SONIOX', () => {
    expect(new SonioxClient('key').getProvider()).toBe(Provider.SONIOX);
  });

  it('rejects a non-soniox session config', async () => {
    const client = new SonioxClient('key');
    await expect(client.connect({ provider: 'gemini' } as any)).rejects.toThrow(/soniox/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/services/clients/SonioxClient.test.ts`
Expected: FAIL — cannot resolve `./SonioxClient`.

- [ ] **Step 3: Implement**

Create `src/services/clients/SonioxClient.ts`:

```ts
import {
  IClient,
  ConversationItem,
  SessionConfig,
  ClientEventHandlers,
  ApiKeyValidationResult,
  FilteredModel,
  ResponseConfig,
  SonioxSessionConfig
} from '../interfaces/IClient';
import { Provider, ProviderType } from '../../types/Provider';
import { SonioxSttStream, SonioxSttMessage, SonioxToken, SonioxTranslationConfig } from './SonioxSttStream';
import { SonioxTtsStream } from './SonioxTtsStream';
import i18n from '../../locales';

/**
 * Soniox speech-to-speech translation client.
 *
 * Orchestrates two protocol components:
 * - SonioxSttStream: STT+translation (always on)
 * - SonioxTtsStream: spoken translation (only when !textOnly; best-effort —
 *   a TTS failure degrades the session to subtitles, never kills it)
 *
 * All Sokuji conversation semantics (items, finals-only feeding, <end>
 * segmentation) live here; the streams speak only the Soniox wire protocol.
 *
 * No-interruption rule: createResponse/cancelResponse are no-ops and
 * onConversationInterrupted is never fired — the translation stream is
 * continuous and AI output must never be cut by user audio.
 */

const STT_MODEL = 'stt-rt-v5';
const TTS_MODEL = 'tts-rt-v1';
const SAMPLE_RATE = 24000; // Sokuji mic pipeline and ModernAudioPlayer both run at 24 kHz
const AUTH_PROBE_URL = 'https://api.soniox.com/v1/auth/temporary-api-key';

export class SonioxClient implements IClient {
  private apiKey: string;
  private stt: SonioxSttStream | null = null;
  private tts: SonioxTtsStream | null = null;
  private eventHandlers: ClientEventHandlers = {};
  private conversationItems: ConversationItem[] = [];
  private isConnectedState = false;
  private instanceId: string;
  private currentConfig: SonioxSessionConfig | null = null;

  // Per-utterance display state
  private currentUserItemId: string | null = null;
  private currentAssistantItemId: string | null = null;
  private userFinal = '';
  private assistantFinal = '';
  // TTS language for the in-flight utterance (two_way: from the first final
  // translation token; one_way: always the target language)
  private utteranceTtsLanguage: string | null = null;
  private ttsFailedOnce = false;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    this.instanceId = `soniox_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateItemId(type: string): string {
    return `${this.instanceId}_${type}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /** Validate the key with a cheap temporary-key probe (201 = valid). */
  static async validateApiKeyAndFetchModels(apiKey: string): Promise<{
    validation: ApiKeyValidationResult;
    models: FilteredModel[];
  }> {
    if (!apiKey) {
      return {
        validation: { valid: false, message: i18n.t('settings.errorValidatingApiKey'), validating: false },
        models: []
      };
    }
    try {
      const response = await fetch(AUTH_PROBE_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ usage_type: 'transcribe_websocket', expires_in_seconds: 60 }),
      });
      if (response.status === 200 || response.status === 201) {
        return {
          validation: { valid: true, message: i18n.t('settings.apiKeyValidationCompleted'), validating: false },
          models: [{ id: STT_MODEL, type: 'realtime', created: Date.now() }]
        };
      }
      if (response.status === 401 || response.status === 403) {
        return {
          validation: { valid: false, message: i18n.t('settings.invalidApiKeyFormat'), validating: false },
          models: []
        };
      }
      return {
        validation: { valid: false, message: `${i18n.t('settings.errorValidatingApiKey')}: HTTP ${response.status}`, validating: false },
        models: []
      };
    } catch (error: any) {
      return {
        validation: { valid: false, message: error.message || i18n.t('settings.errorValidatingApiKey'), validating: false },
        models: []
      };
    }
  }

  async connect(config: SessionConfig): Promise<void> {
    if (config.provider !== 'soniox') {
      throw new Error('Invalid session config for Soniox client');
    }
    this.currentConfig = config as SonioxSessionConfig;
    this.reset();

    const cfg = this.currentConfig;
    // two_way needs a concrete source; degrade to one_way on 'auto'
    // (the descriptor applies the same rule — this is the safety belt).
    const effectiveTwoWay = cfg.twoWayTranslation && cfg.sourceLanguage !== 'auto';
    const translation: SonioxTranslationConfig = effectiveTwoWay
      ? { type: 'two_way', language_a: cfg.sourceLanguage, language_b: cfg.targetLanguage }
      : { type: 'one_way', target_language: cfg.targetLanguage };
    const languageHints = effectiveTwoWay
      ? [cfg.sourceLanguage, cfg.targetLanguage]
      : (cfg.sourceLanguage !== 'auto' ? [cfg.sourceLanguage] : undefined);

    this.stt = new SonioxSttStream();
    this.stt.setHandlers({
      onMessage: (message) => this.handleSttMessage(message),
      onError: (code, message) => this.handleSttError(code, message),
      onClose: (event) => {
        this.isConnectedState = false;
        this.emitRealtime('client', 'session.closed', { provider: 'soniox', ...event });
        this.eventHandlers.onClose?.(event);
      },
    });
    await this.stt.connect({
      apiKey: this.apiKey,
      model: cfg.model || STT_MODEL,
      sampleRate: SAMPLE_RATE,
      languageHints,
      translation,
    });
    this.isConnectedState = true;

    if (!cfg.textOnly) {
      try {
        this.tts = new SonioxTtsStream({
          apiKey: this.apiKey,
          voice: cfg.voice || 'Maya',
          model: TTS_MODEL,
          sampleRate: SAMPLE_RATE,
        });
        this.tts.setHandlers({
          onAudio: (audio) => this.emitAssistantAudio(audio),
          onError: (code, message) => this.handleTtsError(code, message),
        });
        await this.tts.connect();
        this.tts.prewarm(cfg.targetLanguage);
      } catch (error) {
        // TTS is best-effort: never fail the session because audio is unavailable.
        console.error('[SonioxClient] TTS connect failed — continuing text-only:', error);
        this.emitRealtime('client', 'tts.degraded', { reason: String(error) });
        this.tts = null;
      }
    }

    this.emitRealtime('client', 'session.opened', {
      provider: 'soniox',
      translation,
      textOnly: !!cfg.textOnly,
    });
    this.eventHandlers.onOpen?.();
  }

  private handleSttMessage(message: SonioxSttMessage): void {
    this.emitRealtime('server', 'message.received', message);
    const tokens = message.tokens ?? [];

    // Partials are re-sent in full on every message: rebuild them each time.
    let userPartial = '';
    let assistantPartial = '';

    for (const token of tokens) {
      const text = token.text ?? '';
      if (text === '<fin>') continue;
      if (text === '<end>') {
        this.finishUtterance();
        continue;
      }
      const isTranslation = token.translation_status === 'translation';
      if (isTranslation) {
        if (token.is_final) {
          this.assistantFinal += text;
          this.feedTts(text, token);
        } else {
          assistantPartial += text;
        }
      } else {
        if (token.is_final) {
          this.userFinal += text;
        } else {
          userPartial += text;
        }
      }
    }

    this.emitTextUpdate('user', this.userFinal, userPartial);
    this.emitTextUpdate('assistant', this.assistantFinal, assistantPartial);
  }

  private feedTts(text: string, token: SonioxToken): void {
    if (!this.tts) return;
    if (this.utteranceTtsLanguage === null) {
      this.utteranceTtsLanguage = token.language || this.currentConfig?.targetLanguage || 'en';
    }
    this.tts.sendText(text, this.utteranceTtsLanguage);
  }

  /** Emit/refresh the in-progress item for one side of the pair. */
  private emitTextUpdate(role: 'user' | 'assistant', finalText: string, partialText: string): void {
    const text = finalText + partialText;
    if (!text) return;
    if (role === 'user' && !this.currentUserItemId) this.currentUserItemId = this.generateItemId('user');
    if (role === 'assistant' && !this.currentAssistantItemId) this.currentAssistantItemId = this.generateItemId('assistant');
    const item: ConversationItem = {
      id: role === 'user' ? this.currentUserItemId! : this.currentAssistantItemId!,
      role,
      type: 'message',
      status: 'in_progress',
      createdAt: Date.now(),
      formatted: { text, transcript: text },
      content: [{ type: 'text', text }],
    };
    this.eventHandlers.onConversationUpdated?.({ item, delta: { text } });
  }

  /** <end>: complete both sides, push to history, reset per-utterance state. */
  private finishUtterance(): void {
    const complete = (role: 'user' | 'assistant', id: string | null, text: string) => {
      if (!id || !text) return;
      const item: ConversationItem = {
        id,
        role,
        type: 'message',
        status: 'completed',
        createdAt: Date.now(),
        formatted: { text, transcript: text },
        content: [{ type: 'text', text }],
      };
      this.conversationItems.push(item);
      this.eventHandlers.onConversationUpdated?.({ item, delta: {} });
    };
    complete('user', this.currentUserItemId, this.userFinal);
    complete('assistant', this.currentAssistantItemId, this.assistantFinal);
    this.currentUserItemId = null;
    this.currentAssistantItemId = null;
    this.userFinal = '';
    this.assistantFinal = '';
    this.utteranceTtsLanguage = null;
    this.tts?.endUtterance();
  }

  /** TTS audio chunk → audio-only delta on the assistant item (MainPanel plays it). */
  private emitAssistantAudio(audio: Int16Array): void {
    if (!this.currentAssistantItemId) this.currentAssistantItemId = this.generateItemId('assistant');
    const item: ConversationItem = {
      id: this.currentAssistantItemId,
      role: 'assistant',
      type: 'message',
      status: 'in_progress',
      formatted: {},
    };
    this.eventHandlers.onConversationUpdated?.({ item, delta: { audio } });
  }

  private handleSttError(code: string, message: string): void {
    console.error(`[SonioxClient] STT error ${code}: ${message}`);
    const errorItem: ConversationItem = {
      id: this.generateItemId('error'),
      role: 'system',
      type: 'error',
      status: 'completed',
      formatted: { text: `[Soniox ${code}] ${message}` },
      content: [{ type: 'text', text: message }],
    };
    this.conversationItems.push(errorItem);
    this.eventHandlers.onConversationUpdated?.({ item: errorItem });
    this.eventHandlers.onError?.({ code, message });
  }

  private handleTtsError(code: string, message: string): void {
    // TTS errors are non-fatal: log once, keep subtitles running.
    if (!this.ttsFailedOnce) {
      this.ttsFailedOnce = true;
      console.error(`[SonioxClient] TTS error ${code}: ${message} — spoken translation degraded`);
      this.emitRealtime('client', 'tts.degraded', { code, message });
    }
  }

  private emitRealtime(source: 'client' | 'server', type: string, data: unknown): void {
    this.eventHandlers.onRealtimeEvent?.({
      source,
      event: { type, data },
    } as any);
  }

  async disconnect(): Promise<void> {
    if (this.stt) {
      this.stt.end();   // empty text frame: server flushes and closes
      this.stt.close();
      this.stt = null;
    }
    if (this.tts) {
      this.tts.close();
      this.tts = null;
    }
    this.isConnectedState = false;
    this.emitRealtime('client', 'session.closed', { provider: 'soniox', reason: 'client_disconnect' });
    this.eventHandlers.onClose?.({});
  }

  isConnected(): boolean {
    return this.isConnectedState;
  }

  updateSession(_config: Partial<SessionConfig>): void {
    console.warn('[SonioxClient] Session updates are not supported. Reconnect to change configuration.');
  }

  reset(): void {
    this.conversationItems = [];
    this.currentUserItemId = null;
    this.currentAssistantItemId = null;
    this.userFinal = '';
    this.assistantFinal = '';
    this.utteranceTtsLanguage = null;
    this.ttsFailedOnce = false;
  }

  appendInputAudio(audioData: Int16Array): void {
    if (!this.stt?.isOpen()) return;
    this.stt.sendAudio(audioData);
  }

  appendInputText(_text: string): void {
    console.warn('[SonioxClient] Text input is not supported for speech translation');
  }

  // Continuous streaming: responses are generated automatically by the server.
  createResponse(_config?: ResponseConfig): void { /* no-op by design */ }
  cancelResponse(_trackId?: string, _offset?: number): void { /* no-op by design (no-interruption rule) */ }

  getConversationItems(): ConversationItem[] {
    return [...this.conversationItems];
  }

  clearConversationItems(): void {
    this.conversationItems = [];
  }

  setEventHandlers(handlers: ClientEventHandlers): void {
    this.eventHandlers = { ...handlers };
  }

  getProvider(): ProviderType {
    return Provider.SONIOX;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/services/clients/SonioxClient.test.ts`
Expected: PASS (16 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/clients/SonioxClient.ts src/services/clients/SonioxClient.test.ts
git commit -m "feat(soniox): STS orchestrator client — finals-only TTS feed, textOnly, degradation"
```

---

### Task 5: Descriptor, registration, settings slice, locale, registry tests

**Files:**
- Create: `src/services/providers/SonioxProviderConfig.ts`
- Modify: `src/services/providers/ProviderConfigFactory.ts`
- Modify: `src/stores/settingsStore.ts`
- Modify: `src/locales/en/translation.json`
- Modify: `src/services/providers/descriptorRegistry.test.ts`
- Modify: `src/stores/settingsStore.sliceRegistry.test.ts`

**Interfaces:**
- Consumes: `SonioxClient` (Task 4), `Provider.SONIOX` + `SonioxSessionConfig` (Task 1).
- Produces: `SonioxSettings`, `defaultSonioxSettings`, `SonioxProviderConfig`; store slice `soniox` + action `updateSoniox` + hook `useSonioxSettings` — consumed by the UI in Task 6.

- [ ] **Step 1: Update the registry tests first (they are the failing tests)**

In `src/services/providers/descriptorRegistry.test.ts`:

1. Add import: `import { defaultSonioxSettings } from './SonioxProviderConfig';`
2. Add to `DEFAULTS_BY_SLICE`: `soniox: defaultSonioxSettings,`
3. Change `expect(ids.length).toBe(12);` → `expect(ids.length).toBe(13);`
4. Add to `wireTag`: `soniox: 'soniox',`
5. Add to `EXPECTED_SLICE_KEYS`: `[Provider.SONIOX]: 'soniox',`
6. Add to `EXPECTED_SUPPORTS_WEBRTC`: `[Provider.SONIOX]: false,`

In `src/stores/settingsStore.sliceRegistry.test.ts`, add to the `PLAIN` array:

```ts
  ['updateSoniox', 'soniox', { apiKey: 's1' }],
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- src/services/providers/descriptorRegistry.test.ts src/stores/settingsStore.sliceRegistry.test.ts`
Expected: FAIL — cannot resolve `./SonioxProviderConfig`.

- [ ] **Step 3: Create the descriptor**

Create `src/services/providers/SonioxProviderConfig.ts`:

```ts
import { ProviderConfig, LanguageOption, VoiceOption, ModelOption } from './ProviderConfig';
import { BaseProviderDescriptor, Credentials, ClientOptions } from './ProviderDescriptor';
import { IClient, FilteredModel, SessionConfig, SonioxSessionConfig } from '../interfaces/IClient';
import { ApiKeyValidationResult } from '../interfaces/ISettingsService';
import { SonioxClient } from '../clients/SonioxClient';

// Soniox Settings — single BYOK API key (extractCredentials inherited from base)
export interface SonioxSettings {
  apiKey: string;
  sourceLanguage: string;     // 'auto' | ISO code
  targetLanguage: string;
  twoWayTranslation: boolean; // one_way ↔ two_way translation mode
  voice: string;              // TTS voice, one of VOICES
  model: string;
}

export const defaultSonioxSettings: SonioxSettings = {
  apiKey: '',
  sourceLanguage: 'auto',
  targetLanguage: 'en',
  twoWayTranslation: false,
  voice: 'Maya',
  model: 'stt-rt-v5',
};

export class SonioxProviderConfig extends BaseProviderDescriptor {
  readonly settingsSliceKey: string = 'soniox';
  readonly supportsWebRTC = false;

  createClient(creds: Credentials & { ok: true }, _options: ClientOptions): IClient {
    return new SonioxClient(creds.primary);
  }

  async validateAndFetchModels(creds: Credentials): Promise<{
    validation: ApiKeyValidationResult; models: FilteredModel[];
  }> {
    if (!creds.ok) {
      return { validation: { valid: false, message: creds.missing, validating: false }, models: [] };
    }
    return SonioxClient.validateApiKeyAndFetchModels(creds.primary);
  }

  buildSessionConfig(slice: unknown, systemInstructions: string): SessionConfig {
    const settings = slice as SonioxSettings;
    return {
      provider: 'soniox',
      model: settings.model || 'stt-rt-v5',
      voice: settings.voice || 'Maya',
      instructions: systemInstructions,
      sourceLanguage: settings.sourceLanguage,
      targetLanguage: settings.targetLanguage,
      // two_way requires a concrete source language ('auto' would be ambiguous)
      twoWayTranslation: settings.twoWayTranslation && settings.sourceLanguage !== 'auto',
    } as SonioxSessionConfig;
  }

  // The 60 languages from Soniox's own STS demo app — translation is
  // any-to-any across this set, so source and target share one list
  // (the "Auto Detect" source option is injected by the generic UI).
  private static readonly LANGUAGES: LanguageOption[] = [
    { name: 'Afrikaans', value: 'af', englishName: 'Afrikaans' },
    { name: 'Shqip', value: 'sq', englishName: 'Albanian' },
    { name: 'العربية', value: 'ar', englishName: 'Arabic' },
    { name: 'Azərbaycan', value: 'az', englishName: 'Azerbaijani' },
    { name: 'Euskara', value: 'eu', englishName: 'Basque' },
    { name: 'Беларуская', value: 'be', englishName: 'Belarusian' },
    { name: 'বাংলা', value: 'bn', englishName: 'Bengali' },
    { name: 'Bosanski', value: 'bs', englishName: 'Bosnian' },
    { name: 'Български', value: 'bg', englishName: 'Bulgarian' },
    { name: 'Català', value: 'ca', englishName: 'Catalan' },
    { name: '中文', value: 'zh', englishName: 'Chinese' },
    { name: 'Hrvatski', value: 'hr', englishName: 'Croatian' },
    { name: 'Čeština', value: 'cs', englishName: 'Czech' },
    { name: 'Dansk', value: 'da', englishName: 'Danish' },
    { name: 'Nederlands', value: 'nl', englishName: 'Dutch' },
    { name: 'English', value: 'en', englishName: 'English' },
    { name: 'Eesti', value: 'et', englishName: 'Estonian' },
    { name: 'Suomi', value: 'fi', englishName: 'Finnish' },
    { name: 'Français', value: 'fr', englishName: 'French' },
    { name: 'Galego', value: 'gl', englishName: 'Galician' },
    { name: 'Deutsch', value: 'de', englishName: 'German' },
    { name: 'Ελληνικά', value: 'el', englishName: 'Greek' },
    { name: 'ગુજરાતી', value: 'gu', englishName: 'Gujarati' },
    { name: 'עברית', value: 'he', englishName: 'Hebrew' },
    { name: 'हिन्दी', value: 'hi', englishName: 'Hindi' },
    { name: 'Magyar', value: 'hu', englishName: 'Hungarian' },
    { name: 'Bahasa Indonesia', value: 'id', englishName: 'Indonesian' },
    { name: 'Italiano', value: 'it', englishName: 'Italian' },
    { name: '日本語', value: 'ja', englishName: 'Japanese' },
    { name: 'ಕನ್ನಡ', value: 'kn', englishName: 'Kannada' },
    { name: 'Қазақ', value: 'kk', englishName: 'Kazakh' },
    { name: '한국어', value: 'ko', englishName: 'Korean' },
    { name: 'Latviešu', value: 'lv', englishName: 'Latvian' },
    { name: 'Lietuvių', value: 'lt', englishName: 'Lithuanian' },
    { name: 'Македонски', value: 'mk', englishName: 'Macedonian' },
    { name: 'Bahasa Melayu', value: 'ms', englishName: 'Malay' },
    { name: 'മലയാളം', value: 'ml', englishName: 'Malayalam' },
    { name: 'मराठी', value: 'mr', englishName: 'Marathi' },
    { name: 'Norsk', value: 'no', englishName: 'Norwegian' },
    { name: 'فارسی', value: 'fa', englishName: 'Persian' },
    { name: 'Polski', value: 'pl', englishName: 'Polish' },
    { name: 'Português', value: 'pt', englishName: 'Portuguese' },
    { name: 'ਪੰਜਾਬੀ', value: 'pa', englishName: 'Punjabi' },
    { name: 'Română', value: 'ro', englishName: 'Romanian' },
    { name: 'Русский', value: 'ru', englishName: 'Russian' },
    { name: 'Српски', value: 'sr', englishName: 'Serbian' },
    { name: 'Slovenčina', value: 'sk', englishName: 'Slovak' },
    { name: 'Slovenščina', value: 'sl', englishName: 'Slovenian' },
    { name: 'Español', value: 'es', englishName: 'Spanish' },
    { name: 'Kiswahili', value: 'sw', englishName: 'Swahili' },
    { name: 'Svenska', value: 'sv', englishName: 'Swedish' },
    { name: 'Tagalog', value: 'tl', englishName: 'Tagalog' },
    { name: 'தமிழ்', value: 'ta', englishName: 'Tamil' },
    { name: 'తెలుగు', value: 'te', englishName: 'Telugu' },
    { name: 'ไทย', value: 'th', englishName: 'Thai' },
    { name: 'Türkçe', value: 'tr', englishName: 'Turkish' },
    { name: 'Українська', value: 'uk', englishName: 'Ukrainian' },
    { name: 'اردو', value: 'ur', englishName: 'Urdu' },
    { name: 'Tiếng Việt', value: 'vi', englishName: 'Vietnamese' },
    { name: 'Cymraeg', value: 'cy', englishName: 'Welsh' },
  ];

  // All 12 voices are multilingual (zh/ja/en verified live 2026-07-18):
  // one voice serves both two_way directions.
  private static readonly VOICES: VoiceOption[] = [
    { name: 'Adrian', value: 'Adrian' },
    { name: 'Claire', value: 'Claire' },
    { name: 'Daniel', value: 'Daniel' },
    { name: 'Emma', value: 'Emma' },
    { name: 'Grace', value: 'Grace' },
    { name: 'Jack', value: 'Jack' },
    { name: 'Kenji', value: 'Kenji' },
    { name: 'Maya', value: 'Maya' },
    { name: 'Mina', value: 'Mina' },
    { name: 'Nina', value: 'Nina' },
    { name: 'Noah', value: 'Noah' },
    { name: 'Owen', value: 'Owen' },
  ];

  private static readonly MODELS: ModelOption[] = [
    { id: 'stt-rt-v5', type: 'realtime' }
  ];

  getConfig(): ProviderConfig {
    return {
      id: 'soniox',
      displayName: 'Soniox',

      apiKeyLabel: 'API Key',
      apiKeyPlaceholder: 'Enter your Soniox API Key',

      languages: SonioxProviderConfig.LANGUAGES,
      voices: SonioxProviderConfig.VOICES,
      models: SonioxProviderConfig.MODELS,
      noiseReductionModes: [],
      transcriptModels: [],

      capabilities: {
        hasTemplateMode: false, // dedicated translation service — no prompt templates
        hasTurnDetection: false, // server-side endpoint detection, not user-configurable
        hasVoiceSettings: true, // TTS voice dropdown (12 multilingual voices)
        hasNoiseReduction: false,
        hasModelConfiguration: false,
        textOnlyCapability: 'optional', // toggle: subtitles-only vs spoken translation

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
    };
  }
}
```

Check `VoiceOption`'s shape in `src/services/providers/ProviderConfig.ts` before writing the VOICES table — if it has an `id` field instead of `value`, use the actual field names (mirror how `OpenAIProviderConfig.VOICES` is declared).

- [ ] **Step 4: Register in the factory**

In `src/services/providers/ProviderConfigFactory.ts`:
- Add import: `import { SonioxProviderConfig } from './SonioxProviderConfig';`
- In the static block, after the Zoom AI registration, add:

```ts
    // Soniox speech-to-speech translation — always available (BYOK)
    ProviderConfigFactory.configs.set(Provider.SONIOX, new SonioxProviderConfig());
```

- [ ] **Step 5: Wire the settings store**

In `src/stores/settingsStore.ts` (six mechanical edits, follow the volcengineST pattern in each spot):

1. Import (next to the other provider config imports):
```ts
import {
  SonioxSettings, defaultSonioxSettings,
} from '../services/providers/SonioxProviderConfig';
```
2. `export type { ... }` block: add `SonioxSettings,`.
3. `ProviderSettingsUnion`: append `| SonioxSettings`.
4. `SettingsStore` interface: state field `soniox: SonioxSettings;` (after `volcengineAST2`) and action `updateSoniox: (settings: Partial<SonioxSettings>) => void;` (after `updateVolcengineAST2`).
5. `PROVIDER_SLICE_REGISTRY`: add `soniox: { defaults: defaultSonioxSettings, persistErrors: 'swallow' },`.
6. Initial state: `soniox: defaultSonioxSettings,`; action wiring: `updateSoniox: (settings) => updateProviderSlice(set, 'soniox', settings),`; selector hooks section: `export const useSonioxSettings = () => useSettingsStore((state) => state.soniox);`.

- [ ] **Step 6: Add the en locale entry**

In `src/locales/en/translation.json`, inside the `providers` object (after `volcengine_st`), add:

```json
    "soniox": {
      "name": "Soniox",
      "description": "Real-time speech-to-speech translation",
      "apiKeyPlaceholder": "Enter your Soniox API Key"
    },
```

Other locales are NOT edited — i18next falls back to English for missing keys.

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm run test -- src/services/providers/descriptorRegistry.test.ts src/stores/settingsStore.sliceRegistry.test.ts src/types/Provider.test.ts`
Expected: PASS — count 13, all four tables satisfied, slice action merges and persists.

- [ ] **Step 8: Commit**

```bash
git add src/services/providers/SonioxProviderConfig.ts src/services/providers/ProviderConfigFactory.ts src/stores/settingsStore.ts src/locales/en/translation.json src/services/providers/descriptorRegistry.test.ts src/stores/settingsStore.sliceRegistry.test.ts
git commit -m "feat(soniox): descriptor, registration, settings slice, en locale"
```

---

### Task 6: Settings UI — provider icon + two-way toggle

**Files:**
- Modify: `src/components/Settings/sections/ProviderSection.tsx`
- Modify: `src/components/Icons/ProviderIcons.tsx`
- Modify: `src/components/Settings/sections/ProviderSpecificSettings.tsx`

The voice dropdown needs NO custom code — `renderVoiceSettings()` in `ProviderSpecificSettings.tsx` already renders `config.voices` for any provider with `hasVoiceSettings: true` and writes the `voice` field through `updateCurrentProviderSetting`. The API-key input and language selects are likewise generic. What Soniox needs: an icon, the `updateCurrentProviderSetting` branch, and a custom block for the two-way toggle.

- [ ] **Step 1: Add SonioxIcon**

In `src/components/Icons/ProviderIcons.tsx`, following the existing icon component pattern (look at `VolcengineIcon` for the exact prop shape), add:

```tsx
export const SonioxIcon: React.FC<{ size?: string | number }> = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    {/* Stylized sound-wave "S" mark */}
    <rect x="2" y="9" width="3" height="6" rx="1.5" fill="currentColor" />
    <rect x="7" y="5" width="3" height="14" rx="1.5" fill="currentColor" />
    <rect x="12" y="2" width="3" height="20" rx="1.5" fill="currentColor" />
    <rect x="17" y="7" width="3" height="10" rx="1.5" fill="currentColor" />
  </svg>
);
```

- [ ] **Step 2: Register the icon**

In `src/components/Settings/sections/ProviderSection.tsx`:
- Add `SonioxIcon` to the existing import from `ProviderIcons`.
- Add to `PROVIDER_ICONS`: `[Provider.SONIOX]: SonioxIcon,`.
- Do NOT add a `TUTORIAL_URLS` entry (no docs page yet).

- [ ] **Step 3: Wire ProviderSpecificSettings**

In `src/components/Settings/sections/ProviderSpecificSettings.tsx`:

1. Import the hooks (next to the other provider settings hooks — find `useVolcengineSTSettings` usage for the pattern):
```ts
const sonioxSettings = useSonioxSettings();
const updateSonioxSettings = useSettingsStore((state) => state.updateSoniox);
```
(Match the file's actual hook-acquisition style — if it destructures `updateVolcengineST` from the store differently, mirror that.)

2. In `updateCurrentProviderSetting`'s provider if-chain, add before the final `else`:
```ts
    } else if (provider === Provider.SONIOX) {
      updateSonioxSettings({ [key]: value });
```

3. Add a render function next to `renderVolcengineSTSettings` (the two-way toggle; languages come from the generic LanguageSection):
```tsx
  const renderSonioxSettings = () => {
    if (provider !== Provider.SONIOX) return null;
    const autoSource = sonioxSettings.sourceLanguage === 'auto';
    return (
      <div className="settings-section" id="soniox-settings-section">
        <h2>{t('settings.translationMode', 'Translation Mode')}</h2>
        <div className="setting-item">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={sonioxSettings.twoWayTranslation && !autoSource}
              disabled={isSessionActive || autoSource}
              onChange={(e) => updateSonioxSettings({ twoWayTranslation: e.target.checked })}
            />
            <span>{t('settings.sonioxTwoWay', 'Two-way translation')}</span>
          </label>
          <div className="setting-description">
            {autoSource
              ? t('settings.sonioxTwoWayNeedsSource', 'Select a specific source language to enable two-way translation')
              : t('settings.sonioxTwoWayDesc', 'Translate in both directions between the source and target languages')}
          </div>
        </div>
      </div>
    );
  };
```
Match the checkbox markup to an existing checkbox setting in the same file (e.g. search for `type="checkbox"`) so the styling classes are consistent — if the file uses a shared `Toggle`/`Checkbox` component, use that instead of a raw input.

4. Register the render call where `renderVolcengineSTSettings()` is invoked in the component's JSX output, adding `{renderSonioxSettings()}` alongside it.

- [ ] **Step 4: Run the component test suite**

Run: `npm run test -- src/components/Settings`
Expected: PASS (existing tests; no new component tests in v1 — the toggle logic is covered by the descriptor's degrade rule tested in Task 5, and registry invariants cover the wiring).

- [ ] **Step 5: Commit**

```bash
git add src/components/Icons/ProviderIcons.tsx src/components/Settings/sections/ProviderSection.tsx src/components/Settings/sections/ProviderSpecificSettings.tsx
git commit -m "feat(soniox): settings UI — icon, two-way toggle, voice via generic dropdown"
```

---

### Task 7: Extension CSP + full suite

**Files:**
- Modify: `extension/manifest.json`

- [ ] **Step 1: Extend connect-src**

In `extension/manifest.json` line ~116, append to the `connect-src` list (inside the existing `extension_pages` string, before the closing quote):

```
 https://api.soniox.com wss://stt-rt.soniox.com wss://tts-rt.soniox.com
```

- [ ] **Step 2: Run the extension consistency tests**

Run: `npm run test -- extension/`
Expected: PASS (the consistency test pins content_scripts and web_accessible_resources, not CSP — but run it to be sure nothing else asserts the manifest).

- [ ] **Step 3: Run the FULL test suite**

Run: `npm run test`
Expected: ALL PASS (1267+ pre-existing + ~32 new). Fix any fallout before committing.

- [ ] **Step 4: Commit**

```bash
git add extension/manifest.json
git commit -m "feat(soniox): allow Soniox endpoints in extension CSP"
```

---

### Task 8: Live smoke test (needs the user's API key)

No file changes. Verifies the real end-to-end path that mocks cannot.

- [ ] **Step 1: Key staging**

The user's Soniox key may still be staged at `/home/jiangzhuo/.claude/jobs/3c1ccd1c/tmp/soniox_key.txt`; if absent, ask the user for it. NEVER write the key into the repo or any committed file.

- [ ] **Step 2: Dev-server smoke**

Run `npm run dev`, open `http://localhost:5173`, then:
1. Settings → Provider → Soniox; paste the API key; confirm validation turns green (temporary-key probe).
2. Language: source 中文 → target English, textOnly ON. Start a session, speak Chinese: expect the transcription (user bubble) and English translation (assistant bubble) to stream, partials visibly firming into finals, one bubble pair per utterance.
3. textOnly OFF, voice Maya: speak again — expect spoken English translation through the speakers shortly after each utterance ends (0.5–1.5 s first-audio latency is normal).
4. Two-way toggle ON (source zh, target en): speak Chinese then English — expect each direction translated to the other, with TTS speaking the per-utterance language.
5. Source = Auto Detect: confirm the two-way toggle is disabled with the explanatory description.
6. Stop the session: confirm no console errors and the session closes cleanly.

- [ ] **Step 3: Report results to the user**

Report each checklist item's outcome honestly (including latency observations and any degradation events in LogsPanel). Any failure here goes back to the relevant task before proceeding.

- [ ] **Step 4: Final commit if fixes were needed**

```bash
git add -A && git commit -m "fix(soniox): smoke-test fallout"
```
(Skip if nothing changed.)

---

## Out of scope (do not implement)

- Backend-minted temporary keys / Kizuna-managed Soniox variant.
- Generic cross-provider STT/TTS composition layer (the file boundaries ARE the seams; nothing more in v1).
- Non-English locale entries (i18next falls back to en).
- Speaker diarization display, karaoke alignment, auto-reconnect.
- `keepReplayAudio` per-item audio accumulation (v1 plays audio live only; replay accumulation can follow the OpenAI GA pattern later if requested).
