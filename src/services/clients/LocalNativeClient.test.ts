import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LocalNativeClient } from './LocalNativeClient';
import { useNativeModelStore } from '../../stores/nativeModelStore';

const LOCAL_NATIVE_CONFIG: any = {
  provider: 'local_native', model: 'native', sourceLanguage: 'es', targetLanguage: 'en',
  asrModelId: 'sense-voice', translationModelId: 'opus-mt-es-en',
};

function mocks() {
  const asr: any = {
    onResult: null, onSpeechStart: null, onStatus: null, onError: null, onPartialResult: null,
    init: vi.fn().mockResolvedValue({ loadTimeMs: 1 }), feedAudio: vi.fn(), flush: vi.fn(), dispose: vi.fn(),
  };
  const translate: any = {
    onError: null, init: vi.fn().mockResolvedValue({ loadTimeMs: 1 }),
    translate: vi.fn().mockResolvedValue({ sourceText: 'hola', translatedText: 'hello', inferenceTimeMs: 2 }),
    dispose: vi.fn(),
  };
  const tts: any = { onError: null, init: vi.fn(), generate: vi.fn(), dispose: vi.fn() };
  return { asr, translate, tts };
}

describe('LocalNativeClient', () => {
  it('connects and runs ASR→translation, emitting user + assistant items', async () => {
    const m = mocks();
    const c = new LocalNativeClient(m);
    const items: any[] = [];
    c.setEventHandlers({ onConversationUpdated: ({ item }) => items.push({ role: item.role, status: item.status, text: item.formatted?.transcript }) });
    await c.connect({
      provider: 'local_native', model: 'native', sourceLanguage: 'es', targetLanguage: 'en',
      asrModelId: 'sense-voice', translationModelId: 'opus-mt-es-en',
    } as any);
    expect(m.asr.init).toHaveBeenCalled();
    expect(m.translate.init).toHaveBeenCalledWith('es', 'en', 'opus-mt-es-en', undefined);

    await m.asr.onResult({ text: 'hola', durationMs: 100, recognitionTimeMs: 5 });
    await new Promise((r) => setTimeout(r, 0));

    const roles = items.map((i) => i.role);
    expect(roles).toContain('user');
    expect(roles).toContain('assistant');
    const assistant = [...items].reverse().find((i) => i.role === 'assistant');
    expect(assistant.text).toBe('hello');
    expect(assistant.status).toBe('completed');
  });

  it('emits an audio delta when a non-cloning TTS model is configured', async () => {
    const m = mocks();
    m.tts.init = vi.fn().mockResolvedValue({ sampleRate: 16000, loadTimeMs: 1 });
    m.tts.generate = vi.fn().mockResolvedValue({ samples: new Float32Array(16000), sampleRate: 16000, generationTimeMs: 9 });
    const c = new LocalNativeClient(m);
    const deltas: any[] = [];
    c.setEventHandlers({ onConversationUpdated: ({ item, delta }) => { if (delta?.audio) deltas.push({ role: item.role, len: delta.audio.length }); } });
    await c.connect({
      provider: 'local_native', model: 'native', sourceLanguage: 'en', targetLanguage: 'en',
      asrModelId: 'sense-voice', ttsModelId: 'piper-en-amy',
    } as any);
    expect(m.tts.init).toHaveBeenCalledWith('piper-en-amy');
    await m.asr.onResult({ text: 'hi', durationMs: 10, recognitionTimeMs: 1 });
    await new Promise((r) => setTimeout(r, 0));
    expect(deltas.length).toBe(1);
    expect(deltas[0].role).toBe('assistant');
    expect(deltas[0].len).toBe(24000); // 16k resampled to 24k
  });

  it('returns a fresh array from getConversationItems (so setItems re-renders)', async () => {
    const m = mocks();
    const c = new LocalNativeClient(m);
    await c.connect({ provider: 'local_native', model: 'native', sourceLanguage: 'es', targetLanguage: 'en', asrModelId: 'sense-voice' } as any);
    await m.asr.onResult({ text: 'hola', durationMs: 1, recognitionTimeMs: 1 });
    expect(c.getConversationItems()).not.toBe(c.getConversationItems()); // different reference each call
  });

  it('emits local.native.* events to onRealtimeEvent (Logs panel)', async () => {
    const m = mocks();
    const c = new LocalNativeClient(m);
    const types: string[] = [];
    c.setEventHandlers({ onRealtimeEvent: (e: any) => types.push(e.event.type) });
    await c.connect({ provider: 'local_native', model: 'native', sourceLanguage: 'es', targetLanguage: 'en', asrModelId: 'sense-voice' } as any);
    await m.asr.onResult({ text: 'hola', durationMs: 1, recognitionTimeMs: 1 });
    await new Promise((r) => setTimeout(r, 0));
    expect(types).toContain('local.native.init.start');
    expect(types).toContain('local.native.init.ready');
    expect(types).toContain('local.native.asr.result');
    expect(types).toContain('local.native.translation.end');
  });

  it('feedAudio forwards to the ASR client', async () => {
    const m = mocks();
    const c = new LocalNativeClient(m);
    await c.connect({
      provider: 'local_native', model: 'native', sourceLanguage: 'es', targetLanguage: 'en', asrModelId: 'sense-voice',
    } as any);
    const buf = new Int16Array(10);
    c.appendInputAudio(buf);
    expect(m.asr.feedAudio).toHaveBeenCalledWith(buf, 24000);
  });

  it('renders partials as one in-progress item and runs the job only on the final', async () => {
    const translate = { init: async () => ({ device: 'cpu' }), translate: vi.fn(async () => ({ translatedText: 'T', inferenceTimeMs: 1 })), onError: null, dispose() {} };
    const asr: any = { init: async () => ({ device: 'cuda' }), feedAudio() {}, flush() {}, dispose() {}, onResult: null, onPartialResult: null, onError: null };
    const client = new LocalNativeClient({ asr, translate });
    const items: any[] = [];
    client.setEventHandlers({ onConversationUpdated: ({ item }) => items.push({ id: item.id, status: item.status, text: item.formatted?.transcript }), onOpen() {}, onRealtimeEvent() {} } as any);
    await client.connect(LOCAL_NATIVE_CONFIG);
    asr.onPartialResult('he');            // partial 1
    asr.onPartialResult('hello');         // partial 2 (same item updates)
    expect(translate.translate).not.toHaveBeenCalled();
    asr.onResult({ text: 'hello world' }); // final
    await new Promise((r) => setTimeout(r, 0));
    expect(translate.translate).toHaveBeenCalledTimes(1);
    const userItems = items.filter((i) => i.id.startsWith('user'));
    expect(new Set(userItems.map((i) => i.id)).size).toBe(1);  // one user item across partials+final
  });

  it('drops the stale partial after clearConversationItems so the next final still lands', async () => {
    const translate = { init: async () => ({ device: 'cpu' }), translate: vi.fn(async () => ({ translatedText: 'T', inferenceTimeMs: 1 })), onError: null, dispose() {} };
    const asr: any = { init: async () => ({ device: 'cuda' }), feedAudio() {}, flush() {}, dispose() {}, onResult: null, onPartialResult: null, onError: null };
    const client = new LocalNativeClient({ asr, translate });
    client.setEventHandlers({ onConversationUpdated() {}, onOpen() {}, onRealtimeEvent() {} } as any);
    await client.connect(LOCAL_NATIVE_CONFIG);
    asr.onPartialResult('hel');                 // a partial user item is in progress
    client.clearConversationItems();            // user clears the conversation mid-utterance
    asr.onResult({ text: 'hello' });            // the final then arrives
    await new Promise((r) => setTimeout(r, 0));
    const userItems = client.getConversationItems().filter((i: any) => i.id.startsWith('user'));
    expect(userItems.length).toBe(1);                                   // the final landed as a fresh item
    expect(userItems[0].formatted?.transcript).toBe('hello');           // not lost on the detached item
  });
});

