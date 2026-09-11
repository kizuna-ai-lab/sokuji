/**
 * Who the text-input row belongs to, and when it may be used.
 *
 * Settled 2026-09-12 (#544): **the text box is a speaker-channel control.**
 * What a user types is their own input — the same thing the microphone would
 * otherwise have carried — so it is translated in the speaker's direction and
 * lands on the speaker's side of the conversation.
 *
 * That deliberately rules out the alternative the reporter expected, routing a
 * typed message to whichever channel happens to be live. The participant leg
 * runs the REVERSED direction (it translates the other party *into* the user's
 * language), so the same box would translate the opposite way depending on
 * mode, and in Both mode — where both legs are live — nothing would tell the
 * user which leg their message went to.
 *
 * The consequence is this gate: in participant-only ("Others") mode there is no
 * channel this control can address, so it is not rendered. Before #544 it
 * rendered, accepted input, and dropped every message with nothing shown to the
 * user.
 *
 * Gated on the LIVE channel rather than the selected mode on purpose. In Both
 * mode the speaker leg can fail to come up while the participant leg survives
 * (split degraded, see splitDegraded.ts); the mode still says "speaker is in
 * scope", but there is no socket to type into.
 */
export interface TextInputGateInput {
  /** A session is running (sessionStore). */
  isSessionActive: boolean;
  /** The provider descriptor claims `capabilities.supportsTextInput`. */
  supportsTextInput: boolean;
  /** The speaker leg is wired end-to-end, not merely in scope for this mode. */
  speakerChannelActive: boolean;
}

/**
 * Whether the text-input row may be shown and its handler may send.
 *
 * Deliberately one predicate for both the render gate and `handleSendText`, so
 * a visible box and a working send can never drift apart.
 */
export function canUseTextInput(gate: TextInputGateInput): boolean {
  return gate.isSessionActive && gate.supportsTextInput && gate.speakerChannelActive;
}
