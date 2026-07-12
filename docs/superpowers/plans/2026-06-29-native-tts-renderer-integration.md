# Native TTS Renderer Integration (Plan A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the renderer to the rewritten sidecar TTS protocol (`tts_init`/`tts_generate`/`tts_chunk`/`tts_done`/`tts_cancel`), add streaming playback, the `ttsResolved` perf badge, MOSS-Nano selectability, and full WASM-parity playback (sentence-split + karaoke + replay).

**Architecture:** Mirror the shipped native-ASR renderer pattern: `NativeTtsClient` migrates to the `tts_*` protocol and gains streaming + cancel + full `ready` fields; `nativeModelStore` gains `ttsResolved` (like `asrResolved`); `nativeCatalog` adds MOSS-Nano; `LocalNativeClient` surfaces `ttsResolved` on connect and replaces its whole-utterance one-shot with a per-sentence loop (one-shot for piper, streamed for MOSS) carrying karaoke + replay; the TTS model card renders the resolved badge.

**Tech Stack:** TypeScript, React, Zustand, Vitest. Spec: `docs/superpowers/specs/2026-06-29-native-tts-renderer-integration-design.md`.

## Global Constraints

- Audio output contract: **Int16 PCM, 24 kHz, mono**. Chunk/one-shot PCM is decoded to `Float32Array` (matching `TtsResult.samples: Float32Array`); playback converts via `float32ToInt16(resampleFloat32(samples, sampleRate, 24000))`.
- Message types exactly: `tts_init`, `set_voice`, `tts_generate`, `tts_chunk`, `tts_done`, `tts_cancel`. The `ready` reply carries `streaming`/`clones` flags; the client routes one-shot vs streaming off `ready.streaming`.
- Reuse the existing `NativeResolved`-shaped store fields + `resolvedTierState`/`actualNativeMemoryByDevice`/`formatMemMb` badge helpers — no new badge code.
- `clones` is plumbed but DORMANT in Plan A (it gates the deferred Plan B voice-clone UI). MOSS uses the sidecar's preset voice (no `set_voice`).
- Renderer tests run via: `npx vitest run <path>` (NOT `npm test`).
- Follow existing patterns: `NativeAsrClient` (resolved-fields init), `LocalInferenceClient` (TTS audio-out path), the `NativeTtsClient.test.ts` FakeWS style.

---

### Task 1: `NativeTtsClient` protocol migration + streaming + cancel

**Files:**
- Modify: `src/lib/local-inference/native/nativeProtocol.ts` (add chunk/done types + flags)
- Modify: `src/lib/local-inference/native/NativeTtsClient.ts` (rewrite init/generate, add streaming + cancel)
- Test: `src/lib/local-inference/native/NativeTtsClient.test.ts` (extend)

**Interfaces:**
- Consumes: `ServerMsg` from `nativeProtocol`; `TtsResult` from `../engine/TtsEngine`.
- Produces: `NativeTtsClient.init(model?) -> Promise<TtsReady>` where `TtsReady = { sampleRate: number; loadTimeMs: number; backend?: string; device?: string; computeType?: string; rtf?: number; streaming: boolean; clones: boolean; memoryBytes?: number; fallbackReason?: string }`; `generate(text: string, speed?: number, onChunk?: (pcm: Float32Array, seq: number) => void) -> Promise<TtsResult>` (streaming when `onChunk` given + backend streaming; one-shot otherwise); `cancel() -> void`; `setReferenceVoice(audio, sr)` unchanged; `dispose()` unchanged. Protocol: `TtsChunkMsg { type:'tts_chunk'; id:number; seq:number }`, `TtsDoneMsg { type:'tts_done'; id:number; totalSamples:number; generationTimeMs:number }`; `ReadyMsg` gains `streaming?: boolean; clones?: boolean`.

- [ ] **Step 1: Write the failing tests**

Replace the body of `describe('NativeTtsClient', ...)` in `src/lib/local-inference/native/NativeTtsClient.test.ts` and extend the FakeWS to speak the new protocol:

