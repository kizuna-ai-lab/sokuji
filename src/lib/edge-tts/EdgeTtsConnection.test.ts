import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EdgeTtsConnection } from './EdgeTtsConnection';

let platform: 'electron' | 'extension' | 'web' = 'web';
vi.mock('../../utils/environment', () => ({
  isElectron: () => platform === 'electron',
  isExtension: () => platform === 'extension',
}));

const NEW_HOST = 'api.msedgeservices.com';
const OLD_HOST = 'speech.platform.bing.com';

/** Electron's one-shot upgrade rules by host, as main's ws-header-rules keeps them. */
let electronRules = new Set<string>();
/** Whether the extension's Edge TTS DNR rules are installed. */
let dnrInstalled = false;

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  url: string;
  host: string;
  binaryType = 'blob';
  sent: string[] = [];
  /** Whether the platform's User-Agent rule was in place when this upgrade went out. */
  hadUserAgentRule: boolean;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string | ArrayBuffer }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  private closed = false;

  constructor(url: string) {
    this.url = url;
    this.host = new URL(url).host;
    if (platform === 'electron') {
      this.hadUserAgentRule = electronRules.delete(this.host);
    } else {
      this.hadUserAgentRule = dnrInstalled;
    }
    FakeWebSocket.instances.push(this);
  }

  send(data: string) { this.sent.push(data); }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.onclose?.({});
  }

  open() { this.onopen?.(); }

  /** A refused handshake, as a browser reports it: error, then close. */
  refuse() {
    this.onerror?.({});
    this.close();
  }

  /** One audio frame, then the end of the turn. */
  speak() {
    const header = new TextEncoder().encode('Path:audio\r\n');
    const frame = new Uint8Array(2 + header.length + 3);
    frame[0] = header.length >> 8;
    frame[1] = header.length & 0xff;
    frame.set(header, 2);
    frame.set([1, 2, 3], 2 + header.length);
    this.onmessage?.({ data: frame.buffer });
    this.onmessage?.({ data: 'X-RequestId:x\r\nPath:turn.end\r\n\r\n{}' });
  }
}

const sockets = () => FakeWebSocket.instances;
const socketCount = (n: number) => vi.waitFor(() => expect(sockets()).toHaveLength(n));

function start() {
  const conn = new EdgeTtsConnection();
  const chunks: Uint8Array[] = [];
  const onDone = vi.fn();
  const onError = vi.fn();
  const run = conn.generate({ text: 'Hello.', voice: 'en-US-AvaNeural' }, (c) => chunks.push(c), onDone, onError);
  return { conn, chunks, onDone, onError, run };
}

beforeEach(() => {
  platform = 'web';
  electronRules = new Set();
  dnrInstalled = false;
  FakeWebSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket);
  (window as unknown as { electron: unknown }).electron = {
    invoke: vi.fn(async (channel: string, args: { host: string }) => {
      if (channel === 'ws-headers-set') electronRules.add(args.host);
      if (channel === 'ws-headers-clear') electronRules.delete(args.host);
      return { success: true };
    }),
  };
  vi.stubGlobal('chrome', {
    runtime: {
      sendMessage: vi.fn((message: { type: string }, reply: (r: { success: boolean }) => void) => {
        if (message.type === 'EDGE_TTS_SET_HEADERS') dnrInstalled = true;
        if (message.type === 'EDGE_TTS_CLEAR_HEADERS') dnrInstalled = false;
        reply({ success: true });
      }),
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as unknown as { electron?: unknown }).electron;
});

describe('EdgeTtsConnection: the synthesis host and its fallback (rany2/edge-tts#490)', () => {
  it('synthesizes on api.msedgeservices.com and makes no second connection when it answers', async () => {
    const { chunks, onDone, onError, run } = start();
    await socketCount(1);
    expect(sockets()[0].host).toBe(NEW_HOST);
    expect(new URL(sockets()[0].url).searchParams.get('Ocp-Apim-Subscription-Key')).toBe('6A5AA1D4EAFF4E9FB37E23D68491D6F4');

    sockets()[0].open();
    sockets()[0].speak();
    await run;

    expect(chunks).toEqual([new Uint8Array([1, 2, 3])]);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    expect(sockets()).toHaveLength(1);
  });

  it('falls back to speech.platform.bing.com when api.msedgeservices.com refuses the handshake', async () => {
    const { chunks, onDone, onError, run } = start();
    await socketCount(1);
    sockets()[0].refuse();

    await socketCount(2);
    expect(sockets()[1].host).toBe(OLD_HOST);
    sockets()[1].open();
    sockets()[1].speak();
    await run;

    expect(chunks).toEqual([new Uint8Array([1, 2, 3])]);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it('reports the connection failure once when both hosts refuse the handshake', async () => {
    const { onDone, onError, run } = start();
    await socketCount(1);
    sockets()[0].refuse();
    await socketCount(2);
    sockets()[1].refuse();

    await expect(run).rejects.toThrow('WebSocket connection to Edge TTS failed');
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith('WebSocket connection to Edge TTS failed');
    expect(onDone).not.toHaveBeenCalled();
    expect(sockets()).toHaveLength(2);
  });

  it('does not fall back once a host has accepted the connection, even if no audio arrives', async () => {
    const { onError, run } = start();
    await socketCount(1);
    sockets()[0].open();
    sockets()[0].close();

    await expect(run).rejects.toThrow('No audio received from Edge TTS');
    expect(onError).toHaveBeenCalledWith('No audio received from Edge TTS');
    expect(sockets()).toHaveLength(1);
  });

  it('tries no other host after dispose() cancels the first handshake', async () => {
    const { conn, onDone, onError, run } = start();
    await socketCount(1);
    conn.dispose();

    await expect(run).resolves.toBeUndefined();
    expect(onDone).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(sockets()).toHaveLength(1);
  });
});

describe("EdgeTtsConnection: the platform's User-Agent rule covers every host it tries", () => {
  it('Electron: each upgrade finds its host rule in place, and none is left armed afterwards', async () => {
    platform = 'electron';
    const { run } = start();
    await socketCount(1);
    sockets()[0].refuse();
    await socketCount(2);
    sockets()[1].open();
    sockets()[1].speak();
    await run;

    expect(sockets().map((s) => [s.host, s.hadUserAgentRule])).toEqual([[NEW_HOST, true], [OLD_HOST, true]]);
    await vi.waitFor(() => expect(electronRules.size).toBe(0));
  });

  it('extension: the DNR rules stay installed across the fallback and are cleared after the last attempt', async () => {
    platform = 'extension';
    const { run } = start();
    await socketCount(1);
    sockets()[0].refuse();
    await socketCount(2);
    sockets()[1].open();
    sockets()[1].speak();
    await run;

    expect(sockets().map((s) => s.hadUserAgentRule)).toEqual([true, true]);
    expect(dnrInstalled).toBe(false);
  });
});
