import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SonioxClient } from './SonioxClient';
import { SonioxSessionConfig, ConversationItem } from '../interfaces/IClient';
import { Provider } from '../../types/Provider';
import type { SonioxSttMessage, SonioxSttStreamHandlers, SonioxSttConfig } from './SonioxSttStream';

// --- Mock both wire components; capture instances for driving the client ---
const sttInstances: MockStt[] = [];
class MockStt {
  handlers: SonioxSttStreamHandlers = {};
  config: SonioxSttConfig | null = null;
  sentAudio: Int16Array[] = [];
  ended = false;
  closed = false;
  constructor() { sttInstances.push(this); }
  setHandlers(h: SonioxSttStreamHandlers) { this.handlers = h; }
  connect(config: SonioxSttConfig) { this.config = config; return Promise.resolve(); }
  sendAudio(a: Int16Array) { this.sentAudio.push(a); }
  finalize() {}
  end() { this.ended = true; }
  close() { this.closed = true; }
  isOpen() { return !this.closed; }
  // helper
  emit(msg: SonioxSttMessage) { this.handlers.onMessage?.(msg); }
}

const ttsInstances: MockTts[] = [];
class MockTts {
  handlers: { onAudio?: (a: Int16Array) => void; onError?: (c: string, m: string) => void } = {};
  options: unknown;
  prewarmed: string[] = [];
  sent: Array<{ text: string; language: string }> = [];
  utteranceEnds = 0;
  closed = false;
  static failConnect = false;
  static gate: Promise<void> | null = null; // when set, connect() awaits it (race tests)
  constructor(options: unknown) { this.options = options; ttsInstances.push(this); }
  setHandlers(h: MockTts['handlers']) { this.handlers = h; }
  connect() {
    if (MockTts.failConnect) return Promise.reject(new Error('boom'));
    return MockTts.gate ? MockTts.gate.then(() => undefined) : Promise.resolve();
  }
  prewarm(lang: string) { this.prewarmed.push(lang); }
  sendText(text: string, language: string) { this.sent.push({ text, language }); }
  endUtterance() { this.utteranceEnds += 1; }
  close() { this.closed = true; }
  isOpen() { return !this.closed; }
}

// vi.fn() implementations must be `function`/`class` (not arrow functions) to be
// usable as constructors under vitest v4 — see https://vitest.dev/api/vi#vi-spyon.
vi.mock('./SonioxSttStream', () => ({ SonioxSttStream: vi.fn(function () { return new MockStt(); }) }));
vi.mock('./SonioxTtsStream', () => ({ SonioxTtsStream: vi.fn(function (o: unknown) { return new MockTts(o); }) }));

const BASE_CONFIG: SonioxSessionConfig = {
  provider: 'soniox',
  model: 'stt-rt-v5',
  voice: 'Maya',
  sourceLanguage: 'zh',
  targetLanguage: 'en',
  bidirectional: false,
  textOnly: false,
};

function tok(text: string, extra: object = {}) {
  return { text, ...extra };
}

async function connectedClient(cfg: Partial<SonioxSessionConfig> = {}) {
  const client = new SonioxClient('key');
  const updates: Array<{ item: ConversationItem; delta?: any }> = [];
  client.setEventHandlers({ onConversationUpdated: (d) => updates.push(d) });
  await client.connect({ ...BASE_CONFIG, ...cfg });
  return { client, updates, stt: sttInstances.at(-1)!, tts: ttsInstances.at(-1) };
}

beforeEach(() => {
  sttInstances.length = 0;
  ttsInstances.length = 0;
  MockTts.failConnect = false;
  MockTts.gate = null;
});

