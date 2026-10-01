/**
 * How long a client waits before readiness poll number `attempt` (0-based) of
 * a managed voice build — the gap between `ensure` answering `processing` and
 * each `mine` that follows, and between one `mine` and the next.
 *
 * Every poll is one Soniox `getVoice` made by the backend on this client's
 * behalf, and the voices API carries its own requests-per-minute limit that
 * every user's build shares with the reaper's census. Two quick polls catch
 * the builds that finish within a few seconds without making the user wait
 * for them; from the third poll on, 3 s halves what a slow build spends per
 * minute. Both poll loops — session-start preparation and the settings
 * panel — take their schedule from here, so the two cannot drift apart.
 *
 * Neither loop counts polls: each is bounded by its own time budget instead
 * (60 s by default), which this schedule turns into at most ~21 polls.
 */
export const MANAGED_VOICE_POLL_FAST_MS = 1_500;
export const MANAGED_VOICE_POLL_STEADY_MS = 3_000;
/** How many polls use the fast delay before the steady one takes over. */
export const MANAGED_VOICE_POLL_FAST_ATTEMPTS = 2;

export function managedVoicePollDelayMs(attempt: number): number {
  return attempt < MANAGED_VOICE_POLL_FAST_ATTEMPTS ? MANAGED_VOICE_POLL_FAST_MS : MANAGED_VOICE_POLL_STEADY_MS;
}
