/**
 * The socket against the SDK the old client dialled through (choice 7):
 * `OpenAIRealtimeWebSocket` (`openai` 6.39.1), built as `OpenAIGAClient`
 * built it (`OpenAIGAClient.ts:144-150`), dials exactly `realtimeUrl` with
 * exactly `realtimeProtocols`. The SDK opens a global `WebSocket`, stubbed
 * here with `FakeSocket`: it connects nowhere. The one value import of the
 * SDK's realtime socket outside the old client.
 */
import { afterEach, describe, it, expect, vi } from 'vitest';
import { OpenAIRealtimeWebSocket } from 'openai/realtime/websocket';
import { FakeSocket } from '../../lib/contract/testing/fakeSocket';
import { configFor, KEY } from './testing';
import { realtimeProtocols, realtimeUrl } from './wire';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OpenAI Realtime's socket against the SDK's", () => {
  it.each(['gpt-realtime-2.1-mini', 'gpt-realtime-2.1', 'gpt-realtime-mini'])('dials %s where the SDK does, with the subprotocols it sends', (model) => {
    const opened: FakeSocket[] = [];
    vi.stubGlobal('WebSocket', class extends FakeSocket {
      constructor(url: string, protocols?: string | string[]) {
        super(url, protocols);
        opened.push(this);
      }
    });
    // A plain object standing in for a client, as the old client passed one: the SDK reads `apiKey` and `baseURL` from it.
    new OpenAIRealtimeWebSocket({ model, dangerouslyAllowBrowser: true }, { apiKey: KEY.apiKey, baseURL: 'https://api.openai.com/v1' } as never);
    expect(opened).toHaveLength(1);
    const c = { ...configFor(), model };
    expect(opened[0].url).toBe(realtimeUrl(c));
    expect(opened[0].protocols).toEqual(realtimeProtocols(KEY));
  });
});
