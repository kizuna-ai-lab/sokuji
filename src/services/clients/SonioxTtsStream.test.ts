import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SonioxTtsStream } from './SonioxTtsStream';

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static OPEN = 1;
  static CLOSED = 3;
  url: string;
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  constructor(url: string) { this.url = url; MockWebSocket.instances.push(this); }
  send(data: string) { this.sent.push(data); }
  close() { this.readyState = MockWebSocket.CLOSED; this.onclose?.({}); }
  open() { this.readyState = MockWebSocket.OPEN; this.onopen?.(); }
  message(obj: unknown) { this.onmessage?.({ data: JSON.stringify(obj) }); }
  jsonSent(): any[] { return this.sent.map((s) => JSON.parse(s)); }
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

const OPTS = { apiKey: 'k', voice: 'Maya', model: 'tts-rt-v1', sampleRate: 24000 };

async function openTts() {
  const t = new SonioxTtsStream(OPTS);
  const p = t.connect();
  MockWebSocket.instances[0].open();
  await p;
  return { t, ws: MockWebSocket.instances[0] };
}

/** base64 of Int16 samples [100, -100] little-endian */
function pcmB64(): string {
  const bytes = new Uint8Array(new Int16Array([100, -100]).buffer);
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin);
}

describe('SonioxTtsStream', () => {
  it('lazily opens a per-utterance stream with full config, then streams text', async () => {
    const { t, ws } = await openTts();
    t.sendText('Hello ', 'en');
    t.sendText('world', 'en');
    const msgs = ws.jsonSent();
    expect(msgs[0]).toMatchObject({
      api_key: 'k', stream_id: 'utt-1', model: 'tts-rt-v1', voice: 'Maya',
      language: 'en', audio_format: 'pcm_s16le', sample_rate: 24000,
    });
    expect(msgs[1]).toEqual({ stream_id: 'utt-1', text: 'Hello ', text_end: false });
    expect(msgs[2]).toEqual({ stream_id: 'utt-1', text: 'world', text_end: false });
  });

  it('endUtterance closes the active stream with text_end:true', async () => {
    const { t, ws } = await openTts();
    t.sendText('Hi', 'en');
    t.endUtterance();
    const last = ws.jsonSent().at(-1);
    expect(last).toEqual({ stream_id: 'utt-1', text: '', text_end: true });
  });

  it('endUtterance without any text is a no-op', async () => {
    const { t, ws } = await openTts();
    t.endUtterance();
    expect(ws.sent).toHaveLength(0);
  });

  it('serializes utterance streams: next opens only after previous terminated', async () => {
    const { t, ws } = await openTts();
    t.sendText('one', 'en');
    t.endUtterance();
    t.sendText('two', 'en');       // must be queued — utt-1 still draining
    let ids = ws.jsonSent().filter((m) => m.model).map((m) => m.stream_id);
    expect(ids).toEqual(['utt-1']);
    ws.message({ stream_id: 'utt-1', terminated: true });
    ids = ws.jsonSent().filter((m) => m.model).map((m) => m.stream_id);
    expect(ids).toEqual(['utt-1', 'utt-2']);
    expect(ws.jsonSent().at(-1)).toEqual({ stream_id: 'utt-2', text: 'two', text_end: false });
  });

  it('reuses a prewarmed stream when the language matches', async () => {
    const { t, ws } = await openTts();
    t.prewarm('en');
    t.sendText('Hi', 'en');
    const msgs = ws.jsonSent();
    expect(msgs[0].stream_id).toBe('prewarm-1');
    expect(msgs[1]).toEqual({ stream_id: 'prewarm-1', text: 'Hi', text_end: false });
  });

  it('discards a prewarmed stream on language mismatch and opens a correct one immediately', async () => {
    const { t, ws } = await openTts();
    t.prewarm('en');
    t.sendText('你好', 'zh');
    const msgs = ws.jsonSent();
    // prewarm-1 closed empty, then utt-1 opened with zh — no wait for terminated
    expect(msgs[1]).toEqual({ stream_id: 'prewarm-1', text: '', text_end: true });
    expect(msgs[2]).toMatchObject({ stream_id: 'utt-1', language: 'zh' });
    expect(msgs[3]).toEqual({ stream_id: 'utt-1', text: '你好', text_end: false });
  });

  it('decodes base64 audio chunks to Int16Array', async () => {
    const { t, ws } = await openTts();
    const chunks: Int16Array[] = [];
    t.setHandlers({ onAudio: (a) => chunks.push(a) });
    t.sendText('Hi', 'en');
    ws.message({ stream_id: 'utt-1', audio: pcmB64() });
    expect(chunks).toHaveLength(1);
    expect(Array.from(chunks[0])).toEqual([100, -100]);
  });

  it('reports wire errors via onError without throwing', async () => {
    const { t, ws } = await openTts();
    const errors: string[] = [];
    t.setHandlers({ onError: (code) => errors.push(code) });
    ws.message({ error_code: 400, error_message: 'bad voice' });
    expect(errors).toEqual(['400']);
  });

  it('sends keep_alive every 20 s', async () => {
    const { ws } = await openTts();
    vi.advanceTimersByTime(20_000);
    expect(ws.jsonSent().at(-1)).toEqual({ keep_alive: true });
  });
});
