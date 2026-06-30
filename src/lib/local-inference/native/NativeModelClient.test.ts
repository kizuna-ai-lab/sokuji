// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NativeModelClient } from './NativeModelClient';
import type { NativeVoiceInfo } from './nativeProtocol';

class FakeWS {
  static last: FakeWS;
  static OPEN = 1;
  static sent: any[] = [];
  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: any }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  binaryType = 'arraybuffer';
  constructor(public url: string) { FakeWS.last = this; setTimeout(() => this.onopen?.(), 0); }
  private emit(o: any) { this.onmessage?.({ data: JSON.stringify(o) }); }
  send(d: any) {
    const msg = JSON.parse(d);
    FakeWS.sent.push(msg);
    if (msg.type === 'model_status') queueMicrotask(() =>
      this.emit({ type: 'model_status_result', id: msg.id, statuses: { 'sense-voice': 'ready', 'whisper-tiny': 'absent' } }));
    if (msg.type === 'model_download') {
      // first progress promptly; the terminal message is deferred so a cancel can
      // arrive in between (mirrors the sidecar's between-files cancel check).
      setTimeout(() => this.emit({ type: 'model_progress', model: msg.model, downloaded: 1, total: 2 }), 0);
      setTimeout(() => {
        if (FakeWS.cancelled.has(msg.model)) {
          this.emit({ type: 'model_download_done', model: msg.model, status: 'cancelled' });
        } else {
          this.emit({ type: 'model_progress', model: msg.model, downloaded: 2, total: 2 });
          this.emit({ type: 'model_download_done', model: msg.model, status: 'ready' });
        }
      }, 20);
    }
    if (msg.type === 'model_cancel') FakeWS.cancelled.add(msg.model);
    if (msg.type === 'hardware_info') queueMicrotask(() =>
      this.emit({ type: 'hardware_info_result', id: msg.id, os: 'Linux', arch: 'x86_64',
        cpuCores: 8, gpus: [], backendsInstalled: ['ctranslate2', 'sherpa'], accelAvailable: false }));
    if (msg.type === 'models_catalog') queueMicrotask(() =>
      this.emit({ type: 'models_catalog_result', id: msg.id, models: [
        { id: 'sense-voice', name: 'SenseVoice', languages: ['zh', 'en', 'ja', 'ko', 'yue'],
          recommended: true, tiers: [{ tier: 'cpu', backend: 'sherpa', available: true }] },
      ] }));
    if (msg.type === 'list_variants') queueMicrotask(() =>
      this.emit({ type: 'list_variants_result', id: msg.id,
        variants: [{ id: 'fp8', computeType: 'fp8', repo: 'tencent/Hy-MT2-7B-FP8', sizeBytes: 8e9, supported: true, reason: 'fits' }],
        recommended: 'fp8' }));
    if (msg.type === 'list_tts_voices') queueMicrotask(() =>
      this.emit({ type: 'list_tts_voices_result', id: msg.id, voices: [
        { name: 'Ava', language: 'en', curated: true, unstable: false, default: true },
        { name: 'Bella', language: 'en', curated: true, unstable: false, default: false },
      ] }));
  }
  close() {}
  static cancelled = new Set<string>();
}

class ErrorFakeWS {
  static last: ErrorFakeWS;
  static OPEN = 1;
  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: any }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  binaryType = 'arraybuffer';
  constructor(public url: string) { ErrorFakeWS.last = this; setTimeout(() => this.onopen?.(), 0); }
  send(d: any) {
    const msg = JSON.parse(d);
    queueMicrotask(() =>
      this.onmessage?.({ data: JSON.stringify({ type: 'error', id: msg.id, message: 'model-boom' }) }));
  }
  close() {}
}

beforeEach(() => {
  (globalThis as any).WebSocket = FakeWS as any;
  (globalThis as any).window = { electron: { invoke: vi.fn().mockResolvedValue({ ok: true, port: 9 }) } };
  FakeWS.cancelled.clear();
  FakeWS.sent = [];
});

