// Every wait the session makes hangs off this, not off setTimeout.
//
// On Android, React Native's timers are paused with the activity
// (JavaTimerManager.onHostPause clears the Choreographer callback), so with the
// screen off a setTimeout never fires even though the process and the foreground
// service live on. The recorder's audio callback keeps coming every 100 ms in that
// state (the Gate A locked-screen run), so it drives this ticker; in the foreground
// a plain interval drives it as well, and whichever comes first runs what is due.
export interface Ticker {
  /** Run `fn` on the first tick at or after `ms` from now. Returns a cancel. */
  after(ms: number, fn: () => void): () => void;
  /** Resolve on the first tick at or after `ms` from now, or at once when `signal` aborts. */
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
  /** Run everything that has fallen due, in due order. Cheap when nothing is due. */
  tick(): void;
  /** How many callbacks are waiting. */
  pending(): number;
}

interface Entry {
  due: number;
  seq: number;
  fn: () => void;
}

export function createTicker(now: () => number = Date.now): Ticker {
  const entries: Entry[] = [];
  let seq = 0;

  function after(ms: number, fn: () => void): () => void {
    const entry: Entry = { due: now() + ms, seq: seq++, fn };
    entries.push(entry);
    return () => {
      const i = entries.indexOf(entry);
      if (i >= 0) entries.splice(i, 1);
    };
  }

  function sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise<void>((resolve) => {
      if (signal?.aborted) {
        resolve();
        return;
      }
      const onAbort = () => {
        cancel();
        resolve();
      };
      const cancel = after(ms, () => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      });
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  function tick(): void {
    const t = now();
    const due = entries.filter((e) => e.due <= t).sort((a, b) => a.due - b.due || a.seq - b.seq);
    for (const e of due) {
      const i = entries.indexOf(e);
      if (i >= 0) entries.splice(i, 1);
      e.fn();
    }
  }

  return { after, sleep, tick, pending: () => entries.length };
}
