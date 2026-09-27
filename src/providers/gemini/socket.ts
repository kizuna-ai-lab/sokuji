/**
 * The one seam Gemini's session side opens sockets through (as Soniox's
 * `socket.ts`): `new WebSocket(url)` in the app, a `FakeSocket` factory in
 * tests. The key rides in the URL's query, so no upgrade header is needed
 * (spec: "Sockets that need upgrade headers" does not apply). Both move to
 * `src/lib/contract/` with F14.
 */
export type OpenSocket = (url: string) => WebSocket;

/** Read at call time, so a test's `vi.stubGlobal('WebSocket')` is seen. */
export const nativeSocket: OpenSocket = (url) => new WebSocket(url);

/** `WebSocket.OPEN`, read as the constant it is: the socket may be an injected one. */
export const WS_OPEN = 1;