```typescript
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NativeTtsClient } from './NativeTtsClient';

class FakeWS {
  static last: FakeWS;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: any }) => void) | null = null;
  onerror: (() => void) | null = null;
  binaryType = 'arraybuffer';
  sent: any[] = [];
  // when true, tts_generate replies with a 3-chunk stream + tts_done; else one-shot result
  static streaming = false;
  constructor(public url: string) { FakeWS.last = this; setTimeout(() => this.onopen?.(), 0); }
  send(d: any) {
    this.sent.push(d);
    const msg = typeof d === 'string' ? JSON.parse(d) : null;
    if (msg?.type === 'tts_init') queueMicrotask(() => this.onmessage?.({ data: JSON.stringify(
      { type: 'ready', id: msg.id, sampleRate: 24000, loadTimeMs: 5,
        device: 'cpu', backend: 'moss_onnx', rtf: 0.44,
        streaming: FakeWS.streaming, clones: FakeWS.streaming }) }));
    if (msg?.type === 'tts_generate') {
      if (FakeWS.streaming) {
        for (let i = 0; i < 3; i++) {
          const pcm = new Float32Array([i / 10, i / 10, i / 10]);
          queueMicrotask(() => this.onmessage?.({ data: pcm.buffer }));
          queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ type: 'tts_chunk', id: msg.id, seq: i }) }));
        }
        queueMicrotask(() => this.onmessage?.({ data: JSON.stringify(
          { type: 'tts_done', id: msg.id, totalSamples: 9, generationTimeMs: 7 }) }));
      } else {
        const pcm = new Float32Array([0.1, 0.2, 0.3]);
        queueMicrotask(() => this.onmessage?.({ data: pcm.buffer }));
        queueMicrotask(() => this.onmessage?.({ data: JSON.stringify(
          { type: 'result', id: msg.id, sampleRate: 24000, generationTimeMs: 7, samples: 3 }) }));
      }
    }
  }
  close() {}
}

beforeEach(() => {
  FakeWS.streaming = false;
  (globalThis as any).WebSocket = FakeWS as any;
  (globalThis as any).window = { electron: { invoke: vi.fn().mockResolvedValue({ ok: true, port: 9 }) } };
});

describe('NativeTtsClient', () => {
  it('inits via tts_init and returns the full ready fields', async () => {
    const c = new NativeTtsClient();
    const r = await c.init('moss-tts-nano');
    expect(JSON.parse(FakeWS.last.sent[0]).type).toBe('tts_init');
    expect(r).toMatchObject({ sampleRate: 24000, loadTimeMs: 5, device: 'cpu', rtf: 0.44, streaming: false, clones: false });
  });

  it('one-shot generate sends tts_generate and returns binary PCM', async () => {
    const c = new NativeTtsClient();
    await c.init();
    const res = await c.generate('hi');
    expect(JSON.parse(FakeWS.last.sent.find((s) => typeof s === 'string' && JSON.parse(s).type === 'tts_generate')).type).toBe('tts_generate');
    expect(res.sampleRate).toBe(24000);
    expect(Array.from(res.samples as Float32Array).map((x) => +x.toFixed(1))).toEqual([0.1, 0.2, 0.3]);
  });

  it('streaming generate delivers chunks via onChunk and resolves on tts_done', async () => {
    FakeWS.streaming = true;
    const c = new NativeTtsClient();
    await c.init();
    const chunks: number[] = [];
    const res = await c.generate('hi', 1.0, (pcm, seq) => chunks.push(seq) && void pcm);
    expect(chunks).toEqual([0, 1, 2]);
    expect(res.generationTimeMs).toBe(7);
  });

  it('cancel sends tts_cancel for the in-flight generation', async () => {
    FakeWS.streaming = true;
    const c = new NativeTtsClient();
    await c.init();
    const p = c.generate('hi', 1.0, () => {});
    c.cancel();
    await p;
    expect(FakeWS.last.sent.some((s) => typeof s === 'string' && JSON.parse(s).type === 'tts_cancel')).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/local-inference/native/NativeTtsClient.test.ts`
Expected: FAIL (client still sends `init`/`generate`; no `onChunk`/`cancel`/streaming).

- [ ] **Step 3: Add protocol types**

In `src/lib/local-inference/native/nativeProtocol.ts`: add `streaming?: boolean; clones?: boolean;` to the `ReadyMsg` interface; add the two messages and extend the union:

```typescript
export interface TtsChunkMsg { type: 'tts_chunk'; id: number; seq: number; }
export interface TtsDoneMsg { type: 'tts_done'; id: number; totalSamples: number; generationTimeMs: number; }
```
Append `| TtsChunkMsg | TtsDoneMsg` to the `ServerMsg` union.

- [ ] **Step 4: Rewrite `NativeTtsClient`**

Replace `src/lib/local-inference/native/NativeTtsClient.ts` with:

