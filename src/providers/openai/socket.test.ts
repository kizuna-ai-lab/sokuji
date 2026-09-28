/**
 * OpenAI Realtime's socket seam. A browser that will not open a socket for
 * a subprotocol it finds invalid throws an error that quotes it, and the
 * second subprotocol carries the key: what leaves the seam names the error,
 * never repeats it.
 */
import { afterEach, describe, it, expect, vi } from 'vitest';
import { nativeSocket } from './socket';
import { configFor, KEY, RefusingWebSocket } from './testing';
import { realtimeProtocols, realtimeUrl } from './wire';

afterEach(() => {
  vi.unstubAllGlobals();
});

function thrownBy(f: () => unknown): Error {
  try {
    f();
  } catch (error) {
    return error as Error;
  }
  throw new Error('nothing was thrown');
}

describe("OpenAI Realtime's socket seam", () => {
  it('opens the socket the browser builds, for the URL and the subprotocols it is given', () => {
    const built: Array<[string, unknown]> = [];
    class RecordingWebSocket {
      constructor(url: string, protocols: unknown) {
        built.push([url, protocols]);
      }
    }
    vi.stubGlobal('WebSocket', RecordingWebSocket);
    const socket = nativeSocket(realtimeUrl(configFor()), realtimeProtocols(KEY));
    expect(socket).toBeInstanceOf(RecordingWebSocket);
    expect(built).toEqual([[realtimeUrl(configFor()), realtimeProtocols(KEY)]]);
  });

  it("a socket the browser will not open is rethrown in fixed words, under the browser's error name, never its message (choice 7)", () => {
    const protocols = realtimeProtocols(KEY);
    const secrets = [KEY.apiKey, protocols[1], 'openai-insecure-api-key'];
    // The control: the browser's own error quotes every one of them.
    const own = thrownBy(() => new RefusingWebSocket(realtimeUrl(configFor()), protocols));
    for (const secret of secrets) expect(own.message).toContain(secret);

    vi.stubGlobal('WebSocket', RefusingWebSocket);
    const error = thrownBy(() => nativeSocket(realtimeUrl(configFor()), protocols));
    expect(error).not.toBe(own);
    expect(error).toMatchObject({ name: 'SyntaxError', message: 'The browser would not open the socket (SyntaxError).' });
    expect((error as { cause?: unknown }).cause).toBeUndefined();
    for (const text of [error.message, String(error), error.stack ?? '']) {
      for (const secret of secrets) expect(text).not.toContain(secret);
    }
  });
});
