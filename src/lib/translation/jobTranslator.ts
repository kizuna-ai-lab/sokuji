// src/lib/translation/jobTranslator.ts
//
// A translation session over a translator that is asked and answers: given
// `translate(text) → text`, it cuts each source with the shared cutter, runs
// the stretches as jobs, one at a time and in order, and says each answer as
// one translation segment, whole and final. Each job is told the last few
// stretches the session translated, with their translations, so a model that
// reads context can keep names and terms the same. What a unit adds is its
// `translate`, what it loads to open, and what it lets go to close.
import type { Clock } from '../contract/clock';
import type { TranslationEvents, TranslationSession } from '../contract/translation';
import { describeCause } from '../diagnostics/describeCause';
import { createSourceCutter, type SourceCutter } from './cutter';

/** How long one job may take before it is given up, unless a unit says otherwise. */
export const JOB_TIMEOUT_MS = 20_000;

/**
 * How long a failure that ends the session waits for what it lets go (`close`) before it says `failed` without
 * it. A worker that is gone may never answer its own closing, and the leg has to hear that it failed.
 */
export const CLOSE_TIMEOUT_MS = 5_000;

/** How many translated stretches a job is told of: the session's last three. */
export const CONTEXT_PAIRS = 3;

/** A stretch of source the session translated, and the translation it said for it. */
export interface TranslatedPair { source: string; translation: string }

/**
 * What a job is told of the session before it: the last `CONTEXT_PAIRS` stretches it translated, of any origin,
 * oldest first. A job that failed, came back blank or past its deadline adds nothing. Each job gets a copy of its own.
 */
export interface JobContext { previous: TranslatedPair[] }

