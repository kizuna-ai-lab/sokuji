/**
 * The one clock every timer in the new spine reads. Production passes
 * `realClock`; tests pass a virtual clock and advance it by hand, so a script
 * that spans a minute runs in a millisecond and never flakes.
 */
export interface Clock {
  now(): number;
  /** Schedules `fn` after `ms`; returns a cancel function. */
  setTimeout(fn: () => void, ms: number): () => void;
}

export const realClock: Clock = {
  now: () => Date.now(),
  setTimeout(fn, ms) {
    const id = setTimeout(fn, ms);
    return () => clearTimeout(id);
  },
};

/**
 * Runs `fn` every `ms` on `clock` until the returned cancel is called: the
 * interval every protocol module uses in place of the global one (F9), so
 * a virtual clock drives a keep-alive in tests. The next tick is armed
 * before `fn` runs, so on the real clock a tick that throws does not stop
 * the interval.
 */
export function every(clock: Pick<Clock, 'setTimeout'>, ms: number, fn: () => void): () => void {
  // A virtual clock would spin forever on a zero interval.
  if (!(ms > 0)) throw new RangeError(`every() needs a positive interval, not ${ms}`);
  let stopped = false;
  let cancel: () => void = () => {};
  const tick = () => {
    if (stopped) return;
    cancel = clock.setTimeout(tick, ms);
    fn();
  };
  cancel = clock.setTimeout(tick, ms);
  return () => {
    stopped = true;
    cancel();
  };
}

export interface VirtualClock extends Clock {
  /** Moves time forward, firing every due timer in order of due time, then
   *  insertion. A timer scheduled by a callback fires in the same advance
   *  when it falls due inside it. */
  advance(ms: number): void;
}

interface Timer {
  at: number;
  seq: number;
  fn: () => void;
  cancelled: boolean;
}

export function createVirtualClock(start = 0): VirtualClock {
  let now = start;
  let seq = 0;
  /** Kept sorted by (at, seq). Advancing walks from the front by index and
   *  drops the processed prefix once. A script of thousands of exchanges
   *  schedules tens of thousands of timers; a linear scan per pop would be
   *  quadratic. */
  const timers: Timer[] = [];

  const before = (a: Timer, b: Timer) => a.at < b.at || (a.at === b.at && a.seq < b.seq);

  return {
    now: () => now,
    setTimeout(fn, ms) {
      const timer: Timer = { at: now + Math.max(0, ms), seq: seq++, fn, cancelled: false };
      let lo = 0;
      let hi = timers.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (before(timers[mid], timer)) lo = mid + 1; else hi = mid;
      }
      timers.splice(lo, 0, timer);
      return () => { timer.cancelled = true; };
    },
    advance(ms) {
      const target = now + ms;
      // Walk the sorted array by index and drop the processed prefix once.
      // A callback may schedule a new timer: it is due at or after `now` with
      // a larger seq, so the binary insert places it after index `i`.
      let i = 0;
      while (i < timers.length && timers[i].at <= target) {
        const due = timers[i++];
        if (due.cancelled) continue;
        now = due.at;
        due.fn();
      }
      timers.splice(0, i);
      now = target;
    },
  };
}
