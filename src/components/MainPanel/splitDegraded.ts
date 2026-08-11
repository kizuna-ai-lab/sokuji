/**
 * "Split did not take effect" — the decision, as a pure function.
 *
 * A degraded split session looks healthy from the outside: the mode picker
 * still reads Both, the countdown still runs, and the only residual signal is
 * a missing participant waveform, which exists in ADVANCED UI mode only. The
 * session is genuinely fine to continue (decision 4: a participant leg that
 * never comes up does not block the session) — it is just one-way, and the
 * user has no way to know. Split is BUDGETED at roughly twice shared's rate
 * (two transcription streams instead of one), so a degraded split session
 * spends the allowance — and the visible countdown — at the split rate while
 * delivering one direction. The loss is session TIME rather than money: the
 * charge is provider cost × K per usage log, and a leg that never opened a
 * socket produces neither. A user who asked for split is owed the truth when
 * it did not happen.
 *
 * Four paths in connectConversation can leave a split session one-way, and
 * all four feed this:
 *   1. loopback permission denied (Electron whole-system capture)
 *   2. createParticipantSessionConfig() returning null
 *   3. the general participant catch (a connect failure, a recorder failure,
 *      or the acquire-throw sibling that used to be console-only)
 *   4. the leg wiring up fine and its stream dying before the session goes
 *      active — the one path where nothing else in MainPanel reacts at all,
 *      because the leg's onClose early-returns while `!isSessionActive`
 *
 * The first three are known by the time connectConversation reaches its
 * resolve call. The fourth is a fact that ARRIVES, so it is recorded where it
 * happens and read there; see `participantStreamEnded` below.
 *
 * Kept dependency-free on purpose (no React, no i18n, no client imports) so
 * it can be unit-tested without a rendering harness — the same rule
 * resolveVoicePrepOutcome follows.
 */

/**
 * Every way a split session can end up one-way. Declared as a value, not just
 * a union, so the enumerations in the tests are exhaustive by construction —
 * three of them used to be hand-written lists that a fourth reason would have
 * silently escaped.
 */
export const SPLIT_DEGRADED_REASONS = [
  'loopback-denied',
  'no-participant-config',
  'participant-connect-failed',
  /**
   * The leg came up end to end — socket open, recorder wired — and then its
   * own stream ended. Distinct from `participant-connect-failed`, which is a
   * connect() that REJECTED: this one's connect() resolved, and for Soniox
   * that happens inside `ws.onopen`, before the server has looked at
   * `api_key`. A refused key therefore produces a leg that looks started and
   * is already dead, and the close is where that arrives.
   */
  'participant-stream-ended',
] as const;

export type SplitDegradedReason = typeof SPLIT_DEGRADED_REASONS[number];

/** A key plus the English text that renders if i18n has not loaded. */
export interface LocalizedString {
  key: string;
  defaultValue: string;
}

/**
 * The explanatory line shown on hover, per reason.
 *
 * Deliberately reuses strings that already ship in all 30 catalogs rather
 * than minting three new ones: what the user needs is the CAUSE, and these
 * sentences already say it. Two reasons share one key because the user-facing
 * distinction between "no suitable models" and "connect failed" is nil.
 *
 * splitDegraded.test.ts asserts every key here exists in the English catalog
 * and that its text still matches these defaults, so a rename or reword
 * elsewhere cannot quietly turn the hover explanation into a raw key.
 */
export const SPLIT_DEGRADED_DETAIL: Record<SplitDegradedReason, LocalizedString> = {
  'loopback-denied': {
    key: 'audioPanel.screenRecordingDeniedText1',
    defaultValue: 'Participant Audio requires Screen Recording permission to capture system audio.',
  },
  'no-participant-config': {
    key: 'mainPanel.participantChannelFailed',
    defaultValue: 'Failed to start the participant audio channel.',
  },
  'participant-connect-failed': {
    key: 'mainPanel.participantChannelFailed',
    defaultValue: 'Failed to start the participant audio channel.',
  },
  // Same key again, and for the same reason the two above share one: the
  // user-facing distinction between "the socket never opened" and "the socket
  // opened and the server then refused the key" is nil. What they can act on
  // is identical — this channel did not start, run a new session.
  'participant-stream-ended': {
    key: 'mainPanel.participantChannelFailed',
    defaultValue: 'Failed to start the participant audio channel.',
  },
};

