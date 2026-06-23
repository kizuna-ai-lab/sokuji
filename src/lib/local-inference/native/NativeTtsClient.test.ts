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
  constructor(public url: string) { FakeWS.last = this; setTimeout(() => this.onopen?.(), 0); }
  send(d: any) {
    this.sent.push(d);
    const msg = typeof d === 'string' ? JSON.parse(d) : null;
    if (msg?.type === 'init') queueMicrotask(() =>
      this.onmessage?.({ data: JSON.stringify({ type: 'ready', id: msg.id, sampleRate: 24000, loadTimeMs: 5 }) }));
    if (msg?.type === 'generate') {
      const pcm = new Float32Array([0.1, 0.2, 0.3]);
      queueMicrotask(() => this.onmessage?.({ data: pcm.buffer }));
      queueMicrotask(() => this.onmessage?.({ data: JSON.stringify(
        { type: 'result', id: msg.id, sampleRate: 24000, generationTimeMs: 7, samples: 3 }) }));
    }
  }
  close() {}
}

beforeEach(() => {
  (globalThis as any).WebSocket = FakeWS as any;
  (globalThis as any).window = { electron: { invoke: vi.fn().mockResolvedValue({ ok: true, port: 9 }) } };
});

describe('NativeTtsClient', () => {
  it('connects on the started port and inits', async () => {
    const c = new NativeTtsClient();
    const r = await c.init();
    expect(r).toEqual({ sampleRate: 24000, loadTimeMs: 5 });
    expect(FakeWS.last.url).toBe('ws://127.0.0.1:9');
  });

  it('generate returns the binary PCM as a TtsResult', async () => {
    const c = new NativeTtsClient();
    await c.init();
    const res = await c.generate('hi');
    expect(res.sampleRate).toBe(24000);
    expect(Array.from(res.samples as Float32Array).map(x => +x.toFixed(1))).toEqual([0.1, 0.2, 0.3]);
  });
});