describe('SonioxClient connect', () => {
  it('builds a one_way STT config with language hints from a concrete source', async () => {
    const { stt } = await connectedClient();
    expect(stt.config).toMatchObject({
      apiKey: 'key', model: 'stt-rt-v5', sampleRate: 24000,
      languageHints: ['zh'],
      translation: { type: 'one_way', target_language: 'en' },
    });
  });

  it('auto source sends no hints', async () => {
    const { stt } = await connectedClient({ sourceLanguage: 'auto' });
    expect(stt.config!.languageHints).toBeUndefined();
  });

  it('two_way uses source/target as language_a/language_b with both hints', async () => {
    const { stt } = await connectedClient({ bidirectional: true });
    expect(stt.config!.translation).toEqual({ type: 'two_way', language_a: 'zh', language_b: 'en' });
    expect(stt.config!.languageHints).toEqual(['zh', 'en']);
  });

  it('two_way with auto source degrades to one_way', async () => {
    const { stt } = await connectedClient({ bidirectional: true, sourceLanguage: 'auto' });
    expect(stt.config!.translation).toEqual({ type: 'one_way', target_language: 'en' });
  });

  it('textOnly skips TTS entirely; otherwise TTS connects (no prewarm — a config-only stream 408s)', async () => {
    const a = await connectedClient({ textOnly: true });
    expect(a.tts).toBeUndefined();
    const b = await connectedClient({ textOnly: false });
    expect(b.tts).toBeDefined();
    expect(b.tts!.prewarmed).toEqual([]); // prewarm removed — opens the stream on first text instead
  });

  it('TTS connect failure degrades to text-only without failing connect', async () => {
    MockTts.failConnect = true;
    const { client } = await connectedClient();
    expect(client.isConnected()).toBe(true);
  });

  it('TTS eager-connect failure defers (no degraded); a failed reconnect on the first translation degrades once', async () => {
    MockTts.failConnect = true;
    const client = new SonioxClient('key');
    const realtimeEvents: Array<{ event: { type: string } }> = [];
    client.setEventHandlers({ onRealtimeEvent: (e: any) => realtimeEvents.push(e) });
    await client.connect({ ...BASE_CONFIG, sourceLanguage: 'zh', targetLanguage: 'en', textOnly: false });
    // Eager connect failed but that is recoverable — no degradation yet.
    expect(client.isConnected()).toBe(true);
    expect(realtimeEvents.filter((e) => e.event.type === 'tts.degraded')).toHaveLength(0);
    // A translation triggers ensureTts; the reconnect ALSO fails → degraded once.
    sttInstances.at(-1)!.emit({ tokens: [
      { text: 'Hi', is_final: true, translation_status: 'translation', language: 'en', source_language: 'zh' },
    ] });
    await new Promise((r) => setTimeout(r, 0)); // let ensureTts's async connect reject
    expect(realtimeEvents.filter((e) => e.event.type === 'tts.degraded')).toHaveLength(1);
  });
});

describe('SonioxClient token handling', () => {
  it('routes originals to a user item and translations to an assistant item', async () => {
    const { updates, stt } = await connectedClient();
    stt.emit({ tokens: [
      tok('你好', { is_final: true, translation_status: 'original', language: 'zh' }),
      tok('Hello', { is_final: true, translation_status: 'translation', language: 'en' }),
    ] });
    const roles = updates.map((u) => u.item.role);
    expect(roles).toContain('user');
    expect(roles).toContain('assistant');
    const user = updates.find((u) => u.item.role === 'user')!;
    expect(user.item.formatted?.text).toBe('你好');
  });

  it('treats translation_status none as original side', async () => {
    const { updates, stt } = await connectedClient();
    stt.emit({ tokens: [tok('Hey', { is_final: true, translation_status: 'none' })] });
    expect(updates[0].item.role).toBe('user');
  });

  it('partials reset each message; finals accumulate', async () => {
    const { updates, stt } = await connectedClient();
    stt.emit({ tokens: [tok('He', { translation_status: 'original' })] });
    stt.emit({ tokens: [tok('He was', { translation_status: 'original' })] });
    stt.emit({ tokens: [tok('He was', { is_final: true, translation_status: 'original' })] });
    const texts = updates.filter((u) => u.item.role === 'user').map((u) => u.item.formatted?.text);
    expect(texts).toEqual(['He', 'He was', 'He was']);  // not 'HeHe was'
  });

  it('filters <end> and <fin> from display and completes the pair on <end>', async () => {
    const { updates, stt } = await connectedClient();
    stt.emit({ tokens: [
      tok('Hi', { is_final: true, translation_status: 'original' }),
      tok('你好', { is_final: true, translation_status: 'translation' }),
      tok('<end>'),
    ] });
    expect(updates.some((u) => u.item.formatted?.text?.includes('<end>'))).toBe(false);
    const completed = updates.filter((u) => u.item.status === 'completed');
    expect(completed.map((u) => u.item.role).sort()).toEqual(['assistant', 'user']);
    // next utterance opens fresh items
    stt.emit({ tokens: [tok('Again', { is_final: true, translation_status: 'original' })] });
    const userIds = new Set(updates.filter((u) => u.item.role === 'user').map((u) => u.item.id));
    expect(userIds.size).toBe(2);
  });

  it('filters <fin> from display and never feeds it to TTS', async () => {
    const { updates, stt, tts } = await connectedClient();
    stt.emit({ tokens: [
      tok('<fin>'),
      tok('Hi', { is_final: true, translation_status: 'original' }),
    ] });
    expect(updates.some((u) => u.item.formatted?.text?.includes('<fin>'))).toBe(false);
    const user = updates.find((u) => u.item.role === 'user')!;
    expect(user.item.formatted?.text).toBe('Hi');
    expect(tts!.sent).toEqual([]);
  });
});