/**
 * The chip's own two strings.
 *
 * Worded for someone who has never heard the word "leg": no jargon, no
 * provider name, and a concrete next step. "One-way only" states the effect
 * rather than the mechanism, which is the part the user can act on.
 */
export const SPLIT_DEGRADED_LABEL: LocalizedString = {
  key: 'mainPanel.splitDegradedLabel',
  defaultValue: 'One-way only',
};

export const SPLIT_DEGRADED_TOOLTIP: LocalizedString = {
  key: 'mainPanel.splitDegradedTooltip',
  defaultValue:
    "Participant audio isn't being translated, so this session is running one way only. " +
    'Check participant audio permissions, then run a new session.',
};

/**
 * Should the "one-way only" indicator be shown, and for what reason?
 *
 * `participantChannelStarted` is the end-to-end WIRING flag — the participant
 * client connected AND its recorder was wired. It mirrors
 * setParticipantChannelActive(true)'s own contract, and it is deliberately not
 * read as "the leg works": for Soniox, `connect()` resolves inside `ws.onopen`,
 * before the server has looked at `api_key`, so a refused key still reaches
 * this flag. `participantStreamEnded` is the correction — see its own note.
 *
 * The `?? 'participant-connect-failed'` fallback is the load-bearing clause:
 * a split session whose participant leg never started is degraded whether or
 * not any path remembered to record a reason. Two of the three paths were
 * console-only before this task, and a fourth (the acquire-throw sibling)
 * produced no signal at all — a rule that only fires on a recorded reason
 * would silently miss exactly the cases this indicator exists for.
 *
 * @param input.participantStreamEnded  Has the participant leg's OWN stream
 *   ended? False/absent means "not that we know of", which is NOT the same as
 *   "it is healthy" — and the difference is why this rule claims nothing on
 *   its own. A stream that is up but has produced no transcription is
 *   indistinguishable from a far side that simply has not spoken yet, and
 *   telling a healthy session to go fix itself is worse than reporting a real
 *   fault late. So the indicator waits for a POSITIVE fact — the stream
 *   ending — and never for the absence of one.
 *
 *   The window this exists for is narrow and specific: between the
 *   participant's `connect()` resolving and `setIsSessionActive(true)`, the
 *   leg's onClose early-returns without tearing anything down, so a stream
 *   that dies there leaves no trace anywhere else. After that point a dying
 *   participant leg ends the whole session, which the user cannot miss.
 */
export function resolveSplitDegraded(input: {
  splitRequested: boolean;
  participantChannelStarted: boolean;
  failure: SplitDegradedReason | null;
  participantStreamEnded?: boolean;
}): SplitDegradedReason | null {
  if (!input.splitRequested) return null;
  if (!input.participantChannelStarted) return input.failure ?? 'participant-connect-failed';
  // The leg was wired. It is degraded only once its stream is known to be
  // gone — and then it is degraded whether or not it managed a frame first,
  // because either way nothing is transcribing the far side from here on.
  return input.participantStreamEnded ? 'participant-stream-ended' : null;
}

/** Just enough of i18next's `t` to resolve a key with an English fallback. */
export type TranslateWithDefault = (key: string, defaultValue: string) => string;

export interface SplitDegradedChipText {
  /** Short text on the chip itself. */
  label: string;
  /** Hover text: the cause, a blank line, then the consequence and remedy. */
  title: string;
}

/**
 * Compose the chip's visible label and its hover explanation.
 *
 * Cause first, consequence second: the user's question on seeing the chip is
 * "why", and the remedy is only actionable once the cause is known. The blank
 * line between them is what makes a native `title` tooltip — a single
 * unstyled text blob — readable as two thoughts instead of one run-on.
 *
 * Extracted from the chip's JSX so the composition is pinned by a test rather
 * than living as an inline expression.
 */
export function splitDegradedChipText(
  reason: SplitDegradedReason,
  translate: TranslateWithDefault,
): SplitDegradedChipText {
  const detail = SPLIT_DEGRADED_DETAIL[reason];
  return {
    label: translate(SPLIT_DEGRADED_LABEL.key, SPLIT_DEGRADED_LABEL.defaultValue),
    title:
      translate(detail.key, detail.defaultValue) +
      '\n\n' +
      translate(SPLIT_DEGRADED_TOOLTIP.key, SPLIT_DEGRADED_TOOLTIP.defaultValue),
  };
}
