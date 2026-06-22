// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NativeAsrClient } from './NativeAsrClient';

class FakeWS {
  static last: FakeWS;
  static lastInit: any;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: any }) => void) | null = null;
  onerror: (() => void) | null = null;
  binaryType = 'arraybuffer';
  constructor(public url: string) { FakeWS.last = this; setTimeout(() => this.onopen?.(), 0); }
  send(d: any) {
    if (typeof d === 'string') {
      const msg = JSON.parse(d);
      if (msg.type === 'asr_init') {
        FakeWS.lastInit = msg;
        queueMicrotask(() =>
          this.onmessage?.({ data: JSON.stringify({ type: 'ready', id: msg.id, loadTimeMs: 2, device: msg.device, rtf: 0.5 }) }));
      }
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
  FakeWS.lastInit = undefined;
  (globalThis as any).WebSocket = FakeWS as any;
  (globalThis as any).window = { electron: { invoke: vi.fn().mockResolvedValue({ ok: true, port: 9 }) } };
});

describe('NativeAsrClient', () => {
  it('returns the resolved device + rtf from ready', async () => {
    const c = new NativeAsrClient();
    const r = await c.init('en', 'granite-speech-4.1-2b', 24000, undefined, 'cuda');
    expect(r.loadTimeMs).toBe(2);
    expect(r.device).toBe('cuda');
    expect(r.rtf).toBe(0.5);
  });

  it('sends the device override in asr_init', async () => {
    const c = new NativeAsrClient();
    await c.init('en', 'granite-speech-4.1-2b', 24000, undefined, 'cuda');
    expect(FakeWS.lastInit.device).toBe('cuda');
  });

  it('inits then pushes speech_start + result on fed audio', async () => {
    const c = new NativeAsrClient();
    const results: string[] = [];
    let starts = 0;
    c.onResult = (r) => results.push(r.text);
    c.onSpeechStart = () => { starts++; };
    const r = await c.init('en');
    expect(r.loadTimeMs).toBe(2);
    c.feedAudio(new Int16Array(24000), 24000);
    await new Promise((res) => setTimeout(res, 5));
    expect(starts).toBe(1);
    expect(results).toEqual(['hi']);
  });
});
