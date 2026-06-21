# Native Python Sidecar — Phase 3a (LOCAL_NATIVE provider) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the native sidecar a real, selectable in-app provider — a separate `LOCAL_NATIVE` provider with its own `IClient` that orchestrates the proven native WS clients into the session's `ConversationItem` pipeline (ASR → translation, with TTS optional), registered Electron-only alongside the existing WASM `LOCAL_INFERENCE`.

**Architecture:** A new `LocalNativeClient implements IClient` drives `NativeAsrClient` → `NativeTranslateClient` → (optional) `NativeTtsClient`, emitting `onConversationUpdated` events exactly like the other clients. It does NOT touch `LocalInferenceClient` or `modelStore` (clean separation, the chosen UX). Registration mirrors the established add-a-provider pattern, gated by `isElectron()`.

**Tech Stack:** TypeScript, the existing `IClient`/`ConversationItem` contracts, `audio-conversion` utils, the Phase 1/2 native WS clients.

## Global Constraints

- **Electron-only**: register `LOCAL_NATIVE` behind `isElectron()` (mirror the `OPENAI_COMPATIBLE` gating in `ProviderConfigFactory`/`SUPPORTED_PROVIDERS`).
- **Do not modify** `LocalInferenceClient` or the WASM path — separate provider, separate client.
- **Reuse** the native clients as-is (`NativeAsrClient`/`NativeTranslateClient`/`NativeTtsClient`) and `audio-conversion` (`resampleFloat32`, `float32ToInt16`).
- **MVP scope = ASR → translation (text)**. TTS is wired but **optional**: native TTS today is Pocket (voice cloning, requires a reference clip), so without a reference the pipeline is text-only. A non-cloning native TTS or a reference-voice UX is a Phase 3 follow-up.
- **Audio contract** unchanged: mic `Int16` in via `appendInputAudio`; if TTS active, emit `Int16@24k` via `onConversationUpdated({item, delta:{audio}})`.
- **Constructor-inject** the three native clients (defaulting to real ones) so the pipeline is unit-testable with mocks (no sidecar needed).
- **tsc not clean repo-wide** — gate on vitest.

---

## File Structure

- Create: `src/services/clients/LocalNativeClient.ts` — the `IClient` orchestrator.
- Create: `src/services/clients/LocalNativeClient.test.ts` — pipeline test with mock native clients.
- Create: `src/services/providers/LocalNativeProviderConfig.ts` — provider config (mirror `LocalInferenceProviderConfig`).
- Modify: `src/types/Provider.ts` — add `LOCAL_NATIVE`, union, `SUPPORTED_PROVIDERS` (Electron-gated).
- Modify: `src/services/interfaces/IClient.ts` — add `LocalNativeSessionConfig` + union member + `isLocalNativeSessionConfig`.
- Modify: `src/services/clients/ClientFactory.ts` — `LOCAL_NATIVE → new LocalNativeClient()`.
- Modify: `src/services/providers/ProviderConfigFactory.ts` — register Electron-only.

---

## Task 1: LocalNativeClient (IClient) + pipeline

**Files:** create `LocalNativeClient.ts` + `LocalNativeClient.test.ts`; modify `IClient.ts`.

**Interfaces:**
- Add to `IClient.ts`:
  ```ts
  export interface LocalNativeSessionConfig extends BaseSessionConfig {
    provider: 'local_native';
    sourceLanguage: string;
    targetLanguage: string;
    asrModelId: string;
    translationModelId?: string;
    ttsModelId?: string;
    wrapTranscript?: boolean;
  }
  ```
  add `| LocalNativeSessionConfig` to `SessionConfig`; add `isLocalNativeSessionConfig`.
- `LocalNativeClient` implements `IClient`. Constructor `(deps?: { asr?; translate?; tts? })` defaulting to the real native clients. Key methods: `connect`, `appendInputAudio`, `appendInputText`, `createResponse`, `disconnect`, `setEventHandlers`, `getProvider`, plus the no-op/simple remainder.

- [ ] **Step 1: Add the session-config type + guard** to `IClient.ts` (above the `SessionConfig` union and next to `isLocalInferenceSessionConfig`):

