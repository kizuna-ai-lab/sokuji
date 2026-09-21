import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { OpenAISessionConfig } from '../interfaces/IClient';

/**
 * The official SDK's realtime socket, reduced to the four things the client
 * touches: `on`, `send`, `close` and `socket.addEventListener`. Tests emit
 * server events by calling the handlers the client registered.
 */
class FakeRealtimeSocket {
  static latest: FakeRealtimeSocket | null = null;
  handlers = new Map<string, Array<(event: unknown) => void>>();
  socket = { addEventListener: vi.fn(), close: vi.fn() };
  send = vi.fn();
  close = vi.fn();

  constructor() {
    FakeRealtimeSocket.latest = this;
  }

  on(type: string, handler: (event: unknown) => void): void {
    const list = this.handlers.get(type) ?? [];
    list.push(handler);
    this.handlers.set(type, list);
  }

  emit(type: string, event: unknown): void {
    for (const handler of this.handlers.get(type) ?? []) handler(event);
  }
}

vi.mock('openai/realtime/websocket', () => ({
  OpenAIRealtimeWebSocket: vi.fn(function () { return new FakeRealtimeSocket(); }),
}));

const { OpenAIGAClient } = await import('./OpenAIGAClient');

const CONFIG: OpenAISessionConfig = {
  provider: 'openai',
  model: 'gpt-realtime',
  sourceLanguage: 'zh',
  targetLanguage: 'en',
};

/** 60 Chinese characters — past gateChars('zh', 3) = 60 — with nothing to split
 *  on, which is exactly the segment the stage exists for. */
const LONG_ZH = '你'.repeat(60);

/** A runtime whose answer is held until the test releases it. */
function gatedRuntime() {
  let release: (() => void) | null = null;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const runtime = {
    enabled: true,
    punctuate: vi.fn(async (_lang: string, text: string) => {
      await gate;
      return {
        text: `${text}。`,
        sentenceEnds: [text.length + 1],
        breakpoints: [text.length + 1],
        model: 'fireredpunc' as const,
      };
    }),
  };
  return { runtime, release: () => release!() };
}

describe('OpenAIGAClient with the segmentation stage', () => {
  beforeEach(() => {
    FakeRealtimeSocket.latest = null;
  });

  /** A real connect, because that is where the session's one answer is frozen. */
  async function connectStage(segmentation: unknown) {
    const client = new OpenAIGAClient('sk-test', {
      segmentation: segmentation as never,
      sentencesPerChunk: 3,
    });
    client.setEventHandlers({});
    const connecting = client.connect(CONFIG);
    for (let i = 0; i < 10 && FakeRealtimeSocket.latest === null; i++) await Promise.resolve();
    const rt = FakeRealtimeSocket.latest!;
    rt.emit('session.created', { type: 'session.created' });
    await connecting;
    return { client, rt };
  }

  it('writes the user transcript raw when Stop lands inside the punctuation wait', async () => {
    // Nothing else ever fills a user bubble on this provider: the transcript
    // arrives once, in the completed event. Dropping the deferred write leaves
    // an empty bubble where the user's last sentence should be.
    const { runtime } = gatedRuntime();
    const { client, rt } = await connectStage(runtime);
    rt.emit('input_audio_buffer.committed', { item_id: 'user-1' });
    rt.emit('conversation.item.input_audio_transcription.completed', {
      item_id: 'user-1',
      transcript: LONG_ZH,
    });
    await Promise.resolve();

    await client.disconnect();

    const items = client.getConversationItems();
    expect(items).toHaveLength(1);
    expect(items[0].formatted?.transcript).toBe(LONG_ZH);
    expect(items[0].formatted?.text).toBe(LONG_ZH);
  });

  it('still completes the assistant item when Stop lands inside its punctuation wait', async () => {
    const { runtime } = gatedRuntime();
    const { client, rt } = await connectStage(runtime);
    rt.emit('response.output_item.added', {
      item: { id: 'asst-1', type: 'message', role: 'assistant' },
      response_id: 'resp-1',
    });
    rt.emit('response.output_audio_transcript.delta', { item_id: 'asst-1', delta: LONG_ZH });
    rt.emit('response.done', {
      response: { id: 'resp-1', output: [{ id: 'asst-1' }] },
    });
    await Promise.resolve();

    await client.disconnect();

    const assistant = client.getConversationItems().find((i) => i.id === 'asst-1');
    expect(assistant).toBeDefined();
    expect(assistant!.status).toBe('completed');
    expect(assistant!.formatted?.transcript).toBe(LONG_ZH);
  });

  it('drops the punctuated answer that lands after that raw write', async () => {
    const { runtime, release } = gatedRuntime();
    const { client, rt } = await connectStage(runtime);
    rt.emit('input_audio_buffer.committed', { item_id: 'user-1' });
    rt.emit('conversation.item.input_audio_transcription.completed', {
      item_id: 'user-1',
      transcript: LONG_ZH,
    });
    await Promise.resolve();
    await client.disconnect();

    release();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(client.getConversationItems()[0].formatted?.transcript).toBe(LONG_ZH);
  });

  it('still punctuates a definite segment when the session stays open', async () => {
    const runtime = {
      enabled: true,
      punctuate: vi.fn(async (_lang: string, text: string) => ({
        text: `${text}。`,
        sentenceEnds: [text.length + 1],
        breakpoints: [text.length + 1],
        model: 'fireredpunc' as const,
      })),
    };
    const { client, rt } = await connectStage(runtime);
    rt.emit('input_audio_buffer.committed', { item_id: 'user-1' });
    rt.emit('conversation.item.input_audio_transcription.completed', {
      item_id: 'user-1',
      transcript: LONG_ZH,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(client.getConversationItems()[0].formatted?.transcript).toBe(`${LONG_ZH}。`);
  });
});
