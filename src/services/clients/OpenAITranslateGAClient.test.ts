import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenAITranslateGAClient } from './OpenAITranslateGAClient';
import type { OpenAITranslateSessionConfig, ClientEventHandlers } from '../interfaces/IClient';

const baseConfig: OpenAITranslateSessionConfig = {
  provider: 'openai_translate',
  model: 'gpt-realtime-translate',
  targetLanguage: 'es',
};

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

  it('creates a paired user+assistant item on first input_transcript.delta', () => {
    (client as any).handleServerEvent({
      type: 'session.input_transcript.delta',
      delta: 'Hello',
    });

    expect(updates.length).toBeGreaterThanOrEqual(2);
    const roles = updates.slice(0, 2).map((u) => u.item.role);
    expect(roles).toContain('user');
    expect(roles).toContain('assistant');

    const userUpdate = updates.find((u) => u.item.role === 'user');
    expect(userUpdate.item.formatted.transcript).toBe('Hello');
  });

  it('appends output_transcript.delta to the assistant item', () => {
    (client as any).handleServerEvent({
      type: 'session.input_transcript.delta',
      delta: 'Hola',
    });
    (client as any).handleServerEvent({
      type: 'session.output_transcript.delta',
      delta: 'Hello',
    });

    const items = client.getConversationItems();
    const assistant = items.find((i) => i.role === 'assistant');
    expect(assistant?.formatted?.transcript).toBe('Hello');
  });

  it('accumulates output_audio.delta into assistant item audioChunks', () => {
    (client as any).handleServerEvent({
      type: 'session.input_transcript.delta',
      delta: 'Test',
    });

    // base64 of [1, 0, 2, 0] (Int16Array(2) [1, 2]) = "AQACAA=="
    (client as any).handleServerEvent({
      type: 'session.output_audio.delta',
      delta: 'AQACAA==',
    });

    const audioUpdate = updates.find(
      (u) => u.delta?.audio instanceof Int16Array && u.delta.audio.length > 0
    );
    expect(audioUpdate).toBeDefined();
    expect(Array.from(audioUpdate.delta.audio)).toEqual([1, 2]);
  });

  it('drops output_audio.delta when no transcript-driven pair exists', () => {
    // Translate API streams continuous audio (silence padding) before the
    // user speaks. These chunks must NOT auto-create a phantom pair.
    (client as any).handleServerEvent({
      type: 'session.output_audio.delta',
      delta: 'AQACAA==',
    });

    expect(client.getConversationItems()).toEqual([]);
    expect(updates.find((u) => u.delta?.audio)).toBeUndefined();
  });

  it('output_audio.delta does not reset the silence timer', () => {
    // Open a pair via transcript, then stream audio every 500ms for 2s.
    // Audio is a keep-alive heartbeat — the 1.5s silence completion must
    // still fire based on the last *transcript* delta, not the audio.
    (client as any).handleServerEvent({
      type: 'session.input_transcript.delta',
      delta: 'Hi',
    });

    for (let t = 0; t < 2000; t += 500) {
      vi.advanceTimersByTime(500);
      (client as any).handleServerEvent({
        type: 'session.output_audio.delta',
        delta: 'AQACAA==',
      });
    }

    const items = client.getConversationItems();
    expect(items.find((i) => i.role === 'user')?.status).toBe('completed');
    expect(items.find((i) => i.role === 'assistant')?.status).toBe('completed');
  });

  it('marks both items completed after 1.5s of silence', () => {
    (client as any).handleServerEvent({
      type: 'session.input_transcript.delta',
      delta: 'Hello',
    });

    let items = client.getConversationItems();
    expect(items.find((i) => i.role === 'user')?.status).toBe('in_progress');

    vi.advanceTimersByTime(1600);

    items = client.getConversationItems();
    expect(items.find((i) => i.role === 'user')?.status).toBe('completed');
    expect(items.find((i) => i.role === 'assistant')?.status).toBe('completed');

    (client as any).handleServerEvent({
      type: 'session.input_transcript.delta',
      delta: 'Bye',
    });
    items = client.getConversationItems();
    const userItems = items.filter((i) => i.role === 'user');
    expect(userItems.length).toBe(2);
  });

  it('marks items completed on session.input_transcript.done event', () => {
    (client as any).handleServerEvent({
      type: 'session.input_transcript.delta',
      delta: 'Hi',
    });
    (client as any).handleServerEvent({
      type: 'session.input_transcript.done',
    });

    const items = client.getConversationItems();
    expect(items.find((i) => i.role === 'user')?.status).toBe('completed');
    expect(items.find((i) => i.role === 'assistant')?.status).toBe('completed');
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