```ts
export interface LocalNativeSessionConfig extends BaseSessionConfig {
  provider: 'local_native';
  sourceLanguage: string;
  targetLanguage: string;
  asrModelId: string;
  translationModelId?: string;
  ttsModelId?: string;
  wrapTranscript?: boolean;
}
```
append `| LocalNativeSessionConfig` to `export type SessionConfig = …`, and add:
```ts
export function isLocalNativeSessionConfig(config: SessionConfig): config is LocalNativeSessionConfig {
  return (config as any).provider === 'local_native';
}
```

- [ ] **Step 2: Write the failing test** `src/services/clients/LocalNativeClient.test.ts` — drive the pipeline with mock native clients:

```ts
import { describe, it, expect, vi } from 'vitest';
import { LocalNativeClient } from './LocalNativeClient';

function mocks() {
  const asr: any = { onResult: null, onSpeechStart: null, onStatus: null, onError: null,
    init: vi.fn().mockResolvedValue({ loadTimeMs: 1 }), feedAudio: vi.fn(), flush: vi.fn(), dispose: vi.fn() };
  const translate: any = { onError: null, init: vi.fn().mockResolvedValue({ loadTimeMs: 1 }),
    translate: vi.fn().mockResolvedValue({ sourceText: 'hola', translatedText: 'hello', inferenceTimeMs: 2 }),
    dispose: vi.fn() };
  const tts: any = { onError: null, init: vi.fn(), generate: vi.fn(), dispose: vi.fn() };
  return { asr, translate, tts };
}

describe('LocalNativeClient', () => {
  it('connects and runs ASR→translation, emitting user + assistant items', async () => {
    const m = mocks();
    const c = new LocalNativeClient(m);
    const items: any[] = [];
    c.setEventHandlers({ onConversationUpdated: ({ item }) => items.push({ role: item.role, status: item.status, text: item.formatted?.transcript }) });
    await c.connect({ provider: 'local_native', model: 'native', sourceLanguage: 'es', targetLanguage: 'en',
      asrModelId: 'sense-voice', translationModelId: 'opus-mt-es-en' } as any);
    expect(m.asr.init).toHaveBeenCalled();
    expect(m.translate.init).toHaveBeenCalledWith('es', 'en', 'opus-mt-es-en');

    // simulate a final ASR result
    await m.asr.onResult({ text: 'hola', durationMs: 100, recognitionTimeMs: 5 });
    await new Promise(r => setTimeout(r, 0));

    const roles = items.map(i => i.role);
    expect(roles).toContain('user');
    expect(roles).toContain('assistant');
    const assistant = items.reverse().find(i => i.role === 'assistant');
    expect(assistant.text).toBe('hello');
    expect(assistant.status).toBe('completed');
  });

  it('feedAudio forwards to the ASR client', async () => {
    const m = mocks();
    const c = new LocalNativeClient(m);
    await c.connect({ provider: 'local_native', model: 'native', sourceLanguage: 'es', targetLanguage: 'en', asrModelId: 'sense-voice' } as any);
    const buf = new Int16Array(10);
    c.appendInputAudio(buf);
    expect(m.asr.feedAudio).toHaveBeenCalledWith(buf, 24000);
  });
});
```

- [ ] **Step 3: Run it, expect failure.** Run: `npx vitest run src/services/clients/LocalNativeClient.test.ts`. Expected: FAIL (module missing).

- [ ] **Step 4: Implement `LocalNativeClient.ts`:**

