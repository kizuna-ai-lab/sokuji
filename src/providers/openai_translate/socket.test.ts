/**
 * OpenAI Translate's socket seam. A browser that will not open a socket for
 * a subprotocol it finds invalid throws an error that quotes it, and the
 * second subprotocol carries the key: what leaves the seam names the error,
 * never repeats it.
 */
import { afterEach, describe, it, expect, vi } from 'vitest';
import { nativeSocket } from './socket';
import { configFor, KEY, RefusingWebSocket } from './testing';
import { translateProtocols, translateUrl } from './wire';

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

describe("OpenAI Translate's socket seam", () => {
  it('opens the socket the browser builds, for the URL and the subprotocols it is given', () => {
    const built: Array<[string, unknown]> = [];
    class RecordingWebSocket {
      constructor(url: string, protocols: unknown) {
        built.push([url, protocols]);
      }
    }
    vi.stubGlobal('WebSocket', RecordingWebSocket);
    const socket = nativeSocket(translateUrl(configFor()), translateProtocols(KEY));
    expect(socket).toBeInstanceOf(RecordingWebSocket);
    expect(built).toEqual([[translateUrl(configFor()), translateProtocols(KEY)]]);
  });

  it("a socket the browser will not open is rethrown in fixed words, under the browser's error name, never its message (choice 3)", () => {
    const protocols = translateProtocols(KEY);
    const secrets = [KEY.apiKey, protocols[1], 'openai-insecure-api-key'];
    // The control: the browser's own error quotes every one of them.
    const own = thrownBy(() => new RefusingWebSocket(translateUrl(configFor()), protocols));
    for (const secret of secrets) expect(own.message).toContain(secret);

    vi.stubGlobal('WebSocket', RefusingWebSocket);
    const error = thrownBy(() => nativeSocket(translateUrl(configFor()), protocols));
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBe(own);
    // The name stays: the start words a refusal by the thrown name.
    expect(error).toMatchObject({ name: 'SyntaxError', message: 'The browser would not open the socket (SyntaxError).' });
    expect((error as { cause?: unknown }).cause).toBeUndefined();
    for (const text of [error.message, String(error), error.stack ?? '']) {
      for (const secret of secrets) expect(text).not.toContain(secret);
    }
  });
});
