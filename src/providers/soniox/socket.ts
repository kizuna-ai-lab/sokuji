/**
 * The one seam Soniox's session side opens sockets through (F9's
 * convention): `new WebSocket(url, protocols)` in the app, a `FakeSocket`
 * factory in tests. The key rides in a subprotocol, which a browser sets
 * itself, so no upgrade header is needed and the spec's header seam (F14)
 * is not. The seam itself is the contract's: a browser that refuses the
 * socket quotes the subprotocols, the key among them, and the contract's
 * rethrows it in fixed words.
 */
import type { Clock } from '../../lib/contract/clock';

export type OpenSocket = (url: string, protocols: string[]) => WebSocket;

export { nativeSocket, WS_OPEN } from '../../lib/contract/socket';

/**
 * The subprotocols an STT or TTS socket authenticates with
 * (soniox.com/docs/guides/websocket-authentication): `soniox-api-key`,
 * then the key. The key serves the connection's whole life, every stream
 * on it included, so no frame carries it; Soniox refuses a key sent only
 * in a frame from 2027-01-15. A temporary key in the old `temp:` shape is
 * not a valid subprotocol; the backend's leases mint `snx_temp_` keys.
 */
export function sonioxProtocols(apiKey: string): string[] {
  return ['soniox-api-key', apiKey];
}

/** A protocol module's dependencies; both default, so the old client's calls are unchanged (ruling 1). */
export interface SonioxWireDeps {
  clock?: Clock;
  openSocket?: OpenSocket;
}
