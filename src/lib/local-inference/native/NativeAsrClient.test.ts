// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NativeAsrClient } from './NativeAsrClient';

class FakeWS {
  static last: FakeWS;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: any }) => void) | null = null;
  onerror: (() => void) | null = null;
  binaryType = 'arraybuffer';
  constructor(public url: string) { FakeWS.last = this; setTimeout(() => this.onopen?.(), 0); }
  send(d: any) {
    if (typeof d === 'string') {
      const msg = JSON.parse(d);
      if (msg.type === 'asr_init') queueMicrotask(() =>
        this.onmessage?.({ data: JSON.stringify({ type: 'ready', id: msg.id, loadTimeMs: 2 }) }));
      if (msg.type === 'asr_flush') queueMicrotask(() =>
        this.onmessage?.({ data: JSON.stringify({ type: 'ok', id: msg.id }) }));
    } else {
      queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ type: 'speech_start' }) }));
      queueMicrotask(() => this.onmessage?.({ data: JSON.stringify(
        { type: 'result', text: 'hi', startSample: 0, durationMs: 10, recognitionTimeMs: 1 }) }));
    }
  }
  close() {}
}

beforeEach(() => {
  (globalThis as any).WebSocket = FakeWS as any;
  (globalThis as any).window = { electron: { invoke: vi.fn().mockResolvedValue({ ok: true, port: 9 }) } };
});

describe('NativeAsrClient', () => {
  it('inits then pushes speech_start + result on fed audio', async () => {
    const c = new NativeAsrClient();
    const results: string[] = [];
    let starts = 0;
    c.onResult = (r) => results.push(r.text);
    c.onSpeechStart = () => { starts++; };
    const r = await c.init('en');
    expect(r).toEqual({ loadTimeMs: 2 });
    c.feedAudio(new Int16Array(24000), 24000);
    await new Promise((res) => setTimeout(res, 5));
    expect(starts).toBe(1);
    expect(results).toEqual(['hi']);
  });
});
