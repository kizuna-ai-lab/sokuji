import { describe, it, expect } from 'vitest';
import { resolveSplitDegraded, type SplitDegradedReason } from './splitDegraded';

/**
 * Regression coverage for a property of MainPanel.tsx that lives in the ORDER
 * its side effects run in, not in `resolveSplitDegraded` itself (that
 * function's own branches are covered in splitDegraded.test.ts).
 *
 * THE BUG. `participantChannelStarted` is set after the participant recorder
 * is wired, which is downstream of `connect()` resolving — and
 * `SonioxSttStream.connect()` resolves inside `ws.onopen`, before Soniox has
 * looked at `api_key` at all. A participant key Soniox then refuses (a lapsed
 * start window is the reachable case: that key is minted at Start and
 * connected only after the OS screen-recording dialog) comes back as an error
 * frame and a close roughly 100-300 ms later — inside the window between
 * connect() resolving and `setIsSessionActive(true)`.
 *
 * In that window `createParticipantEventHandlers().onClose` early-returns on
 * `!isSessionActive`, so nothing tears down; `participantChannelStarted` is
 * already true, so nothing degrades. The user paid split rates (roughly 2x per
 * wall-clock minute, and the visible countdown burns at that rate), got a
 * one-way session, and was told nothing.
 *
 * THE FIX, as an ordering property: the leg's own stream ending is recorded
 * BEFORE that early return — the guard decides whether to tear the session
 * down, not whether the fact happened — and `resolveSplitDegraded` reads it.
 *
 * There is no React rendering harness in this repo (see voicePrepWiring.test.ts
 * and participantErrorOrdering.test.ts for the same constraint), so this
 * reproduces connectConversation's sequence and the handler's shape around the
 * REAL `resolveSplitDegraded`, with a pre-fix contrast that reproduces the
 * silent one-way session and asserts nothing at all is shown.
 */

/** When the refused key's close lands, relative to connectConversation's steps. */
type CloseMoment =
  /** Never — the healthy leg, and the quiet-far-side case. */
  | 'never'
  /** While the recorder is still being wired (both awaits are in flight). */
  | 'during-recorder-wiring'
  /** After the recorder is wired, before the session is marked active. THE window. */
  | 'after-recorder-wiring'
  /** After `setIsSessionActive(true)` — the guard opens and teardown runs. */
  | 'after-session-active';

interface SplitStartOutcome {
  degraded: SplitDegradedReason | null;
  /** Did the participant close run MainPanel's full session teardown? */
  tornDown: boolean;
}

/**
 * connectConversation's split-Both participant path, reduced to the steps that
 * decide the chip. `recordBeforeGuard: false` reproduces the PRE-FIX handler,
 * where the leg's death was only ever observable once the session was already
 * active — i.e. never in the window that matters.
 */
function runSplitStart(opts: {
  closeAt: CloseMoment;
  recordBeforeGuard?: boolean;
  /** A speaker leg came up, so the "neither channel" abort does not fire. */
  splitRequested?: boolean;
  /** The ref survives across sessions; connectConversation resets it at the top. */
  carriedOverFromLastSession?: { ended: boolean };
  /** Omit the reset, to show what the ref would carry without it. */
  resetAtStart?: boolean;
}): SplitStartOutcome {
  const recordBeforeGuard = opts.recordBeforeGuard ?? true;
  let sessionActive = false;
  // connectConversation's top-of-try reset of participantStreamEndedRef.
  let participantStreamEnded =
    (opts.resetAtStart ?? true) ? false : (opts.carriedOverFromLastSession?.ended ?? false);
  let participantChannelStarted = false;
  let tornDown = false;
  const failure: SplitDegradedReason | null = null;

  // MainPanel's createParticipantEventHandlers().onClose.
  const onClose = () => {
    // FIXED: the leg's stream has ended, and that is true whatever phase the
    // session is in. Recorded first, unconditionally.
    if (recordBeforeGuard) participantStreamEnded = true;
    // The early return the finding is about. It exists because some clients
    // fire onClose synchronously from disconnect() during a user-initiated
    // Stop; it must keep gating the TEARDOWN.
    if (!sessionActive) return;
    // PRE-FIX: the only place the fact was ever observable.
    if (!recordBeforeGuard) participantStreamEnded = true;
    tornDown = true; // await disconnectConversationRef.current?.()
  };

  // --- participant block ---
  // await participantClient.connect(...) resolves: the socket is open, and for
  // Soniox that is all it means.
  if (opts.closeAt === 'during-recorder-wiring') onClose();
  // await startSystem/TabAudioRecording(...) succeeded.
  participantChannelStarted = true;
  if (opts.closeAt === 'after-recorder-wiring') onClose();

  // --- post-init ---
  // noChannelCameUp() passes (the speaker leg started), then:
  sessionActive = true; // setIsSessionActive(true)
  if (opts.closeAt === 'after-session-active') onClose();

  const degraded = resolveSplitDegraded({
    splitRequested: opts.splitRequested ?? true,
    participantChannelStarted,
    failure,
    participantStreamEnded,
  });
  return { degraded, tornDown };
}

