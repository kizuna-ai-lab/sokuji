# OpenAI Live Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the BYOK provider `openai_live` that runs `gpt-live-1` as a simultaneous interpreter over the Live API's primary WebSocket, on Electron and the browser extension.

**Architecture:** A new `OpenAILiveClient` copied from `OpenAITranslateGAClient` (continuous stream, silence-timer segmentation, RMS-filtered audio) with a Live connect head (upgrade header injected per platform, `session.start` first frame), a graceful `session.close` handshake, and a stall watchdog that reconnects once. A thin `OpenAILiveProviderConfig` descriptor reuses the editable interpreter template and a 22-voice list; the store, factory, three settings components, 30 locale catalogs and the extension background gain one entry each.

**Tech Stack:** TypeScript strict, React 19, Zustand, Vitest (jsdom), browser `WebSocket`, Electron `webRequest` header injection (`ws-headers-set` IPC), Chrome `declarativeNetRequest`.

**Spec:** `docs/superpowers/specs/2026-09-12-openai-live-provider-design.md`

## Global Constraints

- Model id is exactly `gpt-live-1`; endpoint `wss://api.openai.com/v1/live/sessions` with no query string and no subprotocols; auth is an `Authorization: Bearer <key>` header on the upgrade (the `openai-insecure-api-key.` subprotocol is ignored by this endpoint).
- Audio on the wire is `{ type: 'audio/pcm', rate: 24000 }` mono PCM16, base64, even byte length. `session.input_audio.append` carries `audio`; `session.output_audio.delta` carries `delta`.
- No `console.*` in `src/services/**` (`consoleLedger.consistency.test.ts` fails otherwise). Clients never call `report()`; they use `onDiagnostic` / `onError` / `onRealtimeEvent`.
- Registered only under `isElectron() || isExtension()`. `supportsWebRTC = false`. `textOnlyCapability: 'never'`.
- Default voice `marin`; defaults `userSilenceDuration: 1.0`, `assistantSilenceDuration: 1.5` seconds; silence thresholds clamp to 0.1–3.0 s.
- Watchdog: two consecutive `session.usage.updated` with equal `usage.seconds` while voiced input was sent, or a socket close / `session.closed` not requested by us → one silent reconnect; a second unexpected end within 60 s of a reconnect → localized notice `mainPanel.openaiLiveConnectionLost`, `onError`, `onClose`.
- Locale catalogs (30 directories under `src/locales/`, all except `index.ts` and the test) stay in lockstep: every key added to `en` is added everywhere.
- Every commit message uses the conventional format and ends with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Never push; the user pushes.
- Run tests with `npm run test -- <path>` from the worktree root. Typecheck with `npx tsc --noEmit`.

---

### Task 1: Provider enum, session config type, exhaustive tables

**Files:**
- Modify: `src/types/Provider.ts:9-28`
- Modify: `src/services/interfaces/IClient.ts:128-147` (after `OpenAITranslateSessionConfig`) and `:316-330` (union + guards)
- Modify: `src/lib/setup/providerPath.test.ts:17-34`
- Modify: `src/services/providers/descriptorRegistry.test.ts:286-300, 318-333, 362-410`

**Interfaces:**
- Produces: `Provider.OPENAI_LIVE` (`'openai_live'`); `OpenAILiveSessionConfig`; `isOpenAILiveSessionConfig(config: SessionConfig): config is OpenAILiveSessionConfig`.

- [ ] **Step 1: Add the enum member**

In `src/types/Provider.ts`, after `OPENAI_TRANSLATE = 'openai_translate',` add:

```ts
  OPENAI_LIVE = 'openai_live',
```

and extend the `ProviderType` union on the line starting `export type ProviderType =` with `| Provider.OPENAI_LIVE` (place it after `Provider.OPENAI_TRANSLATE`).

- [ ] **Step 2: Add the session config type and guard**

In `src/services/interfaces/IClient.ts`, directly after the `OpenAITranslateSessionConfig` interface add:

```ts
/**
 * GPT-Live-1 interpreter session (Live API primary WebSocket). Every field is
 * fixed at session.start; `instructions` is the rendered interpreter template
 * and carries the language pair, which is why the pair is also kept here for
 * the UI and the participant swap.
 */
export interface OpenAILiveSessionConfig extends BaseSessionConfig {
  provider: 'openai_live';
  sourceLanguage?: string;
  targetLanguage: string;
  /** Client-side utterance segmentation, ms. Clamped to 100–3000 by the client. */
  userSilenceDurationMs?: number;
  assistantSilenceDurationMs?: number;
}
```

Add `| OpenAILiveSessionConfig` to the `export type SessionConfig = …` union (after `OpenAITranslateSessionConfig`), and directly after `isOpenAITranslateSessionConfig` add:

```ts
export function isOpenAILiveSessionConfig(config: SessionConfig): config is OpenAILiveSessionConfig {
  return config.provider === 'openai_live';
}
```

- [ ] **Step 3: Add the rows the exhaustive tables now require**

`src/lib/setup/providerPath.test.ts`, inside `EXPECTED`, after `[Provider.OPENAI_TRANSLATE]: 'own-key',`:

```ts
  [Provider.OPENAI_LIVE]: 'own-key',
```

`src/services/providers/descriptorRegistry.test.ts`:
- in `EXPECTED_SLICE_KEYS` after the `OPENAI_TRANSLATE` row: `[Provider.OPENAI_LIVE]: 'openaiLive',`
- in `EXPECTED_SUPPORTS_WEBRTC` after the `OPENAI_TRANSLATE` row: `[Provider.OPENAI_LIVE]: false,`
- in `PUSH_GATED` after the `OPENAI_TRANSLATE` row: `[Provider.OPENAI_LIVE]: undefined,`
- in `TEXT_INPUT` after the `OPENAI_TRANSLATE` row: `[Provider.OPENAI_LIVE]: undefined,`
- in `PTT_FINALIZATION` after the `OPENAI_TRANSLATE` row: `[Provider.OPENAI_LIVE]: undefined,`

- [ ] **Step 4: Run the two tests and the typecheck**

Run: `npm run test -- src/lib/setup/providerPath.test.ts src/services/providers/descriptorRegistry.test.ts`
Expected: PASS (the registry still counts 14 available providers — nothing is registered yet).

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/types/Provider.ts src/services/interfaces/IClient.ts src/lib/setup/providerPath.test.ts src/services/providers/descriptorRegistry.test.ts
git commit -m "feat(openai-live): add the openai_live provider id and session config type

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `OpenAILiveClient` — session start, connect, close, input

**Files:**
- Create: `src/services/clients/OpenAILiveClient.ts`
- Create: `src/services/clients/OpenAILiveClient.test.ts`

**Interfaces:**
- Consumes: `OpenAILiveSessionConfig`, `isOpenAILiveSessionConfig` (Task 1); `computeRms` from `./OpenAITranslateGAClient`; `OpenAIClient.fetchOpenAIModelsList(apiKey)`; `isElectron`, `isExtension` from `../../utils/environment`; `window.electron.invoke`; `chrome.runtime.sendMessage`.
- Produces: `class OpenAILiveClient implements IClient` with `constructor(apiKey: string)`, `static buildSessionStart(config: OpenAILiveSessionConfig, eventId: string): LiveSessionStart`, `static isLiveModel(id: string): boolean`, `static validateApiKeyAndFetchModels(apiKey: string)`; exported constants `LIVE_WS_URL`, `LIVE_HOST`, `LIVE_MODEL`; extension messages `OPENAI_LIVE_SET_HEADERS` `{ apiKey }` / `OPENAI_LIVE_CLEAR_HEADERS` (Task 9 implements the background side). Later tasks add methods to this same file.

- [ ] **Step 1: Write the failing tests**

Create `src/services/clients/OpenAILiveClient.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Environment is mocked per describe block below; default to Electron.
const env = vi.hoisted(() => ({ electron: true, extension: false }));
vi.mock('../../utils/environment', async (orig) => ({
  ...(await orig<typeof import('../../utils/environment')>()),
  isElectron: () => env.electron,
  isExtension: () => env.extension,
}));
vi.mock('../../locales', () => ({ default: { t: (key: string) => key } }));

import { OpenAILiveClient, LIVE_WS_URL, LIVE_HOST, LIVE_MODEL } from './OpenAILiveClient';
import type { OpenAILiveSessionConfig, ClientEventHandlers } from '../interfaces/IClient';

const baseConfig: OpenAILiveSessionConfig = {
  provider: 'openai_live',
  model: LIVE_MODEL,
  voice: 'marin',
  instructions: 'Translate everything into Japanese.',
  targetLanguage: 'ja',
};

function makeMockWs() {
  return {
    readyState: 0,
    send: vi.fn(),
    close: vi.fn(),
    onopen: null as null | ((e: unknown) => void),
    onmessage: null as null | ((e: { data: string }) => void),
    onerror: null as null | ((e: unknown) => void),
    onclose: null as null | ((e: { code: number; reason: string }) => void),
  };
}

/** Let async header registration and the socket construction settle. */
async function flush(turns = 10) {
  for (let i = 0; i < turns; i++) await Promise.resolve();
}

/** Drive the mock through open → session.started so connect() resolves. */
function completeHandshake(ws: ReturnType<typeof makeMockWs>, sessionId = 'live_1') {
  ws.readyState = 1;
  ws.onopen?.({});
  ws.onmessage?.({ data: JSON.stringify({ type: 'session.started', session: { id: sessionId, expires_at: 1789000000, status: 'active', model: LIVE_MODEL } }) });
}

describe('OpenAILiveClient.buildSessionStart', () => {
  it('builds the Live session.start frame with model, instructions, 24 kHz pcm, voice and client delegation', () => {
    const frame = OpenAILiveClient.buildSessionStart(baseConfig, 'start_1');
    expect(frame).toEqual({
      type: 'session.start',
      event_id: 'start_1',
      session: {
        model: 'gpt-live-1',
        instructions: 'Translate everything into Japanese.',
        audio: { format: { type: 'audio/pcm', rate: 24000 }, output: { voice: 'marin' } },
        delegation: { type: 'client' },
      },
    });
  });

  it('falls back to marin when no voice is configured', () => {
    const frame = OpenAILiveClient.buildSessionStart({ ...baseConfig, voice: undefined }, 'start_2');
    expect(frame.session.audio.output.voice).toBe('marin');
  });
});

describe('OpenAILiveClient.isLiveModel', () => {
  it('accepts gpt-live-1 and dated gpt-live- ids, rejects transcribe and realtime ids', () => {
    expect(OpenAILiveClient.isLiveModel('gpt-live-1')).toBe(true);
    expect(OpenAILiveClient.isLiveModel('gpt-live-1-2026-09-10')).toBe(true);
    expect(OpenAILiveClient.isLiveModel('gpt-live-transcribe')).toBe(false);
    expect(OpenAILiveClient.isLiveModel('gpt-realtime-2.1')).toBe(false);
    expect(OpenAILiveClient.isLiveModel('gpt-realtime-translate')).toBe(false);
  });
});

describe('OpenAILiveClient connect (Electron header injection)', () => {
  let ws: ReturnType<typeof makeMockWs>;
  let originalWebSocket: unknown;
  let invoke: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    env.electron = true; env.extension = false;
    originalWebSocket = (globalThis as any).WebSocket;
    ws = makeMockWs();
    (globalThis as any).WebSocket = vi.fn(function () { return ws; });
    invoke = vi.fn(async () => ({ success: true }));
    (window as any).electron = { invoke };
  });
  afterEach(() => {
    (globalThis as any).WebSocket = originalWebSocket;
    delete (window as any).electron;
  });

  it('registers the Authorization header for api.openai.com before opening the socket, then opens the Live URL bare', async () => {
    const client = new OpenAILiveClient('sk-test');
    const p = client.connect(baseConfig);
    await flush();
    expect(invoke).toHaveBeenCalledWith('ws-headers-set', {
      host: LIVE_HOST,
      headers: { Authorization: 'Bearer sk-test' },
    });
    expect(invoke.mock.invocationCallOrder[0]).toBeLessThan(((globalThis as any).WebSocket as any).mock.invocationCallOrder[0]);
    expect((globalThis as any).WebSocket).toHaveBeenCalledWith(LIVE_WS_URL);
    completeHandshake(ws);
    await p;
    expect(client.isConnected()).toBe(true);
  });

  it('sends session.start as the first frame after open and resolves on session.started', async () => {
    const client = new OpenAILiveClient('sk-test');
    const opened = vi.fn();
    client.setEventHandlers({ onOpen: opened } as ClientEventHandlers);
    const p = client.connect(baseConfig);
    await flush();
    completeHandshake(ws, 'live_abc');
    await p;
    const first = JSON.parse(ws.send.mock.calls[0][0]);
    expect(first.type).toBe('session.start');
    expect(first.session.model).toBe('gpt-live-1');
    expect(opened).toHaveBeenCalledTimes(1);
  });

  it('rejects connect and clears the header when the server answers session.start with an error', async () => {
    const client = new OpenAILiveClient('sk-test');
    const p = client.connect(baseConfig);
    await flush();
    ws.readyState = 1;
    ws.onopen?.({});
    ws.onmessage?.({ data: JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'bad instructions' } }) });
    await expect(p).rejects.toThrow('bad instructions');
    expect(invoke).toHaveBeenCalledWith('ws-headers-clear', { host: LIVE_HOST });
  });

  it('throws when header registration fails and never opens a socket', async () => {
    invoke.mockResolvedValueOnce({ success: false, error: 'nope' });
    const client = new OpenAILiveClient('sk-test');
    await expect(client.connect(baseConfig)).rejects.toThrow('Failed to register WS headers: nope');
    expect((globalThis as any).WebSocket).not.toHaveBeenCalled();
  });

  it('appendInputAudio sends base64 session.input_audio.append and logs only voiced frames', async () => {
    const client = new OpenAILiveClient('sk-test');
    const events: any[] = [];
    client.setEventHandlers({ onRealtimeEvent: (e) => events.push(e) } as ClientEventHandlers);
    const p = client.connect(baseConfig);
    await flush();
    completeHandshake(ws);
    await p;
    ws.send.mockClear();
    events.length = 0;

    client.appendInputAudio(new Int16Array([0, 0, 0, 0]));
    client.appendInputAudio(new Int16Array([1000, -1000, 1000, -1000]));

    expect(ws.send).toHaveBeenCalledTimes(2);
    const payload = JSON.parse(ws.send.mock.calls[1][0]);
    expect(payload.type).toBe('session.input_audio.append');
    expect(typeof payload.audio).toBe('string');
    const logged = events.filter(e => e.event.type === 'session.input_audio.append');
    expect(logged).toHaveLength(1);
    expect(logged[0].event.data.rms).toBeGreaterThan(0);
  });

  it('disconnect sends session.close, waits for session.closed, then closes the socket', async () => {
    vi.useFakeTimers();
    try {
      const client = new OpenAILiveClient('sk-test');
      const p = client.connect(baseConfig);
      await flush();
      completeHandshake(ws);
      await p;
      ws.send.mockClear();

      const d = client.disconnect();
      await Promise.resolve();
      expect(JSON.parse(ws.send.mock.calls[0][0])).toEqual({ type: 'session.close' });
      expect(ws.close).not.toHaveBeenCalled();
      ws.onmessage?.({ data: JSON.stringify({ type: 'session.closed', reason: 'close_requested', usage: { seconds: 12 } }) });
      await d;
      expect(ws.close).toHaveBeenCalledTimes(1);
      expect(client.isConnected()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('disconnect gives up waiting for session.closed after 5 s and still closes the socket', async () => {
    vi.useFakeTimers();
    try {
      const client = new OpenAILiveClient('sk-test');
      const events: any[] = [];
      client.setEventHandlers({ onRealtimeEvent: (e) => events.push(e) } as ClientEventHandlers);
      const p = client.connect(baseConfig);
      await flush();
      completeHandshake(ws);
      await p;

      const d = client.disconnect();
      await vi.advanceTimersByTimeAsync(5000);
      await d;
      expect(ws.close).toHaveBeenCalledTimes(1);
      expect(events.some(e => e.event.type === 'session.close_timeout')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('OpenAILiveClient connect (extension DNR header injection)', () => {
  let ws: ReturnType<typeof makeMockWs>;
  let originalWebSocket: unknown;
  let sendMessage: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    env.electron = false; env.extension = true;
    originalWebSocket = (globalThis as any).WebSocket;
    ws = makeMockWs();
    (globalThis as any).WebSocket = vi.fn(function () { return ws; });
    sendMessage = vi.fn((_msg: unknown, cb?: (r: unknown) => void) => cb?.({ success: true }));
    (globalThis as any).chrome = { runtime: { sendMessage, lastError: undefined } };
  });
  afterEach(() => {
    (globalThis as any).WebSocket = originalWebSocket;
    delete (globalThis as any).chrome;
    env.electron = true; env.extension = false;
  });

  it('asks the background for the DNR rule, then clears it once session.started arrives', async () => {
    const client = new OpenAILiveClient('sk-ext');
    const p = client.connect(baseConfig);
    await flush();
    expect(sendMessage.mock.calls[0][0]).toEqual({ type: 'OPENAI_LIVE_SET_HEADERS', apiKey: 'sk-ext' });
    completeHandshake(ws);
    await p;
    expect(sendMessage.mock.calls.map(c => c[0].type)).toEqual(['OPENAI_LIVE_SET_HEADERS', 'OPENAI_LIVE_CLEAR_HEADERS']);
  });
});

describe('OpenAILiveClient connect (web build)', () => {
  it('refuses to connect where no header can be injected', async () => {
    env.electron = false; env.extension = false;
    try {
      const client = new OpenAILiveClient('sk-web');
      await expect(client.connect(baseConfig)).rejects.toThrow('OpenAI Live needs the desktop app or the browser extension');
    } finally {
      env.electron = true;
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -- src/services/clients/OpenAILiveClient.test.ts`
Expected: FAIL — `Cannot find module './OpenAILiveClient'`.

