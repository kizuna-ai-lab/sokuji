import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Environment is mocked per describe block below; default to Electron.
const env = vi.hoisted(() => ({ electron: true, extension: false }));
vi.mock('../../utils/environment', async (orig) => ({
  ...(await orig<typeof import('../../utils/environment')>()),
  isElectron: () => env.electron,
  isExtension: () => env.extension,
}));
vi.mock('../../locales', () => ({ default: { t: (key: string) => key } }));

import { OpenAILiveClient, LIVE_WS_URL, LIVE_HOST, LIVE_MODEL } from './OpenAILiveClient';
import type { OpenAILiveSessionConfig, ClientEventHandlers } from '../interfaces/IClient';

const baseConfig: OpenAILiveSessionConfig = {
  provider: 'openai_live',
  model: LIVE_MODEL,
  voice: 'marin',
  instructions: 'Translate everything into Japanese.',
  targetLanguage: 'ja',
};

function makeMockWs() {
  return {
    readyState: 0,
    send: vi.fn(),
    close: vi.fn(),
    onopen: null as null | ((e: unknown) => void),
    onmessage: null as null | ((e: { data: string }) => void),
    onerror: null as null | ((e: unknown) => void),
    onclose: null as null | ((e: { code: number; reason: string }) => void),
  };
}

/** Let async header registration and the socket construction settle. */
async function flush(turns = 10) {
  for (let i = 0; i < turns; i++) await Promise.resolve();
}

/** Drive the mock through open → session.started so connect() resolves. */
function completeHandshake(ws: ReturnType<typeof makeMockWs>, sessionId = 'live_1') {
  ws.readyState = 1;
  ws.onopen?.({});
  ws.onmessage?.({ data: JSON.stringify({ type: 'session.started', session: { id: sessionId, expires_at: 1789000000, status: 'active', model: LIVE_MODEL } }) });
}

describe('OpenAILiveClient.buildSessionStart', () => {
  it('builds the Live session.start frame with model, instructions, 24 kHz pcm, voice and client delegation', () => {
    const frame = OpenAILiveClient.buildSessionStart(baseConfig, 'start_1');
    expect(frame).toEqual({
      type: 'session.start',
      event_id: 'start_1',
      session: {
        model: 'gpt-live-1',
        instructions: 'Translate everything into Japanese.',
        audio: { format: { type: 'audio/pcm', rate: 24000 }, output: { voice: 'marin' } },
        delegation: { type: 'client' },
      },
    });
  });

  it('falls back to marin when no voice is configured', () => {
    const frame = OpenAILiveClient.buildSessionStart({ ...baseConfig, voice: undefined }, 'start_2');
    expect(frame.session.audio.output.voice).toBe('marin');
  });
});

describe('OpenAILiveClient.isLiveModel', () => {
  it('accepts gpt-live-1 and dated gpt-live- ids, rejects transcribe and realtime ids', () => {
    expect(OpenAILiveClient.isLiveModel('gpt-live-1')).toBe(true);
    expect(OpenAILiveClient.isLiveModel('gpt-live-1-2026-09-10')).toBe(true);
    expect(OpenAILiveClient.isLiveModel('gpt-live-transcribe')).toBe(false);
    expect(OpenAILiveClient.isLiveModel('gpt-realtime-2.1')).toBe(false);
    expect(OpenAILiveClient.isLiveModel('gpt-realtime-translate')).toBe(false);
  });
});

