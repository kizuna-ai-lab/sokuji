import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LocalNativeClient } from './LocalNativeClient';
import { useNativeModelStore } from '../../stores/nativeModelStore';

const LOCAL_NATIVE_CONFIG: any = {
  provider: 'local_native', model: 'native', sourceLanguage: 'es', targetLanguage: 'en',
  asrModelId: 'sense-voice', translationModelId: 'qwen2.5-0.5b',
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
  const tts: any = { onError: null, init: vi.fn(), generate: vi.fn(), dispose: vi.fn(), setVoice: vi.fn(), setSpeaker: vi.fn() };
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
      asrModelId: 'sense-voice', translationModelId: 'qwen2.5-0.5b',
    } as any);
    expect(m.asr.init).toHaveBeenCalled();
    // init signature: (src, tgt, translationModelId, translationDevice, asrModelId, ttsModelId, translationVariant)
    expect(m.translate.init).toHaveBeenCalledWith('es', 'en', 'qwen2.5-0.5b', undefined, 'sense-voice', undefined, undefined);

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
    expect(m.tts.init).toHaveBeenCalledWith('piper-en-amy', undefined);
    await m.asr.onResult({ text: 'hi', durationMs: 10, recognitionTimeMs: 1 });
    await new Promise((r) => setTimeout(r, 0));
    expect(deltas.length).toBe(1);
    expect(deltas[0].role).toBe('assistant');
    expect(deltas[0].len).toBe(24000); // 16k resampled to 24k
  });

  it('forwards the ttsDevice override to tts.init', async () => {
    const m = mocks();
    m.tts.init = vi.fn().mockResolvedValue({ sampleRate: 16000, loadTimeMs: 1 });
    const c = new LocalNativeClient(m);
    await c.connect({
      provider: 'local_native', model: 'native', sourceLanguage: 'en', targetLanguage: 'en',
      asrModelId: 'sense-voice', ttsModelId: 'moss-tts-nano', ttsDevice: 'cuda',
    } as any);
    expect(m.tts.init).toHaveBeenCalledWith('moss-tts-nano', 'cuda');
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

  it('stores measured memory + fallback reason from the resolved plan', async () => {
    const asr = {
      onResult: null as any, onError: null as any,
      init: async () => ({ loadTimeMs: 5, device: 'cuda', rtf: 0.02, memoryBytes: 8_000_000_000 }),
      feedAudio() {}, flush: async () => {}, dispose() {},
    };
    const translate = {
      onError: null as any,
      init: async () => ({ device: 'cpu', memoryBytes: 4_200_000_000, fallbackReason: 'cuda skipped; using CPU' }),
      translate: async () => ({ translatedText: 'x', inferenceTimeMs: 1 }), dispose() {},
    };
    const c = new LocalNativeClient({ asr, translate, tts: fakeTts() });
    c.setEventHandlers({});
    await c.connect(cfg);
    const st = useNativeModelStore.getState();
    expect(st.asrResolved).toMatchObject({ device: 'cuda', memoryBytes: 8_000_000_000 });
    expect(st.translationResolved).toMatchObject({ device: 'cpu', memoryBytes: 4_200_000_000, fallbackReason: 'cuda skipped; using CPU' });
  });
});

// ── Load order: GPU-priority stage claims VRAM first ──────────────────────────

const orderRecordingDeps = (order: string[]) => ({
  asr: {
    onResult: null as any, onError: null as any,
    init: async () => { order.push('asr'); return { device: 'cuda', rtf: 0.02 }; },
    feedAudio() {}, flush: async () => {}, dispose() {},
  },
  translate: {
    onError: null as any,
    init: async () => { order.push('translate'); return { device: 'cpu' }; },
    translate: async () => ({ translatedText: 'x', inferenceTimeMs: 1 }), dispose() {},
  },
  tts: fakeTts(),
});

