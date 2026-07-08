import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the REST layer so the cascade can be tested without network.
vi.mock('./zoom/zoomApi', () => ({
  encodeWavDataUri: () => 'data:audio/wav;base64,AAAA',
  transcribe: vi.fn(async () => 'こんにちは'),
  translate: vi.fn(async () => 'Hello'),
  ZoomApiError: class extends Error {},
}));
// Worker is not available in jsdom — stub the module that creates it.
vi.mock('./zoom/createVadWorker', () => ({ createVadWorker: () => null }));

import { ZoomAIClient } from './ZoomAIClient';

describe('ZoomAIClient cascade', () => {
  let client: ZoomAIClient;
  const items: any[] = [];
  beforeEach(() => {
    items.length = 0;
    client = new ZoomAIClient('KEY', 'SECRET');
    client.setEventHandlers({ onConversationUpdated: (d) => items.push(d.item) });
    (client as any).currentConfig = { provider: 'zoom_ai', sourceLanguage: 'ja-JP', targetLanguages: ['en-US'] };
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
});