```ts
import type { IClient, SessionConfig, ConversationItem, ClientEventHandlers, ResponseConfig } from '../interfaces/IClient';
import { isLocalNativeSessionConfig } from '../interfaces/IClient';
import type { ProviderType } from '../../types/Provider';
import { Provider } from '../../types/Provider';
import { NativeAsrClient } from '../../lib/local-inference/native/NativeAsrClient';
import { NativeTranslateClient } from '../../lib/local-inference/native/NativeTranslateClient';
import { NativeTtsClient } from '../../lib/local-inference/native/NativeTtsClient';
import { resampleFloat32, float32ToInt16 } from '../../utils/audio-conversion';

interface Deps {
  asr?: NativeAsrClient | any;
  translate?: NativeTranslateClient | any;
  tts?: NativeTtsClient | any;
}

export class LocalNativeClient implements IClient {
  private asr: any;
  private translate: any;
  private tts: any;
  private handlers: ClientEventHandlers = {};
  private items: ConversationItem[] = [];
  private connected = false;
  private idCounter = 0;
  private cfg: any = null;
  private ttsEnabled = false;
  private queue: Promise<void> = Promise.resolve();

  constructor(deps: Deps = {}) {
    this.asr = deps.asr ?? new NativeAsrClient();
    this.translate = deps.translate ?? new NativeTranslateClient();
    this.tts = deps.tts ?? new NativeTtsClient();
  }

  async connect(config: SessionConfig): Promise<void> {
    if (!isLocalNativeSessionConfig(config)) throw new Error('LocalNativeClient requires a local_native config');
    this.cfg = config;
    this.asr.onResult = (r: any) => this.onAsrResult(r);
    this.asr.onError = (e: string) => this.handlers.onError?.(e);
    this.translate.onError = (e: string) => this.handlers.onError?.(e);
    await this.translate.init(config.sourceLanguage, config.targetLanguage, config.translationModelId);
    await this.asr.init(config.sourceLanguage, config.asrModelId, 24000);
    // TTS only when a model is configured AND a reference voice exists (future UX) — text-only otherwise.
    this.ttsEnabled = !!config.ttsModelId && !config.textOnly && typeof this.tts.generate === 'function' && this.tts._refReady === true;
    this.connected = true;
    this.handlers.onOpen?.();
  }

  private nextId(p: string) { return `${p}_${Date.now()}_${++this.idCounter}`; }

  private emit(item: ConversationItem, delta?: any) {
    this.handlers.onConversationUpdated?.({ item, delta });
  }

  private onAsrResult(r: { text: string }) {
    if (!r.text?.trim()) return;
    const userItem: ConversationItem = {
      id: this.nextId('user'), role: 'user', type: 'message', status: 'completed',
      createdAt: Date.now(), formatted: { transcript: r.text },
    };
    this.items.push(userItem);
    this.emit(userItem);
    // serialize pipeline jobs so audio/text stay ordered
    this.queue = this.queue.then(() => this.runJob(r.text)).catch((e) => this.handlers.onError?.(String(e)));
  }

  private async runJob(text: string) {
    const tr = await this.translate.translate(text, this.cfg?.instructions ?? '', !!this.cfg?.wrapTranscript);
    const item: ConversationItem = {
      id: this.nextId('asst'), role: 'assistant', type: 'message', status: 'in_progress',
      createdAt: Date.now(), formatted: { transcript: tr.translatedText },
    };
    this.items.push(item);
    this.emit(item);
    if (this.ttsEnabled) {
      const res = await this.tts.generate(tr.translatedText);
      const int16 = float32ToInt16(resampleFloat32(res.samples, res.sampleRate, 24000));
      this.emit(item, { audio: int16 });
    }
    item.status = 'completed';
    this.emit(item);
  }

  appendInputAudio(audioData: Int16Array): void { if (this.connected) this.asr.feedAudio(audioData, 24000); }
  appendInputText(text: string): void { this.onAsrResult({ text }); }
  createResponse(_config?: ResponseConfig): void { this.asr.flush?.(); }
  cancelResponse(): void {}
  async disconnect(): Promise<void> {
    this.connected = false;
    this.asr.dispose?.(); this.translate.dispose?.(); this.tts.dispose?.();
    this.handlers.onClose?.({});
  }
  isConnected(): boolean { return this.connected; }
  updateSession(_config: Partial<SessionConfig>): void {}
  reset(): void { this.items = []; }
  getConversationItems(): ConversationItem[] { return this.items; }
  clearConversationItems(): void { this.items = []; }
  setEventHandlers(handlers: ClientEventHandlers): void { this.handlers = handlers; }
  getProvider(): ProviderType { return Provider.LOCAL_NATIVE; }
}
```

