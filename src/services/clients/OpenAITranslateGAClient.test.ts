import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenAITranslateGAClient, isSilenceFrame, computeRms } from './OpenAITranslateGAClient';
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

  it('emits only language under audio.output (no transcription field — API rejects it)', () => {
    // OpenAI's translate API rejects session.audio.output.transcription with
    // an "unknown_parameter" error. session.output_transcript.delta events
    // emit by default per the cookbook; no opt-in field exists.
    const payload = OpenAITranslateGAClient.buildSessionUpdate(baseConfig);
    expect(payload.session.audio.output).toEqual({ language: 'es' });
  });
});

describe('computeRms', () => {
  it('returns 0 for an empty frame', () => {
    expect(computeRms(new Int16Array(0))).toBe(0);
  });

  it('returns 0 for an all-zero frame (heartbeat)', () => {
    expect(computeRms(new Int16Array(4800))).toBe(0);
  });

  it('returns a positive normalized value for content amplitudes', () => {
    const frame = new Int16Array(9600);
    for (let i = 0; i < frame.length; i++) frame[i] = 1000;
    const rms = computeRms(frame);
    // RMS of constant 1000 = 1000; normalized = 1000/32768 ≈ 0.0305
    expect(rms).toBeGreaterThan(0.03);
    expect(rms).toBeLessThan(0.04);
  });

  it('saturates near 1.0 for a full-scale frame', () => {
    const frame = new Int16Array(100);
    for (let i = 0; i < frame.length; i++) frame[i] = 32767;
    expect(computeRms(frame)).toBeGreaterThan(0.99);
  });
});

describe('isSilenceFrame', () => {
  it('returns true for an all-zero frame (heartbeat shape)', () => {
    expect(isSilenceFrame(new Int16Array(4800))).toBe(true);
  });

  it('returns true for any zero-amplitude frame regardless of length', () => {
    // Defensive: API could change heartbeat duration without notice. We
    // detect by content (rms === 0) instead of length.
    expect(isSilenceFrame(new Int16Array(0))).toBe(true);
    expect(isSilenceFrame(new Int16Array(100))).toBe(true);
    expect(isSilenceFrame(new Int16Array(9600))).toBe(true);
  });

  it('returns false on the first non-zero sample (early exit)', () => {
    const frame = new Int16Array(9600);
    frame[0] = 1; // first sample non-zero
    expect(isSilenceFrame(frame)).toBe(false);

    const frame2 = new Int16Array(9600);
    frame2[9599] = -1; // last sample non-zero
    expect(isSilenceFrame(frame2)).toBe(false);
  });

  it('returns false for typical content amplitudes', () => {
    const frame = new Int16Array(9600);
    for (let i = 0; i < frame.length; i++) frame[i] = 1000;
    expect(isSilenceFrame(frame)).toBe(false);
  });
});

