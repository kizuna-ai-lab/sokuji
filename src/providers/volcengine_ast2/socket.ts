/**
 * The one seam Doubao AST 2.0's session side and its check open sockets
 * through (as Soniox's and Gemini's `socket.ts`): `new WebSocket(url)` in
 * the app, a `FakeSocket` factory in tests. The credentials ride in the
 * URL's query (ruling 2 — measured with real credentials, 2026-09-28), so
 * no upgrade header is needed: F14, the header seam, is not built here.
 * The three move to `src/lib/contract/` with F14.
 */
export type OpenSocket = (url: string) => WebSocket;

/** Read at call time, so a test's `vi.stubGlobal('WebSocket')` is seen. */
export const nativeSocket: OpenSocket = (url) => new WebSocket(url);

/** `WebSocket.OPEN`, read as the constant it is: the socket may be an injected one. */
export const WS_OPEN = 1;