describe('SonioxClient in-progress items stay listed (MainPanel renders exclusively from getConversationItems)', () => {
  it('a partial-only message lists an in-progress user item with the partial text', async () => {
    const { client, stt } = await connectedClient();
    stt.emit({ tokens: [tok('He', { translation_status: 'original' })] }); // no is_final, no <end>
    const items = client.getConversationItems();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ role: 'user', status: 'in_progress', formatted: { text: 'He' } });
  });

  it('finals without <end> list in-progress user+assistant items with accumulated text', async () => {
    const { client, stt } = await connectedClient();
    stt.emit({ tokens: [
      tok('你好', { is_final: true, translation_status: 'original' }),
      tok('Hello', { is_final: true, translation_status: 'translation' }),
    ] });
    const items = client.getConversationItems();
    expect(items).toHaveLength(2);
    const user = items.find((i) => i.role === 'user')!;
    const assistant = items.find((i) => i.role === 'assistant')!;
    expect(user).toMatchObject({ status: 'in_progress', formatted: { text: '你好' } });
    expect(assistant).toMatchObject({ status: 'in_progress', formatted: { text: 'Hello' } });
  });

  it('<end> flips the same item ids to completed — no duplicates', async () => {
    const { client, stt } = await connectedClient();
    stt.emit({ tokens: [
      tok('你好', { is_final: true, translation_status: 'original' }),
      tok('Hello', { is_final: true, translation_status: 'translation' }),
    ] });
    const beforeEnd = client.getConversationItems();
    expect(beforeEnd).toHaveLength(2);
    const idsBefore = beforeEnd.map((i) => i.id).sort();

    stt.emit({ tokens: [tok('<end>')] });
    const afterEnd = client.getConversationItems();
    expect(afterEnd).toHaveLength(2); // same pair, no duplicates
    expect(afterEnd.map((i) => i.id).sort()).toEqual(idsBefore); // same ids
    expect(afterEnd.every((i) => i.status === 'completed')).toBe(true);
  });

  it('a second utterance mints new ids — the list grows to 4', async () => {
    const { client, stt } = await connectedClient();
    stt.emit({ tokens: [
      tok('你好', { is_final: true, translation_status: 'original' }),
      tok('Hello', { is_final: true, translation_status: 'translation' }),
      tok('<end>'),
    ] });
    const firstIds = new Set(client.getConversationItems().map((i) => i.id));
    expect(firstIds.size).toBe(2);

    stt.emit({ tokens: [
      tok('再见', { is_final: true, translation_status: 'original' }),
      tok('Bye', { is_final: true, translation_status: 'translation' }),
    ] });
    const items = client.getConversationItems();
    expect(items).toHaveLength(4);
    // second utterance's ids are new, not reused from the first
    const secondIds = items.map((i) => i.id).filter((id) => !firstIds.has(id));
    expect(secondIds).toHaveLength(2);
  });
});

