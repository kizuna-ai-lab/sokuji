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

  it('socket errors after the handshake still reach onError', async () => {
    const client = new OpenAILiveClient('sk-test');
    const onError = vi.fn();
    client.setEventHandlers({ onError } as ClientEventHandlers);
    const p = client.connect(baseConfig);
    await flush();
    completeHandshake(ws);
    await p;

    ws.onerror?.({});

    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('a socket close before session.started rejects connect promptly', async () => {
    const client = new OpenAILiveClient('sk-test');
    const p = client.connect(baseConfig);
    await flush();
    ws.readyState = 1;
    ws.onopen?.({});
    ws.onclose?.({ code: 1006, reason: '' });
    await expect(p).rejects.toThrow('closed during session start');
    expect(invoke).toHaveBeenCalledWith('ws-headers-clear', { host: LIVE_HOST });
  });

  it('a failed handshake closes the socket', async () => {
    const client = new OpenAILiveClient('sk-test');
    const p = client.connect(baseConfig);
    await flush();
    ws.readyState = 1;
    ws.onopen?.({});
    ws.onmessage?.({ data: JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'bad instructions' } }) });
    await expect(p).rejects.toThrow('bad instructions');
    expect(ws.close).toHaveBeenCalledTimes(1);
    expect(client.isConnected()).toBe(false);
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

/** Build a base64-encoded PCM16 chunk of `samples` Int16 samples. */
function makePcmDelta(samples: number, value: number): string {
  const bytes = new Uint8Array(samples * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < samples; i++) view.setInt16(i * 2, value, true);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
const SILENT_DELTA = makePcmDelta(2400, 0);
const VOICED_DELTA = makePcmDelta(2400, 1000);

describe('OpenAILiveClient state machine', () => {
  let client: OpenAILiveClient;
  let updates: any[];
  let realtimeEvents: any[];

  beforeEach(() => {
    vi.useFakeTimers();
    client = new OpenAILiveClient('sk-test');
    updates = [];
    realtimeEvents = [];
    client.setEventHandlers({
      onConversationUpdated: (e) => updates.push(e),
      onRealtimeEvent: (e) => realtimeEvents.push(e),
    } as ClientEventHandlers);
  });
  afterEach(() => vi.useRealTimers());

  const feed = (event: unknown) => (client as any).handleServerEvent(event);

  it('creates a user item on the first input transcript delta and appends later deltas', () => {
    feed({ type: 'session.input_transcript.delta', delta: 'Hello', start_ms: 0, end_ms: 400 });
    feed({ type: 'session.input_transcript.delta', delta: ' there', start_ms: 400, end_ms: 800 });
    const items = client.getConversationItems();
    expect(items).toHaveLength(1);
    expect(items[0].role).toBe('user');
    expect(items[0].formatted?.transcript).toBe('Hello there');
    expect(items[0].status).toBe('in_progress');
  });

  it('creates an assistant item on the first output transcript delta, independent of the user item', () => {
    feed({ type: 'session.input_transcript.delta', delta: 'Hello' });
    feed({ type: 'session.output_transcript.delta', delta: 'こんにちは' });
    const items = client.getConversationItems();
    expect(items.map(i => i.role)).toEqual(['user', 'assistant']);
    expect(items[1].formatted?.transcript).toBe('こんにちは');
  });

  it('drops zero-amplitude output audio frames and does not open an assistant item for them', () => {
    feed({ type: 'session.output_audio.delta', delta: SILENT_DELTA });
    expect(client.getConversationItems()).toHaveLength(0);
    expect(realtimeEvents.some(e => e.event.type === 'session.output_audio.delta')).toBe(false);
  });

  it('opens an assistant item from the first voiced frame and emits audio deltas with sequence numbers', () => {
    feed({ type: 'session.output_audio.delta', delta: VOICED_DELTA });
    feed({ type: 'session.output_audio.delta', delta: VOICED_DELTA });
    const items = client.getConversationItems();
    expect(items).toHaveLength(1);
    expect(items[0].role).toBe('assistant');
    const audioUpdates = updates.filter(u => u.delta?.audio);
    expect(audioUpdates.map(u => u.delta.sequenceNumber)).toEqual([1, 2]);
    expect(audioUpdates[0].delta.audio).toBeInstanceOf(Int16Array);
    expect(audioUpdates[0].delta.audio.length).toBe(2400);
  });

  it('records karaoke segments anchored to the transcript length and cumulative audio time', () => {
    feed({ type: 'session.output_transcript.delta', delta: '皆さん' });
    feed({ type: 'session.output_audio.delta', delta: VOICED_DELTA });
    const item = client.getConversationItems()[0];
    expect(item.formatted?.audioSegments).toEqual([{ textEnd: 3, audioEnd: 2400 / 24000 }]);
    expect(item.formatted?.audioTextEnd).toBe(3);
  });

  it('keeps replay audio only when keepReplayAudio is on', async () => {
    (client as any).keepReplayAudio = true;
    feed({ type: 'session.output_audio.delta', delta: VOICED_DELTA });
    feed({ type: 'session.output_audio.delta', delta: VOICED_DELTA });
    vi.advanceTimersByTime(1001);
    const withReplay = client.getConversationItems()[0];
    expect(withReplay.status).toBe('completed');
    expect((withReplay.formatted?.audio as Int16Array).length).toBe(4800);

    client.clearConversationItems();
    (client as any).keepReplayAudio = false;
    (client as any).currentAssistantItemId = null;
    feed({ type: 'session.output_audio.delta', delta: VOICED_DELTA });
    vi.advanceTimersByTime(1001);
    const without = client.getConversationItems()[0];
    expect(without.status).toBe('completed');
    expect(without.formatted?.audio).toBeUndefined();
  });

  it('closes user and assistant items on their own silence timers', () => {
    (client as any).userSilenceTimeoutMs = 1000;
    (client as any).assistantSilenceTimeoutMs = 1500;
    feed({ type: 'session.input_transcript.delta', delta: 'Hello' });
    feed({ type: 'session.output_transcript.delta', delta: 'こんにちは' });
    vi.advanceTimersByTime(1001);
    let items = client.getConversationItems();
    expect(items[0].status).toBe('completed');
    expect(items[1].status).toBe('in_progress');
    vi.advanceTimersByTime(500);
    items = client.getConversationItems();
    expect(items[1].status).toBe('completed');
    expect(items[1].formatted?.text).toBe('こんにちは');
  });

  it('voiced audio keeps the assistant item open past the last transcript delta', () => {
    (client as any).assistantSilenceTimeoutMs = 1000;
    feed({ type: 'session.output_transcript.delta', delta: 'こんにちは' });
    vi.advanceTimersByTime(800);
    feed({ type: 'session.output_audio.delta', delta: VOICED_DELTA });
    vi.advanceTimersByTime(800);
    expect(client.getConversationItems()[0].status).toBe('in_progress');
    vi.advanceTimersByTime(201);
    expect(client.getConversationItems()[0].status).toBe('completed');
  });

  it('a new utterance after the user item closed starts a second user item', () => {
    (client as any).userSilenceTimeoutMs = 1000;
    feed({ type: 'session.input_transcript.delta', delta: 'One' });
    vi.advanceTimersByTime(1001);
    feed({ type: 'session.input_transcript.delta', delta: 'Two' });
    const users = client.getConversationItems().filter(i => i.role === 'user');
    expect(users.map(u => u.formatted?.transcript)).toEqual(['One', 'Two']);
  });

  it('logs delegation and usage events without touching the conversation', () => {
    feed({ type: 'session.delegation.created', delegation: { id: 'item_1', target: 'client', type: 'delegation' }, offset_ms: 100 });
    feed({ type: 'session.usage.updated', usage: { seconds: 15 }, context_window: { usage_ratio: 0.01 } });
    expect(client.getConversationItems()).toHaveLength(0);
    expect(realtimeEvents.map(e => e.event.type)).toEqual(['session.delegation.created', 'session.usage.updated']);
  });

  it('surfaces an error frame as a system item and onError', () => {
    const errors: any[] = [];
    client.setEventHandlers({ onConversationUpdated: (e) => updates.push(e), onError: (e) => errors.push(e) } as ClientEventHandlers);
    feed({ type: 'error', error: { type: 'invalid_request_error', code: 'immutable_field_update', message: 'nope' } });
    expect(updates[updates.length - 1].item.type).toBe('error');
    expect(updates[updates.length - 1].item.formatted.text).toBe('[invalid_request_error] nope');
    expect(errors).toHaveLength(1);
  });
});

describe('OpenAILiveClient watchdog and reconnect', () => {
  let sockets: ReturnType<typeof makeMockWs>[];
  let originalWebSocket: unknown;
  let handlers: { reconnecting: ReturnType<typeof vi.fn>; reconnected: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn>; updates: any[]; events: any[] };

  beforeEach(() => {
    vi.useFakeTimers();
    env.electron = true; env.extension = false;
    originalWebSocket = (globalThis as any).WebSocket;
    sockets = [];
    (globalThis as any).WebSocket = vi.fn(function () {
      const ws = makeMockWs();
      sockets.push(ws);
      return ws;
    });
    (window as any).electron = { invoke: vi.fn(async () => ({ success: true })) };
    handlers = { reconnecting: vi.fn(), reconnected: vi.fn(), error: vi.fn(), close: vi.fn(), updates: [], events: [] };
  });
  afterEach(() => {
    vi.useRealTimers();
    (globalThis as any).WebSocket = originalWebSocket;
    delete (window as any).electron;
  });

  async function connectedClient() {
    const client = new OpenAILiveClient('sk-test');
    client.setEventHandlers({
      onReconnecting: handlers.reconnecting,
      onReconnected: handlers.reconnected,
      onError: handlers.error,
      onClose: handlers.close,
      onConversationUpdated: (e) => handlers.updates.push(e),
      onRealtimeEvent: (e) => handlers.events.push(e),
    } as ClientEventHandlers);
    const p = client.connect(baseConfig);
    await flush();
    completeHandshake(sockets[0]);
    await p;
    return client;
  }

  /** Let the reconnect's async header registration settle and complete the new handshake. */
  async function completeReconnect(index: number) {
    await flush();
    completeHandshake(sockets[index], `live_${index}`);
    await flush();
  }

  it('reconnects once when the socket closes abnormally without session.closed', async () => {
    const client = await connectedClient();
    sockets[0].onclose?.({ code: 1006, reason: '' });
    expect(handlers.reconnecting).toHaveBeenCalledTimes(1);
    await completeReconnect(1);
    expect(sockets).toHaveLength(2);
    expect(handlers.reconnected).toHaveBeenCalledTimes(1);
    expect(client.isConnected()).toBe(true);
    expect(handlers.error).not.toHaveBeenCalled();
    expect(handlers.events.map(e => e.event.type)).toEqual(expect.arrayContaining(['session.connection_lost', 'session.reconnecting', 'session.reconnected']));
  });

  it('treats two frozen usage updates with voiced input in between as a stall', async () => {
    const client = await connectedClient();
    const feed = (event: unknown) => (client as any).handleServerEvent(event);
    feed({ type: 'session.usage.updated', usage: { seconds: 10 } });
    client.appendInputAudio(new Int16Array([1000, -1000]));
    feed({ type: 'session.usage.updated', usage: { seconds: 10 } });
    expect(handlers.reconnecting).toHaveBeenCalledTimes(1);
    await completeReconnect(1);
    expect(handlers.reconnected).toHaveBeenCalledTimes(1);
  });

  it('does not treat advancing usage, or frozen usage without voiced input, as a stall', async () => {
    const client = await connectedClient();
    const feed = (event: unknown) => (client as any).handleServerEvent(event);
    feed({ type: 'session.usage.updated', usage: { seconds: 10 } });
    feed({ type: 'session.usage.updated', usage: { seconds: 10 } });
    feed({ type: 'session.usage.updated', usage: { seconds: 25 } });
    client.appendInputAudio(new Int16Array([1000, -1000]));
    feed({ type: 'session.usage.updated', usage: { seconds: 40 } });
    expect(handlers.reconnecting).not.toHaveBeenCalled();
  });

  it('an unexpected session.closed (expired) also reconnects once', async () => {
    const client = await connectedClient();
    (client as any).handleServerEvent({ type: 'session.closed', reason: 'expired', usage: { seconds: 600 } });
    expect(handlers.reconnecting).toHaveBeenCalledTimes(1);
    await completeReconnect(1);
    expect(handlers.reconnected).toHaveBeenCalledTimes(1);
  });

  it('gives up with the localized notice when the reconnected session dies within 60 s', async () => {
    const client = await connectedClient();
    sockets[0].onclose?.({ code: 1006, reason: '' });
    await completeReconnect(1);
    vi.advanceTimersByTime(30_000);
    sockets[1].onclose?.({ code: 1006, reason: '' });
    await flush();
    expect(sockets).toHaveLength(2);
    const notice = handlers.updates[handlers.updates.length - 1].item;
    expect(notice.role).toBe('system');
    expect(notice.type).toBe('error');
    expect(notice.formatted.text).toBe('mainPanel.openaiLiveConnectionLost');
    expect(client.getConversationItems()).toContain(notice);
    expect(handlers.error).toHaveBeenCalledTimes(1);
    expect(handlers.close).toHaveBeenCalledTimes(1);
    expect(client.isConnected()).toBe(false);
  });

  it('allows a fresh reconnect once the reconnected session has run for 60 s', async () => {
    const client = await connectedClient();
    sockets[0].onclose?.({ code: 1006, reason: '' });
    await completeReconnect(1);
    vi.advanceTimersByTime(60_001);
    sockets[1].onclose?.({ code: 1006, reason: '' });
    await completeReconnect(2);
    expect(sockets).toHaveLength(3);
    expect(handlers.reconnected).toHaveBeenCalledTimes(2);
    expect(handlers.error).not.toHaveBeenCalled();
    expect(client.isConnected()).toBe(true);
  });

  it('gives up when the reconnect itself fails', async () => {
    const client = await connectedClient();
    (window as any).electron.invoke = vi.fn(async () => ({ success: false, error: 'ipc down' }));
    sockets[0].onclose?.({ code: 1006, reason: '' });
    await flush();
    expect(sockets).toHaveLength(1);
    expect(handlers.error).toHaveBeenCalledTimes(1);
    expect(handlers.close).toHaveBeenCalledTimes(1);
    const items = client.getConversationItems();
    expect(items[items.length - 1]?.type).toBe('error');
  });

  it('a close during disconnect() is not an outage', async () => {
    const client = await connectedClient();
    const d = client.disconnect();
    await Promise.resolve();
    sockets[0].onclose?.({ code: 1000, reason: '' });
    await d;
    expect(handlers.reconnecting).not.toHaveBeenCalled();
    expect(handlers.error).not.toHaveBeenCalled();
  });
});
