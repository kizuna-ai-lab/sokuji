/**
 * Whether the periodic "anchor" response may go out on a channel.
 *
 * The anchor is an out-of-band response that re-states the translator role, to
 * stop the model drifting into conversation. It is sent once when a session
 * starts and every N completed translations after that — on a timer of the
 * conversation's own making, never in response to anything the user did.
 *
 * That last part is why #546 was so visible: an anchor aimed at a channel with
 * no open socket raised `RealtimeAPI is not connected` in the user's face,
 * seconds after Start, with nothing typed and nothing clicked.
 *
 * The old gate asked only whether the channel's client REF was non-null, which
 * is not the same question. Three ways a non-null client has no socket:
 *
 *  1. **It never connected.** A participant leg that fails to connect is
 *     non-fatal by design: the session continues on whichever leg came up, and
 *     the failed client stays in its ref (MainPanel's participant-connect
 *     catch). No previous session required — this happens on a cold start.
 *  2. **It belongs to an earlier session.** `speakerClientRef` is never cleared
 *     on teardown. Both → stop → Others → start, and the speaker anchor fires
 *     on the last session's disconnected client.
 *  3. **Its socket was dropped.** The endpoint closes a connection that did
 *     open. Nothing here prevents that; this gate only stops us walking into it.
 *
 * So the question to ask is whether the socket is actually open, and
 * `IClient.isConnected()` is exactly that. On `OpenAIClient` — the beta-SDK
 * client behind OpenAI Compatible, and the only one of the three that raises
 * this error at all, since the GA path catches inside its own `send()` — it
 * returns the very flag `send()` tests before throwing, so asking it here is
 * asking the same question one step earlier. `OpenAIGAClient` and
 * `OpenAIWebRTCClient` answer the same question about their own transport.
 *
 * A refused anchor is NOT consumed: the caller records the count only once this
 * returns true, so a channel that comes up late still gets its opening anchor
 * on the next evaluation rather than losing it.
 */
export interface AnchorGateInput {
  /** A session is running. */
  isActive: boolean;
  /** This provider uses out-of-band anchor responses at all (OpenAI-shaped). */
  providerSendsAnchors: boolean;
  /** This channel's client exists *and* its socket is open — `isConnected()`. */
  channelConnected: boolean;
  /** Completed assistant items on this channel. */
  completedTranslations: number;
  /** Count at this channel's last anchor; -1 means "none yet this session". */
  lastAnchorCount: number;
  /** Anchor every N translations after the opening one. */
  interval: number;
}

export function shouldSendAnchor(gate: AnchorGateInput): boolean {
  if (!gate.isActive || !gate.providerSendsAnchors || !gate.channelConnected) {
    return false;
  }

  // Opening anchor, once per session.
  if (gate.lastAnchorCount === -1) return true;

  // Then every `interval` translations. The `> 0` term matters: an empty
  // conversation satisfies `0 % interval === 0` and would otherwise anchor on
  // every re-render.
  return gate.completedTranslations > 0
    && gate.completedTranslations % gate.interval === 0
    && gate.completedTranslations !== gate.lastAnchorCount;
}
