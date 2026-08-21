// src/utils/effectiveTextOnly.ts
//
// Deliberately a LEAF module: no imports at all. It is read by the settings UI
// (LanguageSection), the settings store's native-readiness gate, the Start-button
// gate and MainPanel's session-resource acquire — four surfaces in three trees,
// none of which may drag another's dependencies in.

/**
 * Does the session described by these inputs produce NO spoken translation?
 *
 * The user's "Text Only" toggle is a *request*, not the answer. The participant
 * (reverse-direction) leg never speaks: every descriptor's
 * `buildParticipantSessionConfig` forces `textOnly: true`, and
 * `descriptorRegistry.test.ts` pins that as a registry-wide invariant. So a
 * session with no speaker leg is text-only whatever the toggle says, and the
 * toggle is the answer only when a speaker leg exists to honour it.
 *
 * Written down once because the rule used to live inline at a single call site
 * (MainPanel's acquire) while three other places read the raw toggle. The
 * visible consequence was the Start-button balance floor: a participant-only
 * managed Soniox session opens ONE transcription stream ($0.018334 for the
 * backend's 60 s minimum) but was gated at the speech-to-speech floor
 * ($0.041667), so a user holding a balance between the two was told they had
 * insufficient funds for a session the backend would have started.
 *
 * @param speakerLegRuns Will the microphone (forward-direction) leg run?
 *   Surfaces that decide before Start pass mode SCOPE — `mode === 'speaker' ||
 *   mode === 'both'` — because they have no business knowing which device is
 *   selected. The start path passes the device-aware `speakerWillStart`. Both
 *   are correct for their caller: the Start gate independently refuses a mode
 *   whose devices are missing, so the two can only disagree about a session
 *   that cannot start.
 * @param textOnly The user's toggle, as persisted in `settings.common.textOnly`.
 */
export function effectiveTextOnly(
  { speakerLegRuns, textOnly }: { speakerLegRuns: boolean; textOnly: boolean },
): boolean {
  return speakerLegRuns ? textOnly : true;
}