describe('SonioxClient TTS feeding', () => {
  it('feeds only final translation tokens, with per-utterance language', async () => {
    const { stt, tts } = await connectedClient();
    stt.emit({ tokens: [
      tok('partial', { translation_status: 'translation', language: 'en' }),   // partial → NOT fed
      tok('Hello', { is_final: true, translation_status: 'translation', language: 'en' }),
      tok('原文', { is_final: true, translation_status: 'original' }),          // original → NOT fed
    ] });
    expect(tts!.sent).toEqual([{ text: 'Hello', language: 'en' }]);
  });

  it('<end> ends the TTS utterance', async () => {
    const { stt, tts } = await connectedClient();
    stt.emit({ tokens: [
      tok('Hello', { is_final: true, translation_status: 'translation', language: 'en' }),
      tok('<end>'),
    ] });
    expect(tts!.utteranceEnds).toBe(1);
  });

  it('emits TTS audio as an audio-only delta on the assistant item', async () => {
    const { updates, stt, tts } = await connectedClient();
    stt.emit({ tokens: [tok('Hello', { is_final: true, translation_status: 'translation', language: 'en' })] });
    const audio = new Int16Array([5, 6]);
    tts!.handlers.onAudio!(audio);
    const audioUpdate = updates.find((u) => u.delta?.audio);
    expect(audioUpdate).toBeDefined();
    expect(audioUpdate!.item.role).toBe('assistant');
    expect(audioUpdate!.delta.text).toBeUndefined();
  });

  it('textOnly session never touches TTS', async () => {
    const { stt } = await connectedClient({ textOnly: true });
    stt.emit({ tokens: [tok('Hello', { is_final: true, translation_status: 'translation' }), tok('<end>')] });
    expect(ttsInstances).toHaveLength(0);
  });

  it('trailing audio after <end> keeps the completed utterance\'s item id, not a fresh one', async () => {
    const { updates, stt, tts } = await connectedClient();
    stt.emit({ tokens: [
      tok('Hello', { is_final: true, translation_status: 'translation', language: 'en' }),
      tok('<end>'),
    ] });
    const completedAssistant = updates.find((u) => u.item.role === 'assistant' && u.item.status === 'completed')!;
    expect(completedAssistant).toBeDefined();
    const completedId = completedAssistant.item.id;

    // Trailing TTS audio for the utterance that was just completed by <end>.
    tts!.handlers.onAudio!(new Int16Array([1]));
    const audioUpdate = updates.find((u) => u.delta?.audio)!;
    expect(audioUpdate).toBeDefined();
    expect(audioUpdate.item.id).toBe(completedId);

    // The next utterance's assistant text item must NOT adopt that audio id.
    stt.emit({ tokens: [tok('Bye', { is_final: true, translation_status: 'translation', language: 'en' })] });
    const nextAssistant = updates.find(
      (u) => u.item.role === 'assistant' && u.item.formatted?.text === 'Bye'
    )!;
    expect(nextAssistant).toBeDefined();
    expect(nextAssistant.item.id).not.toBe(audioUpdate.item.id);
  });
});

describe('SonioxClient keepReplayAudio (per-item audio accumulation for the inline replay button)', () => {
  const asstItem = (client: SonioxClient) =>
    client.getConversationItems().find((i) => i.role === 'assistant');

  it('default (off): assistant item never gets formatted.audio — live-only, replay button stays hidden', async () => {
    const { client, stt, tts } = await connectedClient(); // BASE_CONFIG has no keepReplayAudio
    stt.emit({ tokens: [tok('Hello', { is_final: true, translation_status: 'translation', language: 'en' })] });
    tts!.handlers.onAudio!(new Int16Array([5, 6]));
    tts!.handlers.onAudio!(new Int16Array([7, 8]));
    expect(asstItem(client)!.formatted?.audio).toBeUndefined();
  });

  it('on: TTS audio chunks accumulate into the assistant item\'s formatted.audio (Int16Array, in order)', async () => {
    const { client, stt, tts } = await connectedClient({ keepReplayAudio: true });
    stt.emit({ tokens: [tok('Hello', { is_final: true, translation_status: 'translation', language: 'en' })] });
    tts!.handlers.onAudio!(new Int16Array([5, 6]));
    tts!.handlers.onAudio!(new Int16Array([7, 8]));
    const audio = asstItem(client)!.formatted?.audio as Int16Array;
    expect(audio).toBeInstanceOf(Int16Array);
    expect(Array.from(audio)).toEqual([5, 6, 7, 8]);
  });

  it('on: audio arriving both before and after <end> is all preserved (complete() rebuild must not drop it)', async () => {
    const { client, stt, tts } = await connectedClient({ keepReplayAudio: true });
    stt.emit({ tokens: [tok('Hello', { is_final: true, translation_status: 'translation', language: 'en' })] });
    tts!.handlers.onAudio!(new Int16Array([1, 2])); // before <end>
    stt.emit({ tokens: [tok('<end>')] });           // completes the assistant item
    tts!.handlers.onAudio!(new Int16Array([3, 4])); // trailing, after <end>
    const item = asstItem(client)!;
    expect(item.status).toBe('completed');
    expect(Array.from(item.formatted?.audio as Int16Array)).toEqual([1, 2, 3, 4]);
  });
});