export interface JobTranslatorOptions {
  /**
   * Translates one stretch of source. `signal` is the job's own: it aborts at the job's deadline, and when the
   * session stops or ends. An answer or a rejection that comes afterwards is dropped, unsaid. `context` is what
   * the session translated before this job; a translator that does not read context ignores it.
   */
  translate(text: string, signal: AbortSignal, context: JobContext): Promise<string>;
  events: TranslationEvents;
  /** The request's clock: each job's deadline runs on it, and the bound of a fatal failure's letting go. */
  clock: Clock;
  /** The request's signal: the run was cancelled. An open still pending rejects with its reason. */
  signal: AbortSignal;
  /**
   * How long one job may take, in ms; `JOB_TIMEOUT_MS` when absent. Jobs run one at a time, so a `translate` that
   * never settles would hold every later job back: at its deadline the job's signal aborts, the job is said as
   * failed (`translation_timeout`), and the next one runs. Whatever the call answers afterwards is dropped.
   */
  timeoutMs?: number;
  /** The language the answers are in, stated on every translation. Absent: none is stated. */
  language?: string;
  /**
   * What the session awaits to open: a model loaded, a worker ready. A rejection is the start's. `signal` is the
   * request's: when it aborts the session's open rejects at once, whatever this is still doing, and the caller
   * stops the session, which lets go (`close`) what this had loaded. Absent: open at once.
   */
  open?(signal: AbortSignal): Promise<void>;
  /**
   * What is let go when the session stops, or ends on a fatal failure. Called once. A stop waits for it; a fatal
   * failure waits `CLOSE_TIMEOUT_MS` and no longer.
   */
  close?(): void | Promise<void>;
  /** The words of a failed job's notice. Absent: the error's own message. */
  failureMessage?(error: unknown): string;
  /**
   * Whether a failure is the unit's end, not one job's (a model that is gone, a key the service refuses). `true`
   * ends it; `{ code }` ends it and names why on `failed` (the run's notice for it, as `auth` or `model_missing`).
   * Absent: no failure is.
   */
  fatal?(error: unknown): boolean | { code: string };
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
 * and ends the session. `stop()` aborts the job in flight and drops what waits; nothing is said afterwards, not
 * even the rest of a segment whose listener was the one that stopped it.
 *
 * What the session says of itself in the Logs (`frame`) is said as it can be: a listener that throws on one costs
 * neither the `failed` that follows nor the jobs that wait.
 */
export function createJobTranslator(o: JobTranslatorOptions): JobTranslatorSession {
  const { events, clock } = o;
  const timeoutMs = o.timeoutMs ?? JOB_TIMEOUT_MS;
  const cutters = new Map<string, SourceCutter>();
  /** Origins that closed: a late snapshot of one starts no second cut. */
  const closed = new Set<string>();
  const jobs: Job[] = [];
  /** The last stretches translated, oldest first: what the next job is told. */
  const previous: TranslatedPair[] = [];
  /** Cuts the job in flight short: its signal aborts and its deadline is disarmed. */
  let cutShort: (() => void) | null = null;
  let nextRef = 1;
  let running = false;
  /** Stopped, or failed for good: nothing more is asked or said. */
  let over = false;
  /** The caller stopped the session: not even a failure that was on its way is said. */
  let stopped = false;
  let closing: Promise<void> | null = null;
  /** Ends the wait of a fatal failure for what it lets go, unsaid: the caller's stop took over. */
  let unbound: (() => void) | null = null;

  /**
   * Ends the session, once: the job in flight is aborted, what waits is dropped, and what was opened is let go.
   * The promise every ending shares is there before anything is told of the ending, so a stop asked from inside it
   * (a job's abort listener, the close itself) joins this one and lets nothing go twice.
   */
  const end = (): Promise<void> => {
    over = true;
    if (closing) return closing;
    let settle!: { resolve(): void; reject(error: unknown): void };
    closing = new Promise<void>((resolve, reject) => { settle = { resolve, reject }; });
    cutShort?.();
    jobs.length = 0;
    previous.length = 0;
    cutters.clear();
    closed.clear();
    try {
      Promise.resolve(o.close?.()).then(settle.resolve, settle.reject);
    } catch (error) {
      settle.reject(error);
    }
    return closing;
  };

  /** A word of the session's own for the Logs. Whoever listens may throw: that is the Logs' loss, and nothing else's. */
  const note = (type: string, payload: unknown) => {
    try {
      events.frame({ direction: 'in', type, payload });
    } catch {
      // Unsaid.
    }
  };

  /**
   * Ends the session on a failure, and waits for what it lets go: until it settles, or `CLOSE_TIMEOUT_MS`, or the
   * caller's stop. What the letting go says of itself goes to the Logs. Past the bound it is given up: a later
   * stop does not wait for it, and whatever it does afterwards is unheard.
   */
  const letGo = (): Promise<void> => new Promise<void>((resolve) => {
    let waiting = true;
    const done = (say?: () => void) => {
      if (!waiting) return;
      waiting = false;
      cancel();
      unbound = null;
      if (!stopped) say?.();
      resolve();
    };
    const cancel = clock.setTimeout(() => done(() => {
      closing = Promise.resolve();
      note('translation.close_timeout', { afterMs: CLOSE_TIMEOUT_MS });
    }), CLOSE_TIMEOUT_MS);
    unbound = () => done();
    end().then(() => done(), (error: unknown) => done(() => note('translation.close_error', { error: describeCause(error) })));
  });

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
      o.translate(job.text, abort.signal, { previous: previous.map((pair) => ({ ...pair })) }).then((text) => settle({ kind: 'answer', text }), (error: unknown) => settle({ kind: 'error', error }));
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
      const fatal = o.fatal?.(error);
      if (fatal) {
        // Let go before it is said: nothing follows `failed`, so what the letting go says of itself comes first.
        await letGo();
        if (!stopped) events.failed({ message, ...(typeof fatal === 'object' ? { code: fatal.code } : {}), cause: error });
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
    // Had, whatever a listener does with it below: the next job is told of it.
    previous.push({ source: job.text, translation: answer });
    if (previous.length > CONTEXT_PAIRS) previous.shift();
    // Each event is a listener's turn, and a listener may stop the session: nothing more is said of the segment
    // then. One that throws, at the open or at the text, still has its segment closed while the session is live.
    const ref = nextRef++;
    try {
      events.translationOpened({ ref, origin: job.origin });
      if (!over) events.translationText({ ref, text: answer, stableLen: answer.length, ...(o.language === undefined ? {} : { language: o.language }) });
    } finally {
      if (!over) events.translationClosed({ ref });
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
          if (!over) note('translation.job_error', { error: describeCause(error) });
        }
      }
    } finally {
      running = false;
    }
  };

  /** Opens what the unit has to open, unless the run is cancelled first: then it rejects with the signal's reason. */
  const open = (): Promise<void> => new Promise<void>((resolve, reject) => {
    const { signal } = o;
    const cancelled = () => reject(signal.reason ?? new Error('aborted'));
    if (signal.aborted) return cancelled();
    if (!o.open) return resolve();
    signal.addEventListener('abort', cancelled, { once: true });
    const heard = () => signal.removeEventListener('abort', cancelled);
    let opening: Promise<void>;
    try {
      opening = o.open(signal);
    } catch (error) {
      heard();
      return reject(error);
    }
    opening.then(() => { heard(); resolve(); }, (error: unknown) => { heard(); reject(error); });
  });

  return {
    open,
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
      const ending = end();
      // A failure that was waiting to say itself says nothing now, and its bound is disarmed.
      unbound?.();
      return ending;
    },
    held: () => ({ cutters: cutters.size, closed: closed.size }),
  };
}