describe('LocalNativeClient load order', () => {
  beforeEach(() => useNativeModelStore.setState({ catalog: {}, sizes: {} } as any));

  it('loads a GPU-only ASR model before the flexible translation model', async () => {
    useNativeModelStore.setState({
      catalog: {
        'voxtral-mini-4b-realtime': { id: 'voxtral-mini-4b-realtime', name: '', languages: [], recommended: false,
          tiers: [{ tier: 'gpu-cuda', backend: 'voxtral_realtime', available: true }] },
        'qwen3.5-2b': { id: 'qwen3.5-2b', name: '', languages: [], recommended: false,
          tiers: [{ tier: 'gpu-cuda', backend: 'qwen35_translate', available: true },
                  { tier: 'cpu', backend: 'qwen35_translate', available: true }] },
      },
    } as any);
    const order: string[] = [];
    const c = new LocalNativeClient(orderRecordingDeps(order));
    c.setEventHandlers({});
    await c.connect({ provider: 'local_native', model: 'native', sourceLanguage: 'en', targetLanguage: 'ja',
      asrModelId: 'voxtral-mini-4b-realtime', translationModelId: 'qwen3.5-2b', textOnly: true } as any);
    expect(order).toEqual(['asr', 'translate']);
  });

  it('loads the larger model first when neither stage is GPU-only', async () => {
    useNativeModelStore.setState({
      catalog: {
        'sense-voice': { id: 'sense-voice', name: '', languages: [], recommended: false,
          tiers: [{ tier: 'gpu-cuda', backend: 'x', available: true }, { tier: 'cpu', backend: 'x', available: true }] },
        'qwen3.5-2b': { id: 'qwen3.5-2b', name: '', languages: [], recommended: false,
          tiers: [{ tier: 'gpu-cuda', backend: 'x', available: true }, { tier: 'cpu', backend: 'x', available: true }] },
      },
      sizes: { 'sense-voice': 900_000_000, 'qwen3.5-2b': 4_000_000_000 },
    } as any);
    const order: string[] = [];
    const c = new LocalNativeClient(orderRecordingDeps(order));
    c.setEventHandlers({});
    await c.connect({ provider: 'local_native', model: 'native', sourceLanguage: 'en', targetLanguage: 'ja',
      asrModelId: 'sense-voice', translationModelId: 'qwen3.5-2b', textOnly: true } as any);
    expect(order).toEqual(['translate', 'asr']);
  });
});

// ── Task 5: per-sentence TTS playback parity ─────────────────────────────────

function fakeDeps(over: { tts?: any; translate?: any } = {}) {
  return {
    asr: {
      onResult: null as any, onError: null as any, onPartialResult: null as any,
      init: vi.fn().mockResolvedValue({ loadTimeMs: 1, device: 'cpu' }),
      feedAudio: vi.fn(), flush: vi.fn(), dispose: vi.fn(),
    },
    translate: over.translate ?? {
      onError: null as any,
      init: vi.fn().mockResolvedValue({ device: 'cpu' }),
      translate: vi.fn().mockResolvedValue({ translatedText: 'Hello there. How are you?', inferenceTimeMs: 1 }),
      dispose: vi.fn(),
    },
    tts: over.tts ?? {
      init: vi.fn().mockResolvedValue({ sampleRate: 24000, loadTimeMs: 1, device: 'cpu', streaming: false }),
      generate: vi.fn().mockResolvedValue({ samples: new Float32Array(2400), sampleRate: 24000, generationTimeMs: 3 }),
      cancel: vi.fn(), dispose: vi.fn(),
    },
  };
}

