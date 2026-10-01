/**
 * The one seam Soniox's session side opens sockets through (F9's
 * convention): `new WebSocket(url)` in the app, a `FakeSocket` factory in
 * tests. The key rides in the first frame, so no upgrade header is needed
 * and the spec's header seam (F14) is not.
 */
import type { Clock } from '../../lib/contract/clock';

export type OpenSocket = (url: string) => WebSocket;

/** Read at call time, so a test's `vi.stubGlobal('WebSocket')` reaches it. */
export const nativeSocket: OpenSocket = (url) => new WebSocket(url);

/** `WebSocket.OPEN`, read as the constant it is: the socket may be an injected one, whatever the global says. */
export const WS_OPEN = 1;

/** A protocol module's dependencies; both default, so the old client's calls are unchanged (ruling 1). */
export interface SonioxWireDeps {
  clock?: Clock;
  openSocket?: OpenSocket;
}
