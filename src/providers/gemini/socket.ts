/**
 * The one seam Gemini's session side opens sockets through: `new
 * WebSocket(url)` in the app, a `FakeSocket` factory in tests. The key
 * rides in the URL's query, so no upgrade header is needed (spec: "Sockets
 * that need upgrade headers" does not apply). The seam itself is the
 * contract's, lifted at its fifth user (Stage 2 Palabra, choice 1);
 * re-exported, so this folder's importers are unchanged.
 */
export type OpenSocket = (url: string) => WebSocket;

export { nativeSocket, WS_OPEN } from '../../lib/contract/socket';