describe('SonioxClient detectedLanguage (bubble badge shows the actual per-item language, not the configured pair)', () => {
  const user = (c: SonioxClient) => c.getConversationItems().find((i) => i.role === 'user');
  const asst = (c: SonioxClient) => c.getConversationItems().find((i) => i.role === 'assistant');

  it('tags each item with the token language — even when it contradicts the configured pair (backwards two-way case)', async () => {
    // Configured zh→en, but the person actually spoke English.
    const { client, stt } = await connectedClient({ sourceLanguage: 'zh', targetLanguage: 'en' });
    stt.emit({ tokens: [
      tok('Hello', { is_final: true, translation_status: 'original', language: 'en' }),     // spoken English
      tok('你好', { is_final: true, translation_status: 'translation', language: 'zh' }),    // translated to Chinese
    ] });
    expect(user(client)!.detectedLanguage).toBe('en');   // NOT the configured 'zh'
    expect(asst(client)!.detectedLanguage).toBe('zh');    // NOT the configured 'en'
  });

  it('carries detectedLanguage through <end> completion', async () => {
    const { client, stt } = await connectedClient();
    stt.emit({ tokens: [
      tok('Hi', { is_final: true, translation_status: 'original', language: 'de' }),
      tok('Hallo', { is_final: true, translation_status: 'translation', language: 'fr' }),
      tok('<end>'),
    ] });
    expect(user(client)!.status).toBe('completed');
    expect(user(client)!.detectedLanguage).toBe('de');
    expect(asst(client)!.detectedLanguage).toBe('fr');
  });

  it('leaves detectedLanguage undefined when the tokens carry no language (badge falls back to configured)', async () => {
    const { client, stt } = await connectedClient();
    stt.emit({ tokens: [tok('x', { is_final: true, translation_status: 'original' })] });
    expect(user(client)!.detectedLanguage).toBeUndefined();
  });
});

describe('SonioxClient disconnect race (a socket that connects after Stop must be discarded)', () => {
  const tick = () => new Promise((r) => setTimeout(r, 0));

  it('a TTS reconnect that finishes after disconnect() is discarded — not installed, speech not flushed (no audio after Stop)', async () => {
    const { client, tts } = await connectedClient(); // tts open
    (tts as any).closed = true; // kill the socket so the next translation reconnects
    let release!: () => void;
    MockTts.gate = new Promise<void>((r) => { release = r; });
    // A translation → feedTts queues text and kicks ensureTts (awaits the gate).
    sttInstances.at(-1)!.emit({ tokens: [tok('Hi', { is_final: true, translation_status: 'translation', language: 'en' })] });
    await tick(); // let ensureTts reach the gated connect await
    await client.disconnect(); // Stop while the reconnect is in flight
    release(); // now let the gated connect resolve
    await tick();
    const reconnected = ttsInstances.at(-1)!;
    expect(reconnected).not.toBe(tts);
    expect(reconnected.closed).toBe(true); // discarded, not installed
    expect(reconnected.sent).toEqual([]);  // buffered speech NOT flushed after Stop
  });

  it('a connect() whose TTS socket opens after disconnect() never announces the session (no session.opened after Stop)', async () => {
    const client = new SonioxClient('key');
    const events: Array<{ event: { type: string } }> = [];
    client.setEventHandlers({ onRealtimeEvent: (e) => events.push(e as any) });
    let release!: () => void;
    MockTts.gate = new Promise<void>((r) => { release = r; });
    const p = client.connect({ ...BASE_CONFIG, textOnly: false });
    await tick(); // STT connects immediately; the TTS connect is gated
    await client.disconnect();
    release();
    await p;
    await tick();
    expect(events.filter((e) => e.event?.type === 'session.opened')).toHaveLength(0);
  });
});

