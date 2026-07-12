// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NativeTranslateClient } from './NativeTranslateClient';

class FakeWS {
  static last: FakeWS;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: any }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  binaryType = 'arraybuffer';
  constructor(public url: string) { FakeWS.last = this; setTimeout(() => this.onopen?.(), 0); }
  send(d: any) {
    const msg = JSON.parse(d);
    if (msg.type === 'translate_init') queueMicrotask(() =>
      this.onmessage?.({ data: JSON.stringify({
        type: 'ready', id: msg.id, loadTimeMs: 3,
        backend: 'llamacpp_qwen', device: msg.device ?? 'auto', computeType: 'q8_0' }) }));
    if (msg.type === 'translate') queueMicrotask(() =>
      this.onmessage?.({ data: JSON.stringify({
        type: 'translation', id: msg.id, sourceText: msg.text,
        translatedText: msg.text.toUpperCase(), inferenceTimeMs: 4 }) }));
  }
  close() {}
}

class ErrorFakeWS {
  static last: ErrorFakeWS;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: any }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  binaryType = 'arraybuffer';
  constructor(public url: string) { ErrorFakeWS.last = this; setTimeout(() => this.onopen?.(), 0); }
  send(d: any) {
    const msg = JSON.parse(d);
    queueMicrotask(() =>
      this.onmessage?.({ data: JSON.stringify({ type: 'error', id: msg.id, message: 'translate-boom' }) }));
  }
  close() {}
}

beforeEach(() => {
  (globalThis as any).WebSocket = FakeWS as any;
  (globalThis as any).window = { electron: { invoke: vi.fn().mockResolvedValue({ ok: true, port: 9 }) } };
});

describe('NativeTranslateClient', () => {
  it('inits with langs and translates', async () => {
    const c = new NativeTranslateClient();
    const r = await c.init('es', 'en');
    expect(r.loadTimeMs).toBe(3);
    const res = await c.translate('hola');
    expect(res).toEqual({ sourceText: 'hola', translatedText: 'HOLA', inferenceTimeMs: 4 });
  });

  it('sends device and returns resolved fields', async () => {
    const c = new NativeTranslateClient();
    const r = await c.init('es', 'en', 'qwen3-0.6b', 'cuda');
    expect(r.loadTimeMs).toBe(3);
    expect(r.device).toBe('cuda');
    expect(r.backend).toBe('llamacpp_qwen');
    expect(r.computeType).toBe('q8_0');
  });
});

describe('NativeTranslateClient error rejection', () => {
  it('rejects init() when sidecar replies {type:error, id}', async () => {
    (globalThis as any).WebSocket = ErrorFakeWS as any;
    const c = new NativeTranslateClient();
    await expect(c.init('es', 'en')).rejects.toThrow('translate-boom');
  });

  it('rejects translate() when sidecar replies {type:error, id}', async () => {
    (globalThis as any).WebSocket = FakeWS as any;
    const c = new NativeTranslateClient();
    await c.init('es', 'en');
    // Swap to error responder
    FakeWS.last.send = (d: any) => {
      const msg = JSON.parse(d);
      queueMicrotask(() =>
        FakeWS.last.onmessage?.({ data: JSON.stringify({ type: 'error', id: msg.id, message: 'translate-fail' }) }));
    };
    await expect(c.translate('hola')).rejects.toThrow('translate-fail');
  });

  it('rejects pending calls on dispose()', async () => {
    (globalThis as any).WebSocket = FakeWS as any;
    const c = new NativeTranslateClient();
    await c.init('es', 'en');
    FakeWS.last.send = () => {}; // swallow, no reply
    const p = c.translate('hola');
    // Yield so translate() advances past await connect() and registers in pending
    await new Promise((r) => setTimeout(r, 0));
    c.dispose();
    await expect(p).rejects.toThrow('native host disconnected');
  });
});
