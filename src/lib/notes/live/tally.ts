/**
 * One live-notes session's tally, from the loop's per-update lines (`LiveNotesDeps.log`): how many updates ran, how
 * many were kept and how many given up, and the mean time an update took. Counts and a time only; the lines name no text.
 */
export interface LiveTally {
  add(line: Record<string, unknown>): void;
  /** The session's summary, or null when no update ran. */
  summary(): { service: string; updates: number; accepted: number; given_up: number; avg_latency_ms: number } | null;
}

export function createLiveTally(service: string): LiveTally {
  let updates = 0;
  let accepted = 0;
  let givenUp = 0;
  let latency = 0;
  return {
    add(line) {
      if (typeof line.latencyMs !== 'number' || typeof line.accepted !== 'boolean') return;
      updates += 1;
      latency += line.latencyMs;
      if (line.accepted) accepted += 1;
      if (line.givenUp === true) givenUp += 1;
    },
    summary: () => (updates === 0 ? null : { service, updates, accepted, given_up: givenUp, avg_latency_ms: Math.round(latency / updates) }),
  };
}
