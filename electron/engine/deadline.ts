/**
 * A deadline on one native call (spec §6.5). The addon runs each call on its own worker thread, so a call that never
 * returns (a driver that hangs) leaves a promise that never settles; this rejects it and tells the host once, which
 * kills the engine process and lets the next connect() start a fresh one.
 *
 * Budgets: model load 600 s; ASR run 30 s + 5 s per audio second; stream feed 30 s; translation 30 s + 0.25 s per
 * token; TTS synth 30 s + 0.5 s per character.
 */
export function withDeadline<T>(p: Promise<T>, ms: number, job: string, onStuck: (job: string) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      onStuck(job);
      reject(new Error(`${job} did not finish within ${ms / 1000} s`));
    }, ms);
    p.then(
      (v) => { if (!done) { done = true; clearTimeout(timer); resolve(v); } },
      (e) => { if (!done) { done = true; clearTimeout(timer); reject(e); } },
    );
  });
}

let stuckHandler: (job: string) => void = () => {};

/** Where a missed deadline is reported (the entry sets it to post `stuck` to the host). */
export function setStuckHandler(fn: (job: string) => void): void {
  stuckHandler = fn;
}

/** withDeadline reporting to the process-wide handler. */
export function guarded<T>(p: Promise<T>, ms: number, job: string): Promise<T> {
  return withDeadline(p, ms, job, (j) => stuckHandler(j));
}

export const LOAD_MS = 600_000;
export const asrRunMs = (audioSeconds: number) => 30_000 + 5_000 * audioSeconds;
export const FEED_MS = 30_000;
export const translateMs = (maxTokens: number) => 30_000 + 250 * maxTokens;
export const ttsMs = (chars: number) => 30_000 + 500 * chars;