```typescript
import type { TtsResult } from '../engine/TtsEngine';
import type { ServerMsg } from './nativeProtocol';

interface ElectronInvoke { invoke(channel: string, data?: unknown): Promise<any>; }
function electron(): ElectronInvoke {
  const e = (window as unknown as { electron?: ElectronInvoke }).electron;
  if (!e) throw new Error('window.electron is unavailable (not running in Electron)');
  return e;
}

export interface TtsReady {
  sampleRate: number; loadTimeMs: number;
  backend?: string; device?: string; computeType?: string; rtf?: number;
  streaming: boolean; clones: boolean; memoryBytes?: number; fallbackReason?: string;
}

export class NativeTtsClient {
  onStatus: ((m: string) => void) | null = null;
  onError: ((e: string) => void) | null = null;
  private ws: WebSocket | null = null;
  private nextId = 1;
  private pendingJson = new Map<number, (m: ServerMsg) => void>();
  private pendingBinary = new Map<number, (b: ArrayBuffer) => void>();
  private streamHandlers = new Map<number, (pcm: Float32Array, seq: number) => void>();
  private lastBinary: ArrayBuffer | null = null;
  private streaming = false;          // cached from the last init()
  private inFlightId = 0;             // id of the current generate (for cancel())

  private async connect(): Promise<void> {
    if (this.ws) return;
    const r = await electron().invoke('native-host:start');
    if (!r?.ok) throw new Error(r?.error || 'failed to start native host');
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${r.port}`);
      ws.binaryType = 'arraybuffer';
      ws.onopen = () => { this.ws = ws; resolve(); };
      ws.onerror = () => { this.onError?.('native host WS error'); reject(new Error('WS error')); };
      ws.onmessage = (e) => this.onMessage(e.data);
    });
  }

  private onMessage(data: any) {
    if (data instanceof ArrayBuffer) { this.lastBinary = data; return; }
    const msg = JSON.parse(data) as ServerMsg;
    if (msg.type === 'error') { this.onError?.(msg.message); if (msg.id) this.reject(msg.id); return; }
    const id = (msg as any).id as number;
    if (msg.type === 'tts_chunk') {                       // binary frame precedes this chunk meta
      const onChunk = this.streamHandlers.get(id);
      if (onChunk && this.lastBinary) { onChunk(new Float32Array(this.lastBinary), msg.seq); this.lastBinary = null; }
      return;                                             // do NOT resolve pendingJson; wait for tts_done
    }
    if (msg.type === 'tts_done') {
      this.streamHandlers.delete(id);
      this.pendingJson.get(id)?.(msg); this.pendingJson.delete(id);
      return;
    }
    if (msg.type === 'result') {                          // one-shot: pair the buffered binary
      const binResolve = this.pendingBinary.get(id);
      if (binResolve && this.lastBinary) { binResolve(this.lastBinary); this.lastBinary = null; this.pendingBinary.delete(id); }
    }
    this.pendingJson.get(id)?.(msg);
    this.pendingJson.delete(id);
  }

  private reject(id: number) {
    this.pendingJson.delete(id); this.pendingBinary.delete(id); this.streamHandlers.delete(id);
  }

  private send(payload: object, expectBinary = false): Promise<{ msg: ServerMsg; binary?: ArrayBuffer; id: number }> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      let binary: ArrayBuffer | undefined;
      if (expectBinary) this.pendingBinary.set(id, (b) => { binary = b; });
      this.pendingJson.set(id, (msg) => {
        if (msg.type === 'error') return reject(new Error(msg.message));
        resolve({ msg, binary, id });
      });
      this.ws!.send(JSON.stringify({ ...payload, id }));
    });
  }

  async init(model?: string): Promise<TtsReady> {
    await this.connect();
    this.onStatus?.('[native-tts] init…');
    const { msg } = await this.send({ type: 'tts_init', model });
    const r = msg as Extract<ServerMsg, { type: 'ready' }>;
    this.streaming = !!r.streaming;
    return {
      sampleRate: r.sampleRate ?? 24000, loadTimeMs: r.loadTimeMs,
      backend: r.backend, device: r.device, computeType: r.computeType, rtf: r.rtf,
      streaming: !!r.streaming, clones: !!r.clones, memoryBytes: r.memoryBytes, fallbackReason: r.fallbackReason,
    };
  }

  async setReferenceVoice(audio: Float32Array, sampleRate: number): Promise<void> {
    this.ws!.send(audio.buffer);                          // binary frame precedes the control message
    await this.send({ type: 'set_voice', sampleRate });
  }

  async generate(text: string, speed = 1.0, onChunk?: (pcm: Float32Array, seq: number) => void): Promise<TtsResult> {
    if (this.streaming && onChunk) {
      const id = this.nextId++;
      this.inFlightId = id;
      this.streamHandlers.set(id, onChunk);
      const done = await new Promise<ServerMsg>((resolve, reject) => {
        this.pendingJson.set(id, (m) => { if (m.type === 'error') return reject(new Error(m.message)); resolve(m); });
        this.ws!.send(JSON.stringify({ type: 'tts_generate', text, speed, id }));
      });
      const d = done as Extract<ServerMsg, { type: 'tts_done' }>;
      return { samples: new Float32Array(0), sampleRate: 24000, generationTimeMs: d.generationTimeMs };
    }
    const { msg, binary, id } = await this.send({ type: 'tts_generate', text, speed }, true);
    this.inFlightId = id;
    const r = msg as Extract<ServerMsg, { type: 'result' }>;
    return { samples: new Float32Array(binary!), sampleRate: r.sampleRate, generationTimeMs: r.generationTimeMs };
  }

  cancel(): void {
    if (this.inFlightId && this.ws) {
      try { this.ws.send(JSON.stringify({ type: 'tts_cancel', id: this.inFlightId })); } catch (_) {}
    }
  }

  dispose(): void {
    try { this.ws?.close(); } catch (_) {}
    this.ws = null; this.pendingJson.clear(); this.pendingBinary.clear(); this.streamHandlers.clear();
  }
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run src/lib/local-inference/native/NativeTtsClient.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/local-inference/native/nativeProtocol.ts src/lib/local-inference/native/NativeTtsClient.ts src/lib/local-inference/native/NativeTtsClient.test.ts
git commit -m "feat(native): migrate NativeTtsClient to tts_* protocol + streaming + cancel"
```

---

### Task 2: `nativeModelStore` — `ttsResolved` + `ttsLoading`

**Files:**
- Modify: `src/stores/nativeModelStore.ts`
- Test: `src/stores/nativeModelStore.test.ts` (create if absent, else append)

**Interfaces:**
- Produces: store fields `ttsLoading: boolean`, `ttsResolved: { model: string; device: string; rtf?: number; memoryBytes?: number; fallbackReason?: string } | null`; actions `setTtsLoading(v: boolean)`, `setTtsResolved(r)`; selectors `useNativeTtsLoading()`, `useNativeTtsResolved()`.

- [ ] **Step 1: Write the failing test**

Create/append `src/stores/nativeModelStore.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { useNativeModelStore } from './nativeModelStore';

