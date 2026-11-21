// src/lib/translation/jobTranslator.ts
//
// A translation session over a translator that is asked and answers: given
// `translate(text) → text`, it cuts each source with the shared cutter, runs
// the stretches as jobs, one at a time and in order, and says each answer as
// one translation segment, whole and final. What a unit adds is its
// `translate`, what it loads to open, and what it lets go to close.
import type { Clock } from '../contract/clock';
import type { TranslationEvents, TranslationSession } from '../contract/translation';
import { describeCause } from '../diagnostics/describeCause';
import { createSourceCutter, type SourceCutter } from './cutter';

/** How long one job may take before it is given up, unless a unit says otherwise. */
export const JOB_TIMEOUT_MS = 20_000;

export interface JobTranslatorOptions {
  /**
   * Translates one stretch of source. `signal` is the job's own: it aborts at the job's deadline, and when the
   * session stops or ends. An answer or a rejection that comes afterwards is dropped, unsaid.
   */
  translate(text: string, signal: AbortSignal): Promise<string>;
  events: TranslationEvents;
  /** The request's clock: each job's deadline runs on it. */
  clock: Clock;
  /**
   * How long one job may take, in ms; `JOB_TIMEOUT_MS` when absent. Jobs run one at a time, so a `translate` that
   * never settles would hold every later job back: at its deadline the job's signal aborts, the job is said as
   * failed (`translation_timeout`), and the next one runs. Whatever the call answers afterwards is dropped.
   */
  timeoutMs?: number;
  /** The language the answers are in, stated on every translation. Absent: none is stated. */
  language?: string;
  /** What the session awaits to open: a model loaded, a worker ready. A rejection is the start's. Absent: open at once. */
  open?(): Promise<void>;
  /** What is let go when the session stops, or ends on a fatal failure. Called once. */
  close?(): void | Promise<void>;
  /** The words of a failed job's notice. Absent: the error's own message. */
  failureMessage?(error: unknown): string;
  /** Whether a failure is the unit's end, not one job's (a model that is gone). Absent: no failure is. */
  fatal?(error: unknown): boolean;
}

interface Job { origin: string; text: string }

/** How one job ended: answered, rejected, past its deadline, or cut short by the session's end. */
type Outcome = { kind: 'answer'; text: string } | { kind: 'error'; error: unknown } | { kind: 'timeout' } | { kind: 'over' };

/** A job translator's session, and what it still remembers (read by the tests of its ending). */
export type JobTranslatorSession = TranslationSession & { held(): { cutters: number; closed: number } };

/**
 * The session. Jobs run strictly in order, across origins: the stretches as the cutter yielded them, one job in
 * flight. A job's answer opens a segment with the job's origin, says the whole answer with all of it stable, and
 * closes it. A job that fails, or is answered with nothing, says `translation_failed` and the next job runs: the
 * row keeps its source; so does a job that is not answered by its deadline. A failure `fatal` names says `failed`
 * and ends the session. `stop()` aborts the job in flight and drops what waits; nothing is said afterwards.
 */