describe('OpenAITranslateGAClient state machine', () => {
  let client: OpenAITranslateGAClient;
  let updates: any[] = [];
  let realtimeEvents: any[] = [];

  beforeEach(() => {
    vi.useFakeTimers();
    // 1 s a side, which is what these scenarios were written against — the
    // pause pair's own default (1.5 s) is exercised by its own test below.
    client = new OpenAITranslateGAClient('test-key', undefined, {
      sourcePauseMs: 1000, translationPauseMs: 1000,
    });
    updates = [];
    realtimeEvents = [];
    const handlers: ClientEventHandlers = {
      onConversationUpdated: (e) => updates.push(e),
      onRealtimeEvent: (e) => realtimeEvents.push(e),
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

  it('does NOT accumulate output_audio.delta into formatted.audio when keepReplayAudio is false', () => {
    (client as any).keepReplayAudio = false;
    (client as any).handleServerEvent({
      type: 'session.output_transcript.delta',
      delta: 'Test',
    });
    (client as any).handleServerEvent({
      type: 'session.output_audio.delta',
      delta: CONTENT_DELTA,
    });

    // Real-time delta still flows through onConversationUpdated for playback.
    const audioUpdate = updates.find(
      (u) => u.delta?.audio instanceof Int16Array && u.delta.audio.length === 9600
    );
    expect(audioUpdate).toBeDefined();

    // Internal audioChunks must stay empty (no buffering for replay).
    const chunks = (client as any).audioChunks as Map<string, Int16Array[]>;
    expect(chunks.size).toBe(0);

    // Trigger the per-item end so completeAssistantItem() runs the gated
    // merge path. formatted.audio must remain undefined.
    (client as any).handleServerEvent({
      type: 'session.output_audio.done',
    });
    const assistant = client.getConversationItems().find((i) => i.role === 'assistant');
    expect(assistant?.formatted?.audio).toBeUndefined();

    // Karaoke timing must remain populated even when replay storage is off —
    // that's the whole point of the parallel audioCumSamples map.
    expect(assistant?.formatted?.audioSegments?.length).toBeGreaterThan(0);
    expect(assistant?.formatted?.audioSegments?.[0].audioEnd).toBeGreaterThan(0);
    expect(assistant?.formatted?.audioTextEnd).toBeGreaterThan(0);
  });

  it('accumulates output_audio.delta into formatted.audio when keepReplayAudio is true', () => {
    (client as any).keepReplayAudio = true;
    (client as any).handleServerEvent({
      type: 'session.output_transcript.delta',
      delta: 'Test',
    });
    (client as any).handleServerEvent({
      type: 'session.output_audio.delta',
      delta: CONTENT_DELTA,
    });

    // Internal audioChunks should have an entry for the assistant item.
    const chunks = (client as any).audioChunks as Map<string, Int16Array[]>;
    expect(chunks.size).toBeGreaterThan(0);
    const firstChunkList = Array.from(chunks.values())[0];
    expect(firstChunkList.length).toBe(1);
    expect(firstChunkList[0].length).toBe(9600);

    // Cross the completion boundary so the merge path runs.
    (client as any).handleServerEvent({
      type: 'session.output_audio.done',
    });

    const assistant = client.getConversationItems().find((i) => i.role === 'assistant');
    expect(assistant?.formatted?.audio).toBeInstanceOf(Int16Array);
    expect((assistant?.formatted?.audio as Int16Array).length).toBe(9600);
    // After completion the per-item chunk buffer is purged.
    expect((client as any).audioChunks.size).toBe(0);
  });

  it('drops zero-amplitude heartbeat output_audio.delta even when an assistant exists', () => {
    // Filter is rms === 0, not a fixed sample length. Heartbeat shape stays
    // covered, and any future API frame size with zero amplitude stays out.
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

  it('auto-creates assistant item from first non-silent content frame (no transcript yet)', () => {
    // Recent gpt-realtime-translate sessions can stream content audio before
    // (or even without) session.output_transcript.delta — observed when the
    // session was opened without explicit output transcription configured.
    // Audio must still play in that case, so the first non-silent frame
    // creates the assistant item. Heartbeat / prelude frames stay filtered
    // by isSilenceFrame and never reach this branch.
    (client as any).handleServerEvent({
      type: 'session.output_audio.delta',
      delta: CONTENT_DELTA,
    });

    const items = client.getConversationItems();
    expect(items.length).toBe(1);
    expect(items[0].role).toBe('assistant');

    const audioUpdate = updates.find(
      (u) => u.delta?.audio instanceof Int16Array && u.delta.audio.length === 9600
    );
    expect(audioUpdate).toBeDefined();
  });

  it('silent prelude frames do not spawn a phantom assistant item', () => {
    // Heartbeat / silent-prelude frames arrive before any real content.
    // isSilenceFrame must drop them before the auto-create path runs.
    const SILENT_HEARTBEAT = makePcmDelta(4800, 0);
    const SILENT_LARGE = makePcmDelta(9600, 0); // hypothetical larger silent frame
    (client as any).handleServerEvent({
      type: 'session.output_audio.delta',
      delta: SILENT_HEARTBEAT,
    });
    (client as any).handleServerEvent({
      type: 'session.output_audio.delta',
      delta: SILENT_LARGE,
    });
    expect(client.getConversationItems()).toEqual([]);
    expect(updates.find((u) => u.delta?.audio)).toBeUndefined();
  });

  it('annotates session.output_audio.delta with rms for the log', () => {
    (client as any).handleServerEvent({
      type: 'session.output_audio.delta',
      delta: CONTENT_DELTA,
    });

    const logged = realtimeEvents.find(
      (e) => e.source === 'server' && e.event.type === 'session.output_audio.delta',
    );
    expect(logged).toBeDefined();
    expect(typeof logged.event.data.rms).toBe('number');
    // CONTENT_DELTA = 9600 samples of value 1000 → rms ≈ 1000/32768
    expect(logged.event.data.rms).toBeGreaterThan(0.03);
    expect(logged.event.data.rms).toBeLessThan(0.04);
  });

  it('does NOT forward heartbeat output_audio.delta to the log (rms === 0 is noise)', () => {
    // Heartbeats dominated the timeline before. They're now suppressed
    // from log forwarding, but the playback / silence-filter logic still
    // runs (covered by other tests).
    (client as any).handleServerEvent({
      type: 'session.output_audio.delta',
      delta: HEARTBEAT_DELTA,
    });

    const logged = realtimeEvents.find(
      (e) => e.source === 'server' && e.event.type === 'session.output_audio.delta',
    );
    expect(logged).toBeUndefined();
  });

  it('annotates session.input_audio_buffer.append with rms in the log only (non-silent)', () => {
    // The wire payload must NOT include rms (the API rejects unknown
    // params); only the log copy carries the annotation.
    const ws: any = {
      readyState: 1,
      send: vi.fn(),
    };
    (client as any).ws = ws;

    const audio = new Int16Array(1536);
    for (let i = 0; i < audio.length; i++) audio[i] = 500;
    client.appendInputAudio(audio);

    // Wire payload — no rms.
    const wirePayload = JSON.parse(ws.send.mock.calls[0][0]);
    expect(wirePayload).toEqual({
      type: 'session.input_audio_buffer.append',
      audio: expect.any(String),
    });
    expect(wirePayload).not.toHaveProperty('rms');

    // Log payload — has rms.
    const logged = realtimeEvents.find(
      (e) => e.source === 'client' && e.event.type === 'session.input_audio_buffer.append',
    );
    expect(logged).toBeDefined();
    expect(typeof logged.event.data.rms).toBe('number');
    expect(logged.event.data.rms).toBeGreaterThan(0);
  });

  it('does NOT forward fully-silent session.input_audio_buffer.append to the log', () => {
    // Pre-VAD silence padding from the mic floods the log without
    // information — suppress it. The wire send still happens so server
    // VAD continues to receive silence as expected.
    const ws: any = {
      readyState: 1,
      send: vi.fn(),
    };
    (client as any).ws = ws;

    const silentAudio = new Int16Array(1536); // all zeros
    client.appendInputAudio(silentAudio);

    // Wire send still happens.
    expect(ws.send).toHaveBeenCalledTimes(1);

    // But no log entry was forwarded.
    const logged = realtimeEvents.find(
      (e) => e.source === 'client' && e.event.type === 'session.input_audio_buffer.append',
    );
    expect(logged).toBeUndefined();
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

  // A2: the pair is a global setting handed over at construction, not a field
  // of the session config. connect() must not reset it, and a client built
  // without one runs on the 1.5 s the store defaults to.
  it('keeps the pause pair it was built with, and defaults both sides to 1.5 s', () => {
    const built = new OpenAITranslateGAClient('test-key', undefined, {
      sourcePauseMs: 700, translationPauseMs: 2500,
    });
    expect((built as any).userSilenceTimeoutMs).toBe(700);
    expect((built as any).assistantSilenceTimeoutMs).toBe(2500);

    const bare = new OpenAITranslateGAClient('test-key');
    expect((bare as any).userSilenceTimeoutMs).toBe(1500);
    expect((bare as any).assistantSilenceTimeoutMs).toBe(1500);
  });

  // A2's accepted behaviour, written down rather than left to be inferred
  // from the tests above happening to build clients without a runtime: Off
  // means no punctuation stage, and the silence timers keep running under it.
  // They have to — they are the only thing that closes an item when speech
  // stops, and slice 4 removed the caps that competed with By sentences. So
  // Off and By pause cut identically here; the difference is only whether the
  // sliders can be reached.
  it('still closes items on silence with the segmentation stage off', () => {
    const off = new OpenAITranslateGAClient('test-key', undefined, {
      segmentation: null, sourcePauseMs: 700, translationPauseMs: 2500,
    });
    off.setEventHandlers({ onConversationUpdated: () => {} } as ClientEventHandlers);

    (off as any).handleServerEvent({ type: 'session.input_transcript.delta', delta: 'Hi' });
    (off as any).handleServerEvent({ type: 'session.output_transcript.delta', delta: 'Bonjour' });

    vi.advanceTimersByTime(800);
    let items = off.getConversationItems();
    expect(items.find((i) => i.role === 'user')?.status).toBe('completed');
    expect(items.find((i) => i.role === 'assistant')?.status).toBe('in_progress');

    vi.advanceTimersByTime(1800);
    items = off.getConversationItems();
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

  // The three silence-timeout constants this client used to own are now the
  // pause pair's, shared by all four pause clients; what is left to pin here
  // is that this client honours the range.
  it('clamps a pause outside the 100-3000 ms a timer accepts', () => {
    const client = new OpenAITranslateGAClient('test-key', undefined, {
      sourcePauseMs: 5, translationPauseMs: 99_000,
    });
    expect((client as any).userSilenceTimeoutMs).toBe(100);
    expect((client as any).assistantSilenceTimeoutMs).toBe(3000);
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
    expect(sessionUpdate.session.audio.output).not.toHaveProperty('transcription');
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

describe("OpenAITranslateGAClient relay mode", () => {
  it("connects to the relay URL with a sokuji-auth subprotocol", async () => {
    const captured: { url?: string; protocols?: string[] } = {};
    const FakeWS: any = vi.fn(function (this: any, url: string, protocols: string[]) {
      captured.url = url; captured.protocols = protocols;
      this.readyState = 1;
      this.send = vi.fn();
      this.close = vi.fn();
      this.addEventListener = vi.fn();
      this.removeEventListener = vi.fn();
      // Drive the relay handshake to completion: open, then emit session.created
      // so connect() resolves instead of leaving the 30s handshake timer pending.
      setTimeout(() => {
        this.onopen?.();
        this.onmessage?.({ data: JSON.stringify({ type: 'session.created' }) });
      }, 0);
    });
    FakeWS.OPEN = 1;
    const orig = globalThis.WebSocket;
    (globalThis as any).WebSocket = FakeWS;
    try {
      const client = new OpenAITranslateGAClient("sess_TOKEN", { wsUrl: "wss://r.example/v1/realtime/translations" });
      await client.connect({ provider: "openai_translate", model: "gpt-realtime-translate", targetLanguage: "zh" } as any);
      expect(captured.url).toContain("wss://r.example/v1/realtime/translations?model=");
      expect(captured.protocols).toContain("sokuji-auth.sess_TOKEN");
      expect(captured.protocols?.some((p) => p.startsWith("openai-insecure-api-key."))).toBe(false);
    } finally { (globalThis as any).WebSocket = orig; }
  });
});

describe('OpenAITranslateGAClient with the segmentation stage', () => {
  let mockWs: any;
  let originalWebSocket: any;

  /** Both sides CJK, so `gateChars` is 20 characters per sentence and the
   *  unpunctuated fixtures below stay short enough to read. Neither side is
   *  zh/yue, so SentenceStream's Chinese length fallback — which has nothing
   *  to do with what is under test — never fires. */
  const STAGE_CONFIG: OpenAITranslateSessionConfig = {
    provider: 'openai_translate',
    model: 'gpt-realtime-translate',
    sourceLanguage: 'ja',
    targetLanguage: 'ja',
  };

  /** A runtime that marks a sentence end every `every` characters. It inserts
   *  nothing but terminals, so SentenceStream's skeleton invariant holds. */
  function markingRuntime(every = 10, enabled = true) {
    return {
      enabled,
      punctuate: vi.fn(async (_lang: string, text: string) => {
        let out = '';
        const ends: number[] = [];
        for (let i = 0; i < text.length; i += every) {
          out += text.slice(i, i + every);
          if (i + every <= text.length) {
            out += '。';
            ends.push(out.length);
          }
        }
        return { text: out, sentenceEnds: ends, breakpoints: [...ends], model: 'fireredpunc' as const };
      }),
    };
  }

  /** Let the runtime's promise and SentenceStream's continuation settle. */
  async function flush(turns = 10) {
    for (let i = 0; i < turns; i++) await Promise.resolve();
  }

  /** A real connect, because that is where the session's one answer is frozen. */
  async function connectStage(client: OpenAITranslateGAClient, config = STAGE_CONFIG) {
    const p = client.connect(config);
    mockWs.readyState = 1;
    mockWs.onopen?.({});
    mockWs.onmessage?.({ data: JSON.stringify({ type: 'session.created' }) });
    await p;
  }

  function makeClient(options: {
    segmentation?: any; sentencesPerChunk?: number;
    sourcePauseMs?: number; translationPauseMs?: number;
  }) {
    return new OpenAITranslateGAClient('test-key', undefined, options);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    originalWebSocket = (globalThis as any).WebSocket;
    mockWs = {
      readyState: 0,
      send: vi.fn(),
      close: vi.fn(),
      onopen: null,
      onmessage: null,
      onerror: null,
      onclose: null,
    };
    (globalThis as any).WebSocket = vi.fn(function () { return mockWs; });
  });

  afterEach(() => {
    vi.useRealTimers();
    (globalThis as any).WebSocket = originalWebSocket;
  });

  const feedTo = (client: OpenAITranslateGAClient) => (event: unknown) => (client as any).handleServerEvent(event);
  const usersOf = (client: OpenAITranslateGAClient) => client.getConversationItems().filter((i) => i.role === 'user');
  const assistantsOf = (client: OpenAITranslateGAClient) => client.getConversationItems().filter((i) => i.role === 'assistant');

  // The pair arrives beside the runtime and the size, and survives connect —
  // it is no longer a field of the session config for connect() to re-read.
  it('keeps the pause pair across a real connect', async () => {
    const client = makeClient({ sourcePauseMs: 700, translationPauseMs: 2500 });
    client.setEventHandlers({} as ClientEventHandlers);
    await connectStage(client);
    expect((client as any).userSilenceTimeoutMs).toBe(700);
    expect((client as any).assistantSilenceTimeoutMs).toBe(2500);
  });

  it('seals an unpunctuated source item every N sentences, mid-delta', async () => {
    const runtime = markingRuntime(10);
    const client = makeClient({ segmentation: runtime, sentencesPerChunk: 2 });
    client.setEventHandlers({} as ClientEventHandlers);
    await connectStage(client);
    // 50 unpunctuated characters: past the 40-character gate for N = 2 in a
    // CJK language, and well inside MAX_MODEL_CHARS.
    feedTo(client)({ type: 'session.input_transcript.delta', delta: 'あ'.repeat(50) });
    await flush();

    expect(runtime.punctuate).toHaveBeenCalledTimes(1);
    const items = usersOf(client);
    expect(items.map((i) => i.formatted?.transcript)).toEqual([
      `${'あ'.repeat(10)}。${'あ'.repeat(10)}。`,
      'あ'.repeat(30),
    ]);
    expect(items[0].status).toBe('completed');
    expect(items[1].status).toBe('in_progress');
  });

  it('shows the inserted punctuation in the sealed item and leaves the pending one raw', async () => {
    const client = makeClient({ segmentation: markingRuntime(10), sentencesPerChunk: 2 });
    client.setEventHandlers({} as ClientEventHandlers);
    await connectStage(client);
    feedTo(client)({ type: 'session.input_transcript.delta', delta: 'あ'.repeat(50) });
    await flush();

    const [sealed, pending] = usersOf(client);
    expect((sealed.formatted?.transcript ?? '').split('。').length - 1).toBe(2);
    expect(pending.formatted?.transcript).not.toContain('。');
  });

  it('leaves the translation side unsegmented, so its audio keeps its bubble', async () => {
    // The stage is source-side only here: this client reports no per-item
    // timeline, so a split translation item cannot be told where its audio
    // ends, and the frames that belong to the sealed sentence would attach to
    // the next bubble — putting every later karaoke highlight one bubble out.
    const runtime = markingRuntime(10);
    const client = makeClient({ segmentation: runtime, sentencesPerChunk: 2 });
    const updates: Array<{ item: { id: string }; delta?: { audio?: Int16Array } }> = [];
    client.setEventHandlers({ onConversationUpdated: (u) => updates.push(u as never) } as ClientEventHandlers);
    await connectStage(client);
    const feed = feedTo(client);
    // Three sentence ends: enough for the stage to have sealed twice, had it
    // been running on this side.
    feed({ type: 'session.output_transcript.delta', delta: 'こんにちは。げんきですか。あいたかったです。またあいましょう' });
    await flush();
    feed({ type: 'session.output_audio.delta', delta: CONTENT_DELTA });
    await flush();

    const assistants = assistantsOf(client);
    expect(assistants.map((i) => i.formatted?.transcript)).toEqual([
      'こんにちは。げんきですか。あいたかったです。またあいましょう',
    ]);
    expect((client as any).assistantStream).toBeUndefined();
    const audioUpdate = updates.find((u) => u.delta?.audio instanceof Int16Array);
    expect(audioUpdate?.item.id).toBe(assistants[0].id);
  });

  it('still segments the source side while the translation side stays whole', async () => {
    const client = makeClient({ segmentation: markingRuntime(10), sentencesPerChunk: 2 });
    client.setEventHandlers({} as ClientEventHandlers);
    await connectStage(client);
    const feed = feedTo(client);
    feed({ type: 'session.input_transcript.delta', delta: 'あ'.repeat(50) });
    feed({ type: 'session.output_transcript.delta', delta: 'こんにちは。げんきですか。あいたかったです。またあいましょう' });
    await flush();

    expect(usersOf(client)).toHaveLength(2);
    expect(assistantsOf(client)).toHaveLength(1);
  });

  it("a silence timer closing a source item ends its stream, and the tail is that item's last text", async () => {
    // 1 s so the advance below is unambiguous; the threshold is not what this
    // test is about.
    const client = makeClient({ segmentation: markingRuntime(10), sentencesPerChunk: 2, sourcePauseMs: 1000 });
    client.setEventHandlers({} as ClientEventHandlers);
    await connectStage(client);
    feedTo(client)({ type: 'session.input_transcript.delta', delta: 'あ'.repeat(30) });
    await flush();
    const stream = (client as any).userStream;
    expect(stream).not.toBeNull();
    const endSpy = vi.spyOn(stream, 'end');

    // Two windows: the tail is mid-sentence, so the first expiry defers and
    // the second — with nothing new arrived — closes.
    vi.advanceTimersByTime(1001);
    vi.advanceTimersByTime(1001);

    expect(endSpy).toHaveBeenCalledTimes(1);
    expect((client as any).userStream).toBeNull();
    expect((client as any).userPending).toBe('');
    const [item] = usersOf(client);
    expect(item.status).toBe('completed');
    expect(item.formatted?.text).toBe('あ'.repeat(30));
  });

  it('a seal re-arms the silence timer for the item it opened', async () => {
    // The seal closes the item through completeUserItem, which clears the
    // timer the delta armed. Without a re-arm the remainder's item would
    // never close on its own.
    const client = makeClient({ segmentation: markingRuntime(10), sentencesPerChunk: 2, sourcePauseMs: 1000 });
    client.setEventHandlers({} as ClientEventHandlers);
    await connectStage(client);
    feedTo(client)({ type: 'session.input_transcript.delta', delta: 'あ'.repeat(50) });
    await flush();
    expect(usersOf(client)).toHaveLength(2);

    // Two windows: the remainder is mid-sentence, so the first expiry defers.
    vi.advanceTimersByTime(1001);
    vi.advanceTimersByTime(1001);
    expect(usersOf(client)[1].status).toBe('completed');
  });

  it('a source tail mid-sentence defers the pause for as long as the speaker keeps talking', async () => {
    // The bug this exists for: a live session cut "…成为商人或者是商队的向导，"
    // from "以及保镖。" ten seconds later, because the speaker rested at the
    // comma for longer than the pause setting.
    const client = makeClient({ segmentation: markingRuntime(10), sentencesPerChunk: 2, sourcePauseMs: 1000 });
    client.setEventHandlers({} as ClientEventHandlers);
    await connectStage(client);
    feedTo(client)({ type: 'session.input_transcript.delta', delta: 'あ'.repeat(20) });
    await flush();

    vi.advanceTimersByTime(1001);
    await flush();
    expect(usersOf(client)[0].status).toBe('in_progress');

    // The speaker carried on: the tail grew, so the next expiry defers again.
    feedTo(client)({ type: 'session.input_transcript.delta', delta: 'あ'.repeat(10) });
    await flush();
    vi.advanceTimersByTime(1001);
    await flush();
    expect(usersOf(client)[0].status).toBe('in_progress');

    // Nothing more arrived. The speaker has stopped, so the bubble closes.
    vi.advanceTimersByTime(1001);
    await flush();
    expect(usersOf(client)[0].status).toBe('completed');
    expect(usersOf(client)[0].formatted?.transcript).toBe('あ'.repeat(30));
  });

  it('a source tail that finished its sentence closes on the first pause', async () => {
    const client = makeClient({ segmentation: markingRuntime(10), sentencesPerChunk: 5, sourcePauseMs: 1000 });
    client.setEventHandlers({} as ClientEventHandlers);
    await connectStage(client);
    feedTo(client)({ type: 'session.input_transcript.delta', delta: 'これはテストです。' });
    await flush();

    vi.advanceTimersByTime(1001);
    await flush();
    expect(usersOf(client)[0].status).toBe('completed');
  });

  it('closes a mid-sentence source item on the first pause with the stage off, exactly as before', async () => {
    const client = makeClient({ sourcePauseMs: 1000 });
    client.setEventHandlers({} as ClientEventHandlers);
    await connectStage(client);
    feedTo(client)({ type: 'session.input_transcript.delta', delta: 'あ'.repeat(20) });
    await flush();

    vi.advanceTimersByTime(1001);
    await flush();
    expect(usersOf(client)[0].status).toBe('completed');
  });

  it('the translation timer keeps closing on the first pause: there is no stream on that side to consult', async () => {
    // Slice 4 removed this client's translation-side stream deliberately (see
    // the `userStream` field doc), so the assistant timer has no tail to read
    // and keeps today's behaviour, mid-sentence or not.
    const client = makeClient({ segmentation: markingRuntime(10), sentencesPerChunk: 2, translationPauseMs: 1000 });
    client.setEventHandlers({} as ClientEventHandlers);
    await connectStage(client);
    feedTo(client)({ type: 'session.output_transcript.delta', delta: 'い'.repeat(20) });
    await flush();

    vi.advanceTimersByTime(1001);
    await flush();
    expect(assistantsOf(client)[0].status).toBe('completed');
  });

  it('a runtime that is disabled at connect leaves the client exactly as it is today', async () => {
    const runtime = markingRuntime(10, false);
    const client = makeClient({ segmentation: runtime, sentencesPerChunk: 2 });
    client.setEventHandlers({} as ClientEventHandlers);
    await connectStage(client);
    feedTo(client)({ type: 'session.input_transcript.delta', delta: 'あ'.repeat(50) });
    await flush();

    expect(runtime.punctuate).not.toHaveBeenCalled();
    expect((client as any).userStream).toBeNull();
    expect(usersOf(client).map((i) => i.formatted?.transcript)).toEqual(['あ'.repeat(50)]);
  });

  it('freezes the runtime at connect: a later enable changes nothing', async () => {
    const late = { enabled: false, punctuate: vi.fn(async () => null) };
    const client = makeClient({ segmentation: late, sentencesPerChunk: 2 });
    client.setEventHandlers({} as ClientEventHandlers);
    await connectStage(client);
    late.enabled = true;
    feedTo(client)({ type: 'session.input_transcript.delta', delta: 'あ'.repeat(50) });
    await flush();

    expect((client as any).sessionSegmentation).toBeNull();
    expect(late.punctuate).not.toHaveBeenCalled();
    expect(usersOf(client).map((i) => i.formatted?.transcript)).toEqual(['あ'.repeat(50)]);
  });
});
