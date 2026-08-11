import type { ClientId } from '../../stores/logStore';

/**
 * Which audio legs are currently reconnecting.
 *
 * MainPanel exposes ONE `isReconnecting` boolean, but a split Both session runs
 * two independent provider streams that reconnect independently. Routing both
 * legs' callbacks straight at that boolean lets whichever recovers first clear
 * the banner while the other is still down.
 *
 * Immutable on purpose: MainPanel holds this in a ref and derives the rendered
 * boolean from it, so an in-place mutation would be invisible to React and
 * would also make the ref's value depend on when it happened to be read.
 * `ClientId` is reused rather than a private twin so the log entries these
 * transitions produce are tagged with the same vocabulary.
 */
export type ReconnectingState = readonly ClientId[];

export const NO_CHANNELS_RECONNECTING: ReconnectingState = [];

/** Idempotent: a client may announce `onReconnecting` more than once for one
 *  outage (a retry ladder re-enters the state on every attempt). */
export function channelReconnecting(state: ReconnectingState, channel: ClientId): ReconnectingState {
  return state.includes(channel) ? state : [...state, channel];
}

/** Idempotent, and a no-op for a leg that never announced reconnecting — some
 *  clients emit `onReconnected` after a first successful connect. */
export function channelReconnected(state: ReconnectingState, channel: ClientId): ReconnectingState {
  return state.includes(channel) ? state.filter(c => c !== channel) : state;
}

export function isAnyChannelReconnecting(state: ReconnectingState): boolean {
  return state.length > 0;
}
