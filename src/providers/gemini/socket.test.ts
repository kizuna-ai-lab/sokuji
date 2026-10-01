/**
 * Gemini's socket seam. A browser that will not open a socket throws an error
 * that quotes the URL, and the Live URL carries the key in its query: what
 * leaves the seam names the error, never repeats it.
 */
import { afterEach, describe, it, expect, vi } from 'vitest';
import { nativeSocket } from './socket';
import { KEY, RefusingWebSocket } from './testing';
import { GEMINI_LIVE_URL, liveUrl } from './wire';

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

describe("Gemini's socket seam", () => {
  it('opens the socket the browser builds, for the URL it is given', () => {
    const built: string[] = [];
    class RecordingWebSocket {
      constructor(url: string) {
        built.push(url);
      }
    }
    vi.stubGlobal('WebSocket', RecordingWebSocket);
    const socket = nativeSocket(liveUrl(KEY.apiKey));
    expect(socket).toBeInstanceOf(RecordingWebSocket);
    expect(built).toEqual([liveUrl(KEY.apiKey)]);
  });

  it("a socket the browser will not open is rethrown in fixed words, under the browser's error name, never its message", () => {
    const url = liveUrl(KEY.apiKey);
    const secrets = [url, GEMINI_LIVE_URL, KEY.apiKey];
    // The control: the browser's own error quotes every one of them.
    const own = thrownBy(() => new RefusingWebSocket(url));
    for (const secret of secrets) expect(own.message).toContain(secret);

    vi.stubGlobal('WebSocket', RefusingWebSocket);
    const error = thrownBy(() => nativeSocket(url));
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBe(own);
    expect(error).toMatchObject({ name: 'SyntaxError', message: 'The browser would not open the socket (SyntaxError).' });
    expect((error as { cause?: unknown }).cause).toBeUndefined();
    for (const text of [error.message, String(error), error.stack ?? '']) {
      for (const secret of secrets) expect(text).not.toContain(secret);
    }
  });
});
