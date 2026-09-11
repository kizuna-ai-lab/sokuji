import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SonioxTtsStream, classifyChunkEnd, TTS_SEGMENT_TIMING } from './SonioxTtsStream';
import { SONIOX_REGIONS, sonioxHosts } from '../../lib/soniox/regions';

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

const OPTS = { apiKey: 'k', voice: 'Adrian', model: 'tts-rt-v2', sampleRate: 24000, region: 'us' as const };

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

/** stream_ids of every stream config sent, in order. */
const opened = (ws: MockWebSocket) => ws.jsonSent().filter((m) => m.model).map((m) => m.stream_id);
/** stream_ids of every text_end sent, in order. */
const ended = (ws: MockWebSocket) => ws.jsonSent().filter((m) => m.text_end === true).map((m) => m.stream_id);

describe('SonioxTtsStream', () => {
  it('rejects connect() when the socket closes before it opens (fail fast, not on timeout)', async () => {
    const t = new SonioxTtsStream(OPTS);
    const p = t.connect();
    MockWebSocket.instances[0].close(); // closed before open()
    await expect(p).rejects.toThrow(/closed before opening/);
  });

  it('lazily opens a stream with full config, then streams text', async () => {
    const { t, ws } = await openTts();
    t.sendText('Hello ', 'en');
    t.sendText('world', 'en');
    const msgs = ws.jsonSent();
    expect(msgs[0]).toMatchObject({
      api_key: 'k', stream_id: 'utt-1-1', model: 'tts-rt-v2', voice: 'Adrian',
      language: 'en', audio_format: 'pcm_s16le', sample_rate: 24000,
      // Only tts-rt-v2 accepts this; a model without silence reduction 400s.
      reduce_silence: true,
    });
    expect(msgs[1]).toEqual({ stream_id: 'utt-1-1', text: 'Hello ', text_end: false });
    expect(msgs[2]).toEqual({ stream_id: 'utt-1-1', text: 'world', text_end: false });
  });

  it('endUtterance closes the active stream with text_end:true', async () => {
    const { t, ws } = await openTts();
    t.sendText('Hi', 'en');
    t.endUtterance();
    expect(ws.jsonSent().at(-1)).toEqual({ stream_id: 'utt-1-1', text: '', text_end: true });
  });

  it('endUtterance without any text is a no-op', async () => {
    const { t, ws } = await openTts();
    t.endUtterance();
    expect(ws.sent).toHaveLength(0);
  });

  it('serializes streams: the next opens only after the previous terminated', async () => {
    const { t, ws } = await openTts();
    t.sendText('one', 'en');
    t.endUtterance();
    t.sendText('two', 'en');       // must be queued — utt-1-1 still draining
    expect(opened(ws)).toEqual(['utt-1-1']);
    ws.message({ stream_id: 'utt-1-1', terminated: true });
    expect(opened(ws)).toEqual(['utt-1-1', 'utt-2-1']);
    expect(ws.jsonSent().at(-1)).toEqual({ stream_id: 'utt-2-1', text: 'two', text_end: false });
  });

  it('decodes base64 audio chunks to Int16Array', async () => {
    const { t, ws } = await openTts();
    const chunks: Int16Array[] = [];
    t.setHandlers({ onAudio: (a) => chunks.push(a) });
    t.sendText('Hi', 'en');
    ws.message({ stream_id: 'utt-1-1', audio: pcmB64() });
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

  it('processes terminated even when the same message also carries an error (queue must not wedge)', async () => {
    const { t, ws } = await openTts();
    const errors: string[] = [];
    t.setHandlers({ onError: (code) => errors.push(code) });
    t.sendText('one', 'en');
    t.endUtterance();
    ws.message({ stream_id: 'utt-1-1', error_code: 500, error_message: 'x', terminated: true });
    t.sendText('two', 'en');
    expect(opened(ws)).toEqual(['utt-1-1', 'utt-2-1']);
    expect(errors).toEqual(['500']);
  });

  it('an error naming the active stream resets state so the next text opens a fresh segment', async () => {
    const { t, ws } = await openTts();
    t.sendText('a', 'en');
    ws.message({ stream_id: 'utt-1-1', error_code: 500, error_message: 'x' });
    t.sendText('b', 'en');
    expect(opened(ws)).toEqual(['utt-1-1', 'utt-1-2']);
  });

  it('fires onError on an unexpected remote close', async () => {
    const { t, ws } = await openTts();
    const errors: string[] = [];
    t.setHandlers({ onError: (code) => errors.push(code) });
    ws.close();
    expect(errors).toEqual(['socket_closed']);
  });

  it('reports hadActiveStream=true on onclose when a stream carrying real text was lost mid-utterance', async () => {
    const { t, ws } = await openTts();
    const calls: unknown[] = [];
    t.setHandlers({ onError: (...args) => calls.push(args) });
    t.sendText('Hi', 'en'); // opens utt-1-1 — a real utterance in flight
    ws.close(); // unexpected remote close, mid-utterance
    expect(calls).toEqual([['socket_closed', 'Soniox TTS socket closed unexpectedly', true, 'connection']]);
  });

  it('reports hadActiveStream=false on onclose when no stream was carrying text', async () => {
    const { t, ws } = await openTts();
    const calls: unknown[] = [];
    t.setHandlers({ onError: (...args) => calls.push(args) });
    ws.close();
    expect(calls).toEqual([['socket_closed', 'Soniox TTS socket closed unexpectedly', false, 'connection']]);
  });

  it('stays silent on an intentional close', async () => {
    const { t, ws } = await openTts();
    const errors: string[] = [];
    t.setHandlers({ onError: (code) => errors.push(code) });
    t.close();
    expect(errors).toHaveLength(0);
    expect(ws.readyState).toBe(MockWebSocket.CLOSED);
  });

  it('drops audio for a stream_id that does not match the active/draining stream, but forwards a matching one', async () => {
    const { t, ws } = await openTts();
    const chunks: Int16Array[] = [];
    t.setHandlers({ onAudio: (a) => chunks.push(a) });
    ws.message({ stream_id: 'ghost', audio: pcmB64() });
    expect(chunks).toHaveLength(0);
    t.sendText('Hi', 'en');
    ws.message({ stream_id: 'utt-1-1', audio: pcmB64() });
    expect(chunks).toHaveLength(1);
  });

  it('includes speed in the stream config when not the default rate', async () => {
    const t = new SonioxTtsStream({ ...OPTS, speed: 0.8 });
    const p = t.connect();
    MockWebSocket.instances.at(-1)!.open();
    await p;
    const ws = MockWebSocket.instances.at(-1)!;
    t.sendText('Hi', 'en');
    expect(ws.jsonSent()[0]).toMatchObject({ stream_id: 'utt-1-1', speed: 0.8 });
  });

  it('omits speed at the default rate (undefined or 1.0)', async () => {
    for (const speed of [undefined, 1.0]) {
      const t = new SonioxTtsStream({ ...OPTS, speed });
      const p = t.connect();
      MockWebSocket.instances.at(-1)!.open();
      await p;
      const ws = MockWebSocket.instances.at(-1)!;
      t.sendText('Hi', 'en');
      expect('speed' in ws.jsonSent()[0]).toBe(false);
    }
  });
});

// tts-rt-v2 kills a stream ~5.2 s after its last text frame, ~10–12 s after it
// opened without audio, or when its audio output rate falls too low — all as a
// 408 (measured live 2026-09-11). keep_alive saves none of them, so every stream
// must stay short: these are the rules that end one.
describe('SonioxTtsStream segmenting', () => {
  it('uses the measured timing: 1.5 s clause wait, 3 s idle cut, 8 s cap', () => {
    expect(TTS_SEGMENT_TIMING).toEqual({ clauseWaitMs: 1500, idleMs: 3000, maxAgeMs: 8000 });
  });

  it('ends the segment as soon as a chunk ends a sentence; the next chunk opens the next segment after terminated', async () => {
    const { t, ws } = await openTts();
    t.sendText('Hello there.', 'en');
    expect(ended(ws)).toEqual(['utt-1-1']);
    t.sendText(' How are you', 'en');
    expect(opened(ws)).toEqual(['utt-1-1']); // queued behind the draining segment
    ws.message({ stream_id: 'utt-1-1', terminated: true });
    expect(opened(ws)).toEqual(['utt-1-1', 'utt-1-2']);
    expect(ws.jsonSent().at(-1)).toEqual({ stream_id: 'utt-1-2', text: ' How are you', text_end: false });
  });

  it('keeps several sentences that arrive in one chunk in one segment', async () => {
    const { t, ws } = await openTts();
    t.sendText('皆さん、おはようございます。本日はありがとうございます。', 'ja');
    expect(opened(ws)).toEqual(['utt-1-1']);
    expect(ended(ws)).toEqual(['utt-1-1']);
  });

  it('starts a new utterance number after endUtterance, even when the last segment already ended', async () => {
    const { t, ws } = await openTts();
    t.sendText('One.', 'en');
    ws.message({ stream_id: 'utt-1-1', terminated: true });
    t.endUtterance(); // nothing left to close on the wire
    expect(ended(ws)).toEqual(['utt-1-1']);
    t.sendText('Two', 'en');
    expect(opened(ws)).toEqual(['utt-1-1', 'utt-2-1']);
  });

  it('clause end: waits 1.5 s, then ends the segment while the server has produced no audio for it', async () => {
    const { t, ws } = await openTts();
    t.sendText('来週は、', 'ja');
    vi.advanceTimersByTime(1499);
    expect(ended(ws)).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(ended(ws)).toEqual(['utt-1-1']);
  });

  it('clause end: new text restarts the 1.5 s wait', async () => {
    const { t, ws } = await openTts();
    t.sendText('来週は、', 'ja');
    vi.advanceTimersByTime(1000);
    t.sendText('予算と、', 'ja');
    vi.advanceTimersByTime(1499);
    expect(ended(ws)).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(ended(ws)).toEqual(['utt-1-1']);
  });

  it('clause end: does not cut a segment the server is already speaking — only the 3 s idle cut applies', async () => {
    const { t, ws } = await openTts();
    t.sendText('来週は、', 'ja');
    ws.message({ stream_id: 'utt-1-1', audio: pcmB64() });
    vi.advanceTimersByTime(1500);
    expect(ended(ws)).toEqual([]);
    vi.advanceTimersByTime(1500);
    expect(ended(ws)).toEqual(['utt-1-1']);
  });

  it('ends the segment after 3 s without new text, whatever the chunk ends with — even while the server speaks', async () => {
    // The 5.2 s text-idle kill applies even while audio is flowing, and it
    // truncates what the server was still saying.
    const { t, ws } = await openTts();
    t.sendText('so what I wanted to say', 'en');
    ws.message({ stream_id: 'utt-1-1', audio: pcmB64() });
    vi.advanceTimersByTime(2999);
    expect(ended(ws)).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(ended(ws)).toEqual(['utt-1-1']);
  });

  it('ends the segment 8 s after its first text even while text keeps arriving', async () => {
    const { t, ws } = await openTts();
    t.sendText('a ', 'en');
    ws.message({ stream_id: 'utt-1-1', audio: pcmB64() });
    for (let i = 0; i < 7; i++) {
      vi.advanceTimersByTime(1000);
      t.sendText('b ', 'en');
    }
    expect(ended(ws)).toEqual([]); // t = 7 s
    vi.advanceTimersByTime(999);
    expect(ended(ws)).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(ended(ws)).toEqual(['utt-1-1']);
  });

  it('counts the 8 s from when the first text arrived, even if it waited in the queue', async () => {
    const { t, ws } = await openTts();
    t.sendText('One.', 'en');         // utt-1-1 ends at once and drains
    t.sendText('two ', 'en');         // t = 0: queued
    vi.advanceTimersByTime(5000);
    ws.message({ stream_id: 'utt-1-1', terminated: true }); // t = 5 s: utt-1-2 opens with 'two '
    expect(opened(ws)).toEqual(['utt-1-1', 'utt-1-2']);
    ws.message({ stream_id: 'utt-1-2', audio: pcmB64() });
    vi.advanceTimersByTime(1000);
    t.sendText('three ', 'en');       // t = 6 s
    vi.advanceTimersByTime(1000);
    t.sendText('four ', 'en');        // t = 7 s
    vi.advanceTimersByTime(999);
    expect(ended(ws)).toEqual(['utt-1-1']);
    vi.advanceTimersByTime(1);        // t = 8 s after 'two ' arrived
    expect(ended(ws)).toEqual(['utt-1-1', 'utt-1-2']);
  });

  it('a digit before a period is ambiguous: a decimal continues the segment, a sentence ends it after the clause wait', async () => {
    const { t, ws } = await openTts();
    t.sendText('It rose 3.', 'en');
    expect(ended(ws)).toEqual([]);
    vi.advanceTimersByTime(300);
    t.sendText('5 percent', 'en');
    expect(ws.jsonSent().at(-1)).toEqual({ stream_id: 'utt-1-1', text: '5 percent', text_end: false });
    t.sendText(' in 2025.', 'en');
    vi.advanceTimersByTime(1500);
    expect(ended(ws)).toEqual(['utt-1-1']);
  });

  it('a language change closes the current segment and opens the next in the new language', async () => {
    const { t, ws } = await openTts();
    t.sendText('Hi', 'en');
    t.sendText('你好', 'zh');
    expect(ended(ws)).toEqual(['utt-1-1']);
    ws.message({ stream_id: 'utt-1-1', terminated: true });
    expect(ws.jsonSent().filter((m) => m.model).at(-1)).toMatchObject({ stream_id: 'utt-1-2', language: 'zh' });
  });

  it('ignores errors about a stream it already dropped (the 400 flood after a kill)', async () => {
    const { t, ws } = await openTts();
    const errors: string[] = [];
    t.setHandlers({ onError: (code) => errors.push(code) });
    t.sendText('Hello', 'en');
    ws.message({ stream_id: 'utt-1-1', error_code: 408, error_message: 'Request timeout' });
    ws.message({ stream_id: 'utt-1-1', terminated: true });
    t.sendText('again', 'en');
    expect(opened(ws)).toEqual(['utt-1-1', 'utt-1-2']);
    // A frame sent to utt-1-1 before the 408 arrived comes back as a 400.
    ws.message({ stream_id: 'utt-1-1', error_code: 400, error_message: 'Stream utt-1-1 not found.' });
    expect(errors).toEqual(['408']);
    t.sendText(' more', 'en');
    expect(ws.jsonSent().at(-1)).toEqual({ stream_id: 'utt-1-2', text: ' more', text_end: false });
  });

  it('tells a stream-level error (socket still up) from a connection-level one', async () => {
    const { t, ws } = await openTts();
    const scopes: string[] = [];
    t.setHandlers({ onError: (_c, _m, _h, scope) => scopes.push(scope) });
    t.sendText('Hi', 'en');
    ws.message({ stream_id: 'utt-1-1', error_code: 408, error_message: 'Request timeout' });
    ws.message({ error_code: 401, error_message: 'Invalid API key' });
    expect(scopes).toEqual(['stream', 'connection']);
  });

  it('sends nothing to a stream after it failed: its timers are cleared', async () => {
    const { t, ws } = await openTts();
    t.sendText('来週は、', 'ja');
    ws.message({ stream_id: 'utt-1-1', error_code: 408, error_message: 'Request timeout' });
    const n = ws.sent.length;
    vi.advanceTimersByTime(10_000);
    expect(ws.sent).toHaveLength(n);
  });

  it('sends nothing after close(): its timers are cleared', async () => {
    const { t, ws } = await openTts();
    t.sendText('hello', 'en');
    t.close();
    const n = ws.sent.length;
    vi.advanceTimersByTime(10_000);
    expect(ws.sent).toHaveLength(n);
  });
});

describe('classifyChunkEnd', () => {
  it.each([
    'Hello.', 'Really?', 'Wow!', 'Well…', 'Well...', 'What?!', 'Hello. ',
    'はい。', '本当？', 'すごい！', '全角．', '半角｡', '「ありがとう。」', '『完了。』', '（終わり。）',
    'He said "yes."', 'She said “no.”', 'Il a dit « oui ! »', '(done.)',
    'هل أنت بخير؟', 'یہ ٹھیک ہے۔', 'यह ठीक है।', 'समाप्त॥', 
    // Greek question mark U+037E (NFC folds it into ';' — hence the escape; ASCII ';' is a clause end).
    'Τι κάνεις\u037E',
    'ተጠናቋል።', 'ပြီးပါပြီ။', 'Ավարտված է\u0589', 'រួចរាល់។',
  ])('%s ends a sentence', (s) => {
    expect(classifyChunkEnd(s)).toBe('sentence');
  });

  it.each([
    'Hello,', '来週は、', '首先，', 'first;', 'note:', '注意：', '以下；',
    'مرحبا،', 'قال؛', 'Τι κάνεις;', 'Ναι\u0387', 'Ναι\u00B7', 'ሰላም፣', 'ပြီး၊',
    'It rose 3.', 'in 2025.', '３．',
  ])('%s ends a clause', (s) => {
    expect(classifyChunkEnd(s)).toBe('clause');
  });

  it.each(['Hello', 'the vendor', 'สวัสดีครับ', '', '   ', '3.5', '¿Qué', '"quoted'])('%s ends neither', (s) => {
    expect(classifyChunkEnd(s)).toBeNull();
  });
});

describe('SonioxTtsStream regional endpoints', () => {
  it.each(SONIOX_REGIONS)('opens the %s tts socket', async (region) => {
    const t = new SonioxTtsStream({ ...OPTS, region });
    const p = t.connect();
    MockWebSocket.instances.at(-1)!.open();
    await p;
    expect(MockWebSocket.instances.at(-1)!.url)
      .toBe(`wss://${sonioxHosts(region).ttsRt}/tts-websocket`);
  });
});
