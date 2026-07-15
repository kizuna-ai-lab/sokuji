// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SidecarConnection, SidecarTimeoutError } from './SidecarConnection';

// One reusable fake WebSocket — the ONLY place in the native suite that still
// mocks the raw socket. Every client test uses FakeSidecarConnection instead.
class FakeWS {
  static instances: FakeWS[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: any }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  binaryType = 'arraybuffer';
  sent: any[] = [];
  readyState = 1; // OPEN
  constructor(public url: string) { FakeWS.instances.push(this); setTimeout(() => this.onopen?.(), 0); }
  send(d: any) { this.sent.push(d); }
  close() { this.readyState = 3; this.onclose?.(); }
  reply(obj: any) { this.onmessage?.({ data: JSON.stringify(obj) }); }
  replyBinary(buf: ArrayBuffer) { this.onmessage?.({ data: buf }); }
}

beforeEach(() => {
  FakeWS.instances = [];
  (globalThis as any).WebSocket = FakeWS as any;
  (globalThis as any).WebSocket.OPEN = 1;
  (globalThis as any).window = { electron: { invoke: vi.fn().mockResolvedValue({ ok: true, port: 9 }) } };
});
afterEach(() => { vi.useRealTimers(); });

// connect() awaits electron().invoke() (a microtask) BEFORE constructing the socket,
// so FakeWS's onopen timer is registered after a bare test-side setTimeout(0). Tests
// that drive replies must `await c.connect()` first (socket open), then `await tick()`
// to flush request()'s own .then() before inspecting the socket.
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('SidecarConnection', () => {
  it('connect() opens one socket to the port from native-host:start', async () => {
    const c = new SidecarConnection();
    await c.connect();
    expect(FakeWS.instances).toHaveLength(1);
    expect(FakeWS.instances[0].url).toBe('ws://127.0.0.1:9');
  });

  it('single-flights concurrent connect() into one socket', async () => {
    const c = new SidecarConnection();
    await Promise.all([c.connect(), c.connect(), c.connect()]);
    expect(FakeWS.instances).toHaveLength(1);
  });

  it('request() injects an id and resolves with the matching reply', async () => {
    const c = new SidecarConnection();
    await c.connect();
    const p = c.request({ type: 'translate', text: 'hi' });
    await tick();
    const ws = FakeWS.instances[0];
    const sent = JSON.parse(ws.sent[0]);
    expect(sent).toMatchObject({ type: 'translate', text: 'hi' });
    expect(typeof sent.id).toBe('number');
    ws.reply({ type: 'translation', id: sent.id, sourceText: 'hi', translatedText: 'こんにちは', inferenceTimeMs: 3 });
    await expect(p).resolves.toMatchObject({ translatedText: 'こんにちは' });
  });

  it('request() rejects on an error reply carrying the id', async () => {
    const c = new SidecarConnection();
    await c.connect();
    const p = c.request({ type: 'translate', text: 'x' });
    await tick();
    const ws = FakeWS.instances[0];
    const id = JSON.parse(ws.sent[0]).id;
    ws.reply({ type: 'error', id, message: 'boom' });
    await expect(p).rejects.toThrow('boom');
  });

  it('request() rejects with SidecarTimeoutError after timeoutMs and ignores a late reply', async () => {
    vi.useFakeTimers();
    const c = new SidecarConnection();
    const p = c.request({ type: 'translate', text: 'x' }, { timeoutMs: 1000 });
    await vi.advanceTimersByTimeAsync(0);            // connect() resolves
    const ws = FakeWS.instances[0];
    const id = JSON.parse(ws.sent[0]).id;
    const caught = p.catch((e) => e);
    await vi.advanceTimersByTimeAsync(1000);
    const err = await caught;
    expect(err).toBeInstanceOf(SidecarTimeoutError);
    expect((err as SidecarTimeoutError).requestType).toBe('translate');
    // A late reply after timeout must be routed to onMessage, not crash.
    const pushes: any[] = [];
    c.onMessage((m) => pushes.push(m));
    ws.reply({ type: 'translation', id, translatedText: 'late' });
    expect(pushes).toHaveLength(1);
  });

  it('routes an id-less message to onMessage', async () => {
    const c = new SidecarConnection();
    const pushes: any[] = [];
    c.onMessage((m) => pushes.push(m));
    await c.connect();
    FakeWS.instances[0].reply({ type: 'partial', text: 'he' });
    expect(pushes).toEqual([{ type: 'partial', text: 'he' }]);
  });

  it('routes a binary frame to onBinary', async () => {
    const c = new SidecarConnection();
    const bins: ArrayBuffer[] = [];
    c.onBinary((b) => bins.push(b));
    await c.connect();
    const buf = new Int16Array([1, 2, 3]).buffer;
    FakeWS.instances[0].replyBinary(buf);
    expect(bins).toEqual([buf]);
  });

  it('rejects pending and fires onClose when the socket closes', async () => {
    const c = new SidecarConnection();
    let closeErr: Error | null = null;
    c.onClose((e) => { closeErr = e; });
    await c.connect();
    const p = c.request({ type: 'translate', text: 'x' });
    await tick();
    FakeWS.instances[0].close();
    await expect(p).rejects.toThrow('native host disconnected');
    expect(closeErr).toBeInstanceOf(Error);
    expect((closeErr as unknown as Error).message).toBe('native host disconnected');
  });

  it('dispose() rejects pending and does NOT fire onClose', async () => {
    const c = new SidecarConnection();
    let closeFired = false;
    c.onClose(() => { closeFired = true; });
    await c.connect();
    const p = c.request({ type: 'translate', text: 'x' });
    await tick();
    c.dispose();
    await expect(p).rejects.toThrow('native host disconnected');
    expect(closeFired).toBe(false);
  });

  it('a stale socket close does not reject the live socket\'s pending requests', async () => {
    const c = new SidecarConnection();
    await c.connect();
    const a = FakeWS.instances[0];
    // The server drops socket A into CLOSING without firing onclose yet.
    a.readyState = 2;
    // A follow-up connect() sees A is not OPEN and opens a replacement socket B.
    await c.connect();
    expect(FakeWS.instances).toHaveLength(2);
    const b = FakeWS.instances[1];
    // Issue a request on the live socket B.
    const p = c.request({ type: 'translate', text: 'x' });
    await tick();
    // A's delayed onclose finally fires. Without the ownership guard it would null B
    // and reject B's in-flight request; with it, B is untouched.
    a.onclose?.();
    const id = JSON.parse(b.sent[0]).id;
    b.reply({ type: 'translation', id, translatedText: 'ok' });
    await expect(p).resolves.toMatchObject({ translatedText: 'ok' });
  });

  it('connect() rejects (does not hang) if the socket closes before it opens', async () => {
    vi.useFakeTimers();
    const c = new SidecarConnection();
    const caught = c.connect().catch((e) => e);
    // Flush the electron().invoke() microtask so the socket is constructed, but do
    // NOT advance timers, so FakeWS's queued onopen never fires.
    await Promise.resolve();
    await Promise.resolve();
    FakeWS.instances[0].close();   // onclose arrives before onopen
    const err = await caught;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('native host disconnected');
  });

  it('request() rejects and cleans up when send() throws synchronously', async () => {
    const c = new SidecarConnection();
    await c.connect();
    FakeWS.instances[0].send = () => { throw new Error('send kaboom'); };
    await expect(c.request({ type: 'translate', text: 'x' })).rejects.toThrow('send kaboom');
  });

  it('honors a caller-provided id (for out-of-band cancel correlation)', async () => {
    const c = new SidecarConnection();
    await c.connect();
    const p = c.request({ type: 'tts_generate', text: 'x' }, { id: 4242 });
    await tick();
    const ws = FakeWS.instances[0];
    expect(JSON.parse(ws.sent[0]).id).toBe(4242);
    ws.reply({ type: 'result', id: 4242, sampleRate: 24000, generationTimeMs: 5, samples: 0 });
    await expect(p).resolves.toMatchObject({ type: 'result' });
  });
});