describe('NativeModelClient', () => {
  it('queries status', async () => {
    const c = new NativeModelClient();
    expect(await c.status(['sense-voice', 'whisper-tiny'])).toEqual({ 'sense-voice': 'ready', 'whisper-tiny': 'absent' });
  });

  it('downloads with progress then resolves ready', async () => {
    const c = new NativeModelClient();
    const prog: number[] = [];
    const status = await c.download('whisper-tiny', (p) => prog.push(p.downloaded));
    expect(prog).toEqual([1, 2]);
    expect(status).toBe('ready');
  });

  it('resolves cancelled when cancel() interrupts the download', async () => {
    const c = new NativeModelClient();
    const prog: number[] = [];
    const p = c.download('whisper-tiny', (x) => prog.push(x.downloaded));
    await new Promise((r) => setTimeout(r, 5)); // let it connect + emit first progress
    await c.cancel('whisper-tiny');             // lands before the deferred terminal
    expect(await p).toBe('cancelled');
    expect(prog).toEqual([1]); // only the pre-cancel progress arrived
  });

  it('queries hardware info', async () => {
    const c = new NativeModelClient();
    const hw = await c.hardwareInfo();
    expect(hw.backendsInstalled).toEqual(['ctranslate2', 'sherpa']);
    expect(hw.accelAvailable).toBe(false);
  });

  it('queries the models catalog', async () => {
    const c = new NativeModelClient();
    const models = await c.modelsCatalog(['sense-voice']);
    expect(models).toHaveLength(1);
    expect(models[0]).toMatchObject({ id: 'sense-voice', recommended: true });
    expect(models[0].tiers[0]).toMatchObject({ tier: 'cpu', available: true });
  });

  it('listVariants returns variants + recommended from the sidecar', async () => {
    const c = new NativeModelClient();
    const r = await c.listVariants('hy-mt2-7b', 'voxtral-mini-4b-realtime', null);
    expect(r.recommended).toBe('fp8');
    expect(r.variants[0].supported).toBe(true);
    expect(r.variants[0].id).toBe('fp8');
    expect(r.variants[0].computeType).toBe('fp8');
    expect(r.variants[0].sizeBytes).toBe(8e9);
  });

  it('listTtsVoices returns voice descriptors', async () => {
    const c = new NativeModelClient();
    const voices = await c.listTtsVoices('moss-tts-nano');
    expect(voices[0].name).toBe('Ava');
    expect(voices[1].name).toBe('Bella');
  });

  it('requests the tts catalog kind and returns voice descriptors', async () => {
    const client = new NativeModelClient();
    await client.modelsCatalog(undefined, 'tts');
    const catalogSent = FakeWS.sent.find((m: any) => m.type === 'models_catalog');
    expect(catalogSent.kind).toBe('tts');
    const voices: NativeVoiceInfo[] = await client.listTtsVoices('moss-tts-nano');
    expect(voices).toEqual([
      { name: 'Ava', language: 'en', curated: true, unstable: false, default: true },
      { name: 'Bella', language: 'en', curated: true, unstable: false, default: false },
    ]);
  });
});

describe('NativeModelClient error rejection', () => {
  it('rejects status() when sidecar replies {type:error, id}', async () => {
    (globalThis as any).WebSocket = ErrorFakeWS as any;
    const c = new NativeModelClient();
    await expect(c.status(['sense-voice'])).rejects.toThrow('model-boom');
  });

  it('rejects hardwareInfo() when sidecar replies {type:error, id}', async () => {
    (globalThis as any).WebSocket = ErrorFakeWS as any;
    const c = new NativeModelClient();
    await expect(c.hardwareInfo()).rejects.toThrow('model-boom');
  });

  it('rejects pending calls on dispose()', async () => {
    (globalThis as any).WebSocket = FakeWS as any;
    const c = new NativeModelClient();
    await c.status(['sense-voice']); // connect and complete one request
    // Now install a no-reply send so the next request hangs in pending
    FakeWS.last.send = () => {};
    // sizes() will: await connect() (returns immediately, already open), then call send() synchronously
    // We need the request to be in pending before we dispose().
    // Use a trick: sizes() is async but send() is sync inside it; capture the Promise then yield.
    const p = c.sizes(['sense-voice']);
    // Yield to let sizes() advance past the await connect() and register in pending
    await new Promise((r) => setTimeout(r, 0));
    c.dispose();
    await expect(p).rejects.toThrow('native host disconnected');
  });
});
