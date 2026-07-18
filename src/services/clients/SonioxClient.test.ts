import { describe, it, expect, vi, beforeEach } from 'vitest';
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
  constructor(options: unknown) { this.options = options; ttsInstances.push(this); }
  setHandlers(h: MockTts['handlers']) { this.handlers = h; }
  connect() { return MockTts.failConnect ? Promise.reject(new Error('boom')) : Promise.resolve(); }
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
  twoWayTranslation: false,
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
    const { stt } = await connectedClient({ twoWayTranslation: true });
    expect(stt.config!.translation).toEqual({ type: 'two_way', language_a: 'zh', language_b: 'en' });
    expect(stt.config!.languageHints).toEqual(['zh', 'en']);
  });

  it('two_way with auto source degrades to one_way', async () => {
    const { stt } = await connectedClient({ twoWayTranslation: true, sourceLanguage: 'auto' });
    expect(stt.config!.translation).toEqual({ type: 'one_way', target_language: 'en' });
  });

  it('textOnly skips TTS entirely; otherwise TTS connects and prewarns target', async () => {
    const a = await connectedClient({ textOnly: true });
    expect(a.tts).toBeUndefined();
    const b = await connectedClient({ textOnly: false });
    expect(b.tts).toBeDefined();
    expect(b.tts!.prewarmed).toEqual(['en']);
  });

  it('TTS connect failure degrades to text-only without failing connect', async () => {
    MockTts.failConnect = true;
    const { client } = await connectedClient();
    expect(client.isConnected()).toBe(true);
  });

  it('TTS connect failure emits exactly one tts.degraded event (no duplicate echo)', async () => {
    MockTts.failConnect = true;
    const client = new SonioxClient('key');
    const realtimeEvents: Array<{ event: { type: string } }> = [];
    client.setEventHandlers({ onRealtimeEvent: (e: any) => realtimeEvents.push(e) });
    await client.connect(BASE_CONFIG);
    const degraded = realtimeEvents.filter((e) => e.event.type === 'tts.degraded');
    expect(degraded).toHaveLength(1);
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
