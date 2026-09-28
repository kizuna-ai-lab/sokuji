/**
 * Doubao AST 2.0's socket seam. A browser that will not open a socket throws
 * an error that quotes the URL, and both of Doubao's URLs carry a credential
 * in the query: what leaves the seam names the error, never repeats it.
 */
import { afterEach, describe, it, expect, vi } from 'vitest';
import { nativeSocket } from './socket';
import { API_KEY, APP_KEY, RefusingWebSocket } from './testing';
import { AST2_ENDPOINT, ast2Url } from './wire';

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

describe("Doubao AST 2.0's socket seam", () => {
  it('opens the socket the browser builds, for the URL it is given', () => {
    const built: string[] = [];
    class RecordingWebSocket {
      constructor(url: string) {
        built.push(url);
      }
    }
    vi.stubGlobal('WebSocket', RecordingWebSocket);
    const socket = nativeSocket(ast2Url(API_KEY));
    expect(socket).toBeInstanceOf(RecordingWebSocket);
    expect(built).toEqual([ast2Url(API_KEY)]);
  });

  it.each([
    ['App ID + Access Token', APP_KEY],
    ['API key', API_KEY],
  ] as const)("a socket the browser will not open is rethrown in fixed words, under the browser's error name, never its message (%s)", (_mode, k) => {
    const url = ast2Url(k);
    const secrets = [url, AST2_ENDPOINT, 'api_', ...(k.kind === 'app' ? [k.appKey, k.accessKey] : [k.apiKey])];
    // The control: the browser's own error quotes every one of them.
    const own = thrownBy(() => new RefusingWebSocket(url));
    for (const secret of secrets) expect(own.message).toContain(secret);

    vi.stubGlobal('WebSocket', RefusingWebSocket);
    const error = thrownBy(() => nativeSocket(url));
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBe(own);
    // The name stays: a caller that words a refusal by the thrown name still names the browser's.
    expect(error).toMatchObject({ name: 'SyntaxError', message: 'The browser would not open the socket (SyntaxError).' });
    expect((error as { cause?: unknown }).cause).toBeUndefined();
    for (const text of [error.message, String(error), error.stack ?? '']) {
      for (const secret of secrets) expect(text).not.toContain(secret);
    }
  });
});