describe('SonioxClient lifecycle and IClient contract', () => {
  it('forwards mic audio to the STT stream', async () => {
    const { client, stt } = await connectedClient();
    const pcm = new Int16Array([1]);
    client.appendInputAudio(pcm);
    expect(stt.sentAudio).toEqual([pcm]);
  });

  it('disconnect ends STT politely and closes TTS', async () => {
    const { client, stt, tts } = await connectedClient();
    await client.disconnect();
    expect(stt.ended).toBe(true);
    expect(stt.closed).toBe(true);
    expect(tts!.closed).toBe(true);
    expect(client.isConnected()).toBe(false);
  });

  it('no-interruption: createResponse/cancelResponse are no-ops and interruption never fires', async () => {
    const interrupted = vi.fn();
    const client = new SonioxClient('key');
    client.setEventHandlers({ onConversationInterrupted: interrupted });
    await client.connect(BASE_CONFIG);
    client.createResponse();
    client.cancelResponse();
    sttInstances.at(-1)!.emit({ tokens: [tok('x', { is_final: true })] });
    expect(interrupted).not.toHaveBeenCalled();
  });

  it('getProvider returns SONIOX', () => {
    expect(new SonioxClient('key').getProvider()).toBe(Provider.SONIOX);
  });

  it('rejects a non-soniox session config', async () => {
    const client = new SonioxClient('key');
    await expect(client.connect({ provider: 'gemini' } as any)).rejects.toThrow(/soniox/i);
  });
});

describe('SonioxClient bidirectional core (Both single-session)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  async function bidiClient() {
    const client = new SonioxClient('key');
    client.setEventHandlers({});
    await client.connect({ ...BASE_CONFIG, bidirectional: true, sourceLanguage: 'zh', targetLanguage: 'en', textOnly: true });
    return { client, stt: sttInstances.at(-1)! };
  }

  it('mixes appendInputAudio (A) and the secondary port (B) into one STT stream', async () => {
    const { client, stt } = await bidiClient();
    const port = (client as any).createSecondaryPort();
    client.appendInputAudio(new Int16Array([100, 100]));
    port.appendInputAudio(new Int16Array([10, 10]));
    vi.advanceTimersByTime(100);
    // one mixed frame reached the STT stream (0.5*100 + 0.5*10 = 55)
    const frame = stt.sentAudio.at(-1)!;
    expect(frame[0]).toBe(55);
  });

  it('non-bidirectional appendInputAudio still goes straight to the STT stream (no mixer)', async () => {
    const client = new SonioxClient('key');
    client.setEventHandlers({});
    await client.connect({ ...BASE_CONFIG, bidirectional: false, textOnly: true });
    const stt = sttInstances.at(-1)!;
    const pcm = new Int16Array([7, 7]);
    client.appendInputAudio(pcm);
    expect(stt.sentAudio).toContain(pcm); // direct, unmixed
  });

  it('secondary port is inert for lifecycle/handlers and delegates identity', async () => {
    const { client } = await bidiClient();
    const port = (client as any).createSecondaryPort();
    const handler = vi.fn();
    port.setEventHandlers({ onConversationUpdated: handler });
    await port.connect({} as any);   // no-op
    await port.disconnect();          // no-op — must NOT tear down the core
    expect(client.isConnected()).toBe(true);
    expect(port.isConnected()).toBe(true);
    expect(port.getProvider()).toBe(Provider.SONIOX);
    expect(port.getConversationItems()).toEqual([]);
  });

  it('disconnect stops the mixer (no frames after teardown)', async () => {
    const { client, stt } = await bidiClient();
    client.appendInputAudio(new Int16Array([100, 100]));
    await client.disconnect();
    const before = stt.sentAudio.length;
    vi.advanceTimersByTime(500);
    expect(stt.sentAudio.length).toBe(before);
  });
});

