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
  afterEach(async () => {
    // A failed assertion mid-connect leaves the mock socket neither opened nor
    // closed, which holds the module-level upgrade gate and stalls every later
    // test in the file at the 15 s cap; settle it before restoring globals.
    if (ws.readyState === 0) ws.onclose?.({ code: 1006, reason: 'test teardown' });
    await flush();
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
      // The Live endpoint answers 403 to any upgrade that carries a browser
      // Origin header (verified 2026-09-12 against every origin value); the
      // main process strips it in the same one-shot rule.
      removeHeaders: ['Origin'],
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

  it('a session.closed frame before session.started does not start a reconnect', async () => {
    const client = new OpenAILiveClient('sk-test');
    const onReconnecting = vi.fn();
    const onError = vi.fn();
    client.setEventHandlers({ onReconnecting, onError } as ClientEventHandlers);
    const p = client.connect(baseConfig);
    await flush();
    ws.readyState = 1;
    ws.onopen?.({});
    // The handshake interceptor forwards this to handleServerEvent; the
    // watchdog must ignore it because the session has not started yet.
    ws.onmessage?.({ data: JSON.stringify({ type: 'session.closed', reason: 'expired' }) });
    ws.onmessage?.({ data: JSON.stringify({ type: 'session.started', session: { id: 'live_1', expires_at: 1789000000, status: 'active', model: LIVE_MODEL } }) });
    await p;
    expect(onReconnecting).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect((globalThis as any).WebSocket).toHaveBeenCalledTimes(1);
    expect(client.isConnected()).toBe(true);
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
  afterEach(async () => {
    if (ws.readyState === 0) ws.onclose?.({ code: 1006, reason: 'test teardown' });
    await flush();
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

describe('OpenAILiveClient source segmentation', () => {
  let client: OpenAILiveClient;

  beforeEach(() => {
    vi.useFakeTimers();
    client = new OpenAILiveClient('sk-test');
    client.setEventHandlers({} as ClientEventHandlers);
    (client as any).timelineOriginMs = Date.now();
    (client as any).userSilenceTimeoutMs = 10_000; // keep the wall-clock timer out of these
  });
  afterEach(() => vi.useRealTimers());

  const feed = (event: unknown) => (client as any).handleServerEvent(event);
  const users = () => client.getConversationItems().filter(i => i.role === 'user');

  it('a timeline gap of 600 ms or more ends a source item that already holds 4 s; the leading mark stays with it', () => {
    feed({ type: 'session.input_transcript.delta', delta: '大家', start_ms: 0, end_ms: 2000 });
    feed({ type: 'session.input_transcript.delta', delta: '好', start_ms: 2000, end_ms: 4100 });
    feed({ type: 'session.input_transcript.delta', delta: ',先', start_ms: 4700, end_ms: 5100 });
    feed({ type: 'session.input_transcript.delta', delta: '说', start_ms: 5200, end_ms: 5400 });
    const items = users();
    expect(items.map(i => i.formatted?.transcript)).toEqual(['大家好,', '先说']);
    expect(items[0].status).toBe('completed');
    expect(items[1].status).toBe('in_progress');
  });

  it('a short source item survives an ordinary pause', () => {
    feed({ type: 'session.input_transcript.delta', delta: '为什么呢', start_ms: 0, end_ms: 1000 });
    feed({ type: 'session.input_transcript.delta', delta: '因为在中国呀', start_ms: 1700, end_ms: 3000 });
    feed({ type: 'session.input_transcript.delta', delta: ',众多的运转', start_ms: 3800, end_ms: 4600 });
    expect(users().map(i => i.formatted?.transcript)).toEqual(['为什么呢因为在中国呀,众多的运转']);
  });

  it('a pause of twice the silence setting ends even a short source item', () => {
    (client as any).userSilenceTimeoutMs = 1000;
    feed({ type: 'session.input_transcript.delta', delta: '好', start_ms: 0, end_ms: 1000 });
    feed({ type: 'session.input_transcript.delta', delta: '那么', start_ms: 3100, end_ms: 3500 });
    expect(users().map(i => i.formatted?.transcript)).toEqual(['好', '那么']);
  });

  it('past 8 s of timeline a source item is cut at the next clause mark', () => {
    feed({ type: 'session.input_transcript.delta', delta: '很长的一句', start_ms: 0, end_ms: 8500 });
    feed({ type: 'session.input_transcript.delta', delta: '话,然后', start_ms: 8500, end_ms: 9000 });
    expect(users().map(i => i.formatted?.transcript)).toEqual(['很长的一句话,', '然后']);
  });

  it('the silence timer lets a short source item live through one pause, then ends it', () => {
    (client as any).userSilenceTimeoutMs = 1000;
    feed({ type: 'session.input_transcript.delta', delta: 'hi', start_ms: 0, end_ms: 500 });
    vi.advanceTimersByTime(1001);
    expect(users()[0].status).toBe('in_progress');
    vi.advanceTimersByTime(1000);
    expect(users()[0].status).toBe('completed');
  });

  it('the silence timer ends a source item of 4 s or more on its first firing', () => {
    (client as any).userSilenceTimeoutMs = 1000;
    feed({ type: 'session.input_transcript.delta', delta: 'a long stretch', start_ms: 0, end_ms: 4500 });
    vi.advanceTimersByTime(1001);
    expect(users()[0].status).toBe('completed');
  });

  it('a sentence-final mark on the source side closes the item too, even when it leads the next delta', () => {
    feed({ type: 'session.input_transcript.delta', delta: '预计十月上线', start_ms: 0, end_ms: 900 });
    feed({ type: 'session.input_transcript.delta', delta: '。然后', start_ms: 900, end_ms: 1300 });
    expect(users().map(i => i.formatted?.transcript)).toEqual(['预计十月上线。', '然后']);
  });

  it('a terminal leading the delta after a pause closes the previous item instead of opening one of its own', () => {
    feed({ type: 'session.input_transcript.delta', delta: '大家好', start_ms: 0, end_ms: 800 });
    feed({ type: 'session.input_transcript.delta', delta: '。然后', start_ms: 1600, end_ms: 2000 });
    const items = users();
    expect(items.map(i => i.formatted?.transcript)).toEqual(['大家好。', '然后']);
    expect(items[0].status).toBe('completed');
  });

  it('the remainder after a sentence end opens the new item without its leading space', () => {
    feed({ type: 'session.input_transcript.delta', delta: 'One thing.', start_ms: 0, end_ms: 800 });
    feed({ type: 'session.input_transcript.delta', delta: ' Two', start_ms: 800, end_ms: 1100 });
    expect(users().map(i => i.formatted?.transcript)).toEqual(['One thing.', 'Two']);
  });

  it('a source item with neither pauses nor punctuation is cut once it spans 12 s of timeline', () => {
    feed({ type: 'session.input_transcript.delta', delta: 'a', start_ms: 0, end_ms: 4000 });
    feed({ type: 'session.input_transcript.delta', delta: 'b', start_ms: 4000, end_ms: 11000 });
    feed({ type: 'session.input_transcript.delta', delta: 'c', start_ms: 11000, end_ms: 12100 });
    feed({ type: 'session.input_transcript.delta', delta: 'd', start_ms: 12100, end_ms: 12300 });
    expect(users().map(i => i.formatted?.transcript)).toEqual(['abc', 'd']);
  });

  it('deltas without timeline stamps fall back to the wall-clock silence timer only', () => {
    (client as any).userSilenceTimeoutMs = 1000;
    feed({ type: 'session.input_transcript.delta', delta: 'one' });
    feed({ type: 'session.input_transcript.delta', delta: ' two' });
    expect(users()).toHaveLength(1);
    vi.advanceTimersByTime(1001);
    feed({ type: 'session.input_transcript.delta', delta: 'three' });
    expect(users().map(i => i.formatted?.transcript)).toEqual(['one two', 'three']);
  });
});

describe('OpenAILiveClient sentence segmentation', () => {
  let client: OpenAILiveClient;
  let updates: any[];

  beforeEach(() => {
    vi.useFakeTimers();
    client = new OpenAILiveClient('sk-test');
    updates = [];
    client.setEventHandlers({ onConversationUpdated: (e) => updates.push(e) } as ClientEventHandlers);
    // The session timeline starts now; Live's start_ms/end_ms are relative to it.
    (client as any).timelineOriginMs = Date.now();
  });
  afterEach(() => vi.useRealTimers());

  const feed = (event: unknown) => (client as any).handleServerEvent(event);
  const assistants = () => client.getConversationItems().filter(i => i.role === 'assistant');

  it('a sentence-final delta closes the text of the item; the next delta opens a new item', () => {
    feed({ type: 'session.output_transcript.delta', delta: '皆さん、', start_ms: 500, end_ms: 1000 });
    feed({ type: 'session.output_transcript.delta', delta: 'こんにちは。', start_ms: 1000, end_ms: 2000 });
    feed({ type: 'session.output_transcript.delta', delta: 'まず', start_ms: 2100, end_ms: 2400 });
    const items = assistants();
    expect(items.map(i => i.formatted?.transcript)).toEqual(['皆さん、こんにちは。', 'まず']);
  });

  it('a terminal at the start of the next delta closes the previous sentence and the rest opens a new one', () => {
    feed({ type: 'session.output_transcript.delta', delta: '十月に', start_ms: 0, end_ms: 500 });
    feed({ type: 'session.output_transcript.delta', delta: 'リリース予定です', start_ms: 500, end_ms: 1200 });
    feed({ type: 'session.output_transcript.delta', delta: '。また', start_ms: 1200, end_ms: 1600 });
    feed({ type: 'session.output_transcript.delta', delta: '、料金', start_ms: 1600, end_ms: 2000 });
    expect(assistants().map(i => i.formatted?.transcript)).toEqual(['十月にリリース予定です。', 'また、料金']);
  });

  it('a delta carrying two sentences keeps both in the closed item and starts the remainder fresh', () => {
    feed({ type: 'session.output_transcript.delta', delta: 'A。B。C', start_ms: 0, end_ms: 900 });
    expect(assistants().map(i => i.formatted?.transcript)).toEqual(['A。B。', 'C']);
  });

  it('a period after an abbreviation, an initial or inside a decimal is not a sentence end', () => {
    feed({ type: 'session.output_transcript.delta', delta: 'This team is led by Dr.', start_ms: 0, end_ms: 800 });
    feed({ type: 'session.output_transcript.delta', delta: ' Andrew Piper, e.g.', start_ms: 800, end_ms: 1400 });
    feed({ type: 'session.output_transcript.delta', delta: ' J. Smith, at 3.5 percent.', start_ms: 1400, end_ms: 2200 });
    feed({ type: 'session.output_transcript.delta', delta: ' Next', start_ms: 2300, end_ms: 2500 });
    expect(assistants().map(i => i.formatted?.transcript)).toEqual([
      'This team is led by Dr. Andrew Piper, e.g. J. Smith, at 3.5 percent.',
      'Next',
    ]);
  });

  it('an abbreviation whose period arrives in the next delta is judged on the whole word', () => {
    feed({ type: 'session.output_transcript.delta', delta: 'This team is led by Dr', start_ms: 0, end_ms: 800 });
    feed({ type: 'session.output_transcript.delta', delta: '. Andrew Piper is also', start_ms: 800, end_ms: 1400 });
    expect(assistants().map(i => i.formatted?.transcript)).toEqual(['This team is led by Dr. Andrew Piper is also']);
  });

  it('an ellipsis is a pause, not a sentence end', () => {
    feed({ type: 'session.output_transcript.delta', delta: 'Well...', start_ms: 0, end_ms: 600 });
    feed({ type: 'session.output_transcript.delta', delta: ' I think so.', start_ms: 600, end_ms: 1400 });
    feed({ type: 'session.output_transcript.delta', delta: ' Next', start_ms: 1500, end_ms: 1800 });
    expect(assistants().map(i => i.formatted?.transcript)).toEqual(['Well... I think so.', 'Next']);
  });

  it('a terminal that arrives after its sentence was already closed is dropped, not shown alone', () => {
    (client as any).assistantSilenceTimeoutMs = 1000;
    feed({ type: 'session.output_transcript.delta', delta: 'Hello', start_ms: 0, end_ms: 400 });
    vi.advanceTimersByTime(1001);
    feed({ type: 'session.output_transcript.delta', delta: '. Next', start_ms: 2000, end_ms: 2400 });
    expect(assistants().map(i => i.formatted?.transcript)).toEqual(['Hello', 'Next']);
  });

  it('a translation with no sentence end for 30 s of timeline is cut at the next delta boundary', () => {
    (client as any).assistantSilenceTimeoutMs = 10_000;
    feed({ type: 'session.output_transcript.delta', delta: 'a', start_ms: 0, end_ms: 10000 });
    feed({ type: 'session.output_transcript.delta', delta: 'b', start_ms: 10000, end_ms: 29000 });
    feed({ type: 'session.output_transcript.delta', delta: 'c', start_ms: 29000, end_ms: 30200 });
    feed({ type: 'session.output_transcript.delta', delta: 'd', start_ms: 30200, end_ms: 30400 });
    expect(assistants().map(i => i.formatted?.transcript)).toEqual(['abc', 'd']);
  });

  it('past 20 s of timeline a translation is cut at the next clause mark', () => {
    (client as any).assistantSilenceTimeoutMs = 10_000;
    feed({ type: 'session.output_transcript.delta', delta: 'every level relies on', start_ms: 0, end_ms: 21000 });
    feed({ type: 'session.output_transcript.delta', delta: ' huge resources, and', start_ms: 21000, end_ms: 22000 });
    expect(assistants().map(i => i.formatted?.transcript)).toEqual(['every level relies on huge resources,', 'and']);
  });

  it('a company abbreviation and a lowercase continuation are not sentence ends', () => {
    feed({ type: 'session.output_transcript.delta', delta: 'publisher Nan-I Book Co.', start_ms: 0, end_ms: 800 });
    feed({ type: 'session.output_transcript.delta', delta: ', makes it fun. I said no. then', start_ms: 800, end_ms: 2000 });
    feed({ type: 'session.output_transcript.delta', delta: ' we left.', start_ms: 2000, end_ms: 2400 });
    feed({ type: 'session.output_transcript.delta', delta: ' Next', start_ms: 2500, end_ms: 2700 });
    expect(assistants().map(i => i.formatted?.transcript)).toEqual([
      'publisher Nan-I Book Co., makes it fun.',
      'I said no. then we left.',
      'Next',
    ]);
  });

  it('closing quotes and brackets after the terminal still count as a sentence end', () => {
    feed({ type: 'session.output_transcript.delta', delta: '「はい。」', start_ms: 0, end_ms: 800 });
    feed({ type: 'session.output_transcript.delta', delta: '(Yes!)', start_ms: 900, end_ms: 1500 });
    feed({ type: 'session.output_transcript.delta', delta: 'Then', start_ms: 1600, end_ms: 1900 });
    expect(assistants().map(i => i.formatted?.transcript)).toEqual(['「はい。」', '(Yes!)', 'Then']);
  });

  it('audio keeps attaching to the closed sentence until the timeline passes its end, then moves on', () => {
    // Audio frames keep the silence timer reset in a real session; here none
    // arrive during the wait, so keep that timer out of the picture.
    (client as any).assistantSilenceTimeoutMs = 10_000;
    feed({ type: 'session.output_transcript.delta', delta: 'こんにちは。', start_ms: 0, end_ms: 2000 });
    feed({ type: 'session.output_transcript.delta', delta: 'まず', start_ms: 2100, end_ms: 2400 });
    // Session time is still 0: the first sentence's audio is still arriving.
    feed({ type: 'session.output_audio.delta', delta: VOICED_DELTA });
    let [first, second] = assistants();
    expect(first.status).toBe('in_progress');
    expect(first.formatted?.audioSegments).toHaveLength(1);
    expect(second.formatted?.audioSegments).toBeUndefined();

    // 2000 ms + the 300 ms margin: the first sentence's audio has been delivered.
    vi.advanceTimersByTime(2300);
    [first, second] = assistants();
    expect(first.status).toBe('completed');
    expect(first.formatted?.text).toBe('こんにちは。');
    expect(second.status).toBe('in_progress');

    feed({ type: 'session.output_audio.delta', delta: VOICED_DELTA });
    [first, second] = assistants();
    expect(first.formatted?.audioSegments).toHaveLength(1);
    expect(second.formatted?.audioSegments).toHaveLength(1);
    expect(second.formatted?.audioSegments?.[0].textEnd).toBe(2);
  });

  it('several closed sentences hand their audio over in order', () => {
    (client as any).assistantSilenceTimeoutMs = 10_000;
    feed({ type: 'session.output_transcript.delta', delta: 'A。', start_ms: 0, end_ms: 1000 });
    feed({ type: 'session.output_transcript.delta', delta: 'B。', start_ms: 1000, end_ms: 2000 });
    feed({ type: 'session.output_transcript.delta', delta: 'C', start_ms: 2000, end_ms: 2500 });
    feed({ type: 'session.output_audio.delta', delta: VOICED_DELTA }); // → A
    vi.advanceTimersByTime(1300);                                       // A's audio done
    feed({ type: 'session.output_audio.delta', delta: VOICED_DELTA }); // → B
    vi.advanceTimersByTime(1000);                                       // B's audio done
    feed({ type: 'session.output_audio.delta', delta: VOICED_DELTA }); // → C
    const [a, b, c] = assistants();
    expect([a.status, b.status, c.status]).toEqual(['completed', 'completed', 'in_progress']);
    expect([a, b, c].map(i => i.formatted?.audioSegments?.length)).toEqual([1, 1, 1]);
  });

  it('the assistant silence timer flushes every pending sentence when the model stops', () => {
    (client as any).assistantSilenceTimeoutMs = 1500;
    feed({ type: 'session.output_transcript.delta', delta: 'A。', start_ms: 0, end_ms: 9000 });
    feed({ type: 'session.output_transcript.delta', delta: 'B', start_ms: 9000, end_ms: 9500 });
    vi.advanceTimersByTime(1501);
    const [a, b] = assistants();
    expect([a.status, b.status]).toEqual(['completed', 'completed']);
    expect((client as any).pendingAudioItems).toEqual([]);
  });

  it('without a timeline origin the hand-over happens immediately', () => {
    (client as any).timelineOriginMs = null;
    feed({ type: 'session.output_transcript.delta', delta: 'A。', start_ms: 0, end_ms: 5000 });
    vi.advanceTimersByTime(0);
    expect(assistants()[0].status).toBe('completed');
  });
});

describe('OpenAILiveClient watchdog and reconnect', () => {
  let sockets: ReturnType<typeof makeMockWs>[];
  let originalWebSocket: unknown;
  let handlers: ReturnType<typeof makeHandlers>;

  function makeHandlers() {
    return { reconnecting: vi.fn(), reconnected: vi.fn(), error: vi.fn(), close: vi.fn(), updates: [] as any[], events: [] as any[] };
  }

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
    handlers = makeHandlers();
  });
  afterEach(async () => {
    // A socket left mid-upgrade holds the module-level upgrade gate; settle it
    // so the next test's connect() is not queued behind this one's leftovers.
    for (const ws of sockets) {
      if (ws.readyState === 0) ws.onclose?.({ code: 1006, reason: 'test teardown' });
    }
    await flush();
    vi.useRealTimers();
    (globalThis as any).WebSocket = originalWebSocket;
    delete (window as any).electron;
  });

  /** A client wired to report into `h`, not yet connected. */
  function newClient(h = handlers) {
    const client = new OpenAILiveClient('sk-test');
    client.setEventHandlers({
      onReconnecting: h.reconnecting,
      onReconnected: h.reconnected,
      onError: h.error,
      onClose: h.close,
      onConversationUpdated: (e) => h.updates.push(e),
      onRealtimeEvent: (e) => h.events.push(e),
    } as ClientEventHandlers);
    return client;
  }

  /** Connect a client whose initial socket is `sockets[index]`, reporting into `h`. */
  async function connectedClient(index = 0, h = handlers) {
    const client = newClient(h);
    const p = client.connect(baseConfig);
    await flush();
    completeHandshake(sockets[index]);
    await p;
    return client;
  }

  const ipcTypes = () => ((window as any).electron.invoke as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string);

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

  it('disconnect() during an in-flight reconnect stops it', async () => {
    const client = await connectedClient();
    sockets[0].onclose?.({ code: 1006, reason: '' });
    // The reconnect is still queued at the upgrade gate when Stop is pressed.
    await client.disconnect();
    await flush();
    // When it resumes it sees the new generation: no header registered, no
    // socket opened, nothing reported.
    expect(sockets).toHaveLength(1);
    expect(ipcTypes().filter((t) => t === 'ws-headers-set')).toHaveLength(1);
    expect(handlers.reconnected).not.toHaveBeenCalled();
    expect(client.isConnected()).toBe(false);
    expect(handlers.error).not.toHaveBeenCalled();
    expect(handlers.close).not.toHaveBeenCalled();
  });

  it('a reconnect that fails after disconnect() does not raise the notice', async () => {
    const client = await connectedClient();
    // Connect is already done, so this only affects the reconnect attempt below.
    (window as any).electron.invoke = vi.fn(async () => ({ success: false, error: 'ipc down' }));
    sockets[0].onclose?.({ code: 1006, reason: '' });
    await client.disconnect();
    await flush();
    expect(handlers.error).not.toHaveBeenCalled();
    expect(handlers.close).not.toHaveBeenCalled();
    expect(client.getConversationItems().some(i => i.type === 'error')).toBe(false);
  });

  it('a fresh connect() after a reconnect starts with clean reconnect state', async () => {
    const client = await connectedClient();
    sockets[0].onclose?.({ code: 1006, reason: '' });
    await completeReconnect(1);

    const d = client.disconnect();
    await Promise.resolve();
    sockets[1].onmessage?.({ data: JSON.stringify({ type: 'session.closed', reason: 'close_requested', usage: { seconds: 1 } }) });
    await d;

    handlers.reconnecting.mockClear();
    handlers.reconnected.mockClear();

    const p = client.connect(baseConfig);
    await flush();
    completeHandshake(sockets[2]);
    await p;

    vi.advanceTimersByTime(1_000);
    sockets[2].onclose?.({ code: 1006, reason: '' });
    // Park the reconnect attempt mid-handshake; afterEach settles the socket
    // it opened so its upgrade-gate hold does not outlive this test.
    await flush();
    expect(handlers.reconnecting).toHaveBeenCalledTimes(1);
    expect(handlers.error).not.toHaveBeenCalled();
  });

  it('a stale handshake timer cannot tear down a newer session', async () => {
    const client = await connectedClient();
    sockets[0].onclose?.({ code: 1006, reason: '' });
    await flush();
    // The reconnect has opened sockets[1]; leave its handshake pending, as a
    // black-holed TCP connect would, and let the user press Stop.
    expect(sockets).toHaveLength(2);
    await client.disconnect();
    // Stop settled the pending handshake and closed its socket on the spot.
    expect(sockets[1].close).toHaveBeenCalled();

    const p = client.connect(baseConfig);
    await flush();
    completeHandshake(sockets[2], 'live_new');
    await p;
    expect(client.isConnected()).toBe(true);

    // Before the fix the parked reconnect's 30 s session.start timer fired
    // here and its failure path tore down whatever this.ws was — sockets[2].
    vi.advanceTimersByTime(31_000);
    await flush();
    expect(client.isConnected()).toBe(true);
    expect(sockets[2].close).not.toHaveBeenCalled();
    expect(handlers.error).not.toHaveBeenCalled();
    expect(handlers.close).not.toHaveBeenCalled();
  });

  it('two clients reconnecting at once register and upgrade one after the other', async () => {
    const handlersB = makeHandlers();
    const clientA = await connectedClient();
    const clientB = await connectedClient(1, handlersB);
    const invoke = (window as any).electron.invoke as ReturnType<typeof vi.fn>;
    const headerRegistrations = () => invoke.mock.calls.filter((c: unknown[]) => c[0] === 'ws-headers-set').length;
    expect(headerRegistrations()).toBe(2);

    // One network blip kills both legs' sockets in the same tick.
    sockets[0].onclose?.({ code: 1006, reason: '' });
    sockets[1].onclose?.({ code: 1006, reason: '' });
    await flush();
    // Only the first leg has registered its header and opened a socket; the
    // second is queued on the gate so its registration cannot be consumed by
    // the first leg's upgrade.
    expect(sockets).toHaveLength(3);
    expect(headerRegistrations()).toBe(3);

    // The gate releases on `open`, not on session.started.
    sockets[2].readyState = 1;
    sockets[2].onopen?.({});
    await flush();
    expect(sockets).toHaveLength(4);
    expect(headerRegistrations()).toBe(4);

    sockets[2].onmessage?.({ data: JSON.stringify({ type: 'session.started', session: { id: 'live_a2', expires_at: 1789000000, status: 'active', model: LIVE_MODEL } }) });
    completeHandshake(sockets[3], 'live_b2');
    await flush();
    expect(handlers.reconnected).toHaveBeenCalledTimes(1);
    expect(handlersB.reconnected).toHaveBeenCalledTimes(1);
    expect(handlers.error).not.toHaveBeenCalled();
    expect(handlersB.error).not.toHaveBeenCalled();
    expect(clientA.isConnected()).toBe(true);
    expect(clientB.isConnected()).toBe(true);
  });

  it('late socket callbacks after disconnect() fire no handler', async () => {
    const client = await connectedClient();
    const ws = sockets[0];
    const d = client.disconnect();
    // The server never answers session.close: disconnect() gives up after
    // 5 s and closes the socket itself.
    await vi.advanceTimersByTimeAsync(5000);
    await d;
    expect(ws.close).toHaveBeenCalledTimes(1);
    expect(ws.onerror).toBeNull();
    expect(ws.onclose).toBeNull();
    expect(ws.onmessage).toBeNull();

    // Chrome fails a close handshake the server never answers: error, then close.
    ws.onerror?.({});
    ws.onclose?.({ code: 1006, reason: '' });
    expect(handlers.error).not.toHaveBeenCalled();
    expect(handlers.close).not.toHaveBeenCalled();
    expect(handlers.reconnecting).not.toHaveBeenCalled();
  });

  it("a reconnect superseded at the gate never clears the new session's header", async () => {
    const client = await connectedClient();
    const invoke = (window as any).electron.invoke as ReturnType<typeof vi.fn>;
    // Hold the reconnect inside its header registration: the next
    // ws-headers-set resolves only when this test says so. (The gate was
    // already acquired, so the abort at the gate cannot save this coroutine —
    // this is the path where only the guarded clear can.)
    let resolveStaleRegistration!: (r: { success: boolean }) => void;
    invoke.mockImplementationOnce(() => new Promise((r) => { resolveStaleRegistration = r; }));
    sockets[0].onclose?.({ code: 1006, reason: '' });
    await flush();
    expect(ipcTypes().filter((t) => t === 'ws-headers-set')).toHaveLength(2);
    expect(sockets).toHaveLength(1);

    await client.disconnect();
    const p = client.connect(baseConfig);
    await flush();
    // The new connect is queued on the gate the stale coroutine still holds.
    expect(sockets).toHaveLength(1);

    resolveStaleRegistration({ success: true });
    await flush();
    // The stale coroutine registered and opened sockets[1]; opening it hands
    // the gate to the new session, which registers and opens sockets[2].
    expect(sockets).toHaveLength(2);
    sockets[1].readyState = 1;
    sockets[1].onopen?.({});
    await flush();
    expect(sockets).toHaveLength(3);
    const newSetIdx = ipcTypes().lastIndexOf('ws-headers-set');

    // The stale session.started lands while sockets[2] is still upgrading:
    // before the guard this fired ws-headers-clear and stripped the new rule.
    sockets[1].onmessage?.({ data: JSON.stringify({ type: 'session.started', session: { id: 'live_stale', expires_at: 1, status: 'active', model: LIVE_MODEL } }) });
    await flush();
    expect(ipcTypes().slice(newSetIdx + 1)).not.toContain('ws-headers-clear');
    expect(sockets[1].close).toHaveBeenCalled();
    expect((client as any).sessionId).not.toBe('live_stale');

    completeHandshake(sockets[2], 'live_new');
    await p;
    expect(client.isConnected()).toBe(true);
    expect((client as any).sessionId).toBe('live_new');
    // Exactly one clear after the new registration: the new session's own.
    expect(ipcTypes().slice(newSetIdx + 1)).toEqual(['ws-headers-clear']);
    expect(handlers.error).not.toHaveBeenCalled();
    expect(handlers.reconnected).not.toHaveBeenCalled();
  });

  it('a session.closed before session.started does not poison closedReceived for the session that follows', async () => {
    const client = newClient();
    const p = client.connect(baseConfig);
    await flush();
    sockets[0].readyState = 1;
    sockets[0].onopen?.({});
    sockets[0].onmessage?.({ data: JSON.stringify({ type: 'session.closed', reason: 'expired' }) });
    sockets[0].onmessage?.({ data: JSON.stringify({ type: 'session.started', session: { id: 'live_1', expires_at: 1789000000, status: 'active', model: LIVE_MODEL } }) });
    await p;
    expect(handlers.reconnecting).not.toHaveBeenCalled();

    // The first abnormal close of the started session must still reconnect.
    sockets[0].onclose?.({ code: 1006, reason: '' });
    expect(handlers.reconnecting).toHaveBeenCalledTimes(1);
    await completeReconnect(1);
    expect(handlers.reconnected).toHaveBeenCalledTimes(1);
    expect(handlers.error).not.toHaveBeenCalled();
    expect(client.isConnected()).toBe(true);
  });
});

describe('OpenAILiveClient.clearConversationItems', () => {
  it('forgets the open items, so the next deltas open fresh ones instead of appending to vanished ids', () => {
    vi.useFakeTimers();
    const client = new OpenAILiveClient('sk-test');
    const updates: any[] = [];
    client.setEventHandlers({ onConversationUpdated: (e) => updates.push(e) } as ClientEventHandlers);
    const feed = (event: unknown) => (client as any).handleServerEvent(event);
    feed({ type: 'session.input_transcript.delta', delta: 'hello', start_ms: 0, end_ms: 500 });
    feed({ type: 'session.output_transcript.delta', delta: 'こんにちは', start_ms: 0, end_ms: 800 });
    feed({ type: 'session.output_audio.delta', delta: VOICED_DELTA });
    expect(client.getConversationItems()).toHaveLength(2);

    client.clearConversationItems();
    expect(client.getConversationItems()).toEqual([]);
    updates.length = 0;

    feed({ type: 'session.input_transcript.delta', delta: 'again', start_ms: 600, end_ms: 900 });
    feed({ type: 'session.output_transcript.delta', delta: 'また', start_ms: 900, end_ms: 1200 });
    feed({ type: 'session.output_audio.delta', delta: VOICED_DELTA });
    const items = client.getConversationItems();
    expect(items.map(i => [i.role, i.formatted?.transcript])).toEqual([['user', 'again'], ['assistant', 'また']]);
    expect(items[1].formatted?.audioSegments).toHaveLength(1);
    expect(updates.every(u => u.item !== undefined)).toBe(true);
    // The old timers are gone; the new ones complete the new items, nothing throws.
    vi.advanceTimersByTime(5000);
    expect(client.getConversationItems().map(i => i.status)).toEqual(['completed', 'completed']);
    vi.useRealTimers();
  });
});
