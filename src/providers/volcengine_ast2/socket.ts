/**
 * The one seam Doubao AST 2.0's session side and its check open sockets
 * through: `new WebSocket(url)` in the app, a `FakeSocket` factory in
 * tests. The credentials ride in the URL's query (ruling 2 — measured with
 * real credentials, 2026-09-28), so no upgrade header is needed: F14, the
 * header seam, is not built here. The seam itself is the contract's, lifted
 * at its fifth user (Stage 2 Palabra, choice 1); re-exported, so this
 * folder's importers are unchanged.
 */
export type OpenSocket = (url: string) => WebSocket;

export { nativeSocket, WS_OPEN } from '../../lib/contract/socket';
