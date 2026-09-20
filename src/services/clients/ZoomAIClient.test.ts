import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the REST layer so the cascade can be tested without network.
vi.mock('./zoom/zoomApi', () => ({
  encodeWavDataUri: () => 'data:audio/wav;base64,AAAA',
  transcribe: vi.fn(async () => 'こんにちは'),
  translate: vi.fn(async () => 'Hello'),
  ZoomApiError: class extends Error {
    status: number;
    reason?: string;
    constructor(status: number, message: string, reason?: string) {
      super(message);
      this.name = 'ZoomApiError';
      this.status = status;
      this.reason = reason;
    }
  },
}));
// Worker is not available in jsdom — stub the module that creates it.
vi.mock('./zoom/createVadWorker', () => ({ createVadWorker: () => null }));

import { ZoomAIClient } from './ZoomAIClient';
import { transcribe, translate, ZoomApiError } from './zoom/zoomApi';

describe('ZoomAIClient cascade', () => {
  let client: ZoomAIClient;
  const items: any[] = [];
  beforeEach(() => {
    items.length = 0;
    vi.mocked(transcribe).mockReset().mockResolvedValue('こんにちは');
    vi.mocked(translate).mockReset().mockResolvedValue('Hello');
    client = new ZoomAIClient('KEY', 'SECRET');
    client.setEventHandlers({ onConversationUpdated: (d) => items.push(d.item) });
    (client as any).currentConfig = { provider: 'zoom_ai', sourceLanguage: 'ja-JP', targetLanguages: ['en-US'] };
    // handleUtterance now no-ops unless the client is connected (guards added
    // to avoid processing utterances after disconnect races) — tests call
    // handleUtterance directly without going through connect(), so simulate
    // the post-connect state here.
    (client as any).connected = true;
  });

  it('emits a user (transcript) then assistant (translation) item for an utterance', async () => {
    await (client as any).handleUtterance(new Float32Array(1600));
    const roles = items.map((i) => i.role);
    expect(roles).toEqual(['user', 'assistant']);
    expect(items[0].formatted.transcript).toBe('こんにちは');
    expect(items[1].formatted.transcript).toBe('Hello');
    expect(items[1].status).toBe('completed');
  });

  it('reports provider id', () => {
    expect(client.getProvider()).toBe('zoom_ai');
  });

  it('emits no conversation items when the transcript is empty', async () => {
    vi.mocked(transcribe).mockResolvedValueOnce('');
    await (client as any).handleUtterance(new Float32Array(1600));
    expect(items).toEqual([]);
    expect(vi.mocked(translate)).not.toHaveBeenCalled();
  });

  it('emits an error item and calls onError when transcribe throws', async () => {
    const onError = vi.fn();
    client.setEventHandlers({ onConversationUpdated: (d) => items.push(d.item), onError });
    vi.mocked(transcribe).mockRejectedValueOnce(new ZoomApiError(500, 'boom', 'internal_error'));

    await (client as any).handleUtterance(new Float32Array(1600));

    expect(onError).toHaveBeenCalledTimes(1);
    const errorItems = items.filter((i) => i.role === 'system' && i.type === 'error');
    expect(errorItems).toHaveLength(1);
    expect(errorItems[0].formatted.text).toContain('boom');
  });
});

describe('ZoomAIClient sentence segmentation', () => {
  /** Four sentences on each side, so a size of 3 or 1 would visibly cut. */
  const FOUR_JA = 'これは一つ。これは二つ。これは三つ。これは四つ。';
  const FOUR_EN = 'One here. Two here. Three here. Four here.';
  const CONFIG: any = { provider: 'zoom_ai', sourceLanguage: 'ja-JP', targetLanguages: ['en-US'] };

  /** A runtime that would mark a sentence end every 10 characters — never
   *  reached by these texts, which already carry their own terminals. */
  function markingRuntime() {
    return { enabled: true, punctuate: vi.fn(async () => null) };
  }

  async function staged(options: { segmentation?: any; sentencesPerChunk?: number }) {
    const client = new ZoomAIClient('KEY', 'SECRET', options);
    const items: any[] = [];
    client.setEventHandlers({ onConversationUpdated: (d) => items.push(d.item) });
    await client.connect(CONFIG);
    return { client, items };
  }

  beforeEach(() => {
    vi.mocked(transcribe).mockReset().mockResolvedValue(FOUR_JA);
    vi.mocked(translate).mockReset().mockResolvedValue(FOUR_EN);
  });

  // The stored size is global and resolved without consulting the mode, so a
  // session with the stage OFF still receives one. Off must behave exactly as
  // it does on main: one bubble per side, whatever the size says.
  it.each([3, 1])('splits nothing with the stage off, at a stored size of %i', async (size) => {
    const { client, items } = await staged({ sentencesPerChunk: size });
    await (client as any).handleUtterance(new Float32Array(1600));

    expect(items.map((i) => i.role)).toEqual(['user', 'assistant']);
    expect(items[0].formatted.transcript).toBe(FOUR_JA);
    expect(items[1].formatted.transcript).toBe(FOUR_EN);
  });

  it('never calls the model with the stage off', async () => {
    const runtime = markingRuntime();
    // Disabled at connect: R2 freezes that answer for the session.
    (runtime as { enabled: boolean }).enabled = false;
    const { client } = await staged({ segmentation: runtime, sentencesPerChunk: 1 });
    await (client as any).handleUtterance(new Float32Array(1600));
    expect(runtime.punctuate).not.toHaveBeenCalled();
  });

  it('still cuts inside the utterance when the stage is on', async () => {
    const { client, items } = await staged({ segmentation: markingRuntime(), sentencesPerChunk: 3 });
    await (client as any).handleUtterance(new Float32Array(1600));

    // Four sentences at N = 3: three then the remainder, on both sides.
    expect(items.map((i) => i.role)).toEqual(['user', 'user', 'assistant', 'assistant']);
    expect(items.map((i) => i.formatted.transcript)).toEqual([
      'これは一つ。これは二つ。これは三つ。', 'これは四つ。',
      'One here. Two here. Three here.', 'Four here.',
    ]);
    // One stamp per segment, so the panel's stable sort keeps the transcript's
    // two pieces ahead of the translation's rather than interleaving them.
    expect(items[1].createdAt).toBe(items[0].createdAt);
    expect(items[3].createdAt).toBe(items[2].createdAt);
  });
});
