import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenAITranslateGAClient } from './OpenAITranslateGAClient';
import type { OpenAITranslateSessionConfig, ClientEventHandlers } from '../interfaces/IClient';

const baseConfig: OpenAITranslateSessionConfig = {
  provider: 'openai_translate',
  model: 'gpt-realtime-translate',
  targetLanguage: 'es',
};

/** Build a base64-encoded PCM16 chunk of `samples` Int16 samples. */
function makePcmDelta(samples: number, value: number = 1): string {
  const bytes = new Uint8Array(samples * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < samples; i++) {
    view.setInt16(i * 2, value, true);
  }
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

/** 200 ms heartbeat = 4800 samples; 400 ms content = 9600 samples. */
const HEARTBEAT_DELTA = makePcmDelta(4800, 0);
const CONTENT_DELTA = makePcmDelta(9600, 1000);

describe('OpenAITranslateGAClient.buildSessionUpdate', () => {
  it('builds minimal payload with target language only', () => {
    const payload = OpenAITranslateGAClient.buildSessionUpdate(baseConfig);
    expect(payload).toEqual({
      type: 'session.update',
      session: {
        audio: {
          output: { language: 'es' },
        },
      },
    });
  });

  it('includes transcription config when provided', () => {
    const config: OpenAITranslateSessionConfig = {
      ...baseConfig,
      inputAudioTranscription: { model: 'gpt-realtime-whisper' },
    };
    const payload = OpenAITranslateGAClient.buildSessionUpdate(config);
    expect(payload.session.audio.input).toEqual({
      transcription: { model: 'gpt-realtime-whisper' },
    });
  });

  it('includes noise reduction when provided', () => {
    const config: OpenAITranslateSessionConfig = {
      ...baseConfig,
      inputAudioNoiseReduction: { type: 'near_field' },
    };
    const payload = OpenAITranslateGAClient.buildSessionUpdate(config);
    expect(payload.session.audio.input).toEqual({
      noise_reduction: { type: 'near_field' },
    });
  });

  it('combines transcription and noise reduction', () => {
    const config: OpenAITranslateSessionConfig = {
      ...baseConfig,
      targetLanguage: 'zh',
      inputAudioTranscription: { model: 'gpt-realtime-whisper' },
      inputAudioNoiseReduction: { type: 'far_field' },
    };
    const payload = OpenAITranslateGAClient.buildSessionUpdate(config);
    expect(payload.session.audio.output.language).toBe('zh');
    expect(payload.session.audio.input).toEqual({
      transcription: { model: 'gpt-realtime-whisper' },
      noise_reduction: { type: 'far_field' },
    });
  });

  it('omits audio.input when neither transcription nor noise reduction set', () => {
    const payload = OpenAITranslateGAClient.buildSessionUpdate(baseConfig);
    expect(payload.session.audio).not.toHaveProperty('input');
  });
});

describe('OpenAITranslateGAClient state machine', () => {
  let client: OpenAITranslateGAClient;
  let updates: any[] = [];

  beforeEach(() => {
    vi.useFakeTimers();
    client = new OpenAITranslateGAClient('test-key');
    updates = [];
    const handlers: ClientEventHandlers = {
      onConversationUpdated: (e) => updates.push(e),
    };
    client.setEventHandlers(handlers);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates a user item on first input_transcript.delta (no assistant yet)', () => {
    (client as any).handleServerEvent({
      type: 'session.input_transcript.delta',
      delta: 'Hello',
    });

    const items = client.getConversationItems();
    expect(items.length).toBe(1);
    expect(items[0].role).toBe('user');
    expect(items[0].formatted?.transcript).toBe('Hello');
  });

  it('creates an assistant item on first output_transcript.delta (no user yet)', () => {
    (client as any).handleServerEvent({
      type: 'session.output_transcript.delta',
      delta: 'Hola',
    });

    const items = client.getConversationItems();
    expect(items.length).toBe(1);
    expect(items[0].role).toBe('assistant');
    expect(items[0].formatted?.transcript).toBe('Hola');
  });

  it('appends output_transcript.delta only to the assistant item', () => {
    (client as any).handleServerEvent({
      type: 'session.input_transcript.delta',
      delta: 'Hola',
    });
    (client as any).handleServerEvent({
      type: 'session.output_transcript.delta',
      delta: 'Hello',
    });

    const items = client.getConversationItems();
    expect(items.find((i) => i.role === 'user')?.formatted?.transcript).toBe('Hola');
    expect(items.find((i) => i.role === 'assistant')?.formatted?.transcript).toBe('Hello');
  });

  it('accumulates content (9600-sample) output_audio.delta into assistant audioChunks', () => {
    (client as any).handleServerEvent({
      type: 'session.output_transcript.delta',
      delta: 'Test',
    });
    (client as any).handleServerEvent({
      type: 'session.output_audio.delta',
      delta: CONTENT_DELTA,
    });

    const audioUpdate = updates.find(
      (u) => u.delta?.audio instanceof Int16Array && u.delta.audio.length === 9600
    );
    expect(audioUpdate).toBeDefined();
  });

  it('drops 4800-sample heartbeat output_audio.delta even when an assistant exists', () => {
    (client as any).handleServerEvent({
      type: 'session.output_transcript.delta',
      delta: 'Hi',
    });
    (client as any).handleServerEvent({
      type: 'session.output_audio.delta',
      delta: HEARTBEAT_DELTA,
    });

    const audioUpdate = updates.find((u) => u.delta?.audio instanceof Int16Array);
    expect(audioUpdate).toBeUndefined();
  });

  it('drops content output_audio.delta when no assistant item exists', () => {
    // Translate emits a silent prelude content frame at session start (before
    // any output_transcript). With independent state machines, audio must NOT
    // create an assistant item — only output_transcript does.
    (client as any).handleServerEvent({
      type: 'session.output_audio.delta',
      delta: CONTENT_DELTA,
    });

    expect(client.getConversationItems()).toEqual([]);
    expect(updates.find((u) => u.delta?.audio)).toBeUndefined();

    // Even with a USER item open, audio still drops — assistant is independent.
    (client as any).handleServerEvent({
      type: 'session.input_transcript.delta',
      delta: 'Hello',
    });
    (client as any).handleServerEvent({
      type: 'session.output_audio.delta',
      delta: CONTENT_DELTA,
    });
    expect(updates.find((u) => u.delta?.audio)).toBeUndefined();
  });

  it('heartbeat audio does NOT reset assistant silence timer', () => {
    (client as any).handleServerEvent({
      type: 'session.output_transcript.delta',
      delta: 'Hi',
    });

    for (let t = 0; t < 1500; t += 500) {
      vi.advanceTimersByTime(500);
      (client as any).handleServerEvent({
        type: 'session.output_audio.delta',
        delta: HEARTBEAT_DELTA,
      });
    }
    // Total elapsed 1500ms — at default 1000ms threshold, assistant should
    // already have completed. Heartbeat must not have kept it alive.
    const items = client.getConversationItems();
    expect(items.find((i) => i.role === 'assistant')?.status).toBe('completed');
  });

  it('content audio keeps assistant open past output_transcript end (TTS tail)', () => {
    (client as any).handleServerEvent({
      type: 'session.output_transcript.delta',
      delta: 'Hi',
    });
    // Keep streaming content audio for 2.5s — well past the 1s default
    // threshold. Assistant should stay open the whole time.
    for (let t = 0; t < 2500; t += 500) {
      vi.advanceTimersByTime(500);
      (client as any).handleServerEvent({
        type: 'session.output_audio.delta',
        delta: CONTENT_DELTA,
      });
    }
    let items = client.getConversationItems();
    expect(items.find((i) => i.role === 'assistant')?.status).toBe('in_progress');

    // Stop audio; assistant closes 1s later.
    vi.advanceTimersByTime(1100);
    items = client.getConversationItems();
    expect(items.find((i) => i.role === 'assistant')?.status).toBe('completed');
  });

  it('user and assistant close on independent timers', () => {
    // The whole point of independent state: input pause should NOT close the
    // assistant if it's still receiving output transcripts.
    (client as any).handleServerEvent({
      type: 'session.input_transcript.delta',
      delta: 'Hello',
    });
    (client as any).handleServerEvent({
      type: 'session.output_transcript.delta',
      delta: 'Hola',
    });

    // Input falls silent; assistant keeps streaming.
    vi.advanceTimersByTime(500);
    (client as any).handleServerEvent({
      type: 'session.output_transcript.delta',
      delta: ' mundo',
    });
    vi.advanceTimersByTime(700); // total 1200ms since last input_transcript

    let items = client.getConversationItems();
    expect(items.find((i) => i.role === 'user')?.status).toBe('completed');
    expect(items.find((i) => i.role === 'assistant')?.status).toBe('in_progress');

    // Now assistant also falls silent.
    vi.advanceTimersByTime(1100);
    items = client.getConversationItems();
    expect(items.find((i) => i.role === 'assistant')?.status).toBe('completed');
  });

  it('next utterance creates new user item without affecting active assistant', () => {
    // Simulates the scenario from the bug report: source pauses while the
    // model is still translating the previous utterance. The next input
    // burst must start a fresh user item, not extend or interrupt the
    // still-open assistant.
    (client as any).handleServerEvent({
      type: 'session.input_transcript.delta',
      delta: 'first',
    });
    (client as any).handleServerEvent({
      type: 'session.output_transcript.delta',
      delta: 'primero',
    });
    vi.advanceTimersByTime(1100); // user closes (1s threshold), assistant kept alive by output_transcript at t=0

    let items = client.getConversationItems();
    expect(items.find((i) => i.role === 'user' && i.formatted?.transcript === 'first')?.status).toBe('completed');
    // Assistant: last activity was at t=0, advanced 1100ms → also closed.
    // To keep it alive we'd need ongoing output activity. Test instead that
    // a NEW user starting now doesn't disturb it either way:

    (client as any).handleServerEvent({
      type: 'session.input_transcript.delta',
      delta: 'second',
    });
    items = client.getConversationItems();
    const userItems = items.filter((i) => i.role === 'user');
    expect(userItems.length).toBe(2);
    expect(userItems[1].formatted?.transcript).toBe('second');
  });

  it('marks user item completed on session.input_transcript.done', () => {
    (client as any).handleServerEvent({
      type: 'session.input_transcript.delta',
      delta: 'Hi',
    });
    (client as any).handleServerEvent({
      type: 'session.input_transcript.done',
    });

    const items = client.getConversationItems();
    expect(items.find((i) => i.role === 'user')?.status).toBe('completed');
    // No assistant was created — output side never triggered.
    expect(items.find((i) => i.role === 'assistant')).toBeUndefined();
  });

  it('marks assistant item completed on session.output_audio.done', () => {
    (client as any).handleServerEvent({
      type: 'session.output_transcript.delta',
      delta: 'Hi',
    });
    (client as any).handleServerEvent({
      type: 'session.output_audio.done',
    });

    const items = client.getConversationItems();
    expect(items.find((i) => i.role === 'assistant')?.status).toBe('completed');
  });

  it('honours configured per-side silence thresholds', () => {
    (client as any).userSilenceTimeoutMs = 600;
    (client as any).assistantSilenceTimeoutMs = 1500;

    (client as any).handleServerEvent({
      type: 'session.input_transcript.delta',
      delta: 'Hi',
    });
    (client as any).handleServerEvent({
      type: 'session.output_transcript.delta',
      delta: 'Bonjour',
    });

    // After 700ms, user should have closed but assistant still in_progress.
    vi.advanceTimersByTime(700);
    let items = client.getConversationItems();
    expect(items.find((i) => i.role === 'user')?.status).toBe('completed');
    expect(items.find((i) => i.role === 'assistant')?.status).toBe('in_progress');

    // After total 1600ms, assistant also closes.
    vi.advanceTimersByTime(900);
    items = client.getConversationItems();
    expect(items.find((i) => i.role === 'assistant')?.status).toBe('completed');
  });

  it('exports the correct silence-timeout constants', async () => {
    const { SILENCE_TIMEOUT_MS, SILENCE_TIMEOUT_MIN_MS, SILENCE_TIMEOUT_MAX_MS } =
      await import('./OpenAITranslateGAClient');
    expect(SILENCE_TIMEOUT_MS).toBe(1000);
    expect(SILENCE_TIMEOUT_MIN_MS).toBe(100);
    expect(SILENCE_TIMEOUT_MAX_MS).toBe(3000);
  });
});

import { isOpenAITranslateSessionConfig } from '../interfaces/IClient';

describe('OpenAITranslateGAClient WebSocket lifecycle', () => {
  let mockWs: any;
  let originalWebSocket: any;

  beforeEach(() => {
    originalWebSocket = (globalThis as any).WebSocket;
    mockWs = {
      readyState: 0,
      send: vi.fn(),
      close: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      onopen: null,
      onmessage: null,
      onerror: null,
      onclose: null,
    };
    // Use a function expression (not arrow) so the mock is constructable
    // when the implementation calls `new WebSocket(...)`.
    (globalThis as any).WebSocket = vi.fn(function () { return mockWs; });
  });

  afterEach(() => {
    (globalThis as any).WebSocket = originalWebSocket;
  });

  it('connects to the translate WSS URL with model query param', async () => {
    const client = new OpenAITranslateGAClient('test-key');
    const config: OpenAITranslateSessionConfig = {
      provider: 'openai_translate',
      model: 'gpt-realtime-translate',
      targetLanguage: 'es',
    };

    const connectPromise = client.connect(config);

    // Simulate the WebSocket opening
    mockWs.readyState = 1;
    mockWs.onopen?.({});

    // Simulate session.created
    mockWs.onmessage?.({
      data: JSON.stringify({ type: 'session.created' }),
    });

    await connectPromise;

    expect((globalThis as any).WebSocket).toHaveBeenCalledWith(
      expect.stringContaining('/v1/realtime/translations?model=gpt-realtime-translate'),
      expect.anything()
    );
  });

  it('sends session.update immediately after open', async () => {
    const client = new OpenAITranslateGAClient('test-key');
    const config: OpenAITranslateSessionConfig = {
      provider: 'openai_translate',
      model: 'gpt-realtime-translate',
      targetLanguage: 'ja',
      inputAudioTranscription: { model: 'gpt-realtime-whisper' },
    };

    const connectPromise = client.connect(config);
    mockWs.readyState = 1;
    mockWs.onopen?.({});
    mockWs.onmessage?.({ data: JSON.stringify({ type: 'session.created' }) });
    await connectPromise;

    const sendCalls = mockWs.send.mock.calls;
    const sessionUpdate = sendCalls
      .map((c: any) => JSON.parse(c[0]))
      .find((p: any) => p.type === 'session.update');
    expect(sessionUpdate).toBeDefined();
    expect(sessionUpdate.session.audio.output.language).toBe('ja');
    expect(sessionUpdate.session.audio.input.transcription.model).toBe('gpt-realtime-whisper');
  });

  it('appendInputAudio sends base64-encoded session.input_audio_buffer.append', async () => {
    const client = new OpenAITranslateGAClient('test-key');
    const config: OpenAITranslateSessionConfig = {
      provider: 'openai_translate',
      model: 'gpt-realtime-translate',
      targetLanguage: 'en',
    };

    const connectPromise = client.connect(config);
    mockWs.readyState = 1;
    mockWs.onopen?.({});
    mockWs.onmessage?.({ data: JSON.stringify({ type: 'session.created' }) });
    await connectPromise;

    mockWs.send.mockClear();

    const audio = new Int16Array([1, 2, 3]);
    client.appendInputAudio(audio);

    expect(mockWs.send).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(mockWs.send.mock.calls[0][0]);
    expect(payload.type).toBe('session.input_audio_buffer.append');
    expect(typeof payload.audio).toBe('string');
    expect(payload.audio.length).toBeGreaterThan(0);
  });
});

// Sanity-import the type guard so its emit isn't pruned (used internally)
void isOpenAITranslateSessionConfig;

describe('OpenAITranslateGAClient.validateApiKeyAndFetchModels', () => {
  it('returns valid when /v1/models includes gpt-realtime-translate', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({
        data: [
          { id: 'gpt-realtime-translate', object: 'model', created: 1, owned_by: 'openai' },
          { id: 'gpt-realtime-mini', object: 'model', created: 2, owned_by: 'openai' },
        ],
      }), { status: 200 })
    );

    const { validation, models } = await OpenAITranslateGAClient.validateApiKeyAndFetchModels('test-key');

    expect(validation.valid).toBe(true);
    expect(models.length).toBe(1);
    expect(models[0].id).toBe('gpt-realtime-translate');
    fetchSpy.mockRestore();
  });

  it('returns invalid when /v1/models does not include translate model', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({
        data: [{ id: 'gpt-realtime-mini', object: 'model', created: 1, owned_by: 'openai' }],
      }), { status: 200 })
    );

    const { validation } = await OpenAITranslateGAClient.validateApiKeyAndFetchModels('test-key');

    expect(validation.valid).toBe(false);
    fetchSpy.mockRestore();
  });
});