describe('SonioxClient bidirectional tagging + TTS filter', () => {
  async function bidi(textOnly = true) {
    const client = new SonioxClient('key');
    const updates: any[] = [];
    client.setEventHandlers({ onConversationUpdated: (d) => updates.push(d) });
    await client.connect({ ...BASE_CONFIG, bidirectional: true, sourceLanguage: 'zh', targetLanguage: 'en', textOnly });
    return { client, updates, stt: sttInstances.at(-1)!, tts: ttsInstances.at(-1) };
  }
  const tok = (text: string, extra: object = {}) => ({ text, ...extra });

  it('tags my-language utterance items as source=speaker', async () => {
    const { updates, stt } = await bidi();
    stt.emit({ tokens: [
      tok('你好', { is_final: true, translation_status: 'original', language: 'zh' }),
      tok('Hello', { is_final: true, translation_status: 'translation', language: 'en', source_language: 'zh' }),
    ] });
    expect(updates.every((u) => u.item.source === 'speaker')).toBe(true);
  });

  it('tags other-language utterance items as source=participant', async () => {
    const { updates, stt } = await bidi();
    stt.emit({ tokens: [
      tok('Hello', { is_final: true, translation_status: 'original', language: 'en' }),
      tok('你好', { is_final: true, translation_status: 'translation', language: 'zh', source_language: 'en' }),
    ] });
    expect(updates.some((u) => u.item.source === 'participant')).toBe(true);
    expect(updates.every((u) => u.item.source === 'participant')).toBe(true);
  });

  it('does NOT set source when not bidirectional (MainPanel fallback owns it)', async () => {
    const client = new SonioxClient('key');
    const updates: any[] = [];
    client.setEventHandlers({ onConversationUpdated: (d) => updates.push(d) });
    await client.connect({ ...BASE_CONFIG, bidirectional: false, sourceLanguage: 'zh', targetLanguage: 'en', textOnly: true });
    const stt = sttInstances.at(-1)!;
    stt.emit({ tokens: [tok('你好', { is_final: true, translation_status: 'original', language: 'zh' })] });
    expect(updates.every((u) => u.item.source === undefined)).toBe(true);
  });

  it('feeds TTS only for me→other translations (source_language === sourceLanguage)', async () => {
    const { stt, tts } = await bidi(false);
    stt.emit({ tokens: [
      tok('Hello', { is_final: true, translation_status: 'translation', language: 'en', source_language: 'zh' }), // me→other: SPOKEN
    ] });
    stt.emit({ tokens: [
      tok('你好', { is_final: true, translation_status: 'translation', language: 'zh', source_language: 'en' }),   // other→me: TEXT ONLY
    ] });
    expect(tts!.sent).toEqual([{ text: 'Hello', language: 'en' }]);
  });

  it('trailing TTS audio keeps ITS OWN utterance\'s side even after the next utterance re-latches utteranceSide', async () => {
    const { updates, stt, tts } = await bidi(false);

    // Utterance N: me→other (speaker). feedTts latches audioItemId + audioItemSide='speaker'.
    stt.emit({ tokens: [
      tok('你好', { is_final: true, translation_status: 'original', language: 'zh' }),
      tok('Hello', { is_final: true, translation_status: 'translation', language: 'en', source_language: 'zh' }),
    ] });
    const nAssistant = updates.find((u) => u.item.role === 'assistant')!;
    expect(nAssistant).toBeDefined();
    const nAssistantId = nAssistant.item.id;

    // <end> completes utterance N: utteranceSide resets to null, but audioItemId
    // (and now audioItemSide) deliberately stay stale for N's trailing audio.
    stt.emit({ tokens: [tok('<end>')] });

    // Utterance N+1 starts as the OTHER side: re-latches a NEW utteranceSide
    // ('participant') BEFORE N's trailing TTS audio has finished arriving.
    stt.emit({ tokens: [tok('Hi', { is_final: true, translation_status: 'none', language: 'en' })] });

    // N's trailing TTS audio arrives now — after N+1 already re-latched utteranceSide.
    tts!.handlers.onAudio!(new Int16Array([1, 2]));
    const audioUpdate = updates.find((u) => u.delta?.audio)!;
    expect(audioUpdate).toBeDefined();
    expect(audioUpdate.item.source).toBe('speaker'); // N's side, NOT N+1's 'participant'
    expect(audioUpdate.item.id).toBe(nAssistantId);
  });
});