export function createJobTranslator(o: JobTranslatorOptions): JobTranslatorSession {
  const { events, clock } = o;
  const timeoutMs = o.timeoutMs ?? JOB_TIMEOUT_MS;
  const cutters = new Map<string, SourceCutter>();
  /** Origins that closed: a late snapshot of one starts no second cut. */
  const closed = new Set<string>();
  const jobs: Job[] = [];
  /** Cuts the job in flight short: its signal aborts and its deadline is disarmed. */
  let cutShort: (() => void) | null = null;
  let nextRef = 1;
  let running = false;
  /** Stopped, or failed for good: nothing more is asked or said. */
  let over = false;
  /** The caller stopped the session: not even a failure that was on its way is said. */
  let stopped = false;
  let closing: Promise<void> | null = null;

  /** Ends the session, once: the job in flight is aborted, what waits is dropped, and what was opened is let go. */
  const end = (): Promise<void> => {
    over = true;
    if (closing) return closing;
    cutShort?.();
    jobs.length = 0;
    cutters.clear();
    closed.clear();
    try {
      closing = Promise.resolve(o.close?.());
    } catch (error) {
      closing = Promise.reject(error);
    }
    return closing;
  };

  const failedJob = (message: string, extra: { cause?: unknown; reason?: string }) => {
    events.degraded({ code: 'translation_failed', message, ...extra });
  };

  /**
   * Asks for one job's translation and waits for the first of: its answer, its rejection, its deadline, the
   * session's end. The call gets a signal of its own, aborted at the last two; what it says after them is unheard.
   */
  const ask = (job: Job): Promise<Outcome> => new Promise<Outcome>((resolve) => {
    const abort = new AbortController();
    let settled = false;
    const settle = (outcome: Outcome) => {
      if (settled) return;
      settled = true;
      cancel();
      cutShort = null;
      if (outcome.kind === 'timeout' || outcome.kind === 'over') abort.abort();
      resolve(outcome);
    };
    const cancel = clock.setTimeout(() => settle({ kind: 'timeout' }), timeoutMs);
    cutShort = () => settle({ kind: 'over' });
    try {
      o.translate(job.text, abort.signal).then((text) => settle({ kind: 'answer', text }), (error: unknown) => settle({ kind: 'error', error }));
    } catch (error) {
      settle({ kind: 'error', error });
    }
  });

  const run = async (job: Job): Promise<void> => {
    const outcome = await ask(job);
    // Cut short by the stop, or settled as it landed: expected, not a failure.
    if (over || outcome.kind === 'over') return;
    if (outcome.kind === 'timeout') {
      failedJob('The translation did not come back in time.', { reason: 'translation_timeout' });
      return;
    }
    if (outcome.kind === 'error') {
      const { error } = outcome;
      const message = o.failureMessage?.(error) ?? describeCause(error);
      if (o.fatal?.(error)) {
        // Let go before it is said: nothing follows `failed`, so what the letting go says of itself comes first.
        try {
          await end();
        } catch (closing) {
          if (!stopped) events.frame({ direction: 'in', type: 'translation.close_error', payload: { error: describeCause(closing) } });
        }
        if (!stopped) events.failed({ message, cause: error });
        return;
      }
      failedJob(message, { cause: error });
      return;
    }
    const answer = outcome.text;
    if (answer.trim() === '') {
      failedJob('The translation came back empty.', { reason: 'translation_empty' });
      return;
    }
    const ref = nextRef++;
    events.translationOpened({ ref, origin: job.origin });
    try {
      events.translationText({ ref, text: answer, stableLen: answer.length, ...(o.language === undefined ? {} : { language: o.language }) });
    } finally {
      events.translationClosed({ ref });
    }
  };

  const drain = async (): Promise<void> => {
    running = true;
    try {
      while (jobs.length > 0 && !over) {
        try {
          await run(jobs.shift()!);
        } catch (error) {
          // Not the translation: a listener that threw. Said in the Logs, and the queue moves on.
          if (!over) events.frame({ direction: 'in', type: 'translation.job_error', payload: { error: describeCause(error) } });
        }
      }
    } finally {
      running = false;
    }
  };

  return {
    open: () => (o.open ? o.open() : Promise.resolve()),
    source(snapshot) {
      const { origin } = snapshot;
      if (over || closed.has(origin)) return;
      let cutter = cutters.get(origin);
      if (!cutter) {
        cutter = createSourceCutter();
        cutters.set(origin, cutter);
      }
      const stretches = cutter.feed(snapshot);
      if (snapshot.closed) {
        cutters.delete(origin);
        closed.add(origin);
      }
      for (const { text } of stretches) jobs.push({ origin, text });
      if (!running && jobs.length > 0) void drain();
    },
    stop: () => {
      stopped = true;
      return end();
    },
    held: () => ({ cutters: cutters.size, closed: closed.size }),
  };
}
