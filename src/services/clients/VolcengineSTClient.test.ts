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
  async function connectStage(segmentation: unknown, sentencesPerChunk = 3) {
    const client = new VolcengineSTClient('access-key-id', 'secret-access-key', {
      segmentation: segmentation as never,
      sentencesPerChunk,
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

  describe('splitting a definite segment', () => {
    /** Marks a sentence end every 20 characters — terminals only, so the
     *  skeleton invariant holds. */
    function markingRuntime() {
      return {
        enabled: true,
        punctuate: vi.fn(async (_lang: string, text: string) => {
          let out = '';
          const ends: number[] = [];
          for (let i = 0; i < text.length; i += 20) {
            out += text.slice(i, i + 20);
            if (i + 20 <= text.length) { out += '。'; ends.push(out.length); }
          }
          return { text: out, sentenceEnds: ends, breakpoints: [...ends], model: 'fireredpunc' as const };
        }),
      };
    }

    /** One 20-character sentence, the unit markingRuntime() produces. */
    const ONE = `${'你'.repeat(20)}。`;

    it('cuts the segment into one item per N sentences, inside the server\'s own boundary', async () => {
      // Volcengine ST reports no per-item language of its own — this is the
      // twin of the Soniox case, on the client without `detectedLanguage`.
      const { client, updates } = await connectStage(markingRuntime(), 2);
      socket.onmessage?.({ data: definiteSubtitle(LONG_ZH) });
      await new Promise((resolve) => setTimeout(resolve, 0));

      const items = client.getConversationItems();
      expect(items.map((i) => i.formatted?.text)).toEqual([`${ONE}${ONE}`, ONE]);
      // The outer edge is the server's: the pieces rejoin to the Definite
      // subtitle exactly.
      expect(items.map((i) => i.formatted?.text).join('')).toBe(ONE.repeat(3));
      expect(items.map((i) => i.status)).toEqual(['completed', 'completed']);
      expect(items.map((i) => i.role)).toEqual(['user', 'user']);
      expect(items[0].id).not.toBe(items[1].id);
      // MainPanel sorts by createdAt, so the pieces must be strictly
      // increasing rather than sharing the segment's one stamp.
      expect(items[1].createdAt!).toBeGreaterThan(items[0].createdAt!);
      // Both pieces reach the listener, not just the first.
      expect(updates.filter((i) => i.status === 'completed')).toHaveLength(2);
    });

    it('keeps the same segment as one item under Auto', async () => {
      const { client } = await connectStage(markingRuntime(), 0);
      socket.onmessage?.({ data: definiteSubtitle(LONG_ZH) });
      await new Promise((resolve) => setTimeout(resolve, 0));

      const items = client.getConversationItems();
      expect(items).toHaveLength(1);
      expect(items[0].formatted?.text).toBe(ONE.repeat(3));
    });

    it('writes EVERY piece raw when Stop lands inside the punctuation wait', async () => {
      // The second subtitle already carries its own marks, so its answer is
      // ready at once — but the lane is still behind the first, whose model
      // never replies. Both must be written raw, and the second is four
      // sentences at N = 2: two bubbles.
      const runtime = { enabled: true, punctuate: vi.fn(() => new Promise<never>(() => {})) };
      const { client } = await connectStage(runtime, 2);
      const marked = `${'好'.repeat(10)}。`.repeat(4);
      socket.onmessage?.({ data: definiteSubtitle(LONG_ZH) });
      socket.onmessage?.({ data: definiteSubtitle(marked) });
      await Promise.resolve();

      await client.disconnect();

      expect(client.getConversationItems().map((i) => i.formatted?.text)).toEqual([
        LONG_ZH,
        `${'好'.repeat(10)}。${'好'.repeat(10)}。`,
        `${'好'.repeat(10)}。${'好'.repeat(10)}。`,
      ]);
    });
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