describe('LocalNativeClient TTS playback parity', () => {
  beforeEach(() => useNativeModelStore.setState({ ttsResolved: null, ttsLoading: false } as any));

  it('one-shot piper: splits sentences and emits a delta + karaoke segment per sentence', async () => {
    const deltas: any[] = [];
    const deps = fakeDeps({
      tts: {
        init: vi.fn().mockResolvedValue({ sampleRate: 24000, loadTimeMs: 1, device: 'cpu', streaming: false, clones: false }),
        generate: vi.fn().mockResolvedValue({ samples: new Float32Array(2400), sampleRate: 24000, generationTimeMs: 3 }),
        cancel: vi.fn(), dispose: vi.fn(),
      },
    });
    const c = new LocalNativeClient(deps as any);
    c.setEventHandlers({ onConversationUpdated: (e: any) => { if (e.delta?.audio) deltas.push(e); } });
    // translate returns 'Hello there. How are you?' (two sentences)
    await c.connect({ provider: 'local_native', model: 'native', sourceLanguage: 'en', targetLanguage: 'en',
      asrModelId: 'sense-voice', translationModelId: 'q', ttsModelId: 'csukuangfj/vits-piper-en_US-amy-low', ttsSpeed: 1.0, textOnly: false } as any);
    await (c as any).runJob('hola');
    expect(deps.tts.generate).toHaveBeenCalledTimes(2);          // one per sentence
    expect(deltas.length).toBe(2);                                // one audio delta per sentence
    const item = deltas[deltas.length - 1].item;
    expect(item.formatted.audioSegments.length).toBe(2);         // karaoke segment per sentence
  });

  it('streaming MOSS: emits one delta per chunk via onChunk', async () => {
    const deltas: any[] = [];
    const deps = fakeDeps({
      tts: {
        init: vi.fn().mockResolvedValue({ sampleRate: 24000, loadTimeMs: 1, device: 'cpu', streaming: true, clones: true }),
        generate: vi.fn().mockImplementation(async (_t: string, _s: number, onChunk: any) => {
          onChunk(new Float32Array(800)); onChunk(new Float32Array(800));
          return { samples: new Float32Array(0), sampleRate: 24000, generationTimeMs: 4 };
        }),
        cancel: vi.fn(), dispose: vi.fn(),
      },
      translate: {
        onError: null as any,
        init: vi.fn().mockResolvedValue({ device: 'cpu' }),
        translate: vi.fn().mockResolvedValue({ translatedText: 'Hi.', inferenceTimeMs: 1 }),
        dispose: vi.fn(),
      },
    });
    const c = new LocalNativeClient(deps as any);
    c.setEventHandlers({ onConversationUpdated: (e: any) => { if (e.delta?.audio) deltas.push(e); } });
    await c.connect({ provider: 'local_native', model: 'native', sourceLanguage: 'en', targetLanguage: 'en',
      asrModelId: 'a', translationModelId: 't', ttsModelId: 'moss-tts-nano', ttsSpeed: 1.0, textOnly: false } as any);
    await (c as any).runJob('hi');
    expect(deltas.length).toBe(2);                                // one delta per streamed chunk
  });

  it('per-sentence TTS error skips the failing sentence and still completes the item', async () => {
    // translate returns 'Hello there. How are you?' (two sentences via fakeDeps)
    // first sentence generate() throws → should be skipped; second sentence plays → delta emitted
    let callCount = 0;
    const tts = {
      init: vi.fn().mockResolvedValue({ sampleRate: 24000, loadTimeMs: 1, device: 'cpu', streaming: false, clones: false }),
      generate: vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) throw new Error('tts boom');
        return { samples: new Float32Array(2400), sampleRate: 24000, generationTimeMs: 3 };
      }),
      cancel: vi.fn(), dispose: vi.fn(),
    };
    const deps = fakeDeps({ tts });
    const c = new LocalNativeClient(deps as any);
    const deltas: any[] = [];
    let completedItem: any = null;
    c.setEventHandlers({
      onConversationUpdated: (e: any) => {
        if (e.delta?.audio) deltas.push(e);
        if (e.item.role === 'assistant' && e.item.status === 'completed') completedItem = e.item;
      },
    });
    await c.connect({
      provider: 'local_native', model: 'native', sourceLanguage: 'en', targetLanguage: 'en',
      asrModelId: 'sense-voice', translationModelId: 'q',
      ttsModelId: 'csukuangfj/vits-piper-en_US-amy-low', ttsSpeed: 1.0, textOnly: false,
    } as any);
    await (c as any).runJob('hola');
    // first sentence failed (skipped), second sentence's audio still emitted
    expect(deltas.length).toBe(1);
    // item must reach completed — not stranded in_progress
    expect(completedItem).toBeDefined();
    expect(completedItem.status).toBe('completed');
  });

  it('cancelResponse cancels the in-flight TTS stream', async () => {
    const deps = fakeDeps({
      tts: {
        init: vi.fn().mockResolvedValue({ sampleRate: 24000, loadTimeMs: 1, device: 'cpu', streaming: true, clones: true }),
        generate: vi.fn(), cancel: vi.fn(), dispose: vi.fn(),
      },
    });
    const c = new LocalNativeClient(deps as any);
    c.setEventHandlers({});
    await c.connect({ provider: 'local_native', model: 'native', sourceLanguage: 'en', targetLanguage: 'en',
      asrModelId: 'a', translationModelId: 't', ttsModelId: 'moss-tts-nano', ttsSpeed: 1.0, textOnly: false } as any);
    c.cancelResponse();
    expect(deps.tts.cancel).toHaveBeenCalled();
  });

  // ── Karaoke timing parity (Fix 1 + Fix 2) ───────────────────────────────────

  it('streaming: pre-sets audioTextEnd before chunks and emits bare update after sentence stream', async () => {
    // 'Hi.' is a single sentence — simplifies the event sequence.
    const events: Array<{ hasDeltaAudio: boolean; audioTextEnd?: number; segCount: number; status: string }> = [];
    const tts = {
      init: vi.fn().mockResolvedValue({ sampleRate: 24000, loadTimeMs: 1, device: 'cpu', streaming: true }),
      generate: vi.fn().mockImplementation(async (_t: string, _s: number, onChunk: any) => {
        onChunk(new Float32Array(800)); // one chunk per sentence
      }),
      cancel: vi.fn(), dispose: vi.fn(),
    };
    const translate = {
      onError: null as any,
      init: vi.fn().mockResolvedValue({ device: 'cpu' }),
      translate: vi.fn().mockResolvedValue({ translatedText: 'Hi.', inferenceTimeMs: 1 }),
      dispose: vi.fn(),
    };
    const deps = fakeDeps({ tts, translate });
    const c = new LocalNativeClient(deps as any);
    c.setEventHandlers({
      onConversationUpdated: (e: any) => events.push({
        hasDeltaAudio: !!e.delta?.audio,
        audioTextEnd: e.item.formatted?.audioTextEnd,
        segCount: e.item.formatted?.audioSegments?.length ?? 0,
        status: e.item.status,
      }),
    });
    await c.connect({ provider: 'local_native', model: 'native', sourceLanguage: 'en', targetLanguage: 'en',
      asrModelId: 'a', translationModelId: 't', ttsModelId: 'moss-tts-nano', ttsSpeed: 1.0, textOnly: false } as any);
    await (c as any).runJob('hi');

    // The bare emit after the sentence stream has audioSegments populated and status still in_progress.
    const bareSegmentEmit = events.find((e) => !e.hasDeltaAudio && e.segCount >= 1 && e.status !== 'completed');
    expect(bareSegmentEmit).toBeDefined();                   // bare emit fired (Fix 2)
    expect(bareSegmentEmit!.audioTextEnd).toBeGreaterThan(0); // audioTextEnd was set (Fix 2)

    // Every chunk delta should already carry the pre-set audioTextEnd (non-zero).
    const chunkDeltas = events.filter((e) => e.hasDeltaAudio);
    expect(chunkDeltas.length).toBeGreaterThan(0);
    expect(chunkDeltas[0].audioTextEnd).toBeGreaterThan(0);  // pre-set before generate (Fix 2)
  });

  it('one-shot: audioTextEnd set before generate and audioSegments pushed before audio delta', async () => {
    // generate mock captures audioTextEnd on the item at call time; event handler
    // records audioSegments.length when each audio delta fires.
    let capturedItem: any = null;
    let audioTextEndAtFirstGenerate: number | undefined;
    const deltaSegCounts: number[] = [];

    const tts = {
      init: vi.fn().mockResolvedValue({ sampleRate: 24000, loadTimeMs: 1, device: 'cpu', streaming: false }),
      generate: vi.fn().mockImplementation(async () => {
        if (audioTextEndAtFirstGenerate === undefined) {
          audioTextEndAtFirstGenerate = capturedItem?.formatted?.audioTextEnd;
        }
        return { samples: new Float32Array(2400), sampleRate: 24000 };
      }),
      cancel: vi.fn(), dispose: vi.fn(),
    };
    // fakeDeps translate returns 'Hello there. How are you?' (two sentences)
    const deps = fakeDeps({ tts });
    const c = new LocalNativeClient(deps as any);
    c.setEventHandlers({
      onConversationUpdated: (e: any) => {
        if (e.item.role === 'assistant') {
          capturedItem = e.item;
          if (e.delta?.audio) deltaSegCounts.push(e.item.formatted?.audioSegments?.length ?? 0);
        }
      },
    });
    await c.connect({ provider: 'local_native', model: 'native', sourceLanguage: 'en', targetLanguage: 'en',
      asrModelId: 'sense-voice', translationModelId: 'q', ttsModelId: 'csukuangfj/vits-piper-en_US-amy-low', ttsSpeed: 1.0, textOnly: false } as any);
    await (c as any).runJob('hola');

    expect(audioTextEndAtFirstGenerate).toBeGreaterThan(0); // audioTextEnd set before first generate (Fix 1)
    expect(deltaSegCounts).toEqual([1, 2]);                 // segment pushed before each delta (Fix 1)
  });
});

