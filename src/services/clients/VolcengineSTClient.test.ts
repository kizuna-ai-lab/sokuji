import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ConversationItem, VolcengineSTSessionConfig } from '../interfaces/IClient';

// The client imports i18n only for its validation messages; the locale bundle
// is irrelevant to everything under test here.
vi.mock('../../locales', () => ({ default: { t: (key: string) => key } }));

const { VolcengineSTClient } = await import('./VolcengineSTClient');

const CONFIG: VolcengineSTSessionConfig = {
  provider: 'volcengine_st',
  model: 'speech-translate-v1',
  sourceLanguage: 'zh',
  targetLanguages: ['en'],
};

/** 60 Chinese characters — past gateChars('zh', 3) = 60 — with nothing to split
 *  on, which is exactly the segment the stage exists for. */
const LONG_ZH = '你'.repeat(60);

interface FakeSocket {
  readyState: number;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  onopen: ((e: unknown) => void) | null;
  onmessage: ((e: { data: string }) => void) | null;
  onerror: ((e: unknown) => void) | null;
  onclose: ((e: unknown) => void) | null;
}

describe('VolcengineSTClient with the segmentation stage', () => {
  let socket: FakeSocket;
  let originalWebSocket: unknown;

  beforeEach(() => {
    originalWebSocket = (globalThis as any).WebSocket;
    socket = {
      readyState: 0,
      send: vi.fn(),
      close: vi.fn(),
      onopen: null,
      onmessage: null,
      onerror: null,
      onclose: null,
    };
    (globalThis as any).WebSocket = vi.fn(function () { return socket; });
  });

  afterEach(() => {
    (globalThis as any).WebSocket = originalWebSocket;
  });

  /** A real connect, because that is where the session's one answer is frozen.
   *  Only the V4 signature is stubbed — it needs WebCrypto and signs nothing
   *  this test looks at. */
  async function connectStage(segmentation: unknown) {
    const client = new VolcengineSTClient('access-key-id', 'secret-access-key', {
      segmentation: segmentation as never,
      sentencesPerChunk: 3,
    });
    vi.spyOn((client as any).signer, 'generateSignedUrl').mockResolvedValue('wss://test.invalid/path');
    const updates: ConversationItem[] = [];
    client.setEventHandlers({ onConversationUpdated: ({ item }) => updates.push(item) });
    const connecting = client.connect(CONFIG);
    // The socket is constructed after the signer's await resolves.
    for (let i = 0; i < 10 && socket.onopen === null; i++) await Promise.resolve();
    socket.readyState = 1;
    socket.onopen?.({});
    await connecting;
    return { client, updates };
  }

  function definiteSubtitle(text: string) {
    return JSON.stringify({
      Subtitle: { Text: text, BeginTime: 0, EndTime: 1000, Definite: true, Language: 'zh', Sequence: 1 },
    });
  }

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

  it('writes the segment raw when Stop lands inside the punctuation wait', async () => {
    // MainPanel's teardown is `await client.disconnect()` then
    // `setItems(client.getConversationItems())`. A definite segment still
    // waiting for the model at that moment is the user's last sentence, and
    // without the raw write it never reaches the list at all.
    const { runtime } = gatedRuntime();
    const { client } = await connectStage(runtime);
    socket.onmessage?.({ data: definiteSubtitle(LONG_ZH) });
    await Promise.resolve();

    await client.disconnect();

    const items = client.getConversationItems();
    expect(items).toHaveLength(1);
    expect(items[0].role).toBe('user');
    expect(items[0].status).toBe('completed');
    expect(items[0].formatted?.text).toBe(LONG_ZH);
  });

  it('drops the punctuated answer that lands after that raw write', async () => {
    const { runtime, release } = gatedRuntime();
    const { client, updates } = await connectStage(runtime);
    socket.onmessage?.({ data: definiteSubtitle(LONG_ZH) });
    await Promise.resolve();
    await client.disconnect();
    const seenAtStop = updates.length;

    release();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(client.getConversationItems()).toHaveLength(1);
    expect(client.getConversationItems()[0].formatted?.text).toBe(LONG_ZH);
    expect(updates).toHaveLength(seenAtStop);
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
    const { client } = await connectStage(runtime);
    socket.onmessage?.({ data: definiteSubtitle(LONG_ZH) });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const items = client.getConversationItems();
    expect(items).toHaveLength(1);
    expect(items[0].formatted?.text).toBe(`${LONG_ZH}。`);
  });
});
