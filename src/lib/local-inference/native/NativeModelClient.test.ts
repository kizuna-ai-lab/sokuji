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
  private emit(o: any) { this.onmessage?.({ data: JSON.stringify(o) }); }
  send(d: any) {
    const msg = JSON.parse(d);
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
  }
  close() {}
  static cancelled = new Set<string>();
}

beforeEach(() => {
  (globalThis as any).WebSocket = FakeWS as any;
  (globalThis as any).window = { electron: { invoke: vi.fn().mockResolvedValue({ ok: true, port: 9 }) } };
  FakeWS.cancelled.clear();
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
});
