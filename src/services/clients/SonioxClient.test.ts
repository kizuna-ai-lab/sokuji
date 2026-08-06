import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SonioxClient } from './SonioxClient';
import { SonioxSessionConfig, ConversationItem } from '../interfaces/IClient';
import { Provider } from '../../types/Provider';
import type { SonioxSttMessage, SonioxSttStreamHandlers, SonioxSttConfig } from './SonioxSttStream';
import { SonioxSideTracker } from './SonioxSideTracker';

// --- Mock both wire components; capture instances for driving the client ---
const sttInstances: MockStt[] = [];
class MockStt {
  handlers: SonioxSttStreamHandlers = {};
  config: SonioxSttConfig | null = null;
  sentAudio: Int16Array[] = [];
  ended = false;
  closed = false;
  // Used by the 503-resume "all attempts fail" tests to make every
  // subsequent reconnect attempt's connect() reject.
  static failConnect = false;
  constructor() { sttInstances.push(this); }
  setHandlers(h: SonioxSttStreamHandlers) { this.handlers = h; }
  connect(config: SonioxSttConfig) {
    this.config = config;
    if (MockStt.failConnect) return Promise.reject(new Error('stt connect failed'));
    return Promise.resolve();
  }
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
  handlers: { onAudio?: (a: Int16Array) => void; onError?: (c: string, m: string, hadActiveStream: boolean) => void } = {};
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

// i18n-derived copy is matched loosely (house convention, see the TTS-degraded
// assertions below) — the point is which SENTENCE the user gets, not its exact
// punctuation.
const OUTAGE = /the connection was interrupted/i;
const SEGMENT_ENDED = /this segment has ended/i;

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
  MockStt.failConnect = false;
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

