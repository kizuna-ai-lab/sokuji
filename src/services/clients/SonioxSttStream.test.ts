import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SonioxSttStream, SonioxSttMessage } from './SonioxSttStream';

/** Minimal scripted WebSocket double. Instances register on MockWebSocket.instances. */
class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static OPEN = 1;
  static CLOSED = 3;
  url: string;
  readyState = 0;
  sent: Array<string | Int16Array> = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onclose: ((ev: { code?: number; reason?: string }) => void) | null = null;
  constructor(url: string) { this.url = url; MockWebSocket.instances.push(this); }
  send(data: string | Int16Array) { this.sent.push(data); }
  close() { this.readyState = MockWebSocket.CLOSED; this.onclose?.({ code: 1000 }); }
  // test helpers
  open() { this.readyState = MockWebSocket.OPEN; this.onopen?.(); }
  message(obj: unknown) { this.onmessage?.({ data: JSON.stringify(obj) }); }
}

beforeEach(() => {
  MockWebSocket.instances = [];
  vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket);
  vi.useFakeTimers();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const CONFIG = {
  apiKey: 'k', model: 'stt-rt-v5', sampleRate: 24000,
  translation: { type: 'one_way' as const, target_language: 'en' },
};

async function openStream(config = CONFIG) {
  const s = new SonioxSttStream();
  const p = s.connect(config);
  MockWebSocket.instances[0].open();
  await p;
  return { s, ws: MockWebSocket.instances[0] };
}

describe('SonioxSttStream', () => {
  it('sends explicit raw-PCM config as the first frame', async () => {
    const { ws } = await openStream({ ...CONFIG, languageHints: ['zh'] });
    const first = JSON.parse(ws.sent[0] as string);
    expect(first).toMatchObject({
      api_key: 'k', model: 'stt-rt-v5',
      audio_format: 'pcm_s16le', sample_rate: 24000, num_channels: 1,
      enable_endpoint_detection: true, max_endpoint_delay_ms: 500,
      enable_language_identification: true,
      language_hints: ['zh'],
      translation: { type: 'one_way', target_language: 'en' },
    });
  });

  it('omits language_hints when not provided and supports two_way', async () => {
    const { ws } = await openStream({
      ...CONFIG, translation: { type: 'two_way', language_a: 'zh', language_b: 'en' },
    });
    const first = JSON.parse(ws.sent[0] as string);
    expect(first.language_hints).toBeUndefined();
    expect(first.translation).toEqual({ type: 'two_way', language_a: 'zh', language_b: 'en' });
  });

  it('forwards audio frames as binary and end() as an empty TEXT frame', async () => {
    const { s, ws } = await openStream();
    const pcm = new Int16Array([1, 2, 3]);
    s.sendAudio(pcm);
    expect(ws.sent[1]).toBe(pcm);
    s.end();
    expect(ws.sent[2]).toBe('');
  });

  it('sends finalize and keepalive control messages', async () => {
    const { s, ws } = await openStream();
    s.finalize();
    expect(JSON.parse(ws.sent[1] as string)).toEqual({ type: 'finalize' });
    // keepalive fires automatically after 15 s of no audio
    vi.advanceTimersByTime(15_000);
    expect(JSON.parse(ws.sent[2] as string)).toEqual({ type: 'keepalive' });
  });

  it('does not send keepalive while audio is flowing', async () => {
    const { s, ws } = await openStream();
    for (let i = 0; i < 4; i++) {
      vi.advanceTimersByTime(5_000);
      s.sendAudio(new Int16Array([0]));
    }
    const keepalives = ws.sent.filter(
      (m) => typeof m === 'string' && m.includes('keepalive'));
    expect(keepalives).toHaveLength(0);
  });

  it('routes messages, errors and finished to handlers', async () => {
    const { s, ws } = await openStream();
    const got: SonioxSttMessage[] = [];
    const errors: string[] = [];
    let finished = false;
    s.setHandlers({
      onMessage: (m) => got.push(m),
      onError: (code) => errors.push(code),
      onFinished: () => { finished = true; },
    });
    ws.message({ tokens: [{ text: 'Hi', is_final: true }] });
    ws.message({ error_code: 408, error_message: 'Request timeout.' });
    ws.message({ tokens: [], finished: true });
    expect(got).toHaveLength(2);           // error message NOT passed to onMessage
    expect(errors).toEqual(['408']);
    expect(finished).toBe(true);
  });

  it('close() stops the keepalive timer', async () => {
    const { s, ws } = await openStream();
    s.close();
    vi.advanceTimersByTime(60_000);
    const keepalives = ws.sent.filter(
      (m) => typeof m === 'string' && m.includes('keepalive'));
    expect(keepalives).toHaveLength(0);
  });

  it('connect() rejects when the socket never opens within the timeout', async () => {
    const s = new SonioxSttStream();
    const p = s.connect(CONFIG);
    const rejection = expect(p).rejects.toThrow(/timeout/i);
    vi.advanceTimersByTime(15_000);
    await rejection;
  });

  it('connect() rejects on a pre-open socket error', async () => {
    const s = new SonioxSttStream();
    const p = s.connect(CONFIG);
    const rejection = expect(p).rejects.toThrow();
    MockWebSocket.instances[0].onerror?.(new Error('refused'));
    await rejection;
  });

  it('post-open socket errors route to onError, not a rejection', async () => {
    const { s, ws } = await openStream();
    const errors: string[] = [];
    s.setHandlers({ onError: (code) => errors.push(code) });
    ws.onerror?.(new Error('boom'));
    expect(errors).toEqual(['socket_error']);
  });

  it('remote close routes to onClose with the close code', async () => {
    const { s, ws } = await openStream();
    const closes: Array<{ code?: number; reason?: string }> = [];
    s.setHandlers({ onClose: (e) => closes.push(e) });
    ws.close();
    expect(closes).toEqual([{ code: 1000, reason: undefined }]);
  });
});