describe('OpenAILiveClient connect (Electron header injection)', () => {
  let ws: ReturnType<typeof makeMockWs>;
  let originalWebSocket: unknown;
  let invoke: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    env.electron = true; env.extension = false;
    originalWebSocket = (globalThis as any).WebSocket;
    ws = makeMockWs();
    (globalThis as any).WebSocket = vi.fn(function () { return ws; });
    invoke = vi.fn(async () => ({ success: true }));
    (window as any).electron = { invoke };
  });
  afterEach(() => {
    (globalThis as any).WebSocket = originalWebSocket;
    delete (window as any).electron;
  });

  it('registers the Authorization header for api.openai.com before opening the socket, then opens the Live URL bare', async () => {
    const client = new OpenAILiveClient('sk-test');
    const p = client.connect(baseConfig);
    await flush();
    expect(invoke).toHaveBeenCalledWith('ws-headers-set', {
      host: LIVE_HOST,
      headers: { Authorization: 'Bearer sk-test' },
    });
    expect(invoke.mock.invocationCallOrder[0]).toBeLessThan(((globalThis as any).WebSocket as any).mock.invocationCallOrder[0]);
    expect((globalThis as any).WebSocket).toHaveBeenCalledWith(LIVE_WS_URL);
    completeHandshake(ws);
    await p;
    expect(client.isConnected()).toBe(true);
  });

  it('sends session.start as the first frame after open and resolves on session.started', async () => {
    const client = new OpenAILiveClient('sk-test');
    const opened = vi.fn();
    client.setEventHandlers({ onOpen: opened } as ClientEventHandlers);
    const p = client.connect(baseConfig);
    await flush();
    completeHandshake(ws, 'live_abc');
    await p;
    const first = JSON.parse(ws.send.mock.calls[0][0]);
    expect(first.type).toBe('session.start');
    expect(first.session.model).toBe('gpt-live-1');
    expect(opened).toHaveBeenCalledTimes(1);
  });

  it('rejects connect and clears the header when the server answers session.start with an error', async () => {
    const client = new OpenAILiveClient('sk-test');
    const p = client.connect(baseConfig);
    await flush();
    ws.readyState = 1;
    ws.onopen?.({});
    ws.onmessage?.({ data: JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'bad instructions' } }) });
    await expect(p).rejects.toThrow('bad instructions');
    expect(invoke).toHaveBeenCalledWith('ws-headers-clear', { host: LIVE_HOST });
  });

  it('throws when header registration fails and never opens a socket', async () => {
    invoke.mockResolvedValueOnce({ success: false, error: 'nope' });
    const client = new OpenAILiveClient('sk-test');
    await expect(client.connect(baseConfig)).rejects.toThrow('Failed to register WS headers: nope');
    expect((globalThis as any).WebSocket).not.toHaveBeenCalled();
  });

  it('appendInputAudio sends base64 session.input_audio.append and logs only voiced frames', async () => {
    const client = new OpenAILiveClient('sk-test');
    const events: any[] = [];
    client.setEventHandlers({ onRealtimeEvent: (e) => events.push(e) } as ClientEventHandlers);
    const p = client.connect(baseConfig);
    await flush();
    completeHandshake(ws);
    await p;
    ws.send.mockClear();
    events.length = 0;

    client.appendInputAudio(new Int16Array([0, 0, 0, 0]));
    client.appendInputAudio(new Int16Array([1000, -1000, 1000, -1000]));

    expect(ws.send).toHaveBeenCalledTimes(2);
    const payload = JSON.parse(ws.send.mock.calls[1][0]);
    expect(payload.type).toBe('session.input_audio.append');
    expect(typeof payload.audio).toBe('string');
    const logged = events.filter(e => e.event.type === 'session.input_audio.append');
    expect(logged).toHaveLength(1);
    expect(logged[0].event.data.rms).toBeGreaterThan(0);
  });

  it('disconnect sends session.close, waits for session.closed, then closes the socket', async () => {
    vi.useFakeTimers();
    try {
      const client = new OpenAILiveClient('sk-test');
      const p = client.connect(baseConfig);
      await flush();
      completeHandshake(ws);
      await p;
      ws.send.mockClear();

      const d = client.disconnect();
      await Promise.resolve();
      expect(JSON.parse(ws.send.mock.calls[0][0])).toEqual({ type: 'session.close' });
      expect(ws.close).not.toHaveBeenCalled();
      ws.onmessage?.({ data: JSON.stringify({ type: 'session.closed', reason: 'close_requested', usage: { seconds: 12 } }) });
      await d;
      expect(ws.close).toHaveBeenCalledTimes(1);
      expect(client.isConnected()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('disconnect gives up waiting for session.closed after 5 s and still closes the socket', async () => {
    vi.useFakeTimers();
    try {
      const client = new OpenAILiveClient('sk-test');
      const events: any[] = [];
      client.setEventHandlers({ onRealtimeEvent: (e) => events.push(e) } as ClientEventHandlers);
      const p = client.connect(baseConfig);
      await flush();
      completeHandshake(ws);
      await p;

      const d = client.disconnect();
      await vi.advanceTimersByTimeAsync(5000);
      await d;
      expect(ws.close).toHaveBeenCalledTimes(1);
      expect(events.some(e => e.event.type === 'session.close_timeout')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('OpenAILiveClient connect (extension DNR header injection)', () => {
  let ws: ReturnType<typeof makeMockWs>;
  let originalWebSocket: unknown;
  let sendMessage: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    env.electron = false; env.extension = true;
    originalWebSocket = (globalThis as any).WebSocket;
    ws = makeMockWs();
    (globalThis as any).WebSocket = vi.fn(function () { return ws; });
    sendMessage = vi.fn((_msg: unknown, cb?: (r: unknown) => void) => cb?.({ success: true }));
    (globalThis as any).chrome = { runtime: { sendMessage, lastError: undefined } };
  });
  afterEach(() => {
    (globalThis as any).WebSocket = originalWebSocket;
    delete (globalThis as any).chrome;
    env.electron = true; env.extension = false;
  });

  it('asks the background for the DNR rule, then clears it once session.started arrives', async () => {
    const client = new OpenAILiveClient('sk-ext');
    const p = client.connect(baseConfig);
    await flush();
    expect(sendMessage.mock.calls[0][0]).toEqual({ type: 'OPENAI_LIVE_SET_HEADERS', apiKey: 'sk-ext' });
    completeHandshake(ws);
    await p;
    expect(sendMessage.mock.calls.map(c => c[0].type)).toEqual(['OPENAI_LIVE_SET_HEADERS', 'OPENAI_LIVE_CLEAR_HEADERS']);
  });
});

describe('OpenAILiveClient connect (web build)', () => {
  it('refuses to connect where no header can be injected', async () => {
    env.electron = false; env.extension = false;
    try {
      const client = new OpenAILiveClient('sk-web');
      await expect(client.connect(baseConfig)).rejects.toThrow('OpenAI Live needs the desktop app or the browser extension');
    } finally {
      env.electron = true;
    }
  });
});
