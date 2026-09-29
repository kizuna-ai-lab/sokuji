/**
 * The plain socket seam (Stage 2 Palabra, choice 1). A browser that will
 * not open a socket throws an error that quotes its URL or its
 * subprotocols, and either may carry a credential: what leaves the seam
 * names the error, never repeats it.
 */
import { afterEach, describe, it, expect, vi } from 'vitest';
import { nativeSocket, WS_OPEN } from './socket';

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

const URL_WITH_KEY = 'wss://stream.example.test/v1/stream?token=plbr_seamKey0123456789';
const PROTOCOLS = ['realtime', 'openai-insecure-api-key.sk-proj-seamKey0123456789'];

/** A browser that will not open the socket, as Chromium refuses one: a DOMException named SyntaxError whose message quotes what it was given. */
class RefusingWebSocket {
  constructor(url: string, protocols?: string | string[]) {
    throw new DOMException(`Failed to construct 'WebSocket': The URL '${url}' or the subprotocol '${String(protocols)}' is invalid.`, 'SyntaxError');
  }
}

describe('the plain socket seam', () => {
  it('opens the socket the browser builds, with the URL alone, or with the subprotocols it is given', () => {
    const built: unknown[][] = [];
    class RecordingWebSocket {
      constructor(...args: unknown[]) {
        built.push(args);
      }
    }
    vi.stubGlobal('WebSocket', RecordingWebSocket);
    expect(nativeSocket(URL_WITH_KEY)).toBeInstanceOf(RecordingWebSocket);
    expect(nativeSocket(URL_WITH_KEY, PROTOCOLS)).toBeInstanceOf(RecordingWebSocket);
    // No subprotocols: the constructor is called with the URL alone, as the four copies called it.
    expect(built).toEqual([[URL_WITH_KEY], [URL_WITH_KEY, PROTOCOLS]]);
  });

  it("a socket the browser will not open is rethrown in fixed words, under the browser's error name, never its message", () => {
    const secrets = [URL_WITH_KEY, 'plbr_seamKey0123456789', PROTOCOLS[1]];
    // The control: the browser's own error quotes every one of them.
    const own = thrownBy(() => new RefusingWebSocket(URL_WITH_KEY, PROTOCOLS));
    for (const secret of secrets) expect(own.message).toContain(secret);

    vi.stubGlobal('WebSocket', RefusingWebSocket);
    for (const error of [thrownBy(() => nativeSocket(URL_WITH_KEY)), thrownBy(() => nativeSocket(URL_WITH_KEY, PROTOCOLS))]) {
      expect(error).toBeInstanceOf(Error);
      expect(error).toMatchObject({ name: 'SyntaxError', message: 'The browser would not open the socket (SyntaxError).' });
      expect((error as { cause?: unknown }).cause).toBeUndefined();
      for (const text of [error.message, String(error), error.stack ?? '']) {
        for (const secret of secrets) expect(text).not.toContain(secret);
      }
    }
  });

  it("reads WebSocket.OPEN as the constant it is", () => {
    expect(WS_OPEN).toBe(1);
  });
});
