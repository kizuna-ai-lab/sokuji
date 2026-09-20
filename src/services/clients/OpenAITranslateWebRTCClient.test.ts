import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { OpenAITranslateWebRTCClient } from './OpenAITranslateWebRTCClient';
import type { ClientEventHandlers, OpenAITranslateSessionConfig } from '../interfaces/IClient';

vi.mock('../EphemeralTokenService', () => ({
  EphemeralTokenService: { mintTranslationClientSecret: vi.fn(async () => 'ek_test') },
}));

/**
 * getInputFrequencies contract test — pins the IClient addition made for the
 * mic-waveform fallback (MainPanel's render loop falls back to the client's
 * own LOCAL-capture analyser for native-capture WebRTC sessions, since those
 * never start the shared recorder). Mirrors OpenAIWebRTCClient.test.ts's
 * equivalent case.
 */
describe('OpenAITranslateWebRTCClient.getInputFrequencies', () => {
  it('returns null before a local stream (and its analyser) exists', () => {
    // No session has connected (no getUserMedia call has happened yet), so
    // the bridge's LOCAL analyser has nothing to report.
    const client = new OpenAITranslateWebRTCClient({ apiKey: 'sk-test' });

    expect(client.getInputFrequencies()).toBeNull();
  });

  it('delegates to the bridge LOCAL analyser, not the remote/output one', () => {
    // getInputFrequencies() must forward to the bridge's getLocalFrequencies
    // (mic input), never to getFrequencies (remote/AI output) — the spy
    // proves forwarding rather than both coincidentally returning null.
    const client = new OpenAITranslateWebRTCClient({ apiKey: 'sk-test' });
    const bridge = (client as any).audioBridge;
    const localSpy = vi.spyOn(bridge, 'getLocalFrequencies')
      .mockReturnValue({ values: new Float32Array([0.5]) });
    const remoteSpy = vi.spyOn(bridge, 'getFrequencies');

    const result = client.getInputFrequencies();

    expect(localSpy).toHaveBeenCalledTimes(1);
    expect(remoteSpy).not.toHaveBeenCalled();
    expect(result).toEqual({ values: new Float32Array([0.5]) });
  });
});

