/**
 * The plain socket seam a provider's session side opens its sockets
 * through (F9's convention): `new WebSocket(url)` — or `(url, protocols)`,
 * for a provider that authenticates by subprotocol — in the app, a
 * `FakeSocket` factory in tests. Gemini's, Doubao AST 2.0's, OpenAI
 * Translate's and OpenAI Realtime's `socket.ts` each held a copy; lifted
 * at its fifth user, Palabra (Stage 2 Palabra, choice 1), the four copies
 * re-export it, each keeping the `OpenSocket` its adapter calls (with
 * subprotocols or without). Soniox's own seam stays its own: it rethrows
 * nothing, and the old client's streams read it. F14, the header seam,
 * joins this one when OpenAI Live builds it.
 */
export type OpenSocket = (url: string, protocols?: string[]) => WebSocket;

/** Read at call time, so a test's `vi.stubGlobal('WebSocket')` is seen. */
export const nativeSocket: OpenSocket = (url, protocols) => {
  try {
    return protocols === undefined ? new WebSocket(url) : new WebSocket(url, protocols);
  } catch (e) {
    // A browser that refuses a socket quotes its URL or its subprotocols, and either may carry a credential: the message is dropped, the error's name kept (a start words a refusal by it).
    const name = (e as Error).name;
    throw Object.assign(new Error(`The browser would not open the socket (${name}).`), { name });
  }
};

/** `WebSocket.OPEN`, read as the constant it is: the socket may be an injected one. */
export const WS_OPEN = 1;
