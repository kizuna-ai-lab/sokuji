// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NativeTranslateClient } from './NativeTranslateClient';

class FakeWS {
  static last: FakeWS;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: any }) => void) | null = null;
  onerror: (() => void) | null = null;
  binaryType = 'arraybuffer';
  constructor(public url: string) { FakeWS.last = this; setTimeout(() => this.onopen?.(), 0); }
  send(d: any) {
    const msg = JSON.parse(d);
    if (msg.type === 'translate_init') queueMicrotask(() =>
      this.onmessage?.({ data: JSON.stringify({ type: 'ready', id: msg.id, loadTimeMs: 3 }) }));
    if (msg.type === 'translate') queueMicrotask(() =>
      this.onmessage?.({ data: JSON.stringify({
        type: 'translation', id: msg.id, sourceText: msg.text,
        translatedText: msg.text.toUpperCase(), inferenceTimeMs: 4 }) }));
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
    expect(r).toEqual({ loadTimeMs: 3 });
    const res = await c.translate('hola');
    expect(res).toEqual({ sourceText: 'hola', translatedText: 'HOLA', inferenceTimeMs: 4 });
  });
});