- [ ] **Step 5: Run tests, expect pass.** Run: `npx vitest run src/services/clients/LocalNativeClient.test.ts`. Expected: 2 passed.

- [ ] **Step 6: Commit.**

```bash
git add src/services/clients/LocalNativeClient.ts src/services/clients/LocalNativeClient.test.ts src/services/interfaces/IClient.ts
git commit -m "feat(provider): LocalNativeClient — ASR→translation pipeline over the native sidecar"
```

---

## Task 2: Register the LOCAL_NATIVE provider (Electron-only)

**Files:** modify `Provider.ts`, `ClientFactory.ts`, `ProviderConfigFactory.ts`; create `LocalNativeProviderConfig.ts`.

- [ ] **Step 1: `Provider.ts`** — add `LOCAL_NATIVE = 'local_native'` to the enum; add `| Provider.LOCAL_NATIVE` to `ProviderType`; in `SUPPORTED_PROVIDERS` add `...(isElectron() ? [Provider.LOCAL_NATIVE] : [])` (import `isElectron`).

- [ ] **Step 2: `LocalNativeProviderConfig.ts`** — mirror `LocalInferenceProviderConfig` with `id: 'local_native'`, `displayName: 'Local (Native, Electron)'`, `textOnlyCapability: 'optional'`, languages from `getTranslationSourceLanguages()`, defaults `sourceLanguage: 'ja'`, `targetLanguage: 'en'`, model `'native-asr-translate'`.

- [ ] **Step 3: `ClientFactory.ts`** — add near the LOCAL_INFERENCE branch:
```ts
if (provider === Provider.LOCAL_NATIVE) {
  return new LocalNativeClient();
}
```
import `LocalNativeClient`.

- [ ] **Step 4: `ProviderConfigFactory.ts`** — inside the existing `if (isElectron()) { … }` block, add:
```ts
ProviderConfigFactory.configs.set(Provider.LOCAL_NATIVE, new LocalNativeProviderConfig());
```
import `LocalNativeProviderConfig`.

- [ ] **Step 5: Test registration** `src/services/clients/ClientFactory.localnative.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
vi.mock('../../utils/environment', async (orig) => ({ ...(await orig() as any), isElectron: () => true }));
import { ClientFactory } from './ClientFactory';
import { Provider } from '../../types/Provider';
import { LocalNativeClient } from './LocalNativeClient';
describe('ClientFactory LOCAL_NATIVE', () => {
  it('creates a LocalNativeClient', () => {
    const c = ClientFactory.createClient(Provider.LOCAL_NATIVE, '');
    expect(c).toBeInstanceOf(LocalNativeClient);
    expect(c.getProvider()).toBe(Provider.LOCAL_NATIVE);
  });
});
```
Run: `npx vitest run src/services/clients/ClientFactory.localnative.test.ts`. Expected: pass. (Adjust the `createClient` arg list to match the real signature.)

- [ ] **Step 6: Commit.**

```bash
git add src/types/Provider.ts src/services/providers/LocalNativeProviderConfig.ts src/services/clients/ClientFactory.ts src/services/providers/ProviderConfigFactory.ts src/services/clients/ClientFactory.localnative.test.ts
git commit -m "feat(provider): register LOCAL_NATIVE provider (Electron-only)"
```

---

## Deferred to Phase 3b (own plan)
- **settingsStore** native-provider settings + defaults; **UI** (SimpleConfigPanel section, per-stage model dropdowns, sidecar readiness/download status).
- **Native non-cloning TTS** (sherpa-onnx piper) or **reference-voice UX** to enable native speech output (today's native TTS is Pocket/cloning only → MVP is text-only).
- **Sidecar readiness gating** (download-on-demand + health) analogous to `modelStore.isProviderReady`.

## Self-Review
LocalNativeClient implements the full `IClient` surface; the pipeline emits `onConversationUpdated` user+assistant items matching the other clients. Registration follows the add-a-provider pattern, Electron-gated like `OPENAI_COMPATIBLE`. No change to `LocalInferenceClient`/WASM. TTS is explicitly optional (text-only MVP) given native TTS = Pocket/cloning. Constructor injection keeps the pipeline unit-testable without a sidecar.