// ── Task 4: ttsResolved + streaming flag ──────────────────────────────────────

function tts4Deps(over: any = {}) {
  return {
    asr: {
      onResult: null as any, onError: null as any, onPartialResult: null as any,
      init: vi.fn().mockResolvedValue({ loadTimeMs: 1, device: 'cpu' }),
      feedAudio: vi.fn(), flush: vi.fn(), dispose: vi.fn(),
    },
    translate: {
      onError: null as any,
      init: vi.fn().mockResolvedValue({ device: 'cpu' }),
      translate: vi.fn().mockResolvedValue({ translatedText: 'x', inferenceTimeMs: 1 }),
      dispose: vi.fn(),
    },
    tts: {
      init: vi.fn().mockResolvedValue({ sampleRate: 24000, loadTimeMs: 2, device: 'cpu', rtf: 0.44, streaming: true, clones: true }),
      generate: vi.fn(), cancel: vi.fn(), dispose: vi.fn(),
    },
    ...over,
  };
}

describe('LocalNativeClient TTS connect', () => {
  beforeEach(() => useNativeModelStore.setState({ ttsResolved: null, ttsLoading: false }));

  it('surfaces ttsResolved from the TTS init', async () => {
    const deps = tts4Deps();
    const c = new LocalNativeClient(deps);
    c.setEventHandlers({});
    await c.connect({
      provider: 'local_native', model: 'native', sourceLanguage: 'en', targetLanguage: 'ja',
      asrModelId: 'sense-voice', translationModelId: 'qwen2.5-0.5b',
      ttsModelId: 'moss-tts-nano', ttsSpeed: 1.0, textOnly: false,
    } as any);
    expect(deps.tts.init).toHaveBeenCalledWith('moss-tts-nano', undefined);
    expect(useNativeModelStore.getState().ttsResolved).toMatchObject({ model: 'moss-tts-nano', device: 'cpu', rtf: 0.44 });
  });

  it('sets ttsLoading true then false around init', async () => {
    const loadingStates: boolean[] = [];
    let resolveTtsInit!: (v: any) => void;
    const slowTts = {
      init: vi.fn().mockReturnValue(new Promise((res) => { resolveTtsInit = res; })),
      generate: vi.fn(), cancel: vi.fn(), dispose: vi.fn(),
    };
    const deps = tts4Deps({ tts: slowTts });
    const c = new LocalNativeClient(deps);
    c.setEventHandlers({});
    const connectPromise = c.connect({
      provider: 'local_native', model: 'native', sourceLanguage: 'en', targetLanguage: 'ja',
      asrModelId: 'sense-voice', translationModelId: 'qwen2.5-0.5b',
      ttsModelId: 'piper-en-amy', ttsSpeed: 1.0, textOnly: false,
    } as any);
    // Allow ASR + translate to finish but TTS init still pending
    await new Promise((r) => setTimeout(r, 0));
    loadingStates.push(useNativeModelStore.getState().ttsLoading);
    resolveTtsInit({ sampleRate: 22050, loadTimeMs: 3, device: 'cpu', rtf: 0.3, streaming: false });
    await connectPromise;
    loadingStates.push(useNativeModelStore.getState().ttsLoading);
    expect(loadingStates[0]).toBe(true);
    expect(loadingStates[1]).toBe(false);
  });

  it('does NOT init TTS for pocket models', async () => {
    const deps = tts4Deps();
    const c = new LocalNativeClient(deps);
    c.setEventHandlers({});
    await c.connect({
      provider: 'local_native', model: 'native', sourceLanguage: 'en', targetLanguage: 'ja',
      asrModelId: 'sense-voice', translationModelId: 'qwen2.5-0.5b',
      ttsModelId: 'pocket-tts-v1', ttsSpeed: 1.0, textOnly: false,
    } as any);
    expect(deps.tts.init).not.toHaveBeenCalled();
    expect(useNativeModelStore.getState().ttsResolved).toBeNull();
  });
});