describe('OpenAITranslateWebRTCClient with the segmentation stage', () => {
  /** Both sides CJK, so `gateChars` is 20 characters per sentence and the
   *  unpunctuated fixtures stay short. Neither is zh/yue, so SentenceStream's
   *  Chinese length fallback never fires. */
  const STAGE_CONFIG: OpenAITranslateSessionConfig = {
    provider: 'openai_translate',
    model: 'gpt-realtime-translate',
    sourceLanguage: 'ja',
    targetLanguage: 'ja',
  };

  /** The client's own 1.5 s pair timer. */
  const PAIR_SILENCE_MS = 1500;

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

  async function flush(turns = 10) {
    for (let i = 0; i < turns; i++) await Promise.resolve();
  }

  let originalRTC: unknown;
  let originalFetch: unknown;

  beforeEach(() => {
    vi.useFakeTimers();
    originalRTC = (globalThis as any).RTCPeerConnection;
    originalFetch = globalThis.fetch;
    (globalThis as any).RTCPeerConnection = class {
      iceGatheringState = 'complete';
      localDescription = { type: 'offer', sdp: 'v=0' };
      ontrack: unknown = null;
      oniceconnectionstatechange: unknown = null;
      onconnectionstatechange: unknown = null;
      addTrack() { /* no tracks in the fake local stream */ }
      createDataChannel() { return { readyState: 'open', send: vi.fn(), close: vi.fn() }; }
      async createOffer() { return { type: 'offer', sdp: 'v=0' }; }
      async setLocalDescription() { /* accepted */ }
      async setRemoteDescription() { /* accepted */ }
      addEventListener() { /* gathering is already complete */ }
      removeEventListener() { /* gathering is already complete */ }
      getSenders() { return []; }
      close() { /* nothing to tear down */ }
    };
    globalThis.fetch = vi.fn(async () => ({ ok: true, text: async () => 'v=0 answer' })) as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.useRealTimers();
    (globalThis as any).RTCPeerConnection = originalRTC;
    globalThis.fetch = originalFetch as typeof fetch;
  });

  async function connectStage(options: { segmentation?: any; sentencesPerChunk?: number }) {
    const client = new OpenAITranslateWebRTCClient({ apiKey: 'sk-test', ...options });
    client.setEventHandlers({} as ClientEventHandlers);
    vi.spyOn((client as any).audioBridge, 'getLocalStream').mockResolvedValue({ getTracks: () => [] });
    vi.spyOn((client as any).audioBridge, 'cleanup').mockImplementation(() => {});
    await client.connect(STAGE_CONFIG);
    return client;
  }

  const feedTo = (client: OpenAITranslateWebRTCClient) => (event: unknown) => (client as any).handleServerEvent(event);
  const usersOf = (client: OpenAITranslateWebRTCClient) => client.getConversationItems().filter((i) => i.role === 'user');
  const assistantsOf = (client: OpenAITranslateWebRTCClient) => client.getConversationItems().filter((i) => i.role === 'assistant');

  it('seals an unpunctuated source item every N sentences, mid-delta', async () => {
    const runtime = markingRuntime(10);
    const client = await connectStage({ segmentation: runtime, sentencesPerChunk: 2 });
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
    const client = await connectStage({ segmentation: markingRuntime(10), sentencesPerChunk: 2 });
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
    const client = await connectStage({ segmentation: markingRuntime(10), sentencesPerChunk: 2 });
    const updates: Array<{ item: { id: string }; delta?: { audio?: Int16Array } }> = [];
    client.setEventHandlers({ onConversationUpdated: (u) => updates.push(u as never) } as ClientEventHandlers);
    const feed = feedTo(client);
    // Three sentence ends: enough for the stage to have sealed twice, had it
    // been running on this side.
    feed({ type: 'session.output_transcript.delta', delta: 'こんにちは。げんきですか。あいたかったです。またあいましょう' });
    await flush();
    (client as any).handleBufferedAudio(new Int16Array(9600), { sequenceNumber: 1, timestamp: 1 });
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
    const client = await connectStage({ segmentation: markingRuntime(10), sentencesPerChunk: 2 });
    const feed = feedTo(client);
    feed({ type: 'session.input_transcript.delta', delta: 'あ'.repeat(50) });
    feed({ type: 'session.output_transcript.delta', delta: 'こんにちは。げんきですか。あいたかったです。またあいましょう' });
    await flush();

    expect(usersOf(client)).toHaveLength(2);
    expect(assistantsOf(client)).toHaveLength(1);
  });

  it('the 1.5 s pair timer still closes both sides, and each stream tail lands in its own item', async () => {
    const client = await connectStage({ segmentation: markingRuntime(10), sentencesPerChunk: 2 });
    const feed = feedTo(client);
    feed({ type: 'session.input_transcript.delta', delta: 'あ'.repeat(30) });
    feed({ type: 'session.output_transcript.delta', delta: 'い'.repeat(30) });
    await flush();

    vi.advanceTimersByTime(PAIR_SILENCE_MS + 1);

    expect((client as any).userStream).toBeNull();
    expect((client as any).currentPair).toBeNull();
    const [user] = usersOf(client);
    const [assistant] = assistantsOf(client);
    expect(user.status).toBe('completed');
    expect(user.formatted?.text).toBe('あ'.repeat(30));
    expect(assistant.status).toBe('completed');
    expect(assistant.formatted?.text).toBe('い'.repeat(30));
  });

  it('a runtime that is disabled at connect leaves the client exactly as it is today', async () => {
    const runtime = markingRuntime(10, false);
    const client = await connectStage({ segmentation: runtime, sentencesPerChunk: 2 });
    feedTo(client)({ type: 'session.input_transcript.delta', delta: 'あ'.repeat(50) });
    await flush();

    expect(runtime.punctuate).not.toHaveBeenCalled();
    expect((client as any).userStream).toBeNull();
    expect(usersOf(client).map((i) => i.formatted?.transcript)).toEqual(['あ'.repeat(50)]);
  });

  it('freezes the runtime at connect: a later enable changes nothing', async () => {
    const late = { enabled: false, punctuate: vi.fn(async () => null) };
    const client = await connectStage({ segmentation: late, sentencesPerChunk: 2 });
    late.enabled = true;
    feedTo(client)({ type: 'session.input_transcript.delta', delta: 'あ'.repeat(50) });
    await flush();

    expect((client as any).sessionSegmentation).toBeNull();
    expect(late.punctuate).not.toHaveBeenCalled();
    expect(usersOf(client).map((i) => i.formatted?.transcript)).toEqual(['あ'.repeat(50)]);
  });
});