describe('SonioxClient compact debug logging', () => {
  async function logged() {
    const client = new SonioxClient('key');
    const events: Array<{ event: { type: string; data: any } }> = [];
    client.setEventHandlers({ onRealtimeEvent: (e: any) => events.push(e) });
    await client.connect({ ...BASE_CONFIG, sourceLanguage: 'zh', targetLanguage: 'en', textOnly: true });
    return { events, stt: sttInstances.at(-1)! };
  }
  const sttTypes = (events: any[]) => events.filter((e) => e.event.type.startsWith('stt.')).map((e) => e.event.type);

  it('never emits raw message.received and drops empty keepalive frames', async () => {
    const { events, stt } = await logged();
    const before = events.length;
    stt.emit({ tokens: [], final_audio_proc_ms: 0, total_audio_proc_ms: 1080 });
    expect(events.length).toBe(before); // empty frame → no log at all
    expect(events.some((e) => e.event.type === 'message.received')).toBe(false);
  });

  it('emits one compact stt.delta for a partial frame (no raw token array)', async () => {
    const { events, stt } = await logged();
    stt.emit({ tokens: [
      tok('今', { is_final: false, translation_status: 'original', language: 'zh' }),
      tok('天', { is_final: false, translation_status: 'original', language: 'zh' }),
    ] });
    const delta = events.find((e) => e.event.type === 'stt.delta');
    expect(delta).toBeDefined();
    expect(delta!.event.data).toEqual({ transcript: '今天', translation: '' });
    expect((delta!.event.data as any).tokens).toBeUndefined();
    expect(sttTypes(events)).toEqual(['stt.delta']); // no transcript/translation milestone for a partial
  });

  it('emits stt.transcript / stt.translation milestones on finalization and stt.endpoint on <end>', async () => {
    const { events, stt } = await logged();
    stt.emit({ tokens: [tok('今天不错。', { is_final: true, translation_status: 'original', language: 'zh' })] });
    stt.emit({ tokens: [tok('Nice.', { is_final: true, translation_status: 'translation', language: 'en', source_language: 'zh' })] });
    stt.emit({ tokens: [tok('<end>', { is_final: true, translation_status: 'none' })] });
    expect(events.find((e) => e.event.type === 'stt.transcript')?.event.data).toEqual({ text: '今天不错。' });
    expect(events.find((e) => e.event.type === 'stt.translation')?.event.data).toEqual({ text: 'Nice.' });
    expect(events.some((e) => e.event.type === 'stt.endpoint')).toBe(true);
    expect(events.some((e) => e.event.type === 'stt.delta')).toBe(false); // all-final frames are milestones, not deltas
  });

  it('emits tts.speak (the text sent to TTS) once per utterance, and tts.audio per chunk', async () => {
    const client = new SonioxClient('key');
    const events: Array<{ event: { type: string; data: any } }> = [];
    client.setEventHandlers({ onRealtimeEvent: (e: any) => events.push(e) });
    await client.connect({ ...BASE_CONFIG, sourceLanguage: 'zh', targetLanguage: 'en', textOnly: false });
    const stt = sttInstances.at(-1)!;
    const tts = ttsInstances.at(-1)!;
    // one utterance: a final translation is fed to TTS, then <end> closes it
    stt.emit({ tokens: [tok('Nice.', { is_final: true, translation_status: 'translation', language: 'en', source_language: 'zh' })] });
    stt.emit({ tokens: [tok('<end>', { is_final: true, translation_status: 'none' })] });
    const speak = events.filter((e) => e.event.type === 'tts.speak');
    expect(speak).toHaveLength(1);
    expect(speak[0].event.data).toEqual({ text: 'Nice.' });
    // TTS audio arriving surfaces as tts.audio events (logStore groups them)
    tts.handlers.onAudio!(new Int16Array([1, 2, 3]));
    expect(events.find((e) => e.event.type === 'tts.audio')?.event.data).toEqual({ bytes: 3 });
  });
});

describe('SonioxClient TTS reconnect-on-demand (idle socket dies mid-session)', () => {
  it('reconnects a dead TTS socket on the next translation and flushes buffered text + end in order', async () => {
    const client = new SonioxClient('key');
    client.setEventHandlers({});
    await client.connect({ ...BASE_CONFIG, sourceLanguage: 'zh', targetLanguage: 'en', textOnly: false });
    const stt = sttInstances.at(-1)!;
    const tts0 = ttsInstances.at(-1)!;
    // Simulate the idle TTS socket having been closed by the server (~11s).
    tts0.closed = true;
    expect(tts0.isOpen()).toBe(false);
    // A translation arrives, then <end> — both must land on a fresh stream.
    stt.emit({ tokens: [tok('Hello', { is_final: true, translation_status: 'translation', language: 'en', source_language: 'zh' })] });
    stt.emit({ tokens: [tok('<end>', { is_final: true, translation_status: 'none' })] });
    await new Promise((r) => setTimeout(r, 0)); // let ensureTts connect + flush
    const tts1 = ttsInstances.at(-1)!;
    expect(tts1).not.toBe(tts0);
    expect(tts0.sent).toEqual([]);                              // nothing fed to the dead stream
    expect(tts1.sent).toEqual([{ text: 'Hello', language: 'en' }]); // flushed to the fresh one
    expect(tts1.utteranceEnds).toBe(1);                         // queued end flushed after the text
  });
});