  it('tells the USER spoken output stopped — not just the console — and only once per episode', async () => {
    // A console.error plus a debug event is invisible: subtitles keep scrolling,
    // the user never learns speech died, and a managed session goes on being
    // billed at the speech-to-speech rate.
    MockTts.failConnect = true;
    const client = new SonioxClient('key');
    const errors: Array<{ code: string; message: string }> = [];
    client.setEventHandlers({ onError: (e: any) => errors.push(e) });
    await client.connect({ ...BASE_CONFIG, sourceLanguage: 'zh', targetLanguage: 'en', textOnly: false });
    expect(errors).toHaveLength(0); // the recoverable eager-connect failure says nothing

    const translate = () => sttInstances[sttInstances.length - 1].emit({ tokens: [
      { text: 'Hi', is_final: true, translation_status: 'translation', language: 'en', source_language: 'zh' },
    ] });

    translate();
    await new Promise((r) => setTimeout(r, 0));
    expect(errors).toHaveLength(1);
    // Namespaced so a UI branching on `code` cannot mistake it for an STT error.
    expect(errors[0].code).toMatch(/^tts_/);
    // Says what stopped AND what still works — the user must not read this as
    // "the session is dead".
    expect(errors[0].message).toMatch(/spoken translation has stopped/i);
    expect(errors[0].message).toMatch(/still running/i);

    // Still one report per failure episode: it is a notice, not a per-utterance alarm.
    translate();
    await new Promise((r) => setTimeout(r, 0));
    expect(errors).toHaveLength(1);
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
    // <end>: the two translations are separate utterances (each utterance
    // has one fixed side, per the diarization design's "one utterance = one
    // side" invariant — see #342 design doc); without this the second
    // translation would inherit the first's already-resolved 'speaker' side.
    stt.emit({ tokens: [tok('<end>')] });
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

describe('SonioxClient advanced-feature passthrough (#342)', () => {
  it('maps session-config context to the wire shape and forwards endpoint tuning', async () => {
    const { stt } = await connectedClient({
      context: {
        terms: ['Sokuji'],
        translationTerms: [{ source: 'Kizuna AI', target: '絆愛' }],
      },
      endpointSensitivity: 0.5,
      endpointLatencyAdjustmentLevel: 3,
    });
    expect(stt.config).toMatchObject({
      context: {
        terms: ['Sokuji'],
        translation_terms: [{ source: 'Kizuna AI', target: '絆愛' }],
      },
      endpointSensitivity: 0.5,
      endpointLatencyAdjustmentLevel: 3,
    });
  });

  it('passes background text through to the STT wire context', async () => {
    const { stt } = await connectedClient({ context: { text: 'Quarterly sync' } });
    expect((stt.config as { context?: { text?: string } }).context).toEqual({ text: 'Quarterly sync' });
  });

  it('sends no context when the session config has none', async () => {
    const { stt } = await connectedClient();
    expect((stt.config as { context?: unknown }).context).toBeUndefined();
  });

  it('passes ttsSpeed to the TTS stream options', async () => {
    const { tts } = await connectedClient({ ttsSpeed: 0.8 });
    expect((tts!.options as { speed?: number }).speed).toBe(0.8);
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
    // Simulate the idle TTS socket having been closed by the server (~5.3s, 408).
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

  it('an idle-timeout drop (408, no active stream) followed by a successful reconnect surfaces NOTHING to the user', async () => {
    const client = new SonioxClient('key');
    const errors: Array<{ code: string; message: string }> = [];
    const realtimeEvents: Array<{ event: { type: string } }> = [];
    client.setEventHandlers({
      onError: (e: any) => errors.push(e),
      onRealtimeEvent: (e: any) => realtimeEvents.push(e),
    });
    await client.connect({ ...BASE_CONFIG, sourceLanguage: 'zh', targetLanguage: 'en', textOnly: false });
    const stt = sttInstances.at(-1)!;
    const tts0 = ttsInstances.at(-1)!;

    // Simulate the server's real sequence for an idle-timeout drop: a 408
    // error frame with no active/draining stream, then the follow-up close.
    tts0.handlers.onError?.('408', 'Request timeout', false);
    tts0.closed = true;

    // A translation needs speaking → feedTts finds the socket closed and
    // reconnects on demand; the reconnect succeeds (MockTts.failConnect stays
    // false by default).
    stt.emit({ tokens: [tok('Hello', { is_final: true, translation_status: 'translation', language: 'en', source_language: 'zh' })] });
    await new Promise((r) => setTimeout(r, 0)); // let ensureTts connect + flush

    expect(errors).toHaveLength(0);
    expect(realtimeEvents.filter((e) => e.event.type === 'tts.degraded')).toHaveLength(0);
    expect(ttsInstances.at(-1)).not.toBe(tts0); // reconnect did happen
  });

  it('a drop whose reconnect fails DOES surface the failure', async () => {
    const client = new SonioxClient('key');
    const errors: Array<{ code: string; message: string }> = [];
    client.setEventHandlers({ onError: (e: any) => errors.push(e) });
    await client.connect({ ...BASE_CONFIG, sourceLanguage: 'zh', targetLanguage: 'en', textOnly: false });
    const stt = sttInstances.at(-1)!;
    const tts0 = ttsInstances.at(-1)!;

    // Same idle-timeout drop as above...
    tts0.handlers.onError?.('408', 'Request timeout', false);
    tts0.closed = true;
    // ...but this time the reconnect itself fails (e.g. the 401 a spent/
    // expired key produces).
    MockTts.failConnect = true;

    stt.emit({ tokens: [tok('Hello', { is_final: true, translation_status: 'translation', language: 'en', source_language: 'zh' })] });
    await new Promise((r) => setTimeout(r, 0)); // let ensureTts's connect reject

    expect(errors).toHaveLength(1);
    expect(errors[0].code).toMatch(/^tts_/);
    expect(errors[0].message).toMatch(/spoken translation has stopped/i);
  });
});

describe('SonioxClient diarization attribution (#342)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const FRAME = 2400; // SAMPLE_RATE * 0.1 — one 100 ms mixer frame
  const loud = () => new Int16Array(FRAME).fill(1000);
  const tok = (text: string, extra: object = {}) => ({ text, ...extra });

  async function bidi(textOnly = true) {
    const client = new SonioxClient('key');
    const updates: any[] = [];
    client.setEventHandlers({ onConversationUpdated: (d) => updates.push(d) });
    await client.connect({ ...BASE_CONFIG, bidirectional: true, sourceLanguage: 'zh', targetLanguage: 'en', textOnly });
    return {
      client, updates,
      stt: sttInstances.at(-1)!, tts: ttsInstances.at(-1),
      port: (client as any).createSecondaryPort(),
    };
  }

  it('enables diarization on the wire for bidirectional sessions only', async () => {
    const { stt } = await bidi();
    expect(stt.config!.enableSpeakerDiarization).toBe(true);
    const solo = new SonioxClient('key');
    solo.setEventHandlers({});
    await solo.connect({ ...BASE_CONFIG, bidirectional: false, textOnly: true });
    expect((sttInstances.at(-1)!.config as any).enableSpeakerDiarization).toBeUndefined();
  });

  it('attributes a participant speaking MY language to participant via channel energy (language method would say speaker)', async () => {
    const { updates, stt, port } = await bidi();
    port.appendInputAudio(loud());       // far end (B) speaks during frame 0
    vi.advanceTimersByTime(100);
    stt.emit({ tokens: [tok('你好', {
      is_final: true, translation_status: 'original',
      language: 'zh',                    // == sourceLanguage → language method would say 'speaker'
      speaker: '2', start_ms: 0, end_ms: 100,
    })] });
    expect(updates.at(-1)!.item.source).toBe('participant');
  });

  it('cold start: my own speech in a non-source language is attributed to speaker via energy', async () => {
    const { client, updates, stt } = await bidi();
    client.appendInputAudio(loud());     // mic (A) speaks during frame 0
    vi.advanceTimersByTime(100);
    stt.emit({ tokens: [tok('Hello', {
      is_final: true, translation_status: 'original',
      language: 'en',                    // != sourceLanguage → language method would say 'participant'
      speaker: '1', start_ms: 0, end_ms: 100,
    })] });
    expect(updates.at(-1)!.item.source).toBe('speaker');
  });

  it('an established label takes over when both channels are hot (overlap)', async () => {
    const { client, updates, stt, port } = await bidi();
    // Two clean B-only utterances establish label '2' → participant.
    for (const [start, end] of [[0, 100], [100, 200]] as const) {
      port.appendInputAudio(loud());
      vi.advanceTimersByTime(100);
      stt.emit({ tokens: [tok('好', {
        is_final: true, translation_status: 'original', language: 'zh',
        speaker: '2', start_ms: start, end_ms: end,
      })] });
      stt.emit({ tokens: [tok('<end>')] });
    }
    // Overlap: both channels hot during frame 2 → ambiguous energy.
    client.appendInputAudio(loud());
    port.appendInputAudio(loud());
    vi.advanceTimersByTime(100);
    stt.emit({ tokens: [tok('也好', {
      is_final: true, translation_status: 'original', language: 'zh',
      speaker: '2', start_ms: 200, end_ms: 300,
    })] });
    expect(updates.at(-1)!.item.source).toBe('participant');
  });

  it('falls back to the language method when tokens carry no speaker and no usable timing', async () => {
    const { updates, stt } = await bidi();
    stt.emit({ tokens: [tok('你好', { is_final: true, translation_status: 'original', language: 'zh' })] });
    expect(updates.at(-1)!.item.source).toBe('speaker'); // today's behavior, byte-for-byte
    stt.emit({ tokens: [tok('<end>')] });
    stt.emit({ tokens: [tok('Hello', { is_final: true, translation_status: 'original', language: 'en' })] });
    expect(updates.at(-1)!.item.source).toBe('participant');
  });

  it('TTS gate follows the resolved side: participant translations are not spoken, speaker translations are', async () => {
    const { client, stt, tts, port } = await bidi(false); // textOnly=false → TTS active
    // Participant utterance (B energy, MY language — the gate must NOT rely on language).
    port.appendInputAudio(loud());
    vi.advanceTimersByTime(100);
    stt.emit({ tokens: [
      tok('你好', { is_final: true, translation_status: 'original', language: 'zh', speaker: '2', start_ms: 0, end_ms: 100 }),
      tok('Hello', { is_final: true, translation_status: 'translation', language: 'en', source_language: 'zh', speaker: '2' }),
    ] });
    expect(tts!.sent).toHaveLength(0);
    stt.emit({ tokens: [tok('<end>')] });
    // Speaker utterance (A energy) → translation IS fed.
    client.appendInputAudio(loud());
    vi.advanceTimersByTime(100);
    stt.emit({ tokens: [
      tok('早上好', { is_final: true, translation_status: 'original', language: 'zh', speaker: '1', start_ms: 100, end_ms: 200 }),
      tok('Good morning', { is_final: true, translation_status: 'translation', language: 'en', source_language: 'zh', speaker: '1' }),
    ] });
    expect(tts!.sent.map((s: any) => s.text)).toEqual(['Good morning']);
  });

  it('a new connect on the same client starts with no label memory from the previous session', async () => {
    const { client, stt, port, updates } = await bidi();
    // TWO B-only utterances so label '2' is fully ESTABLISHED (net -2) before
    // the reconnect: a leaked tracker would then answer 'participant' by label
    // and fail the assertion below — one vote alone would leak undetected
    // (unestablished labels fall back to language either way).
    port.appendInputAudio(loud());
    vi.advanceTimersByTime(100);
    stt.emit({ tokens: [tok('好', { is_final: true, translation_status: 'original', language: 'zh', speaker: '2', start_ms: 0, end_ms: 100 })] });
    stt.emit({ tokens: [tok('<end>')] });
    port.appendInputAudio(loud());
    vi.advanceTimersByTime(100);
    stt.emit({ tokens: [tok('再见', { is_final: true, translation_status: 'original', language: 'zh', speaker: '2', start_ms: 100, end_ms: 200 })] });
    await client.disconnect();
    await client.connect({ ...BASE_CONFIG, bidirectional: true, sourceLanguage: 'zh', targetLanguage: 'en', textOnly: true });
    const stt2 = sttInstances.at(-1)!;
    // Same label '2', no timing/energy evidence: must hit the language
    // fallback (zh == source → speaker), not the stale participant memory.
    stt2.emit({ tokens: [tok('好', { is_final: true, translation_status: 'original', language: 'zh', speaker: '2' })] });
    expect(updates.at(-1)!.item.source).toBe('speaker');
  });
});

describe('SonioxClient STT 503 auto-resume (transient service-unavailable, not fatal)', () => {
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it('a 503 error frame + close resumes silently: no error item, no onError/onClose, onReconnected fires, and new audio reaches the fresh stream', async () => {
    const { client, updates } = await connectedClient();
    const stt0 = sttInstances.at(-1)!;
    const errors: any[] = [];
    const closeEvents: any[] = [];
    const reconnected = vi.fn();
    client.setEventHandlers({
      onConversationUpdated: (d) => updates.push(d),
      onError: (e) => errors.push(e),
      onClose: (e) => closeEvents.push(e),
      onReconnected: reconnected,
    });

    stt0.handlers.onError?.('503', 'temporarily unavailable');
    stt0.handlers.onClose?.({ code: 1011, reason: 'service unavailable' });
    await flush(); // let the immediate (0ms) resume attempt settle

    expect(errors).toHaveLength(0);
    expect(closeEvents).toHaveLength(0);
    expect(client.getConversationItems().some((i) => i.type === 'error')).toBe(false);
    expect(reconnected).toHaveBeenCalledTimes(1);

    const stt1 = sttInstances.at(-1)!;
    expect(stt1).not.toBe(stt0);
    expect(client.isConnected()).toBe(true);

    const pcm = new Int16Array([9, 9]);
    client.appendInputAudio(pcm);
    expect(stt1.sentAudio).toEqual([pcm]);
  });

  it('onReconnecting fires synchronously as soon as the post-503 close lands', async () => {
    const { client } = await connectedClient();
    const stt0 = sttInstances.at(-1)!;
    const reconnecting = vi.fn();
    client.setEventHandlers({ onReconnecting: reconnecting });

    stt0.handlers.onError?.('503', 'temporarily unavailable');
    stt0.handlers.onClose?.({ code: 1011, reason: 'service unavailable' });

    expect(reconnecting).toHaveBeenCalledTimes(1);
  });

  it('a 413 error frame is unaffected: generic error item + onError, no resume attempted', async () => {
    const { client, updates } = await connectedClient();
    const stt0 = sttInstances.at(-1)!;
    const errors: any[] = [];
    const closeEvents: any[] = [];
    client.setEventHandlers({
      onConversationUpdated: (d) => updates.push(d),
      onError: (e) => errors.push(e),
      onClose: (e) => closeEvents.push(e),
    });

    stt0.handlers.onError?.('413', 'payload too large');
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe('413');
    expect(client.getConversationItems().some((i) => i.type === 'error')).toBe(true);

    // The close that follows a 413 is a normal close — not swallowed for a resume.
    stt0.handlers.onClose?.({ code: 1000, reason: '' });
    await flush();
    expect(closeEvents).toHaveLength(1);
    expect(sttInstances).toHaveLength(1); // no resume attempt opened a new stream
  });

  it('an utterance interrupted mid-flight is completed on resume; the next utterance mints a fresh item id', async () => {
    const { client, stt } = await connectedClient();
    // Seed mid-utterance state: a final user token with no <end> yet.
    stt.emit({ tokens: [tok('Hel', { is_final: true, translation_status: 'original', language: 'zh' })] });
    const interruptedId = client.getConversationItems().find((i) => i.role === 'user')!.id;
    expect(client.getConversationItems().find((i) => i.id === interruptedId)!.status).toBe('in_progress');

    stt.handlers.onError?.('503', 'temporarily unavailable');
    stt.handlers.onClose?.({ code: 1011, reason: 'service unavailable' });
    await flush();

    const interruptedItem = client.getConversationItems().find((i) => i.id === interruptedId)!;
    expect(interruptedItem.status).toBe('completed');
    expect(interruptedItem.formatted?.text).toBe('Hel');

    const stt1 = sttInstances.at(-1)!;
    expect(stt1).not.toBe(stt);
    stt1.emit({ tokens: [tok('Next', { is_final: true, translation_status: 'original', language: 'zh' })] });
    const nextItem = client.getConversationItems().find((i) => i.role === 'user' && i.id !== interruptedId);
    expect(nextItem).toBeDefined();
    expect(nextItem!.formatted?.text).toBe('Next');
  });

  it('bidirectional: the side tracker is reset on resume (stale labels/timeline must not leak into the new stream)', async () => {
    const resetSpy = vi.spyOn(SonioxSideTracker.prototype, 'reset');
    const client = new SonioxClient('key');
    client.setEventHandlers({});
    await client.connect({ ...BASE_CONFIG, bidirectional: true, sourceLanguage: 'zh', targetLanguage: 'en', textOnly: true });
    const stt0 = sttInstances.at(-1)!;
    resetSpy.mockClear();

    stt0.handlers.onError?.('503', 'temporarily unavailable');
    stt0.handlers.onClose?.({ code: 1011, reason: 'service unavailable' });
    await flush();

    expect(resetSpy).toHaveBeenCalledTimes(1);
    resetSpy.mockRestore();
  });

  it('managed-403 duration cutoff is unaffected by the 503 resume path (cutoff still wins, never resumes)', async () => {
    const client = new SonioxClient('', { managed: { sessionToken: 'tok' } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        sttApiKey: 'stt-key', ttsApiKey: 'tts-key', expiresAt: '2026-07-25T00:01:00Z',
        maxSessionDurationSeconds: 900, budgetMicroUsd: 500_000, rateUsdPerHour: 0.6,
        sku: 'soniox:speech_to_speech', leaseId: 'lease-1', clientReferenceId: 'sokuji1:acct:lease-1',
      }),
    }));
    const errors: any[] = [];
    const closeEvents: any[] = [];
    const reconnecting = vi.fn();
    client.setEventHandlers({
      onError: (e) => errors.push(e),
      onClose: (e) => closeEvents.push(e),
      onReconnecting: reconnecting,
    });
    await client.connect({ ...BASE_CONFIG, textOnly: false });
    const stt0 = sttInstances.at(-1)!;

    stt0.handlers.onError?.('403', 'session duration exceeded');
    stt0.handlers.onClose?.({ code: 1000, reason: '' });
    await flush();

    expect(errors).toHaveLength(0);
    expect(reconnecting).not.toHaveBeenCalled();
    expect(closeEvents).toHaveLength(1);
    expect(closeEvents[0].sonioxDurationCutoff).toBe(true);
    vi.unstubAllGlobals();
  });

  // C1: pendingSttResume503 must not dangle across disconnect() — the
  // "503 is always immediately followed by a close" assumption is only
  // live-verified for the 403 cutoff, not the 503. If the close never
  // came, and the user hits Stop before it does, disconnect() bumps
  // generation and closes the socket itself; the resulting close (which a
  // real WebSocket fires asynchronously, potentially after disconnect()
  // has already returned) must NOT still find the flag set and kick off a
  // resume — that would reconnect a zombie socket after Stop.
  it('C1: a 503 with no close, followed by disconnect(), does not let a later close start a zombie resume', async () => {
    const { client } = await connectedClient();
    const stt0 = sttInstances.at(-1)!;
    const reconnecting = vi.fn();
    client.setEventHandlers({ onReconnecting: reconnecting });

    stt0.handlers.onError?.('503', 'temporarily unavailable'); // no close follows
    await client.disconnect(); // user hits Stop

    // Simulate the underlying WebSocket's close event arriving asynchronously
    // AFTER disconnect() already ran and called stt.close() — this is exactly
    // what a real browser does (onclose fires after ws.close(), not during it).
    stt0.handlers.onClose?.({ code: 1006, reason: 'late close' });
    await flush();

    expect(reconnecting).not.toHaveBeenCalled();
    expect(sttInstances).toHaveLength(1); // no new stream was ever created
    expect(client.isConnected()).toBe(false);
  });

  // I1: managed sessions cannot resume — the backend mints STT temp keys
  // single_use: true, so a same-key reconnect is rejected AFTER onopen and
  // would masquerade as a duration cutoff (pendingDurationCutoff) instead
  // of the outage it actually is. Managed 503s must take the plain error
  // path, exactly like any other managed STT error.
  it('I1: managed mode + 503 takes the generic error path — no resume attempted', async () => {
    const client = new SonioxClient('', { managed: { sessionToken: 'tok' } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        sttApiKey: 'stt-key', ttsApiKey: 'tts-key', expiresAt: '2026-07-25T00:01:00Z',
        maxSessionDurationSeconds: 900, budgetMicroUsd: 500_000, rateUsdPerHour: 0.6,
        sku: 'soniox:speech_to_speech', leaseId: 'lease-1', clientReferenceId: 'sokuji1:acct:lease-1',
      }),
    }));
    const errors: any[] = [];
    const closeEvents: any[] = [];
    const reconnecting = vi.fn();
    client.setEventHandlers({
      onError: (e) => errors.push(e),
      onClose: (e) => closeEvents.push(e),
      onReconnecting: reconnecting,
    });
    await client.connect({ ...BASE_CONFIG, textOnly: false });
    const stt0 = sttInstances.at(-1)!;

    stt0.handlers.onError?.('503', 'capacity exceeded');
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe('503');
    expect(client.getConversationItems().some((i) => i.type === 'error')).toBe(true);

    stt0.handlers.onClose?.({ code: 1000, reason: '' });
    await flush();

    expect(reconnecting).not.toHaveBeenCalled();
    expect(sttInstances).toHaveLength(1); // no resume attempt opened a new stream
    expect(closeEvents).toHaveLength(1);
    expect(closeEvents[0].sonioxDurationCutoff).toBeUndefined(); // a normal close, not misread as a cutoff
    vi.unstubAllGlobals();
  });

  // M1: a 503 that lands before any is_final token leaves an item minted by
  // emitTextUpdate but with nothing for completeItem to complete (userFinal
  // is still ''). It must not be left stuck in_progress.
  it('M1: a partial-only interrupted item (no is_final yet) is completed in place on resume, text untouched', async () => {
    const { client, stt } = await connectedClient();
    stt.emit({ tokens: [tok('Hel', { translation_status: 'original', language: 'zh' })] }); // partial only
    const partialId = client.getConversationItems().find((i) => i.role === 'user')!.id;
    expect(client.getConversationItems().find((i) => i.id === partialId)!.status).toBe('in_progress');

    stt.handlers.onError?.('503', 'temporarily unavailable');
    stt.handlers.onClose?.({ code: 1011, reason: 'service unavailable' });
    await flush();

    const item = client.getConversationItems().find((i) => i.id === partialId)!;
    expect(item.status).toBe('completed');
    expect(item.formatted?.text).toBe('Hel'); // unchanged — partials aren't retained in instance state
  });

  // M2: a per-session cap stops a flapping server from looping forever.
  it('M2: caps resume cycles at 5 per session — the 6th 503 takes the generic error path instead', async () => {
    const { client, updates } = await connectedClient();
    const errors: any[] = [];
    const reconnected = vi.fn();
    client.setEventHandlers({
      onConversationUpdated: (d) => updates.push(d),
      onError: (e) => errors.push(e),
      onReconnected: reconnected,
    });

    for (let cycle = 1; cycle <= 5; cycle++) {
      const current = sttInstances.at(-1)!;
      current.handlers.onError?.('503', `unavailable #${cycle}`);
      current.handlers.onClose?.({ code: 1011, reason: 'service unavailable' });
      await flush();
    }
    expect(reconnected).toHaveBeenCalledTimes(5);
    expect(errors).toHaveLength(0); // all 5 cycles resumed silently

    // 6th 503: cap reached — generic error path, no further resume.
    const lastStt = sttInstances.at(-1)!;
    const countBefore = sttInstances.length;
    lastStt.handlers.onError?.('503', 'unavailable #6');
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe('503');

    lastStt.handlers.onClose?.({ code: 1000, reason: '' });
    await flush();
    expect(sttInstances.length).toBe(countBefore); // no new resume attempt
    expect(reconnected).toHaveBeenCalledTimes(5); // unchanged
  });

  // I2: only the STT stream is replaced on resume — the TTS socket survives
  // untouched, so audio already in flight for the interrupted (now-completed)
  // utterance must keep landing on that SAME item, not a fresh ghost item
  // that would then wrongly anchor the next utterance.
  it('I2: audioItemId/audioItemSide survive the resume — trailing TTS audio still lands on the completed utterance\'s item', async () => {
    const { client, stt, tts } = await connectedClient({ textOnly: false });
    stt.emit({ tokens: [tok('Hello', { is_final: true, translation_status: 'translation', language: 'en', source_language: 'zh' })] });
    const assistantId = client.getConversationItems().find((i) => i.role === 'assistant')!.id;

    stt.handlers.onError?.('503', 'temporarily unavailable');
    stt.handlers.onClose?.({ code: 1011, reason: 'service unavailable' });
    await flush();

    // The TTS socket was never touched by the resume — its audio for the
    // utterance fed before the 503 keeps arriving and must still anchor to
    // the same (now completed) assistant item, not mint a fresh one.
    tts!.handlers.onAudio!(new Int16Array([1, 2]));
    const items = client.getConversationItems();
    expect(items.filter((i) => i.role === 'assistant')).toHaveLength(1);
    expect(items.find((i) => i.role === 'assistant')!.id).toBe(assistantId);
  });

  // The abandon path must END the interrupted utterance's TTS stream just
  // like <end> does: the TTS socket survives the STT swap, and an un-ended
  // utterance stream would absorb the resumed stream's next utterance text
  // into one combined synthesis.
  it('abandoning an interrupted utterance ends its TTS utterance stream', async () => {
    const { stt, tts } = await connectedClient({ textOnly: false });
    stt.emit({ tokens: [tok('Hello', { is_final: true, translation_status: 'translation', language: 'en', source_language: 'zh' })] });
    expect(tts!.utteranceEnds).toBe(0); // no <end> yet — the TTS utterance is open

    stt.handlers.onError?.('503', 'temporarily unavailable');
    stt.handlers.onClose?.({ code: 1011, reason: 'service unavailable' });
    await flush();

    expect(tts!.utteranceEnds).toBe(1); // abandon closed it, exactly as <end> would
  });
});

