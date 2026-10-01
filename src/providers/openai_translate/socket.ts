/**
 * The one seam OpenAI Translate's session side opens sockets through: `new
 * WebSocket(url, protocols)` in the app, a `FakeSocket` factory in tests.
 * The key rides in a subprotocol (choice 3), which a browser sets itself,
 * so no upgrade header is needed and F14 is not this provider's. The seam
 * itself is the contract's, lifted at its fifth user (Stage 2 Palabra,
 * choice 1); re-exported, so this folder's importers are unchanged.
 */
export type OpenSocket = (url: string, protocols: string[]) => WebSocket;

export { nativeSocket, WS_OPEN } from '../../lib/contract/socket';
