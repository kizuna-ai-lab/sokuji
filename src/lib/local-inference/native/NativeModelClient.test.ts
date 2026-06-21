// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NativeModelClient } from './NativeModelClient';

class FakeWS {
  static last: FakeWS;
  static OPEN = 1;
  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: any }) => void) | null = null;
  onerror: (() => void) | null = null;
  binaryType = 'arraybuffer';
  constructor(public url: string) { FakeWS.last = this; setTimeout(() => this.onopen?.(), 0); }
  send(d: any) {
    const msg = JSON.parse(d);
    if (msg.type === 'model_status') queueMicrotask(() =>
      this.onmessage?.({ data: JSON.stringify({ type: 'model_status_result', id: msg.id, statuses: { 'sense-voice': 'ready', 'whisper-tiny': 'absent' } }) }));
    if (msg.type === 'model_download') {
      queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ type: 'model_progress', model: msg.model, downloaded: 1, total: 2 }) }));
      queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ type: 'model_progress', model: msg.model, downloaded: 2, total: 2 }) }));
      queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ type: 'ok', id: msg.id }) }));
    }
  }
  close() {}
}

beforeEach(() => {
  (globalThis as any).WebSocket = FakeWS as any;
  (globalThis as any).window = { electron: { invoke: vi.fn().mockResolvedValue({ ok: true, port: 9 }) } };
});

describe('NativeModelClient', () => {
  it('queries status', async () => {
    const c = new NativeModelClient();
    expect(await c.status(['sense-voice', 'whisper-tiny'])).toEqual({ 'sense-voice': 'ready', 'whisper-tiny': 'absent' });
  });

  it('downloads with progress then resolves', async () => {
    const c = new NativeModelClient();
    const prog: number[] = [];
    await c.download('whisper-tiny', (p) => prog.push(p.downloaded));
    expect(prog).toEqual([1, 2]);
  });
});