describe('nativeModelStore TTS resolved', () => {
  beforeEach(() => { useNativeModelStore.setState({ ttsLoading: false, ttsResolved: null }); });

  it('setTtsResolved stores the resolved plan', () => {
    useNativeModelStore.getState().setTtsResolved({ model: 'moss-tts-nano', device: 'cpu', rtf: 0.44 });
    expect(useNativeModelStore.getState().ttsResolved).toEqual({ model: 'moss-tts-nano', device: 'cpu', rtf: 0.44 });
  });

  it('setTtsLoading toggles the connecting flag', () => {
    useNativeModelStore.getState().setTtsLoading(true);
    expect(useNativeModelStore.getState().ttsLoading).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/stores/nativeModelStore.test.ts`
Expected: FAIL (`setTtsResolved is not a function`).

- [ ] **Step 3: Add the fields (mirror `asrResolved`)**

In the `NativeModelStore` interface, after the `asrResolved`/`translationResolved` declarations, add:

```typescript
  /** True while a native TTS session is loading its model (init→ready). */
  ttsLoading: boolean;
  /** The resolved TTS plan from the last session `ready` (device + measured rtf + memory). */
  ttsResolved: { model: string; device: string; rtf?: number; memoryBytes?: number; fallbackReason?: string } | null;
  setTtsLoading: (v: boolean) => void;
  setTtsResolved: (r: { model: string; device: string; rtf?: number; memoryBytes?: number; fallbackReason?: string } | null) => void;
```

In the store initializer, alongside `asrLoading: false, asrResolved: null,` add `ttsLoading: false, ttsResolved: null,`. With the other setters add:

```typescript
  setTtsLoading: (v) => set({ ttsLoading: v }),
  setTtsResolved: (r) => set({ ttsResolved: r }),
```

After `useNativeTranslationResolved`, add:

```typescript
export const useNativeTtsLoading = () => useNativeModelStore((s) => s.ttsLoading);
export const useNativeTtsResolved = () => useNativeModelStore((s) => s.ttsResolved);
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/stores/nativeModelStore.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/stores/nativeModelStore.ts src/stores/nativeModelStore.test.ts
git commit -m "feat(native): add ttsResolved/ttsLoading to nativeModelStore"
```

---

### Task 3: `nativeCatalog` — MOSS-Nano option + capability flags

**Files:**
- Modify: `src/lib/local-inference/native/nativeCatalog.ts`
- Test: `src/lib/local-inference/native/nativeCatalog.test.ts` (append)

**Interfaces:**
- Consumes: `NativeModelOption`, `NATIVE_TTS_BY_LANG`, `nativeTtsVoices`, `nativeTtsCards`.
- Produces: `NativeModelOption` gains `streaming?: boolean; clones?: boolean`; `NativeModelCardSpec` gains `streaming?: boolean; clones?: boolean`; a `MOSS_NANO_TTS` option appears in `nativeTtsVoices(tgt)`/`nativeTtsCards(tgt)` for its supported languages with `streaming:true, clones:true`.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/local-inference/native/nativeCatalog.test.ts`:

```typescript
import { nativeTtsVoices, nativeTtsCards } from './nativeCatalog';

describe('MOSS-Nano native TTS', () => {
  it('appears as a voice for supported languages with capability flags', () => {
    const en = nativeTtsVoices('en');
    const moss = en.find((v) => v.id === 'moss-tts-nano');
    expect(moss).toBeTruthy();
    expect(moss!.streaming).toBe(true);
    expect(moss!.clones).toBe(true);
    expect(nativeTtsVoices('zh').some((v) => v.id === 'moss-tts-nano')).toBe(true);
    expect(nativeTtsVoices('ja').some((v) => v.id === 'moss-tts-nano')).toBe(true);
  });

  it('is exposed as a TTS card carrying the streaming/clones flags', () => {
    const card = nativeTtsCards('en').find((c) => c.selectId === 'moss-tts-nano');
    expect(card).toBeTruthy();
    expect(card!.streaming).toBe(true);
    expect(card!.clones).toBe(true);
  });

  it('does not appear for an unsupported language', () => {
    expect(nativeTtsVoices('th').some((v) => v.id === 'moss-tts-nano')).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/local-inference/native/nativeCatalog.test.ts`
Expected: FAIL (no MOSS option; `streaming` undefined).

- [ ] **Step 3: Implement**

In `nativeCatalog.ts`:

(a) Extend `NativeModelOption` (after `sortOrder?: number;`): `streaming?: boolean; clones?: boolean;`

(b) After the `NATIVE_TTS_BY_LANG` constant, add the MOSS option + its languages:

```typescript
// MOSS-TTS-Nano: one multilingual model (sidecar catalog id `moss-tts-nano`),
// streaming + voice-cloning capable. Surfaced as a TTS voice for each language
// it supports, alongside the per-language piper voices.
const MOSS_NANO_LANGS = ['zh', 'en', 'ja', 'ko', 'de', 'fr', 'es', 'pt', 'it', 'ru',
  'ar', 'pl', 'cs', 'da', 'sv', 'el', 'tr', 'hu', 'fa', 'nl'];
const MOSS_NANO_TTS: NativeModelOption = {
  id: 'moss-tts-nano', label: 'MOSS-TTS-Nano (multilingual)',
  languages: MOSS_NANO_LANGS, recommended: false, sortOrder: 50,
  streaming: true, clones: true,
};
```

(c) Change `nativeTtsVoices` to append MOSS for its supported languages:

```typescript
export function nativeTtsVoices(targetLanguage: string): NativeModelOption[] {
  const piper = NATIVE_TTS_BY_LANG[targetLanguage] || [];
  return MOSS_NANO_LANGS.includes(targetLanguage) ? [...piper, MOSS_NANO_TTS] : piper;
}
```

(d) In `NativeModelCardSpec` (interface at ~line 329) add `streaming?: boolean; clones?: boolean;`, and in `nativeTtsCards` carry the flags through:

```typescript
export function nativeTtsCards(tgt: string): NativeModelCardSpec[] {
  return nativeTtsVoices(tgt).map((v, i) => ({
    selectId: v.id, downloadId: v.id, name: v.label, languages: [tgt],
    recommended: i === 0, sortOrder: i,
    streaming: v.streaming, clones: v.clones,
  }));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/local-inference/native/nativeCatalog.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/local-inference/native/nativeCatalog.ts src/lib/local-inference/native/nativeCatalog.test.ts
git commit -m "feat(native): add MOSS-Nano multilingual TTS option to catalog"
```

---

### Task 4: `LocalNativeClient.connect` — surface `ttsResolved` + cache streaming flag

**Files:**
- Modify: `src/services/clients/LocalNativeClient.ts` (connect block ~lines 87-94; add fields)
- Test: `src/services/clients/LocalNativeClient.test.ts` (append; create if absent)

**Interfaces:**
- Consumes: `NativeTtsClient.init -> TtsReady`; `useNativeModelStore.getState().setTtsResolved/setTtsLoading`.
- Produces: instance fields `private ttsStreaming = false;` set from `init().streaming`; `connect()` calls `setTtsResolved({ model, device, rtf, memoryBytes, fallbackReason })` after a successful TTS init; `ttsEnabled` true for piper AND moss (still excludes `pocket`).

- [ ] **Step 1: Write the failing test**

Append to `src/services/clients/LocalNativeClient.test.ts` (mirror the existing fake-deps pattern used for ASR/translate in that file; if the file does not exist, model it on `NativeTtsClient.test.ts` deps style). Use a fake `tts` dep:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LocalNativeClient } from './LocalNativeClient';
import { useNativeModelStore } from '../../stores/nativeModelStore';

function fakeDeps(over: any = {}) {
  return {
    asr: { init: vi.fn().mockResolvedValue({ loadTimeMs: 1, device: 'cpu' }), feedAudio: vi.fn(), dispose: vi.fn() },
    translate: { init: vi.fn().mockResolvedValue({ device: 'cpu' }), dispose: vi.fn() },
    tts: { init: vi.fn().mockResolvedValue({ sampleRate: 24000, loadTimeMs: 2, device: 'cpu', rtf: 0.44, streaming: true, clones: true }),
           generate: vi.fn(), cancel: vi.fn(), dispose: vi.fn() },
    ...over,
  };
}

describe('LocalNativeClient TTS connect', () => {
  beforeEach(() => useNativeModelStore.setState({ ttsResolved: null, ttsLoading: false }));

  it('surfaces ttsResolved from the TTS init', async () => {
    const deps = fakeDeps();
    const c = new LocalNativeClient({ /* minimal handlers */ } as any, deps as any);
    await c.connect({ asrModelId: 'sense-voice', translationModelId: 'qwen2.5-0.5b',
      ttsModelId: 'moss-tts-nano', ttsSpeed: 1.0, textOnly: false } as any);
    expect(deps.tts.init).toHaveBeenCalledWith('moss-tts-nano');
    expect(useNativeModelStore.getState().ttsResolved).toMatchObject({ model: 'moss-tts-nano', device: 'cpu', rtf: 0.44 });
  });
});
```
(Adapt the constructor/handlers shape to the real `LocalNativeClient` signature you see in the file.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/services/clients/LocalNativeClient.test.ts`
Expected: FAIL (`ttsResolved` stays null — connect discards the TTS init result).

- [ ] **Step 3: Implement**

In `LocalNativeClient.ts`: add the instance field near the other tts fields (`private ttsStreaming = false;`). In `connect()`, replace the TTS init block (currently `if (this.ttsEnabled) { try { await this.tts.init(config.ttsModelId); } catch ... }`) with one that broadens the gate, captures the resolved fields, and surfaces them (mirror the ASR `setAsrResolved` call already in this method):

```typescript
    // Enable native TTS for piper (one-shot) and MOSS (streaming/cloning). Pocket
    // voice-cloning stays off until the Plan B reference-voice UX.
    this.ttsEnabled = !!config.ttsModelId && !config.textOnly
      && !String(config.ttsModelId).includes('pocket');
    if (this.ttsEnabled) {
      const store = useNativeModelStore.getState();
      store.setTtsLoading(true);
      try {
        const r = await this.tts.init(config.ttsModelId);
        this.ttsStreaming = !!r.streaming;
        store.setTtsResolved({ model: config.ttsModelId!, device: r.device ?? 'cpu',
          rtf: r.rtf, memoryBytes: r.memoryBytes, fallbackReason: r.fallbackReason });
      } catch (e) {
        this.ttsEnabled = false;
        this.handlers.onError?.(`native TTS init failed: ${e}`);
      } finally {
        store.setTtsLoading(false);
      }
    }
```
Ensure `useNativeModelStore` is imported in this file (it already is — `setAsrResolved`/`setTranslationResolved` are called here).

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/services/clients/LocalNativeClient.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/clients/LocalNativeClient.ts src/services/clients/LocalNativeClient.test.ts
git commit -m "feat(native): surface ttsResolved + cache streaming flag on connect"
```

---

### Task 5: `LocalNativeClient.runJob` — full-parity playback (sentence-split + streaming + karaoke + replay)

**Files:**
- Modify: `src/services/clients/LocalNativeClient.ts` (runJob TTS block ~lines 184-189; add `cancelResponse`)
- Test: `src/services/clients/LocalNativeClient.test.ts` (append)

**Interfaces:**
- Consumes: `this.ttsStreaming` (Task 4), `NativeTtsClient.generate(text, speed, onChunk?)`, `splitSentences`, `float32ToInt16`, `resampleFloat32`, `this.appendItemAudio`, `this.keepReplayAudio`, `this.emit`.
- Produces: per-sentence synthesis emitting `delta:{audio:int16}` (one delta for piper, per-chunk for MOSS) + `assistantItem.formatted.audioSegments`/`audioTextEnd` + gated replay; `cancelResponse()` calls `this.tts.cancel()`.

- [ ] **Step 1: Write the failing tests**

Append to `src/services/clients/LocalNativeClient.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';

describe('LocalNativeClient TTS playback parity', () => {
  it('one-shot piper: splits sentences and emits a delta + karaoke segment per sentence', async () => {
    const deltas: any[] = [];
    const deps = fakeDeps({
      tts: { init: vi.fn().mockResolvedValue({ sampleRate: 24000, loadTimeMs: 1, device: 'cpu', streaming: false, clones: false }),
             generate: vi.fn().mockResolvedValue({ samples: new Float32Array(2400), sampleRate: 24000, generationTimeMs: 3 }),
             cancel: vi.fn(), dispose: vi.fn() },
    });
    const c = new LocalNativeClient({ onConversationUpdated: (e: any) => { if (e.delta?.audio) deltas.push(e); } } as any, deps as any);
    await c.connect({ asrModelId: 'sense-voice', translationModelId: 'q', ttsModelId: 'csukuangfj/vits-piper-en_US-amy-low', ttsSpeed: 1.0, textOnly: false } as any);
    // Drive a translation result through the job path with two sentences:
    await (c as any).runJob({ translatedText: 'Hello there. How are you?' /* + the item fields runJob expects */ } as any);
    expect(deps.tts.generate).toHaveBeenCalledTimes(2);          // one per sentence
    expect(deltas.length).toBe(2);                                // one audio delta per sentence
    const item = deltas[deltas.length - 1].item;
    expect(item.formatted.audioSegments.length).toBe(2);         // karaoke segment per sentence
  });

  it('streaming MOSS: emits one delta per chunk via onChunk', async () => {
    const deltas: any[] = [];
    const deps = fakeDeps({
      tts: { init: vi.fn().mockResolvedValue({ sampleRate: 24000, loadTimeMs: 1, device: 'cpu', streaming: true, clones: true }),
             generate: vi.fn().mockImplementation(async (_t: string, _s: number, onChunk: any) => {
               onChunk(new Float32Array(800), 0); onChunk(new Float32Array(800), 1);
               return { samples: new Float32Array(0), sampleRate: 24000, generationTimeMs: 4 };
             }), cancel: vi.fn(), dispose: vi.fn() },
    });
    const c = new LocalNativeClient({ onConversationUpdated: (e: any) => { if (e.delta?.audio) deltas.push(e); } } as any, deps as any);
    await c.connect({ asrModelId: 'a', translationModelId: 't', ttsModelId: 'moss-tts-nano', ttsSpeed: 1.0, textOnly: false } as any);
    await (c as any).runJob({ translatedText: 'Hi.' } as any);
    expect(deltas.length).toBe(2);                                // one delta per streamed chunk
  });

  it('cancelResponse cancels the in-flight TTS stream', async () => {
    const deps = fakeDeps();
    const c = new LocalNativeClient({} as any, deps as any);
    await c.connect({ asrModelId: 'a', translationModelId: 't', ttsModelId: 'moss-tts-nano', ttsSpeed: 1.0, textOnly: false } as any);
    c.cancelResponse();
    expect(deps.tts.cancel).toHaveBeenCalled();
  });
});
```
(Adapt the `runJob` argument shape and the assistant-item construction to the real `runJob`/`emit` you see in the file — the assertions on `generate` call count, delta count, and `audioSegments` are the contract.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/services/clients/LocalNativeClient.test.ts`
Expected: FAIL (current runJob calls generate once on whole text; no `onChunk`; no `audioSegments`; `cancelResponse` is a no-op).

- [ ] **Step 3: Implement**

Add the import (top of file, alongside the existing `splitSentences` users — confirm the helper's module; `LocalInferenceClient` imports it):

```typescript
import { splitSentences } from '../../lib/local-inference/sentenceSplit';   // match LocalInferenceClient's import path
```

Replace the runJob TTS block (the `if (this.ttsEnabled) { … this.emit(item, { audio: int16 }); }` region) with a per-sentence loop + karaoke + replay, factored into a helper:

```typescript
    if (this.ttsEnabled) {
      this.emitEvent('local.native.tts.start', 'client', {});
      const sentences = splitSentences(tr.translatedText, this.config.targetLanguage) || [tr.translatedText];
      item.formatted.audioSegments = item.formatted.audioSegments || [];
      let audioEnd = item.formatted.audioTextEnd ? 0 : 0;     // cumulative sample offset
      let textEnd = 0;
      for (const sentence of sentences) {
        if (!sentence.trim()) continue;
        const pushPcm = (samples: Float32Array, sr: number) => {
          const int16 = float32ToInt16(resampleFloat32(samples, sr, 24000));
          audioEnd += int16.length;
          if (this.keepReplayAudio) this.appendItemAudio(item, int16);
          this.emit(item, { audio: int16 });
        };
        if (this.ttsStreaming) {
          await this.tts.generate(sentence, this.ttsSpeed, (pcm: Float32Array) => pushPcm(pcm, 24000));
        } else {
          const res = await this.tts.generate(sentence, this.ttsSpeed);
          pushPcm(res.samples as Float32Array, res.sampleRate);
        }
        textEnd += sentence.length;
        item.formatted.audioSegments.push({ textEnd, audioEnd });
        item.formatted.audioTextEnd = textEnd;
      }
      this.emitEvent('local.native.tts.end', 'server', { samples: audioEnd });
    }
```
(Use the same `tr`/`item` variable names already in `runJob`; reuse `this.config.targetLanguage` — confirm the field name on the stored config.)

Implement `cancelResponse`:

```typescript
  cancelResponse(): void { try { this.tts?.cancel?.(); } catch (_) {} }
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/services/clients/LocalNativeClient.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/clients/LocalNativeClient.ts src/services/clients/LocalNativeClient.test.ts
git commit -m "feat(native): per-sentence TTS playback parity (split+stream+karaoke+replay)"
```

---

### Task 6: TTS model card resolved badge in `NativeModelManagementSection`

**Files:**
- Modify: `src/components/Settings/sections/NativeModelManagementSection.tsx` (the TTS card's `resolvedForField`, ~line 529)
- Test: `src/components/Settings/sections/NativeModelManagementSection.test.tsx` (append; create if absent)

**Interfaces:**
- Consumes: `useNativeTtsResolved()` from `nativeModelStore` (Task 2).
- Produces: the TTS card receives the `ttsResolved` entry (matched to the selected TTS model id) instead of `null`, so it renders the resolved tier badge via the existing helpers.

- [ ] **Step 1: Write the failing test**

Append a render test (mirror the existing ASR/translate badge test in this file, if present) asserting that when `useNativeModelStore` has a `ttsResolved` matching the selected TTS model, the TTS card shows the device chip (e.g. text "CPU" / the badge element) — and shows nothing when `ttsResolved` is null. Use the file's existing render harness + `useNativeModelStore.setState(...)` to seed `ttsResolved`.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/Settings/sections/NativeModelManagementSection.test.tsx`
Expected: FAIL (TTS card passes `null` → no badge).

- [ ] **Step 3: Implement**

In `NativeModelManagementSection.tsx`: read `const ttsResolved = useNativeTtsResolved();` near the other resolved hooks. Change the TTS branch of the `resolvedForField` computation (currently `field === 'ttsModel' ? null : …`) to return the `ttsResolved` entry when its `model` matches the selected TTS model id — exactly how the ASR/translate cards derive their `resolvedForField` (mirror that expression). Keep returning `null` when there's no match (so the badge is absent until a session resolves).

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/components/Settings/sections/NativeModelManagementSection.test.tsx`
Expected: PASS.

- [ ] **Step 5: Run the full renderer TTS-touching suite + commit**

Run: `npx vitest run src/lib/local-inference/native src/stores/nativeModelStore.test.ts src/services/clients/LocalNativeClient.test.ts src/components/Settings/sections/NativeModelManagementSection.test.tsx`
Expected: all PASS.

```bash
git add src/components/Settings/sections/NativeModelManagementSection.tsx src/components/Settings/sections/NativeModelManagementSection.test.tsx
git commit -m "feat(native): render resolved perf badge on the TTS model card"
```

---

## Self-Review

**Spec coverage:**
- Protocol migration (tts_init/tts_generate) + streaming (tts_chunk/tts_done) + cancel → Task 1. ✓
- `ttsResolved` store + selectors → Task 2. ✓
- MOSS-Nano catalog + capability flags → Task 3. ✓
- Surface `ttsResolved` on connect + streaming-flag routing → Task 4. ✓
- Full-parity playback (sentence-split + streaming deltas + karaoke + replay + cancel) → Task 5. ✓
- TTS card resolved badge → Task 6. ✓
- Plan B (voice-clone UX) → explicitly out of scope (spec Non-goals); `clones` flag plumbed (Task 3/4), dormant. ✓

**Placeholder scan:** Tasks 4–6 carry "adapt to the real `runJob`/constructor/card expression you see in the file" notes — these are existing-codebase mirror points (the contract assertions are concrete); not plan placeholders. All authored TS (Tasks 1–3) is complete.

**Type consistency:** `TtsReady` (Task 1) fields == the `setTtsResolved` shape (Task 2) == the `connect` call (Task 4); `streaming`/`clones` flags flow `ready`→`TtsReady`→`NativeModelOption`/`NativeModelCardSpec` (Task 3) consistently; `generate(text, speed, onChunk?)` signature is identical in Task 1 (def) and Task 5 (use); message type strings match the sidecar verbatim.

## Follow-up (Plan B, separate spec/plan)

Voice-clone UX: capability-driven Voice section (reference-audio upload/record + reference-audio store + `NativeTtsClient.setReferenceVoice` on connect, gated by the `clones` flag).
