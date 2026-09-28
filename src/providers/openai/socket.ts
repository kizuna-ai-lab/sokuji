/**
 * The one seam OpenAI Realtime's session side opens sockets through, copied
 * from OpenAI Translate's (choice 7): `new WebSocket(url, protocols)` in
 * the app, a `FakeSocket` factory in tests. The key rides in a subprotocol,
 * which a browser sets itself, so no upgrade header is needed and F14 is
 * not this provider's; this seam moves to `src/lib/contract/` with the
 * others when F14 lands.
 */
export type OpenSocket = (url: string, protocols: string[]) => WebSocket;

/** Read at call time, so a test's `vi.stubGlobal('WebSocket')` is seen. */
export const nativeSocket: OpenSocket = (url, protocols) => {
  try {
    return new WebSocket(url, protocols);
  } catch (e) {
    // A key that is no valid subprotocol token makes the browser quote the subprotocol, the key in it: the message is dropped, the error's name kept (the start words a refusal by it).
    const name = (e as Error).name;
    throw Object.assign(new Error(`The browser would not open the socket (${name}).`), { name });
  }
};

/** `WebSocket.OPEN`, read as the constant it is: the socket may be an injected one. */
export const WS_OPEN = 1;
