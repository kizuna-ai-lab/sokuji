// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NativeAsrClient } from './NativeAsrClient';

class FakeWS {
  static last: FakeWS;
  static lastInit: any;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: any }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
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

class ErrorFakeWS {
  static last: ErrorFakeWS;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: any }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  binaryType = 'arraybuffer';
  constructor(public url: string) { ErrorFakeWS.last = this; setTimeout(() => this.onopen?.(), 0); }
  send(d: any) {
    if (typeof d === 'string') {
      const msg = JSON.parse(d);
      // Always reply with an error carrying the request id
      queueMicrotask(() =>
        this.onmessage?.({ data: JSON.stringify({ type: 'error', id: msg.id, message: 'boom' }) }));
    }
  }
  close() {}
}

beforeEach(() => {
  FakeWS.lastInit = undefined;
  (globalThis as any).WebSocket = FakeWS as any;
  (globalThis as any).window = { electron: { invoke: vi.fn().mockResolvedValue({ ok: true, port: 9 }) } };
});

describe('NativeAsrClient error rejection', () => {
  it('rejects init() when sidecar replies {type:error, id}', async () => {
    (globalThis as any).WebSocket = ErrorFakeWS as any;
    const c = new NativeAsrClient();
    await expect(c.init('en')).rejects.toThrow('boom');
  });

  it('rejects flush() when sidecar replies {type:error, id}', async () => {
    // First init with normal WS, then swap to error WS for flush
    (globalThis as any).WebSocket = FakeWS as any;
    const c = new NativeAsrClient();
    await c.init('en');
    // Swap to error responder for flush
    FakeWS.last.send = (d: any) => {
      const msg = JSON.parse(d);
      queueMicrotask(() =>
        FakeWS.last.onmessage?.({ data: JSON.stringify({ type: 'error', id: msg.id, message: 'flush-boom' }) }));
    };
    await expect(c.flush()).rejects.toThrow('flush-boom');
  });

  it('rejects pending calls on dispose()', async () => {
    (globalThis as any).WebSocket = FakeWS as any;
    const c = new NativeAsrClient();
    await c.init('en');
    // Issue a flush but don't let FakeWS reply — dispose() should reject it
    FakeWS.last.send = () => {}; // swallow the send, no reply
    const p = c.flush();
    // Yield so flush() advances past await connect() and registers in pending
    await new Promise((r) => setTimeout(r, 0));
    c.dispose();
    await expect(p).rejects.toThrow('native host disconnected');
  });
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

  it('dispatches partial → onPartialResult and id-less result → onResult', () => {
    const c = new NativeAsrClient();
    const partials: string[] = [];
    const finals: string[] = [];
    c.onPartialResult = (t) => partials.push(t);
    c.onResult = (r) => finals.push(r.text);
    // reach the private onMessage via the same path the WS uses
    (c as any).onMessage(JSON.stringify({ type: 'partial', text: 'he llo' }));
    (c as any).onMessage(JSON.stringify({ type: 'result', text: 'hello world', durationMs: 1000, recognitionTimeMs: 50 }));
    expect(partials).toEqual(['he llo']);
    expect(finals).toEqual(['hello world']);
  });
});
