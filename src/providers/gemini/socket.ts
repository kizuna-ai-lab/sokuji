/**
 * The one seam Gemini's session side opens sockets through (as Soniox's
 * `socket.ts`): `new WebSocket(url)` in the app, a `FakeSocket` factory in
 * tests. The key rides in the URL's query, so no upgrade header is needed
 * (spec: "Sockets that need upgrade headers" does not apply). Both move to
 * `src/lib/contract/` with F14.
 */
export type OpenSocket = (url: string) => WebSocket;

/** Read at call time, so a test's `vi.stubGlobal('WebSocket')` is seen. */
export const nativeSocket: OpenSocket = (url) => {
  try {
    return new WebSocket(url);
  } catch (e) {
    // The URL carries a credential, and a browser that refuses the socket quotes it in its message: the message is dropped, the error's name kept.
    const name = (e as Error).name;
    throw Object.assign(new Error(`The browser would not open the socket (${name}).`), { name });
  }
};

/** `WebSocket.OPEN`, read as the constant it is: the socket may be an injected one. */
export const WS_OPEN = 1;