// ── Task 7: built-in voice applied at connect ─────────────────────────────────

describe('LocalNativeClient voice selection', () => {
  it('applies the selected builtin voice after init', async () => {
    const m = mocks();
    m.tts.init = vi.fn().mockResolvedValue({ sampleRate: 24000, loadTimeMs: 1, streaming: true });
    m.tts.setVoice = vi.fn().mockResolvedValue(undefined);
    const c = new LocalNativeClient(m);
    await c.connect({
      provider: 'local_native', model: 'native', sourceLanguage: 'en', targetLanguage: 'en',
      asrModelId: 'sense-voice', ttsModelId: 'moss-tts-nano', ttsVoice: 'builtin:Bella',
    } as any);
    expect(m.tts.init).toHaveBeenCalledWith('moss-tts-nano', undefined);
    expect(m.tts.setVoice).toHaveBeenCalledWith('Bella');
  });

  it('empty ttsVoice on a cloning model resolves to the per-language default builtin', async () => {
    // Voice capability now comes from the catalog entry (voiceCapability), not the
    // runtime init response — a clone-capable model must be registered there.
    useNativeModelStore.setState({
      catalog: { 'moss-tts-nano': { id: 'moss-tts-nano', name: 'MOSS', languages: ['en'], recommended: false, tiers: [], clones: true } as any },
    } as any);
    const m = mocks();
    m.tts.init = vi.fn().mockResolvedValue({ sampleRate: 24000, loadTimeMs: 1, clones: true });
    m.tts.setVoice = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(await import('../../stores/nativeModelStore'), 'nativeListTtsVoices')
      .mockResolvedValue([{ name: 'Ava', language: 'en', curated: true, unstable: false, default: true }] as any);
    const c = new LocalNativeClient(m);
    await c.connect({ provider: 'local_native', model: 'native', sourceLanguage: 'en', targetLanguage: 'en',
      asrModelId: 'sense-voice', ttsModelId: 'moss-tts-nano' } as any);
    expect(m.tts.setVoice).toHaveBeenCalledWith('Ava');
  });

  it('sid: voice calls setSpeaker on a range (multi-speaker) model', async () => {
    const m = mocks();
    m.tts.init = vi.fn().mockResolvedValue({ sampleRate: 24000, loadTimeMs: 1, clones: false });
    m.tts.setSpeaker = vi.fn().mockResolvedValue(undefined);
    const c = new LocalNativeClient(m);
    await c.connect({ provider: 'local_native', model: 'native', sourceLanguage: 'en', targetLanguage: 'en',
      asrModelId: 'sense-voice', ttsModelId: 'piper-en', ttsVoice: 'sid:3' } as any);
    expect(m.tts.setSpeaker).toHaveBeenCalledWith(3);
    expect(m.tts.setVoice).not.toHaveBeenCalled();
  });

  it('single-voice (non-cloning, no ttsVoice) sends no voice command', async () => {
    const m = mocks();
    m.tts.init = vi.fn().mockResolvedValue({ sampleRate: 24000, loadTimeMs: 1, clones: false });
    const c = new LocalNativeClient(m);
    await c.connect({ provider: 'local_native', model: 'native', sourceLanguage: 'en', targetLanguage: 'en',
      asrModelId: 'sense-voice', ttsModelId: 'piper-en-amy' } as any);
    expect(m.tts.setVoice).not.toHaveBeenCalled();
    expect(m.tts.setSpeaker).not.toHaveBeenCalled();
  });

  it('applies a custom cloned voice via setReferenceVoice', async () => {
    // Voice capability (and so which NativeVoiceStore backs 'custom:') now comes
    // from the catalog entry: a clip-clone-capable model must be registered there.
    useNativeModelStore.setState({
      catalog: { 'moss-tts-nano': { id: 'moss-tts-nano', name: 'MOSS', languages: ['en'], recommended: false, tiers: [], clones: true } as any },
    } as any);
    const m = mocks();
    m.tts.init = vi.fn().mockResolvedValue({ sampleRate: 24000, loadTimeMs: 1 });
    m.tts.setReferenceVoice = vi.fn().mockResolvedValue(undefined);
    // Stub the storage read the ClipVoiceStore uses under the hood (inject via deps or vi.mock the module).
    vi.spyOn(await import('../../lib/local-inference/nativeVoiceStorage'), 'listNativeVoices')
      .mockResolvedValue([{ id: 7, name: 'Mine', audio: new Float32Array([0.1, 0.2]).buffer, sampleRate: 16000, createdAt: 0, transcript: 'the transcript' }]);
    vi.spyOn(await import('../../lib/local-inference/nativeVoiceStorage'), 'getNativeVoice')
      .mockResolvedValue({ id: 7, name: 'Mine', audio: new Float32Array([0.1, 0.2]).buffer, sampleRate: 16000, createdAt: 0, transcript: 'the transcript' });
    const c = new LocalNativeClient(m);
    await c.connect({ provider: 'local_native', model: 'native', sourceLanguage: 'en', targetLanguage: 'en',
      asrModelId: 'sense-voice', ttsModelId: 'moss-tts-nano', ttsVoice: 'custom:7' } as any);
    expect(m.tts.setReferenceVoice).toHaveBeenCalledWith(expect.any(Float32Array), 16000, 'the transcript');
  });

  it('applies a custom cloned voice without a transcript (MOSS back-compat)', async () => {
    useNativeModelStore.setState({
      catalog: { 'moss-tts-nano': { id: 'moss-tts-nano', name: 'MOSS', languages: ['en'], recommended: false, tiers: [], clones: true } as any },
    } as any);
    const m = mocks();
    m.tts.init = vi.fn().mockResolvedValue({ sampleRate: 24000, loadTimeMs: 1 });
    m.tts.setReferenceVoice = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(await import('../../lib/local-inference/nativeVoiceStorage'), 'listNativeVoices')
      .mockResolvedValue([{ id: 8, name: 'Mine', audio: new Float32Array([0.1, 0.2]).buffer, sampleRate: 16000, createdAt: 0 }]);
    vi.spyOn(await import('../../lib/local-inference/nativeVoiceStorage'), 'getNativeVoice')
      .mockResolvedValue({ id: 8, name: 'Mine', audio: new Float32Array([0.1, 0.2]).buffer, sampleRate: 16000, createdAt: 0 });
    const c = new LocalNativeClient(m);
    await c.connect({ provider: 'local_native', model: 'native', sourceLanguage: 'en', targetLanguage: 'en',
      asrModelId: 'sense-voice', ttsModelId: 'moss-tts-nano', ttsVoice: 'custom:8' } as any);
    expect(m.tts.setReferenceVoice).toHaveBeenCalledWith(expect.any(Float32Array), 16000, undefined);
  });
});
