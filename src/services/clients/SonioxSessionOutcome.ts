/**
 * Session-level endings for a managed Soniox session, and the narrow contract
 * that lets a session and its streams talk about them.
 *
 * Two endings belong to the SESSION, not to any one stream: the balance
 * running out, and Soniox dropping the session when its granted duration is
 * reached. Split Both mode runs TWO STT streams under ONE
 * `max_session_duration_seconds`, so at the cutoff both legs receive a 403
 * within the same second. Left to the streams, the "segment ended" notice
 * appears twice, or once, depending on which close wins the teardown race —
 * and the leg that did NOT notice keeps streaming (and billing) afterwards.
 *
 * The rule enforced here: the first leg to notice CLAIMS the announcement,
 * every other leg stays silent, and every leg is still torn down.
 *
 * `SonioxSessionLeg` is deliberately narrow and lives in this leaf module so
 * ManagedSonioxSession can hold its clients without importing SonioxClient —
 * SonioxClient already imports ManagedSonioxSession (type-only), and a value
 * import back the other way would be a cycle.
 */

export type SonioxSessionOutcomeKind = 'budget_exhausted' | 'duration_cutoff';

/** What the session hands to the announcing leg. */
export interface SonioxSessionOutcomeNotice {
  /** Already localized. The leg only renders it. */
  text: string;
  /**
   * Realtime-event type to emit alongside the notice, or omitted when the
   * per-leg close path already emits its own (the duration cutoff does —
   * see handleSttClose, which must keep emitting once PER LEG so both
   * legs' 403s stay visible in telemetry).
   */
  realtimeEvent?: string;
  /**
   * Present only for endings that are genuinely errors. The duration cutoff
   * is not one: it has never fired onError and must not start, or every
   * normal end-of-segment lands in the api_error dashboard.
   */
  analytics?: { code: string; rawMessage: string };
}

/** What a SonioxClient exposes to the session that owns it. */
export interface SonioxSessionLeg {
  /**
   * True for the ONE leg that speaks for the session — the same bit
   * `ClientOptions.sonioxManaged.announcesSessionOutcome` already carries,
   * read here rather than re-derived, so "which leg is primary" has exactly
   * one source (`managedLegOptions` in managedSonioxSplit.ts, called from
   * the kizuna descriptor's `acquireSessionResources`).
   *
   * Load-bearing: MainPanel's teardown calls
   * `setItems(speakerClient.getConversationItems())`, so an item emitted on
   * the participant leg is never displayed at all.
   */
  readonly announcesSessionOutcome: boolean;
  /** Render the session's single ending notice on THIS leg. */
  announceSessionOutcome(notice: SonioxSessionOutcomeNotice): void;
  /**
   * Gracefully end this leg's STT stream and mark its outcome as already
   * announced. MUST be idempotent: it is called on every leg on every
   * finishSession, and in split the second leg's own 403 calls it again.
   */
  endForSessionOutcome(): void;
}

/**
 * One-shot ownership token for a session's ending announcement.
 * `claim` returns true exactly once in this object's lifetime.
 */
export class SonioxSessionOutcome {
  private claimedKind: SonioxSessionOutcomeKind | null = null;

  claim(kind: SonioxSessionOutcomeKind): boolean {
    if (this.claimedKind !== null) return false;
    this.claimedKind = kind;
    return true;
  }

  get kind(): SonioxSessionOutcomeKind | null {
    return this.claimedKind;
  }

  get isClaimed(): boolean {
    return this.claimedKind !== null;
  }
}