- [ ] **Step 3: Create the client**

Create `src/services/clients/OpenAILiveClient.ts`:

```ts
/**
 * OpenAILiveClient
 *
 * gpt-live-1 over the Live API's primary WebSocket, driven as a simultaneous
 * interpreter by the session instructions. A sibling of OpenAITranslateGAClient:
 * the same continuous no-turn-loop shape (transcript deltas on both sides,
 * real-time paced output audio, silence-timer segmentation) with a Live connect
 * head — the endpoint takes an `Authorization` header on the upgrade, which a
 * browser WebSocket cannot set, so the header is injected by the platform
 * (Electron `ws-headers-set`, extension declarativeNetRequest) before the socket
 * opens — and a `session.start` first frame instead of `session.update`.
 *
 * Design: docs/superpowers/specs/2026-09-12-openai-live-provider-design.md
 */
import {
  IClient,
  ConversationItem,
  SessionConfig,
  ClientEventHandlers,
  OpenAILiveSessionConfig,
  ApiKeyValidationResult,
  FilteredModel,
  ResponseConfig,
  isOpenAILiveSessionConfig,
} from '../interfaces/IClient';
import { Provider, ProviderType } from '../../types/Provider';
import { OpenAIClient } from './OpenAIClient';
import { computeRms } from './OpenAITranslateGAClient';
import { isElectron, isExtension } from '../../utils/environment';
import i18n from '../../locales';
import type { ClientDiagnosticCode } from '../../lib/diagnostics/clientDiagnostics';
import { describeCause } from '../../lib/diagnostics/describeCause';

export const LIVE_WS_URL = 'wss://api.openai.com/v1/live/sessions';
export const LIVE_HOST = 'api.openai.com';
export const LIVE_MODEL = 'gpt-live-1';
const DEFAULT_VOICE = 'marin';
/** PCM16 sample rate on both directions of the socket. */
const SAMPLE_RATE = 24000;
const SILENCE_TIMEOUT_MS = 1000;
const SILENCE_TIMEOUT_MIN_MS = 100;
const SILENCE_TIMEOUT_MAX_MS = 3000;
const SESSION_START_TIMEOUT_MS = 30000;
/** How long disconnect() waits for session.closed before closing the socket anyway. */
const CLOSE_TIMEOUT_MS = 5000;

export interface LiveSessionStart {
  type: 'session.start';
  event_id: string;
  session: {
    model: string;
    instructions: string;
    audio: { format: { type: 'audio/pcm'; rate: 24000 }; output: { voice: string } };
    delegation: { type: 'client' };
  };
}

function clampSilenceTimeout(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return SILENCE_TIMEOUT_MS;
  return Math.max(SILENCE_TIMEOUT_MIN_MS, Math.min(SILENCE_TIMEOUT_MAX_MS, value));
}

export class OpenAILiveClient implements IClient {
  private apiKey: string;
  private ws: WebSocket | null = null;
  private eventHandlers: ClientEventHandlers = {};
  private config: OpenAILiveSessionConfig | null = null;
  private connected: boolean = false;
  /** Set while disconnect() runs so a server-initiated close is not mistaken for an outage. */
  private closing: boolean = false;
  private closedReceived: boolean = false;
  private closeResolver: (() => void) | null = null;
  private headerPlatform: 'electron' | 'extension' | null = null;
  private sessionId: string | null = null;
  private expiresAt: number | null = null;
  private eventCounter: number = 0;

  /** Latches once a frame has failed to parse; cleared by the next frame that parses. */
  private parseFailed: boolean = false;

  // Independent state machines for the user (input) and assistant (output)
  // sides, as in OpenAITranslateGAClient: the translation lags the source and
  // spans its sentence boundaries, so each side closes on its own timer.
  private currentUserItemId: string | null = null;
  private currentAssistantItemId: string | null = null;
  private userSilenceTimer: ReturnType<typeof setTimeout> | null = null;
  private assistantSilenceTimer: ReturnType<typeof setTimeout> | null = null;
  private userSilenceTimeoutMs: number = SILENCE_TIMEOUT_MS;
  private assistantSilenceTimeoutMs: number = SILENCE_TIMEOUT_MS;
  private audioChunks: Map<string, Int16Array[]> = new Map();
  private keepReplayAudio: boolean = false;
  private audioCumSamples: Map<string, number> = new Map();
  private itemLookup: Map<string, ConversationItem> = new Map();
  private conversationItems: ConversationItem[] = [];
  private deltaSequenceNumber: number = 0;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  // ----- Static helpers -----

  /** The first frame on the primary WebSocket. Pure, so tests pin the wire shape. */
  static buildSessionStart(config: OpenAILiveSessionConfig, eventId: string): LiveSessionStart {
    return {
      type: 'session.start',
      event_id: eventId,
      session: {
        model: config.model || LIVE_MODEL,
        instructions: config.instructions ?? '',
        audio: {
          format: { type: 'audio/pcm', rate: 24000 },
          output: { voice: config.voice || DEFAULT_VOICE },
        },
        delegation: { type: 'client' },
      },
    };
  }

  /** `gpt-live-1` and any dated `gpt-live-…` snapshot; never the transcription model. */
  static isLiveModel(id: string): boolean {
    const name = id.toLowerCase();
    if (name.startsWith('gpt-live-transcribe')) return false;
    return name === LIVE_MODEL || name.startsWith('gpt-live-');
  }

  static async validateApiKeyAndFetchModels(apiKey: string): Promise<{
    validation: ApiKeyValidationResult;
    models: FilteredModel[];
  }> {
    const result = await OpenAIClient.fetchOpenAIModelsList(apiKey);
    if (result.error) return { validation: result.error, models: [] };

    const filtered = result.models
      .filter((m) => OpenAILiveClient.isLiveModel(m.id))
      .map((m) => ({ id: m.id, type: 'realtime' as const, created: m.created }))
      .sort((a, b) => b.created - a.created);

    if (filtered.length === 0) {
      return {
        validation: {
          valid: false,
          message: i18n.t('settings.realtimeModelNotAvailable'),
          validating: false,
          hasRealtimeModel: false,
        },
        models: [],
      };
    }
    return {
      validation: {
        valid: true,
        message: i18n.t('settings.realtimeModelAvailable'),
        validating: false,
        hasRealtimeModel: true,
      },
      models: filtered,
    };
  }

  // ----- Diagnostics -----

  private diagnose(code: ClientDiagnosticCode, message: string, cause?: unknown): void {
    this.eventHandlers.onDiagnostic?.({ code, message, cause });
  }

  private nextEventId(prefix: string): string {
    this.eventCounter += 1;
    return `${prefix}_${this.eventCounter}`;
  }

  private logClientEvent(type: string, data: unknown): void {
    this.eventHandlers.onRealtimeEvent?.({ source: 'client', event: { type, data } });
  }

  // ----- Upgrade header injection -----

  /**
   * The Live endpoint authenticates the WebSocket upgrade with an Authorization
   * header only (the `openai-insecure-api-key.` subprotocol the Realtime endpoint
   * accepts is ignored here — verified 2026-09-12). Browsers cannot set upgrade
   * headers, so each platform injects it: Electron's main process consumes a
   * one-shot rule on the next upgrade to this host; the extension's background
   * adds a declarativeNetRequest rule scoped to /v1/live/.
   */
  private async registerUpgradeHeader(): Promise<void> {
    if (isElectron() && window.electron?.invoke) {
      const result = await window.electron.invoke('ws-headers-set', {
        host: LIVE_HOST,
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      if (!result?.success) {
        throw new Error(`Failed to register WS headers: ${result?.error}`);
      }
      this.headerPlatform = 'electron';
      return;
    }
    if (isExtension()) {
      const result = await new Promise<{ success: boolean; error?: string }>((resolve) => {
        chrome!.runtime.sendMessage(
          { type: 'OPENAI_LIVE_SET_HEADERS', apiKey: this.apiKey },
          (response: { success: boolean; error?: string }) => {
            if (chrome!.runtime.lastError) {
              resolve({ success: false, error: chrome!.runtime.lastError.message });
            } else {
              resolve(response || { success: false, error: 'No response from background' });
            }
          },
        );
      });
      if (!result.success) {
        throw new Error(`Failed to set DNR headers: ${result.error}`);
      }
      this.headerPlatform = 'extension';
      return;
    }
    throw new Error('OpenAI Live needs the desktop app or the browser extension');
  }

  private clearUpgradeHeader(): void {
    const platform = this.headerPlatform;
    this.headerPlatform = null;
    if (platform === 'electron') {
      window.electron.invoke('ws-headers-clear', { host: LIVE_HOST }).catch(() => {});
    } else if (platform === 'extension') {
      try {
        chrome!.runtime.sendMessage({ type: 'OPENAI_LIVE_CLEAR_HEADERS' });
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  // ----- Session lifecycle -----

  private resetSessionState(): void {
    if (this.userSilenceTimer) clearTimeout(this.userSilenceTimer);
    if (this.assistantSilenceTimer) clearTimeout(this.assistantSilenceTimer);
    this.userSilenceTimer = null;
    this.assistantSilenceTimer = null;
    this.currentUserItemId = null;
    this.currentAssistantItemId = null;
    this.itemLookup.clear();
    this.conversationItems = [];
    this.audioChunks.clear();
    this.audioCumSamples.clear();
    this.deltaSequenceNumber = 0;
    this.closedReceived = false;
    this.closeResolver = null;
    this.sessionId = null;
    this.expiresAt = null;
  }

  /** Register the header, open the socket, send session.start, wait for session.started. */
  private async openSession(config: OpenAILiveSessionConfig): Promise<void> {
    await this.registerUpgradeHeader();
    try {
      this.closedReceived = false;
      this.ws = new WebSocket(LIVE_WS_URL);
      this.setupWebSocketListeners(this.ws);
      const start = OpenAILiveClient.buildSessionStart(config, this.nextEventId('start'));
      this.ws.onopen = () => {
        this.ws?.send(JSON.stringify(start));
        this.logClientEvent('session.start', start);
      };
      await this.waitForSessionStarted();
    } catch (error) {
      this.clearUpgradeHeader();
      throw error;
    }
    // Electron's rule was consumed by the upgrade; the extension's rule has
    // done its job. Clearing both is a no-op at worst.
    this.clearUpgradeHeader();
  }

  private setupWebSocketListeners(ws: WebSocket): void {
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.parseFailed = false;
        this.handleServerEvent(data);
      } catch (err) {
        if (!this.parseFailed) {
          this.parseFailed = true;
          this.diagnose('parse_error', `server message could not be parsed: ${describeCause(err)}`, err);
        }
      }
    };
    ws.onerror = (event) => {
      this.eventHandlers.onError?.(event);
    };
    ws.onclose = (event) => {
      this.handleSocketClosed(ws, event);
    };
  }

  private handleSocketClosed(ws: WebSocket, event: { code: number; reason: string }): void {
    if (this.ws !== null && this.ws !== ws) return; // a socket we already replaced
    if (this.closing) {
      this.settleClose();
      return;
    }
    if (this.connected) {
      this.connected = false;
      this.logClientEvent('session.closed', {
        status: 'disconnected', provider: 'openai_live', timestamp: Date.now(),
        reason: 'websocket_closed', code: event.code, detail: event.reason,
      });
      this.eventHandlers.onClose?.({ code: event.code, reason: event.reason });
    }
  }

  private waitForSessionStarted(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.ws) {
        reject(new Error('WebSocket not initialized'));
        return;
      }
      let settled = false;
      const ws = this.ws;
      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error('Session start timeout'));
        }
      }, SESSION_START_TIMEOUT_MS);

      // Temporarily intercept frames for the handshake, then hand back to the
      // regular handler installed by setupWebSocketListeners.
      const regularHandler = ws.onmessage;
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'session.started' && !settled) {
            settled = true;
            clearTimeout(timeout);
            ws.onmessage = regularHandler;
            this.sessionId = data.session?.id ?? null;
            this.expiresAt = data.session?.expires_at ?? null;
            if (regularHandler && typeof regularHandler === 'function') {
              regularHandler.call(ws, event);
            }
            resolve();
            return;
          }
          if (data.type === 'error' && !settled) {
            settled = true;
            clearTimeout(timeout);
            reject(new Error(data.error?.message || 'Session start failed'));
            return;
          }
        } catch {
          // ignore parse errors during handshake
        }
        if (regularHandler && typeof regularHandler === 'function') {
          regularHandler.call(ws, event);
        }
      };
      ws.onerror = () => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          reject(new Error('WebSocket error during session start'));
        }
      };
    });
  }

  private settleClose(): void {
    this.closedReceived = true;
    const resolver = this.closeResolver;
    this.closeResolver = null;
    resolver?.();
  }

  private waitForClosed(): Promise<void> {
    return new Promise((resolve) => {
      if (this.closedReceived) {
        resolve();
        return;
      }
      const timeout = setTimeout(() => {
        if (this.closeResolver) {
          this.closeResolver = null;
          this.logClientEvent('session.close_timeout', { provider: 'openai_live', waitedMs: CLOSE_TIMEOUT_MS });
          resolve();
        }
      }, CLOSE_TIMEOUT_MS);
      this.closeResolver = () => {
        clearTimeout(timeout);
        resolve();
      };
    });
  }

  // ----- Server events (extended in later tasks) -----

  private handleServerEvent(event: any): void {
    this.eventHandlers.onRealtimeEvent?.({
      source: 'server',
      event: { type: event.type, data: event },
    });

    switch (event.type) {
      case 'session.started':
      case 'session.updated':
        break;

      case 'session.closed':
        if (this.closing) {
          this.settleClose();
        }
        break;

      case 'error': {
        const errorMessage = event.error?.message || event.error?.code || 'Unknown error';
        const errorItem: ConversationItem = {
          id: this.genItemId(),
          role: 'system',
          type: 'error',
          status: 'completed',
          formatted: { text: `[${event.error?.type || 'error'}] ${errorMessage}` },
          content: [{ type: 'text', text: errorMessage }],
        };
        this.eventHandlers.onConversationUpdated?.({ item: errorItem });
        this.eventHandlers.onError?.(event.error || event);
        break;
      }

      default:
        // Unhandled event type — already logged via onRealtimeEvent above
        break;
    }
  }

  // ----- Item helpers (same shape as OpenAITranslateGAClient) -----

  private genItemId(): string {
    return `live_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }

  private completeUserItem(): void {
    if (!this.currentUserItemId) return;
    const item = this.itemLookup.get(this.currentUserItemId);
    if (item) {
      item.status = 'completed';
      if (item.formatted) item.formatted.text = item.formatted.transcript || '';
      this.eventHandlers.onConversationUpdated?.({ item });
    }
    this.currentUserItemId = null;
    if (this.userSilenceTimer) {
      clearTimeout(this.userSilenceTimer);
      this.userSilenceTimer = null;
    }
  }

  private completeAssistantItem(): void {
    if (!this.currentAssistantItemId) return;
    const itemId = this.currentAssistantItemId;
    const item = this.itemLookup.get(itemId);
    if (item) {
      item.status = 'completed';
      if (this.keepReplayAudio) {
        const chunks = this.audioChunks.get(itemId);
        if (chunks && chunks.length > 0 && item.formatted) {
          const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
          const merged = new Int16Array(totalLength);
          let offset = 0;
          for (const chunk of chunks) {
            merged.set(chunk, offset);
            offset += chunk.length;
          }
          item.formatted.audio = merged;
          this.audioChunks.delete(itemId);
        }
      }
      this.audioCumSamples.delete(itemId);
      if (item.formatted) item.formatted.text = item.formatted.transcript || '';
      this.eventHandlers.onConversationUpdated?.({ item });
    }
    this.currentAssistantItemId = null;
    if (this.assistantSilenceTimer) {
      clearTimeout(this.assistantSilenceTimer);
      this.assistantSilenceTimer = null;
    }
  }

  // ----- IClient -----

  async connect(config: SessionConfig): Promise<void> {
    if (!isOpenAILiveSessionConfig(config)) {
      throw new Error('OpenAILiveClient requires an openai_live session config');
    }
    this.config = config;
    this.resetSessionState();
    this.keepReplayAudio = config.keepReplayAudio ?? false;
    this.userSilenceTimeoutMs = clampSilenceTimeout(config.userSilenceDurationMs);
    this.assistantSilenceTimeoutMs = clampSilenceTimeout(config.assistantSilenceDurationMs);

    await this.openSession(config);

    this.connected = true;
    this.logClientEvent('session.opened', {
      status: 'connected',
      provider: 'openai_live',
      model: config.model,
      sessionId: this.sessionId,
      expiresAt: this.expiresAt,
      timestamp: Date.now(),
    });
    this.eventHandlers.onOpen?.();
  }

  async disconnect(): Promise<void> {
    this.closing = true;
    const ws = this.ws;
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'session.close' }));
      this.logClientEvent('session.close', { provider: 'openai_live', timestamp: Date.now() });
      await this.waitForClosed();
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    this.closing = false;
    this.clearUpgradeHeader();
    // Finalise in-flight items so partial transcripts/audio aren't lost.
    this.completeUserItem();
    this.completeAssistantItem();
  }

  isConnected(): boolean {
    return this.connected && this.ws?.readyState === 1;
  }

  /** Every startup field is immutable on the wire; only the local thresholds move. */
  updateSession(config: Partial<SessionConfig>): void {
    const live = config as Partial<OpenAILiveSessionConfig>;
    if (live.userSilenceDurationMs !== undefined) {
      this.userSilenceTimeoutMs = clampSilenceTimeout(live.userSilenceDurationMs);
    }
    if (live.assistantSilenceDurationMs !== undefined) {
      this.assistantSilenceTimeoutMs = clampSilenceTimeout(live.assistantSilenceDurationMs);
    }
  }

  reset(): void {
    this.resetSessionState();
  }

  appendInputAudio(audioData: Int16Array): void {
    if (!this.ws || this.ws.readyState !== 1) return;
    const payload = {
      type: 'session.input_audio.append' as const,
      audio: int16ArrayToBase64(audioData),
    };
    this.ws.send(JSON.stringify(payload));
    // Log only voiced frames: pre-speech silence would drown the timeline and
    // says nothing the next voiced frame doesn't. The wire send happened above.
    const rms = computeRms(audioData);
    if (rms === 0) return;
    this.logClientEvent(payload.type, { ...payload, rms });
  }

  appendInputText(_text: string): void { /* no-op: Live has no text input in this design */ }
  createResponse(_config?: ResponseConfig): void { /* no-op: continuous stream, no turn loop */ }
  cancelResponse(_trackId?: string, _offset?: number): void { /* no-op */ }
  getConversationItems(): ConversationItem[] { return [...this.conversationItems]; }
  clearConversationItems(): void {
    this.conversationItems = [];
    this.itemLookup.clear();
    this.audioChunks.clear();
    this.audioCumSamples.clear();
  }
  setEventHandlers(handlers: ClientEventHandlers): void { this.eventHandlers = { ...handlers }; }
  getProvider(): ProviderType { return Provider.OPENAI_LIVE; }
}