// ── Task 3: loading flag + resolved plan ──────────────────────────────────────

const fakeAsr = () => ({
  onResult: null as any, onError: null as any,
  init: async () => ({ loadTimeMs: 5, device: 'cuda', rtf: 0.02 }),
  feedAudio() {}, flush: async () => {}, dispose() {},
});
const fakeTr = () => ({ onError: null as any, init: async () => ({ device: 'cpu' }), translate: async () => ({ translatedText: 'x', inferenceTimeMs: 1 }), dispose() {} });
const fakeTts = () => ({ init: async () => {}, generate: async () => ({ samples: new Float32Array(0), sampleRate: 24000, generationTimeMs: 1 }), dispose() {} });

const cfg: any = {
  provider: 'local_native', model: 'native-asr-translate', instructions: '',
  sourceLanguage: 'en', targetLanguage: 'ja', asrModelId: 'granite-speech-4.1-2b',
  asrDevice: 'cuda', textOnly: true,
};

describe('LocalNativeClient session channel', () => {
  beforeEach(() => { useNativeModelStore.setState({ asrLoading: false, asrResolved: null }); });

  it('stores the resolved plan and clears loading after connect', async () => {
    const c = new LocalNativeClient({ asr: fakeAsr(), translate: fakeTr(), tts: fakeTts() });
    c.setEventHandlers({});
    await c.connect(cfg);
    const st = useNativeModelStore.getState();
    expect(st.asrLoading).toBe(false);
    expect(st.asrResolved).toEqual({ model: 'granite-speech-4.1-2b', device: 'cuda', rtf: 0.02 });
  });
});