describe('SonioxClient STT 503 auto-resume: all attempts fail', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.useRealTimers(); MockStt.failConnect = false; });

  it('after 3 failed reconnect attempts (0/1000/3000ms gaps), surfaces the ORIGINAL 503 message and closes the session', async () => {
    const client = new SonioxClient('key');
    const errors: any[] = [];
    const updates: any[] = [];
    const closeEvents: any[] = [];
    const realtimeEvents: Array<{ event: { type: string; data: any } }> = [];
    client.setEventHandlers({
      onConversationUpdated: (d) => updates.push(d),
      onError: (e) => errors.push(e),
      onClose: (e) => closeEvents.push(e),
      onRealtimeEvent: (e: any) => realtimeEvents.push(e),
    });
    await client.connect(BASE_CONFIG);
    const stt0 = sttInstances.at(-1)!;

    MockStt.failConnect = true;
    stt0.handlers.onError?.('503', 'capacity exceeded');
    stt0.handlers.onClose?.({ code: 1011, reason: 'service unavailable' });

    // Advance through all 3 backoff gaps (0ms/1000ms/3000ms) in one go —
    // each subsequent setTimeout is only registered once the prior attempt's
    // rejection has been caught, so a single runAllTimersAsync interleaves
    // timers and microtasks correctly (same pattern as GeminiClient's
    // "3 failed retries" reconnect test).
    await vi.runAllTimersAsync();

    expect(sttInstances).toHaveLength(4); // original + 3 failed resume attempts
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe('503');
    // The ORIGINAL 503 message — not whatever the 3rd attempt's rejection said.
    expect(errors[0].message).toBe('capacity exceeded');
    expect(updates.some((u) => u.item.type === 'error')).toBe(true);
    expect(closeEvents).toHaveLength(1);
    expect(closeEvents[0]).toEqual({ code: 1006, reason: 'stt resume failed' });
    expect(client.isConnected()).toBe(false);
    // M3: the debug timeline must show the session actually ending — the
    // exhausted-retries path bypasses handleSttClose's generic branch
    // entirely, so without an explicit emit nothing would mark it closed.
    expect(realtimeEvents.some((e) => e.event.type === 'session.stt_resume_failed')).toBe(true);
  });

  it('a resume that succeeds on a later attempt does not surface anything and reaches onReconnected', async () => {
    const client = new SonioxClient('key');
    const errors: any[] = [];
    const closeEvents: any[] = [];
    const reconnected = vi.fn();
    client.setEventHandlers({
      onError: (e) => errors.push(e),
      onClose: (e) => closeEvents.push(e),
      onReconnected: reconnected,
    });
    await client.connect(BASE_CONFIG);
    const stt0 = sttInstances.at(-1)!;

    MockStt.failConnect = true;
    stt0.handlers.onError?.('503', 'capacity exceeded');
    stt0.handlers.onClose?.({ code: 1011, reason: 'service unavailable' });

    // Let the first (0ms) attempt fail, then flip to succeeding before the
    // second attempt (after the 1000ms gap) fires.
    await vi.advanceTimersByTimeAsync(0);
    MockStt.failConnect = false;
    await vi.advanceTimersByTimeAsync(1000);

    expect(reconnected).toHaveBeenCalledTimes(1);
    expect(errors).toHaveLength(0);
    expect(closeEvents).toHaveLength(0);
    expect(client.isConnected()).toBe(true);
  });
});

describe('SonioxClient recoverable outages (BYOK)', () => {
  it('408 (no audio for ~20s) reads as a recoverable outage', async () => {
    const { client } = await connectedClient();
    const stt = sttInstances.at(-1)!;

    stt.handlers.onError?.('408', 'Request timeout');

    expect(client.getConversationItems().at(-1)!.formatted?.text).toMatch(OUTAGE);
  });

  it('socket_error reads as a recoverable outage', async () => {
    const { client } = await connectedClient();
    const stt = sttInstances.at(-1)!;

    stt.handlers.onError?.('socket_error', 'Error: network down');

    expect(client.getConversationItems().at(-1)!.formatted?.text).toMatch(OUTAGE);
  });

  it('an error the user can act on keeps the raw wire text', async () => {
    const { client } = await connectedClient();
    const stt = sttInstances.at(-1)!;

    stt.handlers.onError?.('401', 'invalid api key');

    expect(client.getConversationItems().at(-1)!.formatted?.text)
      .toBe('[Soniox 401] invalid api key');
  });
});