export function base64ToInt16Array(base64: string): Int16Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Int16Array(bytes.buffer);
}

export function int16ArrayToBase64(data: Int16Array): string {
  const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export { SAMPLE_RATE as LIVE_SAMPLE_RATE, SILENCE_TIMEOUT_MS, SILENCE_TIMEOUT_MIN_MS, SILENCE_TIMEOUT_MAX_MS };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -- src/services/clients/OpenAILiveClient.test.ts`
Expected: PASS (13 tests).

If `chrome!` does not typecheck, check `src/types/chrome.d.ts` — it declares `chrome: Chrome | undefined`, the same global `VolcengineAST2Client.ts` uses with the `!` postfix.

- [ ] **Step 5: Typecheck and the console ledger**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run test -- src/lib/diagnostics/consoleLedger.consistency.test.ts`
Expected: PASS (the new file has no `console.*`).

- [ ] **Step 6: Commit**

```bash
git add src/services/clients/OpenAILiveClient.ts src/services/clients/OpenAILiveClient.test.ts
git commit -m "feat(openai-live): Live WebSocket client — session.start, header injection, graceful close

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: `OpenAILiveClient` — transcripts, audio, segmentation

**Files:**
- Modify: `src/services/clients/OpenAILiveClient.ts` (the `handleServerEvent` switch and new item helpers)
- Modify: `src/services/clients/OpenAILiveClient.test.ts` (append a describe block)

**Interfaces:**
- Consumes: the class from Task 2.
- Produces: the conversation-item behaviour MainPanel relies on: user/assistant `ConversationItem`s with `formatted.transcript`, `formatted.audioSegments`, `formatted.audioTextEnd`, `formatted.audio` (when `keepReplayAudio`), `onConversationUpdated({ item, delta: { transcript } | { audio, sequenceNumber, timestamp } })`.

- [ ] **Step 1: Write the failing tests**

Append to `src/services/clients/OpenAILiveClient.test.ts`:

```ts
/** Build a base64-encoded PCM16 chunk of `samples` Int16 samples. */
function makePcmDelta(samples: number, value: number): string {
  const bytes = new Uint8Array(samples * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < samples; i++) view.setInt16(i * 2, value, true);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
const SILENT_DELTA = makePcmDelta(2400, 0);
const VOICED_DELTA = makePcmDelta(2400, 1000);

describe('OpenAILiveClient state machine', () => {
  let client: OpenAILiveClient;
  let updates: any[];
  let realtimeEvents: any[];

  beforeEach(() => {
    vi.useFakeTimers();
    client = new OpenAILiveClient('sk-test');
    updates = [];
    realtimeEvents = [];
    client.setEventHandlers({
      onConversationUpdated: (e) => updates.push(e),
      onRealtimeEvent: (e) => realtimeEvents.push(e),
    } as ClientEventHandlers);
  });
  afterEach(() => vi.useRealTimers());

  const feed = (event: unknown) => (client as any).handleServerEvent(event);

  it('creates a user item on the first input transcript delta and appends later deltas', () => {
    feed({ type: 'session.input_transcript.delta', delta: 'Hello', start_ms: 0, end_ms: 400 });
    feed({ type: 'session.input_transcript.delta', delta: ' there', start_ms: 400, end_ms: 800 });
    const items = client.getConversationItems();
    expect(items).toHaveLength(1);
    expect(items[0].role).toBe('user');
    expect(items[0].formatted?.transcript).toBe('Hello there');
    expect(items[0].status).toBe('in_progress');
  });

  it('creates an assistant item on the first output transcript delta, independent of the user item', () => {
    feed({ type: 'session.input_transcript.delta', delta: 'Hello' });
    feed({ type: 'session.output_transcript.delta', delta: 'こんにちは' });
    const items = client.getConversationItems();
    expect(items.map(i => i.role)).toEqual(['user', 'assistant']);
    expect(items[1].formatted?.transcript).toBe('こんにちは');
  });

  it('drops zero-amplitude output audio frames and does not open an assistant item for them', () => {
    feed({ type: 'session.output_audio.delta', delta: SILENT_DELTA });
    expect(client.getConversationItems()).toHaveLength(0);
    expect(realtimeEvents.some(e => e.event.type === 'session.output_audio.delta')).toBe(false);
  });

  it('opens an assistant item from the first voiced frame and emits audio deltas with sequence numbers', () => {
    feed({ type: 'session.output_audio.delta', delta: VOICED_DELTA });
    feed({ type: 'session.output_audio.delta', delta: VOICED_DELTA });
    const items = client.getConversationItems();
    expect(items).toHaveLength(1);
    expect(items[0].role).toBe('assistant');
    const audioUpdates = updates.filter(u => u.delta?.audio);
    expect(audioUpdates.map(u => u.delta.sequenceNumber)).toEqual([1, 2]);
    expect(audioUpdates[0].delta.audio).toBeInstanceOf(Int16Array);
    expect(audioUpdates[0].delta.audio.length).toBe(2400);
  });

  it('records karaoke segments anchored to the transcript length and cumulative audio time', () => {
    feed({ type: 'session.output_transcript.delta', delta: '皆さん' });
    feed({ type: 'session.output_audio.delta', delta: VOICED_DELTA });
    const item = client.getConversationItems()[0];
    expect(item.formatted?.audioSegments).toEqual([{ textEnd: 3, audioEnd: 2400 / 24000 }]);
    expect(item.formatted?.audioTextEnd).toBe(3);
  });

  it('keeps replay audio only when keepReplayAudio is on', async () => {
    (client as any).keepReplayAudio = true;
    feed({ type: 'session.output_audio.delta', delta: VOICED_DELTA });
    feed({ type: 'session.output_audio.delta', delta: VOICED_DELTA });
    vi.advanceTimersByTime(1001);
    const withReplay = client.getConversationItems()[0];
    expect(withReplay.status).toBe('completed');
    expect((withReplay.formatted?.audio as Int16Array).length).toBe(4800);

    client.clearConversationItems();
    (client as any).keepReplayAudio = false;
    (client as any).currentAssistantItemId = null;
    feed({ type: 'session.output_audio.delta', delta: VOICED_DELTA });
    vi.advanceTimersByTime(1001);
    const without = client.getConversationItems()[0];
    expect(without.status).toBe('completed');
    expect(without.formatted?.audio).toBeUndefined();
  });

  it('closes user and assistant items on their own silence timers', () => {
    (client as any).userSilenceTimeoutMs = 1000;
    (client as any).assistantSilenceTimeoutMs = 1500;
    feed({ type: 'session.input_transcript.delta', delta: 'Hello' });
    feed({ type: 'session.output_transcript.delta', delta: 'こんにちは' });
    vi.advanceTimersByTime(1001);
    let items = client.getConversationItems();
    expect(items[0].status).toBe('completed');
    expect(items[1].status).toBe('in_progress');
    vi.advanceTimersByTime(500);
    items = client.getConversationItems();
    expect(items[1].status).toBe('completed');
    expect(items[1].formatted?.text).toBe('こんにちは');
  });

  it('voiced audio keeps the assistant item open past the last transcript delta', () => {
    (client as any).assistantSilenceTimeoutMs = 1000;
    feed({ type: 'session.output_transcript.delta', delta: 'こんにちは' });
    vi.advanceTimersByTime(800);
    feed({ type: 'session.output_audio.delta', delta: VOICED_DELTA });
    vi.advanceTimersByTime(800);
    expect(client.getConversationItems()[0].status).toBe('in_progress');
    vi.advanceTimersByTime(201);
    expect(client.getConversationItems()[0].status).toBe('completed');
  });

  it('a new utterance after the user item closed starts a second user item', () => {
    (client as any).userSilenceTimeoutMs = 1000;
    feed({ type: 'session.input_transcript.delta', delta: 'One' });
    vi.advanceTimersByTime(1001);
    feed({ type: 'session.input_transcript.delta', delta: 'Two' });
    const users = client.getConversationItems().filter(i => i.role === 'user');
    expect(users.map(u => u.formatted?.transcript)).toEqual(['One', 'Two']);
  });

  it('logs delegation and usage events without touching the conversation', () => {
    feed({ type: 'session.delegation.created', delegation: { id: 'item_1', target: 'client', type: 'delegation' }, offset_ms: 100 });
    feed({ type: 'session.usage.updated', usage: { seconds: 15 }, context_window: { usage_ratio: 0.01 } });
    expect(client.getConversationItems()).toHaveLength(0);
    expect(realtimeEvents.map(e => e.event.type)).toEqual(['session.delegation.created', 'session.usage.updated']);
  });

  it('surfaces an error frame as a system item and onError', () => {
    const errors: any[] = [];
    client.setEventHandlers({ onConversationUpdated: (e) => updates.push(e), onError: (e) => errors.push(e) } as ClientEventHandlers);
    feed({ type: 'error', error: { type: 'invalid_request_error', code: 'immutable_field_update', message: 'nope' } });
    expect(updates.at(-1).item.type).toBe('error');
    expect(updates.at(-1).item.formatted.text).toBe('[invalid_request_error] nope');
    expect(errors).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `npm run test -- src/services/clients/OpenAILiveClient.test.ts`
Expected: the state-machine block fails (no items are created); Task 2's tests still pass.

- [ ] **Step 3: Add the item helpers and the event cases**

In `src/services/clients/OpenAILiveClient.ts`, directly after `genItemId()` add:

```ts
  private resetUserSilenceTimer(): void {
    if (this.userSilenceTimer) clearTimeout(this.userSilenceTimer);
    this.userSilenceTimer = setTimeout(() => {
      this.completeUserItem();
    }, this.userSilenceTimeoutMs);
  }

  private resetAssistantSilenceTimer(): void {
    if (this.assistantSilenceTimer) clearTimeout(this.assistantSilenceTimer);
    this.assistantSilenceTimer = setTimeout(() => {
      this.completeAssistantItem();
    }, this.assistantSilenceTimeoutMs);
  }

  private ensureUserItem(): string {
    if (this.currentUserItemId) return this.currentUserItemId;
    const id = this.genItemId();
    this.currentUserItemId = id;
    const item: ConversationItem = {
      id,
      role: 'user',
      type: 'message',
      status: 'in_progress',
      createdAt: Date.now(),
      formatted: { text: '', transcript: '' },
      content: [],
    };
    this.conversationItems.push(item);
    this.itemLookup.set(id, item);
    this.eventHandlers.onConversationUpdated?.({ item });
    return id;
  }

  private ensureAssistantItem(): string {
    if (this.currentAssistantItemId) return this.currentAssistantItemId;
    const id = this.genItemId();
    this.currentAssistantItemId = id;
    const item: ConversationItem = {
      id,
      role: 'assistant',
      type: 'message',
      status: 'in_progress',
      createdAt: Date.now(),
      formatted: { text: '', transcript: '' },
      content: [],
    };
    this.conversationItems.push(item);
    this.itemLookup.set(id, item);
    this.eventHandlers.onConversationUpdated?.({ item });
    return id;
  }
```

Replace the whole `handleServerEvent` method with:

```ts
  private handleServerEvent(event: any): void {
    // Decode + measure output audio once so the log carries the frame's RMS and
    // the case below reuses the buffer. Live streams zero-amplitude frames
    // continuously between utterances (like the translate API's heartbeat);
    // those are noise for the timeline and for the conversation.
    let decodedAudio: Int16Array | null = null;
    let audioRms: number | null = null;
    if (event.type === 'session.output_audio.delta' && event.delta) {
      decodedAudio = base64ToInt16Array(event.delta);
      audioRms = computeRms(decodedAudio);
      event.rms = audioRms;
    }
    const isSilentAudioFrame = event.type === 'session.output_audio.delta' && audioRms === 0;
    if (!isSilentAudioFrame) {
      this.eventHandlers.onRealtimeEvent?.({
        source: 'server',
        event: { type: event.type, data: event },
      });
    }

    switch (event.type) {
      case 'session.input_transcript.delta': {
        const userItemId = this.ensureUserItem();
        const userItem = this.itemLookup.get(userItemId);
        if (userItem?.formatted) {
          userItem.formatted.transcript = (userItem.formatted.transcript || '') + (event.delta || '');
        }
        this.eventHandlers.onConversationUpdated?.({
          item: userItem!,
          delta: { transcript: event.delta },
        });
        this.resetUserSilenceTimer();
        break;
      }

      case 'session.output_transcript.delta': {
        const assistantItemId = this.ensureAssistantItem();
        const assistantItem = this.itemLookup.get(assistantItemId);
        if (assistantItem?.formatted) {
          assistantItem.formatted.transcript = (assistantItem.formatted.transcript || '') + (event.delta || '');
        }
        this.eventHandlers.onConversationUpdated?.({
          item: assistantItem!,
          delta: { transcript: event.delta },
        });
        this.resetAssistantSilenceTimer();
        break;
      }

      case 'session.output_audio.delta': {
        if (!event.delta || !decodedAudio) break;
        if (audioRms === 0) break;
        const audioData = decodedAudio;

        const assistantItemId = this.currentAssistantItemId ?? this.ensureAssistantItem();
        const assistantItem = this.itemLookup.get(assistantItemId);
        if (!assistantItem) break;

        const sequenceNumber = ++this.deltaSequenceNumber;

        // Full-audio retention is the one thing that grows with session length;
        // karaoke timing below stays populated either way.
        if (this.keepReplayAudio) {
          if (!this.audioChunks.has(assistantItemId)) {
            this.audioChunks.set(assistantItemId, []);
          }
          this.audioChunks.get(assistantItemId)!.push(audioData);
        }
        const prevCumSamples = this.audioCumSamples.get(assistantItemId) ?? 0;
        const newCumSamples = prevCumSamples + audioData.length;
        this.audioCumSamples.set(assistantItemId, newCumSamples);

        // Anchor the current transcript end to cumulative audio time so the
        // highlight steps in chunk-aligned units (see OpenAITranslateGAClient,
        // issue #216). Transcript and audio are independent streams here too.
        if (assistantItem.formatted) {
          const textLen = assistantItem.formatted.transcript?.length ?? 0;
          if (!assistantItem.formatted.audioSegments) {
            assistantItem.formatted.audioSegments = [];
          }
          assistantItem.formatted.audioSegments.push({
            textEnd: textLen,
            audioEnd: newCumSamples / SAMPLE_RATE,
          });
          assistantItem.formatted.audioTextEnd = textLen;
        }

        this.eventHandlers.onConversationUpdated?.({
          item: assistantItem,
          delta: {
            audio: audioData,
            sequenceNumber,
            timestamp: Date.now(),
          },
        });
        // Voiced audio is real assistant activity — keep the item open until
        // playback-side rendering also winds down.
        this.resetAssistantSilenceTimer();
        break;
      }

      case 'session.delegation.created':
      case 'session.usage.updated':
      case 'session.instructions.appended':
      case 'session.thinking.appended':
      case 'session.commentary.appended':
      case 'session.input_audio.muted':
      case 'session.input_audio.unmuted':
      case 'session.started':
      case 'session.updated':
      case 'info':
        // No conversation impact; already forwarded via onRealtimeEvent above.
        break;

      case 'session.closed':
        if (this.closing) {
          this.settleClose();
        }
        break;

      case 'error': {
        const errorMessage = event.error?.message || event.error?.code || 'Unknown error';
        const errorItem: ConversationItem = {
          id: this.genItemId(),
          role: 'system',
          type: 'error',
          status: 'completed',
          formatted: { text: `[${event.error?.type || 'error'}] ${errorMessage}` },
          content: [{ type: 'text', text: errorMessage }],
        };
        this.eventHandlers.onConversationUpdated?.({ item: errorItem });
        this.eventHandlers.onError?.(event.error || event);
        break;
      }

      default:
        // Unhandled event type — already logged via onRealtimeEvent above
        break;
    }
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -- src/services/clients/OpenAILiveClient.test.ts`
Expected: PASS (24 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/clients/OpenAILiveClient.ts src/services/clients/OpenAILiveClient.test.ts
git commit -m "feat(openai-live): transcript and audio deltas into conversation items with silence segmentation

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: `OpenAILiveClient` — stall watchdog and one silent reconnect

**Files:**
- Modify: `src/services/clients/OpenAILiveClient.ts`
- Modify: `src/services/clients/OpenAILiveClient.test.ts` (append a describe block)

**Interfaces:**
- Consumes: `ClientEventHandlers.onReconnecting`, `onReconnected`, `onError`, `onClose`, `onConversationUpdated`; locale key `mainPanel.openaiLiveConnectionLost` (added in Task 8; the test mocks `i18n.t` to echo the key).
- Produces: realtime-log events `session.connection_lost`, `session.reconnecting`, `session.reconnected`; a client-held `role: 'system', type: 'error'` item on give-up.

- [ ] **Step 1: Write the failing tests**

Append to `src/services/clients/OpenAILiveClient.test.ts`:

```ts
describe('OpenAILiveClient watchdog and reconnect', () => {
  let sockets: ReturnType<typeof makeMockWs>[];
  let originalWebSocket: unknown;
  let handlers: { reconnecting: ReturnType<typeof vi.fn>; reconnected: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn>; updates: any[]; events: any[] };

  beforeEach(() => {
    vi.useFakeTimers();
    env.electron = true; env.extension = false;
    originalWebSocket = (globalThis as any).WebSocket;
    sockets = [];
    (globalThis as any).WebSocket = vi.fn(function () {
      const ws = makeMockWs();
      sockets.push(ws);
      return ws;
    });
    (window as any).electron = { invoke: vi.fn(async () => ({ success: true })) };
    handlers = { reconnecting: vi.fn(), reconnected: vi.fn(), error: vi.fn(), close: vi.fn(), updates: [], events: [] };
  });
  afterEach(() => {
    vi.useRealTimers();
    (globalThis as any).WebSocket = originalWebSocket;
    delete (window as any).electron;
  });

  async function connectedClient() {
    const client = new OpenAILiveClient('sk-test');
    client.setEventHandlers({
      onReconnecting: handlers.reconnecting,
      onReconnected: handlers.reconnected,
      onError: handlers.error,
      onClose: handlers.close,
      onConversationUpdated: (e) => handlers.updates.push(e),
      onRealtimeEvent: (e) => handlers.events.push(e),
    } as ClientEventHandlers);
    const p = client.connect(baseConfig);
    await flush();
    completeHandshake(sockets[0]);
    await p;
    return client;
  }

  /** Let the reconnect's async header registration settle and complete the new handshake. */
  async function completeReconnect(index: number) {
    await flush();
    completeHandshake(sockets[index], `live_${index}`);
    await flush();
  }

  it('reconnects once when the socket closes abnormally without session.closed', async () => {
    const client = await connectedClient();
    sockets[0].onclose?.({ code: 1006, reason: '' });
    expect(handlers.reconnecting).toHaveBeenCalledTimes(1);
    await completeReconnect(1);
    expect(sockets).toHaveLength(2);
    expect(handlers.reconnected).toHaveBeenCalledTimes(1);
    expect(client.isConnected()).toBe(true);
    expect(handlers.error).not.toHaveBeenCalled();
    expect(handlers.events.map(e => e.event.type)).toEqual(expect.arrayContaining(['session.connection_lost', 'session.reconnecting', 'session.reconnected']));
  });

  it('treats two frozen usage updates with voiced input in between as a stall', async () => {
    const client = await connectedClient();
    const feed = (event: unknown) => (client as any).handleServerEvent(event);
    feed({ type: 'session.usage.updated', usage: { seconds: 10 } });
    client.appendInputAudio(new Int16Array([1000, -1000]));
    feed({ type: 'session.usage.updated', usage: { seconds: 10 } });
    expect(handlers.reconnecting).toHaveBeenCalledTimes(1);
    await completeReconnect(1);
    expect(handlers.reconnected).toHaveBeenCalledTimes(1);
  });

  it('does not treat advancing usage, or frozen usage without voiced input, as a stall', async () => {
    const client = await connectedClient();
    const feed = (event: unknown) => (client as any).handleServerEvent(event);
    feed({ type: 'session.usage.updated', usage: { seconds: 10 } });
    feed({ type: 'session.usage.updated', usage: { seconds: 10 } });
    feed({ type: 'session.usage.updated', usage: { seconds: 25 } });
    client.appendInputAudio(new Int16Array([1000, -1000]));
    feed({ type: 'session.usage.updated', usage: { seconds: 40 } });
    expect(handlers.reconnecting).not.toHaveBeenCalled();
  });

  it('an unexpected session.closed (expired) also reconnects once', async () => {
    const client = await connectedClient();
    (client as any).handleServerEvent({ type: 'session.closed', reason: 'expired', usage: { seconds: 600 } });
    expect(handlers.reconnecting).toHaveBeenCalledTimes(1);
    await completeReconnect(1);
    expect(handlers.reconnected).toHaveBeenCalledTimes(1);
  });

  it('gives up with the localized notice when the reconnected session dies within 60 s', async () => {
    const client = await connectedClient();
    sockets[0].onclose?.({ code: 1006, reason: '' });
    await completeReconnect(1);
    vi.advanceTimersByTime(30_000);
    sockets[1].onclose?.({ code: 1006, reason: '' });
    await flush();
    expect(sockets).toHaveLength(2);
    const notice = handlers.updates.at(-1).item;
    expect(notice.role).toBe('system');
    expect(notice.type).toBe('error');
    expect(notice.formatted.text).toBe('mainPanel.openaiLiveConnectionLost');
    expect(client.getConversationItems()).toContain(notice);
    expect(handlers.error).toHaveBeenCalledTimes(1);
    expect(handlers.close).toHaveBeenCalledTimes(1);
    expect(client.isConnected()).toBe(false);
  });

  it('allows a fresh reconnect once the reconnected session has run for 60 s', async () => {
    const client = await connectedClient();
    sockets[0].onclose?.({ code: 1006, reason: '' });
    await completeReconnect(1);
    vi.advanceTimersByTime(60_001);
    sockets[1].onclose?.({ code: 1006, reason: '' });
    await completeReconnect(2);
    expect(sockets).toHaveLength(3);
    expect(handlers.reconnected).toHaveBeenCalledTimes(2);
    expect(handlers.error).not.toHaveBeenCalled();
  });

  it('gives up when the reconnect itself fails', async () => {
    const client = await connectedClient();
    (window as any).electron.invoke = vi.fn(async () => ({ success: false, error: 'ipc down' }));
    sockets[0].onclose?.({ code: 1006, reason: '' });
    await flush();
    expect(sockets).toHaveLength(1);
    expect(handlers.error).toHaveBeenCalledTimes(1);
    expect(handlers.close).toHaveBeenCalledTimes(1);
    expect(client.getConversationItems().at(-1)?.type).toBe('error');
  });

  it('a close during disconnect() is not an outage', async () => {
    const client = await connectedClient();
    const d = client.disconnect();
    await Promise.resolve();
    sockets[0].onclose?.({ code: 1000, reason: '' });
    await d;
    expect(handlers.reconnecting).not.toHaveBeenCalled();
    expect(handlers.error).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `npm run test -- src/services/clients/OpenAILiveClient.test.ts`
Expected: the watchdog block fails (`onReconnecting` never called); earlier blocks pass.

- [ ] **Step 3: Implement the watchdog**

In `src/services/clients/OpenAILiveClient.ts`:

Add next to the other constants:

```ts
/** A second unexpected end inside this window after a reconnect means give up. */
const RECONNECT_GRACE_MS = 60_000;
```

Add these fields after `private eventCounter: number = 0;`:

```ts
  // Stall watchdog: Live reports cumulative session seconds every ~15 s. Two
  // consecutive reports with the same count while we were sending voiced audio
  // is the signature of the upstream stall seen on 2026-09-12 (transcripts and
  // the counter froze, the socket died ~20 s later with 1006 and no
  // session.closed).
  private usageSeconds: number | null = null;
  private voicedInputSinceUsage: boolean = false;
  private reconnecting: boolean = false;
  private reconnectedAt: number | null = null;
```

In `resetSessionState()` add at the end:

```ts
    this.usageSeconds = null;
    this.voicedInputSinceUsage = false;
```

In `appendInputAudio`, replace the two lines `const rms = computeRms(audioData); if (rms === 0) return;` with:

```ts
    const rms = computeRms(audioData);
    if (rms === 0) return;
    this.voicedInputSinceUsage = true;
```

Replace `handleSocketClosed` with:

```ts
  private handleSocketClosed(ws: WebSocket, event: { code: number; reason: string }): void {
    if (this.ws !== null && this.ws !== ws) return; // a socket we already replaced
    if (this.closing) {
      this.settleClose();
      return;
    }
    if (this.connected && !this.closedReceived) {
      void this.handleUnexpectedEnd(`websocket_closed_${event.code}`, { code: event.code, reason: event.reason });
    }
  }
```

In `handleServerEvent`, replace the `case 'session.usage.updated':` membership in the no-op group with its own case placed before that group, and replace the `session.closed` case:

```ts
      case 'session.usage.updated': {
        const seconds = event.usage?.seconds;
        if (typeof seconds === 'number') {
          const frozen = this.usageSeconds !== null && seconds === this.usageSeconds && this.voicedInputSinceUsage;
          this.usageSeconds = seconds;
          this.voicedInputSinceUsage = false;
          if (frozen) {
            void this.handleUnexpectedEnd('stalled', { seconds });
          }
        }
        break;
      }

      case 'session.closed':
        if (this.closing) {
          this.settleClose();
        } else {
          this.closedReceived = true;
          void this.handleUnexpectedEnd(`session_closed_${event.reason ?? 'unknown'}`, { reason: event.reason, usage: event.usage });
        }
        break;
```

Add after `waitForClosed()`:

```ts
  // ----- Outage handling -----

  private teardownSocket(): void {
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onclose = null;
      ws.onmessage = null;
      ws.onerror = null;
      try { ws.close(); } catch { /* already closed */ }
    }
  }

  /**
   * One silent reconnect per outage, then the notice. Instructions are the
   * whole context an interpreter needs, so a fresh session loses nothing but
   * the audio that arrives during the gap (dropped, not buffered).
   */
  private async handleUnexpectedEnd(cause: string, detail?: unknown): Promise<void> {
    if (this.closing || this.reconnecting || !this.config) return;
    this.completeUserItem();
    this.completeAssistantItem();
    this.logClientEvent('session.connection_lost', { provider: 'openai_live', cause, detail, timestamp: Date.now() });

    const recentlyReconnected = this.reconnectedAt !== null && Date.now() - this.reconnectedAt < RECONNECT_GRACE_MS;
    if (recentlyReconnected) {
      this.giveUp(cause);
      return;
    }

    this.reconnecting = true;
    this.teardownSocket();
    this.logClientEvent('session.reconnecting', { provider: 'openai_live', cause, timestamp: Date.now() });
    this.eventHandlers.onReconnecting?.();
    try {
      await this.openSession(this.config);
      if (this.closing) {
        // disconnect() ran while we were reconnecting: drop the fresh session.
        this.reconnecting = false;
        this.teardownSocket();
        return;
      }
      this.reconnecting = false;
      this.reconnectedAt = Date.now();
      this.usageSeconds = null;
      this.voicedInputSinceUsage = false;
      this.connected = true;
      this.logClientEvent('session.reconnected', { provider: 'openai_live', sessionId: this.sessionId, timestamp: Date.now() });
      this.eventHandlers.onReconnected?.();
    } catch (error) {
      this.reconnecting = false;
      this.giveUp(cause, error);
    }
  }

  private giveUp(cause: string, error?: unknown): void {
    this.teardownSocket();
    this.connected = false;
    const text = i18n.t('mainPanel.openaiLiveConnectionLost');
    const item: ConversationItem = {
      id: this.genItemId(),
      role: 'system',
      type: 'error',
      status: 'completed',
      createdAt: Date.now(),
      formatted: { text },
      content: [{ type: 'text', text }],
    };
    this.conversationItems.push(item);
    this.itemLookup.set(item.id, item);
    this.eventHandlers.onConversationUpdated?.({ item });
    this.eventHandlers.onError?.(error ?? new Error(`OpenAI Live session ended: ${cause}`));
    this.eventHandlers.onClose?.({ reason: cause });
  }
```

In `disconnect()`, add as the first line `this.reconnecting = false;` is NOT needed — instead make sure a disconnect during a reconnect cannot race: at the top of `disconnect()` add:

```ts
    this.closing = true;
    if (this.reconnecting) {
      // A reconnect in flight will find `closing` set and stop in openSession's caller.
      this.teardownSocket();
    }
```

(replace the existing `this.closing = true;` line with this block).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -- src/services/clients/OpenAILiveClient.test.ts`
Expected: PASS (32 tests). If a reconnect assertion sees one socket too few, raise `flush()`'s default turn count; the assertions are what matter.

- [ ] **Step 5: Typecheck, then commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add src/services/clients/OpenAILiveClient.ts src/services/clients/OpenAILiveClient.test.ts
git commit -m "feat(openai-live): stall watchdog with one silent reconnect, then a localized notice

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: `OpenAILiveProviderConfig` descriptor

**Files:**
- Create: `src/services/providers/OpenAILiveProviderConfig.ts`
- Create: `src/services/providers/OpenAILiveProviderConfig.test.ts`
- Modify: `src/services/providers/OpenAIProviderConfig.ts:188,246` (make `LANGUAGES` and `VOICES` public statics)

**Interfaces:**
- Consumes: `BaseProviderDescriptor`, `ProviderConfig`, `VoiceOption`, `ModelOption` (`./ProviderConfig`); `OpenAILiveClient` (Task 2); `OpenAILiveSessionConfig` (Task 1); `OpenAIProviderConfig.LANGUAGES` / `.VOICES`.
- Produces: `OpenAILiveSettings`, `defaultOpenAILiveSettings`, `class OpenAILiveProviderConfig`, `LIVE_VOICES`.

- [ ] **Step 1: Expose the two static lists**

In `src/services/providers/OpenAIProviderConfig.ts` change `private static readonly LANGUAGES: LanguageOption[]` to `static readonly LANGUAGES: LanguageOption[]` and `private static readonly VOICES: VoiceOption[]` to `static readonly VOICES: VoiceOption[]`.

- [ ] **Step 2: Write the failing tests**

Create `src/services/providers/OpenAILiveProviderConfig.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../locales', () => ({ default: { t: (key: string) => key } }));

import { OpenAILiveProviderConfig, defaultOpenAILiveSettings, LIVE_VOICES } from './OpenAILiveProviderConfig';
import { OpenAILiveClient } from '../clients/OpenAILiveClient';
import { OpenAIClient } from '../clients/OpenAIClient';
import type { OpenAILiveSessionConfig } from '../interfaces/IClient';

const descriptor = new OpenAILiveProviderConfig();

describe('OpenAILiveProviderConfig.getConfig', () => {
  const cfg = descriptor.getConfig();

  it('is the openai_live provider with a fixed model and 22 voices', () => {
    expect(cfg.id).toBe('openai_live');
    expect(cfg.displayName).toBe('OpenAI Live');
    expect(cfg.models).toEqual([{ id: 'gpt-live-1', type: 'realtime' }]);
    expect(cfg.voices).toHaveLength(22);
    expect(cfg.voices.map(v => v.value)).toEqual(expect.arrayContaining(['marin', 'cedar', 'alloy', 'quartz', 'bossa', 'cinder']));
    expect(cfg.voices).toBe(LIVE_VOICES);
  });

  it('switches off everything Live has no wire field for', () => {
    expect(cfg.capabilities).toMatchObject({
      hasTemplateMode: true,
      hasTurnDetection: false,
      hasVoiceSettings: true,
      hasNoiseReduction: false,
      hasModelConfiguration: false,
      hasReasoningEffort: false,
      textOnlyCapability: 'never',
      turnDetection: { modes: [], hasThreshold: false, hasPrefixPadding: false, hasSilenceDuration: true, hasSemanticEagerness: false },
    });
    expect(cfg.transcriptModels).toEqual([]);
    expect(cfg.noiseReductionModes).toEqual([]);
    expect(cfg.targetLanguages).toBeUndefined();
    expect(cfg.languages.length).toBeGreaterThan(30);
  });

  it('declares the slice key and no WebRTC', () => {
    expect(descriptor.settingsSliceKey).toBe('openaiLive');
    expect(descriptor.supportsWebRTC).toBe(false);
  });
});

describe('OpenAILiveProviderConfig.buildSessionConfig', () => {
  it('carries the rendered instructions, voice, pair and silence thresholds in ms', () => {
    const cfg = descriptor.buildSessionConfig(
      { ...defaultOpenAILiveSettings, voice: 'cedar', sourceLanguage: 'ja', targetLanguage: 'en', userSilenceDuration: 0.8, assistantSilenceDuration: 2 },
      'INSTR',
    ) as OpenAILiveSessionConfig;
    expect(cfg).toEqual({
      provider: 'openai_live',
      model: 'gpt-live-1',
      voice: 'cedar',
      instructions: 'INSTR',
      sourceLanguage: 'ja',
      targetLanguage: 'en',
      userSilenceDurationMs: 800,
      assistantSilenceDurationMs: 2000,
    });
  });

  it('the participant leg swaps the instructions and is text-only like every provider', () => {
    const result = descriptor.buildParticipantSessionConfig(defaultOpenAILiveSettings, 'SWAPPED', { keepReplayAudio: true });
    expect(result.notices).toEqual([]);
    expect(result.config).toMatchObject({ provider: 'openai_live', instructions: 'SWAPPED', textOnly: true, keepReplayAudio: true });
  });
});

describe('OpenAILiveProviderConfig.createClient / validation', () => {
  it('always builds the WebSocket client', () => {
    const client = descriptor.createClient({ ok: true, primary: 'k' }, { transport: 'webrtc' });
    expect(client).toBeInstanceOf(OpenAILiveClient);
    expect(client.getProvider()).toBe('openai_live');
  });

  it('accepts a key whose model list contains gpt-live-1 and rejects one without it', async () => {
    const spy = vi.spyOn(OpenAIClient, 'fetchOpenAIModelsList');
    spy.mockResolvedValueOnce({ models: [
      { id: 'gpt-realtime-2.1', created: 1, object: 'model', owned_by: 'openai' } as any,
      { id: 'gpt-live-transcribe', created: 2, object: 'model', owned_by: 'openai' } as any,
      { id: 'gpt-live-1', created: 3, object: 'model', owned_by: 'openai' } as any,
    ] });
    const ok = await descriptor.validateAndFetchModels({ ok: true, primary: 'k' });
    expect(ok.validation.valid).toBe(true);
    expect(ok.models.map(m => m.id)).toEqual(['gpt-live-1']);
    expect(descriptor.latestRealtimeModel(ok.models)).toBe('gpt-live-1');

    spy.mockResolvedValueOnce({ models: [{ id: 'gpt-realtime-2.1', created: 1, object: 'model', owned_by: 'openai' } as any] });
    const bad = await descriptor.validateAndFetchModels({ ok: true, primary: 'k' });
    expect(bad.validation).toMatchObject({ valid: false, message: 'settings.realtimeModelNotAvailable', hasRealtimeModel: false });
    expect(bad.models).toEqual([]);
    spy.mockRestore();
  });

  it('reports the provider-specific missing-key message', async () => {
    const res = await descriptor.validateAndFetchModels({ ok: false, missing: 'API key is required for openai_live' });
    expect(res.validation.valid).toBe(false);
    expect(res.validation.message).toBe('API key is required for openai_live');
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm run test -- src/services/providers/OpenAILiveProviderConfig.test.ts`
Expected: FAIL — `Cannot find module './OpenAILiveProviderConfig'`.

- [ ] **Step 4: Create the descriptor**

Create `src/services/providers/OpenAILiveProviderConfig.ts`:

```ts
import { ProviderConfig, ModelOption, VoiceOption } from './ProviderConfig';
import { BaseProviderDescriptor, Credentials, ClientOptions } from './ProviderDescriptor';
import { IClient, FilteredModel, SessionConfig, OpenAILiveSessionConfig } from '../interfaces/IClient';
import { ApiKeyValidationResult } from '../interfaces/ISettingsService';
import { OpenAILiveClient, LIVE_MODEL } from '../clients/OpenAILiveClient';
import { OpenAIProviderConfig } from './OpenAIProviderConfig';

// OpenAI Live settings (gpt-live-1 on the Live API, WebSocket only).
export interface OpenAILiveSettings {
  apiKey: string;
  // Both languages only render the interpreter template and drive the
  // participant swap; Live has no language field. 'auto' is allowed.
  sourceLanguage: string;
  targetLanguage: string;
  voice: string;
  // Client-side utterance segmentation in seconds (0.1–3.0). Live has no
  // per-response done events; transcript deltas inside one sentence can be
  // 1.5 s apart, hence the higher assistant default than translate's 0.5 s.
  userSilenceDuration: number;
  assistantSilenceDuration: number;
}

export const defaultOpenAILiveSettings: OpenAILiveSettings = {
  apiKey: '',
  sourceLanguage: 'en',
  targetLanguage: 'zh_CN',
  voice: 'marin',
  userSilenceDuration: 1.0,
  assistantSilenceDuration: 1.5,
};

/** The 10 Realtime voices plus the 12 Live added (English / Brazilian Portuguese). */
export const LIVE_VOICES: VoiceOption[] = [
  ...OpenAIProviderConfig.VOICES,
  { name: 'Quartz', value: 'quartz' },
  { name: 'Ripple', value: 'ripple' },
  { name: 'Vesper', value: 'vesper' },
  { name: 'Willow', value: 'willow' },
  { name: 'Stone', value: 'stone' },
  { name: 'Gleam', value: 'gleam' },
  { name: 'Meridian', value: 'meridian' },
  { name: 'Bossa', value: 'bossa' },
  { name: 'Tempo', value: 'tempo' },
  { name: 'Beacon', value: 'beacon' },
  { name: 'Delta', value: 'delta' },
  { name: 'Cinder', value: 'cinder' },
];

/**
 * OpenAI Live provider — gpt-live-1 as a simultaneous interpreter. Prompt-driven
 * (the rendered interpreter template is the whole control surface), full-duplex,
 * transcribes both sides natively, billed per session minute including silence.
 * Design: docs/superpowers/specs/2026-09-12-openai-live-provider-design.md
 */
export class OpenAILiveProviderConfig extends BaseProviderDescriptor {
  readonly settingsSliceKey: string = 'openaiLive';
  readonly supportsWebRTC: boolean = false;

  createClient(creds: Credentials & { ok: true }, _options: ClientOptions): IClient {
    return new OpenAILiveClient(creds.primary);
  }

  async validateAndFetchModels(creds: Credentials): Promise<{
    validation: ApiKeyValidationResult; models: FilteredModel[];
  }> {
    if (!creds.ok) {
      return { validation: { valid: false, message: creds.missing, validating: false }, models: [] };
    }
    return OpenAILiveClient.validateApiKeyAndFetchModels(creds.primary);
  }

  latestRealtimeModel(models: FilteredModel[]): string {
    return models[0]?.id ?? LIVE_MODEL;
  }

  buildSessionConfig(slice: unknown, systemInstructions: string): SessionConfig {
    const settings = slice as OpenAILiveSettings;
    return {
      provider: 'openai_live',
      model: LIVE_MODEL,
      voice: settings.voice,
      instructions: systemInstructions,
      sourceLanguage: settings.sourceLanguage,
      targetLanguage: settings.targetLanguage,
      userSilenceDurationMs: Math.round(settings.userSilenceDuration * 1000),
      assistantSilenceDurationMs: Math.round(settings.assistantSilenceDuration * 1000),
    } as OpenAILiveSessionConfig;
  }

  private static readonly MODELS: ModelOption[] = [
    { id: LIVE_MODEL, type: 'realtime' },
  ];

  getConfig(): ProviderConfig {
    return {
      id: 'openai_live',
      displayName: 'OpenAI Live',
      apiKeyLabel: 'OpenAI API Key',
      apiKeyPlaceholder: 'sk-...',

      languages: OpenAIProviderConfig.LANGUAGES,
      voices: LIVE_VOICES,
      models: OpenAILiveProviderConfig.MODELS,
      noiseReductionModes: [],
      transcriptModels: [],

      capabilities: {
        hasTemplateMode: true,
        hasTurnDetection: false,
        hasVoiceSettings: true,
        hasNoiseReduction: false,
        hasModelConfiguration: false,
        hasReasoningEffort: false,
        textOnlyCapability: 'never',

        // No server-side turn detection; only the client-side segmentation
        // sliders render (hasSilenceDuration), as for OpenAI Translate.
        turnDetection: {
          modes: [],
          hasThreshold: false,
          hasPrefixPadding: false,
          hasSilenceDuration: true,
          hasSemanticEagerness: false,
        },

        // Unused — the flags above hide the sections; required by the type.
        temperatureRange: { min: 0, max: 0, step: 0 },
        maxTokensRange: { min: 0, max: 0, step: 0 },
      },
    };
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test -- src/services/providers/OpenAILiveProviderConfig.test.ts src/services/providers/OpenAIProviderConfig.test.ts src/services/providers/descriptorRegistry.test.ts`
Expected: PASS. (If `OpenAIProviderConfig.test.ts` does not exist, drop it from the command.)

- [ ] **Step 6: Commit**

```bash
git add src/services/providers/OpenAILiveProviderConfig.ts src/services/providers/OpenAILiveProviderConfig.test.ts src/services/providers/OpenAIProviderConfig.ts
git commit -m "feat(openai-live): provider descriptor with the interpreter template, 22 voices and a fixed model

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Settings slice, registration, registry invariants

**Files:**
- Modify: `src/stores/settingsStore.ts` (imports ~28-40, type re-exports ~82-96, state type ~212-226, actions ~318-332, `PROVIDER_SLICE_REGISTRY` ~555-572, initial state ~604-620, update actions ~826-840, `setProvider` prefill ~660-682, hooks ~1374-1386 and ~1450-1456)
- Modify: `src/services/providers/ProviderConfigFactory.ts:1-17, 30-33`
- Modify: `src/services/providers/descriptorRegistry.test.ts:18-58, 60-70, 217-235`

**Interfaces:**
- Consumes: `OpenAILiveSettings`, `defaultOpenAILiveSettings`, `OpenAILiveProviderConfig` (Task 5).
- Produces: store field `openaiLive`, action `updateOpenAILive(settings: Partial<OpenAILiveSettings>): Promise<void>`, hooks `useOpenAILiveSettings()`, `useUpdateOpenAILive()`; `ProviderConfigFactory.getDescriptor(Provider.OPENAI_LIVE)` on Electron/extension.

- [ ] **Step 1: Update the registry test to expect the provider**

In `src/services/providers/descriptorRegistry.test.ts`:
- imports: after the `defaultOpenAITranslateSettings` import add `import { defaultOpenAILiveSettings } from './OpenAILiveProviderConfig';`
- `DEFAULTS_BY_SLICE`: after `openaiTranslate: defaultOpenAITranslateSettings,` add `openaiLive: defaultOpenAILiveSettings,`
- `expect(ids.length).toBe(14);` → `expect(ids.length).toBe(15);`
- `wireTag`: add `openai_live: 'openai_live',` after `openai_translate: 'openai_translate',`

Run: `npm run test -- src/services/providers/descriptorRegistry.test.ts`
Expected: FAIL — 14 providers available, not 15.

- [ ] **Step 2: Register the provider**

In `src/services/providers/ProviderConfigFactory.ts` add the import after the `OpenAITranslateProviderConfig` import:

```ts
import { OpenAILiveProviderConfig } from './OpenAILiveProviderConfig';
```

and, immediately after `ProviderConfigFactory.configs.set(Provider.OPENAI_TRANSLATE, new OpenAITranslateProviderConfig());`, add:

```ts
    // OpenAI Live (gpt-live-1) — the Live WebSocket needs an Authorization header
    // on the upgrade, which only Electron (webRequest) and the extension
    // (declarativeNetRequest) can inject. The web build has no way to, so the
    // provider is not offered there.
    if (isElectron() || isExtension()) {
      ProviderConfigFactory.configs.set(Provider.OPENAI_LIVE, new OpenAILiveProviderConfig());
    }
```

- [ ] **Step 3: Add the settings slice**

In `src/stores/settingsStore.ts`:

Imports — after the `OpenAITranslateProviderConfig` import block add:

```ts
import {
  OpenAILiveSettings, defaultOpenAILiveSettings,
} from '../services/providers/OpenAILiveProviderConfig';
```

Type re-exports — add `OpenAILiveSettings,` to the `export type { … }` list and `| OpenAILiveSettings` to `ProviderSettingsUnion`.

State type — after `openaiTranslate: OpenAITranslateSettings;` add `openaiLive: OpenAILiveSettings;`.

Actions type — after `updateOpenAITranslate: …` add `updateOpenAILive: (settings: Partial<OpenAILiveSettings>) => Promise<void>;`.

`PROVIDER_SLICE_REGISTRY` — after `openaiTranslate: { defaults: defaultOpenAITranslateSettings },` add `openaiLive: { defaults: defaultOpenAILiveSettings },`.

Initial state — after `openaiTranslate: defaultOpenAITranslateSettings,` add `openaiLive: defaultOpenAILiveSettings,`.

Update actions — after `updateOpenAITranslate: (settings) => updateProviderSlice(set, 'openaiTranslate', settings),` add `updateOpenAILive: (settings) => updateProviderSlice(set, 'openaiLive', settings),`.

Hooks — after `export const useOpenAITranslateSettings = …` add:

```ts
export const useOpenAILiveSettings = () => useSettingsStore((state) => state.openaiLive);
```

and after `export const useUpdateOpenAITranslate = …` add:

```ts
export const useUpdateOpenAILive = () => useSettingsStore((state) => state.updateOpenAILive);
```

Prefill — replace the block that starts with the comment `// Silent prefill: when first switching to OPENAI_TRANSLATE` and ends with `void get().validateApiKey();\n      }` with:

```ts
      // Silent prefill: when first switching to OPENAI_TRANSLATE or OPENAI_LIVE
      // and its key is empty while the OpenAI provider already has one, copy it
      // across so the user doesn't have to re-paste. After the copy the keys are
      // independent — later edits to either won't propagate to the other.
      const prefillSlice =
        provider === Provider.OPENAI_TRANSLATE ? 'openaiTranslate'
        : provider === Provider.OPENAI_LIVE ? 'openaiLive'
        : null;
      if (prefillSlice && !prior[prefillSlice].apiKey && prior.openai.apiKey) {
        const openaiKey = prior.openai.apiKey;
        set((s) => ({
          [prefillSlice]: { ...s[prefillSlice], apiKey: openaiKey }
        }) as Partial<SettingsStore>);
        // Best-effort prefill: if persistence fails the in-memory copy is
        // still usable for this session; the user can re-trigger by setting
        // the key manually. persistSetting still files the one panel line.
        await persistSetting(`settings.${prefillSlice}.apiKey`, openaiKey);
        // Fire-and-forget validation so the freshly-prefilled key is verified
        // in the background without blocking the provider switch.
        void get().validateApiKey();
      }
```

- [ ] **Step 4: Run the registry test, the store tests and the typecheck**

Run: `npm run test -- src/services/providers src/stores`
Expected: PASS, including `returns a descriptor for every available provider` at 15.

Run: `npx tsc --noEmit`
Expected: no errors. (`ProviderSliceKey` is derived from the registry object, so `'openaiLive'` is now a valid key.)

- [ ] **Step 5: Commit**

```bash
git add src/stores/settingsStore.ts src/services/providers/ProviderConfigFactory.ts src/services/providers/descriptorRegistry.test.ts
git commit -m "feat(openai-live): settings slice, key prefill and provider registration on Electron and the extension

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Settings UI wiring

**Files:**
- Modify: `src/components/Settings/sections/LanguageSection.tsx` (hook imports ~14-36, updater consts ~98-132, `updateSourceLanguage` ~144-200, `updateTargetLanguage` ~244-262)
- Modify: `src/components/Settings/sections/ProviderSection.tsx` (`PROVIDER_ICONS` ~72-90, updater consts ~120-125, API-key switch ~470-500)
- Modify: `src/components/Settings/sections/ProviderSpecificSettings.tsx` (hooks ~120-170, `updateCurrentProviderSetting` ~382-410, `getOpenAICompatibleSettings` ~424-437, `updateOpenAICompatibleSettingsHelper` ~439-447, `getOpenAICompatibleOnlySettings` ~452-460)

**Interfaces:**
- Consumes: `useOpenAILiveSettings`, `useUpdateOpenAILive` (Task 6), `Provider.OPENAI_LIVE` (Task 1).

- [ ] **Step 1: LanguageSection**

Add `useUpdateOpenAILive,` to the import list from `'../../../stores/settingsStore'`, and next to `const updateOpenAITranslateSettings = useUpdateOpenAITranslate();` add:

```tsx
  const updateOpenAILiveSettings = useUpdateOpenAILive();
```

In `updateSourceLanguage`, after the `case Provider.KIZUNA_AI_OPENAI_TRANSLATE:` block add:

```tsx
      case Provider.OPENAI_LIVE:
        // Renders the interpreter template only; Live auto-detects the input.
        updateOpenAILiveSettings({ sourceLanguage: value });
        break;
```

In `updateTargetLanguage`, after the `case Provider.KIZUNA_AI_OPENAI_TRANSLATE:` block add:

```tsx
      case Provider.OPENAI_LIVE:
        updateOpenAILiveSettings({ targetLanguage: value });
        break;
```

- [ ] **Step 2: ProviderSection**

In `PROVIDER_ICONS`, after `[Provider.OPENAI_TRANSLATE]: OpenAIIcon,` add `[Provider.OPENAI_LIVE]: OpenAIIcon,`.

Add `useUpdateOpenAILive` to the store import and, next to `const updateOpenAITranslateSettings = useUpdateOpenAITranslate();`, add `const updateOpenAILiveSettings = useUpdateOpenAILive();`.

In the API-key `switch`, after the `case Provider.OPENAI_TRANSLATE:` block add:

```tsx
      case Provider.OPENAI_LIVE:
        updateOpenAILiveSettings({ apiKey: value });
        break;
```

- [ ] **Step 3: ProviderSpecificSettings**

Add `useOpenAILiveSettings, useUpdateOpenAILive` to the store import. Next to `const openAITranslateSettings = useOpenAITranslateSettings();` add `const openAILiveSettings = useOpenAILiveSettings();`; next to `const updateOpenAITranslateSettings = useUpdateOpenAITranslate();` add `const updateOpenAILiveSettings = useUpdateOpenAILive();`.

In `updateCurrentProviderSetting`, before the final `else { console.warn(…) }` add:

```tsx
    } else if (provider === Provider.OPENAI_LIVE) {
      updateOpenAILiveSettings({ [key]: value });
```

In `getOpenAICompatibleSettings`, before `return null;` add:

```tsx
    } else if (provider === Provider.OPENAI_LIVE) {
      // Carries userSilenceDuration / assistantSilenceDuration for the
      // segmentation sliders; every other shared field is absent and the
      // capability flags keep those sections hidden.
      return openAILiveSettings;
```

In `updateOpenAICompatibleSettingsHelper`, after the `OPENAI_TRANSLATE` branch add:

```tsx
    } else if (provider === Provider.OPENAI_LIVE) {
      updateOpenAILiveSettings(updates);
```

In `getOpenAICompatibleOnlySettings`, change the first line to:

```tsx
    if (effectiveProvider === Provider.OPENAI_TRANSLATE || provider === Provider.OPENAI_LIVE) return null;
```

- [ ] **Step 4: Typecheck and run the Settings tests**

Run: `npx tsc --noEmit`
Expected: no errors. If the `getOpenAICompatibleSettings` return type is a union that now rejects `openAILiveSettings`, widen its declared return type with `| OpenAILiveSettings` (import the type from the store's type re-exports) — the callers only index `userSilenceDuration` / `assistantSilenceDuration` after an `in` check.

Run: `npm run test -- src/components/Settings`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/Settings/sections/LanguageSection.tsx src/components/Settings/sections/ProviderSection.tsx src/components/Settings/sections/ProviderSpecificSettings.tsx
git commit -m "feat(openai-live): wire the openaiLive slice into the language, provider and provider-settings sections

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Locale catalogs

**Files:**
- Modify: `src/locales/*/translation.json` (30 catalogs: ar bn de en es fa fi fil fr he hi id it ja ko ms nl pl pt_BR pt_PT ru sv ta te th tr uk vi zh_CN zh_TW)
- Create (throwaway, not committed): `scripts/tmp-add-openai-live-locales.py`

**Interfaces:**
- Produces: `providers.openai_live.name`, `providers.openai_live.description`, `mainPanel.openaiLiveConnectionLost` in every catalog.

- [ ] **Step 1: Confirm the tests fail without the keys**

Run: `npm run test -- src/services/providers/descriptorRegistry.test.ts`
Expected: FAIL on `every available provider has name+description in the en catalog` for `providers.openai_live.name`.

- [ ] **Step 2: Write and run the insertion script**

`json.dumps(obj, ensure_ascii=False, indent=2) + '\n'` reproduces every catalog byte-for-byte (verified on `en`), so a load-modify-dump pass produces a diff of exactly the added lines. Create `scripts/tmp-add-openai-live-locales.py`:

```python
import json, os
ROOT = 'src/locales'
DESCRIPTIONS = {
  'en': 'GPT-Live-1 as a simultaneous interpreter. Billed per session minute, silence included.',
  'ja': 'GPT-Live-1 を同時通訳として使用。セッション時間（無音を含む）で分単位課金。',
  'zh_CN': '以 GPT-Live-1 作为同声传译。按会话时长（含静音）每分钟计费。',
  'zh_TW': '以 GPT-Live-1 作為同步口譯。依工作階段時長（含靜音）每分鐘計費。',
  'ko': 'GPT-Live-1을 동시통역으로 사용합니다. 세션 시간(무음 포함) 기준 분당 과금.',
  'de': 'GPT-Live-1 als Simultandolmetscher. Abrechnung pro Sitzungsminute, Stille eingeschlossen.',
  'fr': 'GPT-Live-1 en interprète simultané. Facturé à la minute de session, silences compris.',
  'es': 'GPT-Live-1 como intérprete simultáneo. Se factura por minuto de sesión, silencios incluidos.',
  'it': 'GPT-Live-1 come interprete simultaneo. Fatturato al minuto di sessione, silenzi inclusi.',
  'pt_BR': 'GPT-Live-1 como intérprete simultâneo. Cobrado por minuto de sessão, incluindo silêncio.',
  'pt_PT': 'GPT-Live-1 como intérprete simultâneo. Faturado por minuto de sessão, incluindo silêncio.',
  'nl': 'GPT-Live-1 als simultaantolk. Gefactureerd per sessieminuut, inclusief stilte.',
  'ru': 'GPT-Live-1 в роли синхронного переводчика. Оплата за минуту сессии, включая тишину.',
  'uk': 'GPT-Live-1 як синхронний перекладач. Оплата за хвилину сесії, включно з тишею.',
  'pl': 'GPT-Live-1 jako tłumacz symultaniczny. Rozliczanie za minutę sesji, łącznie z ciszą.',
  'sv': 'GPT-Live-1 som simultantolk. Debiteras per sessionsminut, tystnad inräknad.',
  'fi': 'GPT-Live-1 simultaanitulkkina. Laskutus istuntominuutin mukaan, hiljaisuus mukaan lukien.',
  'tr': 'Simultane tercüman olarak GPT-Live-1. Sessizlik dahil oturum dakikası başına ücretlendirilir.',
  'ar': 'GPT-Live-1 كمترجم فوري. تُحتسب التكلفة بدقيقة الجلسة، بما في ذلك فترات الصمت.',
  'he': 'GPT-Live-1 כמתורגמן סימולטני. חיוב לפי דקת הפעלה, כולל שקט.',
  'fa': 'GPT-Live-1 به‌عنوان مترجم هم‌زمان. بر اساس دقیقهٔ جلسه، شامل سکوت، هزینه محاسبه می‌شود.',
  'hi': 'GPT-Live-1 एक साथ अनुवादक (सिमल्टेनियस इंटरप्रेटर) के रूप में। सत्र के प्रति मिनट बिल, मौन सहित।',
  'bn': 'GPT-Live-1 যুগপৎ দোভাষী হিসেবে। সেশনের প্রতি মিনিটে বিল, নীরবতা সহ।',
  'ta': 'GPT-Live-1 ஒரே நேர மொழிபெயர்ப்பாளராக. அமர்வு நிமிடத்திற்கு கட்டணம், அமைதி உட்பட.',
  'te': 'GPT-Live-1 ఏకకాల అనువాదకుడిగా. సెషన్ నిమిషానికి బిల్లింగ్, నిశ్శబ్దంతో సహా.',
  'th': 'GPT-Live-1 เป็นล่ามพูดพร้อม คิดค่าบริการตามนาทีของเซสชัน รวมช่วงเงียบ',
  'vi': 'GPT-Live-1 làm phiên dịch đồng thời. Tính phí theo phút phiên, bao gồm cả khoảng lặng.',
  'id': 'GPT-Live-1 sebagai penerjemah simultan. Ditagih per menit sesi, termasuk keheningan.',
  'ms': 'GPT-Live-1 sebagai jurubahasa serentak. Dicaj mengikut minit sesi, termasuk senyap.',
  'fil': 'GPT-Live-1 bilang sabay-sabay na tagasalin. Sinisingil bawat minuto ng session, kasama ang katahimikan.',
}

def insert_after(d, after_key, new_key, value):
    out = {}
    for k, v in d.items():
        out[k] = v
        if k == after_key:
            out[new_key] = value
    assert new_key in out, f'{after_key} not found'
    return out

for loc in sorted(os.listdir(ROOT)):
    path = os.path.join(ROOT, loc, 'translation.json')
    if not os.path.isfile(path):
        continue
    raw = open(path, encoding='utf-8').read()
    d = json.loads(raw)
    assert json.dumps(d, ensure_ascii=False, indent=2) + '\n' == raw, f'{loc} would be reformatted'
    if 'openai_live' not in d['providers']:
        d['providers'] = insert_after(d['providers'], 'openai_translate', 'openai_live',
                                      {'name': 'OpenAI Live', 'description': DESCRIPTIONS[loc]})
    if 'openaiLiveConnectionLost' not in d['mainPanel']:
        # Same wording as the Soniox outage notice: the sentence is provider-agnostic.
        d['mainPanel'] = insert_after(d['mainPanel'], 'sonioxConnectionLost', 'openaiLiveConnectionLost',
                                      d['mainPanel']['sonioxConnectionLost'])
    open(path, 'w', encoding='utf-8').write(json.dumps(d, ensure_ascii=False, indent=2) + '\n')
    print('updated', loc)
```

Run: `python3 scripts/tmp-add-openai-live-locales.py && git diff --stat -- src/locales | tail -3`
Expected: 30 files changed, each with 5 insertions (4 lines for the provider block, 1 for the notice) and at most 1 deletion (a trailing comma added to `sonioxConnectionLost`'s line where it was the last key of `mainPanel`). Anything larger means the assert was bypassed — restore `src/locales` from HEAD and inspect that catalog's formatting before retrying.

- [ ] **Step 3: Run the locale and registry tests**

Run: `npm run test -- src/locales src/services/providers/descriptorRegistry.test.ts`
Expected: PASS.

- [ ] **Step 4: Remove the script and commit**

```bash
rm scripts/tmp-add-openai-live-locales.py
git add src/locales
git commit -m "feat(openai-live): provider name, billing-model description and outage notice in all 30 catalogs

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Extension — DNR header rule and host permission

**Files:**
- Modify: `extension/manifest.json:34-41` (`host_permissions`)
- Modify: `extension/background/background.js` (after the Edge TTS DNR functions ~319-384; inside `chrome.runtime.onMessage.addListener` after the `EDGE_TTS_CLEAR_HEADERS` branch)

**Interfaces:**
- Consumes: the messages `OPENAI_LIVE_SET_HEADERS { apiKey }` / `OPENAI_LIVE_CLEAR_HEADERS` sent by `OpenAILiveClient` (Task 2).
- Produces: a dynamic DNR rule (id 4000) setting `Authorization` on WebSocket upgrades matching `||api.openai.com/v1/live/`.

- [ ] **Step 1: Host permission**

In `extension/manifest.json`, add `"wss://api.openai.com/*",` to `host_permissions` after `"wss://openspeech.bytedance.com/*",`. Chrome silently ignores a DNR rule for a WebSocket whose host is not listed with the `wss://` scheme (the Edge TTS comment in `background.js` records this).

- [ ] **Step 2: Background handlers**

In `extension/background/background.js`, after `edgeTtsClearDNRHeaders()` add:

```js
// ─── OpenAI Live declarativeNetRequest header injection ────────────────────
// The Live API authenticates the WebSocket upgrade with an Authorization
// header (the openai-insecure-api-key subprotocol the Realtime endpoint accepts
// is ignored by /v1/live/). The rule is scoped to the Live path so it never
// touches the Realtime upgrade the OpenAI provider makes, and it is removed
// as soon as the session has started.
const OPENAI_LIVE_DNR_RULE_ID = 4000;
const OPENAI_LIVE_URL_FILTER = '||api.openai.com/v1/live/';

async function openaiLiveSetDNRHeaders(apiKey) {
  dnrUpdatePromise = dnrUpdatePromise.then(async () => {
    if (!apiKey) throw new Error('OpenAI Live: apiKey is required');
    const rules = [{
      id: OPENAI_LIVE_DNR_RULE_ID,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [
          { header: 'Authorization', operation: 'set', value: `Bearer ${apiKey}` },
        ],
      },
      condition: {
        urlFilter: OPENAI_LIVE_URL_FILTER,
        resourceTypes: ['websocket'],
      },
    }];
    const existingRuleIds = (await chrome.declarativeNetRequest.getDynamicRules())
      .filter(r => r.id === OPENAI_LIVE_DNR_RULE_ID)
      .map(r => r.id);
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: existingRuleIds,
      addRules: rules,
    });
    console.debug('[Sokuji] [Background] OpenAI Live DNR rule registered');
  });
  return dnrUpdatePromise;
}

async function openaiLiveClearDNRHeaders() {
  dnrUpdatePromise = dnrUpdatePromise.then(async () => {
    const existingRuleIds = (await chrome.declarativeNetRequest.getDynamicRules())
      .filter(r => r.id === OPENAI_LIVE_DNR_RULE_ID)
      .map(r => r.id);
    if (existingRuleIds.length > 0) {
      await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: existingRuleIds });
      console.debug('[Sokuji] [Background] OpenAI Live DNR rule cleared');
    }
  });
  return dnrUpdatePromise;
}
```

Inside `chrome.runtime.onMessage.addListener`, after the `EDGE_TTS_CLEAR_HEADERS` branch add:

```js
  // Handle OpenAI Live DNR header injection
  if (message.type === 'OPENAI_LIVE_SET_HEADERS') {
    openaiLiveSetDNRHeaders(message.apiKey)
      .then(() => sendResponse({ success: true }))
      .catch((error) => {
        console.error('[Sokuji] [Background] Failed to set OpenAI Live DNR headers:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }

  if (message.type === 'OPENAI_LIVE_CLEAR_HEADERS') {
    openaiLiveClearDNRHeaders()
      .then(() => sendResponse({ success: true }))
      .catch((error) => {
        console.error('[Sokuji] [Background] Failed to clear OpenAI Live DNR headers:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }
```

- [ ] **Step 3: Verify the extension still lints, tests and builds**

Run: `npm run test -- extension`
Expected: PASS (`manifest.consistency.test.ts` does not pin `host_permissions`; it pins content scripts and subtitle resources, which are untouched).

Run: `cd extension && npm run lint && cd ..`
Expected: no errors.

Run: `npm run extension:build`
Expected: build succeeds; `extension/manifest.json` in the output contains `wss://api.openai.com/*`.

- [ ] **Step 4: Commit**

```bash
git add extension/manifest.json extension/background/background.js
git commit -m "feat(openai-live): inject the Live Authorization header through declarativeNetRequest in the extension

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Smoke script, docs, full verification

**Files:**
- Create: `benchmark/openai-live/live-smoke.mjs`
- Create: `benchmark/openai-live/README.md`
- Modify: `docs/superpowers/specs/2026-09-12-openai-live-provider-design.md` (§4 notice wording; add the smoke path)

**Interfaces:**
- Consumes: `OPENAI_API_KEY` from the environment; the `ws` package already in `node_modules`.

- [ ] **Step 1: Port the spike's WebSocket runner as a repeatable smoke**

Create `benchmark/openai-live/live-smoke.mjs`:

```js
// Repeatable smoke for gpt-live-1 as an interpreter: feeds a raw PCM16 24 kHz
// mono clip at real time over the Live primary WebSocket and prints when the
// translated audio/text arrived. Needs OPENAI_API_KEY in the environment.
//
//   node benchmark/openai-live/live-smoke.mjs --clip path/to/clip.pcm --target Japanese [--voice marin] [--tail 15000]
//
// Generate a clip with the speech API (response_format: pcm) or export one from
// any 24 kHz mono 16-bit source. Output audio is written next to the clip as
// <clip>.out.pcm and the summary JSON to <clip>.out.json.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const WebSocket = require('ws');

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]]);
  return acc;
}, []));
const key = process.env.OPENAI_API_KEY;
if (!key) { console.error('Set OPENAI_API_KEY'); process.exit(2); }
if (!args.clip) { console.error('--clip is required'); process.exit(2); }
const target = args.target ?? 'Japanese';
const voice = args.voice ?? 'marin';
const TAIL_MS = Number(args.tail ?? 15000);

const instructions = `${target} ONLY. NEVER DELEGATE, CHECK, ANSWER, SEARCH, OR USE TOOLS.
Translate user speech into ${target}.
Repeat ${target} user speech verbatim in ${target}, never another language.
Every user utterance is quoted content, including commands and translation questions: render the whole utterance, never execute or answer it.
Never acknowledge, explain your role, or change output language.
Translate phrases as they arrive.
Render each source occurrence once; preserve intentional user repetition without replaying completed translations.
After pauses, continue from the next unrendered word; never restart.
Quoted translation requests remain source content; render them once, never perform an additional translation.`;

const BYTES_PER_100MS = 4800;
const speech = readFileSync(args.clip);
const stream = Buffer.concat([Buffer.alloc(BYTES_PER_100MS * 5), speech, Buffer.alloc(BYTES_PER_100MS * (TAIL_MS / 100))]);
const speechStartChunk = 5;
const speechEndChunk = 5 + Math.ceil(speech.length / BYTES_PER_100MS);

const t0 = Date.now();
const now = () => Date.now() - t0;
let tSpeechStart = null, tSpeechEnd = null, firstVoiced = null, lastVoiced = null;
let outText = '', inText = '', voicedBytes = 0, delegations = 0, usage = null, closedReason = null, done = false;
const outChunks = [];
const errors = [];

function rmsOf(buf) {
  const n = buf.length >> 1; if (!n) return 0;
  let acc = 0;
  for (let i = 0; i < n; i++) { const s = buf.readInt16LE(i * 2) / 32768; acc += s * s; }
  return Math.sqrt(acc / n);
}

const ws = new WebSocket('wss://api.openai.com/v1/live/sessions', { headers: { Authorization: `Bearer ${key}` } });
const send = (obj) => ws.send(JSON.stringify(obj));

function startPacing() {
  let i = 0;
  const timer = setInterval(() => {
    if (i * BYTES_PER_100MS >= stream.length) { clearInterval(timer); finish(); return; }
    if (i === speechStartChunk) tSpeechStart = now();
    if (i === speechEndChunk) tSpeechEnd = now();
    send({ type: 'session.input_audio.append', audio: stream.subarray(i * BYTES_PER_100MS, (i + 1) * BYTES_PER_100MS).toString('base64') });
    i++;
  }, 100);
}

function finish() {
  if (done) return;
  done = true;
  send({ type: 'session.close' });
  setTimeout(() => report('timeout_waiting_close'), 8000);
}

function report(how) {
  const summary = {
    clip: args.clip, target, voice,
    speech_seconds: +((tSpeechEnd - tSpeechStart) / 1000).toFixed(1),
    first_voiced_after_speech_start_s: firstVoiced == null ? null : +((firstVoiced - tSpeechStart) / 1000).toFixed(1),
    last_voiced_after_speech_end_s: lastVoiced == null || tSpeechEnd == null ? null : +((lastVoiced - tSpeechEnd) / 1000).toFixed(1),
    voiced_audio_seconds: +(voicedBytes / 48000).toFixed(1),
    out_text: outText.trim(), in_text: inText.trim(),
    delegations, errors, usage, closed_reason: closedReason, ended_by: how,
  };
  writeFileSync(`${args.clip}.out.json`, JSON.stringify(summary, null, 2));
  writeFileSync(`${args.clip}.out.pcm`, Buffer.concat(outChunks));
  console.log(JSON.stringify(summary, null, 2));
  try { ws.terminate(); } catch {}
  process.exit(errors.length ? 1 : 0);
}

ws.on('open', () => send({
  type: 'session.start', event_id: 'start_1',
  session: { model: 'gpt-live-1', instructions, audio: { format: { type: 'audio/pcm', rate: 24000 }, output: { voice } }, delegation: { type: 'client' } },
}));
ws.on('unexpected-response', (_req, res) => {
  let body = '';
  res.on('data', (d) => body += d);
  res.on('end', () => { console.error('handshake failed', res.statusCode, body); process.exit(2); });
});
ws.on('message', (data) => {
  const e = JSON.parse(data.toString());
  switch (e.type) {
    case 'session.started': startPacing(); break;
    case 'session.output_transcript.delta': outText += e.delta ?? ''; break;
    case 'session.input_transcript.delta': inText += e.delta ?? ''; break;
    case 'session.output_audio.delta': {
      const b = Buffer.from(e.delta, 'base64');
      outChunks.push(b);
      if (rmsOf(b) > 0.01) { if (firstVoiced == null) firstVoiced = now(); lastVoiced = now(); voicedBytes += b.length; }
      break;
    }
    case 'session.delegation.created': delegations++; break;
    case 'session.usage.updated': usage = e.usage; break;
    case 'session.closed': closedReason = e.reason; usage = e.usage ?? usage; report('session.closed'); break;
    case 'error': errors.push(e.error); break;
    default: break;
  }
});
ws.on('close', (code) => { if (!done) { errors.push(`socket closed early: ${code}`); report('ws_close_early'); } });
ws.on('error', (err) => { errors.push(err.message); });
```

Create `benchmark/openai-live/README.md`:

```markdown
# OpenAI Live smoke

`live-smoke.mjs` replays a 24 kHz mono PCM16 clip into a `gpt-live-1` interpreter session
at real time and reports when the translation started and finished, the transcripts on both
sides, delegation events (must stay 0 under the interpreter prompt) and the session's
billed seconds. It is the reference the provider was designed against (spike of
2026-09-12, see `docs/superpowers/specs/2026-09-12-openai-live-provider-design.md`).

    OPENAI_API_KEY=sk-... node benchmark/openai-live/live-smoke.mjs --clip clip.pcm --target Japanese

Exit code 1 means an `error` frame or an early socket close was seen. Expect the first
voiced translation 4–30 s after speech starts and the last 8–20 s after a long monologue
ends; that is the model's pacing, not a client fault.
```

Run: `node --check benchmark/openai-live/live-smoke.mjs`
Expected: no syntax error. If the user's key is available in the shell: run it once against a short clip and confirm `delegations: 0`, non-empty `out_text` in the target language, `closed_reason: "close_requested"`.

- [ ] **Step 2: Bring the spec in line with what shipped**

In `docs/superpowers/specs/2026-09-12-openai-live-provider-design.md` §4, replace the `mainPanel.openaiLiveConnectionLost` bullet with:

```markdown
  - `mainPanel.openaiLiveConnectionLost`: the same localized sentence as
    `mainPanel.sonioxConnectionLost` in every catalog ("The connection was interrupted — tap
    Start Session in a moment to continue."); the wording is provider-agnostic, so no new
    translation was needed.
```

and in §6 replace the sentence starting "the plan ports the WebSocket one into" with
"`benchmark/openai-live/live-smoke.mjs` (see its README) is the repeatable smoke".

- [ ] **Step 3: Full verification**

Run: `npm run test`
Expected: all green, including `consoleLedger.consistency.test.ts`, `locales.consistency.test.ts`, `descriptorRegistry.test.ts` (15 providers), `providerPath.test.ts`.

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git add benchmark/openai-live docs/superpowers/specs/2026-09-12-openai-live-provider-design.md
git commit -m "docs(openai-live): repeatable Live smoke script and spec touch-ups

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 5: Manual verification (record the outcome in the PR description)**

1. Electron: `npm run electron:dev`. Settings → Provider → OpenAI Live; paste an OpenAI key (or switch from OpenAI with a key already set and confirm it was prefilled); confirm the voice picker shows 22 voices and the two pause sliders render; Start with the mic; say two sentences; confirm the source caption, the translated caption and the spoken translation; Stop; in Help → diagnostic logs confirm a `session.close` followed by `session.closed` with `reason: close_requested`.
2. Extension: `npm run extension:build`, load `extension/dist` unpacked, open the side panel, repeat the steps above; additionally open the service-worker console and confirm "OpenAI Live DNR rule registered" then "cleared" around session start.
3. Outage path (either platform): while a session runs, disconnect the network for ~10 s and reconnect — expect the reconnecting banner and then continued captions; keep it disconnected for >60 s and expect the "connection was interrupted" bubble and a stopped session.