describe('a participant key refused after the socket opened', () => {
  it('lights the indicator when the close lands in the pre-active window', () => {
    const outcome = runSplitStart({ closeAt: 'after-recorder-wiring' });
    expect(outcome.tornDown).toBe(false); // settled design: the session continues one-way
    expect(outcome.degraded).toBe('participant-stream-ended');
  });

  it('lights it just the same when the close beats the recorder wiring', () => {
    // startSystemAudioRecording is independent of the socket, so the channel
    // still reaches its "started" flag with a corpse behind it.
    const outcome = runSplitStart({ closeAt: 'during-recorder-wiring' });
    expect(outcome.tornDown).toBe(false);
    expect(outcome.degraded).toBe('participant-stream-ended');
  });

  it('pre-fix contrast: the same session says nothing at all', () => {
    // Proves the assertions above depend on WHERE the fact is recorded rather
    // than being true no matter how the handler is written. This is the
    // reported bug: no teardown, no chip, split rates, one direction.
    const outcome = runSplitStart({ closeAt: 'after-recorder-wiring', recordBeforeGuard: false });
    expect(outcome.tornDown).toBe(false);
    expect(outcome.degraded).toBeNull();
  });

  it('leaves teardown to the guard once the session is active', () => {
    // Past that point the close is not silent: the participant leg's death
    // tears the whole session down and the user sees the session stop. The
    // chip is not the mechanism there, and disconnectConversation clears it.
    const outcome = runSplitStart({ closeAt: 'after-session-active' });
    expect(outcome.tornDown).toBe(true);
  });
});

describe('a healthy split session', () => {
  it('shows nothing, and never waits for a frame to decide that', () => {
    // What the chip shows before any transcription arrives: nothing. The
    // decision is not deferred behind a deadline, so a far side that stays
    // silent for a whole session is never accused of being broken.
    expect(runSplitStart({ closeAt: 'never' })).toEqual({ degraded: null, tornDown: false });
  });

  it('is unaffected outside split, where the chip does not exist', () => {
    expect(runSplitStart({ closeAt: 'after-recorder-wiring', splitRequested: false }).degraded).toBeNull();
  });
});

describe('the fact does not leak between sessions', () => {
  // The hazard this ref introduces: an ordinary Stop ends the participant
  // leg's stream too — SonioxClient.disconnect() delivers that close itself —
  // so the bit is set at the end of EVERY healthy split session.
  const afterAnOrdinarySession = { ended: true };

  it('a healthy session after a previous one still shows nothing', () => {
    expect(runSplitStart({ closeAt: 'never', carriedOverFromLastSession: afterAnOrdinarySession }))
      .toEqual({ degraded: null, tornDown: false });
  });

  it('contrast: without the reset, every session after the first is condemned', () => {
    // Proves the reset at the top of connectConversation is what the
    // assertion above depends on.
    expect(runSplitStart({
      closeAt: 'never',
      carriedOverFromLastSession: afterAnOrdinarySession,
      resetAtStart: false,
    }).degraded).toBe('participant-stream-ended');
  });
});
